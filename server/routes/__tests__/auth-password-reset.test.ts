import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";

import { storage } from "../../storage";
import { register } from "../auth";
import { invalidateTokenVersionCache } from "../../middleware/auth";
import {
  sendPasswordResetCode,
  sendPasswordChangedNotice,
} from "../../services/email";
import { hashResetCode } from "../../lib/password-reset-code";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  ReservedUsernameError: class extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUserByEmailForAuth: vi.fn(),
    issuePasswordResetCode: vi.fn(),
    reservePasswordResetAttempt: vi.fn(),
    completePasswordReset: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../../lib/email-config", () => ({
  emailVerificationEnabled: () => true,
}));
vi.mock("../../services/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendSignupAttemptNotice: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetCode: vi.fn().mockResolvedValue(undefined),
  sendPasswordChangedNotice: vi.fn().mockResolvedValue(undefined),
}));

// Every logger the route path can reach (service loggers, the root logger
// fireAndForget uses) funnels into one spy, so a test can assert that a reset
// code never appears in ANY log call.
const mockLog = vi.hoisted(() => {
  const log: Record<string, unknown> = {};
  for (const level of ["error", "warn", "info", "debug", "trace", "fatal"]) {
    log[level] = vi.fn();
  }
  log.child = () => log;
  return log as Record<
    "error" | "warn" | "info" | "debug" | "trace" | "fatal",
    ReturnType<typeof vi.fn>
  > & { child: () => unknown };
});
vi.mock("../../lib/logger", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/logger")>();
  return {
    ...orig,
    logger: mockLog,
    rootLogger: mockLog,
    createServiceLogger: () => mockLog,
  };
});

const NEUTRAL = {
  status: "reset_code_sent",
  message:
    "If an account uses that email, we've sent a 6-digit code. It expires in 15 minutes.",
};
const INVALID = {
  error: "That code is incorrect or expired.",
  code: "INVALID_RESET_CODE",
};
const flush = () => new Promise((r) => setImmediate(r));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

function allLogCalls(): string {
  return JSON.stringify(
    ["error", "warn", "info", "debug", "trace", "fatal"].map(
      (level) => mockLog[level as "error"].mock.calls,
    ),
  );
}

describe("POST /api/auth/forgot-password", () => {
  let app: express.Express;
  const user = createMockUser({
    email: "real@example.com",
    username: "realuser",
  });

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    vi.mocked(storage.issuePasswordResetCode).mockResolvedValue(true);
  });

  it("existing account: neutral 200, stores a code, emails the same code", async () => {
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(user);
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: " Real@Example.com " });
    await flush();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(NEUTRAL);
    expect(storage.getUserByEmailForAuth).toHaveBeenCalledWith(
      "real@example.com",
    );
    const [storedId, storedHash] = vi.mocked(storage.issuePasswordResetCode)
      .mock.calls[0];
    const [to, code] = vi.mocked(sendPasswordResetCode).mock.calls[0];
    expect(storedId).toBe(user.id);
    expect(to).toBe(user.email);
    expect(code).toMatch(/^\d{6}$/);
    expect(storedHash).toBe(hashResetCode(user.id, code));
  });

  it("unknown email: byte-identical 200, nothing stored or sent", async () => {
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(undefined);
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@example.com" });
    await flush();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(NEUTRAL);
    expect(storage.issuePasswordResetCode).not.toHaveBeenCalled();
    expect(sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it("daily cap reached: same 200, no email", async () => {
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(user);
    vi.mocked(storage.issuePasswordResetCode).mockResolvedValue(false);
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "real@example.com" });
    await flush();
    expect(res.body).toEqual(NEUTRAL);
    expect(sendPasswordResetCode).not.toHaveBeenCalled();
  });

  it("malformed email: 400 VALIDATION_ERROR, no lookup", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(storage.getUserByEmailForAuth).not.toHaveBeenCalled();
  });

  it("never logs the code, even when the background send fails", async () => {
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(user);
    vi.mocked(sendPasswordResetCode).mockRejectedValueOnce(
      new Error("resend down"),
    );
    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "real@example.com" });
    await flush();
    const [, code] = vi.mocked(sendPasswordResetCode).mock.calls[0];
    // Positive control: the failure WAS logged, so the absence check below
    // inspects real log traffic rather than an empty spy.
    expect(mockLog.error).toHaveBeenCalled();
    expect(allLogCalls()).not.toContain(code);
  });
});

describe("POST /api/auth/reset-password", () => {
  let app: express.Express;
  const id = "user-123";
  const good = {
    email: "real@example.com",
    code: "123456",
    newPassword: "newpass99",
  };
  const reserved = {
    id,
    username: "realuser",
    email: "real@example.com",
    resetCodeHash: hashResetCode(id, "123456"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
    vi.mocked(storage.reservePasswordResetAttempt).mockResolvedValue(reserved);
    vi.mocked(storage.completePasswordReset).mockResolvedValue(true);
  });

  it("happy path: resets, invalidates the cache, sends the notice, issues no token", async () => {
    const res = await request(app).post("/api/auth/reset-password").send(good);
    await flush();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "password_reset" });
    expect(res.body).not.toHaveProperty("token");
    const [cid, chash, newHash] = vi.mocked(storage.completePasswordReset).mock
      .calls[0];
    expect(cid).toBe(id);
    expect(chash).toBe(reserved.resetCodeHash);
    expect(await bcrypt.compare("newpass99", newHash)).toBe(true);
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith(id);
    expect(sendPasswordChangedNotice).toHaveBeenCalledWith(
      "real@example.com",
      "realuser",
    );
  });

  it("wrong code, no live code, and lost completion race all give the identical 400", async () => {
    const wrong = await request(app)
      .post("/api/auth/reset-password")
      .send({ ...good, code: "000000" });
    vi.mocked(storage.reservePasswordResetAttempt).mockResolvedValue(undefined);
    const none = await request(app).post("/api/auth/reset-password").send(good);
    vi.mocked(storage.reservePasswordResetAttempt).mockResolvedValue(reserved);
    vi.mocked(storage.completePasswordReset).mockResolvedValue(false);
    const raced = await request(app)
      .post("/api/auth/reset-password")
      .send(good);
    for (const r of [wrong, none, raced]) {
      expect(r.status).toBe(400);
      expect(r.body).toEqual(INVALID);
    }
    expect(invalidateTokenVersionCache).not.toHaveBeenCalled();
    expect(sendPasswordChangedNotice).not.toHaveBeenCalled();
  });

  it("weak password: VALIDATION_ERROR and no attempt used up", async () => {
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({ ...good, newPassword: "short" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(storage.reservePasswordResetAttempt).not.toHaveBeenCalled();
  });

  it("normalizes the email before using up an attempt", async () => {
    await request(app)
      .post("/api/auth/reset-password")
      .send({ ...good, email: "  Real@Example.com " });
    expect(storage.reservePasswordResetAttempt).toHaveBeenCalledWith(
      "real@example.com",
    );
  });
});
