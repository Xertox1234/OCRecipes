<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Fix stale novaGroup/nutriScore comment in server/routes/nutrition.ts"
status: done
priority: low
created: 2026-07-24
updated: 2026-07-24
assignee:
labels: [deferred, cleanup, scan]
github_issue:

---

# Fix stale novaGroup/nutriScore comment in server/routes/nutrition.ts

## Summary

A comment in `server/routes/nutrition.ts` says raw `novaGroup`/`nutriScore` scalars are "kept — they are displayed", but no client render actually reads those raw scalar fields (see `todos/archive/P3-2026-07-22-smart-scan-v1-cleanup.md`, which dropped the client-side `NutritionData.novaGroup`/`nutriScore` fields as dead). The comment is now misleading.

## Background

Flagged by the todo-researcher during `P3-2026-07-22-smart-scan-v1-cleanup`: the scalars ARE consumed server-side as input into `evaluateUniversalFlags` (which is how they actually reach the user — as the `processing:ultra` and `nutriscore:<grade>` computed flags), but the _raw_ `novaGroup`/`nutriScore` values left in the response body are never rendered anywhere, client or server, after the cleanup todo removed the client hook's only reader. Out of scope for that todo (file list was client-only; `server/routes/` is also a sensitive path that would have held its auto-merge eligibility), so surfaced here instead.

## Acceptance Criteria

- [ ] Update the comment at `server/routes/nutrition.ts` (near the `clientResult` destructure, currently reads "`novaGroup` and `nutriScore` are kept — they are displayed") to accurately describe that they're consumed as flag-computation input, not rendered as raw values — OR drop the two fields from the response body entirely if confirmed unused by any client code path (re-verify no client added a reader in the meantime).
- [ ] Grep the client for `.novaGroup`/`.nutriScore` reads before removing the fields from the wire payload, to catch any new consumer added since this todo was filed.

## Implementation Notes

Files: `server/routes/nutrition.ts` only. Low-risk, comment/DTO-trim only — no computed-flag logic changes.

## Risks

- `server/routes/` is on the sensitive-path allowlist for the todo automerge guard — this PR will need individual review regardless of priority label.

## Updates

### 2026-07-24

- Filed by the P3-2026-07-22-smart-scan-v1-cleanup todo executor (out-of-scope finding).
- **Resolved (comment fix, not DTO trim).** Re-ran the AC's grep: no client
  reads the raw `novaGroup`/`nutriScore` scalars. `NutritionDetailScreen.tsx:380`
  renders `partition.nutriScore?.grade`, a `ScanFlag` derived from
  `orderedFlags` by `nutrition-detail-flags-utils.ts` — not this field. The only
  other client hit is a mock server-response fixture in
  `client/hooks/__tests__/useNutritionLookup.test.ts:278-279`. No client type
  declares the scalars at all (the 2026-07-22 cleanup removed them).
- **Deliberately did NOT drop the fields from the response body**, though the AC
  allowed it. The grep proves no reader in current _source_; it cannot prove no
  reader in a _deployed_ bundle. The client-side fields were removed only on
  2026-07-22, EAS Updates apply on second cold start, and there is an
  embedded-vs-OTA user split — so clients running the pre-cleanup bundle may
  still read them. A wire-contract trim is outward-facing and not reversible for
  users already on an old bundle, so the AC's "confirmed unused" condition is
  not met. The rewritten comment records this and the condition under which the
  trim becomes safe.
