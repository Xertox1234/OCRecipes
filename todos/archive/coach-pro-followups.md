---
title: "Coach Pro — Followup Hardening & Service Extraction"
status: done
priority: medium
created: 2026-04-17
updated: 2026-04-17
assignee:
labels: [coach-pro, ai, audit-followup]
---

# Coach Pro Followup Hardening

## Summary

Coach Pro had 11 Medium/Low findings in audit 2026-04-17 that didn't rise to
High but cluster into a coherent hardening pass: notebook-extraction
correctness, warm-up cache identity, type safety, and service decomposition.

## Background

Many of these are residual from the service-extraction refactor (commit
`b41245f`). That refactor moved code but preserved some pre-existing issues
that the audit agents re-flagged.

## Acceptance Criteria

- [ ] **M2** Wrap notebook content in `<notebook_entry>...</notebook_entry>`
      delimiters in the coach system prompt; also apply `sanitizeUserInput()`
      to raw user/assistant messages passed to `extractNotebookEntries` in
      `server/services/notebook-extraction.ts:62-68` (prompt-injected user
      turns can poison what gets extracted into the notebook)
- [ ] **M6** Add conversation-turn fingerprint (hash of `conversationId` +
      last user+assistant message pair) to `createNotebookEntries` write path;
      use `.onConflictDoNothing` on the unique index
- [ ] **M7** Change extraction schema: `followUpDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional()` — reject "next week" at Zod layer
- [ ] **M8** Warm-up cache key = `${userId}:${conversationId}` (not just
      `userId`); convert to `createSessionStore<WarmUp>({ maxPerUser: 1, maxGlobal: 1000, timeoutMs: 30_000 })` to inherit LRU bounds (also addresses **L17**)
- [ ] **L2** Replace `${userId}-${Date.now()}` warm-up ID with `crypto.randomUUID()` (defense-in-depth only; not currently exploitable)
- [ ] **M13** / **L16** Use shared `Allergy` type from `shared/schema.ts:67`
      in `coach-pro-chat.ts:116-119` instead of local `{ name: string }[]`
      cast. Type `coach-warm-up.ts` message role as `"user" | "assistant" | "system"` union
- [ ] **L6** `shouldUpdateStrategy`: read `currentCount` inside the same
      transaction as the insert, OR add a unique index on `(userId, "strategyAt:" || weekBucket)` to prevent double-writes
- [ ] **L8** Time-gate `archiveOldEntries` to once per day per user
      (add `lastArchivedAt` column on `userProfiles` or track in-memory)
- [ ] **L15** Replace 11 `as any` casts in `coach-pro-chat.test.ts` with
      properly typed fixtures (use `satisfies Partial<UserProfile>`)
- [ ] **L19** Extract pure fns from `handleCoachChat`: - `calculateWeeklyRate(weightLogs)` → `server/services/weight-trend.ts` - `truncateNotebookToBudget(entries, maxChars)` → new `server/services/notebook-budget.ts` - `hashCoachCacheKey(userId, contextHash, content)` → new helper or
      inlined but tested

## Implementation Notes

- M2's delimiter pattern is documented in `docs/patterns/security.md` "AI
  Input Sanitization — Defense-in-Depth with Delimiters" (pre-existing).
- L19 extraction should come with tests — the pure fns are trivial to test
  once extracted, but currently buried inside a 230-LOC handler.

## Related Audit Findings

M2, M6, M7, M8, M13, L2, L6, L8, L15, L16, L17, L19 (audit 2026-04-17)

## Updates

### 2026-04-17

- Created from audit #11 deferred Medium/Low items
