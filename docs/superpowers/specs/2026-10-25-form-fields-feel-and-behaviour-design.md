# Form fields: how they answer a tap, and how they behave

**Date:** 2026-10-25 · **Owner:** williamtower · **Status:** design, awaiting approval

## 1. Why

Tapping a text field in OCRecipes shows a blinking cursor and nothing else — that is what the
owner sees on their phone today. The code has more than that: since #660 (Jul 17) the boxed
`TextInput` fades a 1px border to terracotta, and since #1537 (Oct 22) every other input does too
through `FocusTextInput` / `FocusBottomSheetTextInput`. Two problems remain:

1. **It is too little and, in many places, in the wrong spot.** A 1px colour change is the only
   signal. Where a screen draws the visible rounded field on a wrapper `View` and puts a borderless
   `FocusTextInput` inside it (Home search drawer, Quick Log drawer, ingredient rows, nutrition
   cells, chat composers), the ring is drawn on the inner input: a square-cornered box inset inside
   the rounded field, while the field the user sees does not change. Verified 2026-10-25 on main in
   the iPhone 17 simulator (Home → Search Recipes, rest vs focused screenshots).
2. **Fields don't help you fill them in.** 13 of 16 sign-in/account fields are placeholder-only (the
   prompt vanishes as you type); rules (password length, username characters) are learned only after
   submitting; limits stop typing silently; number fields silently snap back on bad input; several
   Return keys do nothing; validation runs only on submit.

The owner's reference for "near perfect" is the Home **Search Recipes** drawer: the interface slides
up and the drawer opens with trending searches. That motion stays as it is. What is missing is the
field answering the tap, and the placeholder floating.

## 2. Goals

- Every text field answers a tap visibly, on the field the user actually sees.
- Fields say what they want and keep saying it while you type.
- Rules and limits are shown before they bite, and tick off live.
- Bad input is explained in words; nothing reverts or stops silently.
- Keyboard flow works: Return does what its label says.

## 3. Non-goals and anti-goals

- **Not** changing the Search drawer's open/slide motion, or any drawer/sheet motion.
- **Not** a visual redesign of the app's palette or type (the identity-pass directions are separate).
- **Anti-goal:** a second box drawn inside a field. Any focus mark follows the visible field's own shape.
- **Anti-goal:** red or error styling on focus or during first typing. Focus only ever says "you are here" and "here is what this wants".
- **Anti-goal:** per-screen hand-rolled focus state. The look lives in the shared primitives so every screen inherits it.
- **Anti-goal:** fields that grow or jump when focus arrives (height is reserved at rest).

## 4. The look on tap — "B: ring + warm fill" (owner's pick)

Chosen in the visual companion from three working mockups (ring / ring + warm fill / outlined with
label on the edge). Mockup: `.superpowers/brainstorm/26570-1792985188/content/search-field-focus.html`.

On focus, over `focusTimingConfig` (160 ms, out-cubic), all at once:

| Part             | Rest                                                                | Focused                                                                                                           |
| ---------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Edge             | 1px `theme.border` (light) / transparent link tint (dark, as today) | 2px `theme.link`, following the visible field's corner radius                                                     |
| Fill             | `backgroundSecondary` (the field's current fill)                    | warmed toward `theme.link` — a low-opacity link tint over the rest fill (mockup: light `#F6E7DD`, dark `#3A2620`) |
| Label            | the placeholder text, in the value position, `textSecondary`        | shrinks (~0.78–0.85) and floats to the top-left, `theme.link`                                                     |
| Label after blur | —                                                                   | stays floated in `textSecondary` if the field has text; drops back to placeholder position if empty               |

- **Height:** a labelled field is ~52–56px (today's labelled geometry is 56; plain fields are 40).
  The height is the same at rest and focused — no growth on tap.
- **Reduced motion:** every change still happens, snapped (duration 0). Never dropped.
- **Caret:** system default on iOS (not styled).
- **Error state** keeps precedence over focus colour, as today.

### Where the full look applies, and where it is trimmed (owner-confirmed split)

| Field kind                                                                                                                                                                                                                 | Ring | Warm fill | Floating label | Instead of a label                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------- | -------------- | ------------------------------------------------------------------------------------------------------- |
| Everything else (sign-in, account, Quick Log, Goal Setup, recipe wizard, cookbook/grocery names, pantry/grocery add, search fields, import URL, AI prompt)                                                                 | yes  | yes       | yes            | —                                                                                                       |
| Chat composers (Coach, NutriCoach, recipe chat)                                                                                                                                                                            | yes  | yes       | **no**         | the existing placeholder                                                                                |
| Tiny inline number boxes (servings chip, custom grams)                                                                                                                                                                     | yes  | yes       | **no**         | the unit shown beside the value ("g", "servings")                                                       |
| Repeated rows and grid boxes (owner 2026-10-25): wizard ingredient & instruction rows, nutrition cells, time & servings boxes, Goal Setup number fields, receipt quantity, inline edit rows in grocery/pantry/picker lists | yes  | yes       | **no**         | the name they already show outside/beside the box (static caption, unit, step number); height unchanged |

**Label wording (builder-check call, mine):** a floating label is the field's plain name ("Recipe
title", "Username", "What did you eat?"), not today's placeholder when that is an example or a zero.
Example text ("e.g. Creamy Tomato Pasta") stays as the placeholder that shows once the label has
floated — the boxed `TextInput`'s existing `resolvePlaceholder` behaviour. Names are written by the
builder and reviewed in the PR.

**Resting look (builder-check call, mine — follows §3 "no redesign"):** each field keeps its current
resting fill, edge colour and corner radius. Only the focused state is new. The shared primitive
therefore takes fill and radius from the caller, and the warm fill is a link-colour tint laid over
whatever that resting fill is (contrast checked against each base it is used on).

## 5. Behaviour

Defaults from the research (`~/.claude/skills/crafting-ui/references/feedback-and-forms.md` §3–§4),
approved by the owner.

### 5.1 When input is checked

- Never on focus, never during first typing of an error-free field.
- On leaving a field that has text: first check; an error may show now.
- While a field shows an error: re-check every keystroke; clear the error the moment it is valid.
- Empty required fields: flagged only when the main button is pressed; focus then moves to the first
  invalid field.
- The main button always re-checks everything.
- **Buttons disabled until valid (builder-check call, mine):** they become pressable, and pressing
  flags what's missing and moves focus to it (AI generate's 3-character minimum, Goal Setup's
  Calculate, and similar). **Exception:** sign-up's age-confirmation checkbox keeps gating the button
  as today — it's a legal confirmation, not a field.

### 5.2 Fields with rules — live checklist (owner: "especially the password field")

On focus, a short checklist appears under the field; each line ticks as the person types.

- **New password** (Login register, Reset, Change password): "At least 8 characters". Source the rule
  and copy from `shared/constants/password-policy.ts` (`PASSWORD_MIN` = 8, `PASSWORD_MAX` = 128,
  NFC code-point length via `passwordLength`) — never a hard-coded number. The breached-password
  refusal is server-side and can't tick live; it still arrives as an error on submit.
- **Username** (Login register, Choose username): "3–30 characters" and "Letters, numbers or \_",
  matching `registerSchema` in `server/routes/_schemas.ts`.
- Confirm-password fields: a line "Matches" that ticks when equal.

### 5.3 Fields with a limit — counter

A counter like `42 / 500` appears while the field is focused, turning amber near the limit (builder:
pick the threshold, e.g. last 10%). Applies at least to: recipe title & description, AI recipe prompt
(500), chat composers (2000), Notebook (500), cookbook name/description (already shows a counter —
tie it to focus to match).

### 5.4 Number fields

- Unit always visible.
- "1.5" and "1,5" both accepted.
- Refused or clamped values are explained in words next to the field (e.g. "Servings must be 1–99"),
  never a silent revert.
- **Receipt quantity bug** (`client/screens/ReceiptReviewScreen.tsx` `handleUpdateQuantity` +
  `value={String(item.quantity)}`): typing "1." erases the dot and the box can't be emptied. Keep a
  local text draft per row; commit the parsed number on blur/valid.
- Servings chip (`recipe-detail/ServingStepperChip.tsx`) and custom grams (`ServingControls.tsx`):
  explain refusals instead of reverting silently.
- Goal Setup (`GoalSetupScreen.tsx`): plausibility ranges for age/weight/height and targets; the
  Calculate button becomes pressable and points at the missing field (`missingFields` already
  computed; see §5.1).

### 5.5 Dates

Grocery list start/end dates (`meal-plan/GroceryListsScreen.tsx`) become a native date picker
instead of typing `YYYY-MM-DD` on a number pad with no hyphen key. No picker is installed today —
see §7 (new native dependency).

### 5.6 Return key

- "Next" moves focus to the next field; "Done"/"Go"/"Send" submits.
- Recipe wizard: Title's "next" moves to Description; Return on an instruction adds a new step (not
  a line break); Tags' "done" closes the keyboard; number pads get a way to advance (keyboard
  accessory or "next" where the platform allows).
- PhotoAnalysis follow-up (multiline, "done") actually submits, as QuickLogScreen does with
  `submitBehavior="blurAndSubmit"`.
- The two chat composers behave the same way on Return.

### 5.7 While saving

Inputs go `editable={false}` and the button shows progress for the whole request — fills the gaps in
Login, Change password and Verify email (other screens already do this).

### 5.8 Consistency fixes found in review

- Rejected-input shake + error haptic is used on most forms but not ChangePassword, TwoStepSetup,
  PasswordConfirmModal — align them (shake only for validation rejects, per `interaction-feel`).
- Where a field's `errorMessage` and the form's `InlineError` carry the same string, VoiceOver can
  read it twice — keep one announcement.

## 6. Where it lives

- The look is built into the shared primitives, not per screen: `client/components/TextInput.tsx`,
  `FocusTextInput.tsx`, `FocusBottomSheetTextInput.tsx`, `useFocusBorder.ts`, `text-input-utils.ts`,
  timing in `client/constants/animations.ts` (new values are named, doc-commented exports).
- **The ring-on-the-visible-field fix** is the core structural change. Today `useFocusBorder` styles
  whatever element it wraps; wrapper-styled screens get the inner square box. The two meal-plan
  sheets already drive a container ring via `useFocusBorder(..., ring=false)` — that route becomes
  the normal one. Builder's call how (e.g. a shared field-container primitive that owns fill, edge,
  radius, label and focus state, with the raw input inside it), as long as every wrapper-styled
  screen ends up with one rounded field that answers the tap.
- Live checklist, counter, unit/example and explain-the-refusal are shared pieces too, reused
  across screens.
- `interaction-feel` skill and `docs/rules` are updated to describe the new look so future screens
  get it by default.

## 7. Constraints

- React Native / Expo, React Compiler active (no manual memo), Reanimated worklet rules
  (`docs/rules/react-native.md`), reduced-motion gating via `useAccessibility()`, haptics only via
  `useHaptics()`.
- ESLint already forbids bare RN `TextInput` / gorhom `BottomSheetTextInput` in `client/` — keep that.
- Accessibility: the floating label stays the field's accessible name; checklist and counter changes
  are announced politely, not on every keystroke (follow `docs/rules/accessibility.md`).
- Strict TDD, one PR per step, feature branches only.
- **Delivery:** the owner's phone is on an older runtime; main is runtime 4.0.0 mid SDK upgrade.
  None of this reaches the phone until a new build. The date picker adds a native module, so it
  must ride a native build, not an OTA — sequence it with the SDK 58 / expo-iap build.
- No users yet (owner 2026-10-06) — no flagging or staged rollout needed.

## 8. Order of work (suggested)

1. Receipt quantity bug (small, standalone).
2. Shared field look B + ring on the visible field; migrate wrapper-styled screens (Search drawer
   first — the owner's reference — then Quick Log, wizard rows, nutrition cells, composers).
3. Floating labels across the "everything else" fields.
4. Validation timing + live checklist (password, username) + counters.
5. Number fields (units, comma decimals, explained refusals, Goal Setup hints).
6. Return-key flow + submit locks + consistency fixes.
7. Date picker (with the next native build).

## 9. Decided by the owner (2026-10-25)

- Focus look B (ring + warm fill + floating label) over ring-only and outlined.
- The label split in §4: chat composers, tiny number boxes, and repeated rows/grid boxes keep ring + fill but no floating label.
- Behaviour fixes are in the same plan as the look.
- Live password/username checklist.

## 10. Left to the builder

- Exact warm-fill opacity per theme (start from the mockup values; keep text contrast ≥ 4.5:1 on the warmed fill).
- Exact label scale/travel numbers (existing `LABELLED_INPUT_GEOMETRY` is the starting point).
- Counter amber threshold.
- How number pads advance on iOS.
- The primitive's API shape.

## 11. How we'll know it worked

- Simulator screenshots (light + dark, rest vs focused) of the Search drawer, Quick Log, Login,
  Goal Setup and a wizard step show one rounded field that changes edge, fill and label on tap, and
  no inner box.
- Typing a password shows the checklist ticking; typing 1.5 / 1,5 into receipt quantity sticks.
- Every Return key does what it says in the recipe wizard.
- On the owner's phone after the next build: tapping Quick Log shows the ring, warm fill and floating
  label.
