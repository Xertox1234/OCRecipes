import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashSignInCode } from "../../password-reset-code";

const { storage, sendSignInCode } = vi.hoisted(() => ({
  storage: { issueMfaEmailCode: vi.fn() },
  sendSignInCode: vi.fn(),
}));
vi.mock("../../../storage", () => ({ storage }));
vi.mock("../../../services/email", () => ({ sendSignInCode }));

const { maskEmail, sendMfaEmailCode } = await import("../email-code");

beforeEach(() => {
  vi.resetAllMocks();
  sendSignInCode.mockResolvedValue(undefined);
});

describe("sendMfaEmailCode", () => {
  it("stores only the code's HMAC and emails the same 6 digits", async () => {
    storage.issueMfaEmailCode.mockResolvedValue("issued");
    const r = await sendMfaEmailCode({ id: "u1", email: "w@x.com" });
    expect(r).toBe("issued");
    const code = sendSignInCode.mock.calls[0][1] as string;
    expect(code).toMatch(/^\d{6}$/);
    expect(sendSignInCode).toHaveBeenCalledWith("w@x.com", code);
    expect(storage.issueMfaEmailCode).toHaveBeenCalledWith(
      "u1",
      hashSignInCode("u1", code),
    );
  });

  it.each(["cooldown", "capped"] as const)(
    "%s → no email is sent",
    async (refusal) => {
      storage.issueMfaEmailCode.mockResolvedValue(refusal);
      expect(await sendMfaEmailCode({ id: "u1", email: "w@x.com" })).toBe(
        refusal,
      );
      expect(sendSignInCode).not.toHaveBeenCalled();
    },
  );
});

describe("maskEmail", () => {
  it.each([
    ["william.tower@gmail.com", "w•••@gmail.com"],
    ["a@b.co", "a•••@b.co"],
    ["no-at-sign", "your email"],
  ])("%s → %s", (input, out) => {
    expect(maskEmail(input)).toBe(out);
  });
});
