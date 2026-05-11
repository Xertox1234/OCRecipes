# React Native Rules

- Never pass functions or callbacks as route params — use event params or navigate + read-and-clear in `useEffect` (non-serializable params break state persistence and deep links)
- Always call `navigation.goBack()` immediately after `navigation.navigate()` when dismissing a `fullScreenModal` — `navigate()` alone leaves the modal on the stack
- Touch targets must be ≥ 44pt — add `hitSlop` for small controls (e.g., `hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}`)
- Always add `insets.bottom + Spacing.X` to the last-item padding in scrollable lists — bare `Spacing.X` clips content behind the home indicator on notched devices
- `KeyboardAvoidingView` behavior: `"padding"` on iOS, `"height"` on Android — never `undefined`
- Always spread `FLATLIST_DEFAULTS` from `@/constants/performance` on every `FlatList` component
- Camera: always set `isActive={isFocused}` on `CameraView` — stops the camera when navigating away
- Mic: always call `stopListening()` in session reset/cleanup — leaving it open mutates state after the component is gone
- `Alert.prompt` is iOS-only — always guard with `Platform.OS === "ios"` and provide a `TextInput` fallback for Android
- Never gate `Linking.openURL(httpUrl)` behind `Linking.canOpenURL` — `canOpenURL` returns false on iOS for HTTP(S) without `LSApplicationQueriesSchemes` entries and blocks legitimate links. Call `openURL` directly and `try/catch` the failure instead
