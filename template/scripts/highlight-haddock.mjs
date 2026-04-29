#!/usr/bin/env node
/**
 * Tokenise Haddock-emitted code blocks (@…@ verbatim, >>> doctest
 * examples, > bird tracks) into the same .tok-* span vocabulary the
 * rehype plugin uses for markdown fences. Runs as `predev` and
 * `prebuild` npm hooks — by then the staging step has copied the
 * Haddock HTML into public/Haskell/<package>/haddock/, and `npm ci`
 * has installed web-tree-sitter, so we have everything we need.
 *
 * Gating:
 *   - Reads src/generated/grammars.json (the manifest the rehype
 *     plugin already consumes).
 *   - Looks for a registered Haskell grammar by primary name or
 *     alias ("haskell" / "hs"). When none is registered, exits
 *     silently — Haddock blocks render as plain text, exactly as
 *     before.
 *
 * Skip rules per <pre>:
 *   - Has a `class=` attr already (e.g. <pre class="haskell"> source
 *     listing — Haddock emits its own .hs-* token spans there).
 *   - Inner content contains a literal `<` (i.e. nested HTML elements
 *     such as <a> cross-reference links). We'd lose those links if we
 *     replaced the children, so leave the block untouched. Pure-text
 *     blocks — the common @…@ case — pass through.
 *
 * Failure policy: any error is logged and the file is left untouched.
 * The build never fails because of this pass.
 */

import fs from "node:fs/promises";
import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import {Parser, Language, Query} from "web-tree-sitter";

const require = createRequire(import.meta.url);

const HASKELL_ALIASES = new Set(["haskell", "hs"]);
const PUBLIC_HASKELL_REL = path.join("public", "Haskell");
const HADDOCK_DIR_NAME = "haddock";

const here = path.dirname(fileURLToPath(import.meta.url));
const templateRoot = path.resolve(here, "..");

async function main() {
  const manifestPath = path.join(templateRoot, "src", "generated", "grammars.json");
  if (!existsSync(manifestPath)) return;

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (err) {
    warn(`could not parse grammars manifest at ${manifestPath}: ${err.message ?? err}`);
    return;
  }

  const haskellEntry = findHaskellEntry(manifest);
  if (!haskellEntry) return;

  const queryPath = path.join(haskellEntry.queries, "highlights.scm");
  if (!existsSync(queryPath)) {
    warn(`Haskell grammar registered but no highlights.scm at ${queryPath}; Haddock blocks will not be tokenised`);
    return;
  }

  const haddockRoot = path.join(templateRoot, PUBLIC_HASKELL_REL);
  if (!existsSync(haddockRoot)) return;

  await Parser.init({
    locateFile(file) {
      if (file === "tree-sitter.wasm") {
        return require.resolve("web-tree-sitter/tree-sitter.wasm");
      }
      const main = require.resolve("web-tree-sitter");
      return path.join(path.dirname(main), file);
    },
  });

  let language;
  try {
    language = await Language.load(haskellEntry.parser);
  } catch (err) {
    warn(`failed to load Haskell grammar at ${haskellEntry.parser}: ${err.message ?? err}`);
    return;
  }

  let query;
  try {
    query = new Query(language, readFileSync(queryPath, "utf8"));
  } catch (err) {
    warn(`failed to compile highlights.scm at ${queryPath}: ${err.message ?? err}`);
    return;
  }

  const files = await collectHaddockHtmlFiles(haddockRoot);
  let rewrittenFiles = 0;
  let rewrittenBlocks = 0;
  for (const filePath of files) {
    const before = await fs.readFile(filePath, "utf8");
    const {after, blocks} = highlightHaddockHtml(before, language, query);
    if (blocks > 0 && after !== before) {
      await fs.writeFile(filePath, after, "utf8");
      rewrittenFiles += 1;
      rewrittenBlocks += blocks;
    }
  }
  if (rewrittenBlocks > 0) {
    process.stdout.write(
      `[highlight-haddock] tokenised ${rewrittenBlocks} block${rewrittenBlocks === 1 ? "" : "s"} across ${rewrittenFiles} file${rewrittenFiles === 1 ? "" : "s"}\n`,
    );
  }
}

function findHaskellEntry(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  for (const [name, entry] of Object.entries(manifest)) {
    if (!entry || typeof entry !== "object") continue;
    const aliases = [name, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
      .filter((value) => typeof value === "string")
      .map((value) => value.toLowerCase());
    if (aliases.some((alias) => HASKELL_ALIASES.has(alias))) {
      return entry;
    }
  }
  return null;
}

async function collectHaddockHtmlFiles(root) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(root, {withFileTypes: true});
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const haddockDir = path.join(root, entry.name, HADDOCK_DIR_NAME);
    if (existsSync(haddockDir)) {
      await walkHtml(haddockDir, out);
    }
  }
  return out;
}

async function walkHtml(dir, out) {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkHtml(full, out);
    } else if (entry.isFile() && full.endsWith(".html")) {
      out.push(full);
    }
  }
}

const PRE_BLOCK_RE = /<pre\b([^>]*)>([\s\S]*?)<\/pre>/g;

function highlightHaddockHtml(html, language, query) {
  let blocks = 0;
  const after = html.replace(PRE_BLOCK_RE, (match, attrs, inner) => {
    if (/\bclass\s*=/i.test(attrs)) return match;
    if (/</.test(inner)) return match;
    const text = decodeEntities(inner);
    if (!text.trim()) return match;
    let spans;
    try {
      const parser = new Parser();
      parser.setLanguage(language);
      const parsed = parser.parse(text);
      spans = tokenize(text, parsed.rootNode, query);
    } catch (err) {
      warn(`failed to tokenise a <pre> block: ${err.message ?? err}`);
      return match;
    }
    blocks += 1;
    const codeHtml = renderSpans(spans);
    const preAttrs = mergeClass(attrs, "tree-sitter-pre");
    return `<pre${preAttrs} data-language="haskell"><code class="language-haskell tree-sitter-code">${codeHtml}</code></pre>`;
  });
  return {after, blocks};
}

function tokenize(source, rootNode, query) {
  const captures = query.captures(rootNode);
  const n = source.length;
  if (n === 0) return [];
  const labels = new Array(n).fill(null);
  for (const cap of captures) {
    for (let i = cap.node.startIndex; i < cap.node.endIndex; i++) {
      labels[i] = cap.name;
    }
  }
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

function renderSpans(spans) {
  return spans
    .map((span) => {
      const text = escapeHtml(span.text);
      if (!span.label) return text;
      const classes = captureNameToClass(span.label).join(" ");
      return `<span class="${classes}">${text}</span>`;
    })
    .join("");
}

function captureNameToClass(name) {
  const safe = name.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const segments = safe.split(".");
  const classes = [];
  for (let i = 0; i < segments.length; i++) {
    classes.push(`tok-${segments.slice(0, i + 1).join("-")}`);
  }
  return classes;
}

function mergeClass(attrs, className) {
  // Inputs come from the <pre>'s attribute slice (e.g. `` or ` foo="bar"`).
  // We've already short-circuited above when an existing class= attr is
  // present, so this just appends a single class= attribute.
  const trimmed = (attrs ?? "").replace(/\s+$/, "");
  return `${trimmed ? trimmed + " " : " "}class="${className}"`;
}

function decodeEntities(value) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&amp;/g, "&");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function warn(message) {
  process.stderr.write(`[highlight-haddock] ${message}\n`);
}

main().catch((err) => {
  warn(err?.stack ?? String(err));
  process.exit(0);
});
