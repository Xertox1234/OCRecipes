---
title: "Four storage functions run several queries at once on one transaction client — pg@9 will refuse it"
status: backlog
priority: low
created: 2026-10-12
updated: 2026-10-12
assignee:
labels: [deferred, database, auth]
github_issue:
---

# Four storage functions run several queries at once on one transaction client — pg@9 will refuse it

## Summary

Four storage functions wrap two or more queries on the same transaction client (`tx`) in `Promise.all`. A transaction uses one connection, so `pg` queues the queries and the code works today. But `pg` 8.21 prints a deprecation warning, and pg@9 removes the queueing. After that upgrade, these functions would fail. That includes turning two-step off, both in the app and in the manual reset.

## Background

Seen on 2026-10-12 while running the manual reset (`scripts/mfa-reset.ts --commit`) on production. The reset succeeded, but printed:

```
DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0.
```

Sites, found with a search that matches across line breaks: a `Promise.all([` whose first element is `tx`, in the `server/**/*.ts` files outside `__tests__/` that contain `Promise.all`. It printed 5 hits, and `mfa.ts:343` served as the positive control.

| Site                                                                    | What runs at once on `tx`     |
| ----------------------------------------------------------------------- | ----------------------------- |
| `server/storage/mfa.ts:343` (`disableMfa`)                              | 4 deletes                     |
| `server/storage/meal-plan-recipes-crud.ts:378` (`deleteMealPlanRecipe`) | junction-row deletes          |
| `server/storage/community-recipes.ts:382`                               | junction-row deletes          |
| `server/storage/chat-quota.ts:47`                                       | 3 selects (`tx` is passed in) |

The fifth hit, `server/storage/favourite-recipes.ts:81`, is not a problem. Only one element of its `Promise.all` uses `tx`; the other reads through `db` (a separate pool connection), as the comment above it says.

The search only matches when the first array element is a `tx` call. An array that starts with something else and uses `tx` later would be missed. That is why the last acceptance criterion asks for a check by hand.

A first, single-line grep missed every site except `mfa.ts`. That grep looked for `tx.`, but this code puts `tx` and `.delete(` on separate lines. The PR #1397 review caught the miss.

Deferred because it was out of scope: the session was recovering the owner's two-step after a key change (see P1-2026-10-11-mfa-key-change-fails-silently).

## Acceptance Criteria

- [ ] At each of the four sites, the `tx` queries run one after another (`await` each) inside the same transaction. A `db` query may stay in a `Promise.all` next to a single `tx` query.
- [ ] Tests covering these functions still pass; nothing else changes.
- [ ] Re-check `server/` for `Promise.all` arrays holding two or more `tx` queries in any position, not only the first. Fix any further site found.

## Implementation Notes

- No speed cost: `pg` already runs these queries one at a time on the single connection. Writing them as sequential `await`s just makes that explicit.

## Scope Contract

- **Mechanisms to use:** plain sequential `await`s — nothing new.
- **Files in scope:** `server/storage/mfa.ts`, `server/storage/meal-plan-recipes-crud.ts`, `server/storage/community-recipes.ts`, `server/storage/chat-quota.ts` (plus any further site the re-check finds).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- `mfa.ts` is auth storage: implement it in a session, don't delegate it (AUTH IS HIGH-RISK).

## Updates

### 2026-10-12

- Initial creation
- Widened from `disableMfa` alone to four sites after the PR #1397 review.
