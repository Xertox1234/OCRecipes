import { describe, it, expect } from "vitest";
import {
  addKeyCopy,
  WRONG_CODE_MESSAGE,
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

describe("addKeyCopy — setup on one phone (owner ruling 2026-10-12)", () => {
  it("iPhone: the button says what it opens — Passwords — and where the code is", () => {
    const c = addKeyCopy("ios");
    expect(c.button).toBe("Add to Passwords");
    expect(c.after).toBe(
      "Then open Passwords → Codes → OCRecipes, and come back with the 6-digit code.",
    );
  });

  it.each(["android", "web"] as const)(
    "%s: a generic authenticator app",
    (os) => {
      const c = addKeyCopy(os);
      expect(c.button).toBe("Add to authenticator app");
      expect(c.after).toBeNull();
    },
  );

  it.each(["ios", "android"] as const)(
    "%s: the manual path says to type the key, not scan",
    (os) => {
      expect(addKeyCopy(os).manual).toBe(
        "Using another app? Tap Copy key, then in that app choose “Enter a setup key” — not “Scan a QR code” — and paste it.",
      );
    },
  );

  it("the main path never mentions a QR code (the code is on this phone)", () => {
    for (const os of ["ios", "android", "web"] as const) {
      const c = addKeyCopy(os);
      expect([c.intro, c.button, c.after ?? ""].join(" ")).not.toMatch(/QR/i);
    }
  });
});

describe("WRONG_CODE_MESSAGE", () => {
  it("names the stale-entry trap as well as the clock", () => {
    expect(WRONG_CODE_MESSAGE).toBe(
      "That code didn't match. Use the newest OCRecipes entry (delete older ones), and check your phone's time is set automatically.",
    );
  });
});
