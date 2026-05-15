---
title: "Verify __DEV__ global has a TypeScript type declaration in scope"
status: in-progress
priority: low
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [typescript, dx, client, coach-badge]
---

# Verify **DEV** global has a TypeScript type declaration in scope

## Summary

`CoachProScreen.tsx` and `ChatListScreen.tsx` now use `__DEV__` (a React Native / Expo global) for conditional error logging. If the TypeScript config doesn't include the Expo / React Native type definitions that declare `__DEV__: boolean`, this produces a "Cannot find name '**DEV**'" error in strict mode — which would be caught by `check:types` but not at runtime.

## Background

`__DEV__` is declared in `@types/react-native` (and re-exported by `expo`). It is almost certainly already in scope given the rest of the codebase uses React Native types. This todo is a verification task — confirm it compiles cleanly and, if not, add the declaration.

## Acceptance Criteria

- [x] `npm run check:types` passes with no `Cannot find name '__DEV__'` errors
- [x] If missing, add `declare const __DEV__: boolean;` to `client/types/global.d.ts` (or equivalent)

## Implementation Notes

```bash
grep -rn "__DEV__" client/ --include="*.ts" --include="*.tsx" | head -10
```

If other files already use `__DEV__` without issue, no action is needed — just confirm and close.

## Dependencies

- None

## Risks

- Trivial — verification only; fix is a one-line type declaration if needed

## Updates

### 2026-05-01

- Identified during code review of coach-badge todo session
