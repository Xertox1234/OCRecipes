---
title: "Delete useNutritionLookup's duplicate iOS announcers — NoticeStack and InlineError own them after slice 2c"
status: backlog
priority: high
created: 2026-08-04
updated: 2026-08-04
assignee:
labels: [deferred, accessibility, hooks]
github_issue:
human_led: true
blocked_reason: "iOS VoiceOver / Android TalkBack device pass required; jsdom can only observe that the announce mock was called, never what a screen reader actually says. An autonomous executor cannot produce the evidence the acceptance criteria demand."
---

# Delete useNutritionLookup's duplicate iOS announcers

> **Priority note:** `high` reflects the **merge gate**, not the blast radius. The severity is
> Medium. Screen-reader announcement behaviour is device-verifiable only, so this todo must never
> arm auto-merge (`scripts/todo-automerge-guard.sh` keys on priority). Same reasoning as the slice
> 2c todo.

## Summary

`client/hooks/useNutritionLookup.ts` fires two iOS `AccessibilityInfo.announceForAccessibility`
effects — one for the notices, one for the error. Slice 2c gave both surfaces their own announcers
(`NoticeStack` and `InlineError`), so the hook's are now duplicates. Delete them.

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

The fix was out of scope for 2c: Global Constraint 20 put `useNutritionLookup.ts` on the
do-not-touch list for the entire slice.

## Acceptance Criteria

- [ ] The notices effect (`useNutritionLookup.ts:169-177`) is deleted.
- [ ] The error effect (`useNutritionLookup.ts:179-183`) is deleted.
- [ ] `Platform` and `AccessibilityInfo` imports are removed from the hook **if** nothing else in
      the file uses them; if something does, leave them and say what.
- [ ] `NoticeStack.tsx`'s docblock and `client/components/nutrition/NoticeStack-utils.ts` describe
      the announcer accurately afterwards — no surviving claim that another layer announces these.
- [ ] A test proves the notices are announced exactly once on iOS after the deletion, asserting
      **call count** (`toHaveBeenCalledTimes(1)`), not just the announced string. iOS
      `UIAccessibility.post(.announcement)` does not queue, so a string-only assertion passes in
      exactly the broken case where two fired and one was dropped.
- [ ] A test proves the error is announced exactly once on iOS.
- [ ] Device pass on **both** platforms: iOS VoiceOver hears each notice once and the error once;
      Android TalkBack is unchanged (it never heard the hook's version).

## Implementation Notes

**Sole call site — verified 2026-08-04.** `useNutritionLookup` is called in exactly one place:
`client/screens/NutritionDetailScreen.tsx:245`. `grep -rn 'useNutritionLookup(' client/` returns
that line and nothing else. `ItemDetailScreen.tsx` merely _mentions_ the hook in a comment at
`:144` and uses its own query's `error`. This is what makes the deletion safe: there is no second
consumer that would lose its announcements.

**What replaces each effect, already shipped in 2c:**

| Deleted from the hook                                                | Replacement                                                                  | Platform coverage                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `:169-177` notices (composed `labelReadNotice` + `correctionNotice`) | `NoticeStack`'s content-keyed imperative announcer, `NoticeStack.tsx`        | Both — it is **not** platform-gated                        |
| `:179-183` error                                                     | `InlineError`'s internal announce, `client/components/InlineError.tsx:24-28` | iOS only (gated), which matches the pre-existing behaviour |

**Watch the composition difference.** The hook composed _one_ utterance from both notices —
`"<labelReadNotice>. Serving size adjusted: <correctionNotice>"` — deliberately, because two calls
in one commit collide. `NoticeStack`'s announcer is keyed on its own composed content string.
Before deleting, confirm `NoticeStack` still produces a single utterance covering both notices when
both are present. If it emits two, the deletion trades one collision for another and the composition
must move rather than vanish.

**No existing coverage.** `grep -rn 'announceForAccessibility' client/hooks/__tests__/` returns
nothing, so the hook's announcers are untested today. The new tests above are net-new coverage, not
a port.

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

- **Slice 2c must be merged first.** This todo is only correct once `NoticeStack` and `InlineError`
  are the screen's announcers; on `main` before that merge, deleting the hook's effects would leave
  iOS silent. Branch: `feat/nutrition-detail-2c`.

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
