---
title: "Widening a status indicator's trigger condition without updating its hardcoded copy reintroduces the split-brain it was meant to fix"
track: bug
category: logic-errors
tags: [react-native, confidence, ui-consistency, threshold, copy]
module: client
applies_to: ["client/screens/**/*.tsx", "client/components/**/*.tsx"]
symptoms: [Two visible UI elements derived from the same underlying value contradict each other after a threshold/condition change, A status banner's copy says one tier while a badge next to it shows another]
created: '2026-07-16'
severity: medium
---

# Widening a status indicator's trigger condition without updating its hardcoded copy reintroduces the split-brain it was meant to fix

## Problem

When migrating a screen from an ad-hoc numeric threshold (e.g. `confidence < 0.7`) to a shared tiering helper (e.g. `getConfidenceTier(...) !== "high"`), it's easy to update the **condition** that gates a status element's visibility while leaving that element's **copy** hardcoded to only one of the tiers the new condition now covers.

## Symptoms

- A warning banner's trigger condition now fires for a wider range of underlying values (e.g. both "medium" and "low" tiers instead of just "low"), but its text was written for only the narrowest case ("...is low.") and never updated.
- A badge or dot elsewhere on the same screen — driven by the same tiering function — shows "Medium", while the banner right next to it says "low", for the exact same value.
- This is the *same class* of inconsistency a confidence/threshold-unification effort was filed to eliminate — introduced again, inside the fix itself, by only updating the trigger and not the copy.

## Root Cause

A condition and its associated copy are two separate pieces of state that must be updated together whenever either one's semantics change. Widening `x < 0.7` to `tier !== "high"` silently expands the set of values that satisfy the condition (0.7–0.8 is now included, in addition to <0.7), but a string literal inside the conditional block has no compiler or type-level link back to the condition that gates it — nothing catches copy that no longer matches every value the condition now admits.

## Solution

When a status element's trigger condition is derived from a multi-tier classifier (`getConfidenceTier`, or any function returning more than 2 discrete states), branch the **copy** on the same tier value the condition used, not just the visibility. Compute the tier once, gate visibility on it, and switch text on the same tier:

```tsx
// BAD — condition covers 2 tiers, copy describes only 1
{tier !== "high" && (
  <Banner>AI confidence is low. Please review and edit items as needed.</Banner>
)}

// GOOD — copy branches on the same tier that gates visibility
{(() => {
  if (tier === "high") return null;
  return (
    <Banner>
      {tier === "low"
        ? "AI confidence is low. Please review and edit items as needed."
        : "AI confidence isn't high. Please review and edit items as needed."}
    </Banner>
  );
})()}
```

## Prevention

- Whenever a threshold condition changes from a binary numeric comparison to a call into a shared multi-tier helper, grep the surrounding block for hardcoded tier-specific copy ("low", "high", "medium", etc.) and verify it still matches every state the new condition admits.
- Check any other status indicator (badge, dot, banner) on the same screen driven by the same underlying value — if more than one exists, they must derive their tier from the same function call so they can never diverge, and their copy must be tier-aware if the condition covers more than one tier.
- A code reviewer catching this: read the condition's set of admitted states first, then check that every rendered string covers that full set — not just the state the original narrower condition covered.

## Related Files

- `client/screens/PhotoAnalysisScreen.tsx` — the confirmed instance: banner trigger widened from `confidence < 0.7` to `getConfidenceTier(...) !== "high"` during a confidence-tier unification, copy initially left hardcoded to the "low" case, caught in code review before merge and fixed to branch on tier
- `client/lib/confidence.ts` — the shared `getConfidenceTier`/`getConfidenceColor`/`getConfidenceLabel` helpers this pattern applies to
- `client/screens/LabelAnalysisScreen.tsx` — pre-existing correct precedent: already branches banner copy on `tier === "low"` vs the medium case

## See Also

- [Confidence-based follow-up refinement](../design-patterns/confidence-based-follow-up-refinement-2026-05-13.md)
