# Expo SDK Upgrade — Step 0 (JavaScript-only prep on SDK 54) Implementation Plan

> **STATUS: SHIPPED — history, not instructions.** Checked 2026-11-22: `package.json` is on Expo SDK 58, so this prep step is long past. The current code and `docs/OWNER_RULINGS.md` win over anything below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the React Native 0.85/0.87 breaking APIs and pin foreground-notification behaviour while the app is still on SDK 54, so the later native steps carry no JavaScript rewrites and this step reaches the owner's phone over the air.

**Architecture:** One PR into `main`. Each removed API gets a single replacement (one deferral helper, one style constant), plus a lint rule that stops it coming back. The notification handler lives in `client/lib/notifications.ts` and is installed at module scope in `App.tsx`. `expo-doctor` becomes an information-only CI step.

**Tech Stack:** Expo SDK 54, React Native 0.81.5, expo-notifications 55.x, Vitest, ESLint flat config, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-21-expo-sdk-54-to-58-upgrade-design.md` (§3 Step 0, §9 ruling 2, §11)

## Global Constraints

- Runtime stays SDK 54 / RN 0.81.5. No dependency changes in this PR, and `runtimeVersion` stays `"1.5.0"`, because this step ships over the air to the existing build.
- Foreground notifications stay OFF (§9 ruling 2): no banner, no list entry, no sound, no badge change.
- Keep the ordering each `InteractionManager` call site depends on (spec step 0.2).
- Work in a worktree (`scripts/oc-worktree.sh`). Never `npm ci` in the main checkout while executors run.
- TDD: each task's test or lint check must fail before the change.

## Decisions made in this plan (planner's calls)

- **Deferral primitive = `setImmediate`, not `requestIdleCallback`.** On RN 0.81, `ReactNativeFeatureFlags.disableInteractionManager` defaults to `true` (`node_modules/react-native/src/private/featureflags/ReactNativeFeatureFlags.js:150`). So today's `runAfterInteractions` is already `InteractionManagerStub`, which runs the task in `setImmediate`. Using `setImmediate` keeps today's behaviour exactly. `requestIdleCallback` can be delayed under load. The spec named `requestIdleCallback` as one option; this plan picks the behaviour-identical one.
- **One seam module for the deferral.** `client/lib/run-after-transition.ts`. Tests mock this module instead of stubbing global `setImmediate`, because React's scheduler uses `setImmediate` under Node and stubbing it would break rendering.
- **One `AbsoluteFill` constant, not `StyleSheet.absoluteFill`.** `StyleSheet.absoluteFill` is typed `RegisteredStyle<AbsoluteFillStyle>` (`StyleSheet.d.ts:149`), so `...StyleSheet.absoluteFill` fails `tsc`, and 12 of the 13 sites spread it. A single constant in `client/constants/theme.ts` avoids 13 inline copies.

## Review Focus

1. Two fast taps on different rows of the add-item menu → only the first sheet opens. Covered by the existing `AddItemMenuSheet.test.tsx` guard test; it must stay green.
2. The add-item menu's late `onDismiss` fires after the deferred open → the newly opened sheet stays open. Covered by the existing `MealPlanHomeScreen.test.tsx` test, "a late onDismiss … does not clobber …", which must pass with the new mock (Task 1).
3. Quick Log camera button → Quick Log closes first, then Scan opens. The callback runs on Hermes on the device (global-API lesson: Hermes has no `crypto`, so verify `setImmediate` there). The new test is in Task 1; the device check is in Task 5.
4. A notification arrives while the app is open → nothing is shown. A notification tapped from the background still opens its deep link, because the handler doesn't touch the response listener in `client/navigation/linking.ts:184`. The test is in Task 3; the device check is in Task 5.
5. Full-screen overlays (camera overlay, progress and calorie rings, modal backdrops, toast fill) render the same as before. The constant has the same five keys (Task 2 test). Visual check on the device in Task 5.

---

### Task 1: Replace `InteractionManager.runAfterInteractions`

**Files:**

- Create: `client/lib/run-after-transition.ts`
- Create: `client/lib/__tests__/run-after-transition.test.ts`
- Modify: `client/screens/QuickLogScreen.tsx:11,176` (import and call)
- Modify: `client/screens/meal-plan/MealPlanHomeScreen.tsx:10,1005,1013,1029,1167` (import and 4 calls); comment at `:699`
- Modify: `client/components/meal-plan/AddItemMenuSheet.tsx:39` (comment only)
- Modify: `client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx:89-93,322-343,485-491` (replace the local `InteractionManager` mock)
- Modify: `client/components/meal-plan/__tests__/AddItemMenuSheet.test.tsx:67` (comment only)
- Modify: `client/screens/__tests__/QuickLogScreen.test.tsx` (new test)
- Modify: `eslint.config.js` (the existing `@typescript-eslint/no-restricted-imports` block for `client/**`, around line 143)

**Interfaces:**

- Produces: `runAfterTransition(task: () => void): void` from `@/lib/run-after-transition`. It schedules `task` with `setImmediate`, never runs it synchronously, and returns nothing (no call site uses the old handle).

- [ ] **Step 1: Write the failing helper test** in `client/lib/__tests__/run-after-transition.test.ts`

```ts
it("does not run the task synchronously", () => {
  const task = vi.fn();
  runAfterTransition(task);
  expect(task).not.toHaveBeenCalled();
});

it("runs the task on the next setImmediate turn", async () => {
  const task = vi.fn();
  runAfterTransition(task);
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(task).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Write the failing Quick Log ordering test** in `QuickLogScreen.test.tsx`. Hoist a `deferredTasks: (() => void)[]` array and a `mockNavigate`, then `vi.mock("@/lib/run-after-transition", () => ({ runAfterTransition: (t: () => void) => deferredTasks.push(t) }))`. Change the existing `useNavigation` mock so `navigate` is `mockNavigate`.

```ts
it("closes Quick Log before opening Scan from the camera button", () => {
  renderScreen();
  fireEvent.click(screen.getByLabelText("Take a photo to log food"));
  expect(mockGoBack).toHaveBeenCalledTimes(1);
  expect(mockNavigate).not.toHaveBeenCalled();
  deferredTasks.splice(0).forEach((t) => t());
  expect(mockNavigate).toHaveBeenCalledWith("Scan");
});
```

Use whatever render helper and Premium setup the file's existing tests use to reach the unlocked screen.

- [ ] **Step 3: Run both tests and confirm they fail**

Run: `npx vitest run client/lib/__tests__/run-after-transition.test.ts client/screens/__tests__/QuickLogScreen.test.tsx`
Expected: FAIL. The module can't be resolved, and the Quick Log test fails, either on the mock path or because the shared react-native mock has no `InteractionManager`.

- [ ] **Step 4: Add the lint ban.** In the existing `client/**` `@typescript-eslint/no-restricted-imports` block, add to `paths`:

```js
{
  name: "react-native",
  importNames: ["InteractionManager"],
  message:
    "InteractionManager is removed in React Native 0.87. Use runAfterTransition from @/lib/run-after-transition.",
},
```

Add it to that block. A second block with the same rule for the same files would _replace_ the first in flat config.

- [ ] **Step 5: Confirm the lint fails**

Run: `npx eslint client/screens/QuickLogScreen.tsx client/screens/meal-plan/MealPlanHomeScreen.tsx`
Expected: 2 errors naming `InteractionManager`.

- [ ] **Step 6: Implement `runAfterTransition`**, then replace the 5 calls and drop `InteractionManager` from both `react-native` imports. Update the two source comments and the `AddItemMenuSheet.test.tsx` comment so they name `runAfterTransition`. Keep their reasoning; only the mechanism's name changes.

- [ ] **Step 7: Move `MealPlanHomeScreen.test.tsx` onto the new seam.** Delete the local `InteractionManager` object and its export from the file's `react-native` mock. Add `vi.mock("@/lib/run-after-transition", () => ({ runAfterTransition: (cb: () => void) => interactionQueue.push(cb) }))`. Keep the `interactionQueue` hoisted array and `flushInteractions()` as they are, and update their comments.

- [ ] **Step 8: Run the affected tests and lint**

Run: `npx vitest run client/lib/__tests__/run-after-transition.test.ts client/screens/__tests__/QuickLogScreen.test.tsx client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx client/components/meal-plan/__tests__/AddItemMenuSheet.test.tsx && npx eslint client/screens client/components/meal-plan client/lib/run-after-transition.ts`
Expected: all PASS, 0 lint errors. `grep -rn "InteractionManager" client --include='*.ts' --include='*.tsx'` prints nothing.

- [ ] **Step 9: Commit**

```bash
git add client/lib/run-after-transition.ts client/lib/__tests__/run-after-transition.test.ts client/screens/QuickLogScreen.tsx client/screens/__tests__/QuickLogScreen.test.tsx client/screens/meal-plan/MealPlanHomeScreen.tsx client/screens/meal-plan/__tests__/MealPlanHomeScreen.test.tsx client/components/meal-plan/AddItemMenuSheet.tsx client/components/meal-plan/__tests__/AddItemMenuSheet.test.tsx eslint.config.js
git commit -F <msg-file>   # "Replace InteractionManager (removed in RN 0.87) with runAfterTransition"
```

---

### Task 2: Replace `StyleSheet.absoluteFillObject`

**Files:**

- Modify: `client/constants/theme.ts` (new export)
- Test: `client/constants/__tests__/theme.test.ts`
- Modify (13 uses): `client/context/ToastContext.tsx:225`, `client/camera/components/CameraView.ios.tsx:292`, `client/camera/components/CameraView.tsx:259`, `client/screens/CookSessionCaptureScreen.tsx:446`, `client/screens/QuickLogScreen.tsx:488`, `client/components/DeleteAccountModal.tsx:433`, `client/components/ChangeEmailModal.tsx:400`, `client/components/SpeedDial.tsx:196,200` (and the comment at `:104`), `client/components/ProgressRing.tsx:88`, `client/components/PasswordConfirmModal.tsx:167`, `client/components/CalorieRing.tsx:173`, `client/components/profile/ProfileCard.tsx:158`
- Modify: `eslint.config.js` (the Hermes `no-restricted-globals` block for `client/**`, around line 110)

**Interfaces:**

- Produces: `AbsoluteFill` from `@/constants/theme`, value `{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } as const`. It can be spread into a style and passed as a `style` prop.

- [ ] **Step 1: Write the failing test** in `theme.test.ts`

```ts
it("AbsoluteFill pins the element to all four edges", () => {
  expect(AbsoluteFill).toEqual({
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  });
});
```

- [ ] **Step 2: Add the lint ban** to the Hermes block's `rules`:

```js
"no-restricted-properties": [
  "error",
  {
    object: "StyleSheet",
    property: "absoluteFillObject",
    message: "Removed in React Native 0.85. Use AbsoluteFill from @/constants/theme.",
  },
],
```

- [ ] **Step 3: Run both and confirm they fail**

Run: `npx vitest run client/constants/__tests__/theme.test.ts; npx eslint client`
Expected: the test fails (`AbsoluteFill` is undefined), and ESLint reports 13 `no-restricted-properties` errors.

- [ ] **Step 4: Export `AbsoluteFill`** from `client/constants/theme.ts`. Replace each `...StyleSheet.absoluteFillObject` with `...AbsoluteFill`, and `ProgressRing.tsx:88`'s `style={StyleSheet.absoluteFillObject}` with `style={AbsoluteFill}`. Reword the `SpeedDial.tsx:104` comment. Drop `StyleSheet` from an import only where it becomes unused.

- [ ] **Step 5: Run the test, lint and types on the touched files**

Run: `npx vitest run client/constants/__tests__/theme.test.ts && npx eslint client && npx tsc --noEmit -p tsconfig.json`
Expected: PASS, 0 lint errors, 0 type errors. `grep -rn absoluteFillObject client` prints nothing.

- [ ] **Step 6: Commit** — "Replace StyleSheet.absoluteFillObject (removed in RN 0.85) with AbsoluteFill"

---

### Task 3: Pin foreground-notification behaviour

**Files:**

- Modify: `client/lib/notifications.ts` (new export)
- Test: `client/lib/__tests__/notifications.test.ts`
- Modify: `test/mocks/expo-notifications.ts` (add `setNotificationHandler`)
- Modify: `client/App.tsx` (module-scope call, beside the `setupNotificationChannel` import at line 44)

**Interfaces:**

- Produces: `installForegroundNotificationHandler(): void` in `@/lib/notifications`. It calls `Notifications.setNotificationHandler` once, with a `handleNotification` that resolves to all four flags `false` for every notification.

- [ ] **Step 1: Write the failing test.** Add `setNotificationHandler: (...a: unknown[]) => setNotificationHandler(...a)` to the file's `vi.mock("expo-notifications")` factory, with a hoisted `vi.fn()`.

```ts
describe("installForegroundNotificationHandler", () => {
  it("hides every notification that arrives while the app is open", async () => {
    installForegroundNotificationHandler();
    expect(setNotificationHandler).toHaveBeenCalledTimes(1);
    const { handleNotification } = setNotificationHandler.mock.calls[0][0];
    for (const data of [
      {},
      { type: "coach-reply" },
      { url: "ocrecipes://plan" },
    ]) {
      await expect(
        handleNotification({ request: { content: { data } } }),
      ).resolves.toEqual({
        shouldShowBanner: false,
        shouldShowList: false,
        shouldPlaySound: false,
        shouldSetBadge: false,
      });
    }
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `npx vitest run client/lib/__tests__/notifications.test.ts`
Expected: FAIL, `installForegroundNotificationHandler` is not a function.

- [ ] **Step 3: Implement it.** Add `export const setNotificationHandler = () => {};` to `test/mocks/expo-notifications.ts`, so every test that imports `App.tsx` still loads. In `App.tsx`, call `installForegroundNotificationHandler()` at module scope, after the imports. That way it runs before any notification can arrive, not after the first render.

- [ ] **Step 4: Run the test and the App-level tests**

Run: `npx vitest run client/lib/__tests__/notifications.test.ts && npx vitest run --related client/App.tsx`
Expected: PASS.

- [ ] **Step 5: Commit** — "Keep foreground notifications hidden (pins today's behaviour before SDK 58 changes the default)"

---

### Task 4: `expo-doctor` as an information-only CI step

**Files:**

- Modify: `.github/workflows/ci.yml` (`checks` job, right after "Type check" at line 53)

- [ ] **Step 1: Record the SDK 54 baseline locally**

Run: `npx expo-doctor > /private/tmp/claude-501/<session>/scratchpad/doctor-sdk54.txt; echo exit=$?`
Expected: an output file, exit code 0 or 1. Copy the summary line into the PR body as the baseline.

- [ ] **Step 2: Add the step**

```yaml
- name: Expo doctor (information only)
  continue-on-error: true
  run: npx expo-doctor
```

- [ ] **Step 3: Commit** — "CI: run expo-doctor as an information-only step". Note: a `ci.yml` change triggers `corpus-detect`, so this PR also runs the outward-CLI guard corpus. That's expected, just slower.

---

### Task 5: PR, merge, and the over-the-air handoff

- [ ] **Step 1:** Run `npm audit --omit=dev` and put the high/moderate counts in the PR body (spec §5.5). Open the PR via `mcp__github__create_pull_request` and get the one review pass (`docs/AI_WORKFLOW.md` → Review Policy: `code-reviewer` + `mobile-reviewer`). Merge once CI is green.
- [ ] **Step 2:** Pull `main` into the **main checkout** (the OTA bundles the local tree).
- [ ] **Step 3 (owner):** Confirm the installed build is runtime `1.5.0` on channel `preview`, then run `npm run update:preview -- --message "SDK upgrade step 0: JS prep"`. Agents never run this.
- [ ] **Step 4 (owner, device):** cold-start twice so the update applies, then check:
  - Quick Log → camera button → Quick Log closes and Scan opens.
  - Plan → add item → "Choose recipe", "Simple entry" and "Import recipe" each open their sheet.
  - Camera overlay, the rings, the delete-account/change-email/password modals and the toast all look unchanged.
  - A notification (e.g. a coach reminder) firing while the app is open shows nothing, and tapping one from the background still opens its screen.
