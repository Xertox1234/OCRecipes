<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Isolate evals/**tests**/judge.test.ts from the live Postgres pool import chain"
status: done
priority: low
created: 2026-07-12
updated: 2026-07-12
assignee:
labels: [deferred, testing]
github_issue:

---

# Isolate evals/\_\_tests\_\_/judge.test.ts from the live Postgres pool import chain

## Summary

The judge formatter unit test transitively requires a valid `DATABASE_URL` just to import, because `evals/judge.ts` imports `formatAboutUserLines` from `server/services/nutrition-coach.ts`, whose `coach-tools` import chains to `server/db.ts` (which throws at module load when `DATABASE_URL` is unset). Mock the collaborator chain so a pure string-formatting test doesn't need a database.

## Background

Review finding on PR #579 (non-blocking WARNING). CI and normal local dev stay green (`ci.yml` sets `DATABASE_URL`; `.env` has it), but `DATABASE_URL= npx vitest run evals/__tests__/judge.test.ts` throws at collection time — a debugging trap for anyone running that file in isolation. The sibling `server/services/__tests__/nutrition-coach.test.ts` already mocks exactly this chain; `judge.test.ts` was added (same PR, review-fix commit `211208ab`) without those mocks.

## Acceptance Criteria

- [ ] `DATABASE_URL= npx vitest run evals/__tests__/judge.test.ts` passes with no database configured
- [ ] The existing three judge tests still pass unchanged
- [ ] No change to production code (test-file-only fix), OR, if the alternative is chosen, `formatAboutUserLines` + `CoachContext`/`CoachAllergy` move to a dependency-light module with all imports updated

## Implementation Notes

Minimal, precedent-matching fix — mirror `nutrition-coach.test.ts`'s mocks in `evals/__tests__/judge.test.ts`:

```ts
vi.mock("../../server/services/coach-tools", () => ({
  getToolDefinitions: () => [], // nutrition-coach.ts runs Object.freeze(getToolDefinitions()) at module scope
  executeToolCall: vi.fn(),
  MAX_TOOL_CALLS_PER_RESPONSE: 5,
  serviceUnavailable: vi.fn(),
}));
```

`server/lib/openai.ts` does NOT need mocking (it constructs with a placeholder key and never throws at import). The larger alternative — extracting the shared renderer + types into a dependency-light module — is optional and wouldn't help `evals/runner.ts`, which is DB-coupled regardless.

## Dependencies

- None (PRs #579–#583 all merged)

## Risks

- `getToolDefinitions` must be stubbed to return an array, or the module-scope `Object.freeze(getToolDefinitions())` in nutrition-coach.ts throws.

## Updates

### 2026-07-12

- Initial creation from PR #579 review finding (Coach prompt-improvement landing session)
