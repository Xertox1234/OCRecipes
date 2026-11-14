---
title: "Add @tanstack/eslint-plugin-query so unstable query/mutation deps fail lint (perf audit L9)"
status: done
priority: low
created: 2026-11-08
updated: 2026-11-09
assignee:
labels: [deferred, performance, tooling]
github_issue:
---

# Add @tanstack/eslint-plugin-query

## Summary

The `@tanstack/query/no-unstable-deps` rule flags a `useQuery`/`useMutation` result
object placed in a hook dependency array — the bug class the 2026-11-08 performance
audit fixed by hand in `QuickAddSheet` (M2), and earlier in `RecipeBrowserScreen` (H4,
2026-09-23 front-end audit). The plugin is not installed.

## Background

Deferred at audit triage (owner, 2026-11-08): it adds a dev dependency, which is its
own decision. Phase 2.5 research confirmed against TanStack Query docs
(`docs/eslint/no-unstable-deps.md`) that the rule targets exactly this pattern.
`docs/rules/performance.md` and `docs/rules/hooks.md` already state the rule in prose;
nothing enforces it.

## Acceptance Criteria

- [x] `@tanstack/eslint-plugin-query` added as a pinned dev dependency, version compatible with the installed `@tanstack/react-query` ^5.90.
- [x] `eslint.config.js` enables at least `@tanstack/query/no-unstable-deps` for `client/**`.
- [x] `npm run lint` passes; any existing violations it surfaces are fixed in the same PR (or listed, if many).
- [x] Decide whether the plugin's other recommended rules are wanted; record the choice in the PR.

## Implementation Notes

Never `npm install` in the main checkout while executors run (memory rule); do it in the todo's worktree. Check the plugin's flat-config export shape against the repo's `eslint.config.js`.

## Updates

### 2026-11-09

- Pinned `@tanstack/eslint-plugin-query@5.105.0` (out two weeks; 5.107.1 was 3 days old). It nests its own `@typescript-eslint/utils` 8.72.1 (needs ^8.71; root is 8.59.4), hence the lockfile growth.
- Adopted the 7 `flat/recommended` rules by name for `client/**`; `prefer-query-options` not adopted (136 hits / 49 files, a style migration).
- Fixed all 8 sites: 2 `no-unstable-deps`, 5 `exhaustive-deps` (one real cache-key bug — `useSuggestionInstructions` missed `suggestionType`), 1 `no-rest-destructuring` (`useRecipeSearch`).
- `docs/rules/performance.md` never stated the rule; only `docs/rules/hooks.md` did, which now names the enforcing lint rule.
