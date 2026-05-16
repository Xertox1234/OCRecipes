# Documentation Patterns

### Todo Structure

All todos in `todos/` follow the template in `todos/TEMPLATE.md`:

```yaml
---
title: "Brief descriptive title"
status: backlog | planned | in-progress | blocked | review | done
priority: critical | high | medium | low
created: YYYY-MM-DD
updated: YYYY-MM-DD
assignee:
labels: []
---
```

### Design Decisions Table

Document key architectural choices with rationale:

```markdown
## Design Decisions

| Decision     | Choice              | Rationale                   |
| ------------ | ------------------- | --------------------------- |
| Token type   | Single access token | No refresh token complexity |
| Token expiry | 30 days             | Balances security with UX   |
```

### Files to Modify Table

List all files affected by a change:

```markdown
## Files to Modify

| File                   | Action                      |
| ---------------------- | --------------------------- |
| `shared/types/auth.ts` | Create - type definitions   |
| `server/routes.ts`     | Modify - use new middleware |
```

### Implementation Patterns in Todos

Include copy-paste ready code examples in todos for complex changes. This ensures:

- Consistent implementation
- Faster development
- Built-in code review

### Bottom-Sheet Lifecycle State Machine

Use a ref-based state machine to prevent race conditions when a screen has bottom sheets and async save operations. The ref (not state) is correct here since transitions are synchronous guards, not rendering triggers.

**When to use:** Any screen with `BottomSheetModal` that also has save/submit actions.

**When NOT to use:** Simple modals with no async operations.

```typescript
import { useRef } from "react";
import type { SheetLifecycleState } from "@/components/recipe-builder/types";

// "IDLE" = no sheet open, can open or save
// "SHEET_OPEN" = sheet is presented, block save and other sheets
// "SAVING" = mutation in flight, block everything
const sheetState = useRef<SheetLifecycleState>("IDLE");

const openSheet = (section: SheetSection) => {
  if (sheetState.current !== "IDLE") return; // gate
  sheetState.current = "SHEET_OPEN";
  // ... present sheet
};

const handleSheetDismiss = () => {
  sheetState.current = "IDLE";
};

const handleSave = async () => {
  if (sheetState.current !== "IDLE") return; // gate
  sheetState.current = "SAVING";
  try {
    await mutation.mutateAsync(payload);
  } catch {
    sheetState.current = "IDLE"; // reset on failure
  }
};
```

### Keyboard-to-Sheet Sequencing

Dismiss the keyboard and wait for animations to settle before presenting a bottom sheet. Without this, the keyboard dismiss and sheet present animations collide on iOS, causing visual glitches or the sheet opening behind the keyboard.

**When to use:** Any screen where a `TextInput` might have focus when the user taps to open a `BottomSheetModal`.

**When NOT to use:** Sheets that don't coexist with text inputs.

```typescript
import { Keyboard, InteractionManager } from "react-native";

const openSheet = (section: SheetSection) => {
  Keyboard.dismiss();
  InteractionManager.runAfterInteractions(() => {
    sheetRefs[section].current?.present();
  });
};
```

### Lazy Modal Mounting

Defer mounting heavy modal/sheet components until the user first opens them. Use a `Set` in state to track which modals have been requested, then conditionally render.

**When to use:** Screens with 3+ `BottomSheetModal` or heavy modal components that most users won't all open.

**When NOT to use:** Single-modal screens or modals that must be ready immediately.

```typescript
const [mountedSheets, setMountedSheets] = React.useState<Set<SheetSection>>(
  new Set(),
);

const openSheet = (section: SheetSection) => {
  setMountedSheets((prev) => {
    if (prev.has(section)) return prev; // avoid unnecessary re-render
    const next = new Set(prev);
    next.add(section);
    return next;
  });
  // ... then present
};

// In JSX — sheet only enters tree on first open, stays mounted after
{mountedSheets.has("ingredients") && (
  <BottomSheetModal ref={ingredientsRef} ...>
    <IngredientsSheet />
  </BottomSheetModal>
)}
```

### Module-Level Key Counters for Dynamic Lists

Use module-level counters to generate stable, globally unique keys for dynamic form list items (ingredients, steps, etc.). Avoids React's index-as-key anti-pattern, timestamp collisions, and key reuse across component re-mounts.

**When to use:** Any form with a dynamic list where items can be added, removed, or reordered — especially when items contain `TextInput` that would lose focus on re-key.

**When NOT to use:** Static lists or lists with server-assigned IDs.

```typescript
// client/hooks/useRecipeForm.ts

// Module-level — persists across mounts, ensures globally unique keys
let ingredientKeyCounter = 0;
function nextIngredientKey() {
  return `ing_${++ingredientKeyCounter}`;
}

// Usage in hook
const addIngredient = useCallback(() => {
  setIngredients((prev) => [...prev, { key: nextIngredientKey(), text: "" }]);
}, []);

// Prefill also uses the counter to avoid collisions
function buildIngredientsFromPrefill(
  prefill?: ImportedRecipeData,
): IngredientRow[] {
  if (prefill?.ingredients?.length) {
    return prefill.ingredients.map((ing) => ({
      key: nextIngredientKey(),
      text: [ing.quantity, ing.unit, ing.name].filter(Boolean).join(" "),
    }));
  }
  return [{ key: nextIngredientKey(), text: "" }];
}
```

### Unsaved Changes Navigation Guard

Use React Navigation's `beforeRemove` listener to block navigation when a form has unsaved changes. Also block navigation while a save mutation is in flight to prevent double-submits or data loss.

**When to use:** Any form screen with a save/submit action where accidental back-navigation would lose user input.

**When NOT to use:** Read-only screens or screens where state is already synced to the server in real time.

```typescript
// client/screens/meal-plan/RecipeCreateScreen.tsx

useEffect(() => {
  const unsubscribe = navigation.addListener("beforeRemove", (e) => {
    // Block navigation during save
    if (createMutation.isPending) {
      e.preventDefault();
      return;
    }

    // Allow navigation if form is clean
    if (!form.isDirty) return;

    // Prompt for unsaved changes
    e.preventDefault();
    Alert.alert("Discard changes?", "You have unsaved changes.", [
      { text: "Keep editing", style: "cancel" },
      {
        text: "Discard",
        style: "destructive",
        onPress: () => navigation.dispatch(e.data.action),
      },
    ]);
  });

  return unsubscribe;
}, [navigation, form.isDirty, createMutation.isPending]);
```

**Key details:**

- `isPending` check prevents back-swipe during save, avoiding partial writes
- `isDirty` comes from the form hook (see below), not manual tracking
- Both values must be in the dependency array so the listener re-binds when they change

### Form State Hook with Summaries and isDirty

Extract multi-section form state into a custom hook that provides: state + setters, CRUD actions for dynamic lists, `useMemo`-derived summaries for display, a single `isDirty` flag, and a `formToPayload()` serializer. This keeps the screen component focused on layout and navigation.

**When to use:** Forms with 3+ distinct sections, especially with dynamic lists and a summary/preview UI.

**When NOT to use:** Simple single-field forms or forms where TanStack Form or React Hook Form is already in use.

```typescript
// client/hooks/useRecipeForm.ts

export function useRecipeForm(prefill?: ImportedRecipeData) {
  const [title, setTitle] = useState(prefill?.title || "");
  const [ingredients, setIngredients] = useState<IngredientRow[]>(() =>
    buildIngredientsFromPrefill(prefill),
  );
  // ... more sections

  // Computed summary for section row display
  const ingredientsSummary = useMemo(() => {
    const filled = ingredients.filter((i) => i.text.trim());
    return filled.length > 0
      ? `${filled.length} ingredient${filled.length !== 1 ? "s" : ""}`
      : undefined;
  }, [ingredients]);

  // Single dirty flag across all sections
  const isDirty = useMemo(() => {
    if (title.trim()) return true;
    if (ingredients.some((i) => i.text.trim())) return true;
    // ... check all sections
    return false;
  }, [title, ingredients /* ... all sections */]);

  // Serialize to API payload — filters empty rows, parses text to structured data
  const formToPayload = useCallback(() => {
    const validIngredients = ingredients
      .filter((i) => i.text.trim())
      .map((i) => {
        const parsed = parseIngredientText(i.text.trim());
        return {
          name: parsed.name,
          quantity: parsed.quantity,
          unit: parsed.unit,
        };
      });

    return {
      title: title.trim(),
      ingredients: validIngredients,
      instructions:
        serializeSteps(steps.filter((s) => s.text.trim()).map((s) => s.text)) ||
        null,
      // ... other fields
    };
  }, [title, ingredients, steps /* ... */]);

  return {
    title,
    setTitle,
    ingredients,
    addIngredient,
    removeIngredient,
    updateIngredient,
    ingredientsSummary,
    isDirty,
    formToPayload,
    // ... rest
  };
}
```

**Key details:**

- Summaries update automatically via `useMemo` — no manual "refresh" needed
- `isDirty` checks all sections, not just the one being edited
- `formToPayload()` handles the text → structured data transformation (e.g., "200g chicken" → `{ name: "chicken", quantity: 200, unit: "g" }`)
- Accepts optional `prefill` for hydrating from imports or edits

### Auto-Dismiss Snackbar with useRef Timer

For ephemeral UI prompts (snackbar notifications, toast messages) that should auto-dismiss after a timeout, use `useRef` for the timer ID and `useEffect` cleanup to prevent memory leaks on unmount.

```typescript
const [snackbarItem, setSnackbarItem] = useState<Item | null>(null);

// Use useRef for timer — pass `undefined` as initial value (React 19 requires it)
const dismissTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

useEffect(() => {
  if (snackbarItem) {
    dismissTimerRef.current = setTimeout(() => {
      setSnackbarItem(null);
    }, 5000);
  }
  // Cleanup: clear timer on unmount or when snackbarItem changes
  return () => clearTimeout(dismissTimerRef.current);
}, [snackbarItem]);

// Trigger snackbar from an action callback
const handleItemChecked = useCallback((item: Item) => {
  // Show snackbar prompt
  setSnackbarItem(item);
}, []);

// Manual dismiss
const handleDismiss = useCallback(() => {
  setSnackbarItem(null);
}, []);
```

**When to use:**

- Snackbar/toast prompts that appear after a user action and auto-dismiss
- Any ephemeral UI that needs a timeout with proper cleanup

**When NOT to use:**

- Persistent notifications that require explicit user dismissal
- Alert dialogs that block interaction

**Key details:**

1. **`useRef` for timer ID** — avoids stale closure issues and survives re-renders
2. **`useEffect` cleanup** — clears the timer if the component unmounts or the trigger item changes before the timeout fires
3. **React 19 requires explicit initial value** — `useRef<T>()` without an argument causes a TypeScript error; pass `undefined`
4. **null state = hidden** — render the snackbar conditionally: `{snackbarItem && <Snackbar ... />}`

**References:**

- `client/screens/meal-plan/GroceryListScreen.tsx` — pantry prompt snackbar with auto-dismiss
- Related learning: "React 19 useRef Requires Initial Value" in LEARNINGS.md
