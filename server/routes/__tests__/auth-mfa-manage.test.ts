import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { storage } from "../../storage";
import { register } from "../auth-mfa";
import {
  generateToken,
  invalidateTokenVersionCache,
  requireAuth,
} from "../../middleware/auth";
import {
  sendTwoFactorNotice,
  sendPasswordChangedNotice,
} from "../../services/email";
import { isBreached } from "../../lib/pwned-password";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUserForAuth: vi.fn(),
    getUser: vi.fn(),
    disableMfa: vi.fn(),
    forgetTrustedDevices: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

// Never call api.pwnedpasswords.com from a test.
vi.mock("../../lib/pwned-password", () => ({
  isBreached: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../services/email", () => ({
  sendTwoFactorNotice: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
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

let passwordHash: string;
const LONG_PASSWORD = "right-long-pass-1";
const SHORT_PASSWORD = "short-pass-1"; // 12
let longHash: string;
let shortHash: string;

const post = (path: string, body: object = {}) =>
  request(app())
    .post(`/api/auth/mfa/${path}`)
    .set("Authorization", "Bearer t")
    .send(body);

function asUser(over: Parameters<typeof createMockUser>[0] = {}) {
  const u = createMockUser({ password: passwordHash, ...over });
  vi.mocked(storage.getUserForAuth).mockResolvedValue(u);
  vi.mocked(storage.getUser).mockResolvedValue(u);
  return u;
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(generateToken).mockReturnValue("mock-jwt-token");
  // resetAllMocks clears the __mocks__ defaults too; re-seed requireAuth.
  vi.mocked(requireAuth).mockImplementation(async (req, _res, next) => {
    req.userId = "1";
    next();
  });
  vi.mocked(sendTwoFactorNotice).mockResolvedValue(undefined);
  vi.mocked(sendPasswordChangedNotice).mockResolvedValue(undefined);
  passwordHash ??= await bcrypt.hash("right-pass1", 4);
  asUser();
  mockVerifySecondFactor.mockResolvedValue({ ok: true });
});
describe("POST /api/auth/mfa/disable", () => {
  beforeEach(async () => {
    longHash ??= await bcrypt.hash(LONG_PASSWORD, 4);
    asUser({ password: longHash, mfaEnabledAt: new Date() });
  });

  it("password + factor → off, sessions end, notice sent, a fresh session returned", async () => {
    vi.mocked(storage.disableMfa).mockResolvedValue(5);
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({ password: longHash, tokenVersion: 5 }),
    );
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe("mock-jwt-token");
    expect(storage.disableMfa).toHaveBeenCalledWith("1");
    expect(sendPasswordChangedNotice).not.toHaveBeenCalled();
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
    expect(sendTwoFactorNotice).toHaveBeenCalledWith(
      "testuser@example.com",
      "testuser",
      "disabled",
    );
  });

  // Auth audit 2026-10-11 L3 (as L12).
  it("off, then a version bump before the mint → 401, no session", async () => {
    vi.mocked(storage.disableMfa).mockResolvedValue(5);
    vi.mocked(storage.getUser).mockResolvedValue(
      createMockUser({ password: longHash, tokenVersion: 6 }),
    );
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(401);
    expect(res.body.token).toBeUndefined();
  });

  it("the account vanished under the write (disableMfa returned nothing) → 404, no session", async () => {
    vi.mocked(storage.disableMfa).mockResolvedValue(undefined);
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { code: "123456" },
    });
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();
    expect(storage.getUser).not.toHaveBeenCalled();
  });

  it("no factor → 400 (schema), nothing changed", async () => {
    const res = await post("disable", { password: LONG_PASSWORD });
    expect(res.status).toBe(400);
    expect(storage.disableMfa).not.toHaveBeenCalled();
  });

  it("a recovery code is no longer a factor → 400, still on", async () => {
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { recoveryCode: "ABCD-EFGH-IJKL-MNOP" },
    });
    expect(res.status).toBe(400);
    expect(mockVerifySecondFactor).not.toHaveBeenCalled();
    expect(storage.disableMfa).not.toHaveBeenCalled();
  });

  it("wrong factor → 401, still on", async () => {
    mockVerifySecondFactor.mockResolvedValue({ ok: false });
    const res = await post("disable", {
      password: LONG_PASSWORD,
      secondFactor: { code: "000000" },
    });
    expect(res.status).toBe(401);
    expect(storage.disableMfa).not.toHaveBeenCalled();
  });

  describe("a short password turns two-step off as it is (owner ruling 2026-10-12)", () => {
    beforeEach(async () => {
      shortHash ??= await bcrypt.hash(SHORT_PASSWORD, 4);
      asUser({ password: shortHash, mfaEnabledAt: new Date() });
      vi.mocked(isBreached).mockResolvedValue(false);
    });

    it("a 12-character password, no newPassword: two-step off, password unchanged", async () => {
      vi.mocked(storage.disableMfa).mockResolvedValue(6);
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ tokenVersion: 6 }),
      );
      const res = await post("disable", {
        password: SHORT_PASSWORD,
        secondFactor: { code: "123456" },
      });
      expect(res.status).toBe(200);
      expect(res.body.code).toBeUndefined();
      expect(mockVerifySecondFactor).toHaveBeenCalledTimes(1);
      expect(storage.disableMfa).toHaveBeenCalledWith("1");
      expect(sendPasswordChangedNotice).not.toHaveBeenCalled();
    });

    it("a 7-character password set before the policy also turns it off", async () => {
      asUser({
        password: await bcrypt.hash("seven-7", 4),
        mfaEnabledAt: new Date(),
      });
      vi.mocked(storage.disableMfa).mockResolvedValue(6);
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ tokenVersion: 6 }),
      );
      const res = await post("disable", {
        password: "seven-7",
        secondFactor: { code: "123456" },
      });
      expect(res.status).toBe(200);
    });

    it("a wrong current password still answers 401", async () => {
      const res = await post("disable", {
        password: "wrong-pass1",
        secondFactor: { code: "123456" },
      });
      expect(res.status).toBe(401);
      expect(storage.disableMfa).not.toHaveBeenCalled();
    });

    it("a newPassword from an older build is ignored: off, password unchanged, no notice", async () => {
      vi.mocked(storage.disableMfa).mockResolvedValue(6);
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ tokenVersion: 6 }),
      );
      const res = await post("disable", {
        password: SHORT_PASSWORD,
        secondFactor: { code: "123456" },
        newPassword: "a-long-test-passphrase",
      });
      expect(res.status).toBe(200);
      expect(storage.disableMfa).toHaveBeenCalledWith("1");
      expect(sendPasswordChangedNotice).not.toHaveBeenCalled();
    });
  });
});

describe("DELETE /api/auth/mfa/trusted-devices", () => {
  it("forgets every trusted phone → 204", async () => {
    const res = await request(app())
      .delete("/api/auth/mfa/trusted-devices")
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(204);
    expect(storage.forgetTrustedDevices).toHaveBeenCalledWith("1");
  });
});
