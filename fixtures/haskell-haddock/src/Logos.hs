{-|
Module      : Logos
Description : Top-level extra public library fixture.

This module gives the filtered Haddock fixture a parent module with a child,
matching packages that expose a public reasoning library alongside the main
library.
-}
module Logos
  ( module Logos.Sample
  ) where

import Logos.Sample
