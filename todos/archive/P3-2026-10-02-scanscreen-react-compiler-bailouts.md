---
title: "ScanScreen stays skipped by React Compiler even without the #1226 lint directive — two try/finally blocks, a render-body ref write and value blocks inside try each opt it out; hoist the try bodies, wrap dispatch, shrink the bailout baseline"
status: done
priority: low
created: 2026-10-02
updated: 2026-10-05
assignee:
labels: [deferred, performance, camera]
github_issue:
---

# ScanScreen: make it compile under React Compiler

## Summary

React Compiler skips 79 files, and `client/screens/ScanScreen.tsx` is one of them (`scripts/react-compiler-bailout-baseline.json:71`). The triage code-fix bundle removes its eslint-disable directive. Even then, three more kinds of code each opt the whole component out: two `try`/`finally` blocks, a ref written in the render body, and conditional, logical or optional-chaining "value blocks" inside a `try`. Rewrite them with fixes (a)-(d) below, which the probe confirms reach `ok = 1`. Add the missing double-tap and frame-burst tests, then shrink the baseline with the ratchet's `--update-baseline`.

## Background

- Noticed during the `/todo` sweep PR #1226. That PR added `// eslint-disable-next-line react-hooks/exhaustive-deps` at `ScanScreen.tsx:321`, and its archived todo says the compiler work "needs to fix the `try` AND remove the directive" (`todos/archive/P3-2026-10-01-local-lint-types-scan-gitignored-docs-dirs.md:67`).
  - Verified 2026-10-02 against main `ec26b972` and upheld by an adversarial re-check. The re-check showed those two fixes are NOT enough to make the file compile.
  - Deferred because it is about half a day of careful work on a hot camera screen, outside #1226's scope.
- The pinned `babel-plugin-react-compiler@1.0.0` stops lowering a function at its first error (`scripts/check-react-compiler-bailouts.js:26-33`). Each fix therefore reveals the next cause. In the order they surface (ec26b972 lines):
  1. `Suppression` at 321. The bundle removes it (see Dependencies).
  2. `Todo: Handle TryStatement without a catch clause` at 562 in `onShutterPress` (538-691; the triage record calls it "handleCapture") and at 951 in the inline `onSmartPhotoConfirm` prop (946-1052).
  3. `Refs: Cannot access refs during render` at 166, `scanPhaseRef.current = scanPhase;` (there since cc67c76d, #46). `docs/rules/hooks.md:5` forbids exactly this and says to wrap the setter instead.
  4. `Todo: Support value blocks … within a try/catch statement` at 426 and 453-455 (inside `fetchProductInfo`'s try) and at 604 and 663 (OCR tries inside `onShutterPress`).
- Re-measured for this todo on 2026-10-02 with the probe below. The edits were applied in memory; nothing was written.

  | File probed                                                           | Result                           |
  | --------------------------------------------------------------------- | -------------------------------- |
  | HEAD                                                                  | `Suppression` at 321, `ok = 0`   |
  | The bundle's file                                                     | only the two TryStatement errors |
  | HEAD with the bundle's edit, or the bundle's file, plus fixes (a)-(d) | `ok = 1`, no other events        |

  Without the try hoists the two TryStatement errors remain; removing the wrapper, the `fetchProductInfo` hoist or either OCR rewrite from the full set brings back the error it fixes.

- Owner ruling (2026-10-02): the simulator review waits for a session with the owner present.
- No visible defect today, but `onBarcodeScanned` runs at camera-frame rate and every manual memo in a skipped file is load-bearing (`docs/rules/hooks.md:10`). The owner's gitignored 2026-10-01 diagnosis reached the same recipe but predates #1226 and omits `Suppression`; this todo puts the cause list in the tracked tree.

## Acceptance Criteria

- [x] Pre-flight (see Dependencies). All three must hold, otherwise stop and report that the bundle has not merged:
  - `grep -c eslint-disable client/screens/ScanScreen.tsx` prints `0`;
  - the SESSION_COMPLETE effect's deps list `haptics,` (not `haptics.notification,`);
  - the probe prints exactly the two TryStatement errors.
- [x] Red, recorded in the PR before any production edit: the probe prints `ok = 0` for ScanScreen and `ok = 1` for the control `client/components/ThemedText.tsx`.
- [x] Characterization tests (a)-(c) from the Notes (shutter double tap + re-arm; shutter re-arm after a failed capture; smart-confirm double tap, busy state and re-arm) are added to `client/screens/__tests__/ScanScreen.test.tsx` FIRST. They pass on the unrefactored file and still pass after the refactor.
- [x] Red-green test (d) for the dispatch wrapper (seven barcode frames in ONE synchronous `act` lock the barcode). It FAILS on the unrefactored file; record that failure. If it passes there, the burst never reached the stale-ref state: stop and report, and do not weaken the test. It passes after the refactor.
- [x] After the four fixes, the probe prints `ok = 1 | non-success = 0` for ScanScreen.
- [x] `dispatch` is listed in the six deps arrays named in fix (b), and the push gate's type-aware ESLint reports nothing for the file. No `eslint-disable` of any kind is added: a react-hooks one brings back the `Suppression` bailout.
- [x] `npx vitest run client/screens/__tests__/ScanScreen.test.tsx` passes with every existing test unchanged, including the ones that exercise this code: the first-render barcode-lock test, the confirm-card haptic pair, the `fetchProductInfo` liveness pair, the two `onSmartPhotoConfirm` navigate tests, and the front-label, label-mode and OCR-text tests.
- [x] Baseline:
  - `node scripts/check-react-compiler-bailouts.js` lists ScanScreen under "no longer bail out (fixed!)".
  - After `--update-baseline`, `git diff scripts/react-compiler-bailout-baseline.json` is exactly one removed line, `"client/screens/ScanScreen.tsx",` (79 → 78 entries). Surface any other diff line in the PR as a separate finding.
  - A re-run without flags exits 0 with "0 new".
- [x] The "Render-time mirror" comment at 163-165 is rewritten for the wrapper, and says the wrapper relies on `scanPhaseReducer` staying pure.
- [ ] Owner-present simulator review (owner request 2026-10-02; never unattended, never handed to the owner alone). On the iOS Simulator dev build, which runs the compiler (`app.json:61`), press the shutter in default and label mode: once, twice rapidly, and again after the outcome is dismissed. The simulator has no camera (`client/camera/components/CameraView.ios.tsx:211-213` shows "Camera unavailable"), so each capture is expected, not yet observed, to end in the "Capture failed" alert via `takePicture` returning `null`. Pass = one outcome per double tap and a shutter that responds again; record what was seen in the PR. Without the owner, leave this box unchecked and say so.

## Implementation Notes

- **Line numbers** are at `ec26b972`. The bundle deletes line 321 (its 329-334 comment rewrite keeps the count), so after it merges every line from 322 on moves up by one; its test-file change is comment-only and count-neutral. Find code by the quoted text.
- **Probe.** Run it from the repo root; it writes nothing. Same preset/plugin stack as `isBailout()` (`scripts/check-react-compiler-bailouts.js:138-164`), but it prints every event. Loop: probe, fix the construct it reports, probe again.

  ```sh
  node --input-type=module -e '
  import { createRequire } from "module";
  const require = createRequire(process.cwd() + "/package.json");
  const babel = require("@babel/core");
  for (const file of process.argv.slice(1)) {
    let ok = 0; const bad = [];
    babel.transformFileSync(file, {
      babelrc: false, configFile: false,
      presets: [[require.resolve("@babel/preset-typescript"), { isTSX: true, allExtensions: true }]],
      plugins: [[require.resolve("@babel/plugin-syntax-jsx")], [require.resolve("babel-plugin-react-compiler"), {
        logger: { logEvent: (_f, e) => {
          if (e.kind === "CompileSuccess") ok++;
          else bad.push(`${e.kind} ${e.detail?.category ?? ""} | ${e.detail?.reason ?? e.reason ?? e.data ?? ""} | line=${e.detail?.primaryLocation?.()?.start.line ?? e.loc?.start.line}`);
        } } }]],
    });
    console.log(file, "ok =", ok, "| non-success =", bad.length); bad.forEach((b) => console.log("  ", b));
  }' client/components/ThemedText.tsx client/screens/ScanScreen.tsx
  ```

- **(a) Both try/finally blocks: move the body into an inner async function, and reset after a catch that rethrows.** Do NOT just add a catch to the existing `try`. The body would then sit inside a try/catch, which raises `Support ThrowStatement inside of try/catch` (for the exhaustiveness throws at 1014 and 1043) and more value-block errors (564, 575).

  ```ts
  isCapturingRef.current = true;
  const runCapture = async () => {
    /* 563-680 unchanged */
  };
  try {
    await runCapture();
  } catch (err) {
    isCapturingRef.current = false;
    throw err;
  }
  isCapturingRef.current = false;
  ```

  - Do the same at 951-1051 with `runSmartConfirm`, resetting `isConfirmingRef` and calling `setIsSmartConfirming(false)` on both the success and the error path.
  - Move line 952, `const { classification, imageUri } = scanPhase;`, above the inner function. TypeScript's `SMART_CONFIRMED` narrowing from line 947 then does not need to carry into a nested function.
  - A `return` inside the body now returns from the inner function, and the reset still runs. The reset now fires one await tick later than the `finally` did. Tests (a)-(c) pin that timing.
  - The catch only preserves the old behaviour for an unexpected throw. `takePicture` returns `null` instead of throwing (`client/camera/components/CameraView.tsx:157-175`), and the OCR and upload awaits are already caught inside the body.

- **(b) Replace the render-body ref write with a dispatch wrapper** (the "wrap the setter" shape from `docs/rules/hooks.md:5`). At line 133, rename the reducer's dispatch: `const [scanPhase, rawDispatch] = useReducer(…)`. Then add this after line 162:

  ```ts
  const dispatch = useCallback((action: ScanAction) => {
    scanPhaseRef.current = scanPhaseReducer(scanPhaseRef.current, action);
    rawDispatch(action);
  }, []);
  ```

  - Import `type ScanAction` from `@/camera/types/scan-phase` (`client/camera/types/scan-phase.ts:121`; `client/screens/scan-screen-utils.ts` already imports that module). Then delete line 166.
  - Every call site keeps the name `dispatch`. That includes `useAutoAdvanceTimer` at 343, whose deps (`client/camera/hooks/useAutoAdvanceTimer.ts:31`) see a stable value.
  - The exhaustive-deps rule only treats useReducer's own dispatch as stable. Add `dispatch` to the deps arrays at 201, 220, 376, 464, 535 and 684-691.
  - With those six added, the repo's type-aware ESLint config reported 0 messages through `--stdin` (an injected floating-promise control was flagged), and the probe stayed at `ok = 1`.
  - The wrapper runs the reducer a second time for each action. That is only safe while `client/camera/reducers/scan-phase-reducer.ts` stays pure; a grep for `Date.now`, `Math.random`, logging, `fetch`, `await` and `.current` finds nothing in it.
  - Both the wrapper and React call the test file's reducer mock (`ScanScreen.test.tsx:211-237`), so it needs no change.

- **(c) `fetchProductInfo`:** move lines 421-458 into `const loadProduct = async () => { … }`, leaving `try { await loadProduct(); } catch (err) { /* 460-461 */ }`. Timing does not change.
- **(d) OCR value blocks:** line 604 becomes `if (ocrResult.text) localOCRText = ocrResult.text;` and line 663 becomes `if (ocrResult.text != null) ocrText = ocrResult.text;`. Given the starting values at 601 and 660, both behave exactly as before. `LocalOCRResult.text` is typed `string` (`client/camera/types.ts:27`), so the old `?? ""` was only a safety net, and the `!= null` check keeps it.
- **Tests.** The harness is at `ScanScreen.test.tsx:17-111`, and defaults are reset at 269-292. To hold a step open, use a deferred promise: `let release!: (v: T) => void;` then `mock.mockImplementationOnce(() => new Promise((r) => { release = r; }))`.
  - **(a)** Set `mockRouteParams.value = { mode: "label" }` and defer the capture. Click "Take photo" twice inside one `act`: `mockCapturePhotoToFile` is called once. Release it, and `navigate("LabelAnalysis", …)` follows. Click once more: it is called a second time. The shutter has no `disabled` prop (854-875), so only the ref guard can stop the second click.
  - **(b)** Use `mockCapturePhotoToFile.mockRejectedValueOnce(...)`. Expect `Alert.alert("Capture failed", "Please try again.")` (the mock's `Alert.alert` is a `vi.fn`, `test/mocks/react-native.ts:23`). The next click captures again.
  - **(c)** Set `mockFeatures.value = { menuScanner: true }` and return a classification with `contentType: "restaurant_menu"`, shaped like the one in the test at 1330. Defer `mockRecognizeText`; the menu path is the only confirm that waits on OCR.
    - Call `capturedPressProps["Confirm smart photo analysis"].onPress` (recorded at 244-267) twice inside one `act`; a plain click can be dropped by the TouchableOpacity mock's `disabled` handling (`test/mocks/react-native.ts:430`) before it reaches the ref guard.
    - Expect `mockRecognizeText` called once, and `aria-busy="true"` on the button (`client/camera/components/ProductChip.tsx:446-453`, mapped at `test/mocks/react-native.ts:439`).
    - Release it: expect exactly one `navigate("MenuScanResult", …)` and `aria-busy="false"`. One more call navigates again.
  - **(d)** Reuse the frame from the test at 637-677, but call the first-render handler seven times inside ONE `await act(async () => { … })`, with no await between calls.
    - Before the fix, every call reads the stale `HUNTING` written at render time and restarts tracking (`client/screens/scan-screen-utils.ts:237-238`), so it never locks.
    - With the wrapper, the frames add up and the barcode locks on the sixth (`scan-screen-utils.ts:221-245`).
    - Assert `mockApiRequest` was called with `("GET", "/api/nutrition/barcode/0778918011332")`.
- **Not measured here:** TypeScript and Vitest were not run on these shapes. Only the probe and ESLint were.

## Scope Contract

- **Mechanisms to use:** an inner async function for both try bodies and for `fetchProductInfo`; the setter-wrapper shape from `docs/rules/hooks.md:5` for `dispatch`; the two OCR rewrites; the ratchet's own `--update-baseline`; the `node -e` probe above (never committed); the existing `ScanScreen.test.tsx` harness and mocks.
- **Files in scope:** `client/screens/ScanScreen.tsx`, `client/screens/__tests__/ScanScreen.test.tsx`, `scripts/react-compiler-bailout-baseline.json`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- The triage code-fix bundle on branch `chore/triage-code-fixes-2026-10-02` must merge FIRST. It removes the eslint-disable directive at `ScanScreen.tsx:321` and makes the effect depend on the stable `haptics` object. The executor confirms the directive is gone before starting (the first AC).
- The last AC needs a session with the owner present.
- The compiler is pinned at `babel-plugin-react-compiler@1.0.0`; probe again after any version bump.

## Risks

- Hot camera screen, about half a day of careful work: `onBarcodeScanned` runs at camera-frame rate, and the shutter and smart confirm rely on synchronous ref guards.
- Moving the reset from `finally` to after the `await` makes the guards re-arm one await tick later. Each tap is a separate task, so this should be invisible. Tests (a)-(c) and the simulator check confirm it.
- With the wrapper, `scanPhaseRef` updates before React re-renders: `onBarcodeScanned` and `onShutterPress`'s `getCapturePlan` see the new phase immediately, and `isStillLive` (961-963) sees a RESET one render sooner. The 163-165 comment intends this and test (d) pins it, but it is a behaviour change.
- Vitest does not run the compiler (`docs/solutions/conventions/react-compiler-discards-unread-usememo-dependency-2026-09-02.md:72-79`). Tests prove behaviour, only the probe proves compilation, and the simulator session is where the compiled ScanScreen first runs.
- Once the file compiles, `docs/rules/hooks.md:10` applies. Every manual memo today only lists deps its body reads (370, 376, 464, 535, 684-691); keep it that way.
- No camera on the simulator: barcode lock and smart confirm rest on tests (a)-(d). A device pass needs a preview OTA, which is the owner's call and outside this todo.
- The PR changes `scripts/`, and `scripts/todo-automerge-guard.sh` always holds those changes for review: `SAFE_ALLOWLIST` (line 98) leaves `scripts/` out and `SENSITIVE_OVERRIDE` (line 181) lists it. So the PR cannot auto-merge before the owner-present review.

## Updates

### 2026-10-02

- Filed from the 2026-10-02 deferred-warnings triage of the /todo sweep (#1213–#1226); claim verified against main ec26b972 by workflow wf_7d969d8d-ce1 and upheld by an adversarial re-check; filing approved by the owner 2026-10-02.

### 2026-10-05

- Implemented by a /todo executor: probe red (ScanScreen ok = 0, two TryStatement errors; ThemedText control ok = 1) then green (ok = 1); test (d) failed on the unrefactored file (barcode never fetched) and passes after; (a)-(c) passed before and after. Baseline 79 to 78 entries (one removed line). Owner-present simulator review NOT done (needs the owner present); box left unchecked.
