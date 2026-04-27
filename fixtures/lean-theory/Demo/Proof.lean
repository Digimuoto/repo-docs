import Batteries

/-!
# Demo Proof

This module demonstrates the native repo-docs Theory integration:

- repo-docs renders this Markdown with its normal pipeline.
- Verso renders the Lean declarations below with semantic tokens and hovers.
- Tactic proofs expose proof-state information interactively.

```mermaid
flowchart LR
  Source[Lean source] --> Verso[Verso literate data]
  Verso --> Fragment[Interactive Lean fragment]
  Fragment --> Docs[repo-docs page shell]
```

The tactic proof below establishes $n + 0 = n$ by induction. Hover or
open the highlighted tactic steps to inspect the intermediate goals.
-/

namespace Demo

theorem identity (value : Nat) : value = value := rfl

theorem identity_again (value : Nat) : value = value := identity value

theorem add_zero_demo (n : Nat) : n + 0 = n := by
  induction n with
  | zero =>
      rfl
  | succ n ih =>
      exact congrArg Nat.succ ih

end Demo
