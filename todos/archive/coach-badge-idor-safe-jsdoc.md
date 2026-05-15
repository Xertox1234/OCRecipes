---
title: "Move getUserIdPage // idor-safe annotation into JSDoc block"
status: in-progress
priority: low
created: 2026-05-01
updated: 2026-05-01
assignee:
labels: [dx, storage, coach-badge]
---

# Move getUserIdPage // idor-safe annotation into JSDoc block

## Summary

The `// idor-safe` comment on `getUserIdPage` is placed inline on the function declaration line rather than in the JSDoc block above it. This is inconsistent with the rest of `server/storage/users.ts` and makes the rationale easy to miss when reading the function signature.

## Background

`server/storage/users.ts:218`:

```ts
export async function getUserIdPage( // idor-safe: scheduler-only; iterates all users by design
  afterId: string | null,
  limit = 500,
): Promise<string[]> {
```

The `// idor-safe` escape-hatch comment needs to stay on (or adjacent to) the function declaration line for `scripts/check-idor-storage.js` to detect it (the script scans for the pattern on the function line). But the rationale ("scheduler-only; iterates all users by design") belongs in the JSDoc.

## Acceptance Criteria

- [ ] Verify that `scripts/check-idor-storage.js` detects `// idor-safe` on the function declaration line (confirm the script's grep pattern)
- [ ] If the script only needs the comment on the same line as `function`, keep `// idor-safe` there and move the rationale into JSDoc
- [ ] If the script can detect the comment anywhere in the preceding JSDoc block, move the entire annotation into JSDoc
- [ ] `npm run lint` passes with no regressions

## Implementation Notes

Desired outcome (if script only needs it on the declaration line):

```ts
/**
 * Fetch a page of user IDs ordered by id for cursor-based iteration.
 * ...
 * idor-safe: This function intentionally iterates all users — it is
 * only called by the notification scheduler (server-side cron job) and
 * is never exposed per-user via a route handler.
 */
export async function getUserIdPage( // idor-safe
  afterId: string | null,
  limit = 500,
): Promise<string[]> {
```

## Dependencies

- None

## Risks

- Trivial — cosmetic only; verify the IDOR check still passes after the move

## Updates

### 2026-05-01

- Identified during code review of coach-badge todo session
