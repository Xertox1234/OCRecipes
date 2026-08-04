---
title: A prop that silently does nothing should be removed from the public type, not made to work
track: knowledge
category: design-patterns
module: client
tags: [typescript, api-design, accessibility, dead-code, refactoring, react-native]
applies_to: [client/components/**/*.tsx, client/**/*.tsx]
created: '2026-08-04'
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
