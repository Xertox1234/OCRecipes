---
title: "Replace require() with ESM import in LLM drift-detection test"
status: backlog
priority: low
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [code-quality, testing, deferred]
github_issue:
---

# Replace require() with ESM import in LLM drift-detection test

## Summary

The `LLM_TOUCHING_SERVICES drift detection` test in
`scripts/__tests__/delegate-copilot-issue.test.ts` uses a CJS-style dynamic
require for `child_process`:

```typescript
const result = require("child_process").execSync(
  `grep -l "openai\\|OpenAI\\|gpt-\\|completions\\|anthropic" server/services/*.ts || true`,
  { encoding: "utf8" },
);
```

The rest of the file uses ESM imports (`import * as fs from "fs"` etc.).
Vitest accepts both today, but the inconsistency would trip a strict
ESM-only bundler audit and looks out of place. Refactor to a top-of-file
named import.

## Background

Surfaced by code reviews of Task 2 (the drift test) and the final review
of PR #149. Marked as Minor / style consistency.

## Acceptance Criteria

- [ ] `child_process` `execSync` is imported via a top-of-file ESM import:
      `import { execSync } from "node:child_process"`
- [ ] The drift test in
      `scripts/__tests__/delegate-copilot-issue.test.ts` calls
      `execSync(...)` directly (no `require()`)
- [ ] The test still passes:
      `npx vitest run scripts/__tests__/delegate-copilot-issue.test.ts -t "LLM_TOUCHING_SERVICES drift"`
- [ ] No other tests break

## Implementation Notes

Files in scope:

- scripts/**tests**/delegate-copilot-issue.test.ts

The change is two lines:

1. At the top of the file, add:

   ```typescript
   import { execSync } from "node:child_process";
   ```

2. In the drift test body, replace:
   ```typescript
   const result = require("child_process").execSync(...)
   ```
   with:
   ```typescript
   const result = execSync(...)
   ```

## Dependencies

None.

## Risks

- None. Identical runtime semantics; style-only change.

## Project Rules

The rules below are binding. If any rule conflicts with the acceptance criteria, raise it in a PR comment rather than silently violating it. Open the linked pattern file for full context if a rule isn't clear.

### testing

- Every storage function that applies an IDOR ownership filter (`userId` scope) must have a "wrong userId returns undefined/null" test alongside the happy path
- Dual-Assertion IDOR test pattern: (1) assert correct user gets data, (2) assert different user gets nothing — both in the same test suite
- Never mix real and mocked implementations in `vi.mock` of the storage facade — mock all or mock none; partial mocks hide coupling
- Tests that verify a rate limiter must call the endpoint N+1 times and assert the (N+1)th call returns 429

### typescript

- Never use `as` cast on a bare `text` DB column to derive a discriminated type — use a type guard (`function isFoo(x: string): x is Foo`) or Zod enum `.parse()`
- Never cast navigation types with `as never` or `as unknown` — define `CompositeNavigationProp` in `client/types/navigation.ts` for 3-level stack → tab → root composites
- JSONB columns typed with `$type<MyType>()` hint in the schema — don't add redundant `as MyType` casts on top of them
- Use a named update-fields type (e.g., `UpdateUserFields`) instead of `Partial<User>` in storage update functions — the narrower type surfaces compile-time errors when schema changes, and prevents mass-assignment
- `Drizzle .default([])` does NOT fix the TypeScript type — the inferred type stays `T[] | null` (not `T[]`); add `.notNull()` to make the TS type non-nullable and prevent null-access crashes on legacy rows
- PostgreSQL decimal aggregates (SUM, AVG) return strings via Drizzle — always `parseFloat()` or `Number()` the result

**Further context (open the URL if a rule above isn't clear):**

- https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns/testing.md
- https://github.com/Xertox1234/OCRecipes/blob/main/docs/patterns/typescript.md

## Updates

### 2026-05-11

- Deferred from PR #149 final review.
