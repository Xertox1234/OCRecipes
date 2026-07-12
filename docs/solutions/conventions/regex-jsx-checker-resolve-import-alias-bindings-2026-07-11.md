---
title: A regex JSX-presence checker must resolve import alias bindings, not just the literal component name
track: knowledge
category: conventions
tags: [knowledge-base, import-alias, jsx-presence, regex, false-negative]
module: shared
created: '2026-07-11'
applies_to: [scripts/check-*.js]
---

## Rule

A regex-based JSX-presence checker in the `scripts/check-*.js` family must not match only the literal exported component name — that is fail-open under import aliasing (`import { BottomSheetModal as Sheet } from '@gorhom/bottom-sheet'` renders `<Sheet>` and silently bypasses the check, a false negative in a checker whose whole job is to catch omissions). Either resolve the local binding names from the file's import statements before matching JSX, or explicitly regression-test the documented literal-name limitation.

## Why

The `scripts/check-*.js` family (8 scripts) is deliberately regex-based, standalone Node, with no AST dependency — and at least `scripts/check-accessibility.js` has the identical undocumented literal-name blind spot for `Pressable`/`TouchableOpacity`/`TextInput`. Public React Native code regularly aliases the guarded symbols via styled/themed wrapper re-exports. A false negative in these checks means lint-staged or CI passes on code that violates the rule (e.g., a `BottomSheetModal` rendered under an alias without its required `useSheetBackHandler` wiring). The gap is invisible until a production bug is reported.

## Examples

The reference implementation in `scripts/check-bottomsheet-backhandler.js` demonstrates the technique:

1. Match the import statement for the specific package with a clause pattern built from a negated character class so multi-line specifier lists still match:  
   `import { BottomSheetModal, BottomSheetProps } from '@gorhom/bottom-sheet'` spans one line, but the import may be reformatted to:  
   ```js
   import {
     BottomSheetModal,
     BottomSheetProps
   } from '@gorhom/bottom-sheet';
   ```  
   The regex uses `[^'"]*?` to consume any characters (including newlines) between `import` and `from`.

2. Skip statement-level type-only imports (`import type { BottomSheetModal } from ...`) *and* specifier-level ones (`import { type BottomSheetModal as Sheet }`) — type bindings never render JSX, so they must not be treated as aliases.

3. Extract aliases only from inside the import's brace list, splitting on commas and matching `^\s*(type\s+)?BottomSheetModal\s+as\s+([A-Za-z_$][\w$]*)\s*$` per specifier — anchoring inside the braces prevents an `as` *type cast* elsewhere in the file (e.g., `BottomSheetModal as unknown as typeof BottomSheetModal`, which exists in `test/mocks/gorhom-bottom-sheet.ts`) from registering a bogus alias.

4. Build the JSX tag regex per local name, escaping `$` (the only regex metacharacter valid in a JS identifier) and keeping the `(?=[\s/>])` boundary lookahead so a longer tag that merely starts with the alias (alias `Sheet` vs `<SheetProvider>`) does not match.

5. Always keep the literal exported name in the match list so files without imports (test fixtures) and normal un-aliased imports keep working.

The two key regexes are:

```js
// Match import statements for @gorhom/bottom-sheet (multi-line specifier lists)
const IMPORT_RE = /import\s+(type\s+)?([^'"]*?)\bfrom\s*["']@gorhom\/bottom-sheet["']/g;

// Extract alias from inside braces: BottomSheetModal as Sheet
const ALIAS_RE = /^\s*(type\s+)?BottomSheetModal\s+as\s+([A-Za-z_$][\w$]*)\s*$/;
```

## Exceptions

- A wrapper component re-exported from a **different** file under its own name bypasses any single-file check; such cases require cross-file analysis (see See Also).
- Namespace-import usage (`import * as G from '@gorhom/bottom-sheet'; <G.BottomSheetModal>`) is deliberately unmatched because the tag pattern excludes dot-prefixed names.
- When a check needs a property of a declaration in a different file, use the TypeScript compiler API instead — see [AST-based cross-file static guard](../design-patterns/ast-cross-file-import-directive-guard-2026-07-05.md).

## Related Files

- `scripts/check-bottomsheet-backhandler.js` — reference implementation
- `scripts/__tests__/check-bottomsheet-backhandler.test.ts` — regression tests including type-only, cast, and boundary negative cases
- `scripts/check-accessibility.js` — same latent gap, unfixed

## See Also

- [AST-based cross-file static guard](../design-patterns/ast-cross-file-import-directive-guard-2026-07-05.md) — when single-file checks are insufficient
- [Custom lint scripts for accessibility and hardcoded colors](../best-practices/custom-lint-scripts-accessibility-colors-2026-05-13.md) — broader context on the check family