import { describe, it, expect } from "vitest";
import { partitionScanFlags } from "../nutrition-detail-flags-utils";

describe("nutrition-detail-flags-utils", () => {
  describe("partitionScanFlags", () => {
    it("splits personal, universal (severity-sorted), and the nutriscore chip", () => {
      const flags = [
        {
          id: "nutriscore:e",
          kind: "nutriscore",
          severity: "info",
          tier: "nutrition",
          title: "Nutri-Score E",
          grade: "e",
        },
        {
          id: "nutrient:caffeine",
          kind: "nutrient",
          severity: "info",
          tier: "nutrition",
          title: "Contains caffeine",
        },
        {
          id: "processing:ultra",
          kind: "processing",
          severity: "warn",
          tier: "nutrition",
          title: "Ultra-processed",
        },
        {
          id: "allergen:peanuts",
          kind: "allergen",
          severity: "danger",
          tier: "safety",
          title: "Contains Peanuts",
        },
      ] as any;
      const p = partitionScanFlags(flags);
      expect(p.personal.map((f) => f.id)).toEqual(["allergen:peanuts"]);
      expect(p.universal.map((f) => f.id)).toEqual([
        "processing:ultra",
        "nutrient:caffeine",
      ]); // warn before info
      expect(p.nutriScore?.id).toBe("nutriscore:e");
    });

    it("treats allergen-unavailable as personal, and sweetener as universal", () => {
      const flags = [
        {
          id: "allergen-unavailable",
          kind: "allergen-unavailable",
          severity: "warn",
          tier: "safety",
          title: "Couldn't verify allergens",
        },
        {
          id: "sweetener:artificial",
          kind: "sweetener",
          severity: "info",
          tier: "nutrition",
          title: "Contains artificial sweeteners",
        },
      ] as any;
      const p = partitionScanFlags(flags);
      expect(p.personal.map((f) => f.id)).toEqual(["allergen-unavailable"]);
      expect(p.universal.map((f) => f.id)).toEqual(["sweetener:artificial"]);
      expect(p.nutriScore).toBeUndefined();
    });

    it("returns empty arrays and no nutriScore for an empty flags list", () => {
      const p = partitionScanFlags([]);
      expect(p.personal).toEqual([]);
      expect(p.universal).toEqual([]);
      expect(p.nutriScore).toBeUndefined();
    });

    // Final-review fix (latent crash guard): `grade` is optional on ScanFlag.
    // A gradeless nutriscore flag must NOT populate `nutriScore` — downstream,
    // NutritionDetailScreen renders `NutriScoreChip` from `nutriScore.grade`,
    // which calls `.toUpperCase()` on it; a gradeless flag flowing through
    // would throw at render time.
    it("does not populate nutriScore for a gradeless nutriscore flag", () => {
      const flags = [
        {
          id: "nutriscore:unknown",
          kind: "nutriscore",
          severity: "info",
          tier: "nutrition",
          title: "Nutri-Score unavailable",
          // no `grade` field
        },
      ] as any;
      const p = partitionScanFlags(flags);
      expect(p.nutriScore).toBeUndefined();
    });

    // Defensive default: a flag kind outside PERSONAL_KINDS/UNIVERSAL_KINDS
    // and not "nutriscore" — e.g. a future ScanFlagKind addition, or an
    // "insight"-tier flag once that tier ships — has no bucket here. It must
    // not silently vanish from both sections without a trace.
    it("warns and drops a flag with an unmodeled kind from both sections", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const flags = [
        {
          id: "insight:mystery",
          kind: "insight-mystery",
          severity: "info",
          tier: "insight",
          title: "Unmodeled flag",
        },
      ] as any;

      const p = partitionScanFlags(flags);

      expect(p.personal).toEqual([]);
      expect(p.universal).toEqual([]);
      expect(p.nutriScore).toBeUndefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain("insight-mystery");
      warnSpy.mockRestore();
    });
  });
});
