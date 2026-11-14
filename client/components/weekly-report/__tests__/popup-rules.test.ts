import { describe, it, expect } from "vitest";
import { shouldShowPopup } from "../weekly-report-utils";

describe("shouldShowPopup", () => {
  it("shows a pending report that wasn't shown yet", () => {
    expect(
      shouldShowPopup({
        pending: { id: 4 },
        foregroundPush: null,
        alreadyShownIds: new Set(),
      }),
    ).toBe(4);
  });

  it("a push that arrives while the app is open wins over the pending check", () => {
    expect(
      shouldShowPopup({
        pending: null,
        foregroundPush: { reportId: 7 },
        alreadyShownIds: new Set(),
      }),
    ).toBe(7);
  });

  it("never shows the same report twice", () => {
    expect(
      shouldShowPopup({
        pending: { id: 4 },
        foregroundPush: null,
        alreadyShownIds: new Set([4]),
      }),
    ).toBeNull();
    expect(
      shouldShowPopup({
        pending: null,
        foregroundPush: { reportId: 7 },
        alreadyShownIds: new Set([7]),
      }),
    ).toBeNull();
  });

  it("nothing pending, no push → nothing", () => {
    expect(
      shouldShowPopup({
        pending: null,
        foregroundPush: null,
        alreadyShownIds: new Set(),
      }),
    ).toBeNull();
  });
});
