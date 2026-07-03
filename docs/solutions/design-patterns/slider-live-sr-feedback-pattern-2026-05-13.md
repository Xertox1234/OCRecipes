---
title: Slider live screen-reader feedback via local state + accessibilityValue
track: knowledge
category: design-patterns
module: client
tags: [react-native, accessibility, slider, voiceover, talkback]
applies_to: [client/components/**/*.tsx]
created: '2026-05-13'
---

# Slider live screen-reader feedback via local state + accessibilityValue

## When this applies

`@react-native-community/slider` only fires `onSlidingComplete` by default — `accessibilityValue.now` stays stale during the drag gesture, so VoiceOver/TalkBack users hear the committed value, not the live thumb position. Fix with local state driven by `onValueChange`.

## Examples

```typescript
// accessibilityValue driven by local live state — updated on every frame
const [livePrepTime, setLivePrepTime] = useState(filters.maxPrepTime ?? 0);

// Sync back when parent resets (e.g. "Reset filters" button)
useEffect(() => {
  setLivePrepTime(filters.maxPrepTime ?? 0);
}, [filters.maxPrepTime]);

<Slider
  value={filters.maxPrepTime ?? 0}
  onValueChange={(val) => setLivePrepTime(val)}        // live SR feedback
  onSlidingComplete={(val) => {
    setLivePrepTime(val);                               // keep in sync
    onFiltersChange({ ...filters, maxPrepTime: val > 0 ? val : undefined });
  }}
  accessibilityValue={{
    min: 0, max: 120,
    now: livePrepTime,
    text: livePrepTime > 0 ? `${livePrepTime} minutes` : "Any prep time",
  }}
/>
```

## Why

- `onValueChange` updates local state only (no parent call on every frame — no filter churn)
- `onSlidingComplete` commits to parent AND updates local state (prevents stale value on release)
- `useEffect` syncs local state when committed filter changes externally (e.g. Reset button) — without this the SR text shows the last dragged value even after reset

## Related Files

- `client/components/meal-plan/SearchFilterSheet.tsx`
