import { describe, it, expect } from "vitest";
import { coachInitialRoute } from "../coachInitialRoute";

/**
 * The Coach tab's landing-screen gate: Pro users land on CoachPro, free users
 * on ChatList. Extracted from ChatStackNavigator's initialRouteName so the
 * decision is unit-testable (initialRouteName is evaluated once at mount, so
 * a render test can't observe it without a full navigator harness).
 */
describe("coachInitialRoute", () => {
  it("routes Coach Pro users to the CoachPro screen (allowed path)", () => {
    expect(coachInitialRoute(true)).toBe("CoachPro");
  });

  it("routes free users to ChatList — the premium screen is not the landing (denial)", () => {
    expect(coachInitialRoute(false)).toBe("ChatList");
  });
});
