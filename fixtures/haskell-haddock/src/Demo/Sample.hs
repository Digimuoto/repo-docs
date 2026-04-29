{-|
Module      : Demo.Sample
Description : Fixture module for repo-docs Haddock rendering.

This module is intentionally small, but it exercises the pieces repo-docs
needs from Haddock output:

* module-level prose;
* declarations with type signatures;
* links from the package index to a module page.
-}
module Demo.Sample
  ( Greeting(..)
  , renderGreeting
  ) where

-- | A tiny documented value used by the generated API page.
newtype Greeting = Greeting String
  deriving (Eq, Show)

-- | Render a 'Greeting' as user-facing text.
renderGreeting :: Greeting -> String
renderGreeting (Greeting name) = "Hello, " ++ name ++ "!"
