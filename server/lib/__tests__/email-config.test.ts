import { describe, it, expect, afterEach } from "vitest";
import { emailVerificationEnabled } from "../email-config";

// email-config is the single source of truth for "is email verification
// enforced?" — it gates the fail-open vs fail-closed branch in auth.ts, so its
// semantics are locked here (L5: previously the only net-new module without a test).
describe("emailVerificationEnabled", () => {
  const saved = process.env.RESEND_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = saved;
  });

  it("is false when RESEND_API_KEY is unset (fail-open: verification disabled)", () => {
    delete process.env.RESEND_API_KEY;
    expect(emailVerificationEnabled()).toBe(false);
  });

  it("is false when RESEND_API_KEY is an empty string", () => {
    process.env.RESEND_API_KEY = "";
    expect(emailVerificationEnabled()).toBe(false);
  });

  it("is true when RESEND_API_KEY is set (verification enforced)", () => {
    process.env.RESEND_API_KEY = "re_test_key";
    expect(emailVerificationEnabled()).toBe(true);
  });
});
