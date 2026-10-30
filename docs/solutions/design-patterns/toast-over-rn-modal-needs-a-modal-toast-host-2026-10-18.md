---
title: A toast fired while a React Native Modal sheet is open renders behind it — mount ModalToastHost inside the Modal
track: knowledge
category: design-patterns
module: client
tags: [react-native, toast, modal, ios, accessibility]
applies_to: [client/context/ToastContext.tsx, client/components/**/*Modal.tsx]
created: '2026-10-18'
---

# Toast over an RN `Modal`

## Rule

The root toast host lives in a `FullWindowOverlay`, which sits above native-stack modals but BELOW a React Native `<Modal>` (it presents its own view controller). Any RN `Modal` that can be open when a background event toasts (recipe ready, coach reply) must render `<ModalToastHost />` from `@/context/ToastContext` as the LAST child of its root view.

## Why it is safe

While any `ModalToastHost` is mounted the provider suppresses the root host, and only the last-registered host renders, so exactly one `Toast` (one live region, one announcement) exists. Hosts register by `useId`, not a module counter or ref (a ref read in render makes the React Compiler bail out). A hidden RN `Modal` renders null, so a closed modal registers nothing. Outside a provider the host renders null.

## Top inset inside the sheet

`Toast` clears `useSafeAreaInsets().top`, read from the ROOT provider. On iOS a `pageSheet` is laid out below the status bar, so that inset is wrong inside it: the toast landed ~60 px down, on the sheet's title row. `ModalToastHost` passes `topInset={0}` on iOS and `Toast` uses `topInset ?? insets.top`. Android is the opposite: it ignores `pageSheet` and opens a full-screen, edge-to-edge window that starts under the status bar, so there the host leaves `topInset` unset and the toast keeps the root inset (on an Android 16 phone, `0` put the toast text at y=72-131 px under a 101 px status bar; unset puts it at y=173-231 px, where the root toast sits). Do not fix this with a nested `SafeAreaProvider`: it seeds its state from the parent insets and only corrects after the native measurement, so the first frame still jumps. A `fullScreen`/`overFullScreen` or `statusBarTranslucent` Modal does sit under the status bar and would need the inset back. The same class hit the sheet header itself: `RecipeGenerationModal` padded its title row by `insets.top || Spacing.lg`, a 59 pt band on an iPhone 17 Pro; inside a pageSheet use the fixed token, as the two picker sheets already did.

## Host change mid-toast

A host mounting or unmounting while a toast is live remounts the `Toast` (the root overlay and a modal host are different subtrees), so the entering animation replays. Nothing else may depend on the mount: `ToastProvider`'s `show` announces the toast once (iOS-gated, next to the haptic; the Android live region on the message group covers that platform) and stamps `createdAt` on the queued item, and `Toast` counts its dismiss window from that stamp, not from its own mount effect. A sheet opening or closing mid-toast therefore neither re-announces the toast on iOS nor extends its visible time. Do not move the announcement back into a `Toast` effect.

## Limit

Whether TalkBack re-reads the remounted Android live region is still unverified (`todos/P3-2026-10-18-modal-toast-host-android-check.md`). To catch the toast on Android: freeze the server (`kill -STOP`) BEFORE sending a Coach message from the full chat screen (the Coach tab's inline chat never announces its reply), open the sheet, `kill -CONT`, and screenshot when `server.log` shows the POST complete. A change to `ToastContext.tsx` did not fast-refresh on the phone: force-stop and relaunch the app before judging.
