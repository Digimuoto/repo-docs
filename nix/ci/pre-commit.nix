{inputs, ...}: {
  imports = [
    inputs.pre-commit-hooks.flakeModule
  ];

  perSystem = {
    config,
    pkgs,
    ...
  }: {
    pre-commit = {
      check.enable = true;

      settings.hooks = {
        # Mirror the same formatters CI runs so a contributor never
        # ships a "format-only" follow-up PR. --fail-on-change makes
        # the hook noisy when the working tree drifts from prettier /
        # alejandra output.
        treefmt = {
          enable = true;
          name = "treefmt";
          description = "Run treefmt (alejandra + prettier) over the whole repo";
          entry = "${config.treefmt.build.wrapper}/bin/treefmt --fail-on-change";
          language = "system";
          pass_filenames = false;
        };

        # Quick structural sanity check on the flake; skips the
        # heavy site-build evaluation by passing --no-build.
        flake-check = {
          enable = true;
          name = "flake-check";
          description = "nix flake check (no-build)";
          entry = "${pkgs.writeShellScript "repo-docs-flake-check" ''
            # The hook is meant to gate `git commit` on the developer's
            # machine, not to run recursively inside `nix flake check`'s
            # own pre-commit-check derivation (which would infinite-loop
            # the eval). When the sandboxed check evaluates this script
            # there's no `nix` on PATH — bail out cleanly so the
            # surrounding flake check still passes.
            if ! command -v nix >/dev/null 2>&1; then
              echo "[flake-check] nix unavailable on PATH (likely sandboxed); skipping" >&2
              exit 0
            fi

            # pipefail propagates nix's exit status through the grep
            # filter. The `|| [ $? -eq 1 ]` swallows grep's benign
            # "no matching lines" exit-1 (so a clean check with empty
            # output still passes) without masking grep's exit-2
            # (genuine grep error) or nix's failure.
            set -o pipefail
            nix flake check --no-build 2>&1 \
              | { grep -v "warning: Git tree" || [ $? -eq 1 ]; }
          ''}";
          language = "system";
          pass_filenames = false;
        };
      };
    };
  };
}
