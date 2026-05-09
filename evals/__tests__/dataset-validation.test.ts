import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { ZodTypeAny } from "zod";
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

function assertDataset(schema: ZodTypeAny, filename: string): void {
  const data = loadDataset(filename);
  const result = schema.safeParse(data);
  if (!result.success) {
    const msgs = result.error!.errors
      .map((e) => `  ${e.path.join(".") || "(root)"}: ${e.message}`)
      .join("\n");
    throw new Error(`${filename} failed schema validation:\n${msgs}`);
  }
  const parsed = result.data as unknown[];
  expect(parsed.length).toBeGreaterThan(0);
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
