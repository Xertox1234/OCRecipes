<!-- Filename: P3-2026-06-23-smart-scan-chip-live-region-announce-model-rework.md  (P0=critical … P3=low) -->

---

title: "Fix ProductChip TalkBack over-announcement: busy swap re-reads the whole chip (needs a cross-variant announce-model fix, not a one-liner)"
status: done
priority: low
created: 2026-06-23
updated: 2026-06-24
assignee:
labels: [deferred, accessibility, rn-ui-ux]
github_issue:

---

# ProductChip: scope the live cue so the smart-confirm busy swap stops re-reading the whole chip — without muting any variant's announcement

## Summary

CONFIRMED (emulator-observed): on Android/TalkBack the smart-confirm chip's
`Text↔ActivityIndicator` swap (driven by `isSmartConfirming`) makes the chip's
container `accessibilityLiveRegion="polite"` **re-read the entire chip subtree**,
not just signal "busy". The fix is NOT the one-liner the originating todo
imagined: the container live region is the **sole Android announcer for all 7
chip variants**, so any change to it has a cross-variant blast radius and must be
verified per-variant.

## Background

Split out of `todos/archive/P3-2026-06-23-smart-scan-confirm-talkback-live-region-reread.md`,
whose open question ("does the busy swap re-read the whole chip?") is now
**definitively answered: YES**.

How it was observed (so the next implementer can reproduce + verify a fix):

- Android emulator `Medium_Phone_API_36.1` (API 36, `google_apis_playstore`
  image → ships TalkBack 16.0.0). Boot with **hardware GPU**:
  `emulator -avd Medium_Phone_API_36.1 -no-snapshot -gpu host -memory 4096 -cores 4`
  (the default `swiftshader_indirect` software GPU ANRs/wedges under the RN app).
- Raise TalkBack verbosity: TalkBack Settings → Advanced → Developer settings →
  **Log output level → VERBOSE** (drive via adb taps with TalkBack temporarily
  disabled so single-taps work), AND `adb shell setprop log.tag.talkback VERBOSE`
  (the setprop does NOT survive a reboot — re-apply after any reboot, then
  force-stop+restart TalkBack so it re-reads the level).
- Read the composed speech from `adb logcat -s talkback`: the
  `EventTypeWindowContentChangedFeedbackRule` line carries
  `ttsOutput= {…}` + `nodeLiveRegion=N`, and `Pipeline … action=SPEAK text="…"`
  is what TalkBack actually speaks. Empty `ttsOutput= {}` = nothing announced.
- A throwaway harness forced the real chip: override the `<ProductChip>` `phase`
  prop in `client/screens/ScanScreen.tsx` to a fixture
  `SMART_CONFIRMED`/`restaurant_menu` classification, plus a dev `TouchableOpacity`
  that flips `setIsSmartConfirming`. (Initial-reducer-state injection does NOT
  work — `CAMERA_READY` resets it to `HUNTING` on the emulator.)

Captured result (both toggle directions):

```
EventTypeWindowContentChangedFeedbackRule: windowContentChanged, nodeLiveRegion=1,
  ttsOutput= {Product. Restaurant menu detected. High confidence. Confirm smart photo analysis, busy. Button}
Pipeline: … action=SPEAK text="Product. Restaurant menu detected. High confidence. Confirm smart photo analysis, busy. Button"
```

The event source is the **container** (`ROLE_VIEW_GROUP`, `nodeLiveRegion=1`), and
the announced text is the whole chip — driven both by the inner `Text↔Spinner`
structural swap AND the button's `accessibilityState={{ busy, disabled }}` change.

## Why this is NOT a one-liner (the cross-variant blast radius)

`client/camera/components/ProductChip.tsx`:

- Line ~130: the container's `accessibilityLiveRegion="polite"` is the **only**
  live region in the component and the **only** Android announcer.
- Lines ~87-90: the explicit iOS `announceForAccessibility` for the chip's
  appearance fires **only on `prevVariantRef.current === null` (null→non-null) AND
  `Platform.OS === "ios"`**. So:
  - For non-null→non-null transitions (`barcode_lock→session_complete`,
    `step2_review→step2_confirmed`, `step3_review→session_complete`), **iOS gets
    nothing** and **Android announces only via the container live region**.
  - Removing the container live region (the tempting "explicit announces" fix)
    therefore **silences those transitions on Android** — a regression.
- The todo's suggested `accessibilityLiveRegion="none"` on the swapping button
  **does not work**: the container (not the button) is the live region, and it
  re-reads on any subtree/state change, including the button's `busy`/`disabled`
  `accessibilityState` change.

There is no fix that is both (a) scoped to smart_photo only and (b) keeps the
busy state signalled, because the busy `accessibilityState` change lives inside
the shared container region.

## Acceptance Criteria

- [x] The smart-confirm busy swap (`isSmartConfirming` toggle, both directions)
      no longer makes TalkBack re-read the whole chip — verify
      `ttsOutput` no longer carries the chip's product/classification text on the
      swap (capture per the Background recipe).
- [x] Every chip variant still announces correctly on Android (appear AND
      non-null→non-null transitions) — verify **each** of the 7 variants
      (`barcode_lock`, `step2_review`, `step2_confirmed`, `step3_review`,
      `session_complete`, `smart_photo`, `smart_error`) on-device/emulator. No
      variant goes silent.
- [x] iOS behaviour is not regressed (the existing iOS `announceForAccessibility`
      appear + busy announces still fire as before).
- [x] Update the codified rule `docs/rules/accessibility.md` (the
      `accessibilityLiveRegion` + `accessibilityState busy` entries, which name
      ProductChip as the precedent) to match the new model.
- [x] Update ProductChip tests that assert the container `accessibilityLiveRegion`
      / announce gating.

## Implementation Notes

- Likely shape: replace the implicit container live region with an **explicit,
  cross-platform announce model** that fires for **every** variant transition
  (not just null→non-null) — i.e. drive `announceForAccessibility` on both
  platforms for appear + each meaningful transition, and announce the busy edge
  explicitly ("Analyzing photo…", already done iOS-only at ~line 113) so the
  busy swap signals just "busy" instead of re-reading the chip. This is the only
  approach that is deterministic across all 7 variants. It does touch the iOS
  announce gates (behaviour preserved, the `Platform.OS === "ios"` guard removed
  because there is no longer a live region to double-announce against).
- Alternative considered: move `accessibilityLiveRegion="polite"` onto a wrapper
  around just the informational rows (leaving action buttons outside). Has its
  own gaps — button-only transitions (`step2_review→step2_confirmed`) and
  content-light variants (`session_complete`) may stop announcing because their
  info rows didn't change. Verify per-variant if pursued.
- **Verify the fix empirically, don't reason about it** — this behaviour was
  deferred precisely because it can't be predicted from source. Drive every
  variant on the emulator (and ideally a physical device — the emulator result is
  provisional).

## Dependencies

- None — builds on current `main`. (No longer hardware-gated for the _observation_
  — that's done; this is the _fix_.)

## Risks

- Medium-touch for an a11y change: it reworks the chip's announce model across all
  7 variants + a codified rule + tests. Mis-scoping silences a variant on Android.
  Per-variant verification is mandatory.

## Updates

### 2026-06-23

- Created from the resolved investigation todo (now archived). The deferred
  question is answered (busy swap DOES re-read the whole chip, emulator-confirmed);
  this todo tracks the actual fix, which is a cross-variant announce-model rework
  rather than the scoped one-liner originally imagined.

### 2026-06-24 — RESOLVED (fix implemented + emulator-verified)

Implemented the explicit cross-platform announce model in
`client/camera/components/ProductChip.tsx`:

- **Removed** the container `accessibilityLiveRegion="polite"` (the sole shared
  announcer that re-read the whole subtree on the busy swap).
- `AccessibilityInfo.announceForAccessibility(getChipAnnounceText(...))` now
  fires on **every** non-null variant transition on **both** platforms (the
  effect is keyed on `variant`, covering appear AND non-null→non-null).
- The smart-confirm `"Analyzing photo…"` busy announce now fires on **both**
  platforms on the idle→busy edge (iOS gate dropped). busy→idle is intentionally
  silent — it only happens on ScanScreen's `abort` path (user navigated away).
- Docs: updated the two `docs/rules/accessibility.md` precedents (kept the
  general live-region+iOS-gate guidance intact for the ~40 other components).
- Tests: added `client/camera/components/__tests__/ProductChip.a11y.test.tsx`
  (8 tests, all pass) locking the new model: no container live region, announce
  on appear + transition on both platforms, busy announces once then silent.

**Empirical TalkBack sweep** — emulator `Medium_Phone_API_36.1`
(`google_apis_playstore`, TalkBack 16.0.0), full auto-advancing harness cycle,
composed speech read from `logcat -v time` (`talkback` tag, `setprop
log.tag.talkback VERBOSE`):

- **AC1 (busy swap, both directions):** BUSY-ON spoke **only** `"Analyzing
photo…"`; BUSY-OFF was **silent**. `nodeLiveRegion=1` count across the whole
  cycle = **0**; the old re-read signature (`"…Confirm smart photo analysis,
busy. Button"`, confidence labels, multi-sentence chip) = **0 matches**. ✅
- **AC2 (no variant silent):** all 7 variants spoke on appear, and all 3 named
  non-null→non-null transitions spoke (`barcode_lock→session_complete` →
  "Scan complete", `step2_review→step2_confirmed` → "Nutrition values
  confirmed", `step3_review→session_complete` → "Scan complete"). Every
  utterance traced to a `TYPE_ANNOUNCEMENT` from `AccessibilityInfoModule` (the
  imperative announce), never a `WINDOW_CONTENT_CHANGED` re-read. ✅
- **AC3 (iOS not regressed):** the iOS appear + busy announces still fire
  (covered by the render test, which asserts both platforms); the new model only
  **adds** iOS announces on non-null→non-null transitions that were previously
  silent — additive, not a regression. ✅

Caveat (unchanged from the investigation): emulator TalkBack is provisional vs a
physical device, but the behaviour verified here is deterministic (live region
removed → no re-read; imperative announce → speaks).

**Code review (code-reviewer + accessibility-specialist) — 1 in-scope fix added:**
Both reviewers caught a regression the variant-stepped emulator sweep structurally
could not: `BARCODE_LOCKED` renders with no product, then an async `PRODUCT_LOADED`
adds the name **keeping the same phase type** — so the `variant`-keyed effect never
re-fires and the loaded name (which the old container live region spoke on Android)
went silent. Fixed with a dedicated `productName`-keyed, edge-guarded effect that
announces the loaded name on both platforms. Re-verified on the emulator: the
`PRODUCT_LOADED` step now speaks `"Acme Test Cola"` as a `TYPE_ANNOUNCEMENT` with
no whole-chip re-read (`nodeLiveRegion=1` = 0). Tests grew to 11 (added the
async-load case + made the platform-symmetric cases `it.each`). `accessibility.md`
gained a clause: imperative announces replacing a shared live region must be keyed
on the changed **content**, not just the variant/discriminator.

Surfaced (NOT fixed — pre-existing, out of this todo's scope): the user-present
smart-confirm `reset` paths (premium gate / unrecognised content type) give no
spoken "couldn't complete" cue after `"Analyzing photo…"`. Tracked for the user's
decision.
