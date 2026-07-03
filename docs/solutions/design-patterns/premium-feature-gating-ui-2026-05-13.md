---
title: 'Premium feature gating: button lock badge, section lock row, disabled input overlay'
track: knowledge
category: design-patterns
module: client
tags: [react-native, premium, gating, accessibility, ui]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
---

# Premium feature gating: button lock badge, section lock row, disabled input overlay

## When this applies

When a feature requires premium, extract the condition and provide clear feedback at the UI level. Three flavours apply depending on context: a lock-badge button for individual actions, a `Pressable` lock row replacing an entire premium-only section, and a disabled-input overlay for fields free users should see but not edit.

## Examples

### Button with lock badge and accessibility hint

```typescript
// Extract condition to avoid repetition
const isFeatureAvailable = features.someFeature && canUseFeature;

// Button with lock badge and accessibility hint
<Pressable
  onPress={handleFeature}
  accessibilityLabel={
    isFeatureAvailable
      ? "Use premium feature"
      : "Premium feature locked"
  }
  accessibilityHint={
    isFeatureAvailable
      ? undefined
      : "Upgrade to premium to unlock this feature"
  }
>
  <Feather name="star" color={isFeatureAvailable ? theme.text : theme.textSecondary} />
  <ThemedText style={{ color: isFeatureAvailable ? theme.text : theme.textSecondary }}>
    Feature
  </ThemedText>
  {!isFeatureAvailable && (
    <View style={[styles.lockBadge, { backgroundColor: theme.backgroundRoot }]}>
      <Feather name="lock" size={10} color={theme.textSecondary} accessible={false} />
    </View>
  )}
</Pressable>

// Handler with warning haptic for locked state
const handleFeature = () => {
  if (isFeatureAvailable) {
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    // Proceed with feature
  } else {
    haptics.notification(Haptics.NotificationFeedbackType.Warning);
    // Optionally show upgrade prompt
  }
};
```

### Prefer `usePremiumFeature(key)` over raw context access

```typescript
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";

// Good: one-liner, boolean result
const canShowMacros = usePremiumFeature("macroGoals");

// Avoid: pulling the full context just to check one flag
const { features } = usePremiumContext();
const canShowMacros = features.macroGoals;
```

Use `usePremiumCamera()` only in camera screens where you need the combined bundle (barcode types, scan limits, quality, etc.).

### Section-level gating — replace content with a lock row

When an entire section is premium-only, show the content for premium users and replace it with a compact `Pressable` lock row for free users.

```typescript
// ProfileScreen — NutritionGoalsSection
const canShowMacros = usePremiumFeature("macroGoals");

{canShowMacros ? (
  <>
    <View style={styles.macroGoalRow}>
      {/* Protein progress bar */}
    </View>
    <View style={styles.macroGoalRow}>
      {/* Carbs progress bar */}
    </View>
    <View style={[styles.macroGoalRow, styles.macroGoalRowLast]}>
      {/* Fat progress bar */}
    </View>
  </>
) : (
  <Pressable
    accessible
    accessibilityRole="button"
    accessibilityLabel="Detailed macro tracking requires Premium subscription"
    accessibilityHint="Upgrade to premium to unlock macro goals"
    onPress={() => {
      // TODO: Show upgrade modal
    }}
    style={[styles.macroGoalRow, styles.macroGoalRowLast, styles.premiumLockRow]}
  >
    <Feather name="lock" size={16} color={theme.textSecondary} />
    <ThemedText type="small" style={{ color: theme.textSecondary, flex: 1 }}>
      Detailed macro tracking available with Premium
    </ThemedText>
  </Pressable>
)}
```

Key rules for section-level gating:

- Lock row uses `Pressable`, not `View` — keeps it tappable for upgrade prompts
- Always set `accessible`, `accessibilityRole`, `accessibilityLabel`, and `accessibilityHint`
- Use `theme.textSecondary` for lock icon and text (muted, not attention-grabbing)
- Extract lock row layout into a named style (`premiumLockRow`) instead of inline

### Disabled input gating — visible but non-editable

```typescript
// GoalSetupScreen — macro goal inputs
const canSetMacros = usePremiumFeature("macroGoals");

<View style={[styles.goalItem, !canSetMacros && { opacity: 0.4 }]}>
  <View>
    <TextInput
      style={[styles.goalInput, { backgroundColor: theme.backgroundSecondary, color: theme.proteinAccent }]}
      value={manualProtein}
      onChangeText={setManualProtein}
      keyboardType="numeric"
      editable={canSetMacros}
      accessibilityLabel={
        canSetMacros
          ? "Daily protein target"
          : "Daily protein target (Premium required)"
      }
    />
    {!canSetMacros && (
      <View style={styles.goalLockIcon}>
        <Feather name="lock" size={12} color={theme.textSecondary} />
      </View>
    )}
  </View>
  <ThemedText type="small" style={{ color: theme.textSecondary }}>
    Protein (g)
  </ThemedText>
</View>
```

Key rules for disabled input gating:

- Set `editable={false}` on `TextInput` — prevents keyboard from opening
- Apply `opacity: 0.4` to the wrapper — visually signals "unavailable"
- Position a lock icon absolutely within the input area (`position: "absolute"`, top-right)
- Append "(Premium required)" to `accessibilityLabel` so screen readers announce the restriction
- The calculated server values still save normally — free users get defaults, premium users can override

## Why

Free users need to see what they're missing to understand the value of upgrading, but also need clear blocked-state signaling. Each variant (badge, lock row, disabled overlay) handles a different layout density: badge for buttons, lock row for full sections, disabled overlay for inline form fields that need to preserve layout.

## Related Files

- `client/hooks/usePremiumFeatures.ts` — `usePremiumFeature` hook
- `client/screens/ProfileScreen.tsx` — section-level lock row
- `client/screens/GoalSetupScreen.tsx` — disabled input gating
