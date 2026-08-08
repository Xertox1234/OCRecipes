---
title: A prop that silently does nothing should be removed from the public type, not made to work
track: knowledge
category: design-patterns
module: client
tags: [typescript, api-design, accessibility, dead-code, refactoring, react-native]
applies_to: [client/components/**/*.tsx, client/**/*.tsx]
created: '2026-08-04'
last_updated: '2026-08-04'
source: 'PR #751 (original); extended same day from slice 2c (PR #753) — the removal-is-blocked exception and its converse'
---

# A prop that silently does nothing should be removed from the public type, not made to work

## Rule

When a component accepts a prop that has **no effect** — it is read, passed down, and
silently dropped — the instinct is to fix the wiring so the prop finally works. Stop and
ask the intent question first, because the two fixes have opposite blast radii:

- **Making it work** is a behaviour change at every existing call site at once, none of
  which has ever been exercised. You ship an untested code path and inherit whatever the
  callers *meant* by passing a value that never did anything.
- **Removing it from the public type** is a compile error at every call site, which is a
  worklist rather than a risk. `tsc` enumerates the callers for you — exhaustively, which
  grep is not.

Default to removal. Reach for "make it work" only when you have established that the
callers' intent is genuinely served by the prop functioning.

Removal must be from the **type**, not just the implementation. Deleting the destructured
variable while leaving the prop declared, or leaving it reachable through a
`{...rest}` spread, re-creates the same silent no-op with no signal.

## Smell patterns

- A prop documented as doing something (`/** Accessibility label for both image and fallback. */`)
  where the value never reaches a functioning sink.
- A prop that "works" on one branch of the component and not another.
- Any `Omit<SomeLibProps, ...>` that omits one alias of a prop but not its synonyms —
  React Native resolves `props['aria-label'] ?? props.accessibilityLabel`, so omitting only
  the latter leaves the former as an equally inert second door.

## Why

Shipped case, PR #751. `client/components/FallbackImage.tsx` accepted `accessibilityLabel`
and documented it as labelling "both image and fallback". React Native gates image
accessibility on `accessible={props.alt !== undefined ? true : props.accessible}`, so a bare
label on `<Image>` never makes it an accessibility element — device-confirmed, the node
carried `content-desc` with `focusable=false`.

The tempting fix was to honour the label (`alt={accessibilityLabel}`). It was wrong twice:

1. **Every call site would have started announcing.** All of them labelled an image whose
   name was already in adjacent visible text, so "fixing" the prop would have introduced
   four new double-announcements — a regression presented as an accessibility improvement.
2. **The `alt` branch would have been dead on arrival.** The same change removed the label
   from every caller, so the newly-working code path would have shipped with zero consumers
   and zero coverage.

Removing `accessibilityLabel`, `alt` and `aria-label` from the public type instead turned
each misuse into a compile error — **and immediately surfaced a fourth call site that the
grep-based search had missed** (`client/components/home/DailySummaryHeader.tsx`). The type
system enumerated the blast radius that manual search had under-reported.

## Examples

```ts
// Before — the prop is declared, destructured, and lands somewhere inert.
interface FallbackImageProps extends Omit<ImageProps, "source"> {
  /** Accessibility label for both image and fallback. */
  accessibilityLabel?: string;
}

// After — the compiler is the enforcement. Note all THREE aliases must go:
// leaving `aria-label` reachable would let the same inert value back in
// through `{...imageProps}`.
interface FallbackImageProps
  extends Omit<ImageProps, "source" | "accessibilityLabel" | "alt" | "aria-label"> {}
```

Pair the removal with a docblock stating the intent, so the next reader learns *why* the
prop is absent rather than assuming an oversight and adding it back.

## Exceptions

### When removal is BLOCKED, wire it — inertness is then the failure mode, not the fix (added 2026-08-04)

The rule above assumes removal is available. It is not when an **external contract requires the prop
to exist** — a project convention that mandates it, or a call site the same plan specifies. Reach for
"make it work" then, because the doc's own remedy is off the table and an inert implementation
becomes precisely the outcome the rule exists to prevent.

Shipped case, slice 2c (PR #753). `NoticeStack` accepted `reducedMotion` and never read it —
destructured as `_reducedMotion` to silence the unused-variable rule. The implementer cited *this
document* as grounds for removing it. Two things blocked removal: a project constraint stating every
new component takes `reducedMotion` as a prop, and the plan's own downstream call site
(`<NoticeStack … reducedMotion={reducedMotion} />`). The fix was the other direction — wrap the rows
in an `Animated.View` and gate `entering` on the prop, matching all five siblings in the directory.

The test to apply, in order:

1. Does anything **force** the prop to exist — a convention, a caller you do not control, a public API?
   If not, remove it from the type. That is the base rule and it is still the default.
2. If yes, does the component have a **real job** for it? Wire it.
3. If yes and there is genuinely nothing to do, the *contract* is wrong. Fix the contract, or record
   why the prop is inert in a docblock so the next reader does not "fix" it twice.

### The converse: do not accept a prop merely because the convention names it (added 2026-08-04)

The same slice settled the mirror case correctly. `LogActionBar` takes **no** `reducedMotion` at all:
it is a sticky action bar that deliberately does not animate ("the log action must stay immediately
actionable"), and the plan's per-component interface line omitted the prop. Accepting it there would
have created the inert prop this document forbids.

So a blanket convention like "every component takes `reducedMotion`" reads as *a catch-all against
forgetting to wire an animation that exists* — not a mandate to carry a dead prop on a component with
nothing to animate. Check the per-component contract before the blanket one.

**Verify a convention's citations, too.** The constraint above named three components as precedent;
two of them (`ScanFlagBadge`, `VerificationBadge`) contain zero occurrences of `reducedMotion`. The
rule was still right; its evidence was invented. A cited precedent is as checkable as a claim.

### Other exceptions

- **A prop that is inert only on one branch** may be a genuine wiring bug — fix the wiring.
  The rule applies when the prop is inert by design of the underlying platform, or when the
  callers never wanted its effect.
- **Public API of a shipped library** cannot take a breaking type change casually. This
  applies cleanly to first-party components inside one repo, where every call site is
  visible to the same `tsc` run.
- If removal would strand a caller with a real need, that caller gets an explicit mechanism
  (here: an `accessible` group wrapper at the call site) rather than the inert prop back.

## Related Files

- `client/components/FallbackImage.tsx` — the component; its docblock carries the rationale.
- `client/components/nutrition/CapturedPhotos.tsx` — the group-wrapper shape a caller uses
  when it genuinely needs a name.

## See Also

- [Visually-hidden-but-mounted surfaces must be hidden from the a11y tree](../conventions/a11y-hide-visually-hidden-surfaces-2026-06-10.md) — the accessibility rule this case sits inside
- [adb + uiautomator on-device Android verification](../best-practices/adb-uiautomator-ondevice-android-verification-2026-07-12.md) — how the inert prop was proven inert on a real device tree
- [Pure-utils extraction tests don't prove wiring](../conventions/pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md) — the sibling failure mode: a seam where a value can be declared and never forwarded
- [A guard outlives the state layout it was written for](../logic-errors/a-guard-outlives-the-state-layout-it-was-written-for-2026-08-04.md) — the prop that had to be removed from the type *because* the hazard it guarded had become unreachable
