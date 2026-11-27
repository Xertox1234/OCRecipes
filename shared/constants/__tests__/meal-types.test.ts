import { describe, it, expect } from "vitest";
import { MEAL_TYPES, mealTypeSchema } from "../meal-types";
import { writeCardMealTypeSchema } from "../../schemas/coach-write-cards";
import { recipeQuerySchema } from "../../schemas/recipe-finder";
import { createListingBodySchema } from "../../schemas/inspired-recipes";
import { MEAL_TYPES as COACH_TOOL_MEAL_TYPES } from "../../../server/services/coach-tools/types";

// Coach chat audit 2026-11-24, L129: the coach and finder schemas read one
// meal-type list, so adding or renaming a type is a one-line edit.
describe("MEAL_TYPES", () => {
  it("is the list the coach and finder schemas accept", () => {
    expect(mealTypeSchema.options).toEqual([...MEAL_TYPES]);
    expect(writeCardMealTypeSchema.options).toEqual([...MEAL_TYPES]);
    expect(recipeQuerySchema.shape.mealType.unwrap().options).toEqual([
      ...MEAL_TYPES,
    ]);
    expect(createListingBodySchema.shape.mealType.unwrap().options).toEqual([
      ...MEAL_TYPES,
    ]);
    expect(COACH_TOOL_MEAL_TYPES).toBe(MEAL_TYPES);
  });
});
