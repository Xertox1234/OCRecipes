import { describe, it, expect } from "vitest";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

/**
 * Type-level evidence for `RootStackParamList["NutritionDetail"]`'s
 * discriminated union: an illegal combination of the two entry-mode selectors
 * (`barcode` / `imageUri`) must be a COMPILE error, not merely undesirable at
 * runtime.
 *
 * A third `itemId` selector was removed 2026-09-17 along with the saved-item
 * arm it discriminated (no producer since 2026-01-29 — see
 * `todos/archive/P2-2026-08-16-nutritiondetail-itemid-branch-has-no-producer.md`),
 * taking its two exclusivity cases with it.
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
  it("accepts each of the two legal entry-mode shapes", () => {
    const barcodeOnly: RootStackParamList["NutritionDetail"] = {
      barcode: "0123456789012",
    };
    const barcodeWithCompanions: RootStackParamList["NutritionDetail"] = {
      barcode: "0123456789012",
      ocrText: "Calories 120",
      nutritionImageUri: "file:///nutrition.jpg",
      frontImageUri: "file:///front.jpg",
    };
    const imageUriOnly: RootStackParamList["NutritionDetail"] = {
      imageUri: "file:///manual.jpg",
    };

    expect(barcodeOnly.barcode).toBe("0123456789012");
    expect(barcodeWithCompanions.ocrText).toBe("Calories 120");
    expect(imageUriOnly.imageUri).toBe("file:///manual.jpg");
  });

  it("rejects barcode combined with imageUri at compile time", () => {
    // @ts-expect-error — barcode and imageUri are mutually-exclusive entry modes
    const illegal: RootStackParamList["NutritionDetail"] = {
      barcode: "0123456789012",
      imageUri: "file:///manual.jpg",
    };
    expect(illegal).toBeDefined();
  });

  it("rejects an itemId that no longer names an entry mode", () => {
    // @ts-expect-error — the saved-item arm was removed; `itemId` is not a key
    // on either surviving arm, so this is an excess-property error. Pins the
    // removal: re-adding the arm would make this assignment legal and fail
    // `check:types` on the unused suppression.
    const illegal: RootStackParamList["NutritionDetail"] = { itemId: 42 };
    expect(illegal).toBeDefined();
  });
});
