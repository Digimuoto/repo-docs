{
  pkgs,
  lib,
  verso,
}: let
  /*
  * Lean 4 stack plugin.
  *
  * Builds a Lean Lake project, then pipes each module through
  * verso-literate / verso-literate-html to produce a tree of HTML
  * fragments the staging script wires into the docs sidebar. Lake
  * dependencies are resolved from the Nix store via a generated
  * lake-manifest packages override (so the build is offline and
  * reproducible — no GitHub fetches at evaluation time).
  *
  * Verso is built once at the top of nix/lib.nix and threaded into
  * this plugin at import time so the heavyweight Lean toolchain
  * derivation is shared across sites that enable Lean.
  *
  * Plugin config carries:
  *   - sourceDir: absolute path to the Lake project (the consumer
  *                repo's lean4.theoryDir, resolved against the
  *                content tree).
  *   - deps:      Lean dependency derivations Lake should resolve
  *                from the Nix store rather than fetching from
  *                Reservoir / GitHub.
  *
  * `contentDir` is part of the plugin contract for symmetry with
  * Typst / Haskell but unused here — Lean's sources sit beside the
  * docs/ tree, not under it.
  */
  mkBuild = {
    name,
    contentDir ? null,
    pluginConfig,
  }: let
    sourceDir = pluginConfig.sourceDir;
    deps = pluginConfig.deps;
    allLeanDeps = lib.unique (
      builtins.concatMap (dep: [dep] ++ (dep.passthru.allLeanDeps or [])) deps
    );
    overridesFile = pkgs.writeText "${name}-lean4-overrides.json" (
      builtins.toJSON {
        schemaVersion = "1.2.0";
        packages =
          map (dep: {
            type = "path";
            name = dep.passthru.lakePackageName or dep.pname;
            inherited = false;
            dir = "${dep}";
          })
          allLeanDeps;
      }
    );
  in
    pkgs.stdenv.mkDerivation {
      pname = "${name}-lean4-theory";
      version = "0.1.0";
      src = sourceDir;

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
in {
  inherit mkBuild;
}
