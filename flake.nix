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
      in {
        docsSite = {
          enable = true;
          contentDir = ./docs;
          excludePaths = ["private"];
          site = {
            title = "repo-docs";
            tagline = "Documentation";
            description = "Reusable docs layout module for flake-parts repositories";
            publicBaseUrl = "https://docs.example.com";
          };
          navigation.sectionLabels = {
            guides = "Guides";
            architecture = "Architecture";
          };
        };

        checks = {
          docs-html = mkAssertionCheck {
            name = "docs-html";
            script = ''
              site="${config.packages.docs-site}"
              test -f "$site/index.html"
              test -f "$site/guides/getting-started/index.html"
              test -f "$site/architecture/advanced/tree-navigation/index.html"
              test ! -e "$site/private/notes/index.html"
              grep -q "repo-docs" "$site/index.html"
              grep -q "data-docs-mermaid=\"true\"" "$site/guides/getting-started/index.html"
              grep -q "data-docs-mermaid=\"false\"" "$site/index.html"
              grep -q "tree-based navigation" "$site/architecture/advanced/tree-navigation/index.html"
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
