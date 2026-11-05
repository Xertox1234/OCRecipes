import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import type { ZodTypeAny } from "zod";
import {
  recipeChatCasesSchema,
  mealSuggestionCasesSchema,
  recipeGenCasesSchema,
  photoAnalysisCasesSchema,
  inspiredSuggestionCasesSchema,
  recipeChatCaseSchema,
  mealSuggestionCaseSchema,
  recipeGenCaseSchema,
  photoAnalysisCaseSchema,
  labelExtractionCasesSchema,
  labelExtractionCaseSchema,
  frontLabelCasesSchema,
  frontLabelCaseSchema,
} from "../lib/dataset-schemas";
import {
  ALL_PHOTO_ANALYSIS_DIMENSIONS,
  ALL_LABEL_EXTRACTION_DIMENSIONS,
  ALL_FRONT_LABEL_DIMENSIONS,
  evalTestCasesSchema,
} from "../types";

const datasetsDir = path.join(__dirname, "..", "datasets");

function loadDataset(filename: string): unknown {
  const raw = fs.readFileSync(path.join(datasetsDir, filename), "utf8");
  return JSON.parse(raw);
}

function assertDataset(schema: ZodTypeAny, filename: string): void {
  const data = loadDataset(filename);
  const result = schema.safeParse(data);
  if (!result.success) {
    const msgs = result
      .error!.errors.map(
        (e) => `  ${e.path.join(".") || "(root)"}: ${e.message}`,
      )
      .join("\n");
    throw new Error(`${filename} failed schema validation:\n${msgs}`);
  }
  const parsed = result.data as unknown[];
  expect(parsed.length).toBeGreaterThan(0);
}

describe("dataset validation — all five suites", () => {
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

  it("validates photo-analysis-cases.json against photoAnalysisCasesSchema", () => {
    assertDataset(photoAnalysisCasesSchema, "photo-analysis-cases.json");
  });

  it("validates inspired-suggestions-cases.json against inspiredSuggestionCasesSchema", () => {
    assertDataset(
      inspiredSuggestionCasesSchema,
      "inspired-suggestions-cases.json",
    );
  });
});

describe("schema/runner dimension alignment", () => {
  it("recipe-chat scoreDimensions enum matches runner config.dimensions", () => {
    // These must match the dimensions array in runner-recipe-chat.ts SuiteConfig
    const expected = [
      "relevance",
      "recipe_quality",
      "dietary_compliance",
      "safety",
      "tone",
    ];
    const schemaOptions =
      recipeChatCaseSchema.shape.scoreDimensions.unwrap().element.options;
    expect([...schemaOptions].sort()).toEqual([...expected].sort());
  });

  it("meal-suggestions scoreDimensions enum matches runner config.dimensions", () => {
    // These must match the dimensions array in runner-meal-suggestions.ts SuiteConfig
    const expected = [
      "macro_accuracy",
      "dietary_compliance",
      "variety",
      "helpfulness",
    ];
    const schemaOptions =
      mealSuggestionCaseSchema.shape.scoreDimensions.unwrap().element.options;
    expect([...schemaOptions].sort()).toEqual([...expected].sort());
  });

  it("recipe-generation scoreDimensions enum matches runner config.dimensions", () => {
    // These must match the dimensions array in runner-recipe-generation.ts SuiteConfig
    const expected = [
      "ingredient_coherence",
      "instruction_clarity",
      "dietary_compliance",
      "creativity",
    ];
    const schemaOptions =
      recipeGenCaseSchema.shape.scoreDimensions.unwrap().element.options;
    expect([...schemaOptions].sort()).toEqual([...expected].sort());
  });

  it("photo-analysis scoreDimensions enum matches runner config.dimensions", () => {
    // Uses ALL_PHOTO_ANALYSIS_DIMENSIONS from types.ts as single source of truth
    // — must also match the dimensions array in runner-photo-analysis.ts SuiteConfig
    const schemaOptions =
      photoAnalysisCaseSchema.shape.scoreDimensions.unwrap().element.options;
    expect([...schemaOptions].sort()).toEqual(
      [...ALL_PHOTO_ANALYSIS_DIMENSIONS].sort(),
    );
  });

  it("label-extraction scoreDimensions enum matches the shared dimension list", () => {
    const schemaOptions =
      labelExtractionCaseSchema.shape.scoreDimensions.unwrap().element.options;
    expect([...schemaOptions].sort()).toEqual(
      [...ALL_LABEL_EXTRACTION_DIMENSIONS].sort(),
    );
  });

  it("front-label scoreDimensions enum matches the shared dimension list", () => {
    const schemaOptions =
      frontLabelCaseSchema.shape.scoreDimensions.unwrap().element.options;
    expect([...schemaOptions].sort()).toEqual(
      [...ALL_FRONT_LABEL_DIMENSIONS].sort(),
    );
  });
});

describe("label datasets", () => {
  const files = [
    ["label-extraction-cases.json", labelExtractionCasesSchema],
    ["front-label-cases.json", frontLabelCasesSchema],
  ] as const;

  for (const [filename, schema] of files) {
    it(`validates ${filename}`, () => {
      assertDataset(schema, filename);
    });

    it(`${filename}: ids and image URLs are unique, URLs are https`, () => {
      const cases = loadDataset(filename) as {
        id: string;
        input: { imageUrl: string };
      }[];
      expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
      expect(new Set(cases.map((c) => c.input.imageUrl)).size).toBe(
        cases.length,
      );
      for (const c of cases) {
        expect(c.input.imageUrl.startsWith("https://")).toBe(true);
      }
    });

    it(`${filename}: every assertion pattern compiles and every case checks something`, () => {
      const cases = loadDataset(filename) as {
        id: string;
        assertions?: { mustContain?: string[]; mustNotContain?: string[] };
      }[];
      for (const c of cases) {
        const patterns = [
          ...(c.assertions?.mustContain ?? []),
          ...(c.assertions?.mustNotContain ?? []),
        ];
        expect(patterns.length, `${c.id} has no assertions`).toBeGreaterThan(0);
        for (const p of patterns) {
          expect(() => new RegExp(p, "i"), `${c.id}: ${p}`).not.toThrow();
        }
      }
    });
  }
});
