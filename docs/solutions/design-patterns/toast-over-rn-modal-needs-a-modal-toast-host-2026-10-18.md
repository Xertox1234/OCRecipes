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

`Toast` clears `useSafeAreaInsets().top`, read from the ROOT provider. A `pageSheet` (and a default Android `Modal`) is laid out below the status bar, so that inset is wrong inside it: the toast landed ~60 px down, on the sheet's title row. `ModalToastHost` passes `topInset={0}` and `Toast` uses `topInset ?? insets.top`. Do not fix this with a nested `SafeAreaProvider`: it seeds its state from the parent insets and only corrects after the native measurement, so the first frame still jumps. A `fullScreen`/`overFullScreen` or `statusBarTranslucent` Modal does sit under the status bar and would need the inset back.

## Limit

A host mounting or unmounting while a toast is live remounts the `Toast`: one extra announcement and a restarted dismiss timer. Tracked in `todos/P3-2026-10-18-toast-remount-across-modal-hosts-re-announces.md`.
