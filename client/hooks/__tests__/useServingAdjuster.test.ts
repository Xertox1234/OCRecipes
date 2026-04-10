// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
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
