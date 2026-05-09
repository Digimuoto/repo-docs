{inputs, ...}: {
  imports = [
    ./formatter.nix
    ./pre-commit.nix
  ];

  perSystem = {
    config,
    pkgs,
    lib,
    ...
  }: let
    # Format check — runs treefmt in --fail-on-change mode so CI
    # turns red whenever a file would be modified by `nix fmt`.
    check-format = pkgs.writeShellApplication {
      name = "check-format";
      text = ''
        echo "🎨 Checking code formatting..."
        nix fmt -- --fail-on-change
        echo "✅ Code formatting is correct!"
      '';
    };

    # Build all sites declared by the flake module. Mirrors the
    # multi-site assertion in checks (docs-multi-site) but exposed
    # as a runnable app for local sanity checks.
    build-all-sites = pkgs.writeShellApplication {
      name = "build-all-sites";
      text = ''
        set -e
        echo "🔨 Building all docsSite outputs..."
        for site in docs-site internal-site; do
          nix build ".#$site" --no-link --print-build-logs
          echo "  ✓ $site"
        done
        echo "✅ All sites built!"
      '';
    };

    # Quick development gate. Run before pushing.
    dev-check = pkgs.writeShellApplication {
      name = "dev-check";
      text = ''
        set -e
        echo "⚡ dev-check..."
        echo "1️⃣  format"
        nix fmt -- --fail-on-change
        echo ""
        echo "2️⃣  flake check"
        nix flake check --no-build
        echo ""
        echo "✅ dev-check passed"
      '';
    };

    # Full CI gate — what GitHub Actions runs end-to-end.
    ci-check = pkgs.writeShellApplication {
      name = "ci-check";
      text = ''
        set -e
        echo "🚀 ci-check..."
        echo "===================="
        echo ""
        echo "Step 1: Format"
        echo "--------------"
        nix run .#_check-format
        echo ""
        echo "Step 2: Flake check"
        echo "-------------------"
        nix flake check --print-build-logs
        echo ""
        echo "Step 3: Build sites"
        echo "-------------------"
        nix run .#_build-all-sites
        echo ""
        echo "🎉 ci-check passed"
      '';
    };
  in {
    apps = {
      check-format = {
        type = "app";
        program = "${check-format}/bin/check-format";
        meta.description = "Run treefmt with --fail-on-change";
      };
      ci-check = {
        type = "app";
        program = "${ci-check}/bin/ci-check";
        meta.description = "Run the full CI gate locally";
      };
      dev-check = {
        type = "app";
        program = "${dev-check}/bin/dev-check";
        meta.description = "Run a quick format + flake-check gate";
      };
    };

    # Hidden helpers — used internally by ci-check / dev-check and
    # by the GitHub workflow. Underscored so they don't clutter
    # `nix flake show`.
    legacyPackages = {
      _check-format = check-format;
      _ci-check = ci-check;
      _dev-check = dev-check;
      _build-all-sites = build-all-sites;
    };
  };
}
