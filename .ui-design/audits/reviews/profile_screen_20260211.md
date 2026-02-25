# Design Review: ProfileScreen Redesign

**Review ID:** profile_screen_20260211
**Reviewed:** 2026-02-11
**Target:** client/screens/ProfileScreen.tsx
**Focus:** Visual, Usability, Code Quality, Performance

## Summary

The Profile screen was redesigned from a settings-dashboard layout to a social-media-style profile (cover photo, avatar ring, stats row, photo grid, settings section). The new layout is visually richer and more engaging. However, there are issues around iOS safe area handling at the top, hardcoded mock data masquerading as real content, tiny touch targets, and some accessibility gaps.

**Issues Found:** 12

- Critical: 1
- Major: 4
- Minor: 4
- Suggestions: 3

---

## Critical Issues

### Issue 1: Cover photo extends under status bar without safe area protection

**Severity:** Critical
**Location:** `ProfileScreen.tsx:96-117` (CoverPhotoSection), `ProfileScreen.tsx:744-748` (coverContainer style)
**Category:** Usability

**Problem:**
The navigation header is hidden (`headerShown: false` in ProfileStackNavigator) and the cover photo fills the full `COVER_HEIGHT` (153px) from the very top edge. On iPhones with Dynamic Island or notch, the status bar text overlaps the cover image with no protection. There is no `paddingTop: insets.top` applied anywhere above the cover, and the gradient only fades toward the bottom.

**Impact:**
On all modern iPhones (Dynamic Island, notch), the status bar clock/icons sit directly on the cover image with unpredictable contrast. This can make the status bar unreadable depending on the image content. This is a standard iOS requirement that other screens in the app handle via `useSafeAreaInsets`.

**Recommendation:**
Either add a translucent status bar overlay at the top of the cover section, or increase `COVER_HEIGHT` to account for `insets.top` and position the gradient accordingly. Many social-media apps use a semi-transparent dark gradient at the top specifically for status bar legibility.

```tsx
// Option A: Add top gradient for status bar legibility
const CoverPhotoSection = React.memo(function CoverPhotoSection() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.coverContainer, { height: COVER_HEIGHT + insets.top }]}>
      <Image ... />
      {/* Top gradient for status bar */}
      <LinearGradient
        colors={[withOpacity('#000000', 0.4), 'transparent']}
        style={[styles.coverGradientTop, { height: insets.top + 20 }]}
      />
      {/* Bottom gradient for content blend */}
      <LinearGradient ... />
    </View>
  );
});
```

---

## Major Issues

### Issue 2: Photo grid shows hardcoded mock data with no path to real content

**Severity:** Major
**Location:** `ProfileScreen.tsx:84-92` (MOCK_FOOD_GRID), `ProfileScreen.tsx:309-319` (PhotoGrid)
**Category:** Usability

**Problem:**
The photo grid renders 6 hardcoded emoji items (`MOCK_FOOD_GRID`). There is no integration with the user's actual scanned items, saved items, or meal photos. The grid has no "empty state" — it always shows the same fake data. There is no comment or TODO indicating this is placeholder.

**Impact:**
Users see content that is not theirs, creating confusion. The grid takes significant visual real estate (282px+ of screen height) but delivers no value. If this is intentional placeholder for a future feature, it should either show the user's actual logged food photos or display an empty state with a CTA.

**Recommendation:**
Either connect the grid to the user's `scannedItems` with actual photo data, or replace with an empty state like "Start scanning to build your food gallery" with a camera icon CTA. Mark clearly as TODO if deferred.

---

### Issue 3: Stats row shows hardcoded "7 Days" streak

**Severity:** Major
**Location:** `ProfileScreen.tsx:217`
**Category:** Usability

**Problem:**
The "Streak" stat is hardcoded to `7 Days` regardless of the user's actual usage. The calories and logged count pull from real `todaySummary` data, but the streak is fake.

**Impact:**
Mixing real data (calories, logged count) with fake data (streak) is misleading. Users may trust the streak value and be confused when it never changes.

**Recommendation:**
Either implement a real streak calculation on the backend, or remove the streak stat until it's backed by real data. Showing two real stats is better than three where one is fake.

---

### Issue 4: Bio text is hardcoded and not user-editable

**Severity:** Major
**Location:** `ProfileScreen.tsx:189-191`
**Category:** Usability

**Problem:**
The bio text is hardcoded as `"Tracking my nutrition journey"`. There is no mechanism for the user to set their own bio, and the Edit Profile button navigates to EditDietaryProfile, not a profile editor.

**Impact:**
Social-media-style profiles set the expectation that the bio is personalized. Users who see an "Edit Profile" button next to a bio they can't edit may be confused.

**Recommendation:**
Either add a `bio` field to the user profile and make it editable via the Edit Profile flow, or remove the bio line entirely to avoid the disconnect.

---

### Issue 5: Small touch targets on stats and grid items

**Severity:** Major
**Location:** `ProfileScreen.tsx:206-231` (StatsRow), `ProfileScreen.tsx:280-307` (PhotoGridItem)
**Category:** Usability / Accessibility

**Problem:**

- The stat items (`statNumber` at 12px font, `statLabel` at 10px) are very small. While they're not interactive, the stat numbers are difficult to read at 12px on mobile.
- Grid item names use 10px font (`gridItemName`), which is below the recommended minimum of 11-12px for mobile.
- The `gearButton` (36x36) meets the 44pt minimum, but barely. The avatar camera badge (22x22) is also quite small as a tap target, though it's secondary to the avatar press area.

**Impact:**
10px text is hard to read on mobile, especially for users with any visual impairment. Apple HIG recommends minimum 11pt for body text.

**Recommendation:**
Increase `statNumber` to at least 14-16px and `statLabel` to 11-12px. Increase `gridItemName` to at least 12px. These changes would improve readability without disrupting the layout.

---

## Minor Issues

### Issue 6: Skeleton loading state doesn't account for cover photo height + safe area

**Severity:** Minor
**Location:** `ProfileScreen.tsx:453-500` (ProfileSkeleton)
**Category:** Visual

**Problem:**
The skeleton uses `SkeletonBox width="100%" height={COVER_HEIGHT}` but doesn't account for the dynamic safe area top inset, so the skeleton and loaded state will have mismatched heights if Issue 1 is fixed.

**Recommendation:**
Keep the skeleton in sync with any cover height changes.

---

### Issue 7: Separator lacks vertical breathing room below

**Severity:** Minor
**Location:** `ProfileScreen.tsx:866-871` (separator style)
**Category:** Visual

**Problem:**
The separator between the action buttons and the photo grid has `marginTop: Spacing.lg` (16px) but no `marginBottom`. The photo grid then adds its own `paddingTop: Spacing.lg`. This creates 32px total (16 above line, 16 below line) which is fine, but the visual weight is lopsided because the separator butts up against the buttons more closely than the grid due to the action buttons having no bottom margin.

**Recommendation:**
Add `marginVertical: Spacing.lg` to the separator for balanced spacing, or add `marginBottom: Spacing.sm` to the actionButtonsRow.

---

### Issue 8: SettingsSection dividers use manual margin calculation

**Severity:** Minor
**Location:** `ProfileScreen.tsx:946-948`
**Category:** Code Quality

**Problem:**
The settings divider uses `marginLeft: Spacing.lg + 40 + Spacing.md` (16 + 40 + 12 = 68px) — this is a hardcoded calculation coupling the icon size (40) with padding values. If the icon size or padding changes, this breaks silently.

**Recommendation:**
Extract the icon size as a constant (e.g., `SETTINGS_ICON_SIZE = 40`) and reference it in both the icon style and divider margin. This is a minor coupling risk.

---

### Issue 9: Grid items lack accessibility labels

**Severity:** Minor
**Location:** `ProfileScreen.tsx:280-307` (PhotoGridItem)
**Category:** Accessibility

**Problem:**
The `PhotoGridItem` renders as a plain `View` with no `accessibilityLabel`. The emoji and name are separate text elements. Screen readers will read the emoji character and the name separately, which may not convey the intended meaning.

**Recommendation:**
Add `accessibilityLabel={item.name}` to the grid item container `View`, and mark the inner emoji/name as `accessibilityElementsHidden` or `importantForAccessibility="no"` so VoiceOver reads only the consolidated label.

---

## Suggestions

### Suggestion 1: Consider using FlatList or FlashList for the photo grid

**Category:** Performance

The photo grid renders all 6 items eagerly via `.map()`. This is fine for 6 items, but if this connects to real data in the future, a `FlatList` with `numColumns={2}` would be more scalable and provides `getItemLayout` for optimized scrolling. Worth considering now to avoid a rewrite later.

---

### Suggestion 2: The "Edit Profile" button navigates to dietary profile, not a profile editor

**Category:** Usability

The "Edit Profile" button (`onEditProfile`) navigates to `EditDietaryProfile`. While dietary preferences are part of the profile, the social-media-style layout implies "Edit Profile" would let users change their name, avatar, and bio. Consider renaming the button to "Edit Dietary Profile" or adding a dedicated profile edit screen.

---

### Suggestion 3: Cover photo is reusing login hero image

**Category:** Visual

The cover photo uses `require("../../assets/images/login-hero.jpg")` — the same image as the login screen. For a social-media-style profile, users typically expect either a personalized cover photo they can change, or a default that's distinct from the login screen. If personalization is planned, the infrastructure for avatar upload could be extended to cover photos.

---

## Positive Observations

- **Excellent component decomposition**: Each visual section is a well-isolated `React.memo` sub-component (`CoverPhotoSection`, `AvatarWithRing`, `UserNameBio`, `StatsRow`, etc.). This is clean and maintainable.
- **Good accessibility foundations**: `accessibilityLabel`, `accessibilityRole`, and `accessibilityHint` are used consistently on interactive elements. The `AccessibilityInfo.announceForAccessibility` on profile load is a great touch.
- **Reduced motion support**: All `FadeInDown` animations correctly check `reducedMotion` and pass `undefined` when the user prefers no motion. This follows the established codebase pattern well.
- **Proper haptic feedback**: Every interactive action triggers appropriate haptic feedback (light for navigation, medium for logout).
- **Clean gradient overlay technique**: The LinearGradient on the cover photo and grid items is a polished approach. The comment explaining why grid item text is hardcoded white (over dark gradient) is helpful.
- **Theme-aware styling**: Consistent use of `useTheme()` and theme tokens throughout. No hardcoded colors except the intentional white-on-gradient overlay.
- **Skeleton loading state**: The ProfileSkeleton matches the layout structure closely, providing a good loading experience.

## Next Steps

1. **Fix the status bar / safe area issue** (Critical) — This is the most impactful issue affecting all modern iPhones
2. **Decide on mock data strategy** — Either connect the photo grid to real data or add an empty state; similarly for the streak stat and bio text
3. **Increase minimum font sizes** — Bump stat numbers and grid labels to at least 12px for readability
4. **Add grid item accessibility labels** — Quick win for screen reader users

---

_Generated by UI Design Review. Run `/ui-design:design-review` again after fixes._
