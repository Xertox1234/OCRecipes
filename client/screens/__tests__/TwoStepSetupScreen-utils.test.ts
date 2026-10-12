import { describe, it, expect } from "vitest";
import { identityIntro, setupTitle } from "../TwoStepSetupScreen-utils";

describe("setupTitle", () => {
  it.each([
    ["setup", "Turn on two-step verification"],
    ["disable", "Turn off two-step verification"],
  ] as const)("%s → %s", (mode, title) => {
    expect(setupTitle(mode)).toBe(title);
  });
});

describe("identityIntro", () => {
  it("setup says what two-step does, in plain words", () => {
    expect(identityIntro("setup")).toBe(
      "When you sign in on a new phone, we'll email you a 6-digit code. Enter your password to start.",
    );
  });

  it("turning it off asks for the password and the emailed code", () => {
    expect(identityIntro("disable")).toBe(
      "Enter your password and the code we email you.",
    );
  });

  it("never mentions an authenticator app or recovery codes", () => {
    for (const mode of ["setup", "disable"] as const) {
      expect(identityIntro(mode)).not.toMatch(/authenticator|recovery/i);
    }
  });
});
