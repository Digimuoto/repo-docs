{pkgs, lib, repoRoot}: let
  npmDepsHash = "sha256-oSpjRL92D1MDADfN8Jh03tIfhgEieNxCk7PNNo/x1Tw=";
  templateDir = repoRoot + "/template";
  stageScript = repoRoot + "/scripts/stage-docs-site.mjs";

  mkApp = {
    name,
    contentDir,
    config,
    templateFiles,
    mode,
    port,
  }:
    pkgs.writeShellApplication {
      inherit name;
      runtimeInputs = [
        pkgs.nodejs_22
      ];
      text = ''
        set -euo pipefail

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
          --config-json ${pkgs.writeText "${name}-config.json" (builtins.toJSON config)} \
          --template-files-json ${pkgs.writeText "${name}-template-files.json" (builtins.toJSON (lib.mapAttrs (_: value: toString value) templateFiles))} \
          --out-dir "$workdir"

        cd "$workdir"
        source build-env.sh
        npm ci --no-fund --no-audit

        if [ "${mode}" = "preview" ]; then
          npm run build
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
        --out-dir "$out"
    '';

    package = pkgs.buildNpmPackage {
      pname = name;
      version = "0.1.0";
      src = stagedSrc;
      inherit npmDepsHash;

      buildPhase = ''
        runHook preBuild
        source build-env.sh
        npm run build
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
      inherit contentDir config templateFiles;
      mode = "dev";
      port = 4321;
    };

    previewApp = mkApp {
      name = "${name}-preview";
      inherit contentDir config templateFiles;
      mode = "preview";
      port = 4322;
    };
  in {
    inherit stagedSrc package devApp previewApp;
  }
