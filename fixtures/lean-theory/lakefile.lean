import Lake
open Lake DSL

package «repo-docs-lean-fixture» where
  -- Minimal Lake package used to exercise repo-docs' Verso renderer.

require batteries from git
  "https://github.com/leanprover-community/batteries.git" @ "v4.29.0"

@[default_target]
lean_lib Demo where
  roots := #[`Demo.Proof]
