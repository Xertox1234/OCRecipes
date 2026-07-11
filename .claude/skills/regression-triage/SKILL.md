---
name: regression-triage
description: Use when the user reports a regression, something "broken AGAIN", a fix that disappeared or needs re-fixing, an old version of a screen showing, or a feature that looks built-but-never-connected — BEFORE running git archaeology, re-implementing a fix, or wiring in an orphaned component.
---

# Regression Triage — decode "it regressed" before touching git or code

## Overview

In this repo, reported regressions are almost never source-control loss (verified 2026-07-03: `main` history is append-only, branch protection with `enforce_admins` ON, no force-pushes possible). They are usually delivery or gating artifacts. Triage the observation before investigating the code: 30 seconds of pipeline checks beats hours of archaeology, and re-implementing a fix that's already live reinforces the false "we lose work" narrative.

## Triage order (stop at the first hit)

1. **Is the "missing" code on `main` right now?** `git log origin/main -- <file>` or `git grep` the fix on `origin/main`. Present → the code is fine, the _observation_ is stale; continue down this list. Absent → check reflog and PR state; only now is git archaeology warranted.
2. **Stale OTA bundle?** (physical device / dev-client build) — EAS updates download on the 1st cold start and apply on the **2nd**; one reopen can never show a new bundle. Check what's actually published: `npx eas-cli update:list --branch preview --limit 3 --non-interactive --json`. If the latest publish predates the fix, the fix never reached the device — republish via `npm run update:preview -- --message "..."` (get the user's go-ahead: it ships everything on `main`, not just this fix), then two cold starts.
3. **Premium gate?** ("old Coach" / "basic chat" reports) — Coach renders two surfaces _by design_: CoachPro (premium) vs legacy ChatList/ChatScreen ("NutriCoach" header, free tier). The gate is `ChatStackNavigator` `initialRouteName={isCoachPro ? ... }`, evaluated once at mount. Pinned fact: `demo/demo123` is the ONLY premium account in the dev DB — any other test account correctly shows the basic surface.
4. **Deep-link bypass?** — `ocrecipes://chat/:id` routes to the legacy `Chat` screen by name, bypassing the premium gate entirely — it ALWAYS shows basic chat, for every tier. Honest verification of CoachPro means: premium account, tap the Coach tab (not reachable via simctl — ask the user), Metro warm.
5. **Redesign orphan?** ("built but never connected") — before wiring in an unreferenced component, run `git log --oneline --all -- '**/<Component>*'`. Orphaned by a redesign or deleted in a reviewed sweep → surface that decision to the user instead of re-wiring; reconnecting it is a product revert, not a fix. Known deliberate retirements: the Home quick-actions redesign (`8d6255f8`) and PR #384's five health features (never restore).

## When it IS real

If the code is absent from `main` — or present AND the failure reproduces on a verified-fresh bundle, the right account tier, and the real navigation path — it is a genuine regression. Stop triaging and switch to superpowers:systematic-debugging. Do not keep blaming the bundle: the triage list explains _phantom_ regressions, not all regressions.

## Honest-verification protocol (before telling the user "not a regression")

- Two cold starts after any OTA publish, or test a fresh dev build. Simulator + live Metro has no OTA layer — bundle staleness cannot explain a simulator bug.
- The right account tier for the surface under test.
- The real navigation path (tab tap), not a deep link.

## Common mistakes

- Re-implementing a fix that's already on `main` — produces a no-op or duplicate diff and confirms the user's false "we're losing work" fear instead of resolving it.
- `git blame`/`bisect` before checking which bundle, account, and route produced the observation.
- Concluding "OTA is broken" from a one-reopen test.
- Restoring deliberately retired components or features because they "look disconnected".
