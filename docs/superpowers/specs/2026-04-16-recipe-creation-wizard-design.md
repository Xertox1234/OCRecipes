# Recipe Creation Wizard — Design Spec

**Date:** 2026-04-16
**Status:** Approved

## Problem

The current "New Recipe" screen (`RecipeCreateScreen`) is a flat list of "Tap to add" rows that open bottom sheets. It feels uninviting, gives no sense of progress, and buries the multiple ways users can get recipes into the app (URL import, photo scan, AI generation) behind separate navigation paths.

## Solution

Replace the current interface with a **3-stage pipeline**:

```
Entry Hub → Intake Method → Step-by-Step Wizard → Preview → Save
```

### Design Decisions

- **Step-by-step wizard** over scrollable form or expandable cards — keeps focus narrow, provides clear progress, full screen for each editor
- **Entry hub** as the landing screen — surfaces all 5 recipe entry methods (write, AI, URL, photo, browse) in one place
- **AI as optional shortcut** — clear "Generate with AI" card, but manual flow is the default
- **Auto-suggested tags** — cuisine and diet tags inferred client-side from title + ingredients, user confirms/edits
- **Preview step** at the end — full recipe review with edit links back to any step

---

## Stage 1: Entry Hub

**New screen: `RecipeEntryHubScreen`**

Replaces the current `RecipeCreateScreen` as the entry point when users tap "Add Recipe" / "New Recipe".

**Layout:** Header ("Add Recipe") + subtitle ("How would you like to start?") + 5 vertical action cards.

| Card | Icon                      | Title              | Description                              | Routes to                          |
| ---- | ------------------------- | ------------------ | ---------------------------------------- | ---------------------------------- |
| 1    | Pencil (purple gradient)  | Write from scratch | Type your own recipe step by step        | Wizard step 1 (empty form)         |
| 2    | Sparkles (amber gradient) | Generate with AI   | Describe what you want, AI does the rest | `RecipeAIGenerateScreen`           |
| 3    | Link (green gradient)     | Import from URL    | Paste a link from any recipe site        | Existing `RecipeImportScreen`      |
| 4    | Camera (blue gradient)    | Scan a recipe      | Take a photo of a cookbook or card       | Existing `RecipePhotoImportScreen` |
| 5    | Search (pink gradient)    | Browse recipes     | Search community & catalog recipes       | Existing `RecipeBrowserScreen`     |

**Behavior:**

- Cards use subtle scale spring press animation
- `returnToMealPlan` param passes through to whichever flow the user picks
- No state management needed — pure navigation screen

---

## Stage 2: Intake Methods

Each method produces `ImportedRecipeData` and feeds it into the wizard as prefill.

### Write from scratch

- Skips intake, goes directly to wizard step 1 with an empty form

### Generate with AI (new)

**New screen: `RecipeAIGenerateScreen`**

- Large text input with placeholder: _"What do you want to make? e.g., 'Chicken stir fry with vegetables' or 'a quick weeknight pasta'"_
- Quick-suggestion chips below input for inspiration: "Quick dinner", "Healthy lunch", "Comfort food", "Dessert"
- "Generate Recipe" button
- Loading state: animated indicator with "Creating your recipe..."
- On success: navigates to wizard with full `ImportedRecipeData` prefill
- On error: inline error with retry button

**New endpoint:** `POST /api/meal-plan/recipes/generate`

- Request: `{ prompt: string }`
- Response: `ImportedRecipeData`
- Calls existing `recipe-generation.ts` service but returns data without saving

### Import from URL (existing)

**Modified screen: `RecipeImportScreen`**

- After extracting the recipe, navigates to wizard with prefill instead of saving directly
- Extraction logic unchanged

### Scan a recipe (existing)

**Modified screen: `RecipePhotoImportScreen`**

- After photo analysis, navigates to wizard with prefill instead of saving directly
- Photo analysis logic unchanged

### Browse recipes (existing)

**Unchanged: `RecipeBrowserScreen`**

- Stays as-is — browsing is a separate flow that saves directly
- No wizard integration needed

---

## Stage 3: The Wizard

**Redesigned `RecipeCreateScreen`** — a single screen component with step transitions managed by `WizardShell`.

### Step Order

| Step | Title                | Subtitle                         | Required        | Content                                                     |
| ---- | -------------------- | -------------------------------- | --------------- | ----------------------------------------------------------- |
| 1    | What are you making? | Give your recipe a name          | Title ≥ 3 chars | Title input + optional description                          |
| 2    | Ingredients          | What goes into this recipe?      | ≥ 1 non-empty   | Bullet list with add/remove/edit                            |
| 3    | Instructions         | How do you make it?              | ≥ 1 non-empty   | Numbered steps with add/remove/reorder                      |
| 4    | Time & Servings      | How long does it take?           | No              | Servings stepper (1-99) + prep/cook time inputs with total  |
| 5    | Nutrition            | Per serving (optional)           | No, skippable   | 2x2 grid: calories, protein, carbs, fat                     |
| 6    | Tags & Cuisine       | Auto-suggested, edit as needed   | No              | Cuisine text input (pre-filled) + toggleable diet tag chips |
| 7    | Preview              | Review your recipe before saving | N/A             | Full recipe card with "Edit" links + "Save Recipe" button   |

### Wizard Chrome

Every step shares:

- **Progress bar** — 7 segments at top, filled segments use purple. Animates with spring on transition.
- **Step label** — "Step X of 7" below progress bar, purple text
- **Step title** — Large bold heading
- **Step subtitle** — Gray contextual hint
- **Bottom navigation** — Fixed above safe area:
  - Step 1: only "Next: Ingredients →" (no back)
  - Steps 2-6: "← Back" (left) + "Next: [step name] →" (right)
  - Step 5: "Next" button can also read "Skip" if nutrition is empty
  - Step 7: "← Back" (left) + "Save Recipe ✓" (right, gradient background)

### Step Details

**Step 1 — Title & Description:**

- "RECIPE NAME" label with focused text input (border highlight when active)
- "DESCRIPTION (optional)" label with multiline text input
- Validation: title must be ≥ 3 characters to proceed

**Step 2 — Ingredients:**

- Vertical list of ingredient rows, each with: purple bullet, text input, red × delete button
- Last row is dashed-border "Add ingredient..." prompt
- Delete hidden if only 1 ingredient remains
- Haptic feedback on add/remove

**Step 3 — Instructions:**

- Vertical list of step rows, each with: numbered purple circle badge, multiline text input, up/down reorder arrows
- Reorder arrows disabled at list bounds
- Last row is dashed-border "Add step..." prompt
- Haptic feedback on add/remove

**Step 4 — Time & Servings:**

- Centered servings stepper with minus/plus circle buttons
- Side-by-side prep time and cook time numeric inputs with "minutes" label
- Computed "Total: X minutes" text below

**Step 5 — Nutrition (skippable):**

- 2x2 grid of large centered inputs: Calories (amber), Protein (blue), Carbs (green), Fat (pink)
- Each cell has colored label, large number input, unit text
- "Next" button reads "Skip" if all fields are empty

**Step 6 — Tags & Cuisine (auto-suggested):**

- Cuisine: text input pre-filled with inferred cuisine, "suggested" badge shown
- Diet tags: 8 toggleable chips (Vegetarian, Vegan, Gluten Free, Dairy Free, Keto, Paleo, Low Carb, High Protein)
- Inference runs client-side from title + ingredient names:
  - Cuisine: keyword matching (e.g., "parmesan" + "marinara" → Italian)
  - Diet tags: ingredient analysis (e.g., no meat ingredients → suggest Vegetarian)
- Active tags use filled purple background

**Step 7 — Preview:**

- Full recipe card showing all entered data:
  - Image placeholder: "Image will be generated after save"
  - Title + description with "Edit ✎" link → jumps to step 1
  - Meta row (time, servings, cuisine) with "Edit ✎" link → jumps to step 4
  - Ingredients summary with count and "Edit ✎" link → jumps to step 2
  - Instructions summary with count and "Edit ✎" link → jumps to step 3
  - Nutrition row with colored macro values and "Edit ✎" link → jumps to step 5
  - Tag chips with "Edit ✎" link → jumps to step 6
- "Save Recipe ✓" button with gradient background

### Edit-from-Preview Flow

When user taps "Edit ✎" on the Preview step:

1. Wizard navigates back to the target step (e.g., step 2 for Ingredients)
2. User edits the content
3. Tapping "Next" from that step fast-forwards directly back to Preview (step 7), skipping intermediate steps
4. This is tracked via a `returnToPreview` flag in wizard state

---

## Behavior Details

### Navigation & Validation

- Back button on step 1 returns to the Entry Hub (with unsaved changes guard if dirty)
- Next button validates the current step before advancing
- Users cannot jump ahead — must progress sequentially
- Preview "Edit" links are the only way to jump back

### Unsaved Changes Guard

- Same `beforeRemove` navigation event listener as current implementation
- Confirmation modal if form has any non-empty content (`form.isDirty`)
- Navigation blocked while save mutation is pending

### Auto-Suggestion Logic (Tags Step)

- Client-side heuristic, no server call
- Cuisine inference: keyword map from ingredients/title to cuisine name
- Diet tag inference: check ingredients for meat/dairy/gluten markers
- Suggestions appear pre-filled; user can accept, edit, or clear

### Animations

- Step transitions: horizontal slide via Reanimated (next slides left, back slides right)
- Progress bar: spring animation as segments fill
- Button presses: scale spring (same as existing `SectionRow`)
- Ingredient/step add/remove: layout animations for smooth list changes

### Accessibility

- Progress bar announces "Step X of 7, [step name]" on each transition
- Next/Back buttons include destination step name in accessibility label
- Focus moves to step title when transitioning
- Ingredient/step removals announced via `AccessibilityInfo.announceForAccessibility()`

---

## Technical Architecture

### New Files

| File                                                   | Purpose                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `client/screens/meal-plan/RecipeEntryHubScreen.tsx`    | Entry hub with 5 action cards                              |
| `client/screens/meal-plan/RecipeAIGenerateScreen.tsx`  | AI generation intake screen                                |
| `client/components/recipe-wizard/WizardShell.tsx`      | Wizard chrome: progress bar, nav buttons, step transitions |
| `client/components/recipe-wizard/TitleStep.tsx`        | Step 1: title & description                                |
| `client/components/recipe-wizard/IngredientsStep.tsx`  | Step 2: ingredient list editor                             |
| `client/components/recipe-wizard/InstructionsStep.tsx` | Step 3: instruction step editor                            |
| `client/components/recipe-wizard/TimeServingsStep.tsx` | Step 4: time & servings                                    |
| `client/components/recipe-wizard/NutritionStep.tsx`    | Step 5: nutrition macros                                   |
| `client/components/recipe-wizard/TagsStep.tsx`         | Step 6: cuisine & diet tags                                |
| `client/components/recipe-wizard/PreviewStep.tsx`      | Step 7: review & save                                      |
| `client/components/recipe-wizard/types.ts`             | Shared wizard types                                        |
| `server/routes/recipe-generate.ts`                     | `POST /api/meal-plan/recipes/generate` endpoint            |

### Modified Files

| File                                                   | Change                                                                           |
| ------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `client/navigation/MealPlanStackNavigator.tsx`         | Add `RecipeEntryHub` and `RecipeAIGenerate` routes; update `RecipeCreate` params |
| `client/screens/meal-plan/RecipeImportScreen.tsx`      | Navigate to wizard with prefill instead of saving directly                       |
| `client/screens/meal-plan/RecipePhotoImportScreen.tsx` | Navigate to wizard with prefill instead of saving directly                       |
| `server/routes.ts`                                     | Register `recipe-generate` route                                                 |

### Removed Files

| File                                                     | Reason                             |
| -------------------------------------------------------- | ---------------------------------- |
| `client/components/recipe-builder/SectionRow.tsx`        | Replaced by wizard steps           |
| `client/components/recipe-builder/SheetHeader.tsx`       | No more bottom sheets              |
| `client/components/recipe-builder/IngredientsSheet.tsx`  | Replaced by `IngredientsStep.tsx`  |
| `client/components/recipe-builder/InstructionsSheet.tsx` | Replaced by `InstructionsStep.tsx` |
| `client/components/recipe-builder/TimeServingsSheet.tsx` | Replaced by `TimeServingsStep.tsx` |
| `client/components/recipe-builder/NutritionSheet.tsx`    | Replaced by `NutritionStep.tsx`    |
| `client/components/recipe-builder/TagsCuisineSheet.tsx`  | Replaced by `TagsStep.tsx`         |

### Kept (Reused)

- `client/hooks/useRecipeForm.ts` — reused as-is for form state management; wizard steps call the same `addIngredient()`, `updateIngredient()`, etc. methods
- `client/components/recipe-builder/types.ts` — moved to `recipe-wizard/types.ts`
- All backend storage and routes for saving recipes — unchanged
- `POST /api/meal-plan/recipes` endpoint — unchanged (wizard calls the same save endpoint)

### WizardShell Architecture

`WizardShell` is a single screen component (the redesigned `RecipeCreateScreen`) — not multiple navigation screens. Steps are swapped via Reanimated transitions within one screen.

```
WizardShell
├── Progress bar (7 segments)
├── Step content (renders one step component based on currentStep)
│   ├── Passes form state from useRecipeForm() as props
│   └── Each step component is a pure view + form interactions
├── Bottom navigation (Back / Next buttons)
├── Step validation logic
├── Edit-from-preview jump-back logic (returnToPreview flag)
└── Unsaved changes guard (beforeRemove listener)
```

### State Management

- `currentStep: number` (1-7) — tracked in WizardShell
- `returnToPreview: boolean` — set when user taps "Edit" from Preview, cleared when they return
- All form data managed by existing `useRecipeForm` hook
- No new contexts or global state needed

### New API Endpoint

```
POST /api/meal-plan/recipes/generate
Authorization: Bearer <token>

Request:  { prompt: string }
Response: ImportedRecipeData

Uses existing recipe-generation.ts service internals.
Returns data without persisting — user reviews in wizard first.
```
