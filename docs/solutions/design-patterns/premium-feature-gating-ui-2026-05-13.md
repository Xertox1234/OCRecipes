---
title: 'Premium feature gating: button lock badge, section lock row, disabled input overlay'
track: knowledge
category: design-patterns
module: client
tags: [react-native, hooks, premium, gating, accessibility, ui]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
last_updated: '2026-11-03'
---

# Premium feature gating: button lock badge, section lock row, disabled input overlay

## When this applies

When a feature requires premium, extract the condition and provide clear feedback at the UI level. Three flavours apply depending on context: a lock-badge button for individual actions, a `Pressable` lock row replacing an entire premium-only section, and a disabled-input overlay for fields free users should see but not edit.

### Wall only a user KNOWN to be free (owner ruling 2026-11-02)

`usePremiumContext()` reports `isPremium: false` both for a free user and while the status is **unknown**: still loading, or `/api/subscription/status` failed with nothing cached. In both cases `tier` defaults to `"free"`. Any lock, badge, cap or `UpgradeModal` must therefore gate on `isPremiumResolved && !isPremium`, never on `!isPremium` alone. Otherwise a 429/5xx walls a paying user (audit M-crel-6).

Unknown status is **neutral**: no wall, and no premium grant.

- **Tap gate** (a button that would open the `UpgradeModal`): when `!isPremiumResolved`, call `void refreshSubscription()`, show `toast.info("Checking your plan. Try again in a moment.")`, and return. One branch covers both the loading and failed cases, because a refetch is deduped while in flight, and on a failed query with no data it resets the query to pending.
- **Persistent gate** (a screen or CTA that renders instead of the feature): render a spinner while loading. On `isPremiumStatusError` (the subscription fetch failed with nothing cached; a scan-count failure does not set it), render a "Couldn't check your plan" retry that calls `refreshSubscription`. Never mount the premium feature itself, such as the camera, until `isPremium` is true.
- **Test mocks:** a `usePremiumContext` mock with no `isPremiumResolved` now hits the unknown branch. Set `isPremiumResolved: true` in every mock that tests a resolved tier.

#### `usePremiumFeature` gates: use `usePlanCheck` (added in #1707)

`usePremiumFeature(key)` returns a plain boolean that reads `false` while the plan is unknown. Don't change the hook, because 20+ callers depend on it. Pair it with `usePlanCheck()` (`client/hooks/usePlanCheck.ts`), which returns `{ planUnknown, recheckPlan }`. `recheckPlan()` is the tap-gate re-check plus toast described above. Don't write that branch inline again.

- **Show a lock** only when the plan is known to be free: `const locked = !planUnknown && !canX`.
- **At the spend point,** put the unknown branch first: `if (planUnknown) { recheckPlan(); return; }`, then `if (!canX) { openUpgrade(); return; }`.
- **When one flag drives both the lock and the tap route** (a child such as `RecipeFinderMessage` or `WizardCoverStep` takes a single `canGenerate` or `lockedButtons` prop), pass "unlocked" while the plan is unknown. Then gate the parent's spend handler. For finder actions, gate only the premium ones with `finderActionNeedsPlan(action.type)`, or a free user tapping "None of these" gets the toast.
- **An auto-sent prompt** (`RecipeChatScreen`'s `initialMessage`) isn't in the input yet. Put it there before returning, so the retry is one tap rather than a retype.
- **Read-only fields** (GoalSetup macros) can stay non-editable while the plan is unknown, because a free user's values would not save. Drop only the Premium wording: `const upsell = !planUnknown && !canX`.
- **Test mocks:** `usePlanCheck` lives in its own file, so mock it as one stable object: `vi.mock("@/hooks/usePlanCheck", () => { const p = {…}; return { usePlanCheck: () => p }; })`. A fresh `recheckPlan` per render churns every `useCallback` that lists it, and the CoachChat `renderItem`-stability test failed on exactly that.

#### "Loading" is not "unknown"

Code that assumed premium "while loading" (`isCoachPro || isPremiumLoading`) still fell to free on a **failed** check, because a failed query is not loading. Key on `!isPremiumResolved` instead (#1709, `CoachProScreen` and `AllConversationsScreen`). For a "Couldn't check your plan" screen, use `isPremiumStatusError`, never `isError && !isPremiumResolved`. `isError` also covers the scan-count query, so a scan-count failure showed the subscription error screen while the subscription was still loading.

Precedents: `ReceiptCaptureScreen.tsx` (persistent gate), `AskCoachSection.tsx` (tap gate), `RecipeBrowserScreen.tsx` (ideas CTA), and `ChatStackNavigator.tsx` (mount-once gate; see [isloading-false-on-error-not-resolved](../conventions/isloading-false-on-error-not-resolved-2026-06-12.md)). `usePlanCheck` precedents (#1707): `RecipeChatScreen.tsx`, `CoachChat.tsx` (finder), `CookbookCreateScreen.tsx`, `CookbookCreateWizard.tsx`, `ImportRecipeSheet.tsx`, and `GoalSetupScreen.tsx`.

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
- `client/context/PremiumContext.tsx` — `isPremiumResolved`, `isPremiumStatusError`
- `client/screens/ReceiptCaptureScreen.tsx` — persistent gate with unknown-status retry
- `client/components/AskCoachSection.tsx` — tap gate that re-checks while status is unknown
- `client/screens/ProfileScreen.tsx` — section-level lock row
- `client/screens/GoalSetupScreen.tsx` — disabled input gating
