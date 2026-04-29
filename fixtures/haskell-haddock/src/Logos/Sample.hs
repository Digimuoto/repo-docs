{-|
Module      : Logos.Sample
Description : Extra public library fixture.

This module lives in a named public sublibrary so repo-docs can verify
module-prefix-limited Haddock publishing does not publish unrelated API pages.
-}
module Logos.Sample
  ( extraGreeting
  ) where

-- | A value that should not appear when only the Demo modules are published.
extraGreeting :: String
extraGreeting = "extra"
