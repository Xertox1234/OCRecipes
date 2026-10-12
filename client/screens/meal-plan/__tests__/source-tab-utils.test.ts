import { getSourceTab } from "../source-tab-utils";

function nav(tabs: string[], index: number) {
  return {
    getParent: () => ({
      getState: () => ({ index, routes: tabs.map((name) => ({ name })) }),
    }),
  };
}

describe("getSourceTab (QA #10)", () => {
  const tabs = ["HomeTab", "MealPlanTab", "CoachTab", "ProfileTab"];

  it("returns the hosting tab for the Profile and Coach stacks", () => {
    expect(getSourceTab(nav(tabs, 3))).toBe("ProfileTab");
    expect(getSourceTab(nav(tabs, 2))).toBe("CoachTab");
  });

  it("returns undefined from the Plan tab (no override needed)", () => {
    expect(getSourceTab(nav(tabs, 1))).toBeUndefined();
  });

  it("returns undefined when there is no parent", () => {
    expect(getSourceTab({ getParent: () => undefined })).toBeUndefined();
  });
});
