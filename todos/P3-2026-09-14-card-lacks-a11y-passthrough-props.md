---
title: "Card.tsx does not forward importantForAccessibility/accessibilityElementsHidden, forcing wrapper Views at call sites"
status: backlog
priority: low
created: 2026-09-14
updated: 2026-09-14
labels: [deferred, accessibility, mobile]
github_issue:
---

# Card.tsx does not forward the accessibility hiding props

## Summary

`client/components/Card.tsx` has no rest-spread on its root, so it cannot forward
`importantForAccessibility` / `accessibilityElementsHidden`. Call sites that need to hide a
card subtree must wrap it in an extra `View`, which is what
`client/screens/SettingsScreen.tsx` does in three places.

## Background

Deferred out of PR #963. That PR's Scope Contract did not include `Card.tsx`, so it added
three single-purpose wrapper `View`s as the in-contract stand-in and left a comment saying
the real fix "belongs in a follow-up that touches Card.tsx". Review of #963 found that no
such follow-up existed — this file is it, so the promise now has a tracking artifact.

Per `CLAUDE.md` → Deferred Item Todos, a Low-severity out-of-scope followup is the tier
that auto-files without a gate.

## Acceptance Criteria

- [ ] `Card` forwards `importantForAccessibility` and `accessibilityElementsHidden` to its
      root, in the style of the existing `ProductChip` passthrough.
- [ ] The three wrapper `View`s in `client/screens/SettingsScreen.tsx` are removed and the
      props are passed to `Card` directly.
- [ ] Behaviour is unchanged for every other `Card` caller (the props are optional).

## Implementation Notes

`ProductChip` already implements the pattern this should copy. Prefer a narrow explicit
pair of optional props over a broad `...rest` spread, so `Card`'s API stays deliberate and
a typo in an unrelated prop still fails type-checking.

Removing the wrapper `View`s will re-indent a large block of `SettingsScreen.tsx`; that is
expected churn, not drift — keep the diff to the unwrap plus indentation.

## Scope Contract

- **Mechanisms to use:** two optional passthrough props on `Card`, matching `ProductChip`.
- **Files in scope:** `client/components/Card.tsx`, `client/screens/SettingsScreen.tsx`,
  and their co-located tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Builds on PR #963, which introduces the wrapper `View`s this removes.
