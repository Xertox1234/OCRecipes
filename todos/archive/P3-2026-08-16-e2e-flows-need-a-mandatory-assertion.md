---
title: "E2E regression flows: fixing optional: true nesting made several flows' own subject matter entirely optional"
status: done
priority: low
created: 2026-08-16
updated: 2026-08-31
assignee:
labels: [deferred, e2e, maestro]
github_issue:
---

# Several regression flows can now pass having asserted nothing about their own subject

## Summary

While commissioning `.github/workflows/e2e-regression.yml` (see
`todos/archive/P2-2026-08-15-e2e-regression-workflow-has-never-passed.md`), a real Maestro schema bug
was fixed: `optional: true` as a sibling list-item (rather than nested inside the command's
own map) is silently ignored by Maestro, making ~59 steps across the flow suite accidentally
_mandatory_ when they were clearly authored to be optional. Fixing the nesting was correct and
necessary — but it also means those steps are now genuinely skippable, and in several flows the
skippable steps are the ones covering the flow's own stated purpose.

## Background

Flagged by `code-reviewer` during PR #838's review round. Example: `e2e/flows/home/chat.yaml`
is named "NutriCoach chat interaction," but past login and one mandatory "reached NutriCoach"
wait, every chat-specific step — opening a new chat, seeing suggested prompts, tapping one,
waiting for a response — is `optional: true`. The flow can complete green having asserted
nothing chat-related. Similar shape in `plan/browse-recipes.yaml` (the "open a recipe detail
and verify its sections" half is fully optional), `plan/grocery-list.yaml`,
`plan/meal-plan-home.yaml`, `profile/goal-setup.yaml`.

This is the same class of defect (verification that doesn't verify) that
`docs/solutions/code-quality/verification-that-scans-zero-inputs-is-green-and-meaningless-2026-08-07.md`
already documents, one level down from workflow-granularity to flow-granularity.

Not fixed as part of P2-2026-08-15 because that todo's own CI-attempt budget was exhausted on
diagnosing why the workflow doesn't go green at all yet — auditing per-flow assertion strength
only matters once the suite is passing.

## Acceptance Criteria

- [x] Each of the affected flows (`home/chat.yaml`, `plan/browse-recipes.yaml`,
      `plan/grocery-list.yaml`, `plan/meal-plan-home.yaml`, `profile/goal-setup.yaml` — verify
      this list is current, don't assume it's exhaustive) has at least one assertion that
      mandatorily (not `optional: true`) pins the behavior the flow's name/tag claims to cover.
- [x] Steps that are genuinely optional for good reason (e.g. content that may or may not be
      present depending on seeded data) stay optional — this is not "remove all
      `optional: true`," it's "each flow must have at least one non-optional assertion of its
      own subject."

## Implementation Notes

- Do this only after `P2-2026-08-15-e2e-regression-workflow-has-never-passed.md` reaches a
  genuinely green run — auditing assertion strength in a suite that doesn't run yet has no
  payoff. **SATISFIED 2026-08-31**: green on `main` (run 33352527232); that todo now lives at
  `todos/archive/P2-2026-08-15-e2e-regression-workflow-has-never-passed.md`. Partial progress
  already landed in PR #880: the two scan flows gained a mandatory SpeedDial assert and
  `home/chat.yaml`'s suggested-prompt block went from all-optional (provably dead) to
  mandatory — the rule is codified in
  `docs/solutions/logic-errors/optional-e2e-steps-cannot-fail-dead-selectors-stay-green-2026-08-30.md`.
  Re-audit the remaining flows against that doc.
- Re-verify the affected-file list against the current state of `e2e/flows/**` rather than
  trusting this list — it may drift as the parent todo's follow-up work lands.

## Scope Contract

- **Mechanisms to use:** existing Maestro flow YAML only — no new tooling.
- **Files in scope:** `e2e/flows/**/*.yaml` only.
- No app/client/server code changes.

## Dependencies

- Soft dependency on `P2-2026-08-15-e2e-regression-workflow-has-never-passed.md` reaching a
  green run first (see Implementation Notes) — satisfied 2026-08-31 (archived at
  `todos/archive/`); this todo is unblocked.

## Risks

- None significant — this is test-file-only work with no production impact.

## Updates

### 2026-08-31 — closed

All five listed flows now mandatorily assert their own subject, and the list was
re-verified against the current `e2e/flows/**` rather than trusted, as the
Implementation Notes required. Four landed in PR #880; `plan/grocery-list.yaml`
was the remainder and is fixed here.

Sweep result — every flow in the suite now carries at least one mandatory
(non-`optional`) assertion, and for the two thinnest it pins the flow's own
subject rather than a nav label (`scan-barcode.yaml` → "Scan Barcode",
`photo-analysis.yaml` → "Photo Food Log"). No flow was left below the bar, so
the affected-file list needed no expansion.

`grocery-list.yaml` had **three** defects, only the first of which this todo
named — worth recording, because two were invisible to code review:

1. **Asserted nothing** — every step past the Plan tab was `optional: true`, and
   three of those selectors could never have matched anyway: `id:
"create-grocery-list"` (the screen has no testID at all), and `text: "items"`
   / `text: "Add item..."` (both live on the GroceryList DETAIL screen, which
   this flow never opens). Found by reading source.
2. **Navigation gate too tight** — waited 5000ms on "Grocery Lists" and expired
   while the splash overlay was still up. Found only by RUNNING it; the failure
   screenshot is the splash logo. Now waits on "Browse Recipes" with a 15000ms
   margin, matching `meal-plan-home.yaml`.
3. **Local env, not the flow** — `.env` pinned a stale `EXPO_PUBLIC_DOMAIN`, so
   the app could not reach the backend and wedged. Only distinguishable from (2)
   by re-running after the timeout fix and seeing the same splash at 15s.

The flow is now tagged `regression`. It previously was not, so the nightly
(`--include-tags regression`) never executed it — a mandatory assertion in an
unrun flow protects nothing. `e2e/README.md`'s critical-flow table gained the
matching row; it is a second enumeration of the regression set.

Verified green twice on iPhone 17 Pro / iOS 26.5, with every OPTIONAL step
reporting COMPLETED rather than WARNED — i.e. the replacement selectors match,
where the originals were silently skipped.

**Residual, deliberately not filed as a follow-up:** the verification is
iOS-only; the nightly also runs Android, where a11y-label exposure and splash
timing can differ. Surfaced in the PR body for a human call rather than parked
as a todo.
