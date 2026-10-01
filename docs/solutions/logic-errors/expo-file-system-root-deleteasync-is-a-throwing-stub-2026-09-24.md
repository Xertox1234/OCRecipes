---
title: "expo-file-system root deleteAsync is a throwing stub in SDK 54 — import from expo-file-system/legacy"
track: bug
category: logic-errors
tags: [react-native, hooks, expo-file-system, camera, file-cleanup]
module: client
applies_to: [client/hooks/**/*.ts, client/lib/**/*.ts, client/screens/**/*.tsx]
symptoms: [Temp capture file is never deleted even though a deleteAsync cleanup call exists and appears to run, A console.warn about a deprecated expo-file-system import appears with no other visible effect, A cleanup effect wrapped in .catch(() => {}) never throws or logs anything yet the file remains on disk]
created: '2026-09-24'
severity: medium
last_updated: '2026-09-24'
---

# expo-file-system root deleteAsync is a throwing stub in SDK 54 — import from expo-file-system/legacy

## Problem

`import * as FileSystem from "expo-file-system"; FileSystem.deleteAsync(uri, { idempotent: true })` looks correct and has shipped in this codebase for months, but it never deletes anything. The call always throws, and if it's wrapped in a bare `.catch(() => {})` (a common pattern for "best-effort cleanup"), the failure is completely silent.

## Root Cause

Expo SDK 54 shipped `expo-file-system` v19 with a new `File`/`Directory` class-based API as the package's root export. The old function-style API (`deleteAsync`, `getInfoAsync`, `moveAsync`, etc.) was moved to a separate `expo-file-system/legacy` subpath — but the root package still re-exports the OLD NAMES as deliberate throwing stubs, not as removed exports, so `import { deleteAsync } from "expo-file-system"` type-checks and autocompletes fine:

```ts
// node_modules/expo-file-system/src/legacyWarnings.ts:62-64 (v19.0.22)
export async function deleteAsync(fileUri: string, options: DeletingOptions = {}): Promise<void> {
  throw errorOnLegacyMethodUse('deleteAsync');
}
```

`errorOnLegacyMethodUse` does a `console.warn` (easy to miss in a busy RN log stream) and then throws an `Error`. Every legacy-named function on the root export — `getInfoAsync`, `readAsStringAsync`, `writeAsStringAsync`, `moveAsync`, `copyAsync`, `makeDirectoryAsync`, `readDirectoryAsync`, `uploadAsync`, `downloadAsync`, etc. — is stubbed the same way (`node_modules/expo-file-system/build/legacyWarnings.d.ts` lists all of them with `@deprecated ... This method will throw in runtime.` in their doc comments). Confirmed against the installed version: `node_modules/expo-file-system/package.json` reports `"version": "19.0.22"`, paired with `"expo": "^54.0.23"` in this project's `package.json`.

`client/hooks/usePhotoAnalysis.ts:6` had exactly this bug — `import * as FileSystem from "expo-file-system";` then `FileSystem.deleteAsync(imageUri, { idempotent: true }).catch(() => {})` at line 112, inside a `useFocusEffect` cleanup. The call threw on every invocation since SDK 54 landed; the bare `.catch(() => {})` hid it completely, so the screen's "cleanup" never freed a single temp photo. Its own test (`client/hooks/__tests__/usePhotoAnalysis.test.ts`) mocked `useFocusEffect` as a no-op (`() => {}`), so the broken cleanup path was never even executed in CI — the bug had zero test coverage in either direction. Fixed 2026-09-24 (see Related Files).

## Solution

Import the function-style API from the `/legacy` subpath, not the package root:

```ts
import { deleteAsync } from "expo-file-system/legacy";

deleteAsync(uri, { idempotent: true }).catch((err) => {
  logger.error("[MyScreen] temp file delete failed", err);
});
```

This is the pattern already used correctly elsewhere in this codebase — `client/lib/image-compression.ts:2` (`import { getInfoAsync, deleteAsync } from "expo-file-system/legacy";`) and the three screens fixed alongside this bug (`client/screens/ScanScreen.tsx`, `client/screens/ReceiptCaptureScreen.tsx`, `client/screens/LabelAnalysisScreen.tsx`, all fixed 2026-09-24) all import from `/legacy`.

If migrating to the new class-based API instead: `new File(uri).delete()` is synchronous and throws if the path doesn't exist — it has no built-in `idempotent` option, so a manual `if (new File(uri).exists) { ... }` guard (or a try/catch) is required to match the old idempotent behavior.

## Prevention

- Never import a function-style filesystem call (`deleteAsync`, `getInfoAsync`, `moveAsync`, `copyAsync`, `uploadAsync`, `downloadAsync`, etc.) from the bare `"expo-file-system"` specifier on Expo SDK 54+ — always use `"expo-file-system/legacy"` for the legacy functional API, or migrate fully to the `File`/`Directory` class API.
- Never wrap a `deleteAsync`/cleanup call in a bare `.catch(() => {})` with no logging — this exact bug shipped invisibly for months because the swallow hid a 100%-failure-rate call. Log the rejection (`logger.error` / `logger.warn`) even for best-effort cleanup; a silent catch turns "always fails" and "rarely fails" into the same signal (none).
- A mock that replaces the effect hook itself (`vi.mock("@react-navigation/native", () => ({ useFocusEffect: () => {} }))`) never executes the cleanup closure passed to it — this hides bugs inside that closure from the entire test file. If a cleanup effect's behavior matters, invoke the real hook and assert on the cleanup call directly (e.g. render, then `unmount()`, then assert the mocked `deleteAsync` was called).

## Related Files

- `client/hooks/usePhotoAnalysis.ts` — fixed instance (2026-09-24, follow-up todo); now imports `deleteAsync` from `expo-file-system/legacy`
- `client/hooks/__tests__/usePhotoAnalysis.test.ts` — now mocks `useFocusEffect` with a real `React.useEffect(cb, [cb])` (not a no-op) and asserts the `/legacy` `deleteAsync` mock is called on unmount
- `client/lib/image-compression.ts` — the correct `/legacy` import pattern
- `client/screens/ScanScreen.tsx` — fixed instance (2026-09-24)
- `client/screens/ReceiptCaptureScreen.tsx` — fixed instance (2026-09-24)
- `client/screens/LabelAnalysisScreen.tsx` — fixed instance (2026-09-24)
- `client/screens/FrontLabelConfirmScreen.tsx` — fixed instance (2026-09-24, follow-up todo); added an unmount-only cleanup effect for its captured `imageUri`

## See Also

- [compress-upload-cleanup-for-image-uploads](../design-patterns/compress-upload-cleanup-for-image-uploads-2026-05-13.md)
