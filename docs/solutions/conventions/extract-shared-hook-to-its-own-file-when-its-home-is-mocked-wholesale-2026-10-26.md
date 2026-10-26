---
title: "Extract a shared hook into its own file when its natural home module is mocked wholesale by tests — a new export there is undefined under every existing mock"
track: knowledge
category: conventions
tags: [testing, vitest, mocks, hooks, refactor, maintainability]
module: client
applies_to: ["client/hooks/**/*.ts", "client/hooks/__tests__/**"]
created: 2026-10-26
---

# Extract a shared hook into its own file when its home module is mocked wholesale

## Rule

Before adding a new hook (or any export) to an existing module, grep the tests for `vi.mock("<that module>", () => ({ … }))`. If any test replaces the module with a factory that lists only the exports it uses, put the new hook in **its own file** that imports from the mocked module — do not add it to the mocked module.

```bash
grep -rln 'vi.mock("@/hooks/useInspiredSuggestions"' client
```

## Why

A factory mock replaces the whole module. Any export the factory does not list is `undefined` in that test, so a component that starts calling the new hook throws in every test that mocked the module for an unrelated reason — failures with nothing to do with the change. The opposite placement inherits every existing mock for free: the new file imports the mocked export, so each test's stand-in flows through it untouched.

## Examples

- `useMakeSuggestionFlow` (2026-10-25 maintainability audit, M1). The natural home was `client/hooks/useInspiredSuggestions.ts` beside `useMakeSuggestion`, but 12 test files (CoachChat, RecipeChatScreen, every RecipeBrowserScreen suite, recipe-finder offer tests) mock that module with only `useMakeSuggestion` / the listing hook. Placed in `client/hooks/useMakeSuggestionFlow.ts`, which imports `useMakeSuggestion`, the three migrated screens' 39 suites passed with no mock edits.
- `useParsedItemsAnnouncement` (L4): both Quick Log surfaces' tests mock `@/hooks/useQuickLogSession` wholesale, so the announcer went to its own file rather than into the session hook.

## Related Files

- `client/hooks/useMakeSuggestionFlow.ts`
- `client/hooks/useParsedItemsAnnouncement.ts`

## See Also

- [inline `vi.mock` of globally-aliased modules](inline-vi-mock-globally-aliased-modules-2026-05-13.md)
