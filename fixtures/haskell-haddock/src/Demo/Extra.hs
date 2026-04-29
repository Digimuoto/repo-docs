{-|
Module      : Demo.Extra
Description : Extra public library fixture.

This module lives in a named public sublibrary so repo-docs can verify
component-limited Haddock generation does not publish unrelated API pages.
-}
module Demo.Extra
  ( extraGreeting
  ) where

-- | A value that should not appear when only the main library is documented.
extraGreeting :: String
extraGreeting = "extra"
