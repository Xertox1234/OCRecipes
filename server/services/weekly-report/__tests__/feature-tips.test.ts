import { describe, it, expect } from "vitest";
import { pickTips } from "../feature-tips";
import { FEATURE_TIPS } from "@shared/constants/feature-tips";
import {
  FEATURE_TIP_IDS,
  type FeatureTipId,
} from "@shared/schemas/coach-weekly-report";

const usage = (used: FeatureTipId[] = []) =>
  Object.fromEntries(
    FEATURE_TIP_IDS.map((id) => [id, used.includes(id)]),
  ) as Record<FeatureTipId, boolean>;

const BANNED =
  /\b(missed|failed|only|broken|behind|skipped|didn't eat|deficit|weight|lose|streak)\b/i;

describe("FEATURE_TIPS copy", () => {
  it("has copy for every tip id, with no banned words", () => {
    for (const id of FEATURE_TIP_IDS) {
      const t = FEATURE_TIPS[id];
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
      expect(t.actionLabel.length).toBeGreaterThan(0);
      expect(`${t.title} ${t.body} ${t.actionLabel}`).not.toMatch(BANNED);
    }
  });

  it("keeps the spec's exact barcode and pantry copy", () => {
    expect(FEATURE_TIPS.barcode.body).toBe(
      "Scan the barcode on any grocery item to see its nutrition, macros and allergens before it goes in your basket.",
    );
    expect(FEATURE_TIPS.photo.title).toBe("Log a meal with one photo");
    expect(FEATURE_TIPS.import.actionLabel).toBe("Import a recipe");
    expect(FEATURE_TIPS.pantry.actionLabel).toBe("Set up my pantry");
  });
});

describe("pickTips", () => {
  it("a normal week gets one Did-you-know, preferring an unused feature", () => {
    const tips = pickTips(usage(["barcode", "photo"]), [], false);
    expect(tips).toHaveLength(1);
    expect(["barcode", "photo"]).not.toContain(tips[0]);
  });

  it("a quiet week leads with photo then import when unused, plus one Did-you-know", () => {
    const tips = pickTips(usage(), [], true);
    expect(tips).toHaveLength(3);
    expect(tips.slice(0, 2)).toEqual(["photo", "import"]);
    expect(["photo", "import"]).not.toContain(tips[2]);
  });

  it("a quiet week skips photo when the user already logs by photo", () => {
    const tips = pickTips(usage(["photo"]), [], true);
    expect(tips[0]).toBe("import");
    expect(tips).not.toContain("photo");
  });

  it("does not repeat a tip shown in recent reports while unshown unused ones remain", () => {
    const shown: FeatureTipId[][] = [["barcode"], ["pantry"], ["mealPlan"]];
    const tips = pickTips(usage(), shown, false);
    expect(["barcode", "pantry", "mealPlan"]).not.toContain(tips[0]);
  });

  it("cycles to the least recently shown tip once every unused tip was shown", () => {
    const shown: FeatureTipId[][] = [
      ["barcode"],
      ["photo"],
      ["import"],
      ["pantry"],
      ["mealPlan"],
      ["voice"],
      ["cookbooks"],
    ];
    expect(pickTips(usage(), shown, false)).toEqual(["cookbooks"]);
  });

  it("still returns a tip when every feature is used", () => {
    expect(pickTips(usage([...FEATURE_TIP_IDS]), [], false)).toHaveLength(1);
    expect(pickTips(usage([...FEATURE_TIP_IDS]), [], true)).toHaveLength(3);
  });
});
