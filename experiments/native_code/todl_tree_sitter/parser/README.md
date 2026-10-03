# TODL Tree-sitter parsers

The two grammar entry files describe the syntax implemented in
`src/compiler-services/parse/parser.ts` and `lexer.ts`, not the generated manual.

- `src/ast_parser/grammar.js` defines the AST-oriented grammar for semantic node
  fields such as `name`, `type`, `assignments`, `children`, `left`, and `right`.
- `src/cst_parser/grammar.js` defines the concrete-syntax grammar with wrapper
  nodes and declaration structure preserved.

Both generated parsers live under the same shared `src` directory, with one
subfolder per grammar so the outputs stay together and do not collide. Each
folder contains the grammar entry file plus the generated parser tree under a
nested `src/` folder:

```text
src/
  ast_parser/
    grammar.js
    src/
      grammar.json
      node-types.json
      parser.c
      parser.exp
      parser.lib
      parser.obj
      tree_sitter/
  cst_parser/
    grammar.js
    src/
      grammar.json
      node-types.json
      parser.c
      parser.h
      alloc.h
      array.h
      tree_sitter/
```

Compiled artifacts such as `parser.obj`, `parser.lib`, and `parser.exp` are
ignored under each nested parser output folder so the project root stays clean.

```sh
npm install
npm run generate
npm test
```

`npm test` checks the AST corpus against `test/corpus/todl.txt`.
Both generated C sources can be compiled independently with GCC:

```sh
gcc -c src/ast_parser/src/parser.c -Isrc/ast_parser/src -o ast_todl_parser.o
gcc -c src/cst_parser/src/parser.c -Isrc/cst_parser/src -o cst_todl_parser.o
```

To parse the retained compiler fixtures using the AST parser:

```sh
npx tree-sitter parse ../../../../src/compiler-services/parse/tests/fixtures/primitives.todl
npx tree-sitter parse ../../../../src/compiler-services/parse/tests/fixtures/enums.todl
npx tree-sitter parse ../../../../src/compiler-services/parse/tests/fixtures/concepts.todl
npx tree-sitter parse ../../../../src/compiler-services/parse/tests/fixtures/order-fulfillment.todl
```