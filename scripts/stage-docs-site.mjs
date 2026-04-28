import fs from "node:fs/promises";
import path from "node:path";

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const RESERVED_CONFIG_NAMES = new Set(["config.yaml", "config.yml", "config.json"]);
const BUILTIN_THEMES = new Set(["cortex-dark", "cortex-light", "cortex-slate"]);
const GENERATED_THEORY_DIR = "Theory";

function usage() {
  console.error(
    "Usage: node stage-docs-site.mjs --content-dir <dir> --config-json <file> --template-files-json <file> --languages-json <file> [--lean4-rendered-dir <dir> --lean4-source-dir <dir>] [--typst-rendered-dir <dir>] --out-dir <dir>",
  );
  process.exit(1);
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, "/");
}

function normalizeRouteBase(routeBase) {
  if (routeBase == null || routeBase === "" || routeBase === "/") {
    return "/";
  }

  const normalized = routeBase.startsWith("/") ? routeBase : `/${routeBase}`;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function withRouteBase(routeBase, ...segments) {
  const base = normalizeRouteBase(routeBase);
  const suffix = segments
    .map((segment) => normalizeSlashes(String(segment)).replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  if (!suffix) {
    return base;
  }
  return base === "/" ? `/${suffix}` : `${base}/${suffix}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function yamlString(value) {
  return JSON.stringify(String(value));
}

function normalizeSlug(slug) {
  if (typeof slug !== "string" || slug.trim() === "") {
    throw new Error("Navigation slugs must be non-empty strings.");
  }

  const normalized = normalizeSlashes(slug.trim()).replace(/^\/+|\/+$/g, "");
  if (normalized === "") {
    return "index";
  }
  return normalized;
}

function normalizeLinkHref(href) {
  if (typeof href !== "string" || href.trim() === "") {
    throw new Error("Navigation link hrefs must be non-empty strings.");
  }
  return normalizeSlashes(href.trim()).replace(/^\/+|\/+$/g, "");
}

async function removeIfExists(targetPath) {
  await fs.rm(targetPath, { force: true, recursive: true });
}

function titleCase(value) {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => `${segment[0]?.toUpperCase() ?? ""}${segment.slice(1)}`)
    .join(" ");
}

function parseLean4Config(config, renderedDir, sourceDir) {
  if (!config.lean4) {
    return null;
  }
  if (typeof config.lean4 !== "object") {
    throw new Error("docsSite.lean4 must be an object when set.");
  }
  if (typeof config.lean4.theoryDir !== "string" || config.lean4.theoryDir.trim() === "") {
    throw new Error("docsSite.lean4.theoryDir must be a non-empty string when lean4 is set.");
  }
  if (!renderedDir) {
    throw new Error("Internal error: docsSite.lean4 is set, but no rendered Lean output was staged.");
  }
  if (!sourceDir) {
    throw new Error("Internal error: docsSite.lean4 is set, but no Lean source directory was staged.");
  }

  return {
    renderedDir,
    sourceDir,
    theoryDir: config.lean4.theoryDir.trim(),
  };
}

function theoryLinkFromRenderedIndex(relativePath) {
  if (relativePath === "index.html") {
    return {href: GENERATED_THEORY_DIR, label: "Module Index"};
  }
  if (!relativePath.endsWith("/index.html")) {
    return null;
  }

  const directory = relativePath.slice(0, -"/index.html".length);
  if (directory === "" || directory.startsWith("-verso-")) {
    return null;
  }

  return {
    href: `${GENERATED_THEORY_DIR}/${directory}`,
    label: directory.replace(/\//g, "."),
  };
}

function decodeBasicHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function extractHtmlTitle(html, fallback) {
  const match = html.match(/<title>([\s\S]*?)<\/title>/i);
  return match ? decodeBasicHtml(match[1].trim()) : fallback;
}

function rewriteVersoHref(rawHref, assetBaseHref) {
  const href = decodeBasicHtml(rawHref).trim();
  if (
    href === "" ||
    href.startsWith("#") ||
    href.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(href)
  ) {
    return rawHref;
  }

  const normalized = href.replace(/^\.\//, "").replace(/^\/+/, "");
  return escapeHtml(`${assetBaseHref}/${normalized}`);
}

function rewriteVersoDataLinks(rawValue, assetBaseHref) {
  try {
    const links = JSON.parse(decodeBasicHtml(rawValue));
    if (!Array.isArray(links)) {
      return rawValue;
    }
    return escapeHtml(JSON.stringify(
      links.map((link) => {
        if (!link || typeof link !== "object" || typeof link.href !== "string") {
          return link;
        }
        return {...link, href: decodeBasicHtml(rewriteVersoHref(link.href, assetBaseHref))};
      }),
    ));
  } catch {
    return rawValue;
  }
}

function rewriteVersoLinks(html, assetBaseHref) {
  return html
    .replace(/\bhref="([^"]*)"/g, (_match, href) => `href="${rewriteVersoHref(href, assetBaseHref)}"`)
    .replace(
      /\bdata-verso-links="([^"]*)"/g,
      (_match, links) => `data-verso-links="${rewriteVersoDataLinks(links, assetBaseHref)}"`,
    );
}

function extractFirstStyle(html) {
  const match = html.match(/<style>\s*([\s\S]*?)<\/style>/i);
  return match ? match[1].trim() : "";
}

function extractVersoInitScript(html, assetBaseHref) {
  const match = html.match(/<script>\s*([\s\S]*?window\.onload[\s\S]*?)<\/script>/i);
  if (!match) {
    return "";
  }

  let script = match[1].trim();
  script = script.replace(
    /^window\.onload\s*=\s*\(\)\s*=>\s*\{/,
    'window.addEventListener("load", () => {',
  );
  script = script.replace(/\n\}\s*$/, "\n});");
  script = script.replace(
    /let docsJson = "-verso-docs\.json";/,
    `let docsJson = ${JSON.stringify(`${assetBaseHref}/-verso-docs.json`)};`,
  );
  return script;
}

function extractLeanContentFragment(html) {
  const match = html.match(/<section class="code-content"[\s\S]*?<\/section>/i);
  if (!match) {
    throw new Error("Verso module HTML did not contain a code-content section.");
  }
  return match[0];
}

function normalizeMalformedVersoLists(html) {
  return html.replace(/<(ul|ol)(\b[^>]*)>([\s\S]*?)<\/\1>/gi, (match, tagName, attributes, body) => {
    if (/<li\b/i.test(body)) {
      return match;
    }

    let changed = false;
    const normalizedBody = body.replace(/<p>\s*([\s\S]*?)\s*<\/p>/gi, (_paragraph, content) => {
      const trimmed = content.trim();
      if (trimmed === "") {
        return _paragraph;
      }
      changed = true;
      return `<li>\n${trimmed}\n</li>`;
    });

    return changed ? `<${tagName}${attributes}>${normalizedBody}</${tagName}>` : match;
  });
}

function splitPipeTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) {
    trimmed = trimmed.slice(1);
  }
  if (trimmed.endsWith("|")) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed.split("|").map((cell) => cell.trim());
}

function isPipeTableDelimiter(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function renderHtmlTable(headers, rows) {
  const headerHtml = headers.map((cell) => `<th scope="col">${cell}</th>`).join("");
  const bodyHtml = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
    .join("\n");

  return [
    "<table>",
    "<thead>",
    `<tr>${headerHtml}</tr>`,
    "</thead>",
    "<tbody>",
    bodyHtml,
    "</tbody>",
    "</table>",
  ].join("\n");
}

function normalizeVersoPipeTableParagraph(body) {
  const lines = body
    .trim()
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3 || !lines.every((line) => line.startsWith("|") && line.endsWith("|"))) {
    return null;
  }

  const headers = splitPipeTableRow(lines[0]);
  const delimiter = splitPipeTableRow(lines[1]);
  if (headers.length === 0 || delimiter.length !== headers.length || !isPipeTableDelimiter(delimiter)) {
    return null;
  }

  const rows = lines.slice(2).map(splitPipeTableRow);
  if (rows.some((row) => row.length !== headers.length)) {
    return null;
  }

  return renderHtmlTable(headers, rows);
}

function normalizeMalformedVersoTables(html) {
  return html.replace(/<p>\s*([\s\S]*?)\s*<\/p>/gi, (match, body) => {
    const table = normalizeVersoPipeTableParagraph(body);
    return table ?? match;
  });
}

function normalizeVersoMarkdownHtml(html) {
  // Verso 4.29 parses CommonMark lists as <ul>/<ol> with bare <p>
  // children, and leaves GFM pipe tables as literal paragraph text.
  // Normalize those two shapes before repo-docs embeds the fragment.
  return normalizeMalformedVersoTables(normalizeMalformedVersoLists(html));
}

function moduleRelativeLeanPath(relativeHtmlPath) {
  return relativeHtmlPath.replace(/\/index\.html$/i, ".lean");
}

async function readLeanModuleSource(sourceDir, relativeHtmlPath) {
  const leanPath = path.join(sourceDir, moduleRelativeLeanPath(relativeHtmlPath));
  try {
    return await fs.readFile(leanPath, "utf8");
  } catch {
    return null;
  }
}

function classifyLeanModuleTags(source) {
  if (!source) {
    return ["lean"];
  }
  const code = source
    .replace(/\/-[\s\S]*?-\//g, "")
    .replace(/--.*$/gm, "");
  const hasProofDeclaration = /(^|\n)\s*(?:@\[[\s\S]*?\]\s*)*(?:private\s+|protected\s+|noncomputable\s+|unsafe\s+)*(?:theorem|lemma|example)\b/.test(code);
  return hasProofDeclaration ? ["proofs"] : ["lean"];
}

function nativeVersoOverrideStyle() {
  // Bridge Verso's `--verso-*` custom-property contract to the
  // repo-docs palette. The structural styling (cards, hovers, tippy
  // popovers) lives in global.css; this only re-points Verso's own
  // design tokens at our theme variables.
  return `
.repo-docs-lean-page {
  --verso-code-font-family: var(--font-mono);
  --verso-text-font-family: var(--font-sans);
  --verso-structure-font-family: var(--font-sans);
  --verso-code-color: var(--tok-default);
  --verso-code-keyword-color: var(--tok-keyword);
  --verso-code-const-color: var(--tok-constant);
  --verso-code-var-color: var(--tok-variable);
  --verso-warning-color: color-mix(in srgb, var(--status-draft) 18%, transparent);
  --verso-error-color: var(--status-deprecated);
  --verso-warning-indicator-color: var(--status-draft);
  --verso-error-indicator-color: var(--status-deprecated);
  --verso-info-indicator-color: var(--brand-primary);
}
`.trim();
}

function renderProofInspectorScript() {
  return `<script>
(() => {
  const script = document.currentScript;
  const page = script?.closest("[data-repo-docs-lean-page]");
  if (!page) return;

  const panel = page.querySelector("[data-lean-proof-panel]");
  const title = page.querySelector("[data-lean-proof-title]");
  const body = page.querySelector("[data-lean-proof-body]");
  if (!panel || !title || !body) return;

  function directChild(element, predicate) {
    for (const child of element.children) {
      if (predicate(child)) return child;
    }
    return null;
  }

  function cloneState(state) {
    const clone = state.cloneNode(true);
    clone.style.display = "block";
    clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    clone.querySelectorAll("[for]").forEach((node) => node.removeAttribute("for"));
    return clone;
  }

  let active = null;
  function showState(tactic) {
    const label = directChild(tactic, (child) => child.tagName === "LABEL");
    const state = directChild(tactic, (child) => child.classList.contains("tactic-state"));
    if (!label || !state) return;

    active?.classList.remove("is-active");
    active = tactic;
    active.classList.add("is-active");

    const labelText = label.textContent.replace(/\\s+/g, " ").trim();
    title.textContent = labelText ? labelText.slice(0, 96) : "Proof state";
    body.replaceChildren(cloneState(state));
  }

  const tactics = Array.from(page.querySelectorAll(".hl.lean .tactic"))
    .filter((tactic) => directChild(tactic, (child) => child.classList.contains("tactic-state")));
  if (tactics.length === 0) {
    panel.hidden = true;
    return;
  }

  for (const tactic of tactics) {
    const label = directChild(tactic, (child) => child.tagName === "LABEL");
    if (!label) continue;
    label.tabIndex = 0;
    label.addEventListener("mouseenter", () => showState(tactic));
    label.addEventListener("focus", () => showState(tactic));
    label.addEventListener("click", () => showState(tactic));
  }

  showState(tactics[0]);
})();
</script>`;
}

function renderVersoSetup(html, assetBaseHref) {
  const style = extractFirstStyle(html);
  const script = extractVersoInitScript(html, assetBaseHref);
  return [
    `<link rel="stylesheet" href="${escapeHtml(`${assetBaseHref}/tippy-border.css`)}" />`,
    style ? `<style>\n${style}\n</style>` : "",
    `<style>\n${nativeVersoOverrideStyle()}\n</style>`,
    `<script src="${escapeHtml(`${assetBaseHref}/popper.js`)}"></script>`,
    `<script src="${escapeHtml(`${assetBaseHref}/tippy.js`)}"></script>`,
    `<script src="${escapeHtml(`${assetBaseHref}/marked.js`)}"></script>`,
    script ? `<script>\n${script}\n</script>` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderTheoryIndexMarkdown(moduleLinks) {
  // Minimal landing page: the title from frontmatter is enough
  // chrome, the body is just the module list. No tooling-speak
  // description, no auto-generated intro paragraph — the modules
  // are the content; meta-commentary about how they were built
  // belongs in the project README, not on the page itself.
  // Authors who want a richer landing page can drop their own
  // `Theory/index.md` in the content tree (see callsite below).
  const items = moduleLinks
    .map((link) => `- [${link.label}](${link.href.replace(`${GENERATED_THEORY_DIR}/`, "")}/)`)
    .join("\n");
  return [
    "---",
    `title: ${yamlString("Theory")}`,
    `kind: ${yamlString("lean-theory")}`,
    "sidebar:",
    `  label: ${yamlString("Module Index")}`,
    "---",
    "",
    items,
    "",
  ].join("\n");
}

function renderTheoryModuleMarkdown({title, label, fragmentPath, tags}) {
  return [
    "---",
    `title: ${yamlString(title)}`,
    `kind: ${yamlString("lean-theory")}`,
    "tags:",
    ...tags.map((tag) => `  - ${yamlString(tag)}`),
    "sidebar:",
    `  label: ${yamlString(label)}`,
    "verso:",
    `  fragment: ${yamlString(fragmentPath)}`,
    "---",
    "",
  ].join("\n");
}

function assertSafeRelativePath(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  const normalized = normalizeSlashes(value.trim()).replace(/^\/+|\/+$/g, "");
  if (normalized === "" || normalized.split("/").some((segment) => segment === "..")) {
    throw new Error(`${label} must be a relative path without '..'.`);
  }
  return normalized;
}

async function ensureTypstRouteAvailable(contentRoot, route) {
  const basePath = path.join(contentRoot, route);
  for (const extension of MARKDOWN_EXTENSIONS) {
    for (const candidate of [`${basePath}${extension}`, path.join(basePath, `index${extension}`)]) {
      try {
        const stat = await fs.stat(candidate);
        if (stat.isFile()) {
          throw new Error(`Generated Typst manuscript route "${route}" would overwrite existing docs page "${normalizeSlashes(path.relative(contentRoot, candidate))}".`);
        }
      } catch (error) {
        if (error?.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}

function renderTypstManuscriptMarkdown({title, description, pdfPath, sidebar}) {
  const lines = [
    "---",
    `title: ${yamlString(title)}`,
  ];
  if (description) {
    lines.push(`description: ${yamlString(description)}`);
  }
  lines.push(
    `kind: ${yamlString("typst-manuscript")}`,
    "sidebar:",
    `  label: ${yamlString(sidebar.label ?? "Manuscript")}`,
  );
  if (typeof sidebar.order === "number") {
    lines.push(`  order: ${sidebar.order}`);
  }
  lines.push(
    "typst:",
    `  pdf: ${yamlString(pdfPath)}`,
    "---",
    "",
  );
  return lines.join("\n");
}

async function generateTypstManuscripts(contentRoot, publicRoot, typstRenderedDir) {
  if (!typstRenderedDir) {
    return [];
  }

  const manifestPath = path.join(typstRenderedDir, "manuscripts.json");
  let manuscripts;
  try {
    manuscripts = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read rendered Typst manifest: ${error.message}`);
  }
  if (!Array.isArray(manuscripts)) {
    throw new Error("Rendered Typst manifest must be a JSON array.");
  }

  const generated = [];
  for (const manuscript of manuscripts) {
    if (!manuscript || typeof manuscript !== "object") {
      throw new Error("Rendered Typst manifest entries must be objects.");
    }
    const key = typeof manuscript.key === "string" && manuscript.key.trim() !== ""
      ? manuscript.key.trim()
      : "manuscript";
    const route = assertSafeRelativePath(manuscript.route, `Typst manuscript "${key}" route`);
    const asset = assertSafeRelativePath(manuscript.asset, `Typst manuscript "${key}" asset`);
    const title = typeof manuscript.title === "string" && manuscript.title.trim() !== ""
      ? manuscript.title.trim()
      : key;
    const description = typeof manuscript.description === "string" && manuscript.description.trim() !== ""
      ? manuscript.description.trim()
      : null;
    const sidebar = manuscript.sidebar && typeof manuscript.sidebar === "object"
      ? manuscript.sidebar
      : {};
    if (sidebar.order != null && typeof sidebar.order !== "number") {
      throw new Error(`Typst manuscript "${key}" sidebar.order must be a number when set.`);
    }

    await ensureTypstRouteAvailable(contentRoot, route);

    const pdfPath = `${route}.pdf`;
    const sourcePdf = path.join(typstRenderedDir, "assets", asset);
    const targetPdf = path.join(publicRoot, pdfPath);
    await fs.mkdir(path.dirname(targetPdf), {recursive: true});
    await fs.copyFile(sourcePdf, targetPdf);
    await fs.chmod(targetPdf, 0o644);

    const targetMarkdown = path.join(contentRoot, `${route}.md`);
    await fs.mkdir(path.dirname(targetMarkdown), {recursive: true});
    await fs.writeFile(
      targetMarkdown,
      renderTypstManuscriptMarkdown({title, description, pdfPath, sidebar}),
      "utf8",
    );
    generated.push(`${route}.md`);
  }

  return generated;
}

function renderLeanMathScript() {
  // Verso emits docstring/module-doc text verbatim — `$x$` and `$$…$$`
  // pass through as raw characters because Verso has no KaTeX pass.
  // We load KaTeX's auto-render on the client and run it across the
  // lean page's text containers (module docs, declaration docstrings,
  // and tippy-injected hover bodies). The stylesheet is already
  // loaded by DocsLayout for the Markdown pipeline; only the JS
  // pieces are added here, and only on lean pages.
  return `<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/katex.min.js" crossorigin="anonymous"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.22/dist/contrib/auto-render.min.js" crossorigin="anonymous" onload="(function(){
  var page = document.querySelector('[data-repo-docs-lean-page]');
  if (!page || !window.renderMathInElement) return;
  var opts = {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '\\\\[', right: '\\\\]', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\\\(', right: '\\\\)', display: false }
    ],
    throwOnError: false,
    ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre']
  };
  function render(root) {
    if (!root) return;
    try { window.renderMathInElement(root, opts); } catch (err) { console.warn('[lean-math]', err); }
  }
  page.querySelectorAll('.md-text, .verso-text').forEach(render);
  // Tippy hover popups are injected into <body> on demand. Watch for
  // them and re-render once their hover-info / docstring content is in
  // so math inside docstrings shows up on hover.
  var seen = new WeakSet();
  new MutationObserver(function(records){
    records.forEach(function(r){
      r.addedNodes && r.addedNodes.forEach(function(node){
        if (!(node instanceof HTMLElement)) return;
        if (node.classList && node.classList.contains('tippy-box') && !seen.has(node)) {
          seen.add(node);
          render(node);
        }
      });
    });
  }).observe(document.body, { childList: true, subtree: true });
})();"></script>`;
}

function renderTheoryFragmentHtml({setup, fragment, assetBaseHref}) {
  return [
    `<div class="repo-docs-lean-page not-prose" data-repo-docs-lean-page>`,
    setup,
    `<div class="repo-docs-lean-workspace">`,
    fragment,
    `<aside class="repo-docs-proof-state-panel" data-lean-proof-panel aria-live="polite">`,
    `<div class="repo-docs-proof-state-header">`,
    `<span class="repo-docs-proof-state-eyebrow">Proof State</span>`,
    `<strong data-lean-proof-title>Hover a tactic</strong>`,
    `</div>`,
    `<div class="repo-docs-proof-state-body" data-lean-proof-body>Hover or focus a tactic to inspect its goals.</div>`,
    `</aside>`,
    `</div>`,
    renderProofInspectorScript(),
    `<script src="${escapeHtml(`${assetBaseHref}/copy-button.js`)}"></script>`,
    renderLeanMathScript(),
    "</div>",
    "",
  ].join("\n");
}

async function copyVersoAssets(renderedDir, outputRoot, assetBaseHref) {
  await removeIfExists(outputRoot);
  await fs.mkdir(outputRoot, {recursive: true});

  const files = await listFiles(renderedDir);
  for (const absolutePath of files) {
    const relativePath = normalizeSlashes(path.relative(renderedDir, absolutePath));
    if (path.extname(relativePath) === ".html") {
      continue;
    }
    const targetPath = path.join(outputRoot, relativePath);
    await fs.mkdir(path.dirname(targetPath), {recursive: true});
    if (relativePath === "-verso-docs.json") {
      const docs = JSON.parse(await fs.readFile(absolutePath, "utf8"));
      const rewritten = Object.fromEntries(
        Object.entries(docs).map(([key, value]) => [
          key,
          typeof value === "string" ? rewriteVersoLinks(normalizeVersoMarkdownHtml(value), assetBaseHref) : value,
        ]),
      );
      await fs.writeFile(targetPath, JSON.stringify(rewritten), "utf8");
    } else {
      await fs.copyFile(absolutePath, targetPath);
    }
    await fs.chmod(targetPath, 0o644);
  }
}

async function generateLean4Docs(contentRoot, publicRoot, generatedRoot, lean4, config) {
  if (!lean4) {
    return null;
  }

  let stat;
  try {
    stat = await fs.stat(lean4.renderedDir);
  } catch {
    throw new Error(`Missing rendered Lean theory output for "${lean4.theoryDir}".`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`Rendered Lean theory output for "${lean4.theoryDir}" is not a directory.`);
  }

  const contentTheoryRoot = path.join(contentRoot, GENERATED_THEORY_DIR);
  try {
    await fs.stat(contentTheoryRoot);
    throw new Error(
      `Generated Lean theory docs would overwrite existing docs path "${GENERATED_THEORY_DIR}".`,
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const publicTheoryRoot = path.join(publicRoot, GENERATED_THEORY_DIR);
  const assetBaseHref = withRouteBase(config.site.routeBase, GENERATED_THEORY_DIR).replace(/\/$/, "");
  await copyVersoAssets(lean4.renderedDir, publicTheoryRoot, assetBaseHref);

  try {
    const landing = await fs.stat(path.join(lean4.renderedDir, "index.html"));
    if (!landing.isFile()) {
      throw new Error();
    }
  } catch {
    throw new Error(`Verso did not render a Theory landing page for "${lean4.theoryDir}".`);
  }

  const htmlFiles = (await listFiles(lean4.renderedDir))
    .map((absolutePath) => normalizeSlashes(path.relative(lean4.renderedDir, absolutePath)))
    .filter((relativePath) => path.extname(relativePath) === ".html")
    .sort(comparePaths);

  const links = htmlFiles
    .map(theoryLinkFromRenderedIndex)
    .filter((link) => link !== null)
    .sort((left, right) => comparePaths(left.href, right.href));
  const moduleLinks = links.filter((link) => link.href !== GENERATED_THEORY_DIR);

  await fs.mkdir(contentTheoryRoot, {recursive: true});
  const fragmentRoot = path.join(generatedRoot, "lean-theory");
  await removeIfExists(fragmentRoot);
  await fs.mkdir(fragmentRoot, {recursive: true});

  // Theory landing page: only generate one if the consumer hasn't
  // authored their own. Authors who want to write a real
  // introduction (project framing, mathematical context, reading
  // order, links to companion papers) drop a `Theory/index.md`
  // into their content tree and the staging script keeps it; the
  // generated stub is a fallback, not a default that shadows
  // authored content.
  const theoryIndexPath = path.join(contentTheoryRoot, "index.md");
  let theoryIndexExists = false;
  try {
    await fs.access(theoryIndexPath);
    theoryIndexExists = true;
  } catch {
    /* not present — emit the generated stub below */
  }
  if (!theoryIndexExists) {
    await fs.writeFile(
      theoryIndexPath,
      renderTheoryIndexMarkdown(moduleLinks),
      "utf8",
    );
  }

  for (const relativePath of htmlFiles) {
    if (relativePath === "index.html" || !relativePath.endsWith("/index.html")) {
      continue;
    }

    const htmlPath = path.join(lean4.renderedDir, relativePath);
    const html = await fs.readFile(htmlPath, "utf8");
    const title = extractHtmlTitle(html, relativePath.slice(0, -"/index.html".length).replace(/\//g, "."));
    const link = theoryLinkFromRenderedIndex(relativePath);
    const source = await readLeanModuleSource(lean4.sourceDir, relativePath);
    const contentFragment = extractLeanContentFragment(html);
    const tags = classifyLeanModuleTags(source);
    const fragment = rewriteVersoLinks(normalizeVersoMarkdownHtml(contentFragment), assetBaseHref);
    const setup = renderVersoSetup(html, assetBaseHref);
    const fragmentPath = `lean-theory/${GENERATED_THEORY_DIR}/${relativePath.replace(/\/index\.html$/i, ".html")}`;
    const fragmentTargetPath = path.join(generatedRoot, fragmentPath);
    const targetPath = path.join(
      contentRoot,
      `${GENERATED_THEORY_DIR}/${relativePath.replace(/\/index\.html$/i, ".md")}`,
    );

    await fs.mkdir(path.dirname(fragmentTargetPath), {recursive: true});
    await fs.writeFile(
      fragmentTargetPath,
      renderTheoryFragmentHtml({setup, fragment, assetBaseHref}),
      "utf8",
    );

    await fs.mkdir(path.dirname(targetPath), {recursive: true});
    await fs.writeFile(
      targetPath,
      renderTheoryModuleMarkdown({
        title,
        label: link?.label ?? title,
        fragmentPath,
        tags,
      }),
      "utf8",
    );
  }

  return {
    label: "Theory",
    entries: links.map((link) => link.href),
  };
}

function isPathExcluded(relativePath, excludedPaths) {
  const normalized = normalizeSlashes(relativePath).replace(/^\/+|\/+$/g, "");
  return excludedPaths.some((excludedPath) => {
    const prefix = normalizeSlashes(excludedPath).replace(/^\/+|\/+$/g, "");
    return (
      normalized === prefix ||
      normalized.startsWith(`${prefix}/`) ||
      normalized.startsWith(`${prefix}.`)
    );
  });
}

async function applyTemplateOverrides(outDir, templateFiles) {
  for (const [relativePath, sourcePath] of Object.entries(templateFiles)) {
    const targetPath = path.join(outDir, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
    await fs.chmod(targetPath, 0o644);
  }
}

async function writeRoutePage(outDir) {
  const pagesRoot = path.join(outDir, "src", "pages");
  const routeFile = path.join(pagesRoot, "[...slug].astro");
  const routeSource = [
    "---",
    `import DocsPage from "../components/DocsPage.astro";`,
    `import {getDocStaticPaths} from "../lib/docs-routes";`,
    "",
    "export const getStaticPaths = getDocStaticPaths;",
    "const props = Astro.props;",
    "---",
    "",
    "<DocsPage {...props} />",
    "",
  ].join("\n");

  await fs.writeFile(routeFile, routeSource, "utf8");
}

async function copyDirectory(sourceDir, destinationDir) {
  await fs.mkdir(path.dirname(destinationDir), { recursive: true });
  await fs.cp(sourceDir, destinationDir, { recursive: true });
}

async function makeWritableRecursive(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  await fs.chmod(rootDir, 0o755);

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await makeWritableRecursive(absolutePath);
      continue;
    }

    await fs.chmod(absolutePath, 0o644);
  }
}

async function listFiles(rootDir) {
  const discovered = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      discovered.push(absolutePath);
    }
  }

  await walk(rootDir);
  return discovered;
}

async function ensureMarkdownFile(contentDir, slug) {
  const basePath = path.join(contentDir, slug);
  const candidates = [];
  for (const extension of MARKDOWN_EXTENSIONS) {
    candidates.push(`${basePath}${extension}`);
    candidates.push(path.join(basePath, `index${extension}`));
  }

  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return normalizeSlashes(path.relative(contentDir, candidate));
      }
    } catch {
      // Continue searching through supported shapes.
    }
  }

  throw new Error(`Missing markdown file for navigation entry "${slug}".`);
}

async function collectMarkdownUnder(contentDir, directory) {
  const root = path.join(contentDir, directory);
  let stat;
  try {
    stat = await fs.stat(root);
  } catch {
    throw new Error(`Missing navigation directory "${directory}".`);
  }

  if (!stat.isDirectory()) {
    throw new Error(`Navigation directory "${directory}" is not a directory.`);
  }

  const files = await listFiles(root);
  return files
    .map((absolutePath) => normalizeSlashes(path.relative(contentDir, absolutePath)))
    .filter((relativePath) => MARKDOWN_EXTENSIONS.has(path.extname(relativePath)));
}

function comparePaths(left, right) {
  if (left === "index") {
    return -1;
  }
  if (right === "index") {
    return 1;
  }
  return left.localeCompare(right);
}

function normalizeSectionLabel(rawLabel, fallback) {
  if (rawLabel === null) {
    return null;
  }
  if (typeof rawLabel !== "string") {
    return fallback;
  }
  const trimmed = rawLabel.trim();
  return trimmed === "" ? null : trimmed;
}

function autoGenerateNavigation(markdownFiles, navigationConfig) {
  const rootEntries = [];
  const topLevelDirectories = new Set();

  for (const relativePath of markdownFiles) {
    const normalized = normalizeSlashes(relativePath).replace(/\.(md|mdx)$/i, "");
    const pageKey = normalized === "index" ? "index" : normalized.replace(/\/index$/i, "");
    const segments = pageKey.split("/");
    // Distinguish three cases:
    //   - the docs-root index.md       → pageKey "index"        → root entry
    //   - a top-level page like glossary.md → pageKey "glossary" → root entry
    //   - a directory landing like adrs/index.md → pageKey "adrs"
    //                                           → treat parent as section
    // The third case looks like a single-segment key but originated from
    // an /index path; without this distinction the staging script would
    // push "adrs" as a root entry and then fail to find adrs.md.
    const isRootIndex = pageKey === "index";
    const isDirectoryIndex =
      !isRootIndex && /\/index$/i.test(normalized);

    if (isRootIndex) {
      rootEntries.push("index");
      continue;
    }
    if (segments.length === 1 && !isDirectoryIndex) {
      rootEntries.push(pageKey);
      continue;
    }
    topLevelDirectories.add(segments[0]);
  }

  const sections = [];

  if (rootEntries.length > 0) {
    sections.push({
      entries: rootEntries.sort(comparePaths),
      label: normalizeSectionLabel(navigationConfig.rootSectionLabel, "Overview"),
    });
  }

  // Pick the directory order: caller-supplied list (strict) when set,
  // otherwise alphabetical. The strict list must be a permutation of
  // the actual top-level directories — any mismatch surfaces as a
  // hard build error so silent omissions can't sneak through.
  const orderedDirectories = resolveTopLevelOrder(
    topLevelDirectories,
    navigationConfig.topLevelOrder,
  );

  for (const directory of orderedDirectories) {
    sections.push({
      dir: directory,
      label: navigationConfig.sectionLabels?.[directory] ?? titleCase(directory),
    });
  }

  return sections;
}

function resolveTopLevelOrder(actualDirectories, requestedOrder) {
  if (!Array.isArray(requestedOrder)) {
    return [...actualDirectories].sort();
  }

  const requested = requestedOrder.map((name) => String(name).trim()).filter(Boolean);
  const requestedSet = new Set(requested);
  if (requested.length !== requestedSet.size) {
    const seen = new Set();
    const dups = requested.filter((name) =>
      seen.has(name) ? true : (seen.add(name), false),
    );
    throw new Error(
      `navigation.topLevelOrder contains duplicates: ${[...new Set(dups)].join(", ")}.`,
    );
  }

  const actual = new Set(actualDirectories);
  const unknown = requested.filter((name) => !actual.has(name));
  const missing = [...actual].filter((name) => !requestedSet.has(name)).sort();

  if (unknown.length > 0 || missing.length > 0) {
    const lines = ["navigation.topLevelOrder must list every top-level docs folder exactly once."];
    if (unknown.length > 0) {
      lines.push(`  Unknown name(s) (no matching folder): ${unknown.join(", ")}`);
    }
    if (missing.length > 0) {
      lines.push(`  Missing folder(s) (present in tree, absent from list): ${missing.join(", ")}`);
    }
    lines.push(`  Found folders: ${[...actual].sort().join(", ") || "(none)"}`);
    throw new Error(lines.join("\n"));
  }

  return requested;
}

async function removePrivateMarkdown(contentRoot, allowedMarkdown) {
  const allFiles = await listFiles(contentRoot);
  for (const absolutePath of allFiles) {
    const relativePath = normalizeSlashes(path.relative(contentRoot, absolutePath));
    if (!MARKDOWN_EXTENSIONS.has(path.extname(relativePath))) {
      continue;
    }
    if (allowedMarkdown.has(relativePath)) {
      continue;
    }
    await fs.rm(absolutePath, { force: true });
  }
}

async function pruneEmptyDirectories(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const directoryPath = path.join(rootDir, entry.name);
    await pruneEmptyDirectories(directoryPath);

    const remaining = await fs.readdir(directoryPath);
    if (remaining.length === 0) {
      await fs.rmdir(directoryPath);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const values = new Map();

  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (value == null) {
      usage();
    }
    values.set(flag, value);
  }

  const contentDir = values.get("--content-dir");
  const configJson = values.get("--config-json");
  const templateFilesJson = values.get("--template-files-json");
  const languagesJson = values.get("--languages-json");
  const lean4RenderedDir = values.get("--lean4-rendered-dir") ?? null;
  const lean4SourceDir = values.get("--lean4-source-dir") ?? null;
  const typstRenderedDir = values.get("--typst-rendered-dir") ?? null;
  const outDir = values.get("--out-dir");

  if (!contentDir || !configJson || !templateFilesJson || !outDir) {
    usage();
  }

  const contentRoot = path.join(outDir, "src", "content", "docs");
  const generatedRoot = path.join(outDir, "src", "generated");
  const publicRoot = path.join(outDir, "public");
  const config = JSON.parse(await fs.readFile(configJson, "utf8"));
  const templateFiles = JSON.parse(await fs.readFile(templateFilesJson, "utf8"));
  const languages = languagesJson
    ? JSON.parse(await fs.readFile(languagesJson, "utf8"))
    : {};
  const lean4 = parseLean4Config(config, lean4RenderedDir, lean4SourceDir);

  if (!config?.site?.title || !config?.site?.publicBaseUrl) {
    throw new Error("Config must define site.title and site.publicBaseUrl.");
  }

  config.site.routeBase = normalizeRouteBase(config.site.routeBase ?? "/");
  config.site.tagline = config.site.tagline ?? "Documentation";
  config.site.description = config.site.description ?? "Documentation site";
  config.content = config.content ?? {};
  config.content.excludePaths = Array.isArray(config.content.excludePaths)
    ? config.content.excludePaths
    : [];
  config.navigation = config.navigation ?? {};

  await copyDirectory(contentDir, contentRoot);
  await makeWritableRecursive(contentRoot);

  for (const reservedName of RESERVED_CONFIG_NAMES) {
    await removeIfExists(path.join(contentRoot, reservedName));
  }

  const allFiles = await listFiles(contentRoot);
  for (const absolutePath of allFiles) {
    const relativePath = normalizeSlashes(path.relative(contentRoot, absolutePath));
    if (!isPathExcluded(relativePath, config.content.excludePaths)) {
      continue;
    }
    await fs.rm(absolutePath, { force: true, recursive: true });
  }

  await pruneEmptyDirectories(contentRoot);

  await generateTypstManuscripts(contentRoot, publicRoot, typstRenderedDir);

  const authoredMarkdown = (await listFiles(contentRoot))
    .map((absolutePath) => normalizeSlashes(path.relative(contentRoot, absolutePath)))
    .filter((relativePath) => MARKDOWN_EXTENSIONS.has(path.extname(relativePath)));

  if (authoredMarkdown.length === 0) {
    throw new Error("No markdown files found under the configured docs tree.");
  }

  const generatedTheorySection = await generateLean4Docs(contentRoot, publicRoot, generatedRoot, lean4, config);

  const navigationSections =
    Array.isArray(config.navigation.sections) && config.navigation.sections.length > 0
      ? config.navigation.sections
      : autoGenerateNavigation(authoredMarkdown, config.navigation);

  if (generatedTheorySection) {
    const hasTheorySection = navigationSections.some(
      (section) =>
        (typeof section?.dir === "string" && normalizeSlug(section.dir) === GENERATED_THEORY_DIR) ||
        (Array.isArray(section?.entries) &&
          section.entries.some((entry) => normalizeSlug(entry) === GENERATED_THEORY_DIR)) ||
        (Array.isArray(section?.links) &&
          section.links.some((link) => normalizeLinkHref(link?.href) === GENERATED_THEORY_DIR)),
    );
    if (!hasTheorySection) {
      navigationSections.push(generatedTheorySection);
    }
  }

  if (navigationSections.length === 0) {
    throw new Error("Could not derive any navigation sections from the docs tree.");
  }

  const allowedMarkdown = new Set();

  for (const section of navigationSections) {
    if (!section) {
      throw new Error("Navigation sections must be objects.");
    }
    if (
      section.label !== null &&
      (typeof section.label !== "string" || section.label.trim() === "")
    ) {
      throw new Error(
        "Navigation section labels must be a non-empty string or null.",
      );
    }
    // Normalise empty-string to null so downstream consumers see one shape.
    if (typeof section.label === "string" && section.label.trim() === "") {
      section.label = null;
    }

    const hasEntries = Array.isArray(section.entries);
    const hasDir = typeof section.dir === "string" && section.dir.trim() !== "";
    const hasLinks = Array.isArray(section.links);

    if ([hasEntries, hasDir, hasLinks].filter(Boolean).length !== 1) {
      throw new Error(
        `Navigation section "${section.label ?? "(root)"}" must define exactly one of "entries", "dir", or "links".`,
      );
    }

    if (hasEntries) {
      for (const slug of section.entries) {
        const normalizedSlug = normalizeSlug(slug);
        allowedMarkdown.add(await ensureMarkdownFile(contentRoot, normalizedSlug));
      }
      continue;
    }

    if (hasLinks) {
      for (const link of section.links) {
        if (!link || typeof link !== "object") {
          throw new Error(`Navigation section "${section.label ?? "(root)"}" links must be objects.`);
        }
        normalizeLinkHref(link.href);
        if (typeof link.label !== "string" || link.label.trim() === "") {
          throw new Error(`Navigation section "${section.label ?? "(root)"}" links must have non-empty labels.`);
        }
      }
      continue;
    }

    const files = await collectMarkdownUnder(contentRoot, normalizeSlug(section.dir));
    for (const file of files) {
      allowedMarkdown.add(file);
    }
  }

  await removePrivateMarkdown(contentRoot, allowedMarkdown);
  await pruneEmptyDirectories(contentRoot);

  await fs.mkdir(generatedRoot, { recursive: true });
  const theme = BUILTIN_THEMES.has(config.theme) ? config.theme : "cortex-dark";

  // Read and validate themeModes (optional). When set, the build emits
  // a combined palette.css containing both palettes scoped by
  // [data-mode], plus a prefers-color-scheme media query for the
  // no-JS / pre-paint case. When null, behave as before.
  let themeModes = null;
  if (config.themeModes && typeof config.themeModes === "object") {
    const {light, dark} = config.themeModes;
    if (!BUILTIN_THEMES.has(light)) {
      throw new Error(`docsSite.themeModes.light: unknown theme "${light}"`);
    }
    if (!BUILTIN_THEMES.has(dark)) {
      throw new Error(`docsSite.themeModes.dark: unknown theme "${dark}"`);
    }
    themeModes = {light, dark};
  }

  const themesDir = path.join(outDir, "src", "styles", "themes");
  const paletteTarget = path.join(outDir, "src", "styles", "palette.css");

  if (themeModes) {
    const lightCss = await fs.readFile(
      path.join(themesDir, `${themeModes.light}.css`),
      "utf8",
    );
    const darkCss = await fs.readFile(
      path.join(themesDir, `${themeModes.dark}.css`),
      "utf8",
    );

    // Capture the body of the single `:root { ... }` block from each
    // theme file. Theme files are authored as a single :root block by
    // convention; this regex matches the last `}` so any nested {}
    // (e.g. inside a comment) doesn't trip it.
    const extractRoot = (css, themeName) => {
      const match = css.match(/:root\s*\{([\s\S]*)\}\s*$/m);
      if (!match) {
        throw new Error(`Theme file ${themeName}.css is missing a :root block`);
      }
      return match[1].trim();
    };

    const lightVars = extractRoot(lightCss, themeModes.light);
    const darkVars = extractRoot(darkCss, themeModes.dark);

    const combined = `/*
 * Combined palette generated by stage-docs-site.mjs from
 * docsSite.themeModes = { light = "${themeModes.light}"; dark = "${themeModes.dark}"; }.
 *
 * Cascade:
 *   1. :root           — dark palette (default; assumed when no JS).
 *   2. @media light    — flips to light when the OS prefers light AND
 *                        the reader has not made an explicit choice.
 *   3. [data-mode=...] — the inline pre-paint script in DocsLayout
 *                        sets this from localStorage / prefers-color-scheme,
 *                        winning over the media query above.
 */

:root {
${darkVars}
}

@media (prefers-color-scheme: light) {
  :root {
${lightVars.split("\n").map((line) => (line ? `  ${line}` : line)).join("\n")}
  }
}

html[data-mode="dark"] {
${darkVars}
}

html[data-mode="light"] {
${lightVars}
}
`;
    await fs.writeFile(paletteTarget, combined, "utf8");
    await fs.chmod(paletteTarget, 0o644);
  } else {
    // Single-theme path: copy the chosen theme over palette.css verbatim.
    const themeSource = path.join(themesDir, `${theme}.css`);
    await fs.copyFile(themeSource, paletteTarget);
    await fs.chmod(paletteTarget, 0o644);
  }

  const finalConfig = {
    navigation: navigationSections,
    repo: config.repo ?? {},
    site: config.site,
    theme,
    themeModes,
    lean4: lean4 ? {theoryDir: lean4.theoryDir} : null,
  };

  await fs.writeFile(
    path.join(generatedRoot, "site-config.json"),
    `${JSON.stringify(finalConfig, null, 2)}\n`,
    "utf8",
  );

  // Emit the tree-sitter grammar manifest. Paths reference /nix/store
  // artifacts directly; the rehype plugin loads them via web-tree-sitter
  // at markdown-build time. When no languages are registered, we still
  // write an empty object so consumers always get a predictable file.
  await fs.writeFile(
    path.join(generatedRoot, "grammars.json"),
    `${JSON.stringify(languages, null, 2)}\n`,
    "utf8",
  );

  await fs.writeFile(
    path.join(outDir, "build-env.sh"),
    [
      `export DOCS_SITE_URL=${JSON.stringify(config.site.publicBaseUrl)}`,
      `export DOCS_ROUTE_BASE=${JSON.stringify(config.site.routeBase)}`,
      "",
    ].join("\n"),
    "utf8",
  );

  await writeRoutePage(outDir);

  // The redirect page is unnecessary — Astro's base config places the root
  // page at the correct path, and the catch-all route handles the index.
  const redirectPage = path.join(outDir, "src", "pages", "index.astro");
  await removeIfExists(redirectPage);

  // Apply consumer template overrides last so they can replace any generated
  // file, including the route page and redirect page removed above.
  await applyTemplateOverrides(outDir, templateFiles);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
