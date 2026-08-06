---
title: "Delete useNutritionLookup's duplicate iOS ERROR announcer — InlineError owns it after slice 2c (the notices half landed in #753)"
status: backlog
priority: high
created: 2026-08-04
updated: 2026-08-06
assignee:
labels: [deferred, accessibility, hooks]
github_issue:
human_led: true
blocked_reason: "Blocked on PR #753 merging — `main`'s NutritionDetailScreen does not render `InlineError` at all, so deleting the hook's error announcer before 2c lands leaves iOS silent (verified 2026-08-06). Then device-gated: iOS VoiceOver is the only instrument that can confirm one utterance; jsdom observes that the announce mock was called, never what a screen reader says."
---

# Delete useNutritionLookup's duplicate iOS error announcer

> **Priority note:** `high` reflects the **merge gate**, not the blast radius. The severity is
> Medium. Screen-reader announcement behaviour is device-verifiable only, so this todo must never
> arm auto-merge (`scripts/todo-automerge-guard.sh` keys on priority). Same reasoning as the slice
> 2c todo.

## Summary

`client/hooks/useNutritionLookup.ts` fired two iOS `AccessibilityInfo.announceForAccessibility`
effects — one for the notices, one for the error. Slice 2c gave both surfaces their own announcers
(`NoticeStack` and `InlineError`), making the hook's redundant.

**The notices half is DONE — it landed inside #753 itself, not here.** Only the error effect
remains. See the 2026-08-06 update below for why the split happened and what it changed.

## Background

Found during slice 2c's Task 8 review (branch `feat/nutrition-detail-2c`). The 2c plan and
`NoticeStack.tsx`'s docblock both asserted that "iOS currently hears nothing at all" for these
notices. That was **false** — the hook had been announcing them all along, and the hook's own
comment at `:162-167` even cites
`docs/solutions/logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md`,
composing a single utterance precisely to avoid a same-commit collision.

**No user-perceivable defect today**, which is why 2c shipped without fixing it:

- React flushes **child** effects before **parent** effects. `NoticeStack` and `InlineError` are
  children of the screen that calls the hook, so the hook's `post(.announcement)` is the later call
  and silences theirs. iOS therefore hears exactly one utterance.
- For the error, both callers announce the identical string, so the outcome is byte-identical.
- On **Android** the hook's effects are gated out (`if (Platform.OS !== "ios") return`), so
  `NoticeStack` is already the only announcer there and nothing overlaps.

Two reasons it should still be fixed:

1. `docs/rules/accessibility.md` explicitly prohibits the duplicate-error-announce case.
2. The redundancy makes `NoticeStack`'s iOS announcement dead code that can never be heard, so any
   future change to its wording or timing is silently inert on iOS. The next maintainer reading
   either file gets a misleading picture.

The fix was originally out of scope for 2c: Global Constraint 20 put `useNutritionLookup.ts` on
the do-not-touch list for the entire slice. **That constraint was overridden for the notices half
on 2026-08-05** — see the update below.

## Acceptance Criteria

- [x] ~~The notices effect (`useNutritionLookup.ts:169-177`) is deleted.~~ **Done in #753**,
      commit `be48907b` (test) + the deletion it covers. Replaced by a docblock explaining why
      `NoticeStack` is now the sole announcer on both platforms.
- [ ] The error effect (**now `useNutritionLookup.ts:192-197`** on `feat/nutrition-detail-2c`;
      the old `:179-183` reference predates the notices deletion) is deleted.
- [ ] `Platform` and `AccessibilityInfo` imports are removed from the hook **if** nothing else in
      the file uses them; if something does, leave them and say what. (Still blocked by the error
      effect — it is the last consumer of both imports, so this closes with it.)
- [x] ~~`NoticeStack.tsx`'s docblock and `client/components/nutrition/NoticeStack-utils.ts`
      describe the announcer accurately afterwards.~~ **Done in #753** — verified 2026-08-06:
      the docblock now states it is "the ONLY announcer for these notices on either" platform and
      explains the deleted duplicate's false premise. No stale "iOS hears nothing" claim survives
      anywhere in `client/` or `docs/`.
- [x] ~~A test proves the notices are announced exactly once on iOS after the deletion, asserting
      **call count**.~~ **Done in #753** — `be48907b` proves the hook is silent on both of the
      deleted effect's triggers; `ab51e8e3` asserts the error-state suppression stops the
      ANNOUNCEMENT rather than only the render.
- [ ] A test proves the error is announced exactly once on iOS.
- [ ] Device pass for the error only: iOS VoiceOver hears it once. Android TalkBack is unchanged
      (it never heard the hook's version — the effect is `Platform.OS === "ios"`-gated). The
      notices half of this criterion moved onto **#753's own device checklist**.

## Implementation Notes

**Sole call site — verified 2026-08-04.** `useNutritionLookup` is called in exactly one place:
`client/screens/NutritionDetailScreen.tsx:245`. `grep -rn 'useNutritionLookup(' client/` returns
that line and nothing else. `ItemDetailScreen.tsx` merely _mentions_ the hook in a comment at
`:144` and uses its own query's `error`. This is what makes the deletion safe: there is no second
consumer that would lose its announcements.

**What replaces each effect, already shipped in 2c:**

| Deleted from the hook                                                | Replacement                                                                  | Platform coverage                                          | State              |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------ |
| `:169-177` notices (composed `labelReadNotice` + `correctionNotice`) | `NoticeStack`'s content-keyed imperative announcer, `NoticeStack.tsx`        | Both — it is **not** platform-gated                        | **DONE — in #753** |
| `:192-197` error (was `:179-183`)                                    | `InlineError`'s internal announce, `client/components/InlineError.tsx:24-28` | iOS only (gated), which matches the pre-existing behaviour | Open — this todo   |

**Watch the composition difference — SETTLED 2026-08-06, this applied to the notices half and it
is done.** Kept because the reasoning still guards the error deletion's shape. The hook composed
_one_ utterance from both notices —
`"<labelReadNotice>. Serving size adjusted: <correctionNotice>"` — deliberately, because two calls
in one commit collide. `NoticeStack`'s announcer is keyed on its own composed content string.
Before deleting, confirm `NoticeStack` still produces a single utterance covering both notices when
both are present. If it emits two, the deletion trades one collision for another and the composition
must move rather than vanish.

**Coverage — was none, now partial.** As filed on 2026-08-04 the hook's announcers were untested.
#753 added `client/hooks/__tests__/useNutritionLookup.labelRead.test.tsx`, which covers the
NOTICES announcer's absence. The ERROR announcer is still untested, so its test remains net-new.

## Scope Contract

- **Mechanisms to use:** plain deletion of two `useEffect` blocks plus their now-unused imports. No
  new abstraction, no announcer facade, no platform-gating helper.
- **Files in scope:** `client/hooks/useNutritionLookup.ts`, its test file under
  `client/hooks/__tests__/`, `client/components/nutrition/NoticeStack.tsx` (docblock only), and
  `client/screens/__tests__/NutritionDetailScreen.test.tsx` if the announcement assertions live
  there.
- No new mechanisms, files, or abstractions beyond those listed. Do **not** touch
  `client/components/InlineError.tsx` — its announce is the surviving one and is correct.

## Dependencies

- **Slice 2c must be merged first — RE-VERIFIED 2026-08-06, and the reason is stronger than it
  reads.** `git grep -n InlineError origin/main -- client/` shows nine call sites and
  `NutritionDetailScreen.tsx` is **not** among them: slice 2c is what puts `InlineError` on this
  screen at all. So on `main` today the hook's effect is the _sole_ announcer for the nutrition
  lookup error, and deleting it before #753 lands leaves iOS genuinely silent — not merely
  duplicated. Branch: `feat/nutrition-detail-2c`.

## Risks

- **Deleting the composition, not just the duplication.** The single biggest risk is that the hook's
  two-notices-into-one-utterance composition has no equivalent in `NoticeStack`. Verify before
  deleting; the codified reason it exists is
  `docs/solutions/logic-errors/two-announceforaccessibility-same-commit-collide-ios-2026-07-21.md`.
- **jsdom cannot verify the outcome.** It cannot observe screen-reader behaviour, only that the mock
  was called. The device pass is the real gate, which is why auto-merge must stay disarmed.
- **The effect ordering that makes today's behaviour benign is implicit.** It depends on React
  flushing child effects before parent effects. Do not preserve either effect on the theory that
  ordering makes it harmless — that reasoning is what justifies _deferring_, not _keeping_.

## Updates

### 2026-08-04

- Initial creation. Found during slice 2c Task 8 review; deferred there because Global Constraint 20
  put `useNutritionLookup.ts` out of scope for the whole slice.
- Verified `NutritionDetailScreen.tsx:245` is the sole call site, and that the hook's announcers
  currently have no test coverage.

### 2026-08-06 — the notices half landed inside #753; this todo is now error-only

**Global Constraint 20 was overridden on 2026-08-05, mid-slice.** A review of the 2c delta found
the hook's notices announcer was not a benign duplicate after all: the two announces are **never
in the same commit**, so nothing was silencing anything and VoiceOver users heard the
label-not-used warning **twice** — the first time over a skeleton screen the notice did not yet
describe. A correctness finding outranked a scope rule, so the deletion moved into #753
(`be48907b`, `3c0e83e2`, `ab51e8e3`) rather than waiting here.

That leaves this todo **error-only**, and it changes one thing worth stating plainly:

**#753 INTRODUCES the duplicate error announce; it is not pre-existing.** On `main` the error has
exactly one announcer (this hook). #753 adds `InlineError` to the screen, giving it two. The
outcome is benign — both post the identical string, `setError` and `setIsLoading(false)` land in
one commit, and iOS `post(.announcement)` does not queue, so the later call (`InlineError`, further
down the JSX) wins and one utterance is heard. `NutritionDetailScreen.tsx:397-404` documents this
collision deliberately. But it _is_ a new instance of the pattern `docs/rules/accessibility.md`
prohibits, and this todo is what removes it. Sequence: #753 merges → this becomes unblocked and
safe → delete.

Priority stays `high` for the merge-gate reason in the note at the top, not for severity.
