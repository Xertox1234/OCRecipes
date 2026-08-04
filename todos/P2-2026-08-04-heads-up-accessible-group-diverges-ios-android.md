---
title: "The 'Heads up' accessible group loses badge explanations on iOS and doesn't collapse at all on Android"
status: backlog
priority: medium
created: 2026-08-04
updated: 2026-08-04
assignee:
labels: [deferred, accessibility]
github_issue:
blocked_reason: "the resolution is a design call between two incompatible directions (drop the group vs. collapse Android to match iOS), and it lands inside the section slice 2c redesigns — deciding it before 2c's design pass would be decided twice"
human_led: true
---

# "Heads up" accessible group: iOS loses detail, Android doesn't collapse

## Summary

`client/components/nutrition/FlagSections.tsx` wraps the universal scan-flag badges in a
`<View accessible={true} accessibilityLabel={headsUpSummaryLabel(universalToShow)}>`. That
wrapper behaves differently on each platform, and **both behaviours are wrong in different
directions**:

- **iOS** collapses the subtree to one VoiceOver node speaking only the composed summary.
  The per-badge explanations are never announced — a VoiceOver user hears "High in sugar"
  but never "Above the FSA guideline for sugar."
- **Android** does not collapse at all. The wrapper AND all three badges stay
  `focusable=true`, so TalkBack makes 4 stops and reads the summary _and_ every badge —
  the same content twice.

## Background

Device-verified 2026-08-04 on emulator `Medium_Phone_API_36.1` (Android 16, Google APIs)
by diffing `uiautomator dump` between `main` and `refactor/nutrition-detail-slice-2b`.
The tree (identical on both branches — this is **pre-existing**, not a slice-2b
regression):

```
[ViewGroup]  desc='3 nutrition flags: High in sugar, Ultra-processed, Contains caffeine'
                                                     focusable=true  bounds=[42,952][1038,1183]
  [TextView] desc='High in sugar. Above the FSA guideline for sugar.'
                                                     focusable=true  bounds=[42,952][343,1015]
  [TextView] desc='Ultra-processed. NOVA group 4 — …' focusable=true  bounds=[42,1036][395,1099]
  [TextView] desc='Contains caffeine. …'              focusable=true  bounds=[42,1120][416,1183]
```

**The children carry strictly more information than the group label.** That inverts the
usual reading of this divergence: Android is not the degraded platform here — iOS is,
because the collapse discards the FSA explanations that justify each flag, and those
explanations exist nowhere else on the screen.

The rationale comments in `FlagSections.tsx` and `CapturedPhotos.tsx` both asserted that
`accessible={true}` collapses the subtree on "VoiceOver/TalkBack". The TalkBack half is
false; both comments were corrected on the slice-2b branch with the evidence above.

`docs/rules/accessibility.md` does not settle this. Its double-announce rules (decorative
icons, emoji, badges) all address elements **nested inside a labelled parent**; the closest
structural rule is "Never set `accessible={true}` on a banner/card wrapper that contains an
interactive child", which does not apply — `ScanFlagBadge` is not interactive.

## Acceptance Criteria

- [ ] Decide the direction, as part of slice 2c's design pass, between:
      **(a) drop the group wrapper** — every badge becomes its own stop on both platforms
      and speaks its full explanation; the composed summary is deleted, and TalkBack's
      current 3-of-4 stops become the intended behaviour on both platforms; or
      **(b) keep the group and collapse Android to match iOS** — add
      `importantForAccessibility="no-hide-descendants"` to the wrapper, accepting that the
      FSA explanations are unreachable on both platforms.
- [ ] If (a): confirm `headsUpSummaryLabel` has no remaining consumer before deleting it,
      and remove the "one array feeds both label and badges" invariant from
      `FlagSections.tsx`'s docblock, which exists only to serve the summary.
- [ ] If (b): the Nutri-Score chip's sibling placement stops being load-bearing on Android
      too — re-check whether the comment justifying it still needs to say "iOS only".
- [ ] Verify the chosen direction on BOTH platforms — VoiceOver stop count + spoken text on
      iOS, `uiautomator dump` focusable count on Android. jsdom cannot observe either.
- [ ] Re-check `client/components/nutrition/CapturedPhotos.tsx`, which uses the same
      wrapper pattern for a different purpose (image + caption). Its Android behaviour is
      currently **inferred, not observed** — the barcode fixture used for the dump has no
      captured photos. If Android does not collapse there either, TalkBack reads "Nutrition
      label you photographed" then "Nutrition label", which is the exact double-announce
      that wrapper was chosen to prevent.

## Implementation Notes

- Files: `client/components/nutrition/FlagSections.tsx` (the wrapper, `:87-95`, and the
  corrected rationale comment above it), `client/screens/nutrition-detail-flags-utils.ts`
  (`headsUpSummaryLabel`), `client/components/nutrition/CapturedPhotos.tsx` (same pattern,
  separate decision).
- **Sequencing:** this section is rewritten by slice 2c, which replaces the scalar nutrient
  badges (sugar / saturated fat / sodium) with the FSA traffic-light panel. Whichever
  badges survive that narrowing are the ones this decision applies to — deciding before 2c
  means deciding against a set of badges that no longer exists. `"nutrient"` must stay in
  `UNIVERSAL_KINDS` regardless; `partitionScanFlags` warn-and-drops unmodelled kinds.
- Method for the Android half: `adb shell uiautomator dump /sdcard/ui.xml && adb pull
/sdcard/ui.xml`, then compare `content-desc` + `focusable` per node. TalkBack itself is
  not needed for the structural question.

## Scope Contract

- **Mechanisms to use:** existing RN a11y props only (`accessible`,
  `importantForAccessibility`, `accessibilityElementsHidden`) — nothing new.
- **Files in scope:** the three listed above, plus
  `client/screens/__tests__/NutritionDetailScreen.test.tsx` if the summary label's
  characterisation assertions move.
- No new mechanisms, files, or abstractions.

## Dependencies

- Slice 2c (NutritionPanel / presentation) should be designed first — see Sequencing.

## Risks

- Direction (a) increases TalkBack stop count on a screen that already has many. That is
  the correct trade if the explanations matter, but it should be a conscious choice, not a
  side effect.
- Direction (b) permanently hides the FSA explanations from every screen-reader user on
  both platforms, while sighted users keep them. That is an accessibility regression
  relative to the visual UI, even though it is what iOS already does today.

## Updates

### 2026-08-04

- Filed from the slice-2b Android verification pass. Pre-existing on `main`; byte-identical
  on both branches, so not a slice-2b regression. Not a blocker for PR #751.
