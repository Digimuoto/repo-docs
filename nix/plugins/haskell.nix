{
  pkgs,
  lib,
}: let
  /*
  * Haskell stack plugin.
  *
  * For each entry under `docsSite.haskell.packages`, builds the
  * package's Haddock with --quickjump (so doc-index.json lands and
  * the embedded API search can fuzzy-match) and copies the
  * share/doc/<pkg>/html tree into the rendered output. The staging
  * script reads the accompanying packages.json manifest to drop
  * markdown stubs and copy the HTML into the consumer's public/
  * tree.
  *
  * Each package config carries:
  *   - packageDir:       relative path from the consumer repo root
  *                       to the cabal project directory.
  *   - packageName:      override the cabal package name (defaults
  *                       to the attr key).
  *   - components:       list of cabal components to include
  *                       (also accepts a single `component` for
  *                       backwards compatibility).
  *   - modulePrefixes:   module-name prefixes the staging step uses
  *                       to scope its sidebar generation.
  *   - title:            user-visible package title (defaults to
  *                       packageName).
  *   - description:      short description for the package card.
  */
  mkBuild = {
    name,
    contentDir,
    pluginConfig,
  }: let
    packageEntries =
      lib.mapAttrsToList (key: cfg: let
        singleComponent =
          if cfg ? component && cfg.component != null && cfg.component != ""
          then [cfg.component]
          else [];
        components = lib.unique (
          singleComponent
          ++ (
            if cfg ? components && cfg.components != null
            then cfg.components
            else []
          )
        );
        modulePrefixes =
          if cfg ? modulePrefixes && cfg.modulePrefixes != null
          then cfg.modulePrefixes
          else [];
        packageName =
          if cfg ? packageName && cfg.packageName != null && cfg.packageName != ""
          then cfg.packageName
          else key;
        sourceDir = builtins.dirOf contentDir + "/${cfg.packageDir}";
        # Nixpkgs only adds Haddock's --quickjump when
        # doHaddockQuickjump is true. That writes doc-index.json, which
        # the embedded API search consumes for fuzzy package search.
        package = pkgs.haskell.lib.dontCheck (
          pkgs.haskell.lib.doHaddock (
            pkgs.haskell.lib.overrideCabal
            (pkgs.haskellPackages.callCabal2nix packageName sourceDir {})
            (_: {
              doHaddockQuickjump = true;
            })
          )
        );
      in {
        inherit key packageName components modulePrefixes;
        title =
          if cfg ? title && cfg.title != null && cfg.title != ""
          then cfg.title
          else packageName;
        description =
          if cfg ? description && cfg.description != null
          then cfg.description
          else "";
        doc = "${package.doc}";
      })
      pluginConfig;
    packagesFile = pkgs.writeText "${name}-haskell-haddock-packages.json" (builtins.toJSON packageEntries);
  in
    pkgs.stdenv.mkDerivation {
      pname = "${name}-haskell-haddock";
      version = "0.1.0";

      nativeBuildInputs = [pkgs.jq];

      dontUnpack = true;
      dontConfigure = true;

      buildPhase = ''
        runHook preBuild

        mkdir -p "$out/packages"
        items="$TMPDIR/haskell-haddock-packages.jsonl"
        : > "$items"

        while IFS= read -r key; do
          package_name=$(jq -r --arg key "$key" '.[] | select(.key == $key) | .packageName' ${packagesFile})
          title=$(jq -r --arg key "$key" '.[] | select(.key == $key) | .title' ${packagesFile})
          description=$(jq -r --arg key "$key" '.[] | select(.key == $key) | .description' ${packagesFile})
          components=$(jq -c --arg key "$key" '.[] | select(.key == $key) | .components' ${packagesFile})
          module_prefixes=$(jq -c --arg key "$key" '.[] | select(.key == $key) | .modulePrefixes' ${packagesFile})
          doc=$(jq -r --arg key "$key" '.[] | select(.key == $key) | .doc' ${packagesFile})
          safe_key=$(printf '%s' "$key" | tr -c 'A-Za-z0-9_.-' '-')

          if [ -z "$safe_key" ]; then
            echo "docsSite.haskell.packages key must contain at least one URL-safe character" >&2
            exit 1
          fi

          html_dirs=("$doc"/share/doc/*/html)
          if [ ! -d "''${html_dirs[0]}" ]; then
            echo "Haddock output for '$key' did not contain share/doc/*/html" >&2
            exit 1
          fi

          target="$out/packages/$safe_key/html"
          mkdir -p "$target"
          cp -R "''${html_dirs[0]}"/. "$target"
          chmod -R u+w "$target"

          jq -n \
            --arg key "$key" \
            --arg safeKey "$safe_key" \
            --arg packageName "$package_name" \
            --arg title "$title" \
            --arg description "$description" \
            --argjson components "$components" \
            --argjson modulePrefixes "$module_prefixes" \
            '{key: $key, safeKey: $safeKey, packageName: $packageName, title: $title, description: $description, components: $components, modulePrefixes: $modulePrefixes}' \
            >> "$items"
        done < <(jq -r '.[].key' ${packagesFile})

        jq -s '.' "$items" > "$out/packages.json"

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
