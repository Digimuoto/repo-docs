{
  pkgs,
  lib,
}: let
  /*
  * Typst stack plugin.
  *
  * Compiles each manuscript declared under `docsSite.typst.manuscripts`
  * into a PDF and emits a manifest the staging script reads to drop
  * markdown stubs + copy the assets into `public/`.
  *
  * Each manuscript's directory must contain a `repo-docs-typst.json`
  * metadata file with at minimum an `entry` field naming the Typst
  * source. Optional fields:
  *   - output:      output filename (defaults to `manuscript.pdf`)
  *   - route:       URL route under the site (defaults to
  *                  `<parent>/<output-without-ext>`)
  *   - title:       page title (defaults to the manuscript key)
  *   - description: short description for the manuscript card
  *   - sidebar:     `{ label?, order? }` overrides for the nav entry
  */
  mkBuild = {
    name,
    contentDir,
    pluginConfig,
  }: let
    manuscriptsFile =
      pkgs.writeText "${name}-typst-manuscripts.json"
      (builtins.toJSON pluginConfig);
  in
    pkgs.stdenv.mkDerivation {
      pname = "${name}-typst-manuscripts";
      version = "0.1.0";
      src = contentDir;

      nativeBuildInputs = [
        pkgs.jq
        pkgs.typst
      ];

      dontConfigure = true;

      buildPhase = ''
        runHook preBuild

        mkdir -p "$out/assets"
        items="$TMPDIR/typst-manuscripts.jsonl"
        : > "$items"

        while IFS= read -r key; do
          dir=$(jq -r --arg key "$key" '.[$key].dir // empty' ${manuscriptsFile})
          if [ -z "$dir" ]; then
            echo "docsSite.typst.manuscripts.$key.dir must be set" >&2
            exit 1
          fi

          case "$dir" in
            /*|*..*)
              echo "docsSite.typst.manuscripts.$key.dir must be a relative docs path without '..'" >&2
              exit 1
              ;;
          esac

          manifest="$PWD/$dir/repo-docs-typst.json"
          if [ ! -f "$manifest" ]; then
            echo "Typst manuscript '$key' is missing $dir/repo-docs-typst.json" >&2
            exit 1
          fi

          entry=$(jq -r '.entry // empty' "$manifest")
          if [ -z "$entry" ]; then
            echo "Typst manuscript '$key' manifest must define entry" >&2
            exit 1
          fi

          output=$(jq -r '.output // "manuscript.pdf"' "$manifest")
          case "$output" in
            *.pdf) ;;
            *)
              echo "Typst manuscript '$key' output must end in .pdf" >&2
              exit 1
              ;;
          esac

          route=$(jq -r '.route // empty' "$manifest")
          if [ -z "$route" ]; then
            parent="''${dir%/*}"
            route="$parent/''${output%.pdf}"
          fi

          title=$(jq -r '.title // empty' "$manifest")
          if [ -z "$title" ]; then
            title="$key"
          fi
          description=$(jq -r '.description // empty' "$manifest")
          sidebar=$(jq -c '.sidebar // {}' "$manifest")

          asset="''${key//[^A-Za-z0-9_.-]/-}.pdf"
          typst compile --root "$PWD" "$dir/$entry" "$out/assets/$asset"

          jq -n \
            --arg key "$key" \
            --arg dir "$dir" \
            --arg route "$route" \
            --arg title "$title" \
            --arg description "$description" \
            --arg asset "$asset" \
            --argjson sidebar "$sidebar" \
            '{key: $key, dir: $dir, route: $route, title: $title, description: $description, asset: $asset, sidebar: $sidebar}' \
            >> "$items"
        done < <(jq -r 'keys[]' ${manuscriptsFile})

        jq -s '.' "$items" > "$out/manuscripts.json"

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
