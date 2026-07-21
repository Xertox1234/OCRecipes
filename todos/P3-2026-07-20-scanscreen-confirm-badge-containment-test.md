---
title: "Add DOM containment + a11y regression test for the returnAfterLog confirm-card safety badge"
status: backlog
priority: low
created: 2026-07-20
updated: 2026-07-20
assignee:
labels: [deferred, accessibility, testing]
github_issue:
---

# Add DOM containment + a11y regression test for the returnAfterLog confirm-card safety badge

## Summary

Task 9 of the Smart Scan Phase 1 (Allergen Safety) plan added a safety-flag
badge to the `returnAfterLog` confirm card in `client/screens/ScanScreen.tsx`,
verified only via a pure-function unit test (`buildLoadedConfirmCard`'s
`safetyFlag` field) and manual code reading of the JSX placement. No
component-render test locks the badge's DOM position or its `accessible`
wrapper behavior.

## Background

The sibling task (Task 8, ProductChip scan-lock badge) shipped its badge
first, then needed a same-day follow-up fix (commit `8892c990`) adding
`accessible={true}` on the badge `View` (so VoiceOver reads the composed
`accessibilityLabel` instead of drilling into the icon/text children) plus a
DOM containment test explicitly locking the badge as a sibling above the
product row, not nested inside a flex-row (a placement trap that
`getByText` alone doesn't catch).

Task 9 proactively applied the same `accessible={true}` fix inline (learned
from Task 8's precedent, not from a bug found here) before shipping, but no
equivalent containment test was written — the brief's Step 1 only specified
a pure-function test for `buildLoadedConfirmCard`, and a full `ScanScreen`
component render test requires substantially more mock setup (barcode scan
→ `SESSION_COMPLETE` dispatch → `returnAfterLog` fetch) than was in scope
for that step.

## Acceptance Criteria

- [ ] A render-based test (mirroring
      `client/camera/components/__tests__/ProductChip.safetyFlag.test.tsx`)
      drives `ScanScreen` to the `returnAfterLog` confirm-card state with a
      `safetyFlag` present and asserts:
  - the badge renders as a sibling within the confirm card, not nested
    inside `styles.confirmButtons` (the flex-row trap)
  - the badge exposes exactly one accessible node with the composed label
    (title + detail), not separate nodes for the icon and text
  - the "Log It" button remains enabled (`canLog` not gated by
    `safetyFlag`) when a severe flag is present

## Implementation Notes

- Reference precedent: `git show 8892c990` for the ProductChip version of
  this same test pattern.
- `ScanScreen.test.tsx` already has scan-lock/dispatch mocking scaffolding
  usable as a starting point (see `describe("ScanScreen — barcode lock
wiring...")`).

## Scope Contract

- **Mechanisms to use:** standard Vitest + RN Testing Library render, no new
  test infra.
- **Files in scope:** `client/screens/__tests__/ScanScreen.test.tsx` (or a
  new co-located `ScanScreen.confirmSafetyBadge.test.tsx`).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None — Task 9 (`returnAfterLog` confirm-card badge) is already merged/shipped;
  this is test-coverage-only.

## Risks

- Low — coverage gap only, not a known defect. Manual JSX read confirmed
  correct sibling placement and `accessible={true}` at implementation time.

## Updates

### 2026-07-20

- Filed during Task 9 implementation (Smart Scan Phase 1) as a low-severity
  deferred follow-up, per the Task 8 precedent that found this exact gap.
