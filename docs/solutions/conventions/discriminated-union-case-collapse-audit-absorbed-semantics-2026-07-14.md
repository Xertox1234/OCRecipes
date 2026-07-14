---
title: Collapsing a discriminated union case requires auditing every exhaustive switch for absorbed semantics, not just compile-fixing it
track: knowledge
category: conventions
module: client
tags: [typescript, discriminated-unions, state-machine, refactoring, reducers]
applies_to: [client/**/*.ts, client/**/*.tsx]
created: '2026-07-14'
---

# Collapsing a discriminated union case requires auditing every exhaustive switch for absorbed semantics, not just compile-fixing it

## Rule

When a discriminated union variant is removed and its meaning is absorbed
into a surviving sibling variant (e.g. `STEP2_CAPTURING` deleted, its
"armed and capturing" meaning folded into `BARCODE_LOCKED`), every
exhaustive `switch (x.type)` over that union must be re-read for whether
the surviving variant's case body still reflects its **old** meaning or
needs updating to reflect the **new, absorbed** meaning. TypeScript's
exhaustiveness check only guarantees every switch still compiles — it says
nothing about whether the surviving case's *body* is still correct for the
variant's new, broader meaning.

## Smell patterns

- A refactor PR/commit touches a discriminated union type file and, as a
  "forced" consequence, edits several `switch`/`case` blocks across the
  codebase just to make them compile (deleting removed case labels) —
  those are exactly the sites this rule applies to, and a fix that only
  deletes the dead case labels without re-reading the surviving cases'
  bodies is incomplete.
- A test's title/description describes the *new* semantics
  ("armed for nutrition capture") while its assertions still check the
  *old* semantics — a name/assertion mismatch is a strong signal the
  case body wasn't actually updated, only the case label mapping was.
- Two sibling utility files that both branch on the same union (e.g. one
  computing UI copy, one computing a visual indicator, one computing
  layout target) disagree about a variant's meaning after the same
  refactor — if one was updated correctly and another wasn't, that's this
  bug.

## Why

A union-collapsing refactor is mechanically easy to get "half right":
delete the case label from the type definition, then follow every
resulting compile error to a `switch` and patch just enough to make it
compile again (often by literally renaming the old case label to the
absorbing variant's label, leaving the body untouched). That produces
correct-looking code that type-checks and even passes tests written before
the refactor — but the *body* under the renamed case label is still
computing the old, narrower variant's behavior, not the new, broader one.

This bit twice in the same refactor, in two independent files: a step
indicator's dot-state helper kept the absorbed variant showing as "not yet
started" instead of "in progress," and a camera reticle-target helper kept
the absorbed variant locked to a stale, one-time-snapshotted position
instead of switching to the shared "framing" target every other
label-capture phase used. Both were caught only because a second party
(a human controller re-reading the diff, then an independent task
reviewer) traced each surviving case's logic against the union's new
intended semantics rather than trusting that "it compiles and the
renamed test passes" was sufficient.

## Examples

Before trusting a union-collapse diff as complete, for every
`switch (x.type)` touched by the deleted case labels:

1. Write down, in one sentence, what the absorbing variant means **now**
   (post-refactor) — not what the deleted variant used to mean.
2. Read the surviving case's body and ask: does this body compute
   behavior consistent with that new sentence, or does it still compute
   behavior consistent with the absorbing variant's **old**, narrower
   meaning?
3. Cross-check every other file that switches on the same union — do they
   all agree on the absorbing variant's treatment? (A UI copy helper, a
   visual-indicator helper, and a layout-target helper for the same phase
   should tell a consistent story.)

```typescript
// Before collapse: BARCODE_LOCKED meant "just locked, waiting for a
// separate arm-next-photo tap." STEP2_CAPTURING meant "armed, shutter
// live, waiting to shoot the nutrition photo."
case "BARCODE_LOCKED":
  return stepIndex === 0 ? "active" : "idle"; // step 1 not started yet

// After collapse: BARCODE_LOCKED now means what STEP2_CAPTURING used to
// mean. The case label was renamed, but this body still describes the
// OLD BARCODE_LOCKED meaning — a real bug, not just a rename.
case "BARCODE_LOCKED": // (used to be STEP2_CAPTURING)
case "STEP2_REVIEWING":
  if (stepIndex === 0) return "done";   // <- must merge into the
  if (stepIndex === 1) return "active"; //    surviving case's body,
  return "idle";                        //    not just its label
```

## Exceptions

If the absorbing variant's meaning is genuinely unchanged by the
refactor — only the *union's shape* changed (e.g. a field was added to
every variant, or a variant was renamed with no semantic shift) — no
case-body audit is needed. This rule applies specifically when one
variant's *meaning* migrates onto another, not to purely mechanical
renames or shape changes.

## Related Files

- `client/camera/components/StepPill-utils.ts` — `getStepDotState`'s
  `BARCODE_LOCKED` case, the first instance of this bug
- `client/camera/components/ScanReticle-utils.ts` — `getReticleTarget`'s
  `BARCODE_LOCKED` case, the second, independently-caught instance
- `client/camera/types/scan-phase.ts` — the `ScanPhase` union this refactor
  collapsed

## See Also

- [dead-ui-branch-from-duplicated-context-types-2026-05-16.md](../logic-errors/dead-ui-branch-from-duplicated-context-types-2026-05-16.md) — a related class of bug where a duplicated (not collapsed) type definition silently diverges from its source of truth
