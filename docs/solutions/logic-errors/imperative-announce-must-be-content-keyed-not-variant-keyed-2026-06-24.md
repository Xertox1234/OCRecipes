---
title: Replacing a shared-container live region with discriminator-keyed announces silently drops same-discriminator content updates
track: bug
category: logic-errors
module: client
severity: medium
tags: [accessibility, talkback, react-native, announce-for-accessibility, accessibility-live-region]
symptoms: [An accessibility cue that TalkBack used to speak on Android stops being spoken after a refactor that removed an accessibilityLiveRegion, A screen-reader announce fires on the container appearing / changing state but NOT when an async-loaded value (name/price/count) fills in afterward, iOS and Android both go silent on an in-place content update that previously only Android announced (via the dropped live region)]
applies_to: [client/**/*.tsx]
created: '2026-06-24'
last_updated: '2026-09-29'
---

# Replacing a shared-container live region with discriminator-keyed announces silently drops same-discriminator content updates

## Problem

A polite `accessibilityLiveRegion` on a shared container is a blunt but
**total** announcer: Android TalkBack re-reads the subtree on _any_ descendant
change. When you remove it (correctly — see Root Cause) and replace it with
imperative `AccessibilityInfo.announceForAccessibility(...)` calls keyed on the
render **discriminator** (a `variant` string, a `type` field, a list key), you
cover every change that flips the discriminator — but you silently drop every
change where the **content mutates while the discriminator stays the same**.
On the path that mutates in place, the screen reader now says nothing where the
live region used to speak.

Concrete case (`ProductChip`): the chip is shown as `BARCODE_LOCKED` with no
product (a "Product" placeholder) and announces a fixed `"Product found…"`
string. An async `PRODUCT_LOADED` then adds the real product name **keeping the
phase type `BARCODE_LOCKED`** (`{ ...state, product }`), so the `variant`-keyed
announce effect never re-fires. The visible row changes placeholder → real name,
but nothing is announced — where the old container live region used to re-read
the subtree and speak the loaded name on Android.

## Symptoms

- A value that loads/updates _after_ a card or chip is already on screen is no
  longer spoken by TalkBack, though the visible text changed.
- The announce effect's dependency array is the discriminator (`[variant]`,
  `[type]`, `[status]`) — not the mutating content.
- The regression is invisible to a variant-stepped manual sweep and to render
  tests that only assert "each variant announces": both step by the
  discriminator, so neither exercises a same-discriminator content change.

## Root Cause

Removing the shared-container `accessibilityLiveRegion="polite"` is itself
correct — a polite region on a container that wraps a structural swap (e.g.
`Text`↔`ActivityIndicator`) or a descendant `accessibilityState` change re-reads
the **entire** subtree on every descendant change (a `CONTENT_CHANGE_TYPE_SUBTREE`
the container composes), i.e. it over-announces. The trap is the **replacement**:
the live region was an implicit announcer for _all_ subtree changes, including
in-place content updates under a stable discriminator. A discriminator-keyed
imperative effect is strictly narrower — it only fires when the discriminator
itself changes. The async / in-place update is the gap.

## Solution

Key the imperative announce on the **content that changed**, not only the
discriminator. Add a second, edge-guarded effect for each value that can mutate
in place:

```tsx
const productName = "product" in phase ? phase.product?.name : undefined;
const prevProductNameRef = useRef<string | undefined>(undefined);

// Variant-keyed effect handles discriminator transitions…
useEffect(() => {
  if (variant !== null) {
    AccessibilityInfo.announceForAccessibility(getChipAnnounceText(variant, phase));
  }
  // …
}, [variant]);

// …content-keyed effect handles the async in-place update the variant effect misses.
useEffect(() => {
  // Edge-guard undefined→value so it fires once on load, not on every render,
  // not on the initial appear (the discriminator effect already spoke), and not
  // on later transitions that merely carry the value forward.
  if (productName && !prevProductNameRef.current) {
    AccessibilityInfo.announceForAccessibility(productName);
  }
  prevProductNameRef.current = productName;
}, [productName]);
```

The content-keyed announce is a single focused string (just the loaded name),
not a whole-subtree re-read, so it doesn't reintroduce the over-announcement that
motivated dropping the live region.

## Prevention

- When you remove an `accessibilityLiveRegion`, enumerate **every** descendant
  change it used to cover, then ask of each: does it flip the render
  discriminator, or mutate content in place? In-place mutations each need their
  own content-keyed announce.
- **Verification-method gap:** a manual harness or render test that steps by
  variant/`type`/key has a structural blind spot here — it never produces a
  same-discriminator content change, so "every variant announces" and
  "`nodeLiveRegion=0`" can both be green while this path is silent. Add an
  explicit same-discriminator-content-update case (e.g. render the placeholder
  phase, then re-render with the value attached) to both the on-device sweep and
  the unit test.

## Second manifestation: a presence flag is a discriminator too (2026-09-29)

The discriminator doesn't have to be a `variant`/`type` string — a plain boolean
presence flag (`hasParsedItems = items.length > 0`) is the same shape of trap.
`QuickLogDrawer.tsx` and `QuickLogScreen.tsx` (todo:
`P3-2026-09-26-quick-log-review-followups`) each added a success-parse announce
edge-guarded on `hasParsedItems`'s false→true transition — correct for the
first parse, but a **second** parse that replaces the item set without the
list passing back through empty (edit the input, parse again while the prior
unlogged result is still shown) keeps the discriminator `true` throughout, so
the announce never re-fires. A `code-reviewer` dispatch caught this with a
constructed probe: mount with 1 parsed item (announce fires once), rerender
with a *different* 2-item set with no intervening empty state, and the mock
is still called exactly once.

**Why this one was left unfixed, unlike the `ProductChip` fix above:** the
content-keyed fix pattern this solution recommends needs a value that is
monotonic *for the case that should re-announce* and stable *for the case
that shouldn't*. `ProductChip`'s `productName` is genuinely monotonic — it
appears once and never reverts — so keying a second effect on it is safe.
Here, the only per-parse signal these components can read is
`session.parsedItems` itself, and the same operation that legitimately
should NOT re-announce — the user removing one item from an already-shown
result via `removeItem` — changes that array exactly the same way a new
parse does: the length (or a content signature) changes while the discriminator
stays `true`. Naively keying a second effect on item count or a stringified
item list would swap this "misses a replace" gap for an "over-announces every
removal" gap, which is worse (removals become frequent). A correct fix needs
a signal the component doesn't have from the outside — e.g. a `parseResultId`
or `lastParsedAt` that `useQuickLogSession` bumps only on a genuine new parse,
never on `removeItem` — and that hook was outside the todo's Scope Contract.

**Prevention addendum:** before reaching for "key a second effect on the
content," confirm the content value is monotonic for the transition you want
and stable for the transitions you don't. When the same host object changes
shape for both a "new result" and a "user edited the existing result," the
fix belongs at the source (a generation counter / result id), not in the
consuming component — flag it as a deferred follow-up rather than
approximating with a content key that trades one silent gap for a noisier one.

## Third manifestation: a "was this already covered elsewhere?" ref must be written on every render it tracks, not only on its trigger (2026-09-29)

The follow-up todo (`P3-2026-09-29-quick-log-reparse-announce-and-keyboard-dismiss`)
implemented the deferred fix from the second manifestation above:
`useQuickLogSession` now exposes `parseGeneration`, bumped only inside the two
successful-parse `onSuccess` handlers, and `QuickLogDrawer.tsx` /
`QuickLogScreen.tsx` key their success announce on it instead of
`hasParsedItems`. That closes the second manifestation's gap — but the first
implementation introduced a related, narrower version of the same class of
bug, in the mechanism added to satisfy this todo's OWN "don't double-announce
a count-changing replace on Android" requirement.

Android relies on its `accessibilityLiveRegion="polite"` note to self-announce
whenever the rendered item-count TEXT changes; the new effect must skip its
own explicit announce in that case, or it double-announces. It decided that by
comparing the new parse's count against "the count I announced last time"
(`announcedCountRef`, written only inside the generation-changed branch,
i.e. only on an actual new parse). But the value that ACTUALLY governs
whether the live region self-announces is "what's currently rendered", and
`removeItem` (or `reset()`, on a component like `QuickLogDrawer` that stays
mounted across a session close/reopen) changes what's rendered — and so the
live region's own text — without bumping `parseGeneration`. A ref written
only on the trigger branch (the generation change) then compares the new
parse against a STALE prior count, producing both directions of the bug:
a same-count replace after a `removeItem` stayed silent (the stale ref
disagreed that the count matched), and a fresh parse whose count happened to
coincide with the stale ref fired an explicit announce the live region had
already independently made (double-announce). `code-reviewer`'s review
caught this with a constructed probe — see `Prevention` below.

**Prevention:** when a ref exists to answer "does this value match what a
SEPARATE, uncontrolled mechanism (a native live region, a browser default, an
OS callback) already reacted to?", write that ref on **every** run of the
effect that reads the tracked value — before any early return — not only
inside the branch that triggers your own action. Gating the write behind the
trigger conflates two different questions ("did MY trigger fire?" vs "what is
the CURRENT value of the thing I'm comparing against?") into one branch, and
the ref silently goes stale the moment the tracked value changes via any path
that isn't your trigger. The fix in this case: read the current value and
snapshot-then-overwrite the ref unconditionally at the top of the effect,
before the generation-gated `if` that decides whether to announce.

## Related Files

- `client/camera/components/ProductChip.tsx` — the `productName`-keyed effect and
  the variant-keyed effect it complements
- `client/camera/components/__tests__/ProductChip.a11y.test.tsx` — the
  async-load test case (`announces an async-loaded product name within
  barcode_lock`)
- `client/camera/reducers/scan-phase-reducer.ts` — `PRODUCT_LOADED` returns
  `{ ...state, product }`, keeping the same phase `type`
- `docs/rules/accessibility.md` — the `accessibilityLiveRegion` exception clause
  (drop shared container live region → announce imperatively, keyed on content)
- `client/components/home/QuickLogDrawer.tsx`,
  `client/screens/QuickLogScreen.tsx` — the second manifestation (now fixed)
  and the third: `parseGeneration` from `useQuickLogSession.ts` keys the
  announce, and `lastRenderedCountRef` (renamed from `announcedCountRef`) is
  written on every effect run, before the generation-gated early return
- `client/hooks/useQuickLogSession.ts` — `parseGeneration`, bumped only in
  the two successful-parse `onSuccess` handlers, never by `removeItem` or
  `reset()`
- `client/components/home/__tests__/QuickLogDrawer.test.tsx` — the
  "interleaved with a removeItem between two parses" and "a fresh session's
  first parse" cases covering the third manifestation
- `client/screens/__tests__/QuickLogScreen.test.tsx` — the same manifestation
  under its own names: "still announces a same-count replace after a
  removeItem changed what's rendered" and "does not double-announce when the
  second parse's count matches the live region's OWN already-changed text"

## See Also

- [a11y hide visually-hidden surfaces](../conventions/a11y-hide-visually-hidden-surfaces-2026-06-10.md) — another case where a mounted-but-changed surface needs explicit a11y handling
- [Verify TalkBack behavior via emulator logcat](../best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md) — how to verify the fix on-device, and the variant-stepped-sweep blind spot that hides this exact gap
