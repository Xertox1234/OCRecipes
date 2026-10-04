import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { ipKeyGenerator as normalizeIpKey } from "express-rate-limit";

import { storage } from "../../storage";
import {
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  resetPasswordIpLimiter,
  resetPasswordEmailLimiter,
  normalizeUsernameKey,
} from "../_rate-limiters";
import { register } from "../auth";

// NOTE: deliberately NO vi.mock("express-rate-limit") — this file exercises
// the REAL reset limiters (spec §4.1–4.2). The MemoryStores persist for the
// module's lifetime, so every request records the exact production keys it
// touches and beforeEach drains them (same isolation scheme as
// auth-account-throttle.test.ts, which documents why retry:2 needs it).

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
vi.mock("../../services/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendSignupAttemptNotice: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetCode: vi.fn().mockResolvedValue(undefined),
  sendPasswordChangedNotice: vi.fn().mockResolvedValue(undefined),
}));

let app: express.Express;

beforeAll(() => {
  app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  register(app);
  vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(undefined);
  vi.mocked(storage.reservePasswordResetAttempt).mockResolvedValue(undefined);
});

const touched: { limiter: { resetKey: (k: string) => void }; key: string }[] =
  [];

function post(
  path: "forgot-password" | "reset-password",
  email: string,
  ip: string,
) {
  const emailKey = normalizeUsernameKey(email);
  const ipKey = normalizeIpKey(ip);
  if (path === "forgot-password") {
    touched.push({ limiter: forgotPasswordIpLimiter, key: ipKey });
    touched.push({
      limiter: forgotPasswordEmailLimiter,
      key: `forgot-email:${emailKey}`,
    });
  } else {
    touched.push({ limiter: resetPasswordIpLimiter, key: ipKey });
    touched.push({
      limiter: resetPasswordEmailLimiter,
      key: `reset-email:${emailKey}`,
    });
  }
  const body =
    path === "forgot-password"
      ? { email }
      : { email, code: "123456", newPassword: "newpass99" };
  return request(app)
    .post(`/api/auth/${path}`)
    .set("X-Forwarded-For", ip)
    .send(body);
}

beforeEach(() => {
  for (const { limiter, key } of touched) limiter.resetKey(key);
  touched.length = 0;
});

describe("forgot-password limiters", () => {
  it("per email: 3 per hour, spacing/case variants share the bucket, honest copy on the 4th", async () => {
    for (let i = 0; i < 3; i++) {
      const res = await post(
        "forgot-password",
        "victim@example.com",
        `198.51.100.${i + 1}`,
      );
      expect(res.status).toBe(200);
    }
    const res = await post(
      "forgot-password",
      "  Victim@Example.com ",
      "198.51.100.9",
    );
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: "Too many code requests for this email. Try again in an hour.",
      code: "RATE_LIMITED",
    });
  });

  it("per IP: 10 per 15 min across different emails", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await post(
        "forgot-password",
        `spray${i}@example.com`,
        "192.0.2.50",
      );
      expect(res.status).toBe(200);
    }
    const res = await post(
      "forgot-password",
      "spray-last@example.com",
      "192.0.2.50",
    );
    expect(res.status).toBe(429);
  });
});

describe("reset-password limiters", () => {
  it("per email: 10 per 15 min even from rotating IPs", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await post(
        "reset-password",
        "target@example.com",
        `203.0.113.${i + 1}`,
      );
      expect(res.status).toBe(400);
    }
    const res = await post(
      "reset-password",
      "TARGET@example.com",
      "203.0.113.99",
    );
    expect(res.status).toBe(429);
  });

  it("per IP: 20 per 15 min across different emails", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await post(
        "reset-password",
        `guess${i}@example.com`,
        "192.0.2.77",
      );
      expect(res.status).toBe(400);
    }
    const res = await post(
      "reset-password",
      "guess-last@example.com",
      "192.0.2.77",
    );
    expect(res.status).toBe(429);
  });
});
