import { describe, it, expect } from "vitest";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

/**
 * Type-level evidence for `RootStackParamList["NutritionDetail"]`'s
 * discriminated union: illegal combinations of the three entry-mode
 * selectors (`barcode` / `itemId` / `imageUri`) must be COMPILE errors, not
 * merely undesirable at runtime.
 *
 * Per docs/solutions/conventions/vitest-transform-no-typecheck-use-tsc-for-type-evidence-2026-07-14.md,
 * Vitest's esbuild transform strips types without checking them, so these
 * `it` blocks running green proves nothing about the type contract on their
 * own — the real evidence is `npx tsc --noEmit` (run via `npm run
 * check:types`) rejecting each `@ts-expect-error`'d assignment below. Each
 * illegal literal carries EXACTLY the two conflicting selectors, so the
 * suppressed error can only be the exclusivity violation, never an unrelated
 * excess-property complaint on some other key.
 */
describe("RootStackParamList NutritionDetail — mode exclusivity", () => {
  it("accepts each of the three legal entry-mode shapes", () => {
    const barcodeOnly: RootStackParamList["NutritionDetail"] = {
      barcode: "0123456789012",
    };
    const barcodeWithCompanions: RootStackParamList["NutritionDetail"] = {
      barcode: "0123456789012",
      ocrText: "Calories 120",
      nutritionImageUri: "file:///nutrition.jpg",
      frontImageUri: "file:///front.jpg",
    };
    const itemIdOnly: RootStackParamList["NutritionDetail"] = { itemId: 42 };
    const imageUriOnly: RootStackParamList["NutritionDetail"] = {
      imageUri: "file:///manual.jpg",
    };

    expect(barcodeOnly.barcode).toBe("0123456789012");
    expect(barcodeWithCompanions.ocrText).toBe("Calories 120");
    expect(itemIdOnly.itemId).toBe(42);
    expect(imageUriOnly.imageUri).toBe("file:///manual.jpg");
  });

  it("rejects itemId combined with barcode at compile time", () => {
    // @ts-expect-error — itemId and barcode are mutually-exclusive entry modes
    const illegal: RootStackParamList["NutritionDetail"] = {
      itemId: 42,
      barcode: "0123456789012",
    };
    expect(illegal).toBeDefined();
  });

  it("rejects itemId combined with imageUri at compile time", () => {
    // @ts-expect-error — itemId and imageUri are mutually-exclusive entry modes
    const illegal: RootStackParamList["NutritionDetail"] = {
      itemId: 42,
      imageUri: "file:///manual.jpg",
    };
    expect(illegal).toBeDefined();
  });

  it("rejects barcode combined with imageUri at compile time", () => {
    // @ts-expect-error — barcode and imageUri are mutually-exclusive entry modes
    const illegal: RootStackParamList["NutritionDetail"] = {
      barcode: "0123456789012",
      imageUri: "file:///manual.jpg",
    };
    expect(illegal).toBeDefined();
  });
});
