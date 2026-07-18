import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdx"]);

function usage() {
  console.error(`Usage: docs-preview-page [options] <page.md|page.mdx>

Options:
  --host <host>       Host to bind (default: $HOST or 127.0.0.1)
  --port <port>       Port to serve (default: $PORT or 4323)
  --no-open           Do not open the preview URL automatically
  --help              Show this help

Environment:
  DOCS_PREVIEW_CONTENT_DIR  Logical docs root used for route preservation
                            (default: $PWD/docs)`);
}

function fail(message) {
  console.error(`docs-preview-page: ${message}`);
  process.exitCode = 1;
}

function takeValue(args, index, flag) {
  const value = args[index + 1];
  if (value == null || value.startsWith("-")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseArguments(args) {
  const options = {
    workdir: null,
    stageScript: null,
    configJson: null,
    templateFilesJson: null,
    languagesJson: null,
    lean4RenderedDir: null,
    lean4SourceDir: null,
    typstRenderedDir: null,
    haskellRenderedDir: null,
    host: process.env.HOST || "127.0.0.1",
    port: process.env.PORT || "4323",
    noOpen: false,
    page: null,
  };

  const internalFlags = new Map([
    ["--workdir", "workdir"],
    ["--stage-script", "stageScript"],
    ["--config-json", "configJson"],
    ["--template-files-json", "templateFilesJson"],
    ["--languages-json", "languagesJson"],
    ["--lean4-rendered-dir", "lean4RenderedDir"],
    ["--lean4-source-dir", "lean4SourceDir"],
    ["--typst-rendered-dir", "typstRenderedDir"],
    ["--haskell-rendered-dir", "haskellRenderedDir"],
  ]);

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--no-open") {
      options.noOpen = true;
      continue;
    }
    if (arg === "--host" || arg === "--port") {
      options[arg.slice(2)] = takeValue(args, index, arg);
      index += 1;
      continue;
    }
    if (internalFlags.has(arg)) {
      options[internalFlags.get(arg)] = takeValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--") continue;
    if (arg.startsWith("-")) {
      throw new Error(`unknown option ${arg}`);
    }
    if (options.page != null) {
      throw new Error("only one Markdown page may be supplied");
    }
    options.page = arg;
  }

  return options;
}

function normalizeRouteBase(routeBase) {
  if (!routeBase || routeBase === "/") return "/";
  const normalized = routeBase.startsWith("/") ? routeBase : `/${routeBase}`;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

function isWithin(root, target) {
  const relative = path.relative(root, target);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

function routeFileFor(sourceFile, contentRoot) {
  if (isWithin(contentRoot, sourceFile)) {
    return path.relative(contentRoot, sourceFile);
  }
  return path.basename(sourceFile);
}

function routeFromFile(routeFile, routeBase) {
  let route = routeFile.replace(/\\/g, "/").replace(/\.(md|mdx)$/i, "");
  if (route === "index") route = "";
  else if (route.endsWith("/index")) route = route.slice(0, -"/index".length);
  const base = normalizeRouteBase(routeBase);
  const suffix = route === "" ? "" : `/${route}`;
  return `${base === "/" ? "" : base}${suffix}/` || "/";
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function validateFrontmatter(sourceFile) {
  const source = await fs.readFile(sourceFile, "utf8");
  if (!source.startsWith("---\n") && !source.startsWith("---\r\n")) {
    throw new Error(
      "the page must start with YAML frontmatter containing title",
    );
  }
  const closing = source.search(/\r?\n---(?:\r?\n|$)/);
  if (closing === -1) {
    throw new Error("the page has an unterminated YAML frontmatter block");
  }
  const frontmatter = source.slice(4, closing);
  if (!/^title\s*:\s*\S/im.test(frontmatter)) {
    throw new Error("frontmatter must define a non-empty title");
  }
}

async function stagePage(options, sourceFile, routeFile, contentRoot) {
  await fs.mkdir(path.dirname(path.join(contentRoot, routeFile)), {
    recursive: true,
  });
  await fs.copyFile(sourceFile, path.join(contentRoot, routeFile));

  const stageArgs = [
    options.stageScript,
    "--content-dir",
    contentRoot,
    "--config-json",
    options.configJson,
    "--template-files-json",
    options.templateFilesJson,
    "--languages-json",
    options.languagesJson,
    "--out-dir",
    options.workdir,
  ];

  const optional = [
    ["--lean4-rendered-dir", options.lean4RenderedDir],
    ["--lean4-source-dir", options.lean4SourceDir],
    ["--typst-rendered-dir", options.typstRenderedDir],
    ["--haskell-rendered-dir", options.haskellRenderedDir],
  ];
  for (const [flag, value] of optional) {
    if (value != null) stageArgs.push(flag, value);
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, stageArgs, {
      cwd: options.workdir,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `staging failed${signal ? ` (${signal})` : ` with exit code ${code}`}`,
          ),
        );
    });
  });
}

async function waitForPage(url, server) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (server.exitCode != null) return false;
    try {
      const response = await fetch(url);
      if (response.ok) return true;
    } catch {
      // Astro is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

function browserCommand() {
  if (process.env.BROWSER) return process.env.BROWSER;
  if (process.platform === "darwin") return "open";
  if (process.platform === "linux") return "xdg-open";
  return null;
}

function openBrowser(url) {
  const command = browserCommand();
  if (!command) {
    console.error(
      "docs-preview-page: no browser launcher detected; open the URL manually",
    );
    return;
  }
  const child = spawn(command, [url], {
    detached: true,
    stdio: "ignore",
  });
  child.once("error", (error) => {
    console.error(
      `docs-preview-page: could not open browser: ${error.message}`,
    );
  });
  child.unref();
}

async function run(options) {
  if (options.help) {
    usage();
    return;
  }
  const required = [
    "workdir",
    "stageScript",
    "configJson",
    "templateFilesJson",
    "languagesJson",
  ];
  for (const key of required) {
    if (!options[key]) throw new Error(`internal option ${key} is missing`);
  }
  if (!options.page) throw new Error("a Markdown page is required");

  const sourceFile = path.resolve(process.cwd(), options.page);
  const extension = path.extname(sourceFile).toLowerCase();
  if (!MARKDOWN_EXTENSIONS.has(extension)) {
    throw new Error("the page must have a .md or .mdx extension");
  }
  const sourceStat = await fs.stat(sourceFile).catch(() => null);
  if (!sourceStat?.isFile()) throw new Error(`file not found: ${options.page}`);
  await validateFrontmatter(sourceFile);

  const contentRoot = path.join(options.workdir, ".docs-preview-content");
  const configuredRoot = path.resolve(
    process.cwd(),
    process.env.DOCS_PREVIEW_CONTENT_DIR || "docs",
  );
  const routeFile = routeFileFor(sourceFile, configuredRoot);
  const stagedFile = path.join(
    options.workdir,
    "src",
    "content",
    "docs",
    routeFile,
  );
  const config = await readJson(options.configJson);
  const previewConfig = {
    ...config,
    content: {
      ...(config.content ?? {}),
      // The explicitly selected page is previewable even when it lives under
      // a published-site exclusion such as `private`.
      excludePaths: [],
    },
    navigation: {
      ...(config.navigation ?? {}),
      // A one-page tree cannot satisfy a production site's strict directory
      // order or explicit entries. Keep labels, but derive navigation from
      // the staged page and any generated integration pages.
      sections: null,
      topLevelOrder: null,
    },
  };
  const previewConfigJson = path.join(
    options.workdir,
    "docs-preview-config.json",
  );
  await fs.writeFile(previewConfigJson, `${JSON.stringify(previewConfig)}\n`);

  await fs.mkdir(contentRoot, { recursive: true });
  await stagePage(
    { ...options, configJson: previewConfigJson },
    sourceFile,
    routeFile,
    contentRoot,
  );

  const env = {
    ...process.env,
    DOCS_SITE_URL: config.site.publicBaseUrl,
    DOCS_ROUTE_BASE: normalizeRouteBase(config.site.routeBase),
  };
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const npmCi = spawn(npm, ["ci", "--no-fund", "--no-audit"], {
    cwd: options.workdir,
    env,
    stdio: "inherit",
  });
  const ciCode = await new Promise((resolve, reject) => {
    npmCi.once("error", reject);
    npmCi.once("exit", (code, signal) => resolve(code ?? 1));
  });
  if (ciCode !== 0) throw new Error(`npm ci failed with exit code ${ciCode}`);

  const server = spawn(
    npm,
    ["run", "dev", "--", "--host", options.host, "--port", options.port],
    {
      cwd: options.workdir,
      env,
      stdio: "inherit",
    },
  );
  const stopServer = () => {
    if (server.exitCode == null) server.kill("SIGTERM");
  };
  process.once("SIGINT", stopServer);
  process.once("SIGTERM", stopServer);

  const route = routeFromFile(routeFile, config.site.routeBase);
  const displayHost = options.host === "0.0.0.0" ? "127.0.0.1" : options.host;
  const url = `http://${displayHost}:${options.port}${route}`;
  console.log(`docs-preview-page: ${url}`);

  const ready = await waitForPage(url, server);
  if (!ready) {
    console.error(
      "docs-preview-page: Astro did not become ready within 30 seconds",
    );
  } else if (!options.noOpen) {
    openBrowser(url);
  }

  let lastSignature = `${sourceStat.mtimeMs}:${sourceStat.size}`;
  let pendingCopy = null;
  const mirrorSource = async () => {
    const stat = await fs.stat(sourceFile).catch(() => null);
    if (!stat?.isFile()) return;
    const signature = `${stat.mtimeMs}:${stat.size}`;
    if (signature === lastSignature || pendingCopy != null) return;
    pendingCopy = setTimeout(async () => {
      pendingCopy = null;
      try {
        await fs.copyFile(sourceFile, stagedFile);
        lastSignature = signature;
      } catch (error) {
        console.error(
          `docs-preview-page: could not mirror source: ${error.message}`,
        );
      }
    }, 100);
  };
  const watcher = setInterval(mirrorSource, 250);

  await new Promise((resolve) => server.once("exit", resolve));
  clearInterval(watcher);
  if (pendingCopy != null) clearTimeout(pendingCopy);
  process.removeListener("SIGINT", stopServer);
  process.removeListener("SIGTERM", stopServer);
}

try {
  await run(parseArguments(process.argv.slice(2)));
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
