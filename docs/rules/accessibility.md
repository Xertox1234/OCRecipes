# Accessibility Rules

- All `fullScreenModal` and `modal` screens must have `accessibilityViewIsModal={true}` on the root container — VoiceOver navigates behind the modal without it
- Decorative icons inside labeled Pressables must have `accessible={false}` — VoiceOver double-focuses on icon + container otherwise
- `disabled` Pressable must set both `disabled={true}` and `accessibilityState={{ disabled: true }}` — TalkBack ignores the `disabled` prop alone
- Error messages must use `accessibilityLiveRegion="assertive"` not `"polite"` — use `InlineError` component, not `Alert.alert()`
- Async state transitions (success, error, limit-reached) must call `AccessibilityInfo.announceForAccessibility` on iOS
- Radio buttons: use `accessibilityState={{ selected: bool }}` not `{{ checked: bool }}` — `checked` maps to checkbox semantics on TalkBack
- Radio chip rows need a `role="radiogroup"` wrapper `View`
- Progress bars need `accessibilityRole="progressbar"` + `accessibilityValue={{ min: 0, max: 100, now: value }}`
- Decorative emoji must be wrapped in a `Text` with `accessible={false}` — VoiceOver announces them literally otherwise
- `accessibilityLiveRegion` is Android-only — always pair with `AccessibilityInfo.announceForAccessibility()` for iOS coverage, but gate the announce call to `Platform.OS === "ios"` when the same element already has a live region (Android `TYPE_ANNOUNCEMENT` + live region = double-announce)
- Badges that are purely decorative inside a parent with an `accessibilityLabel` need `accessible={false}` — prevents double-announcement
- Never set `accessible={true}` on a banner/card wrapper that contains an interactive child (dismiss/CTA Pressable) — VoiceOver/TalkBack collapses children into one node and the button becomes unreachable. Put `accessibilityRole`/`accessibilityLabel` on the text node and let the Pressable stay its own a11y node
- Never apply `accessibilityRole="checkbox"` (or `"radio"`, `"switch"`) to a non-`Pressable` element — assistive tech announces the toggle affordance but the gesture does nothing. For visual-only status indicators, set `accessible={false}` + `importantForAccessibility="no"` and roll the state into a parent group's `accessibilityLabel` (e.g., "Accepted commitment: …" vs "Commitment: …")
