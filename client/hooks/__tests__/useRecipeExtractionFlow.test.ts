// client/hooks/__tests__/useRecipeExtractionFlow.test.ts
// @vitest-environment jsdom
import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useRecipeExtractionFlow } from "../useRecipeExtractionFlow";
import type { RecipePhotoResult } from "@/lib/photo-upload";

function makeResult(
  overrides: Partial<RecipePhotoResult> = {},
): RecipePhotoResult {
  return {
    title: "Pancakes",
    description: null,
    ingredients: [],
    instructions: null,
    servings: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    cuisine: null,
    dietTags: [],
    caloriesPerServing: null,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    confidence: 0.9,
    ...overrides,
  };
}

describe("useRecipeExtractionFlow", () => {
  it("starts in analyzing state and transitions to review on a passing gate", async () => {
    const mutationFn = vi.fn().mockResolvedValue(makeResult());
    const { result } = renderHook(() =>
      useRecipeExtractionFlow({
        input: "some text",
        mutationFn,
        gateCheck: (data) => !!data.title,
        gateFailureMessage: "gate failed",
        errorCopy: () => "error",
      }),
    );

    expect(result.current.state).toBe("analyzing");
    await waitFor(() => expect(result.current.state).toBe("review"));
    expect(result.current.result?.title).toBe("Pancakes");
    expect(mutationFn).toHaveBeenCalledWith("some text");
  });

  it("transitions to error when the gate check fails", async () => {
    const mutationFn = vi.fn().mockResolvedValue(makeResult({ title: "" }));
    const { result } = renderHook(() =>
      useRecipeExtractionFlow({
        input: "some text",
        mutationFn,
        gateCheck: (data) => !!data.title,
        gateFailureMessage: "Could not extract a recipe.",
        errorCopy: () => "error",
      }),
    );

    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.errorMessage).toBe("Could not extract a recipe.");
  });

  it("transitions to error when the mutation rejects, using errorCopy", async () => {
    const mutationFn = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useRecipeExtractionFlow({
        input: "some text",
        mutationFn,
        gateCheck: () => true,
        gateFailureMessage: "gate failed",
        errorCopy: () => "Friendly error copy",
      }),
    );

    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.errorMessage).toBe("Friendly error copy");
  });

  it("retry re-runs the mutation and can recover from an error", async () => {
    const mutationFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeResult({ title: "Recovered" }));
    const { result } = renderHook(() =>
      useRecipeExtractionFlow({
        input: "some text",
        mutationFn,
        gateCheck: (data) => !!data.title,
        gateFailureMessage: "gate failed",
        errorCopy: () => "error",
      }),
    );

    await waitFor(() => expect(result.current.state).toBe("error"));

    act(() => {
      result.current.retry();
    });

    expect(result.current.state).toBe("analyzing");
    await waitFor(() => expect(result.current.state).toBe("review"));
    expect(result.current.result?.title).toBe("Recovered");
    expect(mutationFn).toHaveBeenCalledTimes(2);
  });
});
