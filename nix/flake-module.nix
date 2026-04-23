{lib, ...}: {
  perSystem = {
    config,
    pkgs,
    lib,
    ...
  }: let
    cfg = config.docsSite;
    mkDocsSite = import ./lib.nix {
      inherit pkgs lib;
      repoRoot = ../.;
    };
    grammarLib = import ./grammar.nix {inherit pkgs lib;};

    # Compile every registered language into a {parser.wasm, queries/}
    # derivation, then collect them into an attrset the staging script
    # turns into a runtime manifest.
    builtLanguages = lib.mapAttrs (name: langCfg: {
      wasm = grammarLib.mkGrammarWasm {
        inherit name;
        grammarSrc = langCfg.grammarSrc;
        highlightQueries = langCfg.highlightQueries;
      };
      aliases = langCfg.aliases;
    }) cfg.languages;

    site =
      if cfg.enable
      then
        mkDocsSite {
          name = cfg.name;
          contentDir = cfg.contentDir;
          config = {
            site = cfg.site;
            repo = cfg.repo;
            navigation = cfg.navigation;
            content = {
              excludePaths = cfg.excludePaths;
            };
            theme = cfg.theme;
          };
          templateFiles = cfg.templateFiles;
          languages = builtLanguages;
        }
      else null;
  in {
    options.docsSite = {
      enable = lib.mkEnableOption "the reusable docs site";

      name = lib.mkOption {
        type = lib.types.str;
        default = "docs-site";
        description = "Base name for generated packages and apps.";
      };

      contentDir = lib.mkOption {
        type = lib.types.path;
        description = "Directory containing the markdown docs tree.";
      };

      excludePaths = lib.mkOption {
        type = lib.types.listOf lib.types.str;
        default = [];
        description = "Relative paths under contentDir to exclude from the published site.";
      };

      theme = lib.mkOption {
        type = lib.types.enum ["cortex-dark" "cortex-light"];
        default = "cortex-dark";
        example = "cortex-light";
        description = ''
          Color palette for the generated docs site.

          - `cortex-dark` (default): the built-in dark palette — deep
            navy-slate surfaces with a warm amber accent.
          - `cortex-light`: a canonical research-wiki white theme —
            warm paper, charcoal ink, and a single scholarly blue.
            Pairs with Mermaid's default light theme and KaTeX output
            for print-like figures.

          Consumers can still override `template/src/styles/palette.css`
          through `templateFiles` to ship their own palette entirely.
        '';
      };

      site = lib.mkOption {
        type = lib.types.submodule {
          options = {
            title = lib.mkOption {
              type = lib.types.str;
              default = "Documentation";
              description = "Site title shown in the sidebar and page titles.";
            };

            tagline = lib.mkOption {
              type = lib.types.str;
              default = "Documentation";
              description = "Short tagline shown under the site title.";
            };

            description = lib.mkOption {
              type = lib.types.str;
              default = "Documentation site";
              description = "Default page description.";
            };

            publicBaseUrl = lib.mkOption {
              type = lib.types.str;
              default = "https://example.invalid";
              description = "Canonical public URL for the built docs site.";
            };

            routeBase = lib.mkOption {
              type = lib.types.str;
              default = "/";
              description = "Route prefix where the docs site is served.";
            };

            footerText = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Footer text shown in the sidebar footer.";
            };
          };
        };
        default = {};
        description = "Site metadata for the generated docs site.";
      };

      repo = lib.mkOption {
        type = lib.types.submodule {
          options = {
            repoUrl = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Repository URL for display or link generation.";
            };

            editBaseUrl = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = null;
              description = "Base URL for edit links if the template uses them.";
            };
          };
        };
        default = {};
        description = "Repository metadata exposed to the template.";
      };

      navigation = lib.mkOption {
        type = lib.types.submodule {
          options = {
            sections = lib.mkOption {
              type = lib.types.nullOr (
                lib.types.listOf (
                  lib.types.submodule {
                    options = {
                      label = lib.mkOption {
                        type = lib.types.nullOr lib.types.str;
                        description = ''
                          Heading shown above this section in the sidebar.
                          Set to null (or an empty string) to render the
                          section's items directly without a heading.
                        '';
                      };

                      dir = lib.mkOption {
                        type = lib.types.nullOr lib.types.str;
                        default = null;
                      };

                      entries = lib.mkOption {
                        type = lib.types.nullOr (lib.types.listOf lib.types.str);
                        default = null;
                      };
                    };
                  }
                )
              );
              default = null;
              description = "Explicit navigation sections. When null, sections are auto-generated from the docs tree.";
            };

            rootSectionLabel = lib.mkOption {
              type = lib.types.nullOr lib.types.str;
              default = "Overview";
              description = ''
                Label for the auto-generated root-level section (the
                pseudo-section that collects pages at the docs root).

                Set to `null` (or an empty string) to render those pages
                without a section heading. Defaults to "Overview" for
                back-compat.
              '';
            };

            sectionLabels = lib.mkOption {
              type = lib.types.attrsOf lib.types.str;
              default = {};
              description = "Directory-to-label mapping for auto-generated navigation sections.";
            };
          };
        };
        default = {};
        description = "Navigation settings for the generated site.";
      };

      templateFiles = lib.mkOption {
        type = lib.types.attrsOf lib.types.path;
        default = {};
        example = {
          "src/styles/global.css" = ./theme/global.css;
        };
        description = "Template files to replace or add relative to the shared template root.";
      };

      languages = lib.mkOption {
        type = lib.types.attrsOf (lib.types.submodule {
          options = {
            grammarSrc = lib.mkOption {
              type = lib.types.path;
              description = ''
                Path (or flake input) to a tree-sitter grammar source
                tree. The source must either ship `src/parser.c` or
                provide a `grammar.js` the `tree-sitter` CLI can generate
                from.
              '';
            };
            aliases = lib.mkOption {
              type = lib.types.listOf lib.types.str;
              default = [];
              description = ''
                Additional fenced-code language tags that should be
                tokenised with this grammar (for example `[ "wire" "wr" ]`
                to match both ```wire and ```wr).
              '';
            };
            highlightQueries = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = ''
                Optional override directory containing highlight query
                files. When null, the `queries/` directory in grammarSrc
                is used verbatim (standard tree-sitter convention).
              '';
            };
            injections = lib.mkOption {
              type = lib.types.nullOr lib.types.path;
              default = null;
              description = ''
                Optional path to an injections query file. Reserved for a
                future version; currently unused.
              '';
            };
          };
        });
        default = {};
        example = lib.literalExpression ''
          {
            wire = {
              grammarSrc = inputs.tree-sitter-wire;
            };
          }
        '';
        description = ''
          Register tree-sitter grammars to provide syntax highlighting
          for custom fenced-code languages. Each entry compiles to
          WebAssembly at build time and is loaded by a rehype plugin in
          the docs pipeline. Grammars without a matching entry continue
          to fall through to Shiki.
        '';
      };
    };

    config = lib.mkIf cfg.enable {
      packages.docs-site = site.package;

      apps.docs-dev = {
        type = "app";
        program = "${site.devApp}/bin/${site.devApp.name}";
        meta.description = "Run the reusable docs site in development mode";
      };

      apps.docs-preview = {
        type = "app";
        program = "${site.previewApp}/bin/${site.previewApp.name}";
        meta.description = "Preview the reusable docs site after a production build";
      };

      checks.docs-site = site.package;
    };
  };
}
