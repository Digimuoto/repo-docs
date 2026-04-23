{pkgs, lib}: let
  /*
   * Build a tree-sitter grammar source tree into a WebAssembly parser
   * plus its queries tree.
   *
   * Input:
   *   name        — language name (used for the WASM filename and logs)
   *   grammarSrc  — path to the grammar repo (must contain at least
   *                 either `src/parser.c` pre-generated or a `grammar.js`
   *                 we can run `tree-sitter generate` against)
   *   highlightQueries — optional path to override the queries dir; when
   *                      null the `queries/` directory from grammarSrc is
   *                      used verbatim
   *
   * Output derivation:
   *   $out/parser.wasm
   *   $out/queries/highlights.scm     (and any other files)
   *
   * Emscripten note:
   *   tree-sitter 0.22+ invokes emscripten directly when it's on PATH and
   *   falls back to docker otherwise. We point EM_CACHE at a writable
   *   copy of emscripten's own cache so the sandbox can JIT its system
   *   libraries the first time.
   */
  mkGrammarWasm = {
    name,
    grammarSrc,
    highlightQueries ? null,
  }:
    pkgs.stdenv.mkDerivation {
      pname = "tree-sitter-${name}-wasm";
      version = "0.0.0";
      src = grammarSrc;

      nativeBuildInputs = [
        pkgs.tree-sitter
        pkgs.nodejs_22
        pkgs.emscripten
      ];

      dontConfigure = true;
      dontPatch = true;

      buildPhase = ''
        runHook preBuild

        export HOME="$TMPDIR/home"
        mkdir -p "$HOME"

        cp -r ${pkgs.emscripten}/share/emscripten/cache "$TMPDIR/em-cache"
        chmod -R u+w "$TMPDIR/em-cache"
        export EM_CACHE="$TMPDIR/em-cache"

        # Some upstream grammars commit src/parser.c; others only ship
        # grammar.js and expect consumers to generate. Handle both.
        if [ ! -f src/parser.c ] && [ -f grammar.js ]; then
          tree-sitter generate
        fi

        tree-sitter build --wasm -o "tree-sitter-${name}.wasm" .

        runHook postBuild
      '';

      installPhase = ''
        runHook preInstall

        mkdir -p "$out"
        install -m 0644 "tree-sitter-${name}.wasm" "$out/parser.wasm"

        ${
          if highlightQueries == null
          then ''
            if [ -d queries ]; then
              cp -r queries "$out/queries"
            fi
          ''
          else ''
            mkdir -p "$out/queries"
            cp -r ${highlightQueries}/. "$out/queries/"
          ''
        }

        runHook postInstall
      '';
    };
in {
  inherit mkGrammarWasm;
}
