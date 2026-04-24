{pkgs, lib, repoRoot}: let
  npmDepsHash = "sha256-aY4J9BrCl/J37ux4BmbBo9D5R0JnItpn2LoHRIIERNk=";
  templateDir = repoRoot + "/template";
  stageScript = repoRoot + "/scripts/stage-docs-site.mjs";

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

        node ${stageScript} \
          --content-dir ${contentDir} \
          --config-json ${configJson} \
          --template-files-json ${templateFilesJson} \
          --languages-json ${languagesJson} \
          --out-dir "$workdir"

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
    templateFiles ? {},
    languages ? {},
  }: let
    stagedSrc = pkgs.runCommand "${name}-src" {
      nativeBuildInputs = [
        pkgs.nodejs_22
      ];
    } ''
      set -euo pipefail

      cp -R ${templateDir}/. "$out"
      chmod -R u+w "$out"

      node ${stageScript} \
        --content-dir ${contentDir} \
        --config-json ${pkgs.writeText "${name}-config.json" (builtins.toJSON config)} \
        --template-files-json ${pkgs.writeText "${name}-template-files.json" (builtins.toJSON (lib.mapAttrs (_: value: toString value) templateFiles))} \
        --languages-json ${pkgs.writeText "${name}-languages.json" (builtins.toJSON (languagesManifest languages))} \
        --out-dir "$out"
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
      inherit contentDir config templateFiles languages;
      mode = "dev";
      port = 4321;
    };

    previewApp = mkApp {
      name = "${name}-preview";
      inherit contentDir config templateFiles languages;
      mode = "preview";
      port = 4322;
    };
  in {
    inherit stagedSrc package devApp previewApp;
  }
