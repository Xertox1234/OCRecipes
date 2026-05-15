---
title: "Fix TS2347 type error in useCollapsibleHeight test"
status: backlog
priority: low
created: 2026-04-07
updated: 2026-04-07
assignee:
labels: [code-quality, testing]
---

# Fix TS2347 type error in useCollapsibleHeight test

## Summary

`client/hooks/__tests__/useCollapsibleHeight.test.ts` has a pre-existing TypeScript error (TS2347) that has persisted across multiple audits. The test passes at runtime but fails `tsc --noEmit`.

## Background

The mock for `react-native-reanimated` uses `require("react")` (CJS) to get `useRef`, then calls `useRef<{ value: number } | null>(null)` with a type argument. Since `require()` returns `any`, TypeScript treats `useRef` as an untyped function and rejects the generic parameter.

**Error:** `Untyped function calls may not accept type arguments.` at line 12, column 19.

## Acceptance Criteria

- [ ] `npm run check:types` no longer reports TS2347 for this file
- [ ] Test still passes: `npx vitest run client/hooks/__tests__/useCollapsibleHeight.test.ts`

## Implementation Notes

Two options:

**Option A — Type the import:**

```typescript
const { useRef } = require("react") as typeof import("react");
```

**Option B — Remove the type argument and use a type assertion on the initial value:**

```typescript
const ref = useRef(null as { value: number } | null);
```

Option A is cleaner and preserves type safety.

## Updates

### 2026-04-07

- Identified as pre-existing across audits #5 and #6
