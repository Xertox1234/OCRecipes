# Form Fields: Feel and Behaviour — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every text field answers a tap with look B (2px ring on the visible field + warm fill + floating label where the spec says), and fields help you fill them in (checking on leave, live password/username checklist, counters, explained number refusals, working Return keys, locked while saving).

**Architecture:** The look becomes part of the design system: two theme tokens (`focusRing`, `focusFill`), the existing `focusTimingConfig`, and one shared container primitive `FocusField` that draws the ring and fill as overlays following the container's own radius (so no inner box and no layout shift). `FocusTextInput`, `FocusBottomSheetTextInput` and the boxed `TextInput` are rebuilt on it; screens whose visible field is a wrapper `View` wrap it in `FocusField` and pass `focusRing={false}` to the inner input. Behaviour pieces (validation timing, rule checklist, counter, decimal parsing) are small shared hooks/components plus pure `*-utils.ts` logic.

**Tech Stack:** Expo SDK 57 / RN 0.86, Reanimated 4.5, React Compiler, Vitest + @testing-library/react (jsdom), `@/` and `@shared/` aliases.

**Spec:** `docs/superpowers/specs/2026-10-25-form-fields-feel-and-behaviour-design.md` — executors read both.

## Global Constraints

- Focus look B: ring 2px `theme.focusRing` (= link), warm fill `theme.focusFill`, label floats to top-left in link colour; all over `focusTimingConfig` (160 ms, out-cubic). Error colour keeps precedence over focus.
- Reduced motion: every change still happens, snapped (duration 0) — via `useAccessibility()`.
- No field grows on focus. A labelled field reserves its height at rest (`LABELLED_INPUT_GEOMETRY.containerMinHeight` = 56).
- Each field keeps its current resting fill, edge colour and corner radius.
- No floating label on: chat composers; servings chip & custom grams; repeated rows/grid boxes (wizard ingredient & instruction rows, nutrition cells, time & servings boxes, Goal Setup number fields, receipt quantity, inline edit rows in grocery/pantry/picker lists). They still get ring + fill.
- Floating label text = the field's plain name; example text stays as the placeholder shown once floated.
- Password rule from `shared/constants/password-policy.ts` (`PASSWORD_MIN` 8, `PASSWORD_MAX` 128, `passwordLength`) — never a literal. Username: 3–30 chars, `^[a-zA-Z0-9_]+$` (`server/routes/_schemas.ts` `registerSchema`).
- Validation: none on focus or first typing; first check on leaving a non-empty field; once an error shows, re-check every keystroke; empty required fields flagged on main-button press, focus moves to first invalid field. Buttons disabled-until-valid become pressable — except sign-up's age checkbox, which keeps gating.
- No raw hex in components; new motion values are named exports in `client/constants/animations.ts`; haptics only via `useHaptics()`; no manual `useCallback`/`memo` in new code; imported functions called in worklets need `"worklet"` (`docs/rules/react-native.md`).
- ESLint ban on bare RN `TextInput` / gorhom `BottomSheetTextInput` in `client/` stays.
- Announcements follow `docs/rules/accessibility.md` (iOS `announceForAccessibility`, Android live region) — on state flips, never per keystroke.
- One PR per task, strict TDD, feature branches. Tests: `npx vitest run <path>`.

## Review Focus

1. **Wrapper field with an icon/button inside** (Quick Log: input + arrow + mic + camera) — tapping the mic or arrow must not drop focus styling mid-tap or draw the ring around only part of the row → Task 5 test: ring overlay is a child of the wrapper and spans it.
2. **Text pasted or set programmatically** (autofill password, a coach reply filling a field, `value` restored from a draft) — the label must float without focus → Task 2 test: `hasValue` true at mount floats the label.
3. **Error while focused** — a field with an error that gets focus must stay error-coloured, not turn terracotta → Task 2 test `resolveFieldColors` error precedence.
4. **Comma/period and partial numbers** ("1,", ".5", "1.", "", "1,5,2") in every number field → Task 1 parser table.
5. **Rapid focus switching between two fields** (Next key) — only one field shows focused; label of the left field drops back if empty → Task 6 test on Login: focus A, focus B, A's label rests when empty.

---

### Task 1: Decimal input parsing + receipt quantity fix

**Files:**

- Create: `client/lib/number-input.ts`, `client/lib/__tests__/number-input.test.ts`
- Modify: `client/screens/ReceiptReviewScreen.tsx` (`handleUpdateQuantity` ~L197; quantity `FocusTextInput` ~L264)

**Interfaces:**

- Produces: `parseDecimalInput(text: string): number | null` — accepts `.` or `,` as the decimal separator; trims; returns `null` for empty, lone separator, non-numeric, or more than one separator. `isPartialDecimal(text: string): boolean` — true for text a person may still be typing toward a number (`""`, `"1."`, `"1,"`, `"."`).

- [ ] **Step 1: Failing tests**

```ts
it.each([
  ["1.5", 1.5],
  ["1,5", 1.5],
  [" 2 ", 2],
  ["1.", 1],
  ["1,", 1],
  [".5", 0.5],
  ["", null],
  [".", null],
  ["abc", null],
  ["1,5,2", null],
  ["1.2.3", null],
])("parseDecimalInput(%j) → %j", (input, out) =>
  expect(parseDecimalInput(input)).toBe(out),
);
it.each(["", "1.", "1,", "."])("isPartialDecimal(%j) is true", (t) =>
  expect(isPartialDecimal(t)).toBe(true),
);
it.each(["1.5", "abc"])("isPartialDecimal(%j) is false", (t) =>
  expect(isPartialDecimal(t)).toBe(false),
);
```

- [ ] **Step 2:** `npx vitest run client/lib/__tests__/number-input.test.ts` → FAIL (module not found).
- [ ] **Step 3:** Implement both in `client/lib/number-input.ts`.
- [ ] **Step 4:** Receipt: keep a per-row text draft (`Record<string, string>` keyed by item id) as the input's `value`; on change, store the draft and, when `parseDecimalInput` returns a number ≥ 0, update the item's quantity. On blur, if the draft is empty/invalid, restore the draft to `String(item.quantity)`. Add a screen test (`client/screens/__tests__/ReceiptReviewScreen.test.tsx`, create if absent) asserting that typing `"1."` keeps `"1."` in the box, then `"1.5"` commits 1.5, and clearing leaves `""` until blur.
- [ ] **Step 5:** Run both test files → PASS. Commit `fix(receipt): quantity box keeps "1." while typing and takes 1,5`.

---

### Task 2: Design-system tokens + `FocusField` primitive

**Files:**

- Modify: `client/constants/theme.ts` (light + dark palettes: `focusRing`, `focusFill`)
- Create: `client/components/field-focus-utils.ts`, `client/components/__tests__/field-focus-utils.test.ts`
- Create: `client/components/useFieldFocus.ts`
- Create: `client/components/FocusField.tsx`, `client/components/__tests__/FocusField.test.tsx`
- Modify: `docs/rules/design-system.md` (+ run `npm run build:copilot-instructions`, commit the regenerated `.github/copilot-instructions.md`)

**Interfaces:**

- Produces (theme): `theme.focusRing: string` (light `#B5451C`, dark `#E07050` — same as `link`), `theme.focusFill: string` — `withOpacity(link, 0.12)` per mode, as a literal hex8 in the palette. Check text contrast ≥ 4.5:1 for `theme.text` over `focusFill` laid on `backgroundSecondary` and `backgroundDefault` in both modes; lower the alpha if not.
- Produces (utils): `FOCUS_RING_WIDTH = 2`; `resolveFieldRadius(style: object): number` (flattened `borderRadius`, else 0); `resolveFieldColors(opts: { hasError: boolean; errorColor: string; ringColor: string }): { ring: string }` (error wins); `splitFieldStyle(style: object): { box: ViewStyle; text: TextStyle }` — box keys: `backgroundColor`, `border*`, `margin*`, `width`, `height`, `minHeight`, `maxHeight`, `flex*`, `alignSelf`, `position`, `top/left/right/bottom`; everything else is text.
- Produces (hook): `useFieldFocus(opts?: { onFocus?: TextInputProps["onFocus"]; onBlur?: TextInputProps["onBlur"] }): FieldFocus` where `FieldFocus = { focused: boolean; progress: SharedValue<number>; onFocus: NonNullable<TextInputProps["onFocus"]>; onBlur: NonNullable<TextInputProps["onBlur"]> }` — animates `progress` with `focusTimingConfig`, duration 0 under reduced motion.
- Produces (component): `<FocusField focus={FieldFocus} style={StyleProp<ViewStyle>} label?={string} hasValue?={boolean} error?={boolean}>{children}</FocusField>` — an `Animated.View` with the caller's style; two absolute, `pointerEvents="none"`, a11y-hidden overlays with the container's radius: fill overlay (`focusFill`, opacity = progress) under children, ring overlay (`borderWidth: FOCUS_RING_WIDTH`, ring colour, opacity = progress; when `error`, ring is error colour at full opacity) over children. With `label`: the floating label (logic and geometry moved from `TextInput.tsx`: `shouldFloatLabel`, `LABELLED_INPUT_GEOMETRY`), `minHeight` 56.

- [ ] **Step 1: Failing util tests** — `resolveFieldRadius({borderRadius: 8}) === 8`, `resolveFieldRadius({}) === 0`; `resolveFieldColors({hasError: true, errorColor: "E", ringColor: "R"}).ring === "E"`; `splitFieldStyle({backgroundColor: "x", borderRadius: 8, color: "y", fontSize: 14, paddingHorizontal: 12, flex: 1})` → `box` has bg/radius/flex, `text` has color/fontSize/paddingHorizontal.
- [ ] **Step 2: Failing component tests** — renders children; label text present and not in the a11y tree (`accessible={false}`); overlays have `pointerEvents="none"`; `hasValue` at mount floats the label (Review Focus 2: assert via `shouldFloatLabel(false, "x") === true` path — label rendered in floated style); `useFieldFocus` calls the caller's `onFocus`/`onBlur` once each.
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement tokens, utils, hook, component. **Step 5:** Run → PASS.
- [ ] **Step 6:** Add to `docs/rules/design-system.md`: "Every text field's focus look comes from `FocusField` (ring `theme.focusRing` 2px + fill `theme.focusFill`, on the visible field). A screen that draws the field on a wrapper wraps it in `FocusField` and passes `focusRing={false}` to the inner input — never a ring on the inner input." Run `npm run build:copilot-instructions`.
- [ ] **Step 7:** Replace `design_guidelines.md` (repo root, stale Mar 2026 green/Inter direction) with a short pointer: the live design system is the Claude Design project **"OCRecipes Design System"** (`https://claude.ai/design/p/53b12f65-b482-462d-9a5a-9a08b154eccc`), values come from `client/constants/theme.ts` + `client/constants/animations.ts`, rules in `docs/rules/design-system.md`. Commit `feat(design-system): focus tokens and the FocusField primitive`.
- [ ] **Step 8 (after the Task 2 PR merges — the owner approved this 2026-10-25):** update the Claude Design project `53b12f65-b482-462d-9a5a-9a08b154eccc` with `DesignSync` (owner has authorized via `/design-login`). Exactly three files, nothing else:
  - `colors_and_type.css` — add `--focus-ring`, `--focus-fill` (light + dark, the shipped `theme.ts` values) and the missing `--accent-solid` (`#B5451C` both modes, comment: fill behind white text; dark `--link` fails as a fill).
  - `preview/inputs.html` — keep the first-line `@dsCard group="Components" name="Text Inputs"` comment (update subtitle); show rest / focused (2px ring + warm fill + floating label) / filled (label floated, grey) / error, plus a note of the label split (none on chat composers, small number boxes, repeated rows/grid boxes).
  - `README.md` — stack line → RN 0.86 / Expo SDK 57 (or whatever main is on then); Borders section: replace "dark inputs are borderless" with the focus ring behaviour; add `accentSolid` to Colors.
    Flow: `get_file` each (re-read — someone may have edited since 2026-10-25), build the new files locally in the scratchpad, `finalize_plan` with `writes` = those three paths and `localDir` = that folder, `write_files`. Warn the owner in plain words that these three files get replaced. Do NOT run the `/design-sync` converter (React Native components can't render in Claude Design's browser).

---

### Task 3: Rebuild `FocusTextInput` / `FocusBottomSheetTextInput` on `FocusField`

**Files:**

- Modify: `client/components/FocusTextInput.tsx`, `client/components/FocusBottomSheetTextInput.tsx`, `client/components/meal-plan/QuickAddSheet.tsx` (~L83, ~L424), `client/components/meal-plan/SimpleEntrySheet.tsx` (~L70, ~L305)
- Delete: `client/components/useFocusBorder.ts`; remove `resolveFocusBorder` / `compensateSyntheticBorder` from `text-input-utils.ts` and their tests
- Test: `client/components/__tests__/FocusTextInput.test.tsx`

**Interfaces:**

- Consumes: Task 2 `FocusField`, `useFieldFocus`, `splitFieldStyle`.
- Produces: both inputs accept `focusRing?: boolean` (default `true`). `true`: render `FocusField` with `splitFieldStyle(style).box` and the input with `.text` (style keys on the input itself are no longer animated). `false`: render the bare input with the caller's `style`, `onFocus`, `onBlur` passed straight through.

- [ ] **Step 1: Failing tests** — with `focusRing` default, the input's parent carries the caller's `backgroundColor`; with `focusRing={false}`, no `FocusField` wrapper (input is the root) and handlers are forwarded; existing three tests still pass.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; migrate QuickAddSheet/SimpleEntrySheet from `useFocusBorder` to `useFieldFocus` + `FocusField` (same container styles). **Step 4:** `npx vitest run client/components` → PASS; `grep -rn useFocusBorder client` → no hits.
- [ ] **Step 5:** Simulator check (verify-ui, light + dark): TitleStep title field and QuickAddSheet search — one rounded field, 2px ring + warm fill on tap, no inner box, no size change. Commit `feat(forms): focus inputs draw ring + fill on the visible field`.

---

### Task 4: Boxed `TextInput` on `FocusField`

**Files:** Modify `client/components/TextInput.tsx`; Test `client/components/__tests__/TextInput.test.tsx`

**Interfaces:**

- Consumes: Task 2. Produces: unchanged public props (`label`, `error`, `errorMessage`, icons, `containerStyle`); container rendered by `FocusField` (`focus` from `useFieldFocus`, `label`, `hasValue = effectiveValue.length > 0`, `error`). Remove the component's own border interpolation and label animation (now in `FocusField`).

- [ ] **Step 1:** All existing `TextInput.test.tsx` cases (incl. placeholder suppression, uncontrolled float, reduced motion) are the regression net; add: error + focused keeps error ring (Review Focus 3).
- [ ] **Step 2–4:** Run → FAIL on the new case; implement; run → PASS.
- [ ] **Step 5:** verify-ui ChangePasswordScreen (labelled) and LoginScreen (unlabelled), light + dark. Commit.

---

### Task 5: Wrapper-styled fields — Search drawer first

**Files (each: wrap the visible wrapper `View` in `FocusField`, inner input `focusRing={false}` with the field's `onFocus`/`onBlur`):**

- `client/components/home/RecipeSearchDrawer.tsx` (~L102–121) — label `"Search recipes"`, placeholder stays `"Search recipes…"`
- `client/components/home/QuickLogDrawer.tsx` (~L300–318) — label `"What did you eat?"`
- `client/components/home/GenerateRecipeDrawer.tsx` — label per its purpose
- `client/components/recipe-wizard/IngredientsStep.tsx` (row ~L55), `InstructionsStep.tsx` (row), `NutritionStep.tsx` (cell ~L87) — no label
- `client/components/coach/CoachChatBase.tsx`, `client/screens/ChatScreen.tsx`, `client/screens/RecipeChatScreen.tsx` composers — no label
- Any other `FocusTextInput` whose style has no `borderWidth` and no `backgroundColor` while its parent `View` has either (find with LSP references to `FocusTextInput` + read each call site; list them in the PR)
- Modify: `.claude/skills/interaction-feel/SKILL.md` "Shipped focus patterns" → describe `FocusField`, tokens, `focusRing={false}` and the label split
- Tests: one render test per primitive pattern in `client/components/home/__tests__/RecipeSearchDrawer.test.tsx` (create if absent): the input's ancestor `FocusField` carries the drawer's background; the label text is present; QuickLog ring overlay is a child of the full row including mic/camera (Review Focus 1).

- [ ] **Step 1:** Failing RecipeSearchDrawer + QuickLogDrawer tests. **Step 2:** Run → FAIL. **Step 3:** Migrate all listed sites. **Step 4:** Run → PASS.
- [ ] **Step 5:** verify-ui Home → Search Recipes, rest vs focused, light + dark: rounded field, ring + warm fill, label floated, drawer slide unchanged. Commit `feat(forms): Search, Quick Log, wizard rows and composers answer a tap`.

---

### Task 6: Floating labels — sign-in and account

**Files and labels** (`TextInput` `label` prop; keep existing placeholder only where it is an example):

- `LoginScreen.tsx`: "Username or email" (login) / "Username" (register), "Email", "Password", "Confirm password"
- `ForgotPasswordScreen.tsx` "Email" · `ResetPasswordScreen.tsx` "6-digit code", "New password", "Confirm password" · `ChooseUsernameScreen.tsx` "Username" · `ConnectAccountScreen.tsx` "Password" · `TwoStepSetupScreen.tsx` "Password" · `VerifyEmailScreen.tsx` "Email" · `components/PasswordConfirmModal.tsx` "Password" · `components/SecondFactorField.tsx` "6-digit code" · `components/ChangeEmailModal.tsx` "New email", "Confirm new email", "Password" (remove the static captions above) · `components/DeleteAccountModal.tsx` "Password" (remove static caption)
- Tests: extend each screen's existing test file (or create) asserting the label is the input's accessible name; Login: focus Username then Password with Username empty → Username label rests (Review Focus 5).

- [ ] Steps: failing tests → FAIL → add labels → PASS → verify-ui Login light/dark → commit `feat(auth): sign-in and account fields float their labels`.

### Task 7: Floating labels — everything else

**Files and labels:** `recipe-wizard/TitleStep.tsx` "Recipe title", "Description" (replace static caps labels) · `recipe-wizard/TagsStep.tsx` "Cuisine" · `meal-plan/RecipeAIGenerateScreen.tsx` "What should we make?" · `meal-plan/RecipeImportScreen.tsx` "Recipe link" · `CookbookPickerModal.tsx` "Cookbook name" · `GroceryListPickerModal.tsx` "List name" · `meal-plan/PantryScreen.tsx` "Add to pantry" · `meal-plan/GroceryListScreen.tsx` "Add item" · `meal-plan/RecipeBrowserScreen.tsx`, `AllConversationsScreen.tsx`, `meal-plan/QuickAddSheet.tsx`, `NutritionDetailScreen.tsx` search fields "Search" + their noun · `QuickLogScreen.tsx` "What did you eat?" · `NotebookEntryScreen.tsx` "Note" · `PhotoAnalysisScreen.tsx` "Food", "Quantity" (placeholder "e.g. 1 cup or 200 g") · `meal-plan/SimpleEntrySheet.tsx` "Dish name" · `BeveragePickerSheet.tsx` "Drink or calories" · `meal-plan/CookbookCreateScreen.tsx` already labelled.

- Non-boxed sites get the label through `FocusField`'s `label` (Task 2), boxed ones through `TextInput`'s.
- Tests: TitleStep test asserts "Recipe title" is the accessible name and the example placeholder appears after focus. Steps as Task 6. Commit `feat(forms): every remaining field floats its name`.

---

### Task 8: Validation timing

**Files:** Create `client/lib/field-validation.ts` + `__tests__/field-validation.test.ts`; create `client/hooks/useFieldValidation.ts` + test. Apply in: LoginScreen (register + login), ResetPasswordScreen, ChangePasswordScreen, ChooseUsernameScreen, ChangeEmailModal, VerifyEmailScreen, ForgotPasswordScreen, RecipeAIGenerateScreen (3-char minimum → pressable button that flags), GoalSetupScreen (Calculate pressable; focus first missing field; keep "Still needed: …").

**Interfaces:**

- `shouldShowError(s: { value: string; leftNonEmpty: boolean; submitAttempted: boolean; error: string | null }): boolean` — `error !== null && (leftNonEmpty || submitAttempted)`.
- `useFieldValidation(validate: (value: string) => string | null): { value: string; error: string | null /* visible error */; onChangeText: (t: string) => void; onBlur: () => void; markSubmitted: () => boolean /* true if valid */; ref: RefObject<RNTextInput> }`
- `focusFirstInvalid(fields: Array<{ markSubmitted: () => boolean; ref: RefObject<RNTextInput> }>): boolean` — calls every `markSubmitted`, focuses the first invalid, returns overall validity.

- [ ] **Failing tests:** no error after focus+typing invalid text without blur; error after blur with text; no error after blur when empty; empty shows error after `markSubmitted`; visible error clears on the keystroke that makes it valid; `focusFirstInvalid` focuses the second of three when only it is invalid. Then implement, apply per screen (shake + error haptic stay on the reject branch per `interaction-feel`), age checkbox untouched. Commit per screen group is fine within one PR.

---

### Task 9: Live rule checklist (password, username)

**Files:** Create `client/lib/field-rules.ts` + test; create `client/components/FieldRules.tsx` + test. Apply under: LoginScreen register password, confirm, username; ResetPasswordScreen new + confirm; ChangePasswordScreen new; ChooseUsernameScreen.

**Interfaces:**

- `type FieldRule = { id: string; label: string; met: boolean }`
- `passwordRules(pw: string): FieldRule[]` → `[{ id: "min", label: \`At least ${PASSWORD_MIN} characters\`, met: passwordLength(pw) >= PASSWORD_MIN }]`(plus a`max`rule only once`passwordLength(pw) > PASSWORD_MAX`).
- `confirmRules(pw: string, confirm: string): FieldRule[]` → `[{ id: "match", label: "Matches", met: confirm.length > 0 && confirm === pw }]`
- `usernameRules(u: string): FieldRule[]` → `"3–30 characters"` (3 ≤ len ≤ 30), `"Letters, numbers or _"` (`/^[a-zA-Z0-9_]*$/` and len > 0).
- `<FieldRules rules={FieldRule[]} visible={boolean} />` — shown while the field is focused or any rule is unmet after leaving; each line a tick or open circle + label; announces "<label>, done" only when a rule flips to met.

- [ ] **Failing tests:** `passwordRules("1234567")[0].met === false`, `passwordRules("12345678")[0].met === true`, NFC: `passwordRules("é".repeat(8))` counts 8; username `"ab"` unmet length, `"ab-c"` unmet chars, `"chef_1"` all met; `FieldRules` announces once on flip, not on a keystroke that leaves it met. Then implement + apply. Commit `feat(auth): password and username rules tick off as you type`.

---

### Task 10: Counters on limited fields

**Files:** Create `client/components/FieldCounter.tsx` + test. Apply: `TitleStep` (`TITLE_MAX_LENGTH`, `DESCRIPTION_MAX_LENGTH`), `RecipeAIGenerateScreen` (500), `NotebookEntryScreen` (500), `CoachChatBase` / `ChatScreen` / `RecipeChatScreen` (2000), `CookbookCreateScreen` (`NAME_MAX`, `DESCRIPTION_MAX` — make its existing counter show only while focused).

**Interfaces:** `<FieldCounter length={number} max={number} visible={boolean} />`; `counterTone(length, max): "normal" | "near" | "at"` — `near` when `max - length <= Math.ceil(max * 0.1)`, `at` when `length >= max`; colours `textSecondary` / `theme.warning` / `theme.error`. Announce once when entering `near` and once at `at`.

- [ ] Failing tests on `counterTone(449, 500) === "normal"`, `(450, 500) === "near"`, `(500, 500) === "at"`; component hidden when `visible` false. Implement, apply, commit.

---

### Task 11: Number fields

**Files:** `recipe-detail/ServingStepperChip.tsx` (~L50), `ServingControls.tsx` (~L155), `GoalSetupScreen.tsx` (+ `GoalSetupScreen-utils.ts` create if absent), and every `keyboardType` numeric/decimal field touched in Tasks 5–7 uses `parseDecimalInput`.

**Interfaces / values (plan's call, metric; convert with `@shared/lib/units` for the person's unit):** age 13–120; weight 25–350 kg; height 100–250 cm; calories 800–6000; protein/carbs/fat 0–1000 g. `goalFieldError(field: GoalField, value: string, unit: MeasurementUnit): string | null` with messages like `"Age must be 13–120"`, `"Weight must be 55–770 lb"` (converted bounds, rounded).

- Servings chip: refused value → `InlineError`-style message `"Servings must be 1–99"` under the chip, keep the old value. Custom grams: `"Enter an amount above 0 g"`.

- [ ] Failing tests: `goalFieldError("age", "5", "metric") === "Age must be 13–120"`, `goalFieldError("weight", "70,5", "metric") === null`, imperial bound message; ServingStepperChip shows the message after submitting `"0"`. Implement, apply, commit.

---

### Task 12: Return keys, submit locks, consistency

**Files and changes:**

- `TitleStep.tsx`: title `onSubmitEditing` focuses description (ref). `InstructionsStep.tsx`: `returnKeyType="next"`, `submitBehavior="submit"`, `onSubmitEditing` adds a step and focuses it (as Ingredients does). `TagsStep.tsx`: `onSubmitEditing={Keyboard.dismiss}`. Number pads in TimeServings/Nutrition: builder's choice of advance (iOS `InputAccessoryView` "Next" or `returnKeyType` where supported).
- `PhotoAnalysisScreen.tsx` follow-up: `submitBehavior="blurAndSubmit"`. `ChatScreen.tsx` composer matches `CoachChatBase` Return behaviour.
- Locks: `editable={!busy}` on all inputs of LoginScreen, ChangePasswordScreen, VerifyEmailScreen for the whole request.
- Shake + error haptic on validation rejects in ChangePasswordScreen, TwoStepSetupScreen, PasswordConfirmModal (`useShake` + `InlineError shakeKey`).
- Single announcement: where a field's `errorMessage` equals the form `InlineError` message (ResetPassword, VerifyEmail, DeleteAccountModal), drop the field's `errorMessage` (keep `error` for colour).
- Tests: TitleStep Return focuses description; InstructionsStep Return adds a step; LoginScreen inputs are not editable while the mutation is pending; ResetPassword error renders once in the a11y tree.
- [ ] Failing tests → implement → PASS → commit `fix(forms): Return keys do what they say; fields lock while saving`.

---

### Task 13: Date picker for grocery list dates (native build)

**Gate:** ship with the next native build (SDK 58 / expo-iap build); not via OTA.

**Files:** `npx expo install @react-native-community/datetimepicker`; Modify `client/screens/meal-plan/GroceryListsScreen.tsx` (~L334–367): replace the two typed `YYYY-MM-DD` fields with a tappable field (FocusField, labels "Start date" / "End date") opening the native picker; end ≥ start enforced by the picker's `minimumDate`.

- Test: the field shows the formatted date; choosing an end date before start is not possible (`minimumDate` passed). Commit `feat(grocery): pick list dates instead of typing them`.

---

## Notes for the executor

- **Execution method (owner, 2026-10-25): subagent-driven** (`superpowers:subagent-driven-development`). Spec + plan approved. Spec is committed on branch `docs/form-fields-design` (pushed); this plan file is gitignored by repo convention and lives only in the main checkout.
- Task reviewers come from the roster in `docs/AI_WORKFLOW.md` → Review Policy (`code-reviewer` + `mobile-reviewer` for client UI), not bare `general-purpose`; one review pass per PR.
- Visual checks: owner's phone is on an older runtime and can't receive any of this by OTA — judge in the simulator. The iPhone 17 sim (`0D2AD2A4-EC17-493A-AAA2-99854C7DEF04`) holds a runtime 4.0.0 dev build matching main (launch it, connect Metro; don't install over it). Its signed-in account has Quick Log locked (premium), so test the Search drawer for the wrapper pattern.
- `design_guidelines.md` is replaced by a pointer in Task 2 Step 7; the binding design-system rules are `docs/rules/design-system.md` (Task 2) and the `interaction-feel` skill (Task 5).
- Tasks 1, 8–12 can run in any order after Task 2 except where they render labels (needs 6/7). Task 13 waits for the native build.
