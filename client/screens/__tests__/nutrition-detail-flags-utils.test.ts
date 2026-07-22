import { describe, it, expect } from "vitest";
import {
  partitionScanFlags,
  headsUpSummaryLabel,
} from "../nutrition-detail-flags-utils";

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
      expect(headsUpSummaryLabel(p.universal)).toContain("Ultra-processed");
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
  });

  describe("headsUpSummaryLabel", () => {
    it("summarizes a single flag without pluralizing", () => {
      const universal = [
        {
          id: "nutrient:sugar",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          title: "High in sugar",
        },
      ] as any;
      expect(headsUpSummaryLabel(universal)).toBe(
        "1 nutrition flag: High in sugar",
      );
    });

    it("pluralizes and lists every title in order for multiple flags", () => {
      const universal = [
        {
          id: "nutrient:sugar",
          kind: "nutrient",
          severity: "warn",
          tier: "nutrition",
          title: "High in sugar",
        },
        {
          id: "nutrient:caffeine",
          kind: "nutrient",
          severity: "info",
          tier: "nutrition",
          title: "High in caffeine",
        },
        {
          id: "processing:ultra",
          kind: "processing",
          severity: "warn",
          tier: "nutrition",
          title: "Ultra-processed",
        },
      ] as any;
      expect(headsUpSummaryLabel(universal)).toBe(
        "3 nutrition flags: High in sugar, High in caffeine, Ultra-processed",
      );
    });

    it("returns a graceful fallback for an empty universal list", () => {
      expect(headsUpSummaryLabel([])).toBe("No additional nutrition flags.");
    });
  });
});
