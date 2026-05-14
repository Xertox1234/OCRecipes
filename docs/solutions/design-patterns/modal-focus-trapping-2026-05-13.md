---
title: "Modal focus trapping with accessibilityViewIsModal"
track: knowledge
category: design-patterns
tags: [react-native, accessibility, modal, focus, voiceover]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# Modal focus trapping with accessibilityViewIsModal

## When this applies

Add `accessibilityViewIsModal` to the inner container of all modal components to prevent screen readers from accessing content behind the modal.

## Examples

```typescript
<Modal visible={visible} transparent animationType="slide">
  <View style={styles.overlay}>
    <KeyboardAvoidingView
      accessibilityViewIsModal   // on the inner focusable container
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      {/* modal content */}
    </KeyboardAvoidingView>
  </View>
</Modal>
```

## Why

Without this prop, VoiceOver/TalkBack can navigate to elements behind the modal overlay, confusing users and breaking the expected focus flow.

## Exceptions

**Portal-rendered modals (BottomSheetModal):** `BottomSheetModal` renders via a portal outside the normal component tree. If the parent screen has `accessibilityViewIsModal={true}` on its container and the `<ConfirmationModal />` is a sibling (outside that container), VoiceOver cannot reach the portal-rendered sheet. Place hook-returned modal components **inside** the `accessibilityViewIsModal` container, not as siblings.

## See Also

- [Drag handle for gesture-dismissible modals](drag-handle-gesture-dismissible-modals-2026-05-13.md)
- [Full-screen detail with transparentModal](full-screen-detail-transparent-modal-2026-05-13.md)
