{
  description = "Reusable docs layout module for flake-parts repositories";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";

    # Smoke-test grammar for the tree-sitter highlighting feature.
    # Flake following is disabled so the grammar pulls its own nixpkgs.
    tree-sitter-json = {
      url = "github:tree-sitter/tree-sitter-json";
      flake = false;
    };
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

          sites.docs = {
            contentDir = ./docs;
            excludePaths = ["private"];
            theme = "cortex-light";
            themeModes = {
              light = "cortex-light";
              dark = "cortex-slate";
            };
            site = {
              title = "repo-docs";
              tagline = "Documentation";
              description = "Reusable docs layout module for flake-parts repositories";
              publicBaseUrl = "https://digimuoto.github.io/repo-docs";
              routeBase = "/repo-docs";
            };
            repo.repoUrl = "https://github.com/Digimuoto/repo-docs";
            navigation = {
              sectionLabels.guides = "Guides";
              topLevelOrder = ["guides"];
            };
            lean4.theoryDir = "fixtures/lean-theory";
            haskell.packages.demo = {
              packageDir = "fixtures/haskell-haddock";
              packageName = "repo-docs-haddock-demo";
              title = "Haddock Demo API";
              description = "Generated Haddock API fixture.";
            };
            languages.ts-json = {
              grammarSrc = inputs.tree-sitter-json;
              aliases = ["ts-json"];
            };
          };

          # Second site dogfooding the multi-site API. Lives under
          # docs-internal/, uses the dark theme, and is published as
          # packages.internal-site / apps.internal-{dev,preview}.
          sites.internal = {
            contentDir = ./docs-internal;
            theme = "cortex-dark";
            site = {
              title = "repo-docs internal";
              tagline = "Internal notes";
              description = "Second docs site exercising the multi-site Nix API";
              publicBaseUrl = "https://digimuoto.github.io/repo-docs-internal";
              routeBase = "/internal";
            };
          };
        };

        checks = {
          # Multi-site regression: both dogfood sites build, each lands
          # at the expected output name, themes wire correctly (the
          # docs site has themeModes enabled; the internal site uses
          # the static dark palette), and only the docs site carries
          # the ts-json tree-sitter block (so cross-talk between sites
          # is caught).
          docs-multi-site = mkAssertionCheck {
            name = "docs-multi-site";
            script = ''
              docs="${config.packages.docs-site}"
              internal="${config.packages.internal-site}"

              # Both sites land their index page.
              test -f "$docs/index.html"
              test -f "$internal/index.html"

              # docs has themeModes — both palette names should be
              # surfaced as data attributes for the pre-paint script.
              grep -q 'data-mode-light="cortex-light"' "$docs/index.html"
              grep -q 'data-mode-dark="cortex-slate"' "$docs/index.html"
              # internal stays single-theme cortex-dark.
              grep -q 'data-theme="cortex-dark"' "$internal/index.html"

              # Repo link wires through to the sidebar when repoUrl is set.
              grep -q 'docs-sidebar-repo' "$docs/index.html"

              # Site title metadata is per-site.
              grep -q "repo-docs internal" "$internal/index.html"

              # Tree-sitter language registration is per-site too: the
              # ts-json grammar is only attached to the docs site.
              grep -q "tree-sitter-pre" "$docs/guides/rendering-example/index.html"
              if grep -q "tree-sitter-pre" "$internal/index.html"; then
                echo "internal site should not have ts-json tokens"; exit 1
              fi
            '';
          };

          docs-html = mkAssertionCheck {
            name = "docs-html";
            script = ''
              site="${config.packages.docs-site}"
              test -f "$site/index.html"
              test -f "$site/guides/getting-started/index.html"
              test -f "$site/guides/rendering-example/index.html"
              test -f "$site/Theory/index.html"
              test -f "$site/Theory/Demo/Proof/index.html"
              test -f "$site/Haskell/index.html"
              test -f "$site/Haskell/demo/index.html"
              test -f "$site/Haskell/demo/haddock/Demo-Sample.html"
              test -f "$site/Haskell/demo/haddock/src/Demo.Sample.html"
              test -f "$site/Haskell/demo/haddock/repo-docs-haddock.css"
              test ! -e "$site/Haskell/demo/Demo/Sample/index.html"
              test ! -e "$site/private/notes/index.html"
              grep -q "repo-docs" "$site/index.html"
              # Module's canonical name lands in <title> and the
              # page heading regardless of how the in-file
              # `/-! # ... -/` H1 is worded.
              grep -q "Demo\.Proof" "$site/Theory/Demo/Proof/index.html"
              grep -q "docs-sidebar" "$site/Theory/Demo/Proof/index.html"
              grep -q "repo-docs-lean-page" "$site/Theory/Demo/Proof/index.html"
              grep -q "repo-docs-proof-state-panel" "$site/Theory/Demo/Proof/index.html"
              grep -q "add_zero_demo" "$site/Theory/Demo/Proof/index.html"
              grep -q "tactic-state" "$site/Theory/Demo/Proof/index.html"
              grep -q "katex" "$site/Theory/Demo/Proof/index.html"
              grep -q "docs-haddock-embed-frame" "$site/Haskell/demo/index.html"
              grep -q 'src="/repo-docs/Haskell/demo/haddock/index.html"' "$site/Haskell/demo/index.html"
              grep -q 'data-doc-kind="haskell-haddock"' "$site/Haskell/demo/index.html"
              if grep -q 'docs-title\|docs-haddock-embed-actions\|data-haddock-fullscreen' "$site/Haskell/demo/index.html"; then
                echo "Haddock package page should be an undecorated embedded app surface"; exit 1
              fi
              grep -q "renderGreeting" "$site/Haskell/demo/haddock/Demo-Sample.html"
              grep -q "repo-docs-haddock.css" "$site/Haskell/demo/haddock/Demo-Sample.html"
              grep -q "repo-docs-haddock.css" "$site/Haskell/demo/haddock/src/Demo.Sample.html"
              if grep -q 'module-tree\|literate.css' "$site/Theory/Demo/Proof/index.html"; then
                echo "Lean theory page should use native repo-docs chrome, not standalone Verso chrome"; exit 1
              fi

              # Rendering example has mermaid diagrams
              grep -q "data-docs-mermaid=\"true\"" "$site/guides/rendering-example/index.html"
              grep -q "data-docs-mermaid=\"false\"" "$site/index.html"
              grep -R "foreignObject" "$site/_astro"
              grep -R "edgeLabel p" "$site/_astro"

              # Tree-sitter highlighting: the ts-json block should be
              # tokenised (tree-sitter-pre wrapper + at least one tok-
              # span). Catches regressions in the remark/Shiki handoff
              # that preserves the original fenced tag.
              grep -q "tree-sitter-pre" "$site/guides/rendering-example/index.html"
              grep -q "tok-string" "$site/guides/rendering-example/index.html"
              grep -q "tok-number" "$site/guides/rendering-example/index.html"

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

          docs-typst-manuscripts = let
            typstSite = mkDocsSite {
              name = "docs-typst-manuscripts";
              contentDir = ./fixtures/typst-docs;
              config = {
                site = {
                  title = "typst-test";
                  publicBaseUrl = "https://example.com";
                };
                typst.manuscripts.sample.dir = "Publications/Sample/typst";
              };
            };
          in
            mkAssertionCheck {
              name = "docs-typst-manuscripts";
              script = ''
                site="${typstSite.package}"
                staged="${typstSite.stagedSrc}"

                test -f "$staged/src/content/docs/Publications/Sample/manuscript.md"
                test -f "$staged/public/Publications/Sample/manuscript.pdf"
                grep -q 'kind: "typst-manuscript"' "$staged/src/content/docs/Publications/Sample/manuscript.md"
                grep -q 'pdf: "Publications/Sample/manuscript.pdf"' "$staged/src/content/docs/Publications/Sample/manuscript.md"

                test -f "$site/Publications/Sample/manuscript/index.html"
                test -f "$site/Publications/Sample/manuscript.pdf"

                # The manuscript page embeds the PDF inside the
                # standard docs shell (sidebar + breadcrumb stay
                # visible) and exposes Open / Download / Fullscreen
                # action chips above the iframe.
                grep -q 'docs-sidebar' "$site/Publications/Sample/manuscript/index.html"
                grep -q 'docs-title' "$site/Publications/Sample/manuscript/index.html"
                grep -q 'docs-typst-embed-frame' "$site/Publications/Sample/manuscript/index.html"
                grep -q 'data-typst-frame-wrap' "$site/Publications/Sample/manuscript/index.html"
                grep -q 'data-typst-fullscreen' "$site/Publications/Sample/manuscript/index.html"
                grep -q 'sandbox=' "$site/Publications/Sample/manuscript/index.html"
                grep -q 'Publications/Sample/manuscript.pdf' "$site/Publications/Sample/manuscript/index.html"
                grep -q 'src="/Publications/Sample/manuscript.pdf"' "$site/Publications/Sample/manuscript/index.html"
                grep -q 'Sample Typst Manuscript' "$site/Publications/Sample/manuscript/index.html"

                # The reading-sequence prev/next chrome is suppressed
                # for the PDF embed branch — it doesn't apply to a
                # manuscript page, and would clutter the toolbar row.
                if grep -q 'docs-sequence' "$site/Publications/Sample/manuscript/index.html"; then
                  echo "Typst manuscript embed should not render docs-sequence"; exit 1
                fi
              '';
            };

          docs-lean4-theory = let
            leanSite = mkDocsSite {
              name = "docs-lean4-theory";
              contentDir = ./docs;
              config = {
                site = {
                  title = "lean4-test";
                  publicBaseUrl = "https://example.com";
                };
                content.excludePaths = ["private"];
                lean4.theoryDir = "fixtures/lean-theory";
              };
              lean4SourceDir = ./fixtures/lean-theory;
              lean4Deps = [pkgs.leanPackages.batteries];
            };
          in
            mkAssertionCheck {
              name = "docs-lean4-theory";
              script = ''
                site="${leanSite.package}"
                staged="${leanSite.stagedSrc}"
                fragment="$staged/src/generated/lean-theory/Theory/Demo/Proof.html"

                test -f "$site/Theory/index.html"
                test -f "$site/Theory/Demo/Proof/index.html"
                test -f "$staged/src/content/docs/Theory/Demo/Proof.md"
                test -f "$fragment"
                test ! -e "$staged/public/Theory/Demo/Proof/index.html"
                grep -q 'tags:' "$staged/src/content/docs/Theory/Demo/Proof.md"
                grep -q '"proofs"' "$staged/src/content/docs/Theory/Demo/Proof.md"
                grep -q 'font-style: italic;' "$staged/src/styles/global.css"
                grep -q 'code-box > .md-text:not(.mod-doc)' "$staged/src/styles/global.css"
                grep -q '<li>' "$fragment"
                grep -q '<table>' "$fragment"
                grep -q '<th scope="col">Construct</th>' "$fragment"
                if grep -q 'Verso-rendered Lean 4 module' "$staged/src/content/docs/Theory/Demo/Proof.md"; then
                  echo "Lean theory pages should not emit generated description ingress"; exit 1
                fi
                if grep -q 'literate proof' "$staged/src/content/docs/Theory/Demo/Proof.md"; then
                  echo "Lean module prose should stay in the Verso fragment, not staged markdown"; exit 1
                fi

                grep -q '"entries"' "$staged/src/generated/site-config.json"
                grep -q '"Theory/Demo/Proof"' "$staged/src/generated/site-config.json"
                grep -q '"theoryDir": "fixtures/lean-theory"' "$staged/src/generated/site-config.json"

                grep -q 'Theory' "$site/index.html"
                grep -q 'docs-sidebar' "$site/Theory/Demo/Proof/index.html"
                grep -q 'docs-nav-proof' "$site/Theory/Demo/Proof/index.html"
                grep -q 'literate proof' "$site/Theory/Demo/Proof/index.html"
                grep -q 'repo-docs-lean-page' "$site/Theory/Demo/Proof/index.html"
                grep -q 'repo-docs-proof-state-panel' "$site/Theory/Demo/Proof/index.html"
                grep -q 'code-box' "$site/Theory/Demo/Proof/index.html"
                grep -q 'Demo\.Proof' "$site/Theory/Demo/Proof/index.html"
                grep -q 'theorem' "$site/Theory/Demo/Proof/index.html"
                grep -q 'identity' "$site/Theory/Demo/Proof/index.html"
                grep -q 'identity_again' "$site/Theory/Demo/Proof/index.html"
                grep -q 'docstring attachment' "$site/Theory/Demo/Proof/index.html"
                grep -q 'Demo___cross' "$site/Theory/Demo/Proof/index.html"
                grep -q 'add_zero_demo' "$site/Theory/Demo/Proof/index.html"
                grep -q 'tactic-state' "$site/Theory/Demo/Proof/index.html"
                grep -q 'katex' "$site/Theory/Demo/Proof/index.html"
                if grep -q 'module-tree\|literate.css' "$site/Theory/Demo/Proof/index.html"; then
                  echo "Lean theory page should use native repo-docs chrome, not standalone Verso chrome"; exit 1
                fi
                if grep -q '```lean' "$site/Theory/Demo/Proof/index.html"; then
                  echo "Lean theory page should be Verso HTML, not markdown code fences"; exit 1
                fi
                if grep -q 'Generated Lean 4 module rendered with Verso' "$staged/src/content/docs/Theory/Demo/Proof.md" "$site/Theory/Demo/Proof/index.html"; then
                  echo "Lean theory page should render module prose instead of fallback text"; exit 1
                fi
              '';
            };

          docs-haskell-haddock = let
            haskellSite = mkDocsSite {
              name = "docs-haskell-haddock";
              contentDir = ./docs;
              config = {
                site = {
                  title = "haddock-test";
                  publicBaseUrl = "https://example.com";
                };
                content.excludePaths = ["private"];
                haskell.packages.demo = {
                  packageDir = "fixtures/haskell-haddock";
                  packageName = "repo-docs-haddock-demo";
                  title = "Haddock Demo API";
                  description = "Generated Haddock API fixture.";
                };
              };
            };
          in
            mkAssertionCheck {
              name = "docs-haskell-haddock";
              script = ''
                site="${haskellSite.package}"
                staged="${haskellSite.stagedSrc}"

                test -f "$staged/src/content/docs/Haskell/index.md"
                test -f "$staged/src/content/docs/Haskell/demo/index.md"
                test ! -e "$staged/src/content/docs/Haskell/demo/Demo/Sample.md"
                test -f "$staged/public/Haskell/demo/haddock/index.html"
                test -f "$staged/public/Haskell/demo/haddock/Demo-Sample.html"
                test -f "$staged/public/Haskell/demo/haddock/src/Demo.Sample.html"
                test -f "$staged/public/Haskell/demo/haddock/repo-docs-haddock.css"
                grep -q 'kind: "haskell-haddock"' "$staged/src/content/docs/Haskell/demo/index.md"
                grep -q 'html: "Haskell/demo/haddock/index.html"' "$staged/src/content/docs/Haskell/demo/index.md"

                grep -q '"Haskell/demo"' "$staged/src/generated/site-config.json"
                if grep -q '"Haskell/demo/Demo/Sample"' "$staged/src/generated/site-config.json"; then
                  echo "Haddock modules should stay inside the embedded Haddock app"; exit 1
                fi
                grep -q '"packageDir": "fixtures/haskell-haddock"' "$staged/src/generated/site-config.json"

                test -f "$site/Haskell/index.html"
                test -f "$site/Haskell/demo/index.html"
                test -f "$site/Haskell/demo/haddock/Demo-Sample.html"
                test -f "$site/Haskell/demo/haddock/src/Demo.Sample.html"
                test -f "$site/Haskell/demo/haddock/repo-docs-haddock.css"
                test ! -e "$site/Haskell/demo/Demo/Sample/index.html"
                grep -q 'docs-sidebar' "$site/Haskell/demo/index.html"
                grep -q 'docs-haddock-embed-frame' "$site/Haskell/demo/index.html"
                grep -q 'Haskell/demo/haddock/index.html' "$site/Haskell/demo/index.html"
                grep -q 'src="/Haskell/demo/haddock/index.html"' "$site/Haskell/demo/index.html"
                grep -q 'data-doc-kind="haskell-haddock"' "$site/Haskell/demo/index.html"
                if grep -q 'docs-title\|docs-haddock-embed-actions\|data-haddock-fullscreen' "$site/Haskell/demo/index.html"; then
                  echo "Haddock package page should be an undecorated embedded app surface"; exit 1
                fi
                grep -q 'renderGreeting' "$site/Haskell/demo/haddock/Demo-Sample.html"
                grep -q 'repo-docs-haddock.css' "$site/Haskell/demo/haddock/index.html"
                grep -q '../repo-docs-haddock.css' "$site/Haskell/demo/haddock/src/Demo.Sample.html"
                grep -q 'font-family: "IBM Plex Sans"' "$site/Haskell/demo/haddock/repo-docs-haddock.css"
                if grep -q 'fonts.googleapis.com/css?family=PT+Sans' "$site/Haskell/demo/haddock/index.html"; then
                  echo "Haddock output should use repo-docs font styling instead of PT Sans"; exit 1
                fi
                if grep -q 'docs-sequence' "$site/Haskell/demo/index.html"; then
                  echo "Haddock embed should not render docs-sequence"; exit 1
                fi
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
