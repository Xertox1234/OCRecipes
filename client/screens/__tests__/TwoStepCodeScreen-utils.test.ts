import { describe, it, expect } from "vitest";
import {
  showTrustSwitch,
  codeScreenIntro,
  TRUST_LABEL,
} from "../TwoStepCodeScreen-utils";

describe("showTrustSwitch", () => {
  it("only a password sign-in can trust the phone", () => {
    expect(showTrustSwitch("login")).toBe(true);
    expect(showTrustSwitch("link")).toBe(false);
  });
});

describe("codeScreenIntro", () => {
  it("sent: names the masked address", () => {
    expect(
      codeScreenIntro({ emailHint: "w•••@gmail.com", codeSent: true }),
    ).toBe(
      "We emailed a 6-digit code to w•••@gmail.com. It can take a minute to arrive.",
    );
  });
  it("held back by the limit: use the newest one", () => {
    expect(
      codeScreenIntro({ emailHint: "w•••@gmail.com", codeSent: false }),
    ).toBe(
      "We've already emailed codes to w•••@gmail.com. Use the newest one, or tap Email me a code.",
    );
  });
  it("no address given: still says it came by email, never an authenticator", () => {
    expect(codeScreenIntro({})).toBe(
      "We emailed a 6-digit code to your email. It can take a minute to arrive.",
    );
  });
  it("the trust switch says what it does, in plain words", () => {
    expect(TRUST_LABEL).toBe("Don't ask again on this phone");
  });
});
