import fs from "node:fs/promises";
import path from "node:path";

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const RESERVED_CONFIG_NAMES = new Set(["config.yaml", "config.yml", "config.json"]);
const BUILTIN_THEMES = new Set(["cortex-dark", "cortex-light", "cortex-slate"]);
const GENERATED_THEORY_DIR = "Theory";

function usage() {
  console.error(
    "Usage: node stage-docs-site.mjs --content-dir <dir> --config-json <file> --template-files-json <file> --languages-json <file> [--lean4-rendered-dir <dir>] --out-dir <dir>",
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

function parseLean4Config(config, renderedDir) {
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

  return {
    renderedDir,
    theoryDir: config.lean4.theoryDir.trim(),
  };
}

const VERSO_THEME_PALETTES = {
  "cortex-dark": {
    accent: "#f0883e",
    accentSecondary: "#d97706",
    background: "#0e1116",
    border: "rgba(240, 246, 252, 0.10)",
    borderStrong: "rgba(240, 246, 252, 0.18)",
    codeBackground: "#161b22",
    currentForeground: "#ffffff",
    muted: "#8b949e",
    selected: "#30363d",
    surface: "#161b22",
    surfaceAlt: "#1c222a",
    text: "#e6edf3",
    textSecondary: "#b8c1cc",
  },
  "cortex-light": {
    accent: "#0969da",
    accentSecondary: "#0550ae",
    background: "#ffffff",
    border: "#d1d9e0",
    borderStrong: "#afb8c1",
    codeBackground: "#f6f8fa",
    currentForeground: "#ffffff",
    muted: "#656d76",
    selected: "#afb8c1",
    surface: "#f6f8fa",
    surfaceAlt: "#eaeef2",
    text: "#1f2328",
    textSecondary: "#424a53",
  },
  "cortex-slate": {
    accent: "#6e7bd6",
    accentSecondary: "#5159b3",
    background: "#22272e",
    border: "rgba(205, 217, 229, 0.08)",
    borderStrong: "rgba(205, 217, 229, 0.16)",
    codeBackground: "#2d333b",
    currentForeground: "#ffffff",
    muted: "#768390",
    selected: "#545d68",
    surface: "#2d333b",
    surfaceAlt: "#373e47",
    text: "#cdd9e5",
    textSecondary: "#adbac7",
  },
};

function versoThemeVars(themeName) {
  const palette = VERSO_THEME_PALETTES[themeName] ?? VERSO_THEME_PALETTES["cortex-dark"];
  return [
    `--verso-code-font-family: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace;`,
    `--verso-text-font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;`,
    `--verso-structure-font-family: "IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;`,
    `--verso-text-color: ${palette.text};`,
    `--verso-structure-color: ${palette.text};`,
    `--verso-background-color: ${palette.background};`,
    `--verso-surface-color: ${palette.surface};`,
    `--verso-border-color: ${palette.border};`,
    `--verso-link-color: ${palette.accent};`,
    `--verso-link-visited-color: ${palette.accentSecondary};`,
    `--verso-link-hover-bg: ${palette.surfaceAlt};`,
    `--verso-muted-color: ${palette.muted};`,
    `--verso-current-bg: ${palette.accent};`,
    `--verso-current-fg: ${palette.currentForeground};`,
    `--verso-breadcrumb-color: ${palette.textSecondary};`,
    `--verso-code-box-background-color: ${palette.codeBackground};`,
    `--verso-code-box-border-color: ${palette.border};`,
    `--verso-blockquote-border-color: ${palette.borderStrong};`,
    `--verso-blockquote-color: ${palette.muted};`,
    `--verso-inline-code-bg: ${palette.surfaceAlt};`,
    `--verso-docstring-border-color: ${palette.borderStrong};`,
    `--verso-imports-summary-color: ${palette.textSecondary};`,
    `--verso-output-color: ${palette.muted};`,
    `--verso-copy-button-bg: ${palette.surfaceAlt};`,
    `--verso-copy-button-border: ${palette.borderStrong};`,
    `--verso-copy-button-color: ${palette.textSecondary};`,
    `--verso-copy-button-hover-bg: ${palette.selected};`,
    `--verso-copy-button-copied-color: ${palette.accent};`,
    `--verso-hamburger-bg: ${palette.surface};`,
    `--verso-hamburger-border: ${palette.borderStrong};`,
    `--verso-hamburger-bar-color: ${palette.text};`,
    `--verso-selected-color: ${palette.selected};`,
  ].join("\n  ");
}

function renderVersoThemeCss(config) {
  const theme = BUILTIN_THEMES.has(config.theme) ? config.theme : "cortex-dark";
  if (config.themeModes && typeof config.themeModes === "object") {
    const light = BUILTIN_THEMES.has(config.themeModes.light) ? config.themeModes.light : theme;
    const dark = BUILTIN_THEMES.has(config.themeModes.dark) ? config.themeModes.dark : theme;
    return [
      "/* Generated by repo-docs to align Verso literate output with the site palette. */",
      ":root {",
      `  ${versoThemeVars(light)}`,
      "}",
      "",
      "@media (prefers-color-scheme: dark) {",
      "  :root {",
      `    ${versoThemeVars(dark).replace(/\n/g, "\n    ")}`,
      "  }",
      "}",
      "",
    ].join("\n");
  }

  return [
    "/* Generated by repo-docs to align Verso literate output with the site palette. */",
    ":root {",
    `  ${versoThemeVars(theme)}`,
    "}",
    "",
  ].join("\n");
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

async function addVersoThemeStyles(outputRoot, config) {
  const stylesheetName = "repo-docs-verso.css";
  await fs.writeFile(
    path.join(outputRoot, stylesheetName),
    renderVersoThemeCss(config),
    "utf8",
  );

  const htmlFiles = (await listFiles(outputRoot))
    .map((absolutePath) => normalizeSlashes(path.relative(outputRoot, absolutePath)))
    .filter((relativePath) => path.extname(relativePath) === ".html");

  for (const relativePath of htmlFiles) {
    const absolutePath = path.join(outputRoot, relativePath);
    const html = await fs.readFile(absolutePath, "utf8");
    if (html.includes(stylesheetName)) {
      continue;
    }
    await fs.writeFile(
      absolutePath,
      html.replace("</head>", `  <link rel="stylesheet" href="${stylesheetName}" />\n</head>`),
      "utf8",
    );
  }
}

async function generateLean4Docs(contentRoot, publicRoot, lean4, config) {
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

  const outputRoot = path.join(publicRoot, GENERATED_THEORY_DIR);
  await removeIfExists(outputRoot);
  await copyDirectory(lean4.renderedDir, outputRoot);
  await makeWritableRecursive(outputRoot);

  try {
    const landing = await fs.stat(path.join(outputRoot, "index.html"));
    if (!landing.isFile()) {
      throw new Error();
    }
  } catch {
    throw new Error(`Verso did not render a Theory landing page for "${lean4.theoryDir}".`);
  }

  await addVersoThemeStyles(outputRoot, config);

  const links = (await listFiles(outputRoot))
    .map((absolutePath) => normalizeSlashes(path.relative(outputRoot, absolutePath)))
    .map(theoryLinkFromRenderedIndex)
    .filter((link) => link !== null)
    .sort((left, right) => comparePaths(left.href, right.href));

  return {
    label: "Theory",
    links,
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
  for (const extension of MARKDOWN_EXTENSIONS) {
    const candidate = `${basePath}${extension}`;
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        return normalizeSlashes(path.relative(contentDir, candidate));
      }
    } catch {
      // Continue searching through supported extensions.
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
  const lean4 = parseLean4Config(config, lean4RenderedDir);

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

  const authoredMarkdown = (await listFiles(contentRoot))
    .map((absolutePath) => normalizeSlashes(path.relative(contentRoot, absolutePath)))
    .filter((relativePath) => MARKDOWN_EXTENSIONS.has(path.extname(relativePath)));

  if (authoredMarkdown.length === 0) {
    throw new Error("No markdown files found under the configured docs tree.");
  }

  const generatedTheorySection = await generateLean4Docs(contentRoot, publicRoot, lean4, config);

  const navigationSections =
    Array.isArray(config.navigation.sections) && config.navigation.sections.length > 0
      ? config.navigation.sections
      : autoGenerateNavigation(authoredMarkdown, config.navigation);

  if (generatedTheorySection) {
    const hasTheorySection = navigationSections.some(
      (section) =>
        (typeof section?.dir === "string" && normalizeSlug(section.dir) === GENERATED_THEORY_DIR) ||
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
