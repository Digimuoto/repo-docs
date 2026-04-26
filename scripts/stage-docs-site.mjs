import fs from "node:fs/promises";
import path from "node:path";

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);
const RESERVED_CONFIG_NAMES = new Set(["config.yaml", "config.yml", "config.json"]);
const BUILTIN_THEMES = new Set(["cortex-dark", "cortex-light", "cortex-slate"]);

function usage() {
  console.error(
    "Usage: node stage-docs-site.mjs --content-dir <dir> --config-json <file> --template-files-json <file> --languages-json <file> --out-dir <dir>",
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

  for (const directory of [...topLevelDirectories].sort()) {
    sections.push({
      dir: directory,
      label: navigationConfig.sectionLabels?.[directory] ?? titleCase(directory),
    });
  }

  return sections;
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
  const outDir = values.get("--out-dir");

  if (!contentDir || !configJson || !templateFilesJson || !outDir) {
    usage();
  }

  const contentRoot = path.join(outDir, "src", "content", "docs");
  const generatedRoot = path.join(outDir, "src", "generated");
  const config = JSON.parse(await fs.readFile(configJson, "utf8"));
  const templateFiles = JSON.parse(await fs.readFile(templateFilesJson, "utf8"));
  const languages = languagesJson
    ? JSON.parse(await fs.readFile(languagesJson, "utf8"))
    : {};

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

  const discoveredMarkdown = (await listFiles(contentRoot))
    .map((absolutePath) => normalizeSlashes(path.relative(contentRoot, absolutePath)))
    .filter((relativePath) => MARKDOWN_EXTENSIONS.has(path.extname(relativePath)));

  if (discoveredMarkdown.length === 0) {
    throw new Error("No markdown files found under the configured docs tree.");
  }

  const navigationSections =
    Array.isArray(config.navigation.sections) && config.navigation.sections.length > 0
      ? config.navigation.sections
      : autoGenerateNavigation(discoveredMarkdown, config.navigation);

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

    if (hasEntries === hasDir) {
      throw new Error(
        `Navigation section "${section.label ?? "(root)"}" must define exactly one of "entries" or "dir".`,
      );
    }

    if (hasEntries) {
      for (const slug of section.entries) {
        const normalizedSlug = normalizeSlug(slug);
        allowedMarkdown.add(await ensureMarkdownFile(contentRoot, normalizedSlug));
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

  // Swap the active palette by copying the selected theme file over
  // palette.css. Doing this here (rather than through templateFiles)
  // keeps everything within the staged template tree, which means the
  // theme file is guaranteed to be present in any build environment
  // that received the template directory.
  const themeSource = path.join(outDir, "src", "styles", "themes", `${theme}.css`);
  const paletteTarget = path.join(outDir, "src", "styles", "palette.css");
  await fs.copyFile(themeSource, paletteTarget);
  await fs.chmod(paletteTarget, 0o644);

  const finalConfig = {
    navigation: navigationSections,
    repo: config.repo ?? {},
    site: config.site,
    theme,
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
