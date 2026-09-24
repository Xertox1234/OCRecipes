---
title: A capture handed off via navigate() must not be tracked by the sender — the receiver owns cleanup
track: knowledge
category: conventions
module: client
tags: [react-native, navigation, camera, cleanup, ownership]
applies_to: [client/screens/**/*.tsx]
created: '2026-09-24'
---

# A capture handed off via navigate() must not be tracked by the sender — the receiver owns cleanup

## Rule

When screen A captures a temp file and hands it to screen B via `navigation.navigate(B, { uri })`, screen A must **never** track that URI in its own abandon-cleanup mechanism (a "delete anything still pending on blur/unmount" ref/effect). Screen B — the receiver — owns the file's cleanup from the moment it receives it.

This is the inverse of the more common failure mode (forgetting to release a transferred URI, leaking it — see `docs/solutions/logic-errors/expo-file-system-root-deleteasync-is-a-throwing-stub-2026-09-24.md`'s sibling findings). This rule guards the opposite mistake: **tracking a URI you are about to hand away**, which does not leak the file — it actively **deletes it out from under the receiver**.

## Why

`navigate()` pushes screen B onto the stack; screen A does not unmount, but it does **blur**. If screen A has a blur-triggered (or focus-effect-triggered) abandon-cleanup that deletes anything still in its own pending-URI set, and screen A tracked the URI it just handed to B, that cleanup fires the instant the blur is detected — often before screen B has finished reading, displaying, or uploading the file. Track-then-release-in-the-same-callback does not fix this either: any window between "track" and "release" (an `await`, or simply the blur effect running before the release call, depending on effect ordering) is enough for the abandon-cleanup to win the race.

The correct pattern is: **the sender never tracks a URI it captures purely to hand off** for a screen it navigates to (as opposed to a URI it retains ownership of across a multi-step flow, e.g. `ScanScreen`'s own `nutritionImageUri`/`frontImageUri`, which the sender legitimately tracks and only releases at the exact moment of a later hand-off — see `onEditStep2`/`onEditStep3`/`onSmartPhotoConfirm`'s navigate case in `ScanScreen.tsx`). The receiving screen adds its own cleanup (typically an unmount-only `useEffect` — see `docs/solutions/logic-errors/expo-file-system-root-deleteasync-is-a-throwing-stub-2026-09-24.md`'s `LabelAnalysisScreen.tsx`/`FrontLabelConfirmScreen.tsx` examples) keyed on the URI it received.

## Examples

```typescript
// BAD — ScanScreen tracks the front-label capture, then navigates away.
// ScanScreen blurs immediately; its abandon-cleanup fires and deletes the
// file before FrontLabelConfirmScreen can display or upload it.
const photo = await cameraRef.current?.takePicture();
trackTempUri(photo.uri); // <-- wrong: this is a pure hand-off, not retained ownership
navigation.navigate("FrontLabelConfirm", { imageUri: photo.uri, ... });
```

```typescript
// GOOD — ScanScreen never tracks it (mirrors the sibling isLabelMode branch).
// FrontLabelConfirmScreen owns cleanup via its own unmount-only effect.
const photo = await cameraRef.current?.takePicture();
navigation.navigate("FrontLabelConfirm", { imageUri: photo.uri, ... });

// In FrontLabelConfirmScreen.tsx:
useEffect(() => {
  return () => {
    deleteAsync(imageUri, { idempotent: true }).catch(() => {});
  };
}, [imageUri]);
```

```typescript
// GOOD — a URI the sender legitimately retains ownership of across a
// multi-step flow releases it only at the exact hand-off point, and only
// for the destinations whose params actually carry it (ScanScreen.tsx's
// onSmartPhotoConfirm navigate case): ReceiptCapture/NutritionDetail never
// receive the URI, so it stays tracked and the sender's OWN abandon-cleanup
// (triggered by this navigate's blur) deletes it — correctly, since nothing
// else ever will.
switch (action.route.screen) {
  case "LabelAnalysis":
    releaseTempUri(imageUri); // ownership transfers — LabelAnalysis deletes it
    navigation.navigate("LabelAnalysis", action.route.params);
    break;
  case "NutritionDetail":
    // no releaseTempUri here — NutritionDetail's params never carry imageUri
    navigation.navigate("NutritionDetail", action.route.params);
    break;
}
```

## Exceptions

None identified — a screen that legitimately retains a URI across its own multi-step flow (rather than a pure single-capture hand-off) should release it at the precise point of hand-off, not track it defensively "just in case," and only for destinations that actually receive it in their params.

## Related Files

- `client/screens/ScanScreen.tsx` — the `pendingTempUrisRef`/`trackTempUri`/`releaseTempUri` mechanism (lines ~174-193); the front-label capture branch in `onShutterPress` (~573-591) deliberately does not track, matching this rule
- `client/screens/FrontLabelConfirmScreen.tsx` — the receiver-owned unmount-only cleanup effect
- `client/screens/LabelAnalysisScreen.tsx` — the original precedent for receiver-owned unmount-only cleanup

## See Also

- [expo-file-system root deleteAsync is a throwing stub](../logic-errors/expo-file-system-root-deleteasync-is-a-throwing-stub-2026-09-24.md)
- [navigate() vs replace() in modal flows](navigate-vs-replace-modal-flows-2026-05-13.md)
