import { pageSheetHeaderPaddingTop } from "../page-sheet-utils";
import { Spacing } from "@/constants/theme";

describe("pageSheetHeaderPaddingTop", () => {
  it("adds the status-bar inset on Android, where the sheet window is edge-to-edge", () => {
    expect(pageSheetHeaderPaddingTop(44, "android")).toBe(Spacing.lg + 44);
  });

  it("keeps the plain padding on iOS, where the sheet sits below the status bar", () => {
    expect(pageSheetHeaderPaddingTop(44, "ios")).toBe(Spacing.lg);
  });
});
