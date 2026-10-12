import { describe, it, expect, vi, beforeEach } from "vitest";
import { sha256Hex } from "../../social-identity/nonce";
import { hashChallengeToken } from "../mfa-secrets";

const { storage, sendMfaEmailCode } = vi.hoisted(() => ({
  storage: { createMfaChallenge: vi.fn() },
  sendMfaEmailCode: vi.fn(),
}));
vi.mock("../../../storage", () => ({ storage }));
vi.mock("../email-code", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../email-code")>()),
  sendMfaEmailCode,
}));

const { startMfaChallenge } = await import("../challenge");

beforeEach(() => {
  vi.resetAllMocks();
  storage.createMfaChallenge.mockResolvedValue(undefined);
  sendMfaEmailCode.mockResolvedValue("issued");
});

describe("startMfaChallenge", () => {
  it("login: returns an opaque token and stores only its hash with the tokenVersion", async () => {
    const r = await startMfaChallenge({
      user: { id: "u1", tokenVersion: 7, email: "w@x.com" },
      purpose: "login",
    });
    expect(r.status).toBe("mfa_required");
    expect(r.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const row = storage.createMfaChallenge.mock.calls[0][0];
    expect(row).toEqual({
      tokenHash: hashChallengeToken(r.challenge),
      userId: "u1",
      tokenVersion: 7,
      purpose: "login",
      linkTicketHash: undefined,
      linkMarkEmailVerified: false,
      notAfter: undefined,
    });
    expect(JSON.stringify(row)).not.toContain(r.challenge);
  });

  it("link: binds the pending ticket by hash and never outlives it", async () => {
    const notAfter = new Date("2030-01-01T00:00:00Z");
    await startMfaChallenge({
      user: { id: "u1", tokenVersion: 0, email: "w@x.com" },
      purpose: "link",
      link: { ticket: "tkt", markEmailVerified: true, notAfter },
    });
    const row = storage.createMfaChallenge.mock.calls[0][0];
    expect(row.purpose).toBe("link");
    expect(row.linkTicketHash).toBe(sha256Hex("tkt"));
    expect(row.linkMarkEmailVerified).toBe(true);
    expect(row.notAfter).toBe(notAfter);
  });

  // Every two-step account is an email account (authenticator apps removed).
  it("emails a code, lives 10 minutes, and says where it went", async () => {
    const r = await startMfaChallenge({
      user: { id: "u1", tokenVersion: 3, email: "william@gmail.com" },
      purpose: "login",
    });
    expect(r).toMatchObject({
      status: "mfa_required",
      method: "email",
      emailHint: "w•••@gmail.com",
      codeSent: true,
    });
    expect(sendMfaEmailCode).toHaveBeenCalledWith({
      id: "u1",
      email: "william@gmail.com",
    });
  });

  it("at the daily limit: the challenge still opens, codeSent false", async () => {
    sendMfaEmailCode.mockResolvedValue("capped");
    const r = await startMfaChallenge({
      user: { id: "u1", tokenVersion: 3, email: "william@gmail.com" },
      purpose: "link",
      link: { ticket: "t", markEmailVerified: false, notAfter: new Date() },
    });
    expect(r).toMatchObject({ method: "email", codeSent: false });
  });
});
