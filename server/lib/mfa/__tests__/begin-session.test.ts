import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../../storage";
import { generateToken } from "../../../middleware/auth";
import { beginSession, issueSession } from "../begin-session";
import { hashChallengeToken } from "../mfa-secrets";
import { sha256Hex } from "../../social-identity/nonce";
import {
  createMockUser,
  createMockUserIdentity,
} from "../../../__tests__/factories";

vi.mock("../../../storage", () => ({
  storage: {
    getUser: vi.fn(),
    createMfaChallenge: vi.fn(),
    completeLinkFromTicket: vi.fn(),
  },
}));
vi.mock("../../../middleware/auth");

const m = vi.mocked(storage);
const plain = createMockUser({ id: "u1", tokenVersion: 3, mfaEnabledAt: null });
const twoFactor = createMockUser({
  id: "u2",
  tokenVersion: 7,
  mfaEnabledAt: new Date("2026-10-05T00:00:00Z"),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(generateToken).mockReturnValue("mock-jwt-token");
});

describe("beginSession — no second factor", () => {
  it("mints a session from the row it was given", async () => {
    const r = await beginSession(plain);
    expect(r).toMatchObject({
      status: "signed_in",
      token: "mock-jwt-token",
      user: { id: "u1" },
    });
    expect(generateToken).toHaveBeenCalledWith("u1", 3, plain.emailVerified);
    expect(m.createMfaChallenge).not.toHaveBeenCalled();
  });

  it("runs beforeSession first", async () => {
    const order: string[] = [];
    const beforeSession = vi.fn(async () => {
      order.push("before");
    });
    vi.mocked(generateToken).mockImplementation(() => {
      order.push("mint");
      return "t";
    });
    await beginSession(plain, { beforeSession });
    expect(order).toEqual(["before", "mint"]);
  });

  it("link: completes the link, then mints from a fresh read", async () => {
    m.completeLinkFromTicket.mockResolvedValue(
      createMockUserIdentity({ id: "i1", userId: "u1" }),
    );
    m.getUser.mockResolvedValue({ ...plain, emailVerified: true });
    const r = await beginSession(plain, {
      link: { ticket: "tk", markEmailVerified: true },
    });
    expect(m.completeLinkFromTicket).toHaveBeenCalledWith("tk", {
      markEmailVerified: true,
    });
    expect(generateToken).toHaveBeenCalledWith("u1", 3, true);
    expect(r).toMatchObject({ status: "signed_in" });
  });

  it("link: an expired ticket returns null and mints nothing", async () => {
    m.completeLinkFromTicket.mockResolvedValue(undefined);
    expect(
      await beginSession(plain, {
        link: { ticket: "tk", markEmailVerified: false },
      }),
    ).toBeNull();
    expect(generateToken).not.toHaveBeenCalled();
  });
});

describe("beginSession — second factor on", () => {
  it("opens a login challenge and mints nothing", async () => {
    const beforeSession = vi.fn();
    const r = await beginSession(twoFactor, { beforeSession });
    expect(r).toEqual({
      status: "mfa_required",
      challenge: expect.any(String),
    });
    const challenge = (r as { challenge: string }).challenge;
    expect(m.createMfaChallenge).toHaveBeenCalledWith({
      tokenHash: hashChallengeToken(challenge),
      userId: "u2",
      tokenVersion: 7,
      purpose: "login",
    });
    expect(generateToken).not.toHaveBeenCalled();
    expect(beforeSession).not.toHaveBeenCalled();
  });

  it("link: stores only the ticket's hash and links nothing yet", async () => {
    const r = await beginSession(twoFactor, {
      link: { ticket: "tk", markEmailVerified: true },
    });
    expect(r).toMatchObject({ status: "mfa_required" });
    expect(m.createMfaChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "link",
        linkTicketHash: sha256Hex("tk"),
        linkMarkEmailVerified: true,
      }),
    );
    expect(m.completeLinkFromTicket).not.toHaveBeenCalled();
    expect(generateToken).not.toHaveBeenCalled();
  });
});

describe("issueSession", () => {
  it("re-reads the user and mints", async () => {
    m.getUser.mockResolvedValue(plain);
    expect(await issueSession("u1")).toMatchObject({
      status: "signed_in",
      token: "mock-jwt-token",
    });
  });
});
