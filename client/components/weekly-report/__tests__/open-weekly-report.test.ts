import { describe, it, expect, vi, beforeEach } from "vitest";
import { navigationRef } from "@/navigation/navigationRef";
import { openWeeklyReport } from "../open-weekly-report";

vi.mock("@/navigation/navigationRef", () => ({
  navigationRef: { isReady: vi.fn(), navigate: vi.fn() },
}));

describe("openWeeklyReport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the report on the Profile tab", () => {
    vi.mocked(navigationRef.isReady).mockReturnValue(true);
    openWeeklyReport(12);
    expect(navigationRef.navigate).toHaveBeenCalledWith(
      "Main",
      {
        screen: "ProfileTab",
        params: { screen: "WeeklyReport", params: { id: 12 } },
      },
      { pop: true },
    );
  });

  it("does nothing before navigation is ready", () => {
    vi.mocked(navigationRef.isReady).mockReturnValue(false);
    openWeeklyReport(12);
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });
});
