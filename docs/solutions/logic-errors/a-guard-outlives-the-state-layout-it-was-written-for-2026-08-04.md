---
title: A guard outlives the state layout it was written for and becomes pure cost
track: bug
category: logic-errors
tags: [react, state-ownership, accessibility, staged-work, refactoring, client, dead-guard]
module: client
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
symptoms: ["A defensive flag is always true (or always false) in practice and no test covers the other value", "A guard suppresses something on exactly the screen where that something matters most", "The collision or race a guard prevents cannot be reproduced and nobody can say when it last could be", "A prop coordinates two components that no longer re-render together", "Every test of the guard asserts the suppressed direction and the unsuppressed case has none"]
created: '2026-08-04'
severity: medium
---

# A guard outlives the state layout it was written for and becomes pure cost

## Problem

A guard is written when state lives in place N. A later task moves that state to place N+1. The
move is correct and reviewed; the guard is untouched, so it survives — but the hazard it defended
against is now unreachable, and the guard's *cost* is not. It keeps paying while buying nothing.

This is specific to **staged work**, where a plan is written against one architecture and executed
across tasks that change that architecture as they go. The plan's guard is correct at authoring
time and stale by the time it lands.

## Symptoms

- A defensive flag is always true (or always false) in practice, and no test covers the other value.
- A guard suppresses something on exactly the screen where that something matters most.
- The collision or race a guard prevents cannot be reproduced, and nobody can say when it last could be.
- A prop exists to coordinate two components that no longer re-render together.
- Every test of the guard asserts the suppressed direction; the unsuppressed case has no test.

## Root Cause

Shipped and caught in review during slice 2c of the Nutrition Detail redesign.

The screen passed `suppressAnnounce={logGate.kind === "needsAcknowledgement"}` to `NoticeStack`,
so that the notice announcer and the "acknowledge before logging" announcement could not collide —
iOS `UIAccessibility.post(.announcement)` does not queue, so two posts in one commit drop one.
Sound reasoning **when the plan was written**.

Two tasks later, `LogActionBar` took ownership of the acknowledgement state. From that point the
acknowledge click re-renders only `LogActionBar`; `NoticeStack`'s effect never re-runs, and even if
it did, its content key is unchanged so it early-returns. **The two announcements can no longer
share a commit.** Separately, the acknowledge announce fires from a click handler — temporally
later — and the later post silences the earlier, so "acknowledge wins" already held by ordering.

The guard bought nothing. What it cost was specific and bad:

- `deriveLogGate` gates iff `ocrText !== undefined && !labelUsed` — a session that photographed a
  label the pipeline could not use. The same failure sets `labelReadNotice`. **So the gated screen
  is precisely the screen carrying "Label not used"**, and the guard silenced the announcer there,
  from mount, for the screen's whole lifetime.
- The same change had deleted two `accessibilityLiveRegion="polite"` regions. That attribute is
  Android-only, so `NoticeStack`'s imperative announcer had just become Android's *only* signal.
  Suppressed, Android heard nothing at all — for any notice, including one that mutates on every
  serving adjustment.
- It did not even achieve its stated intent on iOS, where a hook effect announced the notices
  regardless of the prop.

No test caught it: every announcer assertion was a negative or a count-of-one **on the gated
fixture**, so a permanently-true flag passed the entire suite.

## Solution

Delete the guard, and delete it from the **public type**, not just the call site — an accepted-but-
unused prop re-creates the same silent no-op with no signal.

```tsx
// Before — a flag that cannot change within a screen lifetime, guarding an unreachable collision.
<NoticeStack … suppressAnnounce={logGate.kind === "needsAcknowledgement"} />

// After — the ordering that always made "acknowledge wins" true is the only mechanism needed.
<NoticeStack … />
```

**Keep the parts that still earn their place.** The same effect held a content-keyed
`lastAnnouncedRef` that announces once per distinct content and does not re-announce unchanged
content. That is a separate, still-live requirement. Only the suppression branch goes — and its
removal also dissolves a latent hazard, because the ref updated *before* the suppression check and
so could not distinguish "already spoken" from "seen but never spoken". That ordering was harmless
only while the flag never flipped.

## Prevention

- **When state ownership moves, re-check every guard written for the old layout.** A task that
  relocates state should name, in its report, which coordination mechanisms its move makes
  unnecessary. Reviewers cannot see this from a diff that only shows the move.
- **A boolean prop that cannot change within a component's lifetime is a smell.** If the flag is
  derived from something fixed for the screen's duration, it is a configuration switch, not a
  guard — and configuration switches should be justified, not inherited.
- **Test the unsuppressed direction.** The positive case — *does the thing actually happen when
  nothing suppresses it?* — is the assertion that catches a stuck flag. Every negative assertion in
  the world passes when a guard is permanently on.
- **Ask what the guard costs on the screen where it fires most.** Here it fired on exactly the
  screen its suppressed content was written for, which is not a coincidence: guards keyed on an
  error state tend to correlate with the notices that describe that error state.
- Before preserving a guard "just in case", state the reachable path that still needs it. If nobody
  can write that path down, it is dead.

## Related Files

- `client/components/nutrition/NoticeStack.tsx` — the announcer; its docblock now records why the
  prop is absent rather than leaving a future reader to re-add it.
- `client/components/nutrition/LogActionBar.tsx` — owns the acknowledgement state whose relocation
  made the guard unreachable.
- `client/screens/nutrition-detail-utils.ts` — `deriveLogGate`, the condition that made the gated
  screen and the silenced notice the same screen.

## See Also

- [Two objects that are usually field-parallel diverge on the fallback path](field-parallel-objects-diverge-on-the-fallback-path-2026-08-04.md) — the sibling shape from the same slice: an assumption about two sources that only fails off the happy path
- [Remove an inert prop from the public type](../design-patterns/remove-an-inert-prop-from-the-public-type-2026-08-04.md) — why deleting from the type, not just the implementation, is the whole fix
- [Deleting a truthiness guard drops unanalyzed falsy cases](truthiness-guard-deletion-drops-unanalyzed-falsy-cases-2026-07-30.md) — the converse caution: removing a guard also removes its decisions
