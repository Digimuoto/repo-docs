{
  pkgs,
  lib,
  repoRoot,
}: let
  npmDepsHash = "sha256-hzofBxSfUOjq0A0ZdNWqTYUxrpuoyJPjHvIZ3EY6Ois=";
  templateDir = repoRoot + "/template";
  stageScript = repoRoot + "/scripts/stage-docs-site.mjs";

  verso = pkgs.leanPackages.buildLakePackage {
    pname = "verso";
    version = "4.29.0";
    src = pkgs.fetchFromGitHub {
      owner = "leanprover";
      repo = "verso";
      rev = "v4.29.0";
      hash = "sha256-5eo/xbPNbS9/Bv7tfnXz52mUo/CXG6mnLWg8h6mg6FE=";
    };
    leanPackageName = "verso";
    lakeHash = "sha256-Au5+nWIbba7lJzVYjrvltm65as19cry7CEsGuKvk3VY=";
    leanDeps = [pkgs.leanPackages.plausible];
    buildTargets = [
      "Verso"
      "VersoLiterate"
      "VersoLiterateCode"
      "verso-literate"
      "verso-literate-html"
      "verso-literate-plan"
    ];
  };

  # Minimal Lean 4 dependency set — only what the in-repo fixture
  # imports (`import Batteries`). The previous default included
  # mathlib, which transitively pulls in aesop / Qq / proofwidgets /
  # plausible / LeanSearchClient / importGraph / Cli AND turns CI
  # builds into multi-hour mathlib compiles when the binary cache
  # misses. Consumers who genuinely need mathlib should override
  # `lean4Deps` at the call site. Verso brings its own plausible
  # dependency along separately.
  defaultLean4Deps = with pkgs.leanPackages; [
    batteries
  ];

  typstPlugin = import ./plugins/typst.nix {inherit pkgs lib;};
  haskellPlugin = import ./plugins/haskell.nix {inherit pkgs lib;};
  lean4Plugin = import ./plugins/lean4.nix {inherit pkgs lib verso;};

  mkTypstManuscripts = {
    name,
    contentDir,
    typstManuscripts,
  }:
    typstPlugin.mkBuild {
      inherit name contentDir;
      pluginConfig = typstManuscripts;
    };

  mkHaskellHaddockDocs = {
    name,
    contentDir,
    haskellPackages,
  }:
    haskellPlugin.mkBuild {
      inherit name contentDir;
      pluginConfig = haskellPackages;
    };

  mkLean4VersoHtml = {
    name,
    lean4SourceDir,
    lean4Deps,
  }:
    lean4Plugin.mkBuild {
      inherit name;
      pluginConfig = {
        sourceDir = lean4SourceDir;
        deps = lean4Deps;
      };
    };

  # Serialise the attrset of built grammars to a form the staging script
  # can consume: { "<name>": { parser = "/nix/store/.../parser.wasm";
  # queries = "/nix/store/.../queries"; aliases = [...]; }, ... }.
  languagesManifest = languages:
    lib.mapAttrs (_: entry: {
      parser = "${entry.wasm}/parser.wasm";
      queries = "${entry.wasm}/queries";
      aliases = entry.aliases;
    })
    languages;

  mkApp = {
    name,
    contentDir,
    config,
    lean4SourceDir,
    lean4RenderedDir,
    typstRenderedDir,
    haskellRenderedDir,
    templateFiles,
    languages,
    mode,
    port,
  }:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [
        pkgs.nodejs_22
        pkgs.pagefind
      ];
      excludeShellChecks = ["SC1091" "SC2050"];
      text = let
        configJson = pkgs.writeText "${name}-config.json" (builtins.toJSON config);
        templateFilesJson = pkgs.writeText "${name}-template-files.json" (builtins.toJSON (lib.mapAttrs (_: value: toString value) templateFiles));
        languagesJson = pkgs.writeText "${name}-languages.json" (builtins.toJSON (languagesManifest languages));
      in ''
                host="''${HOST:-127.0.0.1}"
                port="''${PORT:-${toString port}}"
                workdir="$(mktemp -d "''${TMPDIR:-/tmp}/${name}-XXXXXX")"

                cleanup() {
                  rm -rf "$workdir"
                }

                trap cleanup EXIT

                cp -R ${templateDir}/. "$workdir"
                chmod -R u+w "$workdir"

                stageArgs=(
                  --content-dir ${contentDir}
                  --config-json ${configJson}
                  --template-files-json ${templateFilesJson}
                  --languages-json ${languagesJson}
        ${lib.optionalString (lean4RenderedDir != null) ''
          --lean4-rendered-dir ${lean4RenderedDir}
          --lean4-source-dir ${lean4SourceDir}
        ''}${lib.optionalString (typstRenderedDir != null) ''
          --typst-rendered-dir ${typstRenderedDir}
        ''}${lib.optionalString (haskellRenderedDir != null) ''
          --haskell-rendered-dir ${haskellRenderedDir}
        ''}          --out-dir "$workdir"
                )
                node ${stageScript} "''${stageArgs[@]}"

                cd "$workdir"
                source build-env.sh
                npm ci --no-fund --no-audit

                if [ "${mode}" = "preview" ]; then
                  npm run build
                  # Generate the Pagefind static index alongside the built site.
                  # Failures shouldn't block the preview — search just won't work.
                  pagefind --site dist || echo "[pagefind] index generation failed; continuing without search"
                  npm run preview -- --host "$host" --port "$port"
                else
                  npm run dev -- --host "$host" --port "$port"
                fi
      '';
    };
in
  {
    name,
    contentDir,
    config,
    lean4SourceDir ? null,
    lean4Deps ? defaultLean4Deps,
    templateFiles ? {},
    languages ? {},
  }: let
    typstManuscripts =
      if config ? typst && config.typst ? manuscripts
      then config.typst.manuscripts
      else {};
    haskellPackages =
      if config ? haskell && config.haskell ? packages
      then config.haskell.packages
      else {};
    lean4RenderedDir =
      if lean4SourceDir == null
      then null
      else mkLean4VersoHtml {inherit name lean4SourceDir lean4Deps;};
    typstRenderedDir =
      if typstManuscripts == {}
      then null
      else mkTypstManuscripts {inherit name contentDir typstManuscripts;};
    haskellRenderedDir =
      if haskellPackages == {}
      then null
      else mkHaskellHaddockDocs {inherit name contentDir haskellPackages;};
    stagedSrc =
      pkgs.runCommand "${name}-src" {
        nativeBuildInputs = [
          pkgs.nodejs_22
        ];
      } ''
              set -euo pipefail

              cp -R ${templateDir}/. "$out"
              chmod -R u+w "$out"

              stageArgs=(
                --content-dir ${contentDir}
                --config-json ${pkgs.writeText "${name}-config.json" (builtins.toJSON config)}
                --template-files-json ${pkgs.writeText "${name}-template-files.json" (builtins.toJSON (lib.mapAttrs (_: value: toString value) templateFiles))}
                --languages-json ${pkgs.writeText "${name}-languages.json" (builtins.toJSON (languagesManifest languages))}
        ${lib.optionalString (lean4SourceDir != null) ''
          --lean4-rendered-dir ${lean4RenderedDir}
          --lean4-source-dir ${lean4SourceDir}
        ''}${lib.optionalString (typstRenderedDir != null) ''
          --typst-rendered-dir ${typstRenderedDir}
        ''}${lib.optionalString (haskellRenderedDir != null) ''
          --haskell-rendered-dir ${haskellRenderedDir}
        ''}        --out-dir "$out"
              )
              node ${stageScript} "''${stageArgs[@]}"
      '';

    package = pkgs.buildNpmPackage {
      pname = name;
      version = "0.1.0";
      src = stagedSrc;
      inherit npmDepsHash;

      nativeBuildInputs = [pkgs.pagefind];

      buildPhase = ''
        runHook preBuild
        source build-env.sh
        npm run build
        # Static-search index. Pagefind reads dist/ HTML output and
        # writes its own index + UI bundle into dist/pagefind/.
        pagefind --site dist || echo "[pagefind] index generation failed; continuing without search"
        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        cp -r dist "$out"
        runHook postInstall
      '';

      dontNpmInstall = true;
    };

    devApp = mkApp {
      name = "${name}-dev";
      inherit contentDir config lean4SourceDir lean4RenderedDir typstRenderedDir haskellRenderedDir templateFiles languages;
      mode = "dev";
      port = 4321;
    };

    previewApp = mkApp {
      name = "${name}-preview";
      inherit contentDir config lean4SourceDir lean4RenderedDir typstRenderedDir haskellRenderedDir templateFiles languages;
      mode = "preview";
      port = 4322;
    };
  in {
    inherit stagedSrc package devApp previewApp;
  }
