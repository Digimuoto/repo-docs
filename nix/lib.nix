{pkgs, lib, repoRoot}: let
  npmDepsHash = "sha256-aY4J9BrCl/J37ux4BmbBo9D5R0JnItpn2LoHRIIERNk=";
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

  defaultLean4Deps = with pkgs.leanPackages; [
    mathlib
    batteries
    aesop
    Qq
    proofwidgets
    plausible
    LeanSearchClient
    importGraph
    Cli
  ];

  mkLean4VersoHtml = {
    name,
    lean4SourceDir,
    lean4Deps,
  }: let
    allLeanDeps = lib.unique (
      builtins.concatMap (dep: [dep] ++ (dep.passthru.allLeanDeps or [])) lean4Deps
    );
    overridesFile = pkgs.writeText "${name}-lean4-overrides.json" (
      builtins.toJSON {
        schemaVersion = "1.2.0";
        packages = map (dep: {
          type = "path";
          name = dep.passthru.lakePackageName or dep.pname;
          inherited = false;
          dir = "${dep}";
        }) allLeanDeps;
      }
    );
  in
    pkgs.stdenv.mkDerivation {
      pname = "${name}-lean4-theory";
      version = "0.1.0";
      src = lean4SourceDir;

      nativeBuildInputs = [
        pkgs.gitMinimal
        # Match the Lean toolchain used by pkgs.leanPackages.* artifacts so
        # Lake can reuse dependency config traces from the Nix store.
        pkgs.leanPackages.lean4
      ];
      buildInputs = allLeanDeps;

      dontConfigure = true;

      buildPhase = ''
        runHook preBuild

        export HOME="$TMPDIR"
        export LAKE_NO_CACHE=1
        export RESERVOIR_API_URL=""
        export LEAN_CC="${pkgs.stdenv.cc}/bin/cc"

        if [ ! -f lakefile.lean ]; then
          echo "docsSite.lean4.theoryDir must point to a Lean Lake project with a lakefile.lean" >&2
          exit 1
        fi

        modules_file="$TMPDIR/lean-modules"
        : > "$modules_file"
        while IFS= read -r file; do
          rel="''${file#./}"
          module="''${rel%.lean}"
          module="''${module//\//.}"
          case "$module" in
            lakefile|Main) continue ;;
          esac
          printf '%s\n' "$module" >> "$modules_file"
        done < <(find . -type f -name '*.lean' -not -path './.lake/*' | sort)

        if [ ! -s "$modules_file" ]; then
          echo "No Lean modules found under docsSite.lean4.theoryDir" >&2
          exit 1
        fi

        lake build --no-ansi --packages=${overridesFile} $(tr '\n' ' ' < "$modules_file")

        export LEAN_PATH="$PWD/.lake/build/lib/lean''${LEAN_PATH:+:$LEAN_PATH}"
        json_dir="$TMPDIR/literate-json"
        module_map="$TMPDIR/literate-module-map"
        mkdir -p "$json_dir"
        : > "$module_map"

        while IFS= read -r module; do
          json_path="$json_dir/$module.json"
          ${verso}/bin/verso-literate "$module" "$json_path"
          printf '%s\t%s\t%s\n' "$module" "$json_path" "$PWD" >> "$module_map"
        done < "$modules_file"

        ${verso}/bin/verso-literate-html "$out" "$module_map"

        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall
        runHook postInstall
      '';
    };

  # Serialise the attrset of built grammars to a form the staging script
  # can consume: { "<name>": { parser = "/nix/store/.../parser.wasm";
  # queries = "/nix/store/.../queries"; aliases = [...]; }, ... }.
  languagesManifest = languages:
    lib.mapAttrs (_: entry: {
      parser = "${entry.wasm}/parser.wasm";
      queries = "${entry.wasm}/queries";
      aliases = entry.aliases;
    }) languages;

  mkApp = {
    name,
    contentDir,
    config,
    lean4SourceDir,
    lean4RenderedDir,
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
    lean4RenderedDir =
      if lean4SourceDir == null
      then null
      else mkLean4VersoHtml {inherit name lean4SourceDir lean4Deps;};
    stagedSrc = pkgs.runCommand "${name}-src" {
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
      inherit contentDir config lean4SourceDir lean4RenderedDir templateFiles languages;
      mode = "dev";
      port = 4321;
    };

    previewApp = mkApp {
      name = "${name}-preview";
      inherit contentDir config lean4SourceDir lean4RenderedDir templateFiles languages;
      mode = "preview";
      port = 4322;
    };
  in {
    inherit stagedSrc package devApp previewApp;
  }
