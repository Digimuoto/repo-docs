import Lake
open Lake DSL

package «repo-docs-lean-fixture» where
  -- Minimal Lake package used to exercise repo-docs' Verso renderer.

@[default_target]
lean_lib Demo where
  roots := #[`Demo.Proof]
