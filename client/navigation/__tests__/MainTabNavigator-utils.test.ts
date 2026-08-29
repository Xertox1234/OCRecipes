import { getTabContentA11y } from "../MainTabNavigator-utils";

describe("getTabContentA11y", () => {
  it("hides the tab content from the accessibility tree while the scan menu is open", () => {
    expect(getTabContentA11y(true)).toBe("no-hide-descendants");
  });

  it("restores the tab content to the accessibility tree once the scan menu is closed", () => {
    expect(getTabContentA11y(false)).toBe("auto");
  });
});
