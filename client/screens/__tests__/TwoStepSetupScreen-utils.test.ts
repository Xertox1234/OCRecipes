import { describe, it, expect } from "vitest";
import {
  formatSetupKey,
  recoveryCodesText,
  canFinishSaveCodes,
  setupTitle,
} from "../TwoStepSetupScreen-utils";

describe("formatSetupKey", () => {
  it("groups the base32 key in fours for typing by hand", () => {
    expect(formatSetupKey("ABCDEFGHIJKLMNOPQRSTUVWXYZ234567")).toBe(
      "ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567",
    );
    expect(formatSetupKey("ABCDEF")).toBe("ABCD EF");
  });
});

describe("recoveryCodesText", () => {
  it("has a header and one code per line", () => {
    expect(recoveryCodesText(["AAAA-BBBB", "CCCC-DDDD"])).toBe(
      "OCRecipes recovery codes — each works once\n\nAAAA-BBBB\nCCCC-DDDD\n",
    );
  });
});

describe("canFinishSaveCodes", () => {
  it("only once the person says they saved the codes", () => {
    expect(canFinishSaveCodes(false)).toBe(false);
    expect(canFinishSaveCodes(true)).toBe(true);
  });
});

describe("setupTitle", () => {
  it.each([
    ["setup", "Turn on two-step verification"],
    ["new_phone", "Set up on a new phone"],
    ["disable", "Turn off two-step verification"],
    ["new_codes", "New recovery codes"],
  ] as const)("%s → %s", (mode, title) => {
    expect(setupTitle(mode)).toBe(title);
  });
});
