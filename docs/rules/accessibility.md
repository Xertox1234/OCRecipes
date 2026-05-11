# Accessibility Rules

- All `fullScreenModal` and `modal` screens must have `accessibilityViewIsModal={true}` on the root container — VoiceOver navigates behind the modal without it
- Decorative icons inside labeled Pressables must have `accessible={false}` — VoiceOver double-focuses on icon + container otherwise
- `disabled` Pressable must set both `disabled={true}` and `accessibilityState={{ disabled: true }}` — TalkBack ignores the `disabled` prop alone
- Error messages must use `accessibilityLiveRegion="assertive"` not `"polite"` — use `InlineError` component, not `Alert.alert()`
- Async state transitions (success, error, limit-reached) must call `AccessibilityInfo.announceForAccessibility` on iOS, paired with `accessibilityLiveRegion="assertive"` on Android
- Radio buttons: use `accessibilityState={{ selected: bool }}` not `{{ checked: bool }}` — `checked` maps to checkbox semantics on TalkBack
- Radio chip rows need a `role="radiogroup"` wrapper `View`
- Progress bars need `accessibilityRole="progressbar"` + `accessibilityValue={{ min: 0, max: 100, now: value }}`
- Decorative emoji must be wrapped in a `Text` with `accessible={false}` — VoiceOver announces them literally otherwise
- `accessibilityLiveRegion` is Android-only — always pair with `AccessibilityInfo.announceForAccessibility()` for iOS coverage
- Badges that are purely decorative inside a parent with an `accessibilityLabel` need `accessible={false}` — prevents double-announcement
