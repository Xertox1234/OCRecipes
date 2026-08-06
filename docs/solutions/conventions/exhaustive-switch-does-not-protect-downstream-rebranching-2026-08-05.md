---
title: 'An exhaustive switch protects the switch, not a downstream consumer that re-branches on the same discriminant'
track: knowledge
category: conventions
module: client
tags: [typescript, discriminated-unions, exhaustiveness, state-machine, routing, camera]
applies_to: [client/**/*.ts, server/**/*.ts, shared/**/*.ts]
created: '2026-08-05'
---

# An exhaustive switch protects the switch, not a downstream consumer that re-branches on the same discriminant

## Rule

When a discriminated-union value passes through an exhaustive `switch` (no
`default`) to produce a derived value, and a **downstream consumer** needs to
take a different code path for two or more variants that the switch happens to
map to the **same** derived value, that downstream path selection must be a
field on the switch's own return type — not a second, independent check on
the union's original discriminant (`value.type === "X"`) performed at the
consumer. The exhaustiveness guarantee at the switch does not propagate to a
downstream `if` that inspects the same discriminant again; a new union member
can compile cleanly at the switch (by joining an existing group) while
silently falling through the unrelated downstream check to the wrong branch.

## Smell patterns

- A helper function returns a plain object/tuple derived from an exhaustive
  switch (e.g. `{ capture: boolean, runStepOcr: boolean }`), and its only
  caller then re-inspects the *original* discriminant with a hand-written
  equality check (`if (phase.type === "HUNTING")`) to decide something the
  switch already decided implicitly — which of two differently-behaving
  branches to run.
- Two or more variants map to an identical returned tuple, and the caller's
  re-check singles out only *one* of them by name. A new variant added to
  that same group at the switch (a correct, compiling edit) inherits the
  group's tuple but not the caller's by-name branch, and falls through to the
  *other* caller branch.
- The tell in review: "this switch is exhaustive, so it's safe" is asserted
  about the *producer*, while the actual routing decision that matters lives
  in the *consumer*'s separate, non-exhaustive `if`.

## Why

Exhaustiveness enforcement is a property of one switch statement — TypeScript
verifies every arm of *that* switch is covered, not that every downstream
reader of its return value keeps making a consistent decision.
`getCapturePlan` (`client/screens/scan-screen-utils.ts`) was a real instance:
`HUNTING` and `STEP2_CONFIRMED` legitimately return the identical
`{ capture: true, runStepOcr: false }` tuple (front-label capture shares
HUNTING's "no step-OCR" behavior), so the only thing that told them apart was
`ScanScreen.onShutterPress`'s own `if (phase.type === "HUNTING")` check — a
hand-maintained branch of exactly the kind `getCapturePlan` was built to
retire (its own doc comment records that it replaced three previously
diverging hand-maintained phase lists). A future phase reusing
`{ capture: true, runStepOcr: false }` would compile clean at `getCapturePlan`,
satisfy any invariant test written against `getCapturePlan`'s output, and
still fall through the caller's `if` to the wrong branch — silently, with no
`tsc` error anywhere.

## Examples

Fix: make the consumer-facing decision itself a required field on the
returned value (see `machine-routed-values-need-enum-not-prose`'s wider
version of this same rule) — not re-derived at the call site:

```typescript
export type CapturePlan = {
  capture: boolean;
  runStepOcr: boolean;
  // Which of the CALLER's branches to take — explicit, not re-derived from
  // phase.type at the call site.
  route: "smart" | "step";
};

export function getCapturePlan(phase: ScanPhase): CapturePlan {
  switch (phase.type) {
    case "HUNTING":
      return { capture: true, runStepOcr: false, route: "smart" };
    case "STEP2_CONFIRMED":
      return { capture: true, runStepOcr: false, route: "step" };
    // ...every other case, route set explicitly
  }
}

// Caller now branches on the field the producer already committed to,
// not a second, independent check of the original discriminant:
if (capturePlan.route === "smart") {
  /* ... */
}
```

Because `route` is a **required** field (not optional with an implicit
default), every case in the exhaustive switch must set it explicitly — a new
phase added to any group must pick a route, and skipping that pick is a
compile error, not a silent default.

## Exceptions

- If the downstream re-check only ever narrows the same variant the switch
  already special-cased alone (no sharing between multiple variants), there
  is no divergence risk — nothing to fix.
- Don't add a `route`-style field speculatively to every derived-value type
  "just in case." Only add one when a real, hand-maintained downstream check
  on the original discriminant already exists and disambiguates a value the
  exhaustive switch produced. Adding one preemptively is scope creep a
  todo's Scope Contract convention would flag.

## Related Files

- `client/screens/scan-screen-utils.ts` — `CapturePlan.route`, `getCapturePlan`
- `client/screens/ScanScreen.tsx` — `onShutterPress`'s
  `capturePlan.route === "smart"` check (formerly `phase.type === "HUNTING"`)
- `client/camera/components/ProductChip-utils.ts` — the sibling fix landed in
  the same commit (exhaustive `getProductChipVariant`; no downstream
  re-branching involved there — a contrast case, not an instance of this bug)

## See Also

- [machine-routed-values-need-enum-not-prose-2026-07-02.md](machine-routed-values-need-enum-not-prose-2026-07-02.md) — the general form of this rule outside TypeScript discriminated unions (agent-instruction routing)
- [discriminated-union-case-collapse-audit-absorbed-semantics-2026-07-14.md](discriminated-union-case-collapse-audit-absorbed-semantics-2026-07-14.md) — a related but distinct failure: auditing a surviving case's *body* after a union collapse, versus this rule's concern with a downstream consumer re-branching on the union's discriminant
