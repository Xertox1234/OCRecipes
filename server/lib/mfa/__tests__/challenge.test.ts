import { describe, it, expect, vi, beforeEach } from "vitest";
import { sha256Hex } from "../../social-identity/nonce";
import { hashChallengeToken } from "../mfa-secrets";

const { storage } = vi.hoisted(() => ({
  storage: { createMfaChallenge: vi.fn() },
}));
vi.mock("../../../storage", () => ({ storage }));

const { startMfaChallenge } = await import("../challenge");

beforeEach(() => {
  vi.resetAllMocks();
  storage.createMfaChallenge.mockResolvedValue(undefined);
});

describe("startMfaChallenge", () => {
  it("login: returns an opaque token and stores only its hash with the tokenVersion", async () => {
    const r = await startMfaChallenge({
      user: { id: "u1", tokenVersion: 7 },
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
      user: { id: "u1", tokenVersion: 0 },
      purpose: "link",
      link: { ticket: "tkt", markEmailVerified: true, notAfter },
    });
    const row = storage.createMfaChallenge.mock.calls[0][0];
    expect(row.purpose).toBe("link");
    expect(row.linkTicketHash).toBe(sha256Hex("tkt"));
    expect(row.linkMarkEmailVerified).toBe(true);
    expect(row.notAfter).toBe(notAfter);
  });
});
