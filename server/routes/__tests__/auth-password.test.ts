import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { storage } from "../../storage";
import { register } from "../auth-password";
import { requireAuth } from "../../middleware/auth";
import {
  sendPasswordChangeCode,
  sendPasswordChangedNotice,
} from "../../services/email";
import { createMockUser } from "../../__tests__/factories";
import { hashChangeCode } from "../../lib/password-reset-code";

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUserForAuth: vi.fn(),
    issuePasswordChangeCode: vi.fn(),
    reservePasswordChangeAttempt: vi.fn(),
    changePassword: vi.fn(),
    listIdentities: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../../lib/pwned-password", () => ({
  isBreached: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../services/email", () => ({
  sendPasswordChangeCode: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
}));
// reauthenticate and issueSession have their own tests in auth-social; here
// they are seams so each proof branch and the mint can be asserted.
vi.mock("../auth-social", async (orig) => ({
  ...(await orig<typeof import("../auth-social")>()),
  reauthenticate: vi.fn(),
  issueSession: vi.fn(),
}));
const { mockVerifySecondFactor } = vi.hoisted(() => ({
  mockVerifySecondFactor: vi.fn(),
}));
vi.mock("../../lib/mfa/verify-second-factor", () => ({
  verifySecondFactor: mockVerifySecondFactor,
}));

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}
const post = (path: string, body: object = {}) =>
  request(app())
    .post(`/api/auth/${path}`)
    .set("Authorization", "Bearer t")
    .send(body);

let user: ReturnType<typeof createMockUser>;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockImplementation(async (req, _res, next) => {
    req.userId = "1";
    next();
  });
  user = createMockUser({
    id: "1",
    email: "owner@example.com",
    pendingEmail: "staged@example.com",
    tokenVersion: 4,
    mfaEnabledAt: null,
    password: await bcrypt.hash("current-pass-123", 4),
  });
  vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
  vi.mocked(storage.issuePasswordChangeCode).mockResolvedValue(true);
  vi.mocked(storage.listIdentities).mockResolvedValue([]);
  vi.mocked(sendPasswordChangeCode).mockResolvedValue(undefined);
  vi.mocked(sendPasswordChangedNotice).mockResolvedValue(undefined);
  mockVerifySecondFactor.mockResolvedValue({ ok: true });
});

describe("POST /api/auth/change-password/code", () => {
  // Review Focus 1.
  it("stores a hashed code and sends it to the current address, never pendingEmail", async () => {
    const res = await post("change-password/code");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "code_sent" });
    const [uid, stored] = vi.mocked(storage.issuePasswordChangeCode).mock
      .calls[0];
    expect(uid).toBe("1");
    const [to, code] = vi.mocked(sendPasswordChangeCode).mock.calls[0];
    expect(to).toBe("owner@example.com");
    expect(code).toMatch(/^\d{6}$/);
    expect(stored).toBe(hashChangeCode("1", code)); // only the hash is stored
  });

  it("at the cap → 429 with the plain message, nothing sent", async () => {
    vi.mocked(storage.issuePasswordChangeCode).mockResolvedValue(false);
    const res = await post("change-password/code");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error:
        "You've requested too many codes today. Try again tomorrow, or use Google/Apple.",
      code: "RATE_LIMITED",
    });
    expect(sendPasswordChangeCode).not.toHaveBeenCalled();
  });

  it("the user vanished → 404", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(undefined);
    expect((await post("change-password/code")).status).toBe(404);
  });
});
