import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  recipeChatCasesSchema,
  mealSuggestionCasesSchema,
  recipeGenCasesSchema,
} from "../lib/dataset-schemas";
import { evalTestCasesSchema } from "../types";

const datasetsDir = path.join(__dirname, "..", "datasets");

function loadDataset(filename: string): unknown {
  const raw = fs.readFileSync(path.join(datasetsDir, filename), "utf8");
  return JSON.parse(raw);
}

function assertDataset(
  schema: {
    safeParse: (
      v: unknown,
    ) => {
      success: boolean;
      error?: { errors: { path: (string | number)[]; message: string }[] };
      data?: unknown[];
    };
  },
  filename: string,
): void {
  const data = loadDataset(filename);
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error!.errors[0];
    throw new Error(
      `${filename}: ${issue.path.join(".")}: ${issue.message}`,
    );
  }
  expect(result.data!.length).toBeGreaterThan(0);
}

describe("dataset validation — all four suites", () => {
  it("validates coach-cases.json against evalTestCasesSchema", () => {
    assertDataset(evalTestCasesSchema, "coach-cases.json");
  });

  it("validates recipe-chat-cases.json against recipeChatCasesSchema", () => {
    assertDataset(recipeChatCasesSchema, "recipe-chat-cases.json");
  });

  it("validates meal-suggestion-cases.json against mealSuggestionCasesSchema", () => {
    assertDataset(mealSuggestionCasesSchema, "meal-suggestion-cases.json");
  });

  it("validates recipe-generation-cases.json against recipeGenCasesSchema", () => {
    assertDataset(recipeGenCasesSchema, "recipe-generation-cases.json");
  });
});
