{
  description = "Reusable docs layout module for flake-parts repositories";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
  };

  outputs = inputs @ {
    flake-parts,
    ...
  }: let
    docsModule = import ./nix/flake-module.nix;
  in
    flake-parts.lib.mkFlake {inherit inputs;} {
      systems = ["x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin"];
      imports = [docsModule];

      flake.flakeModules.default = docsModule;

      perSystem = {
        config,
        pkgs,
        lib,
        ...
      }: let
        mkAssertionCheck = {
          name,
          script,
        }:
          pkgs.runCommand name {} ''
            set -euo pipefail
            ${script}
            touch "$out"
          '';
        mkDocsSite = import ./nix/lib.nix {
          inherit pkgs lib;
          repoRoot = ./.;
        };
      in {
        docsSite = {
          enable = true;
          contentDir = ./docs;
          excludePaths = ["private"];
          site = {
            title = "repo-docs";
            tagline = "Documentation";
            description = "Reusable docs layout module for flake-parts repositories";
            publicBaseUrl = "https://digimuoto.github.io/repo-docs";
            routeBase = "/repo-docs";
          };
          navigation.sectionLabels = {
            guides = "Guides";
          };
        };

        checks = {
          docs-html = mkAssertionCheck {
            name = "docs-html";
            script = ''
              site="${config.packages.docs-site}"
              test -f "$site/index.html"
              test -f "$site/guides/getting-started/index.html"
              test -f "$site/guides/rendering-example/index.html"
              test ! -e "$site/private/notes/index.html"
              grep -q "repo-docs" "$site/index.html"

              # Rendering example has mermaid diagrams
              grep -q "data-docs-mermaid=\"true\"" "$site/guides/rendering-example/index.html"
              grep -q "data-docs-mermaid=\"false\"" "$site/index.html"

              # KaTeX math is rendered (display math produces katex-display class)
              grep -q "katex-display" "$site/guides/rendering-example/index.html"
              # Inline math is rendered (katex class on inline spans)
              grep -q "katex" "$site/guides/rendering-example/index.html"
            '';
          };

          docs-explicit-nav = let
            explicitSite = mkDocsSite {
              name = "docs-explicit-nav";
              contentDir = ./docs;
              config = {
                site = {
                  title = "explicit-nav-test";
                  publicBaseUrl = "https://example.com";
                };
                navigation = {
                  sections = [
                    {
                      label = "Overview";
                      entries = ["/" "guides/getting-started"];
                    }
                    {
                      label = "Guides";
                      dir = "guides";
                    }
                  ];
                };
                content.excludePaths = ["private"];
              };
            };
          in
            mkAssertionCheck {
              name = "docs-explicit-nav";
              script = ''
                site="${explicitSite.package}"
                # "/" entry resolves to index page
                test -f "$site/index.html"
                test -f "$site/guides/getting-started/index.html"
                test ! -e "$site/private/notes/index.html"
                grep -q "explicit-nav-test" "$site/index.html"

                # Explicit entries must preserve config order: "/" before "guides/getting-started".
                # Alphabetical sort would put "Getting Started" before "repo-docs", so this
                # catches regressions if .sort(comparePages) is re-added to explicit entries.
                sidebar=$(grep -o '<aside[^>]*>.*</aside>' "$site/index.html")
                repo_pos=$(printf '%s' "$sidebar" | grep -bo 'repo-docs' | head -1 | cut -d: -f1)
                gs_pos=$(printf '%s' "$sidebar" | grep -bo 'Getting Started' | head -1 | cut -d: -f1)
                test -n "$repo_pos"
                test -n "$gs_pos"
                test "$repo_pos" -lt "$gs_pos"
              '';
            };

          docs-template-override = let
            customRouteFile = pkgs.writeText "custom-route.astro" ''
              ---
              import DocsPage from "../components/DocsPage.astro";
              import {getDocStaticPaths} from "../lib/docs-routes";
              // CUSTOM_ROUTE_OVERRIDE_MARKER
              export const getStaticPaths = getDocStaticPaths;
              const props = Astro.props;
              ---
              <DocsPage {...props} />
            '';
            overrideSite = mkDocsSite {
              name = "docs-tpl-override";
              contentDir = ./docs;
              config = {
                site = {
                  title = "override-test";
                  publicBaseUrl = "https://example.com";
                };
                content.excludePaths = ["private"];
              };
              templateFiles = {
                "src/pages/[...slug].astro" = customRouteFile;
              };
            };
          in
            mkAssertionCheck {
              name = "docs-template-override";
              script = ''
                # Consumer-provided route file must survive staging. If writeRoutePage
                # ran after applyTemplateOverrides, the marker would be overwritten.
                staged="${overrideSite.stagedSrc}"
                grep -q "CUSTOM_ROUTE_OVERRIDE_MARKER" "$staged/src/pages/[...slug].astro"
              '';
            };
        };

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [nodejs_22];

          shellHook = ''
            echo "repo-docs dev shell"
            echo "  nix build .#docs-site"
            echo "  nix run .#docs-dev"
          '';
        };
      };
    };
}
