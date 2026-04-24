/**
 * Rehype plugin: replace the contents of Shiki-emitted <pre class="astro-code">
 * elements whose language matches a registered tree-sitter grammar.
 *
 * The plugin is loaded by astro.config.mjs only when the staged site
 * contains a non-empty grammar manifest at `src/generated/grammars.json`.
 * Each manifest entry points at a /nix/store path holding a WASM
 * parser + its `queries/` tree.
 *
 * Tokenisation is deliberately simple: for every tree-sitter capture in
 * `queries/highlights.scm`, we paint the capture's byte range with its
 * name. Later/deeper captures overwrite earlier ones, which matches the
 * nvim-treesitter convention of "more specific wins." We then fold
 * contiguous same-label ranges into `<span class="tok-…">` elements.
 *
 * Failure policy: if a grammar fails to load or a block fails to parse,
 * the block is left untouched (Shiki's plain-text fallback stays put)
 * and a warning is logged. We never throw.
 */

import fs from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {visit, SKIP} from "unist-util-visit";
import {Parser, Language, Query} from "web-tree-sitter";

const require = createRequire(import.meta.url);

const loader = {
  initialised: false,
  languagesByAlias: new Map(),
  ready: null,
};

/*
 * Report a language-load failure in a way that's loud enough to be
 * spotted in a 200-line Astro build log. `[!] repo-docs · <lang>:
 * <reason>` plus the queries file path so the next reader can jump
 * straight to the broken pattern. We use console.error (not warn)
 * because silent silence is what bit us before.
 */
function reportLanguageError(name, queryPath, reason) {
  console.error(
    `\n[!] repo-docs · tree-sitter-highlight: ${name}\n    ${reason}\n    queries file: ${queryPath}\n    ${name} code blocks will render as plain text until this is fixed.\n`,
  );
}

async function loadGrammars(manifestPath) {
  if (loader.ready) return loader.ready;
  loader.ready = (async () => {
    try {
      const raw = fs.readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(raw);
      if (!manifest || Object.keys(manifest).length === 0) {
        loader.initialised = true;
        return;
      }
      await Parser.init({
        locateFile(file) {
          // web-tree-sitter's exports map publishes the WASM runtime as
          // `web-tree-sitter/tree-sitter.wasm`. Resolving the main entry
          // (exports["."] via require.resolve) gives us the package's
          // runtime dir so any future sibling asset resolves from there.
          if (file === "tree-sitter.wasm") {
            return require.resolve("web-tree-sitter/tree-sitter.wasm");
          }
          const mainEntry = require.resolve("web-tree-sitter");
          return path.join(path.dirname(mainEntry), file);
        },
      });
      for (const [name, entry] of Object.entries(manifest)) {
        const queryPath = path.join(entry.queries, "highlights.scm");
        try {
          const language = await Language.load(entry.parser);
          if (!fs.existsSync(queryPath)) {
            reportLanguageError(
              name,
              queryPath,
              `no highlights.scm found in queries/ — grammar loaded but all ${name} blocks will render unstyled`,
            );
            continue;
          }
          const querySource = fs.readFileSync(queryPath, "utf8");
          let query;
          try {
            query = new Query(language, querySource);
          } catch (queryErr) {
            reportLanguageError(
              name,
              queryPath,
              `invalid highlight query: ${queryErr.message ?? queryErr}`,
            );
            continue;
          }
          const aliases = [name, ...(entry.aliases ?? [])];
          for (const alias of aliases) {
            loader.languagesByAlias.set(alias, {language, query});
          }
        } catch (err) {
          reportLanguageError(
            name,
            queryPath,
            `grammar WASM failed to load: ${err.message ?? err}`,
          );
        }
      }
    } finally {
      loader.initialised = true;
    }
  })();
  return loader.ready;
}

function extractText(node) {
  let buffer = "";
  (function walk(current) {
    if (current.type === "text") {
      buffer += current.value;
    } else if (Array.isArray(current.children)) {
      for (const child of current.children) walk(child);
    }
  })(node);
  return buffer;
}

function captureNameToClass(name) {
  // Capture names look like "function.method.builtin". Emit one class per
  // namespace segment so CSS can target the most specific level that has
  // a rule (e.g. `.tok-function` as fallback, `.tok-function-builtin` for
  // something more specific).
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const segments = safe.split(".");
  const classes = [];
  for (let i = 0; i < segments.length; i++) {
    classes.push(`tok-${segments.slice(0, i + 1).join("-")}`);
  }
  return classes;
}

function tokenize(source, rootNode, query) {
  const captures = query.captures(rootNode);
  const n = source.length;
  if (n === 0) return [];

  // Paint a label per character position. Captures are visited in
  // document order, and later (deeper) captures overwrite earlier ones.
  const labels = new Array(n).fill(null);
  for (const cap of captures) {
    const start = cap.node.startIndex;
    const end = cap.node.endIndex;
    for (let i = start; i < end; i++) {
      labels[i] = cap.name;
    }
  }

  // Fold consecutive same-label positions into spans.
  const spans = [];
  let cursor = 0;
  while (cursor < n) {
    const label = labels[cursor];
    let next = cursor + 1;
    while (next < n && labels[next] === label) next++;
    spans.push({label, text: source.slice(cursor, next)});
    cursor = next;
  }
  return spans;
}

function preferredLanguageTag(node) {
  // A Shiki transformer configured in astro.config.mjs stamps every
  // registered-language <pre> with `data-ts-lang="<original-tag>"`.
  // Prefer that: Shiki rewrites unrecognised `data-language` values to
  // "plaintext", so without the stamp the original fenced tag is lost.
  // Fall back to `data-language` and `language-*` classes for callers
  // that somehow reach us without the transformer (dev-time edge cases).
  const stamped = node.properties?.["data-ts-lang"] ?? node.properties?.dataTsLang;
  if (typeof stamped === "string") return stamped;
  const dataLang = node.properties?.dataLanguage;
  if (typeof dataLang === "string" && dataLang !== "plaintext") return dataLang;
  const code = node.children?.find(
    (child) => child.type === "element" && child.tagName === "code",
  );
  if (!code) return null;
  const classes = code.properties?.className ?? [];
  for (const cls of classes) {
    if (typeof cls === "string" && cls.startsWith("language-")) {
      return cls.slice("language-".length);
    }
  }
  return null;
}

export function treeSitterHighlight({manifestPath}) {
  return async function transformer(tree) {
    await loadGrammars(manifestPath);
    if (!loader.initialised || loader.languagesByAlias.size === 0) return;

    visit(tree, "element", (node) => {
      if (node.tagName !== "pre") return;
      const lang = preferredLanguageTag(node);
      if (!lang) return;
      const entry = loader.languagesByAlias.get(lang);
      if (!entry) return;

      const source = extractText(node);
      if (!source) return;

      let spans;
      try {
        const parser = new Parser();
        parser.setLanguage(entry.language);
        const parsed = parser.parse(source);
        spans = tokenize(source, parsed.rootNode, entry.query);
      } catch (err) {
        console.warn(
          `[tree-sitter-highlight] failed to tokenise ${lang} block: ${err.message ?? err}`,
        );
        return;
      }

      const codeChildren = spans.map((span) => {
        if (!span.label) {
          return {type: "text", value: span.text};
        }
        return {
          type: "element",
          tagName: "span",
          properties: {className: captureNameToClass(span.label)},
          children: [{type: "text", value: span.text}],
        };
      });

      node.children = [
        {
          type: "element",
          tagName: "code",
          properties: {
            className: [`language-${lang}`, "tree-sitter-code"],
          },
          children: codeChildren,
        },
      ];

      const classes = Array.isArray(node.properties?.className)
        ? [...node.properties.className]
        : [];
      if (!classes.includes("tree-sitter-pre")) {
        classes.push("tree-sitter-pre");
      }
      node.properties = {
        ...node.properties,
        className: classes,
        dataLanguage: lang,
      };

      return SKIP;
    });
  };
}
