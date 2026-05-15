---
title: "Eliminate redundant computation of Project Rules in runCli live mode"
status: in-progress
priority: low
created: 2026-05-11
updated: 2026-05-11
assignee:
labels: [refactor, code-quality, deferred]
github_issue:
---

# Eliminate redundant computation of Project Rules in runCli live mode

## Summary

In `scripts/delegate-copilot-issue.ts` `runCli` (around lines 870-877), the
live mode flow computes the Project Rules section twice: once internally
inside `buildIssueBody` (which is then sent as the GitHub Issue body), and a
second time on the next 3 lines to produce the string written into the local
todo file via `writeProjectRulesSectionToTodo`. Same inputs, deterministic
output, two passes through `detectedDomains` + `buildProjectRulesSection`
plus ~13 redundant `fs.readFileSync` calls on small rule files per live
delegation.

## Background

Surfaced by the final code review of PR #149 (commit `0dec1cdd` on
`feature/copilot-pattern-awareness`, since merged to main). The reviewer
flagged it as "cosmetic inefficiency — two `fs.readFileSync` calls on the
same rule files — not a correctness issue." Acceptable for v1 but worth
cleaning up the next time this code is touched.

## Acceptance Criteria

- [ ] `runCli` in `scripts/delegate-copilot-issue.ts` computes the
      `projectRules` string exactly once per live delegation
- [ ] Refactor approach: either (a) have `buildIssueBody` return both the
      body and the rules section as a tuple/object, or (b) extract a
      `buildProjectRulesForTodo(todo)` helper that both `buildIssueBody`
      and the live-mode wiring call once each, with memoization at the
      caller level
- [ ] All 70 existing tests in `scripts/__tests__/delegate-copilot-issue.test.ts`
      still pass without modification
- [ ] No change to the output of `buildIssueBody` or
      `writeProjectRulesSectionToTodo` — behavior is preserved, only the
      compute count drops
- [ ] If approach (a) is taken, update the existing test
      "writes Project Rules section into the local todo on successful live delegate"
      and the buildIssueBody injection tests if their signatures change

## Implementation Notes

Files in scope:

- scripts/delegate-copilot-issue.ts
- scripts/**tests**/delegate-copilot-issue.test.ts

Approach (a) — return a tuple — is the cleaner one. Sketch:

```typescript
export function buildIssueBody(todo: TodoTask): {
  body: string;
  projectRulesSection: string;
} {
  const domains = detectedDomains(todo.referencedFiles, todo.labels);
  const projectRulesSection = buildProjectRulesSection(domains);
  // ...assemble body with ${projectRulesSection} interpolated...
  return { body, projectRulesSection };
}
```

Then in `runCli`:

```typescript
const { body, projectRulesSection } = buildIssueBody(todoForIssue);
const issueUrl = createCopilotIssue(todoForIssue, runner, body);
writeGithubIssueToTodo(resolvedPath, issueUrl);
writeProjectRulesSectionToTodo(resolvedPath, projectRulesSection);
```

This requires `createCopilotIssue` to accept the pre-built body string
rather than building it itself. Audit all callers.

Approach (b) — separate helper, called twice from different sites — is
less invasive but the two callers must agree on inputs which is fragile.

## Dependencies

None.

## Risks

- Low. Test coverage already pins the output exactly; any regression in
  body content or rules section content fails existing tests immediately.

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

- Deferred from PR #149 final review. Cosmetic, not blocking.
