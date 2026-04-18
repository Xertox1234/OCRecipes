import { describe, it, expect } from "vitest";
import {
  isJunkRecipeName,
  LEGACY_TEST_PRODUCT_NAMES,
  SEED_PREFIX,
  TEST_PREFIX,
} from "../cleanup-seed-recipes-utils";

/**
 * The cleanup script's WHERE clause is the security perimeter for
 * `npm run cleanup:seeds`. Mis-matching it deletes real user data.
 * These tests pin the contract that the same classification logic uses
 * in the SQL filter (`ILIKE 'seed-%' OR ILIKE 'test-%' OR IN (legacy)`).
 */
describe("cleanup-seed-recipes-utils", () => {
  describe("isJunkRecipeName — prefix matches", () => {
    it("matches the seed prefix", () => {
      expect(isJunkRecipeName(`${SEED_PREFIX}chicken`)).toBe(true);
      expect(isJunkRecipeName(`${SEED_PREFIX}avocado`)).toBe(true);
    });

    it("matches the test prefix", () => {
      expect(isJunkRecipeName(`${TEST_PREFIX}product`)).toBe(true);
      expect(isJunkRecipeName(`${TEST_PREFIX}community food`)).toBe(true);
      expect(isJunkRecipeName(`${TEST_PREFIX}original pasta`)).toBe(true);
    });

    it("matches prefix case-insensitively (mirrors SQL ILIKE)", () => {
      expect(isJunkRecipeName("SEED-CHICKEN")).toBe(true);
      expect(isJunkRecipeName("Test-Pasta")).toBe(true);
    });
  });

  describe("isJunkRecipeName — legacy allowlist", () => {
    it("matches every entry in LEGACY_TEST_PRODUCT_NAMES", () => {
      for (const name of LEGACY_TEST_PRODUCT_NAMES) {
        expect(isJunkRecipeName(name)).toBe(true);
      }
    });

    it("matches legacy names case-insensitively", () => {
      expect(isJunkRecipeName("Test Product")).toBe(true);
      expect(isJunkRecipeName("ORIGINAL PASTA")).toBe(true);
    });
  });

  describe("isJunkRecipeName — non-matches (real user data must NOT be flagged)", () => {
    it("does not match arbitrary user recipe names", () => {
      expect(isJunkRecipeName("Grandma's Lasagna")).toBe(false);
      expect(isJunkRecipeName("homemade pasta")).toBe(false);
      expect(isJunkRecipeName("oat milk smoothie")).toBe(false);
    });

    it("does not match names that merely contain the prefix mid-string", () => {
      // The SQL filter is `ILIKE 'seed-%'`, anchored to the start.
      expect(isJunkRecipeName("birdseed-bread")).toBe(false);
      expect(isJunkRecipeName("contest-winning chili")).toBe(false);
      expect(isJunkRecipeName("greatest-hits soup")).toBe(false);
    });

    it("does not match the empty string", () => {
      expect(isJunkRecipeName("")).toBe(false);
    });
  });

  describe("legacy allowlist hygiene", () => {
    it("only contains lowercase entries (case-insensitive comparison assumes lowercase keys)", () => {
      for (const name of LEGACY_TEST_PRODUCT_NAMES) {
        expect(name).toBe(name.toLowerCase());
      }
    });

    it("does not double-cover anything that would already match the test- prefix", () => {
      // If someone backfills the legacy list with `test-foo`, both branches
      // would fire — harmless but wasteful. Catch it in CI.
      for (const name of LEGACY_TEST_PRODUCT_NAMES) {
        expect(name.startsWith(TEST_PREFIX)).toBe(false);
        expect(name.startsWith(SEED_PREFIX)).toBe(false);
      }
    });
  });
});
