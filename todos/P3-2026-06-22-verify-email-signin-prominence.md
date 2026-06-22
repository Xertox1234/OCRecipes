---
title: "Promote the 'Back to sign in' affordance when VerifyEmailScreen is in the linkSent state"
status: blocked
priority: low
created: 2026-06-22
updated: 2026-06-22
assignee:
labels: [deferred, ui, auth]
github_issue:
---

# Promote the "Back to sign in" affordance in the `linkSent` pending sub-state

## Summary

On `VerifyEmailScreen`, the `pending` state now has two stacked buttons: primary
"Resend email" and a ghost "Back to sign in" below it (added in PR #427). In the
`linkSent` ("Check your inbox") sub-state — the exact screen a user who just
verified in the browser returns to — "Back to sign in" is the action they most
likely want, yet it's the de-emphasized secondary button. Consider raising its
prominence when `linkSent` is true.

## Background

Deferred from the PR #427 review (the verify-email → login hand-off). I flagged
button hierarchy as **optional polish, not a defect**, and explicitly kept it out
of #427 to avoid an unreviewed behavioral change to an auth screen at merge time.
One button set serves both pending sub-states:

- **not-sent** ("Verify your email") — "Resend email" is correctly primary.
- **linkSent** ("Check your inbox") — the user has already sent the link and may
  have just verified elsewhere; "Back to sign in" is arguably the primary intent.

The current compromise (Resend always primary) is defensible but not optimal for
the linkSent case.

## Acceptance Criteria

- [ ] In the `linkSent` pending sub-state, the path to Login is visually primary
      (or at least co-equal), without hiding "Resend email".
- [ ] The not-sent pending sub-state keeps "Resend email" as the primary action.
- [ ] No change to the no-auto-auth property — both buttons remain pure
      navigation / resend; no token is issued.

## Implementation Notes

- File in scope: `client/screens/VerifyEmailScreen.tsx` (the `pending` else-branch
  buttons). One lever: make button `variant` conditional on `linkSent` (e.g. swap
  primary/ghost between the two buttons), or reorder them.
- **Re-run accessibility checks after any variant change.** The original ghost
  affordance was contrast-verified (5.09:1 light / 5.52:1 dark) by the
  accessibility-specialist in the #427 review; a different `variant` has different
  colors and must be re-verified against WCAG AA, in both light and dark mode.
- React Compiler is active — no manual memoization needed.
- Keep the neutral "Back to sign in" label (reads fine in both sub-states); this
  todo is about prominence, not copy.

## Dependencies

- None. Built on top of the merged PR #427.

## Risks

- Low. Pure presentation change. The only real risk is regressing the ghost-button
  contrast if the variant changes — covered by the AC + the a11y re-check note.

## Updates

### 2026-06-22

- Filed from the PR #427 (`verify-email-login-handoff`) review as the optional UX
  refinement that was intentionally excluded from that merge.

### 2026-06-22 (blocked via `/todo` — implementation done, gated on an a11y token fix)

- Implementation is **complete and contrast-neutral**, preserved on branch
  `todo/P3-2026-06-22-verify-email-signin-prominence` @ `cfd8afa7` (pushed to
  origin, no PR): `Resend` → `variant={linkSent ? "ghost" : "primary"}`,
  `Back to sign in` → `variant={linkSent ? "primary" : "ghost"}`. onPress handlers
  untouched (no auto-auth). types/lint/5628 tests green in-worktree.
- **Blocked, not failed.** The variant swap makes the solid `primary` button the
  active variant on "Back to sign in" in the `linkSent` state, and the solid
  primary is white `#FFFFFF` on dark `link` `#E07050` = **3.18:1** — fails WCAG AA
  (4.5:1; button text is 16px → not large-text-exempt). The swap does NOT
  introduce this (the `pending` state already had one failing solid primary —
  "Resend email"); it's contrast-neutral. But this todo is `priority: low` →
  auto-merge with no human review, so shipping a CRITICAL-flagged auth-screen
  variant unreviewed was refused.
- **Root cause is app-wide**, tracked as a separate reviewed fix (Deliverable B):
  `theme.link` is overloaded as both link/accent _text_ (needs to be light on dark
  bg — passes) and solid _fill_ under white content (needs to be dark — fails) in
  dark mode; these are mathematically incompatible, so `accentSolid` is being split
  out of `link` and the 65 solid `backgroundColor: theme.link` fills swept onto it.
- **Unblock condition:** once `theme.accentSolid` lands and the primary button uses
  it (AA-safe with white), re-open this to `backlog` and merge `cfd8afa7` — the
  swap will be unambiguously AA-passing in both sub-states.
