---
title: accessibilityViewIsModal hides portal-rendered BottomSheetModal from VoiceOver
track: bug
category: logic-errors
module: client
severity: high
tags: [accessibility, voiceover, bottom-sheet, modal, react-native, portal]
symptoms: [VoiceOver cannot reach a BottomSheetModal even though it is visible on screen, Screen reader skips over modal content when the screen container has accessibilityViewIsModal=true]
applies_to: [client/hooks/useConfirmationModal.ts, client/components/**/*BottomSheet*.tsx]
created: '2026-03-25'
---

# accessibilityViewIsModal hides portal-rendered BottomSheetModal from VoiceOver

## Problem

`@gorhom/bottom-sheet`'s `BottomSheetModal` renders content via a React Native portal — the native view lives outside the normal component tree. When a screen's main container has `accessibilityViewIsModal={true}` and the `<ConfirmationModal />` is placed as a sibling outside that container, VoiceOver cannot reach the bottom sheet content. `accessibilityViewIsModal` tells VoiceOver to ignore everything outside its container, and React tree placement (not the native portal target) determines that scope.

## Symptoms

- Bottom sheet renders visually, but VoiceOver focus never lands on it
- Two-finger swipe skips the modal content entirely
- Only screen-level content (outside the modal) is reachable to the screen reader

## Root Cause

Portal-rendered components still respect their React tree position for accessibility. The accessibility tree is built from the React tree, not the native view hierarchy. A sibling placement puts the modal outside the "modal scope" defined by `accessibilityViewIsModal`.

## Solution

Place the `<ConfirmationModal />` **inside** the `accessibilityViewIsModal` container:

```tsx
// Bad — ConfirmationModal is a sibling, VoiceOver can't reach it
<View accessibilityViewIsModal>
  {/* screen content */}
</View>
<ConfirmationModal />

// Good — inside the modal container
<View accessibilityViewIsModal>
  {/* screen content */}
  <ConfirmationModal />
</View>
```

## Prevention

- Always test VoiceOver after adding `accessibilityViewIsModal` — it can silently hide portaled content.
- When a hook returns a renderable modal component, document where it must be placed in the JSX tree.

## Related Files

- `client/hooks/useConfirmationModal.ts`
- `docs/legacy-patterns/react-native.md` — "Modal Focus Trapping" pattern (portal caveat documented)

## See Also

- [@gorhom/bottom-sheet portal documentation](https://gorhom.dev/react-native-bottom-sheet/portals)
