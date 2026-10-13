---
title: Coach — Accessibility
date: 2026-05-04
status: approved
plan: 5 of 5 (Coach deep-dive review)
---

## Overview

This plan fixes five accessibility issues in the Coach UI: streaming text is invisible to VoiceOver during playback, the mic button's listening state is not announced on Android, the InlineChart stat_row has no accessible labels, the mic button uses the wrong ARIA state, and ActionCard has a hardcoded color that diverges in dark mode.

## Scope

Files: `client/components/coach/CoachChat.tsx`, `client/components/coach/CoachMicButton.tsx`, `client/components/coach/blocks/InlineChart.tsx`, `client/components/coach/blocks/ActionCard.tsx`

## Issue Inventory

### 1. Streaming text not announced to VoiceOver (MEDIUM)

**Location:** `client/components/coach/CoachChat.tsx:131–142`

**Problem:** VoiceOver users hear "Coach is thinking…" when streaming begins and "Coach responded" when it finishes. During the drain animation, no content is announced progressively — VoiceOver users must manually navigate to the new bubble after the stream ends.

**Fix:** Add a periodic announcement during streaming using `AccessibilityInfo.announceForAccessibility`. Announce the first complete sentence (ending at a `.`, `?`, or `!`) as soon as it is drained into `streamingContent`. Subsequent sentences are announced as they complete. This avoids spamming the screen reader every drain tick (20×/sec) while still giving progressive feedback.

Implementation: track the last announced character index in a `useRef`. In the drain callback (or in a `useEffect` watching `streamingContent`), scan for the next sentence boundary past the last announced position. When found, call `announceForAccessibility` with the new sentence. Reset the ref when `isStreaming` becomes false.

Limit to iOS only (VoiceOver) — see item 2 for Android.

### 2. CoachMicButton missing Android TalkBack announcement (MEDIUM)

**Location:** `client/components/coach/CoachMicButton.tsx:43–48`

**Problem:** Listening state changes are announced via `AccessibilityInfo.announceForAccessibility` on iOS but there is no `accessibilityLiveRegion` for Android TalkBack. See project pattern in `memory/MEMORY.md`: "accessibilityLiveRegion is Android-only — pair with AccessibilityInfo.announceForAccessibility() for iOS."

**Fix:** Add `accessibilityLiveRegion="polite"` to the container `View` in `CoachMicButton`. Pair it with a hidden `Text` element that renders the state string ("Listening" / "") conditionally on `isListening`. TalkBack announces the live region content when it changes. The existing `announceForAccessibility` call handles iOS; this addition handles Android.

### 3. InlineChart stat_row has no accessible labels (MEDIUM)

**Location:** `client/components/coach/blocks/InlineChart.tsx:53–76`

**Problem:** The `stat_row` variant renders a container with no `accessibilityLabel`, and individual stat values are bare `Text` elements. VoiceOver reads raw numbers with no context ("2,300", "165", "45", "72") — no indication of what each number represents.

**Fix:**

- Add `accessibilityLabel` to the stat_row container: compose a descriptive string from all stats, e.g., `"Nutrition summary: 2,300 calories, 165g protein, 45g fat, 72g carbs"`. This gives VoiceOver a single focused announcement for the whole block.
- Mark individual stat `Text` elements with `accessibilityElementsHidden={true}` (iOS) and `importantForAccessibility="no"` (Android) to prevent double-reading when the user swipes through child elements after landing on the container.

The `accessibilityLabel` string should be constructed from the block's data props so it stays in sync with rendered values automatically.

### 4. CoachMicButton uses wrong accessibilityState (LOW)

**Location:** `client/components/coach/CoachMicButton.tsx:65`

**Problem:** `accessibilityState={{ selected: isListening }}` — `selected` is semantically for list/tab selection, not toggle buttons. VoiceOver announces "selected" instead of "on/off" or "checked/unchecked".

**Fix:** Change to `accessibilityState={{ checked: isListening }}`. This matches the toggle button semantic (on/off binary state). VoiceOver will announce "Coach mic, checked" or "Coach mic, unchecked" — appropriate for a toggleable mic button.

Also verify `accessibilityRole="button"` is set (it appears to be) — toggle buttons should use `accessibilityRole="togglebutton"` if supported on the target RN version (check RN 0.81 docs). If available, use `"togglebutton"`.

### 5. ActionCard hardcoded #008A38 success color (LOW)

**Location:** `client/components/coach/blocks/ActionCard.tsx:63, 87, 117`

**Problem:** `#008A38` (success green) is hardcoded in `ActionCard`. This color is `theme.success` in the theme system. In dark mode, `theme.success` may differ — the hardcoded hex diverges.

**Fix:** Replace all three instances of `#008A38` in `ActionCard` with `theme.success`. The component already uses `useTheme()` — add `theme.success` to the destructured theme values and substitute. Verify the surrounding `#FFFFFF` instances are intentional (white on colored button = `theme.buttonText`) and leave those unchanged if they are.

## Cross-Platform Consistency

Per project pattern, all accessibility fixes must work on both iOS and Android:

- `AccessibilityInfo.announceForAccessibility` → iOS VoiceOver only
- `accessibilityLiveRegion` → Android TalkBack only
- `accessibilityState={{ checked }}` → both platforms
- `accessibilityElementsHidden` / `importantForAccessibility` → platform-specific props, apply both

## Testing

Accessibility fixes are inherently manual-test items, but add the following automated checks:

- Snapshot/render tests for `InlineChart` stat_row to verify `accessibilityLabel` is present on the container.
- Snapshot test for `CoachMicButton` to verify `accessibilityState.checked` (not `selected`) is used.
- Lint rules already check for hardcoded colors on `.tsx` files (per pre-commit hook) — the `#008A38` change will be caught automatically on commit.
- Manual test: enable VoiceOver on iOS, send a message, verify sentences are announced during streaming.
- Manual test: enable TalkBack on Android, tap mic button, verify "Listening" is announced.

## Files Changed (expected)

- `client/components/coach/CoachChat.tsx`
- `client/components/coach/CoachMicButton.tsx`
- `client/components/coach/blocks/InlineChart.tsx`
- `client/components/coach/blocks/ActionCard.tsx`
- Corresponding `__tests__` files (snapshot updates)
