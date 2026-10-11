import { describe, it, expect } from "vitest";
import {
  formatSetupKey,
  recoveryCodesText,
  canFinishSaveCodes,
  finishMessage,
  setupTitle,
  shouldGuardLeave,
} from "../TwoStepSetupScreen-utils";

describe("finishMessage", () => {
  it.each([
    ["setup", true, "Two-step verification is on"],
    ["new_codes", true, "New recovery codes saved"],
    ["new_phone", false, "Two-step verification moved to this phone"],
  ] as const)("%s, codes issued %s → %s", (mode, issued, message) => {
    expect(finishMessage(mode, issued)).toBe(message);
  });
});

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

describe("shouldGuardLeave", () => {
  it("guards leaving while unsaved recovery codes are on screen", () => {
    expect(shouldGuardLeave("save-codes", false)).toBe(true);
  });

  it("lets the person leave once they say they saved the codes", () => {
    expect(shouldGuardLeave("save-codes", true)).toBe(false);
  });

  it.each(["confirm", "add-key", "enter-code"] as const)(
    "never guards the %s step",
    (step) => {
      expect(shouldGuardLeave(step, false)).toBe(false);
    },
  );
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
