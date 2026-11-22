# Recipe Serving Adjuster Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users adjust recipe serving counts and see ingredient quantities scale proportionally, all client-side.

**Architecture:** Pure utility for fraction math (`serving-scale.ts`), a React hook for state + scaling (`useServingAdjuster`), and a stepper chip component replacing the static servings pill. No backend changes.

**Tech Stack:** React Native, TypeScript, Vitest, Reanimated (not needed here), expo-haptics

**Spec:** `docs/superpowers/specs/2026-04-09-recipe-serving-adjuster-design.md`

---

## File Map

| File                                                        | Action | Responsibility                                                                 |
| ----------------------------------------------------------- | ------ | ------------------------------------------------------------------------------ |
| `client/lib/serving-scale.ts`                               | Create | Pure functions: `parseFraction`, `formatAsFraction`, `scaleIngredientQuantity` |
| `client/lib/__tests__/serving-scale.test.ts`                | Create | Unit tests for all scaling math                                                |
| `client/hooks/useServingAdjuster.ts`                        | Create | Hook: serving state, scaled ingredients, stepper callbacks                     |
| `client/hooks/__tests__/useServingAdjuster.test.ts`         | Create | Hook behavior tests                                                            |
| `client/components/recipe-detail/ServingStepperChip.tsx`    | Create | Interactive stepper chip UI                                                    |
| `client/components/recipe-detail/RecipeMetaChips.tsx`       | Modify | Render `ServingStepperChip` when stepper props provided                        |
| `client/components/recipe-detail/RecipeIngredientsList.tsx` | Modify | Add `annotation` field to `IngredientItem`, render it                          |
| `client/components/recipe-detail/index.ts`                  | Modify | Export `ServingStepperChip`                                                    |
| `client/components/RecipeDetailContent.tsx`                 | Modify | Wire hook, pass scaled data to children                                        |

---

### Task 1: Scaling Utility — Fraction Parsing Tests

**Files:**

- Create: `client/lib/serving-scale.ts`
- Create: `client/lib/__tests__/serving-scale.test.ts`

- [ ] **Step 1: Write failing tests for `parseFraction`**

Create `client/lib/__tests__/serving-scale.test.ts`:

```ts
import { parseFraction } from "../serving-scale";

describe("parseFraction", () => {
  it("parses whole numbers", () => {
    expect(parseFraction("2")).toBe(2);
    expect(parseFraction("10")).toBe(10);
  });

  it("parses decimal strings", () => {
    expect(parseFraction("0.5")).toBe(0.5);
    expect(parseFraction("1.25")).toBe(1.25);
  });

  it("parses simple fractions", () => {
    expect(parseFraction("1/2")).toBeCloseTo(0.5);
    expect(parseFraction("1/3")).toBeCloseTo(0.333, 2);
    expect(parseFraction("3/4")).toBeCloseTo(0.75);
    expect(parseFraction("1/8")).toBeCloseTo(0.125);
  });

  it("parses mixed fractions", () => {
    expect(parseFraction("1 1/2")).toBeCloseTo(1.5);
    expect(parseFraction("2 1/4")).toBeCloseTo(2.25);
    expect(parseFraction("3 3/4")).toBeCloseTo(3.75);
  });

  it("returns null for non-numeric strings", () => {
    expect(parseFraction("to taste")).toBeNull();
    expect(parseFraction("a pinch")).toBeNull();
    expect(parseFraction("")).toBeNull();
    expect(parseFraction("some")).toBeNull();
  });

  it("handles whitespace", () => {
    expect(parseFraction(" 2 ")).toBe(2);
    expect(parseFraction(" 1/2 ")).toBeCloseTo(0.5);
  });
});
```

- [ ] **Step 2: Create minimal `serving-scale.ts` with `parseFraction` stub**

Create `client/lib/serving-scale.ts`:

```ts
/**
 * Parse a quantity string into a number.
 * Handles whole numbers, decimals, simple fractions ("1/2"),
 * and mixed fractions ("1 1/2").
 * Returns null for non-numeric values like "to taste".
 */
export function parseFraction(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Try plain number first (integer or decimal)
  const plain = Number(trimmed);
  if (!isNaN(plain)) return plain;

  // Try mixed fraction: "1 1/2"
  const mixedMatch = trimmed.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10);
    const num = parseInt(mixedMatch[2], 10);
    const den = parseInt(mixedMatch[3], 10);
    if (den === 0) return null;
    return whole + num / den;
  }

  // Try simple fraction: "1/2"
  const fracMatch = trimmed.match(/^(\d+)\/(\d+)$/);
  if (fracMatch) {
    const num = parseInt(fracMatch[1], 10);
    const den = parseInt(fracMatch[2], 10);
    if (den === 0) return null;
    return num / den;
  }

  return null;
}
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run client/lib/__tests__/serving-scale.test.ts`

Expected: All `parseFraction` tests PASS.

- [ ] **Step 4: Commit**

```bash
git add client/lib/serving-scale.ts client/lib/__tests__/serving-scale.test.ts
git commit -m "feat(serving-scale): add parseFraction with tests"
```

---

### Task 2: Scaling Utility — Fraction Formatting

**Files:**

- Modify: `client/lib/serving-scale.ts`
- Modify: `client/lib/__tests__/serving-scale.test.ts`

- [ ] **Step 1: Write failing tests for `formatAsFraction`**

Append to `client/lib/__tests__/serving-scale.test.ts`:

```ts
import { parseFraction, formatAsFraction } from "../serving-scale";

// ... existing parseFraction tests ...

describe("formatAsFraction", () => {
  it("formats whole numbers without fraction", () => {
    expect(formatAsFraction(4)).toBe("4");
    expect(formatAsFraction(1)).toBe("1");
    expect(formatAsFraction(10)).toBe("10");
  });

  it("formats common halves", () => {
    expect(formatAsFraction(0.5)).toBe("1/2");
    expect(formatAsFraction(1.5)).toBe("1 1/2");
    expect(formatAsFraction(2.5)).toBe("2 1/2");
  });

  it("formats common thirds", () => {
    expect(formatAsFraction(1 / 3)).toBe("1/3");
    expect(formatAsFraction(2 / 3)).toBe("2/3");
    expect(formatAsFraction(1 + 1 / 3)).toBe("1 1/3");
  });

  it("formats common quarters", () => {
    expect(formatAsFraction(0.25)).toBe("1/4");
    expect(formatAsFraction(0.75)).toBe("3/4");
    expect(formatAsFraction(2.25)).toBe("2 1/4");
  });

  it("formats eighths", () => {
    expect(formatAsFraction(0.125)).toBe("1/8");
    expect(formatAsFraction(3.125)).toBe("3 1/8");
  });

  it("falls back to 1 decimal for uncommon fractions", () => {
    expect(formatAsFraction(1.67)).toBe("1.7");
    expect(formatAsFraction(0.6)).toBe("0.6");
  });

  it("handles zero", () => {
    expect(formatAsFraction(0)).toBe("0");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client/lib/__tests__/serving-scale.test.ts`

Expected: FAIL — `formatAsFraction` is not exported.

- [ ] **Step 3: Implement `formatAsFraction`**

Add to `client/lib/serving-scale.ts`:

```ts
/** Common cooking fractions: [decimal fractional part, display string] */
const FRACTION_MAP: [number, string][] = [
  [1 / 8, "1/8"],
  [1 / 4, "1/4"],
  [1 / 3, "1/3"],
  [3 / 8, "3/8"],
  [1 / 2, "1/2"],
  [5 / 8, "5/8"],
  [2 / 3, "2/3"],
  [3 / 4, "3/4"],
  [7 / 8, "7/8"],
];

const FRACTION_TOLERANCE = 0.02;

/**
 * Format a number as a cooking-friendly fraction string.
 * Supports ½, ⅓, ¼, ¾, ⅔, ⅛ etc.
 * Falls back to 1 decimal place for uncommon fractions.
 */
export function formatAsFraction(value: number): string {
  if (value < 0) return formatAsFraction(-value);

  const whole = Math.floor(value);
  const frac = value - whole;

  // Pure whole number (or very close)
  if (frac < FRACTION_TOLERANCE) {
    return String(whole);
  }

  // Check if fractional part matches a known cooking fraction
  for (const [target, label] of FRACTION_MAP) {
    if (Math.abs(frac - target) < FRACTION_TOLERANCE) {
      return whole > 0 ? `${whole} ${label}` : label;
    }
  }

  // Check if close to next whole number
  if (1 - frac < FRACTION_TOLERANCE) {
    return String(whole + 1);
  }

  // Fallback: 1 decimal place
  const rounded = parseFloat(value.toFixed(1));
  // Avoid trailing .0
  if (rounded === Math.floor(rounded)) {
    return String(Math.floor(rounded));
  }
  return String(rounded);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run client/lib/__tests__/serving-scale.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/lib/serving-scale.ts client/lib/__tests__/serving-scale.test.ts
git commit -m "feat(serving-scale): add formatAsFraction with tests"
```

---

### Task 3: Scaling Utility — `scaleIngredientQuantity`

**Files:**

- Modify: `client/lib/serving-scale.ts`
- Modify: `client/lib/__tests__/serving-scale.test.ts`

- [ ] **Step 1: Write failing tests for `scaleIngredientQuantity`**

Append to `client/lib/__tests__/serving-scale.test.ts`:

```ts
import {
  parseFraction,
  formatAsFraction,
  scaleIngredientQuantity,
} from "../serving-scale";

// ... existing tests ...

describe("scaleIngredientQuantity", () => {
  it("scales a whole number string", () => {
    expect(scaleIngredientQuantity("500", 2)).toEqual({
      scaled: "1000",
      isNumeric: true,
    });
  });

  it("scales a fraction string", () => {
    expect(scaleIngredientQuantity("1/2", 2)).toEqual({
      scaled: "1",
      isNumeric: true,
    });
  });

  it("scales a mixed fraction", () => {
    expect(scaleIngredientQuantity("1 1/2", 2)).toEqual({
      scaled: "3",
      isNumeric: true,
    });
  });

  it("handles ratio 1 (no change)", () => {
    expect(scaleIngredientQuantity("2", 1)).toEqual({
      scaled: "2",
      isNumeric: true,
    });
  });

  it("handles halving (ratio 0.5)", () => {
    expect(scaleIngredientQuantity("4", 0.5)).toEqual({
      scaled: "2",
      isNumeric: true,
    });
  });

  it("produces fractions when scaling creates them", () => {
    // 1 tsp scaled by 1.5 (2 servings → 3 servings) = 1.5 = "1 1/2"
    expect(scaleIngredientQuantity("1", 1.5)).toEqual({
      scaled: "1 1/2",
      isNumeric: true,
    });
  });

  it("handles number type input", () => {
    expect(scaleIngredientQuantity(4, 2)).toEqual({
      scaled: "8",
      isNumeric: true,
    });
  });

  it("returns isNumeric false for non-numeric strings", () => {
    expect(scaleIngredientQuantity("to taste", 2)).toEqual({
      scaled: null,
      isNumeric: false,
    });
    expect(scaleIngredientQuantity("a pinch", 3)).toEqual({
      scaled: null,
      isNumeric: false,
    });
  });

  it("returns isNumeric false for null/undefined", () => {
    expect(scaleIngredientQuantity(null, 2)).toEqual({
      scaled: null,
      isNumeric: false,
    });
    expect(scaleIngredientQuantity(undefined, 2)).toEqual({
      scaled: null,
      isNumeric: false,
    });
  });

  it("returns isNumeric false for empty string", () => {
    expect(scaleIngredientQuantity("", 2)).toEqual({
      scaled: null,
      isNumeric: false,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client/lib/__tests__/serving-scale.test.ts`

Expected: FAIL — `scaleIngredientQuantity` is not exported.

- [ ] **Step 3: Implement `scaleIngredientQuantity`**

Add to `client/lib/serving-scale.ts`:

```ts
/**
 * Scale an ingredient quantity by the given ratio.
 * Returns the formatted scaled quantity and whether the input was numeric.
 */
export function scaleIngredientQuantity(
  quantity: string | number | null | undefined,
  ratio: number,
): { scaled: string | null; isNumeric: boolean } {
  if (quantity == null) return { scaled: null, isNumeric: false };

  // Number type: scale directly
  if (typeof quantity === "number") {
    return { scaled: formatAsFraction(quantity * ratio), isNumeric: true };
  }

  // String type: try parsing
  const parsed = parseFraction(quantity);
  if (parsed === null) {
    return { scaled: null, isNumeric: false };
  }

  return { scaled: formatAsFraction(parsed * ratio), isNumeric: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run client/lib/__tests__/serving-scale.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/lib/serving-scale.ts client/lib/__tests__/serving-scale.test.ts
git commit -m "feat(serving-scale): add scaleIngredientQuantity with tests"
```

---

### Task 4: `useServingAdjuster` Hook

**Files:**

- Create: `client/hooks/useServingAdjuster.ts`
- Create: `client/hooks/__tests__/useServingAdjuster.test.ts`
- Read: `client/components/recipe-detail/RecipeIngredientsList.tsx` (for `IngredientItem` type)

- [ ] **Step 1: Write failing tests for the hook**

Create `client/hooks/__tests__/useServingAdjuster.test.ts`:

```ts
import { renderHook, act } from "@testing-library/react-native";
import { useServingAdjuster } from "../useServingAdjuster";
import type { IngredientItem } from "@/components/recipe-detail";

const SAMPLE_INGREDIENTS: IngredientItem[] = [
  { name: "ground beef", quantity: "500", unit: "g" },
  { name: "salt", quantity: "1", unit: "tsp" },
  { name: "black pepper", quantity: "1/2", unit: "tsp" },
  { name: "burger buns", quantity: "4", unit: null },
  { name: "hot sauce", quantity: "to taste", unit: null },
];

describe("useServingAdjuster", () => {
  it("returns original quantities when servingCount equals originalServings", () => {
    const { result } = renderHook(() =>
      useServingAdjuster(2, SAMPLE_INGREDIENTS),
    );
    expect(result.current.servingCount).toBe(2);
    expect(result.current.isAdjusted).toBe(false);
    expect(result.current.scaledIngredients[0].quantity).toBe("500");
    expect(result.current.scaledIngredients[2].quantity).toBe("1/2");
  });

  it("scales quantities when servingCount changes via increment", () => {
    const { result } = renderHook(() =>
      useServingAdjuster(2, SAMPLE_INGREDIENTS),
    );
    act(() => result.current.increment());
    act(() => result.current.increment());
    // Now 4 servings (ratio 2)
    expect(result.current.servingCount).toBe(4);
    expect(result.current.isAdjusted).toBe(true);
    expect(result.current.scaledIngredients[0].quantity).toBe("1000");
    expect(result.current.scaledIngredients[1].quantity).toBe("2");
    expect(result.current.scaledIngredients[2].quantity).toBe("1");
    expect(result.current.scaledIngredients[3].quantity).toBe("8");
  });

  it("annotates non-numeric quantities when adjusted", () => {
    const { result } = renderHook(() =>
      useServingAdjuster(2, SAMPLE_INGREDIENTS),
    );
    act(() => result.current.increment());
    const hotSauce = result.current.scaledIngredients[4];
    expect(hotSauce.quantity).toBe("to taste");
    expect(hotSauce.annotation).toBe("(adjust for 3 servings)");
  });

  it("does not annotate non-numeric quantities when not adjusted", () => {
    const { result } = renderHook(() =>
      useServingAdjuster(2, SAMPLE_INGREDIENTS),
    );
    const hotSauce = result.current.scaledIngredients[4];
    expect(hotSauce.annotation).toBeUndefined();
  });

  it("clamps decrement at 1", () => {
    const { result } = renderHook(() =>
      useServingAdjuster(1, SAMPLE_INGREDIENTS),
    );
    act(() => result.current.decrement());
    expect(result.current.servingCount).toBe(1);
  });

  it("clamps increment at 99", () => {
    const { result } = renderHook(() =>
      useServingAdjuster(99, SAMPLE_INGREDIENTS),
    );
    act(() => result.current.increment());
    expect(result.current.servingCount).toBe(99);
  });

  it("setServings clamps to 1–99 range", () => {
    const { result } = renderHook(() =>
      useServingAdjuster(2, SAMPLE_INGREDIENTS),
    );
    act(() => result.current.setServings(0));
    expect(result.current.servingCount).toBe(1);
    act(() => result.current.setServings(150));
    expect(result.current.servingCount).toBe(99);
  });

  it("reset returns to original servings", () => {
    const { result } = renderHook(() =>
      useServingAdjuster(2, SAMPLE_INGREDIENTS),
    );
    act(() => result.current.setServings(6));
    expect(result.current.isAdjusted).toBe(true);
    act(() => result.current.reset());
    expect(result.current.servingCount).toBe(2);
    expect(result.current.isAdjusted).toBe(false);
  });

  it("preserves non-quantity fields on scaled ingredients", () => {
    const { result } = renderHook(() =>
      useServingAdjuster(2, SAMPLE_INGREDIENTS),
    );
    act(() => result.current.increment());
    expect(result.current.scaledIngredients[0].name).toBe("ground beef");
    expect(result.current.scaledIngredients[0].unit).toBe("g");
  });

  it("does not mutate original ingredients array", () => {
    const ingredients = [{ name: "flour", quantity: "2", unit: "cups" }];
    const original = JSON.parse(JSON.stringify(ingredients));
    const { result } = renderHook(() => useServingAdjuster(2, ingredients));
    act(() => result.current.setServings(4));
    expect(ingredients).toEqual(original);
  });

  it("defaults null originalServings to 1", () => {
    const { result } = renderHook(() =>
      useServingAdjuster(null as unknown as number, SAMPLE_INGREDIENTS),
    );
    expect(result.current.servingCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run client/hooks/__tests__/useServingAdjuster.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook**

Create `client/hooks/useServingAdjuster.ts`:

```ts
import { useCallback, useMemo, useState } from "react";
import type { IngredientItem } from "@/components/recipe-detail";
import { scaleIngredientQuantity } from "@/lib/serving-scale";

const MIN_SERVINGS = 1;
const MAX_SERVINGS = 99;

export interface ScaledIngredientItem extends IngredientItem {
  annotation?: string;
}

export function useServingAdjuster(
  originalServings: number,
  ingredients: IngredientItem[],
) {
  const safeOriginal = originalServings || 1;
  const [servingCount, setServingCount] = useState(safeOriginal);

  const isAdjusted = servingCount !== safeOriginal;
  const ratio = servingCount / safeOriginal;

  const scaledIngredients = useMemo((): ScaledIngredientItem[] => {
    return ingredients.map((ing) => {
      const { scaled, isNumeric } = scaleIngredientQuantity(
        ing.quantity,
        ratio,
      );

      if (isNumeric && scaled !== null) {
        return { ...ing, quantity: scaled };
      }

      // Non-numeric: keep original, add annotation if adjusted
      if (isAdjusted) {
        return {
          ...ing,
          annotation: `(adjust for ${servingCount} servings)`,
        };
      }
      return { ...ing };
    });
  }, [ingredients, ratio, isAdjusted, servingCount]);

  const increment = useCallback(() => {
    setServingCount((prev) => Math.min(prev + 1, MAX_SERVINGS));
  }, []);

  const decrement = useCallback(() => {
    setServingCount((prev) => Math.max(prev - 1, MIN_SERVINGS));
  }, []);

  const setServings = useCallback((n: number) => {
    setServingCount(
      Math.max(MIN_SERVINGS, Math.min(MAX_SERVINGS, Math.round(n))),
    );
  }, []);

  const reset = useCallback(() => {
    setServingCount(safeOriginal);
  }, [safeOriginal]);

  return {
    servingCount,
    scaledIngredients,
    isAdjusted,
    increment,
    decrement,
    setServings,
    reset,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run client/hooks/__tests__/useServingAdjuster.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add client/hooks/useServingAdjuster.ts client/hooks/__tests__/useServingAdjuster.test.ts
git commit -m "feat: add useServingAdjuster hook with tests"
```

---

### Task 5: `ServingStepperChip` Component

**Files:**

- Create: `client/components/recipe-detail/ServingStepperChip.tsx`
- Modify: `client/components/recipe-detail/index.ts`

- [ ] **Step 1: Create `ServingStepperChip`**

Create `client/components/recipe-detail/ServingStepperChip.tsx`:

```tsx
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface ServingStepperChipProps {
  servingCount: number;
  isAdjusted: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onSetServings: (n: number) => void;
}

export function ServingStepperChip({
  servingCount,
  isAdjusted,
  onIncrement,
  onDecrement,
  onSetServings,
}: ServingStepperChipProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const handleIncrement = useCallback(() => {
    haptics.impact();
    onIncrement();
  }, [haptics, onIncrement]);

  const handleDecrement = useCallback(() => {
    haptics.impact();
    onDecrement();
  }, [haptics, onDecrement]);

  const handleNumberPress = useCallback(() => {
    setEditValue(String(servingCount));
    setIsEditing(true);
  }, [servingCount]);

  const handleSubmitEditing = useCallback(() => {
    setIsEditing(false);
    const parsed = parseInt(editValue, 10);
    if (!isNaN(parsed) && parsed > 0) {
      onSetServings(parsed);
    }
    // If invalid, reverts to current servingCount (no-op)
  }, [editValue, onSetServings]);

  const pillBackground = isAdjusted
    ? withOpacity(theme.link, 0.1)
    : withOpacity(theme.text, 0.06);

  return (
    <View
      style={[styles.chip, { backgroundColor: pillBackground }]}
      accessibilityRole="adjustable"
      accessibilityLabel={`${servingCount} servings`}
      accessibilityHint="Tap plus or minus to adjust servings"
      accessibilityActions={[
        { name: "increment", label: "Increase servings" },
        { name: "decrement", label: "Decrease servings" },
      ]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "increment") onIncrement();
        if (event.nativeEvent.actionName === "decrement") onDecrement();
      }}
    >
      <Pressable
        onPress={handleDecrement}
        hitSlop={8}
        accessibilityLabel="Decrease servings"
        accessibilityRole="button"
      >
        <Feather
          name="minus"
          size={12}
          color={isAdjusted ? theme.link : theme.textSecondary}
        />
      </Pressable>

      {isEditing ? (
        <TextInput
          style={[styles.editInput, { color: theme.text }]}
          value={editValue}
          onChangeText={setEditValue}
          onBlur={handleSubmitEditing}
          onSubmitEditing={handleSubmitEditing}
          keyboardType="number-pad"
          selectTextOnFocus
          autoFocus
          maxLength={2}
        />
      ) : (
        <Pressable onPress={handleNumberPress}>
          <ThemedText
            style={[
              styles.countText,
              {
                color: isAdjusted ? theme.link : theme.textSecondary,
              },
            ]}
          >
            <Feather
              name="users"
              size={12}
              color={isAdjusted ? theme.link : theme.textSecondary}
            />{" "}
            {servingCount}
          </ThemedText>
        </Pressable>
      )}

      <Pressable
        onPress={handleIncrement}
        hitSlop={8}
        accessibilityLabel="Increase servings"
        accessibilityRole="button"
      >
        <Feather
          name="plus"
          size={12}
          color={isAdjusted ? theme.link : theme.textSecondary}
        />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  countText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
  editInput: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
    minWidth: 24,
    textAlign: "center",
    padding: 0,
  },
});
```

- [ ] **Step 2: Export from barrel**

In `client/components/recipe-detail/index.ts`, add the export:

```ts
export { ServingStepperChip } from "./ServingStepperChip";
```

- [ ] **Step 3: Run type check**

Run: `npm run check:types`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add client/components/recipe-detail/ServingStepperChip.tsx client/components/recipe-detail/index.ts
git commit -m "feat: add ServingStepperChip component"
```

---

### Task 6: Update `RecipeMetaChips` to Support Stepper Mode

**Files:**

- Modify: `client/components/recipe-detail/RecipeMetaChips.tsx`

- [ ] **Step 1: Add optional stepper props and conditional rendering**

Update `RecipeMetaChips.tsx`. The interface gains optional stepper props. When present, render `ServingStepperChip` instead of the static pill:

```tsx
import React from "react";
import { StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { ThemedText } from "@/components/ThemedText";
import { ServingStepperChip } from "./ServingStepperChip";
import { useTheme } from "@/hooks/useTheme";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";

interface RecipeMetaChipsProps {
  timeDisplay?: string | null;
  difficulty?: string | null;
  servings?: number | null;
  /** When provided, renders an interactive stepper instead of static servings chip */
  servingCount?: number;
  isAdjusted?: boolean;
  onIncrement?: () => void;
  onDecrement?: () => void;
  onSetServings?: (n: number) => void;
}

export function RecipeMetaChips({
  timeDisplay,
  difficulty,
  servings,
  servingCount,
  isAdjusted,
  onIncrement,
  onDecrement,
  onSetServings,
}: RecipeMetaChipsProps) {
  const { theme } = useTheme();

  const hasStepperProps =
    servingCount != null &&
    onIncrement != null &&
    onDecrement != null &&
    onSetServings != null;

  if (!timeDisplay && !difficulty && !servings && !hasStepperProps) return null;

  return (
    <View style={styles.metaRow}>
      {timeDisplay && (
        <View
          style={[
            styles.metaPill,
            { backgroundColor: withOpacity(theme.text, 0.06) },
          ]}
        >
          <Feather name="clock" size={12} color={theme.textSecondary} />
          <ThemedText style={[styles.metaText, { color: theme.textSecondary }]}>
            {timeDisplay}
          </ThemedText>
        </View>
      )}
      {difficulty && (
        <View
          style={[
            styles.metaPill,
            { backgroundColor: withOpacity(theme.text, 0.06) },
          ]}
        >
          <Feather name="bar-chart-2" size={12} color={theme.textSecondary} />
          <ThemedText style={[styles.metaText, { color: theme.textSecondary }]}>
            {difficulty}
          </ThemedText>
        </View>
      )}
      {hasStepperProps ? (
        <ServingStepperChip
          servingCount={servingCount}
          isAdjusted={isAdjusted ?? false}
          onIncrement={onIncrement}
          onDecrement={onDecrement}
          onSetServings={onSetServings}
        />
      ) : (
        servings != null && (
          <View
            style={[
              styles.metaPill,
              { backgroundColor: withOpacity(theme.text, 0.06) },
            ]}
          >
            <Feather name="users" size={12} color={theme.textSecondary} />
            <ThemedText
              style={[styles.metaText, { color: theme.textSecondary }]}
            >
              {servings} servings
            </ThemedText>
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.chip,
  },
  metaText: {
    fontSize: 12,
    fontFamily: FontFamily.medium,
  },
});
```

- [ ] **Step 2: Run type check**

Run: `npm run check:types`

Expected: No type errors. Existing call sites (if any use `RecipeMetaChips` without stepper props) continue to work — all new props are optional.

- [ ] **Step 3: Commit**

```bash
git add client/components/recipe-detail/RecipeMetaChips.tsx
git commit -m "feat: update RecipeMetaChips to support stepper mode"
```

---

### Task 7: Update `RecipeIngredientsList` for Annotation Support

**Files:**

- Modify: `client/components/recipe-detail/RecipeIngredientsList.tsx`

- [ ] **Step 1: Add `annotation` to `IngredientItem` and render it**

In `client/components/recipe-detail/RecipeIngredientsList.tsx`, update the `IngredientItem` interface and the render logic:

Update the interface (line 16-21):

```ts
export interface IngredientItem {
  id?: number;
  name: string;
  quantity?: string | number | null;
  unit?: string | null;
  annotation?: string;
}
```

In the ingredient row's inner `<View style={{ flex: 1 }}>` block, add the annotation rendering after the allergen badge and substitution blocks (after the `substitutionsByName` map, around line 140):

```tsx
{
  ing.annotation && (
    <ThemedText style={[styles.annotationText, { color: theme.textSecondary }]}>
      {ing.annotation}
    </ThemedText>
  );
}
```

Add to the `styles` StyleSheet:

```ts
annotationText: {
  fontSize: 12,
  fontFamily: FontFamily.regular,
  fontStyle: "italic",
  marginTop: 2,
},
```

- [ ] **Step 2: Run type check**

Run: `npm run check:types`

Expected: No type errors. The `annotation` field is optional so existing usage is unaffected.

- [ ] **Step 3: Commit**

```bash
git add client/components/recipe-detail/RecipeIngredientsList.tsx
git commit -m "feat: add annotation rendering to RecipeIngredientsList"
```

---

### Task 8: Wire Everything in `RecipeDetailContent`

**Files:**

- Modify: `client/components/RecipeDetailContent.tsx`

- [ ] **Step 1: Import the hook and pass data to children**

In `client/components/RecipeDetailContent.tsx`:

Add import at the top:

```ts
import { useServingAdjuster } from "@/hooks/useServingAdjuster";
```

Inside the `RecipeDetailContent` function body, after the existing hooks (around line 66, after `const [showUpgrade, setShowUpgrade] = useState(false);`), add:

```ts
const {
  servingCount,
  scaledIngredients,
  isAdjusted,
  increment,
  decrement,
  setServings,
} = useServingAdjuster(props.servings ?? 1, props.ingredients ?? []);
```

Update the `RecipeMetaChips` usage (around line 210) to pass stepper props:

```tsx
<RecipeMetaChips
  timeDisplay={props.timeDisplay}
  difficulty={props.difficulty}
  servings={props.servings}
  servingCount={servingCount}
  isAdjusted={isAdjusted}
  onIncrement={increment}
  onDecrement={decrement}
  onSetServings={setServings}
/>
```

Update the `RecipeIngredientsList` usage (around line 254) to use scaled ingredients:

```tsx
{
  scaledIngredients.length > 0 && (
    <RecipeIngredientsList
      ingredients={scaledIngredients}
      allergenResult={allergenResult}
    />
  );
}
```

Note: The condition changes from `props.ingredients && props.ingredients.length > 0` to `scaledIngredients.length > 0`. Since `useServingAdjuster` is called with `props.ingredients ?? []`, `scaledIngredients` will be empty when there are no ingredients.

- [ ] **Step 2: Run type check**

Run: `npm run check:types`

Expected: No type errors.

- [ ] **Step 3: Run full test suite**

Run: `npm run test:run`

Expected: All tests PASS (existing + new).

- [ ] **Step 4: Commit**

```bash
git add client/components/RecipeDetailContent.tsx
git commit -m "feat: wire serving adjuster into RecipeDetailContent"
```

---

### Task 9: Final Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full test suite**

Run: `npm run test:run`

Expected: All tests PASS.

- [ ] **Step 2: Run linter**

Run: `npm run lint`

Expected: No errors.

- [ ] **Step 3: Run type check**

Run: `npm run check:types`

Expected: No type errors.

- [ ] **Step 4: Verify no regressions in the recipe detail screens**

Check that `RecipeMetaChips` is used in the codebase and confirm no call sites break:

Run: `grep -rn "RecipeMetaChips" client/ --include="*.tsx" --include="*.ts"`

Expected: Only `RecipeDetailContent.tsx` and the barrel export use it. The new optional props don't break any existing usage.
