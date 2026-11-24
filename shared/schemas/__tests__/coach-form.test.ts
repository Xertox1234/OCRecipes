import { describe, it, expect } from "vitest";
import { formBlockSchema } from "../coach-form";
import { coachBlockSchema } from "../coach-blocks";

const choice = {
  kind: "choice" as const,
  label: "Which meal?",
  options: ["Breakfast", "Lunch", "Dinner"],
};
const multi = {
  kind: "multi_choice" as const,
  label: "Anything to avoid?",
  options: ["Dairy", "Gluten"],
};
const number = {
  kind: "number" as const,
  label: "Servings",
  min: 1,
  max: 8,
  step: 1,
  value: 2,
};

describe("formBlockSchema", () => {
  it("accepts a form with one field of each kind", () => {
    const parsed = formBlockSchema.safeParse({
      type: "form",
      title: "A few details",
      fields: [choice, multi, { ...number, unit: "g" }],
      submitLabel: "Send",
    });
    expect(parsed.success).toBe(true);
  });

  it("is registered in the coach block union", () => {
    expect(
      coachBlockSchema.safeParse({ type: "form", fields: [choice] }).success,
    ).toBe(true);
  });

  it("needs 1 to 4 fields", () => {
    expect(
      formBlockSchema.safeParse({ type: "form", fields: [] }).success,
    ).toBe(false);
    expect(
      formBlockSchema.safeParse({
        type: "form",
        fields: [choice, choice, choice, choice, choice],
      }).success,
    ).toBe(false);
  });

  it("refuses a choice with fewer than 2 options, more than 6, or repeats", () => {
    const withOptions = (options: string[]) =>
      formBlockSchema.safeParse({
        type: "form",
        fields: [{ ...choice, options }],
      }).success;
    expect(withOptions(["Only"])).toBe(false);
    expect(withOptions(["1", "2", "3", "4", "5", "6", "7"])).toBe(false);
    expect(withOptions(["Same", "same "])).toBe(false);
  });

  it("refuses two fields with the same label", () => {
    expect(
      formBlockSchema.safeParse({ type: "form", fields: [choice, choice] })
        .success,
    ).toBe(false);
  });

  it.each([
    ["value below min", { value: 0 }],
    ["value above max", { value: 9 }],
    ["min not below max", { min: 8 }],
    ["a zero step", { step: 0 }],
    ["a value off the step grid", { value: 2.5 }],
    ["more than 200 steps", { min: 0, max: 5000, value: 0 }],
  ])("refuses a number field with %s", (_name, over) => {
    expect(
      formBlockSchema.safeParse({
        type: "form",
        fields: [{ ...number, ...over }],
      }).success,
    ).toBe(false);
  });

  it("accepts a decimal step whose grid holds the value", () => {
    expect(
      formBlockSchema.safeParse({
        type: "form",
        fields: [{ ...number, min: 0.5, max: 3, step: 0.5, value: 1.5 }],
      }).success,
    ).toBe(true);
  });

  it("trims text and refuses over-long labels", () => {
    const parsed = formBlockSchema.parse({
      type: "form",
      fields: [{ ...choice, label: "  Which meal?  " }],
    });
    expect(parsed.fields[0].label).toBe("Which meal?");
    expect(
      formBlockSchema.safeParse({
        type: "form",
        fields: [{ ...choice, label: "x".repeat(121) }],
      }).success,
    ).toBe(false);
  });
});
