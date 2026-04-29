import fs from "node:fs/promises";
import path from "node:path";

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const RESERVED_CONFIG_NAMES = new Set(["config.yaml", "config.yml", "config.json"]);
const BUILTIN_THEMES = new Set(["cortex-dark", "cortex-light", "cortex-slate"]);
const GENERATED_THEORY_DIR = "Theory";
const GENERATED_HASKELL_DIR = "Haskell";

function usage() {
  console.error(
    "Usage: node stage-docs-site.mjs --content-dir <dir> --config-json <file> --template-files-json <file> --languages-json <file> [--lean4-rendered-dir <dir> --lean4-source-dir <dir>] [--typst-rendered-dir <dir>] [--haskell-rendered-dir <dir>] --out-dir <dir>",
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

function parseHaskellConfig(config, renderedDir) {
  if (!config.haskell) {
    return null;
  }
  if (typeof config.haskell !== "object") {
    throw new Error("docsSite.haskell must be an object when set.");
  }
  const packages = config.haskell.packages ?? {};
  if (typeof packages !== "object" || Array.isArray(packages)) {
    throw new Error("docsSite.haskell.packages must be an attribute set when haskell is set.");
  }
  if (Object.keys(packages).length === 0) {
    return null;
  }
  if (!renderedDir) {
    throw new Error("Internal error: docsSite.haskell.packages is set, but no rendered Haddock output was staged.");
  }

  return {
    renderedDir,
    packages,
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

function renderHaskellIndexMarkdown(packages) {
  const items = packages
    .map((pkg) => `- [${pkg.title}](${pkg.safeKey}/)`)
    .join("\n");

  return [
    "---",
    `title: ${yamlString("Haskell API")}`,
    `kind: ${yamlString("haskell-haddock")}`,
    "sidebar:",
    `  label: ${yamlString("Packages")}`,
    "---",
    "",
    items,
    "",
  ].join("\n");
}

function renderHaskellHaddockMarkdown({title, description, label, htmlPath, packageName}) {
  const lines = [
    "---",
    `title: ${yamlString(title)}`,
  ];
  if (description) {
    lines.push(`description: ${yamlString(description)}`);
  }
  lines.push(
    `kind: ${yamlString("haskell-haddock")}`,
    "sidebar:",
    `  label: ${yamlString(label)}`,
    "haddock:",
    `  html: ${yamlString(htmlPath)}`,
    `  package: ${yamlString(packageName)}`,
  );
  lines.push("---", "");
  return lines.join("\n");
}

function renderHaddockOverrideCss() {
  // Every palette block below mirrors the corresponding repo-docs theme
  // file (template/src/styles/themes/<theme>.css) so the iframe's
  // surfaces, text, links, and code colors match the parent shell
  // exactly. The DocsPage iframe-load handler mirrors the parent's
  // `data-theme` / `data-mode` attributes onto the iframe's <html>, so
  // these scoped blocks activate without any build-time injection.
  return `
:root {
  color-scheme: light dark;

  /* cortex-dark baseline (also the SSR fallback before the theme-sync
   * script runs). */
  --rd-font-sans: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --rd-font-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --rd-bg-primary: #0e1116;
  --rd-bg-secondary: #161b22;
  --rd-surface-primary: #161b22;
  --rd-surface-secondary: #1c222a;
  --rd-surface-tertiary: #262d36;
  --rd-surface-hover: #30363d;
  --rd-text-content: #e6edf3;
  --rd-text-content-secondary: #b8c1cc;
  --rd-text-content-tertiary: #8b949e;
  --rd-text-content-quaternary: #6e7681;
  --rd-border-primary: rgba(240, 246, 252, 0.10);
  --rd-border-secondary: rgba(240, 246, 252, 0.18);
  --rd-brand-primary: #f0883e;
  --rd-brand-secondary: #d97706;
  --rd-tok-keyword: #ff7b72;
  --rd-tok-type: #ffa657;
  --rd-tok-string: #a5d6ff;
  --rd-tok-comment: #8b949e;
  --rd-tok-number: #79c0ff;
  --rd-tok-operator: #ff7b72;
  --rd-tok-function: #d2a8ff;
  --rd-status-deprecated: #ff7b72;
  --rd-target-tint: color-mix(in srgb, var(--rd-brand-primary) 22%, transparent);
}

html[data-theme="cortex-dark"] {
  --rd-bg-primary: #0e1116;
  --rd-bg-secondary: #161b22;
  --rd-surface-primary: #161b22;
  --rd-surface-secondary: #1c222a;
  --rd-surface-tertiary: #262d36;
  --rd-surface-hover: #30363d;
  --rd-text-content: #e6edf3;
  --rd-text-content-secondary: #b8c1cc;
  --rd-text-content-tertiary: #8b949e;
  --rd-text-content-quaternary: #6e7681;
  --rd-border-primary: rgba(240, 246, 252, 0.10);
  --rd-border-secondary: rgba(240, 246, 252, 0.18);
  --rd-brand-primary: #f0883e;
  --rd-brand-secondary: #d97706;
  --rd-tok-keyword: #ff7b72;
  --rd-tok-type: #ffa657;
  --rd-tok-string: #a5d6ff;
  --rd-tok-comment: #8b949e;
  --rd-tok-number: #79c0ff;
  --rd-tok-operator: #ff7b72;
  --rd-tok-function: #d2a8ff;
  --rd-status-deprecated: #ff7b72;
}

html[data-theme="cortex-light"] {
  --rd-bg-primary: #ffffff;
  --rd-bg-secondary: #f6f8fa;
  --rd-surface-primary: #f6f8fa;
  --rd-surface-secondary: #eaeef2;
  --rd-surface-tertiary: #d0d7de;
  --rd-surface-hover: #afb8c1;
  --rd-text-content: #1f2328;
  --rd-text-content-secondary: #424a53;
  --rd-text-content-tertiary: #656d76;
  --rd-text-content-quaternary: #8c959f;
  --rd-border-primary: #d1d9e0;
  --rd-border-secondary: #afb8c1;
  --rd-brand-primary: #0969da;
  --rd-brand-secondary: #0550ae;
  --rd-tok-keyword: #cf222e;
  --rd-tok-type: #953800;
  --rd-tok-string: #0a3069;
  --rd-tok-comment: #6e7781;
  --rd-tok-number: #0550ae;
  --rd-tok-operator: #cf222e;
  --rd-tok-function: #8250df;
  --rd-status-deprecated: #cf222e;
}

html[data-theme="cortex-slate"] {
  --rd-bg-primary: #22272e;
  --rd-bg-secondary: #2d333b;
  --rd-surface-primary: #2d333b;
  --rd-surface-secondary: #373e47;
  --rd-surface-tertiary: #444c56;
  --rd-surface-hover: #545d68;
  --rd-text-content: #cdd9e5;
  --rd-text-content-secondary: #adbac7;
  --rd-text-content-tertiary: #768390;
  --rd-text-content-quaternary: #545d68;
  --rd-border-primary: rgba(205, 217, 229, 0.08);
  --rd-border-secondary: rgba(205, 217, 229, 0.16);
  --rd-brand-primary: #6e7bd6;
  --rd-brand-secondary: #5159b3;
  --rd-tok-keyword: #f47067;
  --rd-tok-type: #f69d50;
  --rd-tok-string: #96d0ff;
  --rd-tok-comment: #768390;
  --rd-tok-number: #6cb6ff;
  --rd-tok-operator: #f47067;
  --rd-tok-function: #dcbdfb;
  --rd-status-deprecated: #f47067;
}

* {
  box-sizing: border-box;
}

html {
  height: 100%;
}

html,
body {
  margin: 0;
  padding: 0;
  background: var(--rd-bg-primary);
  color: var(--rd-text-content);
  font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Sticky-footer pattern: body fills the viewport vertically and
 * reserves a strip at the bottom for the absolutely-positioned footer.
 * Keeps the rest of the layout (package header, #content centering)
 * untouched, which a flex/grid container would otherwise disrupt. */
body {
  position: relative;
  min-height: 100vh;
  padding-bottom: 4rem;
  letter-spacing: 0;
}

/* Linuwial pins #content to a 63vw column at >=1280px and lets a
 * fixed-position synopsis float at the right edge. We drop both the
 * cap and the floated synopsis so the embed reads as a normal docs
 * page that fills the available width. */
#content {
  width: auto !important;
  max-width: 88rem !important;
  margin: 0 auto !important;
  padding: 1.75rem clamp(1rem, 3vw, 2.25rem) 4rem !important;
}

@media (max-width: 1024px) {
  #content {
    padding: 1.25rem 1rem 3rem !important;
  }
}

/* Linuwial scopes its link colours via a[href]:link/:visited (one
 * attribute selector ahead of our a:link), so we mirror that
 * specificity to win the cascade without leaning on !important. */
a,
a:link,
a[href]:link,
a[href]:visited {
  color: var(--rd-brand-primary);
  text-decoration: none;
  transition: color 120ms ease;
}

a:hover,
a:focus-visible,
a[href]:hover,
a[href]:focus-visible {
  color: var(--rd-brand-secondary);
  text-decoration: underline;
  text-underline-offset: 0.18em;
  text-decoration-thickness: 0.07em;
}

a[href].def:link,
a[href].def:visited {
  color: var(--rd-text-content);
  font-weight: 600;
}
a[href].def:hover {
  color: var(--rd-brand-primary);
}

::selection {
  background: color-mix(in srgb, var(--rd-brand-primary) 35%, transparent);
  color: var(--rd-text-content);
}

/* Sticky package header — matches the repo-docs sidebar/topbar surface
 * convention: tinted, blurred, hairline-bordered. */
#package-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  min-height: 3rem;
  padding: 0.625rem clamp(1rem, 3vw, 2.25rem);
  background: color-mix(in srgb, var(--rd-bg-primary) 88%, transparent);
  backdrop-filter: saturate(160%) blur(12px);
  -webkit-backdrop-filter: saturate(160%) blur(12px);
  border-bottom: 1px solid var(--rd-border-primary);
}

#package-header .caption,
#package-header > .caption {
  margin: 0 !important;
  color: var(--rd-text-content) !important;
  font-family: var(--rd-font-sans);
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.005em;
}

/* Reset linuwial's heading-as-purple-titles convention: headings inherit
 * the page's content color, weight from the type system. */
.caption,
h1, h2, h3, h4, h5, h6,
summary {
  color: var(--rd-text-content) !important;
  font-family: var(--rd-font-sans);
  font-weight: 600;
  letter-spacing: -0.01em;
}

h1 { font-size: 1.625rem; line-height: 1.2; margin: 0 0 0.75rem; }
h2 { font-size: 1.25rem;  line-height: 1.25; margin: 1.75rem 0 0.625rem; }
h3 { font-size: 1.0625rem; line-height: 1.3;  margin: 1.25rem 0 0.5rem; }
h4 { font-size: 0.9375rem; line-height: 1.35; margin: 1rem 0 0.4rem; }
h5, h6 { font-size: 0.875rem; line-height: 1.4; margin: 0.75rem 0 0.3rem; }

p {
  margin: 0.7rem 0;
  color: var(--rd-text-content);
}

/* Top-level menu (Source / Contents / Index). Pill chips matching the
 * repo-docs sidebar nav item language. */
#page-menu,
ul.links {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

#page-menu a,
#package-header #page-menu a:link,
#package-header #page-menu a:visited,
ul.links a,
ul.links a:link,
ul.links a:visited {
  display: inline-flex;
  align-items: center;
  min-height: 1.875rem;
  padding: 0 0.75rem;
  font-family: var(--rd-font-sans);
  font-size: 0.8125rem;
  font-weight: 500;
  border: 1px solid var(--rd-border-primary);
  border-radius: 0.5rem;
  background: var(--rd-surface-primary);
  color: var(--rd-text-content-secondary);
  text-decoration: none;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

#page-menu a:hover,
#page-menu a:focus-visible,
ul.links a:hover,
ul.links a:focus-visible {
  background: var(--rd-surface-secondary);
  border-color: var(--rd-border-secondary);
  color: var(--rd-text-content);
  text-decoration: none;
}

/* Cards: module header, description, synopsis, interface, index. The
 * radius / border / surface match the repo-docs code-card and
 * mermaid-card chrome — same family of surfaces, same rhythm. */
#module-header,
#description,
#synopsis,
#interface,
#index,
#table-of-contents,
.top,
.subs {
  background: var(--rd-surface-primary);
  border: 1px solid var(--rd-border-primary);
  border-radius: 0.625rem;
  margin: 0 0 1rem;
  padding: 1.125rem 1.25rem;
}

#interface,
#description,
#synopsis,
#table-of-contents {
  padding: 1.25rem 1.5rem;
}

/* Nested cards (declaration .top, sub-blocks .subs) inside #interface.
 * Earlier iterations painted these with bg-primary (recessed/sunken
 * in dark mode) or with a white-tinted overlay (read as too bright
 * with a slight cool cast in dark mode). Settle on transparent
 * backgrounds: the parent #interface surface shows through and the
 * 1px border alone defines the boundary. Same effect in both themes,
 * no hue shift, no contrast jump. */
#interface .top,
#interface .subs {
  margin: 0.875rem 0 0;
  padding: 1.125rem 1.25rem;
  background: transparent;
  border-color: var(--rd-border-primary);
}

#interface .top:first-of-type {
  margin-top: 0.5rem;
}

#interface .top .subs {
  margin-top: 0.875rem;
  background: transparent;
}

#interface > h1 {
  font-size: 1.375rem;
  margin: 0 0 0.875rem;
  padding-bottom: 0.625rem;
  border-bottom: 1px solid var(--rd-border-primary);
}

#description .caption,
#synopsis summary,
#interface .caption,
.subs > .caption {
  display: inline-block !important;
  float: none !important;
  width: auto !important;
  height: auto !important;
  margin: 0 0 0.5rem !important;
  padding: 0.125rem 0.625rem !important;
  font-size: 0.6875rem !important;
  font-weight: 600 !important;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--rd-text-content-tertiary) !important;
  background: var(--rd-bg-primary) !important;
  border: 1px solid var(--rd-border-primary) !important;
  border-radius: 999px !important;
}

#synopsis {
  display: block !important;
  position: static !important;
  float: none !important;
  width: auto !important;
  max-width: none !important;
  top: auto !important;
  right: auto !important;
  bottom: auto !important;
  overflow: visible !important;
  z-index: auto !important;
}

#synopsis details {
  border: 0;
  background: transparent;
}

#synopsis summary {
  cursor: pointer;
  list-style: none;
}

#synopsis summary::-webkit-details-marker {
  display: none;
}

#synopsis ul {
  margin: 0.625rem 0 0 !important;
  padding: 0 !important;
  list-style: none !important;
}

#synopsis ul li {
  padding: 0.25rem 0;
  border-bottom: 1px dashed var(--rd-border-primary);
}

#synopsis ul li:last-child {
  border-bottom: 0;
}

#synopsis ul li.src {
  font-family: var(--rd-font-mono);
  font-size: 0.8125rem;
}

.doc {
  color: var(--rd-text-content-secondary);
}

.doc p {
  color: var(--rd-text-content-secondary);
}

/* Code surfaces: source signatures, inline code, pre blocks. All share
 * the JetBrains Mono family with the rest of the repo-docs site. */
code,
kbd,
samp,
tt,
.src,
.src code,
.src .keyword,
pre {
  font-family: var(--rd-font-mono);
  font-feature-settings: "calt" 1, "liga" 0;
}

code,
kbd,
samp,
tt {
  font-size: 0.875em;
  padding: 0.05em 0.35em;
  border-radius: 0.3em;
  background: var(--rd-bg-primary);
  color: var(--rd-text-content);
  border: 1px solid var(--rd-border-primary);
}

a code,
a > code {
  background: transparent;
  border-color: transparent;
  color: inherit;
  padding: 0;
}

/* .src is Haddock's marker for "this run is source code" — it's
 * applied to <p>, <td>, <li>, <span>, <code>, etc. across the page. We
 * intentionally DON'T paint it as a bordered/rounded card: doing so
 * inherits onto every <p class="src"> declaration line and every
 * <td class="src"> instance row, creating a card-in-card sandwich
 * inside the .top / .subs containers (and gluing identifiers to
 * the inner box edge). Keep .src as a typographic marker only —
 * cards are applied on the outer .top / .subs / #interface containers
 * already. */
.src {
  font-family: var(--rd-font-mono);
  color: var(--rd-text-content);
}

p.src {
  margin: 0.5rem 0;
  font-size: 0.875rem;
  line-height: 1.6;
}

.src .keyword {
  color: var(--rd-tok-keyword);
  font-weight: 500;
}

.src a[href].def,
.src .def {
  color: var(--rd-text-content);
  font-weight: 600;
}

a[href].link,
a.link {
  color: var(--rd-text-content-tertiary);
  font-size: 0.75rem;
  font-family: var(--rd-font-sans);
  margin-left: 0.4em;
  padding: 0 0.4em;
  border-radius: 0.3em;
  border: 1px solid var(--rd-border-primary);
  background: var(--rd-surface-primary);
}

a[href].link:hover {
  color: var(--rd-text-content);
  background: var(--rd-surface-secondary);
  text-decoration: none;
}

a.selflink {
  color: var(--rd-text-content-quaternary);
  font-size: 0.75rem;
  margin-left: 0.4em;
  opacity: 0.6;
  transition: opacity 120ms ease, color 120ms ease;
}

a.selflink:hover {
  color: var(--rd-brand-primary);
  opacity: 1;
  text-decoration: none;
}

pre {
  display: block;
  padding: 0.875rem 1rem;
  background: var(--rd-bg-primary);
  border: 1px solid var(--rd-border-primary);
  border-radius: 0.5rem;
  overflow-x: auto;
  font-size: 0.8125rem;
  line-height: 1.55;
  color: var(--rd-text-content);
}

/* Generic table baseline. We don't add a border + radius here —
 * Haddock nests tables inside .subs cards (constructors, instances,
 * methods), and a bordered table would render as a second box inside
 * the already-bordered card, doubling the chrome. Cards live on the
 * outer .subs / #interface / #index containers; tables stay flat. */
table {
  width: 100%;
  border-collapse: collapse;
  margin: 0;
  font-size: 0.875rem;
  background: transparent;
}

table.info {
  width: auto;
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
}

/* Default cell padding/alignment. Per-cell border-bottoms are NOT applied
 * here as a default — Haddock instance tables use one td.src per
 * declaration plus an empty td.doc.empty as a right-column spacer, so a
 * blanket border-bottom: 1px on every cell creates split-bar artefacts
 * that overshoot card edges. Borders are added back only on doc-index
 * and prose tables further below. */
th,
td {
  padding: 0.5rem 0.75rem;
  vertical-align: top;
  text-align: left;
  background: transparent;
}

thead th {
  background: var(--rd-surface-secondary);
  color: var(--rd-text-content);
  font-weight: 600;
  border-bottom: 1px solid var(--rd-border-primary);
}

td.src,
td.src.clearfix {
  font-family: var(--rd-font-mono);
  background: transparent;
  padding: 0.5rem 0.75rem;
}

td.doc.empty {
  color: var(--rd-text-content-quaternary);
}

/* Doc-index table (Greeting → Demo.Sample). Each row is its own
 * logical record: borders + alternating tint help scan a long index.
 * Scope these here so they don't leak into the instance / synopsis
 * tables. */
#index table,
#alphabet + table {
  border: 1px solid var(--rd-border-primary);
  border-radius: 0.5rem;
  overflow: hidden;
  margin: 0.5rem 0;
}

#index table tr,
#index table td,
#alphabet + table tr,
#alphabet + table td {
  border-bottom: 1px solid var(--rd-border-primary);
}

#index table tr:last-child td,
#alphabet + table tr:last-child td {
  border-bottom: 0;
}

#index table tr:nth-child(even) td,
#alphabet + table tr:nth-child(even) td {
  background: color-mix(in srgb, var(--rd-surface-secondary) 35%, transparent);
}

/* Instance / synopsis / interface tables. Linuwial pins
 * #interface td { padding-left: 0.5em } at higher specificity than our
 * generic td rule, leaving instance rows hard against the card edge.
 * Override at the same specificity so the chevron + identifier sit a
 * comfortable distance from the card border. Also hard-collapse the
 * border model to neutralise linuwial's border-spacing: 2px, which
 * otherwise sneaks 2px past a width: 100% table on the right side. */
#interface table,
.subs table,
#synopsis table {
  border-collapse: collapse !important;
  border-spacing: 0 !important;
  table-layout: auto;
}

#interface td,
#interface th,
.subs td,
.subs th {
  padding: 0.4rem 0.75rem;
  vertical-align: top;
}

/* The instance disclosure marker (▷ / ▽) sits in a leading <span>
 * inside td.src.clearfix. Pull the padding-left a little tighter so the
 * marker hugs the card edge in a controlled way (rather than the random
 * 0.5em linuwial leftover). */
#interface td.src,
#interface td.src.clearfix,
.subs td.src,
.subs td.src.clearfix {
  padding: 0.5rem 0.875rem;
}

/* Subs tables (constructors, methods, fields). The wrapping
 * .subs.constructors / .subs.methods card already has 1.125rem of
 * horizontal padding, so the inner table doesn't need its own
 * indent — flatten any leftover linuwial indent. */
.subs > table,
.subs > details > table {
  margin: 0;
}

.subs > table td,
.subs > details > table td {
  padding-left: 0;
}

/* Disclosure widgets (Synopsis, Instances, Methods). Quietly themed
 * so the chevron lives inside the card chrome, not on top of it. */
details {
  border: 0;
  background: transparent;
}

details summary {
  cursor: pointer;
  user-select: none;
}

details > summary.hide-when-js-enabled {
  display: none;
}

/* Module list on the package landing page. Each entry behaves like a
 * compact docs link card. */
#module-list {
  background: var(--rd-surface-primary);
  border: 1px solid var(--rd-border-primary);
  border-radius: 0.625rem;
  padding: 1rem 1.25rem;
}

#module-list > #module-list {
  background: transparent;
  border: 0;
  padding: 0;
}

#module-list .caption {
  display: block;
  font-size: 0.6875rem !important;
  font-weight: 600 !important;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--rd-text-content-tertiary) !important;
  margin: 0.25rem 0 0.5rem !important;
}

#module-list ul {
  margin: 0.25rem 0 0 0.5rem;
  padding: 0;
  list-style: none;
}

#module-list ul li {
  padding: 0.25rem 0;
}

#module-list .module {
  font-family: var(--rd-font-mono);
  font-size: 0.875rem;
  color: var(--rd-text-content);
}

/* Source view (src/<Module>.html). Haddock emits a single big <pre>
 * with .hs-* token spans — and ships its own style.css that hardcodes
 * a Solarized-Light palette plus a yellow hover highlight. Override
 * those leaks so the source listing reads in the same colour family
 * as the rest of the embed in every theme. */
body > pre,
body > pre.haskell {
  margin: 0;
  padding: 1.25rem clamp(1rem, 3vw, 2.25rem);
  background: var(--rd-bg-primary);
  color: var(--rd-text-content);
  font-family: var(--rd-font-mono);
  font-size: 0.8125rem;
  line-height: 1.6;
  border: 0;
  border-radius: 0;
  overflow-x: auto;
  white-space: pre;
}

table.source-code th {
  background: var(--rd-surface-secondary);
  color: var(--rd-text-content-tertiary);
  font-family: var(--rd-font-mono);
  font-weight: 400;
  font-size: 0.75rem;
  padding: 0.125rem 0.5rem;
  text-align: right;
  user-select: none;
}

table.source-code td {
  padding: 0.125rem 0.75rem;
  font-family: var(--rd-font-mono);
  font-size: 0.8125rem;
}

/* Haddock's source-view token classes (Cabal/Haddock highlighter, NOT
 * Highlighting-Kate — different class names). The full set used by the
 * generator is .hs-identifier (plus .hs-var, .hs-type), .hs-keyword,
 * .hs-string, .hs-char, .hs-number, .hs-operator, .hs-glyph,
 * .hs-special, .hs-comment, .hs-pragma, .hs-cpp. */
.hs-identifier,
.hs-identifier.hs-var { color: var(--rd-text-content); }
.hs-identifier.hs-type,
.hs-conid,
.hs-typ { color: var(--rd-tok-type); }
.hs-keyword,
.hs-keyglyph { color: var(--rd-tok-keyword); font-weight: 500; }
.hs-string,
.hs-str,
.hs-char,
.hs-chr { color: var(--rd-tok-string); }
.hs-number { color: var(--rd-tok-number); }
.hs-operator { color: var(--rd-tok-operator); }
.hs-glyph,
.hs-special { color: var(--rd-tok-keyword); }
.hs-comment,
.hs-comment-block { color: var(--rd-tok-comment); font-style: italic; }
.hs-pragma { color: var(--rd-tok-comment); font-style: italic; }
.hs-cpp { color: var(--rd-tok-function); }

/* Source view annotation tooltips (span.annot carries a hidden
 * span.annottext shown on hover). Linuwial's defaults are
 * cream-yellow on bright orange, with a #ff0 flash on the trigger.
 * Repaint to a quiet popover. */
body > pre span.annot {
  position: relative;
  color: inherit;
  text-decoration: none;
}

body > pre span.annot:hover {
  background: color-mix(in srgb, var(--rd-brand-primary) 16%, transparent);
}

body > pre span.annot span.annottext {
  display: none;
  position: absolute;
  left: 1em;
  top: 1.6em;
  z-index: 99;
  padding: 0.5rem 0.75rem;
  background: var(--rd-surface-primary);
  color: var(--rd-text-content);
  border: 1px solid var(--rd-border-secondary);
  border-radius: 0.5rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  font-family: var(--rd-font-mono);
  font-size: 0.8125rem;
  line-height: 1.45;
  white-space: pre-wrap;
  max-width: min(40rem, 80vw);
}

body > pre span.annot:hover span.annottext {
  display: block;
}

/* Source view links (every identifier that resolves to a definition).
 * Linuwial draws a Solarized-cream underline and flashes the cell on
 * hover; mute the underline and use the surface-secondary token for
 * hover so it sits inside the page palette. */
body > pre a:link,
body > pre a:visited,
body > pre a[href]:link,
body > pre a[href]:visited {
  color: inherit;
  text-decoration: none;
  border-bottom: 1px dotted var(--rd-border-secondary);
}

body > pre a:hover,
body > pre a.hover-highlight,
body > pre a[href]:hover {
  background: var(--rd-surface-secondary);
  color: var(--rd-brand-primary);
  text-decoration: none;
  border-bottom-color: var(--rd-brand-primary);
}

/* ===== Linuwial leaks (rendered Haddock pages) =====
 *
 * Everything below patches a hardcoded colour, surface, or layout in
 * linuwial.css that survived the override above. Grouped by the
 * Haddock feature they target so adding new ones stays orderly. */

/* Block code in module docstrings. Linuwial paints pre with
 * #f7f7f7 / #ddd; reuse the page's bg-primary surface and the
 * --rd-border-primary token. */
#interface pre,
#description pre,
.doc pre,
.subs pre {
  background: var(--rd-bg-primary);
  border: 1px solid var(--rd-border-primary);
  color: var(--rd-text-content);
}

/* Inline .src (used both in module HTML and in some doc sections).
 * Linuwial paints .src { background: #f2f2f2 }. Override only when
 * .src is inline (otherwise our card-style .src block above wins). */
p > .src,
li > .src,
span.src {
  background: transparent;
  color: var(--rd-text-content);
}

/* Block-quote prose. Linuwial paints a lavender frame; tint with the
 * brand colour instead so it sits in the same palette family. */
blockquote {
  border-left: 3px solid var(--rd-brand-primary);
  background: color-mix(in srgb, var(--rd-brand-primary) 8%, transparent);
  color: var(--rd-text-content-secondary);
  margin: 0.75rem 0;
  padding: 0.5rem 0.75rem;
  border-radius: 0 0.375rem 0.375rem 0;
}

/* Module-header divider. Linuwial draws a 1px solid #ddd under the
 * Demo.Sample heading; use --rd-border-primary so it tracks themes. */
#module-header .caption {
  border-bottom: 1px solid var(--rd-border-primary);
  color: var(--rd-text-content);
}

/* Info table (the <table class="info"> floated in #module-header
 * with rows like Safe Haskell / Language). Linuwial floats it right,
 * pins it with position: relative; top: -0.78em, and gives it a
 * white card with grey 1px border + grey body text — none of which
 * survives dark mode. Stop the float so it sits below the title
 * cleanly, drop the background fill (the page surface shows through),
 * and use border-collapse: separate so border-radius actually rounds
 * the stroke (with collapse, browsers drop the radius on the table
 * border and any cell border at the corners renders as a square
 * stroke underneath the rounded background, which was the visible
 * bleed). */
table.info,
#module-header table.info {
  float: none;
  position: static;
  top: auto;
  margin: 1rem 0 0;
  padding: 0;
  width: auto;
  max-width: none;
  background: transparent;
  border: 1px solid var(--rd-border-primary);
  border-radius: 0.5rem;
  border-spacing: 0 !important;
  border-collapse: separate !important;
  color: var(--rd-text-content-secondary);
  font-size: 0.8125rem;
}

table.info tr,
.info tr,
table.info tr:nth-child(even),
.info tr:nth-child(even) {
  background: transparent !important;
}

table.info th,
table.info td,
.info th,
.info td {
  padding: 0.375rem 0.875rem !important;
  border: 0 !important;
  background: transparent !important;
  vertical-align: middle;
  text-align: left;
}

table.info tr + tr th,
table.info tr + tr td,
.info tr + tr th,
.info tr + tr td {
  border-top: 1px solid var(--rd-border-primary) !important;
}

table.info th,
.info th {
  color: var(--rd-text-content-tertiary);
  font-weight: 500;
  font-size: 0.6875rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  padding-right: 1rem !important;
}

table.info td,
.info td {
  color: var(--rd-text-content);
  font-family: var(--rd-font-mono);
  font-size: 0.8125rem;
}

/* Top-of-page header bar. Linuwial paints #package-header with a
 * solid #5E5184 purple, a translucent purple bottom-border, and
 * color: #ddd on the body plus color: white on the menu links —
 * all overrides our themed surface. Re-anchor every property here so
 * nothing leaks. */
#package-header {
  background: color-mix(in srgb, var(--rd-bg-primary) 88%, transparent) !important;
  border-bottom: 1px solid var(--rd-border-primary) !important;
  color: var(--rd-text-content) !important;
  font-size: 0.875rem !important;
}

#package-header .caption,
#package-header > .caption {
  color: var(--rd-text-content) !important;
}

#package-header #page-menu a,
#package-header #page-menu a:link,
#package-header #page-menu a:visited {
  color: var(--rd-text-content-secondary);
}

#package-header #page-menu a:hover,
#package-header #page-menu a:focus-visible {
  color: var(--rd-text-content);
}

/* Disclosure arrows on submodule expanders / nested instance lists.
 * Linuwial paints these #9C5791 — a magenta that doesn't belong in
 * any cortex theme. Use the muted-text token. */
.collapser:before,
.expander:before,
.noexpander:before {
  color: var(--rd-text-content-tertiary);
}

/* Contents-list (rendered on the index/contents pages). Linuwial
 * paints #contents-list { background: #f4f4f4 }. Match the
 * surface-primary card style. */
#contents-list,
#table-of-contents {
  background: var(--rd-surface-primary);
  border: 1px solid var(--rd-border-primary);
  border-radius: 0.5rem;
  padding: 1rem 1.25rem;
}

/* Sub-block borders. .subs, .top > .doc, .subs > .doc use a
 * border-left: 1px solid gainsboro — gainsboro reads as a near-white
 * stripe in dark mode, the user's 'pure white strokes' note. Use the
 * border-primary token instead, and back the indent to a comfortable
 * 0.875rem so the rule sits a hair off the text. */
.subs,
.top > .doc,
.subs > .doc {
  border-left: 1px solid var(--rd-border-primary);
  padding-left: 0.875rem;
  margin-bottom: 0.75rem;
}

/* Top-of-section divider on .top p.src. Linuwial draws a 3px-thick
 * #e5e5e5 underline beneath every declaration's source line, which
 * reads as a chunky white bar in dark mode. Replace with a 1px hairline
 * in --rd-border-primary. */
.top p.src,
#interface .top > p.src {
  border-bottom: 1px solid var(--rd-border-primary);
  line-height: 1.7rem;
  margin: 0 0 0.75rem;
  padding: 0.5rem 0;
  background: transparent !important;
}

/* .subs .subs p.src is painted with #f8f8f8. Reset to transparent. */
.subs .subs p.src {
  background: transparent !important;
}

/* Doc tables (markdown-rendered tables inside docstrings). Linuwial
 * paints them with #ddd borders and #f0f0f0 header bg — both leak
 * in dark mode. Re-skin to match the table style we set above. */
.doc table {
  border-collapse: collapse;
  border-spacing: 0;
}

.doc th,
.doc td {
  padding: 0.5rem 0.75rem !important;
  border: 1px solid var(--rd-border-primary) !important;
  background: transparent !important;
  color: var(--rd-text-content);
}

.doc th {
  background: var(--rd-surface-secondary) !important;
  color: var(--rd-text-content);
  font-weight: 600;
}

/* Selflinks / source links inside declaration source lines (\#\ and
 * "Source"). Linuwial floats them right at line-height 30px and gives
 * them color: #888. Our chip-style above already styles them, but
 * we need to neutralise the line-height: 30px so they sit on the
 * baseline of the declaration. */
#interface .src .selflink,
#interface .src .link,
.src .selflink,
.src .link {
  float: none;
  display: inline-flex;
  align-items: center;
  line-height: 1.4;
  color: var(--rd-text-content-tertiary);
}

/* Fixity / right-edge spans inside declarations. Linuwial gives them
 * #919191 borders/colour. Quiet down to the muted token. */
#interface span.fixity,
#interface span.rightedge,
span.fixity,
span.rightedge {
  color: var(--rd-text-content-tertiary);
  border-left-color: var(--rd-border-primary);
}

/* Anchor-target highlight. Linuwial flashes a yellow #fbf36d gradient
 * when the URL hash matches an element id. Replace with a brand-tinted
 * ribbon that reads in any palette. */
:target,
:target:hover {
  background: var(--rd-target-tint) !important;
  border-radius: 0.25rem;
}

/* Warning text. Linuwial uses color: red. Use the deprecated-status
 * token so it tracks the rest of the palette. */
.warning {
  color: var(--rd-status-deprecated);
}

/* Footer. Linuwial paints #footer with a hardcoded #ededed canvas and
 * #222 text — neither survives a dark theme. Pin to the bottom of the
 * body via absolute positioning (the body reserves padding-bottom for
 * us), repaint the surface to match the page, and centre the credit. */
#footer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  width: 100%;
  height: auto;
  margin: 0;
  padding: 1rem clamp(1rem, 3vw, 2.25rem);
  background: var(--rd-bg-primary);
  border-top: 1px solid var(--rd-border-primary);
  color: var(--rd-text-content-tertiary);
  text-align: center;
  font-size: 0.8125rem;
}

#footer p,
#footer a {
  color: var(--rd-text-content-tertiary);
}

#footer a[href]:link,
#footer a[href]:visited {
  color: var(--rd-brand-primary);
}

#footer p {
  margin: 0;
  color: inherit;
}

/* Quick-jump panel (the modal Haddock renders for the "/" hotkey).
 * Repaint its surfaces / borders only — Haddock owns layout/JS. */
#search,
#search-form,
#search-results,
.search-result {
  font-family: var(--rd-font-sans);
}

#search {
  background: color-mix(in srgb, var(--rd-bg-primary) 92%, transparent) !important;
}

#search > div,
#search-form,
#search-results,
.search-result {
  background: var(--rd-surface-primary) !important;
  color: var(--rd-text-content) !important;
  border-color: var(--rd-border-primary) !important;
}

#search-results .search-result.selected {
  background: var(--rd-surface-secondary) !important;
}

#search input {
  background: var(--rd-bg-primary) !important;
  color: var(--rd-text-content) !important;
  border: 1px solid var(--rd-border-primary) !important;
  border-radius: 0.5rem !important;
}

/* Smooth scrollbars in the dark themes. Webkit-specific; harmless on
 * other engines. */
* {
  scrollbar-color: var(--rd-surface-tertiary) transparent;
  scrollbar-width: thin;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}

::-webkit-scrollbar-thumb {
  background: var(--rd-surface-tertiary);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--rd-surface-hover);
  background-clip: padding-box;
}

::-webkit-scrollbar-track {
  background: transparent;
}
`.trim();
}

function renderHaddockThemeSyncScript() {
  // Mirror the parent shell's data-theme/data-mode onto the iframe's
  // <html> so the palette blocks in repo-docs-haddock.css activate. The
  // iframe is loaded with sandbox `allow-same-origin allow-scripts`, so
  // window.parent is reachable; the try/catch is defensive against the
  // direct-open case (where window.parent === window).
  return `
(() => {
  function readParent() {
    try {
      const parent = window.parent;
      if (!parent || parent === window) return null;
      return parent.document?.documentElement ?? null;
    } catch {
      return null;
    }
  }
  function apply() {
    const parent = readParent();
    const root = document.documentElement;
    if (!parent) {
      // Standalone open: respect the OS-level preference.
      const prefersLight =
        window.matchMedia &&
        window.matchMedia("(prefers-color-scheme: light)").matches;
      root.dataset.theme = prefersLight ? "cortex-light" : "cortex-dark";
      root.dataset.mode = prefersLight ? "light" : "dark";
      return;
    }
    if (parent.dataset.theme) root.dataset.theme = parent.dataset.theme;
    if (parent.dataset.mode) root.dataset.mode = parent.dataset.mode;
  }
  apply();
  const parent = readParent();
  if (parent) {
    try {
      new MutationObserver(apply).observe(parent, {
        attributes: true,
        attributeFilter: ["data-theme", "data-mode"],
      });
    } catch {
      /* MutationObserver unavailable */
    }
  }
})();
`.trim();
}

// Haddock leaves `${pkgroot}/...../<store-hash>-ghc-<v>-doc/share/doc/ghc/html/libraries/<pkg>-<ver>-<hash>/<file>`
// as a literal string in cross-package links (e.g. references to base's
// `String`, `Show`, `Int`). The placeholder is meant to be substituted
// at install time; in our Nix-built output it never is, so the browser
// resolves the relative URL up to the site root and produces a 404 on
// the Nix store hash. Rewrite these to absolute Hackage URLs so the
// links land on canonical docs that are actually reachable.
//
// Pattern breakdown:
//   ${pkgroot}/(../)+ <store-hash>-ghc-<ghc-ver>-doc /share/doc/ghc/html/libraries/ <pkg>-<ver>-<hash> / <file>
// We extract <pkg> and <ver> (greedy non-capturing for the trailing
// hash) and route to https://hackage.haskell.org/package/<pkg>-<ver>/docs/<file>.
const PKGROOT_LINK_RE =
  /\$\{pkgroot\}\/(?:\.\.\/)+[^/]+-ghc-[^/]+-doc\/share\/doc\/ghc\/html\/libraries\/([A-Za-z][A-Za-z0-9-]*?)-([0-9][0-9.]*)-[0-9a-f]+\/([^"'\s]+)/g;

function rewriteHaddockExternalLinks(html) {
  return html.replace(
    PKGROOT_LINK_RE,
    (_match, pkg, version, file) =>
      `https://hackage.haskell.org/package/${pkg}-${version}/docs/${file}`,
  );
}

function injectHaddockStyle(html, stylesheetHref) {
  const fontHref =
    "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap";
  const fontLinks = [
    `<link rel="preconnect" href="https://fonts.googleapis.com" />`,
    `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />`,
    `<link rel="stylesheet" href="${escapeHtml(fontHref)}" />`,
  ].join("");
  const themeLink = `<link rel="stylesheet" type="text/css" href="${escapeHtml(stylesheetHref)}" />`;
  const themeSync = `<script>${renderHaddockThemeSyncScript()}</script>`;
  const inject = `${fontLinks}${themeLink}${themeSync}`;
  const rewritten = rewriteHaddockExternalLinks(html);
  const withoutGoogleFont = rewritten.replace(
    /<link rel="stylesheet" type="text\/css" href="https:\/\/fonts\.googleapis\.com\/css\?family=PT\+Sans:400,400i,700" \/>/g,
    "",
  );
  if (/<\/head>/i.test(withoutGoogleFont)) {
    return withoutGoogleFont.replace(/<\/head>/i, `${inject}</head>`);
  }
  return `${inject}\n${withoutGoogleFont}`;
}

async function injectHaddockStyles(htmlRoot) {
  const stylesheetPath = path.join(htmlRoot, "repo-docs-haddock.css");
  await fs.writeFile(stylesheetPath, `${renderHaddockOverrideCss()}\n`, "utf8");

  const htmlFiles = (await listFiles(htmlRoot))
    .map((absolutePath) => normalizeSlashes(path.relative(htmlRoot, absolutePath)))
    .filter((relativePath) => path.extname(relativePath) === ".html");

  for (const relativePath of htmlFiles) {
    const htmlPath = path.join(htmlRoot, relativePath);
    const stylesheetHref = normalizeSlashes(
      path.relative(path.dirname(htmlPath), stylesheetPath),
    ) || "repo-docs-haddock.css";
    const html = await fs.readFile(htmlPath, "utf8");
    await fs.writeFile(htmlPath, injectHaddockStyle(html, stylesheetHref), "utf8");
  }
}

async function generateHaskellDocs(contentRoot, publicRoot, haskell) {
  if (!haskell) {
    return null;
  }

  const manifestPath = path.join(haskell.renderedDir, "packages.json");
  let packages;
  try {
    packages = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read rendered Haskell Haddock manifest: ${error.message}`);
  }
  if (!Array.isArray(packages)) {
    throw new Error("Rendered Haskell Haddock manifest must be a JSON array.");
  }

  const contentHaskellRoot = path.join(contentRoot, GENERATED_HASKELL_DIR);
  try {
    await fs.stat(contentHaskellRoot);
    throw new Error(
      `Generated Haskell Haddock docs would overwrite existing docs path "${GENERATED_HASKELL_DIR}".`,
    );
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  const publicHaskellRoot = path.join(publicRoot, GENERATED_HASKELL_DIR);
  await removeIfExists(publicHaskellRoot);
  await fs.mkdir(contentHaskellRoot, {recursive: true});

  const entries = [GENERATED_HASKELL_DIR];
  const normalizedPackages = [];

  for (const rawPackage of packages) {
    if (!rawPackage || typeof rawPackage !== "object") {
      throw new Error("Rendered Haskell Haddock manifest entries must be objects.");
    }

    const key = assertSafeRelativePath(rawPackage.key, "Haskell package key");
    const safeKey = assertSafeRelativePath(rawPackage.safeKey, `Haskell package "${key}" safeKey`);
    const packageName = typeof rawPackage.packageName === "string" && rawPackage.packageName.trim() !== ""
      ? rawPackage.packageName.trim()
      : key;
    const title = typeof rawPackage.title === "string" && rawPackage.title.trim() !== ""
      ? rawPackage.title.trim()
      : packageName;
    const description = typeof rawPackage.description === "string" && rawPackage.description.trim() !== ""
      ? rawPackage.description.trim()
      : null;

    const renderedHtmlRoot = path.join(haskell.renderedDir, "packages", safeKey, "html");
    const publicHtmlRoot = path.join(publicHaskellRoot, safeKey, "haddock");
    await fs.mkdir(path.dirname(publicHtmlRoot), {recursive: true});
    await fs.cp(renderedHtmlRoot, publicHtmlRoot, {recursive: true});
    await makeWritableRecursive(publicHtmlRoot);
    await injectHaddockStyles(publicHtmlRoot);

    normalizedPackages.push({safeKey, title});

    const packageRoute = `${GENERATED_HASKELL_DIR}/${safeKey}`;
    const packageHtmlPath = `${packageRoute}/haddock/index.html`;
    await fs.mkdir(path.join(contentHaskellRoot, safeKey), {recursive: true});
    await fs.writeFile(
      path.join(contentHaskellRoot, safeKey, "index.md"),
      renderHaskellHaddockMarkdown({
        title,
        description,
        label: packageName,
        htmlPath: packageHtmlPath,
        packageName,
      }),
      "utf8",
    );
    entries.push(packageRoute);
  }

  await fs.writeFile(
    path.join(contentHaskellRoot, "index.md"),
    renderHaskellIndexMarkdown(normalizedPackages),
    "utf8",
  );

  return {
    label: "Haskell",
    entries,
  };
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

function hasGeneratedNavigationSection(navigationSections, generatedDir) {
  return navigationSections.some(
    (section) =>
      (typeof section?.dir === "string" && normalizeSlug(section.dir) === generatedDir) ||
      (Array.isArray(section?.entries) &&
        section.entries.some((entry) => normalizeSlug(entry) === generatedDir)) ||
      (Array.isArray(section?.links) &&
        section.links.some((link) => normalizeLinkHref(link?.href) === generatedDir)),
  );
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
  const haskellRenderedDir = values.get("--haskell-rendered-dir") ?? null;
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
  const haskell = parseHaskellConfig(config, haskellRenderedDir);

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
  const generatedHaskellSection = await generateHaskellDocs(contentRoot, publicRoot, haskell);

  const navigationSections =
    Array.isArray(config.navigation.sections) && config.navigation.sections.length > 0
      ? config.navigation.sections
      : autoGenerateNavigation(authoredMarkdown, config.navigation);

  if (generatedTheorySection) {
    if (!hasGeneratedNavigationSection(navigationSections, GENERATED_THEORY_DIR)) {
      navigationSections.push(generatedTheorySection);
    }
  }
  if (generatedHaskellSection) {
    if (!hasGeneratedNavigationSection(navigationSections, GENERATED_HASKELL_DIR)) {
      navigationSections.push(generatedHaskellSection);
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
    haskell: haskell ? {packages: haskell.packages} : null,
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
