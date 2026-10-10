import { describe, it, expect } from "vitest";
import { toGoogleSignInError } from "../src/normalize";

describe("toGoogleSignInError", () => {
  it.each(["NO_ACCOUNT", "PLAY_SERVICES", "NOT_CONFIGURED", "FAILED"])(
    "keeps the known code %s",
    (code) => {
      const err = toGoogleSignInError(Object.assign(new Error("x"), { code }));
      expect(err.code).toBe(code);
      expect(err.message).toBe("x");
    },
  );

  it("maps an unknown native code to FAILED", () => {
    const err = toGoogleSignInError(
      Object.assign(new Error("y"), { code: "ERR_SOMETHING_NEW" }),
    );
    expect(err.code).toBe("FAILED");
  });

  it("maps a non-Error throw to FAILED", () => {
    expect(toGoogleSignInError("boom").code).toBe("FAILED");
  });
});
