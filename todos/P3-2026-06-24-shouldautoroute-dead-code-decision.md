<!-- Filename: P3-2026-06-24-shouldautoroute-dead-code-decision.md  (P0=critical … P3=low) -->

---

title: "Decide: delete dead `shouldAutoRoute` export, or wire auto-routing WITH the premium gate"
status: backlog
priority: low
created: 2026-06-24
updated: 2026-06-24
assignee:
labels: [deferred, rn-ui-ux, camera]
github_issue:

---

# `shouldAutoRoute` is exported + unit-tested but has zero production callers

## Summary

`shouldAutoRoute` (`client/screens/scan-screen-utils.ts:186-188`, `return confidence >= 0.7`)
is exported and exercised only by `client/screens/__tests__/scan-screen-utils.test.ts`
— **no production caller**. Every smart scan funnels through the confirm chip, so the
premium gate is only ever evaluated at confirm time (inside `resolveSmartConfirmAction`).
Decide whether to delete the dead export or wire auto-routing properly.

## Background

Surfaced (and explicitly deferred) by the close-out of
`P2-2026-06-24-smart-confirm-reset-no-user-feedback.md` (its _Related — do NOT fix
here_ section). Captured as its own todo so the flag survives that todo's archival.

Latent risk: if auto-routing is ever wired up so a high-confidence classification
skips the confirm chip, a gated content type (`menuScanner` / `cookAndTrack` /
`receiptScanner`) could **bypass the premium gate**, because today the gate check
lives in the confirm path only. No inconsistency exists today — this is a guardrail
for a future change.

## Acceptance Criteria

- [ ] Make a decision and act on it: either
  - **Delete** `shouldAutoRoute` and its unit test (the simplest fix — it is dead
    code today), **or**
  - **Wire auto-routing** behind it such that the premium gate (`gate &&
!features[gate.feature]`, `scan-screen-utils.ts:166-168`) is evaluated **before**
    any `getRouteForContentType` auto-navigation — a high-confidence gated scan must
    still reach `UpgradeModal`, never silently route past it.
- [ ] No production code path lets a gated content type auto-navigate without the gate.

## Implementation Notes

- Touch points: `client/screens/scan-screen-utils.ts` (the `shouldAutoRoute` def at
  `:186-188`, and the gate logic in `resolveSmartConfirmAction` ~`:166-168`),
  `client/screens/__tests__/scan-screen-utils.test.ts` (the only importer).
- LSP-first: confirm the caller set with `findReferences` before deleting (resolves
  the `@/` alias); grep at close-out time found only the definition + the test import.
- If deleting, that is a minimal change — no behavior shift, since nothing calls it.

## Dependencies

- None.

## Risks

- Low. Deletion is behavior-neutral today. The only real risk lives in the _wire-up_
  branch (gate-bypass), which the acceptance criteria explicitly guard against.

## Updates

### 2026-06-24

- Created at close-out of the smart-confirm-reset-feedback todo to preserve its
  flagged dead-code decision.
