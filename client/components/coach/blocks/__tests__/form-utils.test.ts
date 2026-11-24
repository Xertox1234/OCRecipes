import { describe, it, expect } from "vitest";
import type { FormBlock } from "@shared/schemas/coach-form";
import {
  canSubmitForm,
  formAnswerMessage,
  formatFormNumber,
  initialFormAnswers,
  stepFormNumber,
  toggleFormOption,
} from "../form-utils";

const servings = {
  kind: "number" as const,
  label: "Servings",
  min: 1,
  max: 8,
  step: 1,
  value: 2,
};

const block: FormBlock = {
  type: "form",
  fields: [
    { kind: "choice", label: "Which meal?", options: ["Lunch", "Dinner"] },
    { kind: "multi_choice", label: "Avoid", options: ["Dairy", "Gluten"] },
    { ...servings, unit: "plates" },
  ],
};

describe("initialFormAnswers", () => {
  it("starts choices empty and numbers at their value", () => {
    expect(initialFormAnswers(block)).toEqual([null, [], 2]);
  });
});

describe("formAnswerMessage", () => {
  it("writes one line per answered field, named by its label", () => {
    expect(formAnswerMessage(block, ["Dinner", ["Dairy", "Gluten"], 3])).toBe(
      "Which meal? Dinner\nAvoid: Dairy, Gluten\nServings: 3 plates",
    );
  });

  it("leaves out a choice with no answer and a multi-choice with none ticked", () => {
    expect(formAnswerMessage(block, [null, [], 2])).toBe("Servings: 2 plates");
  });

  it("ignores an answer that is not one of the field's options", () => {
    expect(formAnswerMessage(block, ["Brunch", ["Dairy", "Nuts"], 2])).toBe(
      "Avoid: Dairy\nServings: 2 plates",
    );
  });
});

describe("canSubmitForm", () => {
  const choiceOnly: FormBlock = { type: "form", fields: [block.fields[0]] };
  it("needs at least one answer", () => {
    expect(canSubmitForm(choiceOnly, [null])).toBe(false);
    expect(canSubmitForm(choiceOnly, ["Lunch"])).toBe(true);
  });
  it("is true for a form with a number, which always has a value", () => {
    expect(canSubmitForm(block, initialFormAnswers(block))).toBe(true);
  });
});

describe("toggleFormOption", () => {
  it("adds and removes, keeping the field's option order", () => {
    const options = ["Dairy", "Gluten", "Soy"];
    expect(toggleFormOption(options, ["Soy"], "Dairy")).toEqual([
      "Dairy",
      "Soy",
    ]);
    expect(toggleFormOption(options, ["Dairy", "Soy"], "Dairy")).toEqual([
      "Soy",
    ]);
  });
});

describe("stepFormNumber", () => {
  it("moves one step and stops at the ends", () => {
    expect(stepFormNumber(servings, 2, 1)).toBe(3);
    expect(stepFormNumber(servings, 1, -1)).toBe(1);
    expect(stepFormNumber(servings, 8, 1)).toBe(8);
  });

  it("stays on the grid with a decimal step (no float drift)", () => {
    const f = { ...servings, min: 0, max: 1, step: 0.1, value: 0 };
    let v = 0;
    for (let i = 0; i < 3; i++) v = stepFormNumber(f, v, 1);
    expect(v).toBe(0.3);
  });
});

describe("formatFormNumber", () => {
  it("shows the step's decimals and groups thousands", () => {
    expect(formatFormNumber({ ...servings, step: 0.5 }, 2)).toBe("2.0");
    expect(formatFormNumber({ ...servings, step: 50 }, 2000)).toBe("2,000");
  });
});
