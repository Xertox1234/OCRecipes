# Coach — Accessibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 accessibility issues in the Coach UI: streaming text is not announced progressively to VoiceOver, mic button listening state is not announced on Android TalkBack, InlineChart stat_row has no accessible labels, mic button uses wrong ARIA state (`selected` → `checked`), and ActionCard has a hardcoded success color that diverges in dark mode.

**Architecture:** All changes are in the client React Native layer. Each fix is isolated to one component. Platform-specific a11y patterns: `AccessibilityInfo.announceForAccessibility` for iOS VoiceOver, `accessibilityLiveRegion` for Android TalkBack. All changes follow the project pattern documented in `memory/MEMORY.md`.

**Tech Stack:** React Native 0.81, React 19, Vitest (snapshot tests)

---

## File Map

| File                                             | Change                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `client/components/coach/CoachChat.tsx`          | Add sentence-boundary VoiceOver announcements during streaming                             |
| `client/components/coach/CoachMicButton.tsx`     | Add `accessibilityLiveRegion` + hidden `Text` for TalkBack; change `selected` to `checked` |
| `client/components/coach/blocks/InlineChart.tsx` | Add `accessibilityLabel` to stat_row container; hide child elements from a11y tree         |
| `client/components/coach/blocks/ActionCard.tsx`  | Replace `#008A38` with `theme.success`                                                     |

---

## Task 1: Progressive VoiceOver announcements during streaming

**Files:**

- Modify: `client/components/coach/CoachChat.tsx`

- [ ] **Step 1: Add sentence-tracking ref**

In `client/components/coach/CoachChat.tsx`, add two refs near the other refs:

```typescript
const lastAnnouncedIndexRef = useRef(0); // char index up to which we've announced
const prevStreamingRef = useRef(false); // already exists — confirm before adding
```

Check if `prevStreamingRef` already exists (it's used for the streaming start/end announcements around line 131). If so, add only `lastAnnouncedIndexRef`.

- [ ] **Step 2: Reset lastAnnouncedIndexRef when streaming ends**

Find the `useEffect` that watches `isStreaming` (around line 131):

```typescript
useEffect(() => {
  const wasStreaming = prevStreamingRef.current;
  prevStreamingRef.current = isStreaming;

  if (isStreaming && !wasStreaming) {
    lastAnnouncedIndexRef.current = 0; // ← reset at stream start
    AccessibilityInfo.announceForAccessibility("Coach is thinking...");
  } else if (!isStreaming && wasStreaming) {
    AccessibilityInfo.announceForAccessibility("Coach responded");
  }
}, [isStreaming]);
```

- [ ] **Step 3: Add sentence-boundary announcement effect**

Add a new `useEffect` that fires when `streamingContent` changes:

```typescript
useEffect(() => {
  if (!isStreaming || !streamingContent) return;

  const text = streamingContent;
  const startIdx = lastAnnouncedIndexRef.current;
  const remaining = text.slice(startIdx);

  // Find next sentence boundary (., ?, !)
  const boundaryMatch = remaining.match(/[.?!]\s/);
  if (!boundaryMatch || boundaryMatch.index === undefined) return;

  const endIdx = startIdx + boundaryMatch.index + 1; // include the punctuation
  const sentence = text.slice(lastAnnouncedIndexRef.current, endIdx).trim();

  if (sentence.length > 0) {
    lastAnnouncedIndexRef.current = endIdx;
    // iOS VoiceOver only — Android uses accessibilityLiveRegion on the bubble
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility(sentence);
    }
  }
}, [streamingContent, isStreaming]);
```

Add `Platform` to the `react-native` import at the top of the file.

- [ ] **Step 4: Run tests**

```bash
npm run test:run
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add client/components/coach/CoachChat.tsx
git commit -m "feat(a11y): announce streaming sentences progressively to VoiceOver"
```

---

## Task 2: Android TalkBack announcement for CoachMicButton

**Files:**

- Modify: `client/components/coach/CoachMicButton.tsx`

- [ ] **Step 1: Read the current component**

Read `client/components/coach/CoachMicButton.tsx` to understand the current structure before editing.

- [ ] **Step 2: Add accessibilityLiveRegion and hidden Text for TalkBack**

In `client/components/coach/CoachMicButton.tsx`, find the root `Pressable` or container `View`. Wrap the pressable in a `View` with `accessibilityLiveRegion`:

```typescript
<View
  accessibilityLiveRegion="polite"
  importantForAccessibility="yes"
>
  {/* Hidden text for TalkBack — announces when isListening changes */}
  <Text
    style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}
    importantForAccessibility="yes"
    accessibilityElementsHidden={false}
  >
    {isListening ? "Listening" : ""}
  </Text>
  <Pressable
    {/* ... existing pressable props ... */}
  >
    {/* ... existing content ... */}
  </Pressable>
</View>
```

The hidden `Text` element changes content when `isListening` changes. Because the parent `View` has `accessibilityLiveRegion="polite"`, TalkBack announces the new content ("Listening") when it appears.

Note: `accessibilityLiveRegion` is Android-only. The existing `AccessibilityInfo.announceForAccessibility` call handles iOS VoiceOver. No change needed to the iOS path.

- [ ] **Step 3: Fix accessibilityState — change selected to checked**

Find the `Pressable` that has `accessibilityState={{ selected: isListening }}`. Change:

```typescript
// Before
accessibilityState={{ selected: isListening }}

// After — toggle button uses checked, not selected
accessibilityState={{ checked: isListening }}
```

Also verify `accessibilityRole`. If it's `"button"`, change to `"togglebutton"` if supported in RN 0.81 — check the React Native 0.81 release notes or test. If `"togglebutton"` causes an error, revert to `"button"` and keep the `checked` state.

- [ ] **Step 4: Run tests**

```bash
npm run test:run
```

Expected: all tests pass. If a snapshot test asserts `accessibilityState={{ selected: ... }}`, update it.

- [ ] **Step 5: Commit**

```bash
git add client/components/coach/CoachMicButton.tsx
git commit -m "fix(a11y): add TalkBack live region to CoachMicButton; use checked not selected state"
```

---

## Task 3: Add accessible labels to InlineChart stat_row

**Files:**

- Modify: `client/components/coach/blocks/InlineChart.tsx:53–76`

- [ ] **Step 1: Read the stat_row render section**

Read lines 53–76 of `client/components/coach/blocks/InlineChart.tsx` to understand the props available (label, value, target, hit) for building the accessibility label.

- [ ] **Step 2: Write a snapshot test that checks the accessibilityLabel**

In the corresponding test file (find with `find client -name "*InlineChart*test*" -o -name "*InlineChart*.test.*"`), add:

```typescript
it("stat_row variant has an accessibilityLabel on the container", () => {
  const block = {
    type: "inline_chart" as const,
    chartType: "stat_row" as const,
    title: "Nutrition Summary",
    data: [
      { label: "Calories", value: 2300 },
      { label: "Protein", value: 165 },
      { label: "Fat", value: 45 },
      { label: "Carbs", value: 72 },
    ],
  };
  const { getByLabelText } = render(<InlineChart block={block} />);
  // Should find the container by a label that includes the stat values
  expect(getByLabelText(/2300/)).toBeTruthy();
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npm run test:run -- client/components/coach/blocks
```

Expected: the accessibilityLabel test fails.

- [ ] **Step 4: Add accessibilityLabel to the stat_row container**

In `client/components/coach/blocks/InlineChart.tsx`, find the stat_row branch. Add `accessibilityLabel` to the outer container View, built from the data:

```typescript
// Inside the stat_row branch:
const statSummary = data
  .map((d) => `${d.label}: ${d.value}`)
  .join(", ");

return (
  <View
    accessibilityLabel={`${title}. ${statSummary}`}
    accessible={true}
  >
    {/* Individual stat Text elements — hide from a11y tree to prevent double-reading */}
    {data.map((d, i) => (
      <View key={i} accessible={false} importantForAccessibility="no-hide-descendants">
        {/* ... existing stat row content ... */}
      </View>
    ))}
  </View>
);
```

`importantForAccessibility="no-hide-descendants"` (Android) hides the children. For iOS, add `accessibilityElementsHidden={true}` on each child `View`.

- [ ] **Step 5: Run tests**

```bash
npm run test:run -- client/components/coach/blocks
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add client/components/coach/blocks/InlineChart.tsx
git commit -m "fix(a11y): add accessibilityLabel to InlineChart stat_row container"
```

---

## Task 4: Replace hardcoded #008A38 in ActionCard with theme.success

**Files:**

- Modify: `client/components/coach/blocks/ActionCard.tsx:63, 87, 117`

- [ ] **Step 1: Read the component to locate all hardcoded color instances**

```bash
grep -n "#008A38\|#FFFFFF\|theme\." client/components/coach/blocks/ActionCard.tsx
```

Note which lines have `#008A38` (should be lines 63, 87, 117 per the review) and which `#FFFFFF` instances are intentional (white text on colored button = safe as `theme.buttonText`).

- [ ] **Step 2: Replace #008A38 with theme.success**

In `client/components/coach/blocks/ActionCard.tsx`:

1. Ensure `useTheme()` is called and `theme` is destructured (it should already be, since this is a themed component).

2. Replace each `#008A38` instance:

```typescript
// Before (wherever #008A38 appears — confirm exact context from Step 1):
color: "#008A38";
// or
backgroundColor: "#008A38";

// After:
color: theme.success;
// or
backgroundColor: theme.success;
```

Since `#008A38` appears in static `StyleSheet.create` blocks, those styles cannot use theme values directly. Move the affected style properties to inline styles or use the `style` array approach:

```typescript
// Before (in StyleSheet.create):
successText: { color: "#008A38" }

// After — remove from StyleSheet, apply inline:
<Text style={[styles.someText, { color: theme.success }]}>
```

Do not change `#FFFFFF` instances that represent white text on colored buttons — these correspond to `theme.buttonText` but since they are in static styles, confirm they match `theme.buttonText` value (`#FFFFFF`) before leaving them.

- [ ] **Step 3: Run linter (pre-commit hook will catch remaining hardcoded colors)**

```bash
npm run lint
```

The pre-commit lint-staged hook checks for hardcoded colors in `.tsx` files. Verify no `#008A38` remains.

- [ ] **Step 4: Run tests**

```bash
npm run test:run
```

Expected: all tests pass. If a snapshot test shows the hardcoded color, update the snapshot.

- [ ] **Step 5: Commit**

```bash
git add client/components/coach/blocks/ActionCard.tsx
git commit -m "fix(a11y): replace hardcoded #008A38 in ActionCard with theme.success"
```
