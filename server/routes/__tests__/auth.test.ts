import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { detectImageMimeType } from "../../lib/image-mime";
import { register } from "../auth";
import { ZodError } from "zod";
import { ipKeyGenerator } from "../_rate-limiters";
import {
  parsePositiveIntParam,
  parseQueryInt,
  parseQueryDate,
  parseQueryString,
  parseStringParam,
  formatZodError,
  getPremiumFeatures,
  checkPremiumFeature,
} from "../_helpers";
import { createMockUser } from "../../__tests__/factories";
import { emailVerificationEnabled } from "../../lib/email-config";
import {
  mockExpressReq,
  mockExpressRes,
} from "../../__tests__/utils/express-mocks";

// Mock storage before importing routes
vi.mock("../../storage", () => ({
  storage: {
    getUserByUsername: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByUsernameForAuth: vi.fn(),
    getUserForAuth: vi.fn(),
    createUser: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    incrementTokenVersion: vi.fn(),
    getSubscriptionStatus: vi.fn(),
    getEffectiveTierForUser: vi.fn(),
    deleteUser: vi.fn(),
    markEmailVerified: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

vi.mock("express-rate-limit");

vi.mock("../../lib/email-config", () => ({
  emailVerificationEnabled: vi.fn(),
}));

// CRITICAL: these mocks MUST return resolved promises. The register handler
// calls `fireAndForget(label, sendVerificationEmail(...))`, and fireAndForget
// does `promise.catch(...)`. A bare vi.fn() returns undefined → undefined.catch()
// throws synchronously inside the handler try → 500 (not the 200 we assert).
vi.mock("../../services/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendSignupAttemptNotice: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/image-mime", () => ({
  detectImageMimeType: vi.fn(),
}));

// Avatar persistence now flows through ../lib/image-store (saveAvatar /
// deleteImage), which wraps R2-or-disk I/O. Mock that boundary instead of fs.
// saveAvatar returns a disk-mode URL so the existing URL-shape assertions hold;
// deleteImage is a spy the handlers delegate old/new-avatar cleanup to.
// (The basename/traversal stripping + external-URL no-op live in image-store
// itself and are covered by server/lib/__tests__/image-store.test.ts.)
const { mockSaveAvatar, mockDeleteImage } = vi.hoisted(() => ({
  // Mirrors the real signature: (buffer, ext) — keys are random, not
  // userId-derived (the key must not leak the UUID on the public CDN).
  mockSaveAvatar: vi
    .fn()
    .mockImplementation((_buffer: Buffer, ext: string) =>
      Promise.resolve(`/api/avatars/mock-key-${Date.now()}.${ext}`),
    ),
  mockDeleteImage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../lib/image-store", () => ({
  saveAvatar: mockSaveAvatar,
  deleteImage: mockDeleteImage,
}));

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockUser = createMockUser();

describe("Auth Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
    // Default: no email collision; the duplicate-email test overrides this.
    vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
    // Default the gate OFF (fail-open) so existing tests keep old behavior;
    // ON-path tests opt in explicitly. No global resetMocks, so this is the
    // guard against a prior test's mockReturnValue(true) leaking forward.
    vi.mocked(emailVerificationEnabled).mockReturnValue(false);
  });

  describe("POST /api/auth/register", () => {
    it("creates a new user and returns token", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.createUser).mockResolvedValue(mockUser);

      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: "password123",
        email: "newuser@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(201);
      expect(res.body.token).toBe("mock-jwt-token");
      expect(res.body.user.username).toBe("testuser");
      expect(res.body.user.id).toBe("1");
      expect(res.body.user).not.toHaveProperty("password");
    });

    it("returns 409 if username already exists", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(mockUser);

      const res = await request(app).post("/api/auth/register").send({
        username: "testuser",
        password: "password123",
        email: "newuser@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Username already exists");
    });

    it("returns 409 when createUser loses a unique-violation race (wrapped 23505)", async () => {
      // Pre-check passes, but a concurrent registration wins the insert.
      // drizzle-orm 0.44+ wraps the pg error, moving the 23505 code to .cause.
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      const wrapped = Object.assign(
        new Error("Failed query: insert into users ..."),
        { cause: { code: "23505" } },
      );
      vi.mocked(storage.createUser).mockRejectedValue(wrapped);

      const res = await request(app).post("/api/auth/register").send({
        username: "raceuser",
        password: "password123",
        email: "raceuser@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Username already exists");
    });

    it("returns 409 'Email already registered' when createUser loses an email-unique race", async () => {
      // Both pre-checks pass, but a concurrent insert wins on the email index.
      // The catch must map the 23505 to the EMAIL message via the constraint name.
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      const wrapped = Object.assign(
        new Error("Failed query: insert into users ..."),
        { cause: { code: "23505", constraint: "users_email_unique" } },
      );
      vi.mocked(storage.createUser).mockRejectedValue(wrapped);

      const res = await request(app).post("/api/auth/register").send({
        username: "raceuser2",
        password: "password123",
        email: "race@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Email already registered");
    });

    it("returns 400 for short username", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "ab",
        password: "password123",
        ageConfirmed: true,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("at least 3 characters");
    });

    it("returns 400 for short password", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "testuser",
        password: "short",
        ageConfirmed: true,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("at least 8 characters");
    });

    it("returns 400 for invalid username characters", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "bad user!",
        password: "password123",
        ageConfirmed: true,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("letters, numbers, and underscores");
    });

    it("returns 400 for missing fields", async () => {
      const res = await request(app).post("/api/auth/register").send({});

      expect(res.status).toBe(400);
    });

    it("returns 400 when ageConfirmed is missing (COPPA age gate)", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: "password123",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("ageConfirmed");
    });

    it("returns 400 when ageConfirmed is false (COPPA age gate)", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: "password123",
        ageConfirmed: false,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("ageConfirmed");
    });

    it("persists the normalized (trimmed + lowercased) email", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.createUser).mockResolvedValue(mockUser);

      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: "password123",
        email: "  NewUser@Example.COM ",
        ageConfirmed: true,
      });

      expect(res.status).toBe(201);
      expect(storage.createUser).toHaveBeenCalledWith(
        expect.objectContaining({ email: "newuser@example.com" }),
      );
    });

    it("returns 400 when ageConfirmed is missing even with a valid email", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: "password123",
        email: "newuser@example.com",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("ageConfirmed");
    });

    it("returns 400 for an invalid email", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: "password123",
        email: "not-an-email",
        ageConfirmed: true,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("valid email");
    });

    it("returns 409 if the email is already registered", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.getUserByEmail).mockResolvedValue(mockUser);

      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: "password123",
        email: "taken@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Email already registered");
    });

    it("returns email and emailVerified in the auth response", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.createUser).mockResolvedValue(mockUser);

      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: "password123",
        email: "newuser@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({
        email: "testuser@example.com",
        emailVerified: false,
      });
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns user and token on valid credentials", async () => {
      // Create a real bcrypt hash for "password123"
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("password123", 10);
      const userWithHash = createMockUser({ password: hash });

      vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
        userWithHash,
      );

      const res = await request(app).post("/api/auth/login").send({
        username: "testuser",
        password: "password123",
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBe("mock-jwt-token");
      expect(res.body.user.username).toBe("testuser");
      expect(res.body.user).not.toHaveProperty("password");
    });

    it("returns 401 for non-existent user", async () => {
      vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(undefined);

      const res = await request(app).post("/api/auth/login").send({
        username: "noone",
        password: "password123",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
    });

    it("returns 401 for wrong password", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 10);
      const userWithHash = createMockUser({ password: hash });

      vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
        userWithHash,
      );

      const res = await request(app).post("/api/auth/login").send({
        username: "testuser",
        password: "wrongpassword",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
    });

    it("returns 400 for missing credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({});

      expect(res.status).toBe(400);
    });

    it("blocks login with 403 EMAIL_NOT_VERIFIED when unverified + verification ON", async () => {
      vi.mocked(emailVerificationEnabled).mockReturnValue(true);
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("password123", 10);
      vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
        createMockUser({ emailVerified: false, password: hash }),
      );

      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "testuser", password: "password123" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
      expect(res.body.token).toBeUndefined();
    });

    it("allows unverified login when verification OFF (fail-open)", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("password123", 10);
      vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
        createMockUser({ emailVerified: false, password: hash }),
      );

      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "testuser", password: "password123" });

      expect(res.status).toBe(200);
      expect(res.body.token).toBe("mock-jwt-token");
    });
  });

  describe("POST /api/auth/logout", () => {
    it("increments token version atomically and returns success", async () => {
      vi.mocked(storage.incrementTokenVersion).mockResolvedValue(
        createMockUser({ tokenVersion: 1 }),
      );

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storage.incrementTokenVersion).toHaveBeenCalledWith("1");
    });

    it("returns 404 if user not found", async () => {
      vi.mocked(storage.incrementTokenVersion).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns current user data", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(200);
      expect(res.body.username).toBe("testuser");
      expect(res.body.id).toBe("1");
      expect(res.body).not.toHaveProperty("password");
      expect(res.body.subscriptionTier).toBe("free");
    });

    it("returns 401 if user not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(401);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getUser).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(500);
    });
  });

  describe("PUT /api/auth/profile", () => {
    it("updates display name", async () => {
      const updated = createMockUser({ displayName: "Test User" });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);

      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ displayName: "Test User" });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe("Test User");
    });

    it("updates calorie goal", async () => {
      const updated = createMockUser({ dailyCalorieGoal: 2500 });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);

      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ dailyCalorieGoal: 2500 });

      expect(res.status).toBe(200);
      expect(res.body.dailyCalorieGoal).toBe(2500);
    });

    it("returns 400 for empty update", async () => {
      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("No valid fields to update");
    });

    it("returns 400 for invalid calorie goal", async () => {
      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ dailyCalorieGoal: 100 });

      expect(res.status).toBe(400);
    });

    it("returns 404 if user not found on update", async () => {
      vi.mocked(storage.updateUser).mockResolvedValue(undefined);

      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ displayName: "Ghost" });

      expect(res.status).toBe(404);
    });

    it("updates onboardingCompleted field", async () => {
      const updated = createMockUser({ onboardingCompleted: true });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);

      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ onboardingCompleted: true });

      expect(res.status).toBe(200);
      expect(res.body.onboardingCompleted).toBe(true);
      expect(storage.updateUser).toHaveBeenCalledWith("1", {
        onboardingCompleted: true,
      });
    });

    it("updates measurementUnit field", async () => {
      const updated = createMockUser({ measurementUnit: "imperial" });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);

      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ measurementUnit: "imperial" });

      expect(res.status).toBe(200);
      expect(res.body.measurementUnit).toBe("imperial");
      expect(storage.updateUser).toHaveBeenCalledWith("1", {
        measurementUnit: "imperial",
      });
    });

    it("rejects an invalid measurementUnit value", async () => {
      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ measurementUnit: "stones" });

      expect(res.status).toBe(400);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.updateUser).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ displayName: "Test" });

      expect(res.status).toBe(500);
    });
  });

  describe("DELETE /api/auth/account", () => {
    let invalidateTokenVersionCache: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const authMod = await import("../../middleware/auth");
      invalidateTokenVersionCache = vi.mocked(
        authMod.invalidateTokenVersionCache,
      );
      invalidateTokenVersionCache.mockClear();
    });

    it("hard-deletes the user with the correct password and invalidates token cache", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 10);
      const userWithHash = createMockUser({ password: hash });

      vi.mocked(storage.getUserForAuth).mockResolvedValue(userWithHash);
      vi.mocked(storage.deleteUser).mockResolvedValue(true);

      const res = await request(app)
        .delete("/api/auth/account")
        .set("Authorization", "Bearer mock-token")
        .send({ password: "correctpassword" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storage.deleteUser).toHaveBeenCalledWith("1");
      expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
      // deleteUser must be called BEFORE invalidateTokenVersionCache
      const deleteOrder = vi.mocked(storage.deleteUser).mock
        .invocationCallOrder[0];
      const invalidateOrder =
        invalidateTokenVersionCache.mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(invalidateOrder);
    });

    it("returns 401 for wrong password and does NOT delete the user", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 10);
      const userWithHash = createMockUser({ password: hash });

      vi.mocked(storage.getUserForAuth).mockResolvedValue(userWithHash);

      const res = await request(app)
        .delete("/api/auth/account")
        .set("Authorization", "Bearer mock-token")
        .send({ password: "wrongpassword" });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
      expect(storage.deleteUser).not.toHaveBeenCalled();
      expect(invalidateTokenVersionCache).not.toHaveBeenCalled();
    });

    it("returns 404 if user no longer exists", async () => {
      vi.mocked(storage.getUserForAuth).mockResolvedValue(undefined);

      const res = await request(app)
        .delete("/api/auth/account")
        .set("Authorization", "Bearer mock-token")
        .send({ password: "anypassword" });

      expect(res.status).toBe(404);
      expect(storage.deleteUser).not.toHaveBeenCalled();
    });

    it("returns 400 when password is missing", async () => {
      const res = await request(app)
        .delete("/api/auth/account")
        .set("Authorization", "Bearer mock-token")
        .send({});

      expect(res.status).toBe(400);
      expect(storage.getUserForAuth).not.toHaveBeenCalled();
    });

    it("returns 400 when password is empty string", async () => {
      const res = await request(app)
        .delete("/api/auth/account")
        .set("Authorization", "Bearer mock-token")
        .send({ password: "" });

      expect(res.status).toBe(400);
      expect(storage.getUserForAuth).not.toHaveBeenCalled();
    });

    it("returns 500 when storage.deleteUser throws", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 10);
      const userWithHash = createMockUser({ password: hash });

      vi.mocked(storage.getUserForAuth).mockResolvedValue(userWithHash);
      vi.mocked(storage.deleteUser).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .delete("/api/auth/account")
        .set("Authorization", "Bearer mock-token")
        .send({ password: "correctpassword" });

      expect(res.status).toBe(500);
      expect(invalidateTokenVersionCache).not.toHaveBeenCalled();
    });

    it("cleans up the user's avatar file on successful deletion", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 10);
      const userWithHash = createMockUser({
        password: hash,
        avatarUrl: "/api/avatars/1-123.jpg",
      });

      vi.mocked(storage.getUserForAuth).mockResolvedValue(userWithHash);
      vi.mocked(storage.deleteUser).mockResolvedValue(true);
      mockDeleteImage.mockClear();

      const res = await request(app)
        .delete("/api/auth/account")
        .set("Authorization", "Bearer mock-token")
        .send({ password: "correctpassword" });

      expect(res.status).toBe(200);
      // The deleted user's own avatar is cleaned up via image-store.
      expect(mockDeleteImage).toHaveBeenCalledWith(
        "/api/avatars/1-123.jpg",
        "avatar",
      );
    });
  });

  describe("Error paths", () => {
    it("POST /api/auth/register returns 500 on storage error", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.createUser).mockRejectedValue(new Error("DB error"));

      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: "password123",
        email: "newuser@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(500);
    });

    it("POST /api/auth/login returns 500 on storage error", async () => {
      vi.mocked(storage.getUserByUsernameForAuth).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app).post("/api/auth/login").send({
        username: "testuser",
        password: "password123",
      });

      expect(res.status).toBe(500);
    });

    it("POST /api/auth/logout returns 500 on storage error", async () => {
      vi.mocked(storage.incrementTokenVersion).mockRejectedValue(
        new Error("DB error"),
      );

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/user/avatar", () => {
    // JPEG magic bytes: FF D8 FF E0
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

    it("uploads a valid JPEG avatar", async () => {
      vi.mocked(detectImageMimeType).mockReturnValue("image/jpeg");
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);
      // Keys are random (never userId-derived) — fixtures mirror that.
      const updated = createMockUser({
        avatarUrl: "/api/avatars/mock-key-1234567890.jpg",
      });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);

      const res = await request(app)
        .post("/api/user/avatar")
        .set("Authorization", "Bearer mock-token")
        .attach("avatar", jpegBuffer, {
          filename: "photo.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("avatarUrl");
      // res.body echoes the updateUser fixture, not the saveAvatar return
      expect(res.body.avatarUrl).toMatch(/^\/api\/avatars\/mock-key-\d+\.jpg$/);
      expect(storage.updateUser).toHaveBeenCalledWith(
        "1",
        expect.objectContaining({
          avatarUrl: expect.stringMatching(
            /^\/api\/avatars\/mock-key-\d+\.jpg$/,
          ),
        }),
      );
    });

    it("returns 400 when no file is attached", async () => {
      const res = await request(app)
        .post("/api/user/avatar")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(400);
    });

    it("returns 400 for invalid image content", async () => {
      vi.mocked(detectImageMimeType).mockReturnValue(null);

      const res = await request(app)
        .post("/api/user/avatar")
        .set("Authorization", "Bearer mock-token")
        .attach("avatar", Buffer.from([0x00, 0x00, 0x00]), {
          filename: "bad.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("Invalid image content");
    });

    it("returns 404 and rolls back the new avatar when user not found after update", async () => {
      vi.mocked(detectImageMimeType).mockReturnValue("image/jpeg");
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);
      vi.mocked(storage.updateUser).mockResolvedValue(undefined);
      mockSaveAvatar.mockResolvedValueOnce("/api/avatars/1-rollback.jpg");
      mockDeleteImage.mockClear();

      const res = await request(app)
        .post("/api/user/avatar")
        .set("Authorization", "Bearer mock-token")
        .attach("avatar", jpegBuffer, {
          filename: "photo.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(404);
      // The just-saved avatar must be rolled back via image-store.
      expect(mockDeleteImage).toHaveBeenCalledWith(
        "/api/avatars/1-rollback.jpg",
        "avatar",
      );
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(detectImageMimeType).mockReturnValue("image/jpeg");
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);
      vi.mocked(storage.updateUser).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .post("/api/user/avatar")
        .set("Authorization", "Bearer mock-token")
        .attach("avatar", jpegBuffer, {
          filename: "photo.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(500);
    });
  });

  describe("DELETE /api/user/avatar", () => {
    it("deletes avatar successfully", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ avatarUrl: "/api/avatars/1-123.jpg" }),
      );
      const updated = createMockUser({ avatarUrl: null });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);

      const res = await request(app)
        .delete("/api/user/avatar")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storage.updateUser).toHaveBeenCalledWith("1", {
        avatarUrl: null,
      });
    });

    it("returns 404 when user not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);
      vi.mocked(storage.updateUser).mockResolvedValue(undefined);

      const res = await request(app)
        .delete("/api/user/avatar")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(404);
    });

    it("returns 500 when storage throws", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);
      vi.mocked(storage.updateUser).mockRejectedValue(new Error("DB error"));

      const res = await request(app)
        .delete("/api/user/avatar")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(500);
    });

    it("delegates the stored avatarUrl to image-store for deletion", async () => {
      // The route forwards the user's own stored avatarUrl to image-store; the
      // path.basename traversal-stripping now lives in deleteImage and is
      // covered by server/lib/__tests__/image-store.test.ts.
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ avatarUrl: "/api/avatars/../../etc/passwd" }),
      );
      const updated = createMockUser({ avatarUrl: null });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);
      mockDeleteImage.mockClear();

      const res = await request(app)
        .delete("/api/user/avatar")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(200);
      expect(mockDeleteImage).toHaveBeenCalledWith(
        "/api/avatars/../../etc/passwd",
        "avatar",
      );
    });
  });

  describe("POST /api/user/avatar (PNG and WebP)", () => {
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    const webpBuffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);

    it("uploads a valid PNG avatar", async () => {
      vi.mocked(detectImageMimeType).mockReturnValue("image/png");
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);
      const updated = createMockUser({
        avatarUrl: "/api/avatars/mock-key-1234567890.png",
      });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);

      const res = await request(app)
        .post("/api/user/avatar")
        .set("Authorization", "Bearer mock-token")
        .attach("avatar", pngBuffer, {
          filename: "photo.png",
          contentType: "image/png",
        });

      expect(res.status).toBe(200);
      expect(res.body.avatarUrl).toMatch(/^\/api\/avatars\/mock-key-\d+\.png$/);
    });

    it("uploads a valid WebP avatar", async () => {
      vi.mocked(detectImageMimeType).mockReturnValue("image/webp");
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);
      const updated = createMockUser({
        avatarUrl: "/api/avatars/mock-key-1234567890.webp",
      });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);

      const res = await request(app)
        .post("/api/user/avatar")
        .set("Authorization", "Bearer mock-token")
        .attach("avatar", webpBuffer, {
          filename: "photo.webp",
          contentType: "image/webp",
        });

      expect(res.status).toBe(200);
      expect(res.body.avatarUrl).toMatch(
        /^\/api\/avatars\/mock-key-\d+\.webp$/,
      );
    });

    it("deletes old avatar file when uploading new one", async () => {
      vi.mocked(detectImageMimeType).mockReturnValue("image/jpeg");
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ avatarUrl: "/api/avatars/1-old.jpg" }),
      );
      const updated = createMockUser({
        avatarUrl: "/api/avatars/1-new.jpg",
      });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);
      mockDeleteImage.mockClear();

      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const res = await request(app)
        .post("/api/user/avatar")
        .set("Authorization", "Bearer mock-token")
        .attach("avatar", jpegBuffer, {
          filename: "photo.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(200);
      // Old avatar should have been deleted via image-store after the update.
      expect(mockDeleteImage).toHaveBeenCalledWith(
        "/api/avatars/1-old.jpg",
        "avatar",
      );
      // Cleanup must run AFTER the DB pointer is updated, so a delete failure
      // can never strand the user with a missing avatar still referenced.
      expect(mockDeleteImage.mock.invocationCallOrder[0]).toBeGreaterThan(
        vi.mocked(storage.updateUser).mock.invocationCallOrder[0],
      );
    });

    it("forwards a non-local old avatarUrl to image-store (no-op there)", async () => {
      // The route always delegates the old avatarUrl to deleteImage; image-store
      // no-ops on unrecognized/external URLs (covered by image-store.test.ts).
      vi.mocked(detectImageMimeType).mockReturnValue("image/jpeg");
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ avatarUrl: "https://external.com/avatar.jpg" }),
      );
      const updated = createMockUser({
        avatarUrl: "/api/avatars/1-new.jpg",
      });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);
      mockDeleteImage.mockClear();

      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
      const res = await request(app)
        .post("/api/user/avatar")
        .set("Authorization", "Bearer mock-token")
        .attach("avatar", jpegBuffer, {
          filename: "photo.jpg",
          contentType: "image/jpeg",
        });

      expect(res.status).toBe(200);
      expect(mockDeleteImage).toHaveBeenCalledWith(
        "https://external.com/avatar.jpg",
        "avatar",
      );
    });
  });

  describe("POST /api/user/avatar (multer filter)", () => {
    it("rejects files with disallowed MIME types at multer level", async () => {
      const textBuffer = Buffer.from("not an image");
      const res = await request(app)
        .post("/api/user/avatar")
        .set("Authorization", "Bearer mock-token")
        .attach("avatar", textBuffer, {
          filename: "file.txt",
          contentType: "text/plain",
        });

      // multer fileFilter calls cb(new Error(...)), which Express's default
      // error handler surfaces as a 500 response
      expect(res.status).toBe(500);
    });
  });

  describe("DELETE /api/user/avatar (edge cases)", () => {
    it("handles null avatarUrl gracefully", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({ avatarUrl: null }),
      );
      const updated = createMockUser({ avatarUrl: null });
      vi.mocked(storage.updateUser).mockResolvedValue(updated);
      mockDeleteImage.mockClear();

      const res = await request(app)
        .delete("/api/user/avatar")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // deleteImage receives null and no-ops (no file is touched).
      expect(mockDeleteImage).toHaveBeenCalledWith(null, "avatar");
    });
  });
});

describe("_helpers utility functions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
  });

  describe("parsePositiveIntParam", () => {
    it("parses a valid positive integer string", () => {
      expect(parsePositiveIntParam("42")).toBe(42);
    });

    it("returns null for zero", () => {
      expect(parsePositiveIntParam("0")).toBeNull();
    });

    it("returns null for negative numbers", () => {
      expect(parsePositiveIntParam("-5")).toBeNull();
    });

    it("returns null for non-numeric strings", () => {
      expect(parsePositiveIntParam("abc")).toBeNull();
    });

    it("handles string array by using first element", () => {
      expect(parsePositiveIntParam(["10", "20"])).toBe(10);
    });

    it("returns null for empty array", () => {
      expect(parsePositiveIntParam([])).toBeNull();
    });
  });

  describe("parseQueryInt", () => {
    it("parses a valid integer string", () => {
      expect(parseQueryInt("10", { default: 5 })).toBe(10);
    });

    it("returns default for non-string values", () => {
      expect(parseQueryInt(undefined, { default: 5 })).toBe(5);
      expect(parseQueryInt(null, { default: 5 })).toBe(5);
      expect(parseQueryInt(123, { default: 5 })).toBe(5);
    });

    it("returns default for NaN strings", () => {
      expect(parseQueryInt("abc", { default: 5 })).toBe(5);
    });

    it("clamps to min value", () => {
      expect(parseQueryInt("1", { default: 5, min: 3 })).toBe(3);
    });

    it("clamps to max value", () => {
      expect(parseQueryInt("100", { default: 5, max: 50 })).toBe(50);
    });

    it("applies both min and max", () => {
      expect(parseQueryInt("1", { default: 5, min: 3, max: 50 })).toBe(3);
      expect(parseQueryInt("100", { default: 5, min: 3, max: 50 })).toBe(50);
      expect(parseQueryInt("25", { default: 5, min: 3, max: 50 })).toBe(25);
    });

    it("parses '0' as a valid integer", () => {
      expect(parseQueryInt("0", { default: 5 })).toBe(0);
    });
  });

  describe("parseQueryDate", () => {
    it("parses a valid date string", () => {
      const result = parseQueryDate("2024-01-15");
      expect(result).toBeInstanceOf(Date);
      expect(result!.getFullYear()).toBe(2024);
    });

    it("returns undefined for non-string values", () => {
      expect(parseQueryDate(undefined)).toBeUndefined();
      expect(parseQueryDate(null)).toBeUndefined();
      expect(parseQueryDate(123)).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(parseQueryDate("")).toBeUndefined();
    });

    it("returns undefined for invalid date strings", () => {
      expect(parseQueryDate("not-a-date")).toBeUndefined();
    });
  });

  describe("parseQueryString", () => {
    it("returns the string value for valid strings", () => {
      expect(parseQueryString("hello")).toBe("hello");
    });

    it("returns undefined for non-string values", () => {
      expect(parseQueryString(undefined)).toBeUndefined();
      expect(parseQueryString(null)).toBeUndefined();
      expect(parseQueryString(123)).toBeUndefined();
    });

    it("returns undefined for empty strings", () => {
      expect(parseQueryString("")).toBeUndefined();
    });
  });

  describe("parseStringParam", () => {
    it("returns the string value directly", () => {
      expect(parseStringParam("hello")).toBe("hello");
    });

    it("returns first element for string arrays", () => {
      expect(parseStringParam(["first", "second"])).toBe("first");
    });

    it("returns undefined when value is undefined", () => {
      expect(parseStringParam(undefined)).toBeUndefined();
    });
  });

  describe("ipKeyGenerator", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("prefers the X-Real-IP header on Railway (edge proxy overwrites it)", () => {
      vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
      const req = mockExpressReq({
        headers: { "x-real-ip": "203.0.113.7" },
        ip: "192.168.1.1",
        socket: { remoteAddress: "10.0.0.1" } as express.Request["socket"],
      });
      expect(ipKeyGenerator(req)).toBe("203.0.113.7");
    });

    it("normalizes an IPv6 X-Real-IP to its /56 bucket on Railway", () => {
      vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
      const reqFor = (realIp: string) =>
        mockExpressReq({
          headers: { "x-real-ip": realIp },
          ip: "",
          socket: { remoteAddress: "" } as express.Request["socket"],
        });
      expect(ipKeyGenerator(reqFor("2001:db8:abcd:1200::1"))).toBe(
        ipKeyGenerator(reqFor("2001:db8:abcd:12ff::9")),
      );
    });

    it("ignores X-Real-IP off Railway (client-suppliable there)", () => {
      const req = mockExpressReq({
        headers: { "x-real-ip": "203.0.113.7" },
        ip: "192.168.1.1",
        socket: { remoteAddress: "10.0.0.1" } as express.Request["socket"],
      });
      expect(ipKeyGenerator(req)).toBe("192.168.1.1");
    });

    it("ignores a non-string X-Real-IP header value on Railway", () => {
      vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
      const req = mockExpressReq({
        headers: { "x-real-ip": ["203.0.113.7", "203.0.113.8"] },
        ip: "192.168.1.1",
        socket: { remoteAddress: "10.0.0.1" } as express.Request["socket"],
      });
      expect(ipKeyGenerator(req)).toBe("192.168.1.1");
    });

    it("returns req.ip when available", () => {
      const req = mockExpressReq({
        headers: {},
        ip: "192.168.1.1",
        socket: { remoteAddress: "10.0.0.1" } as express.Request["socket"],
      });
      expect(ipKeyGenerator(req)).toBe("192.168.1.1");
    });

    it("falls back to socket.remoteAddress when ip is missing", () => {
      const req = mockExpressReq({
        headers: {},
        ip: "",
        socket: { remoteAddress: "10.0.0.1" } as express.Request["socket"],
      });
      expect(ipKeyGenerator(req)).toBe("10.0.0.1");
    });

    it("returns 'unknown' when both ip and remoteAddress are missing", () => {
      const req = mockExpressReq({
        headers: {},
        ip: "",
        socket: { remoteAddress: "" } as express.Request["socket"],
      });
      expect(ipKeyGenerator(req)).toBe("unknown");
    });

    it("buckets IPv6 addresses in the same /56 to one rate-limit key", () => {
      const reqFor = (ip: string) =>
        mockExpressReq({
          headers: {},
          ip,
          socket: { remoteAddress: "" } as express.Request["socket"],
        });
      const sameSubnetA = ipKeyGenerator(reqFor("2001:db8:abcd:1200::1"));
      const sameSubnetB = ipKeyGenerator(reqFor("2001:db8:abcd:12ff::9"));
      const otherSubnet = ipKeyGenerator(reqFor("2001:db8:abcd:1300::1"));
      expect(sameSubnetA).toBe(sameSubnetB);
      expect(sameSubnetA).not.toBe(otherSubnet);
    });

    it("passes IPv4 addresses through unchanged", () => {
      const req = mockExpressReq({
        headers: {},
        ip: "198.51.100.23",
        socket: { remoteAddress: "" } as express.Request["socket"],
      });
      expect(ipKeyGenerator(req)).toBe("198.51.100.23");
    });
  });

  describe("formatZodError", () => {
    it("formats errors with paths", () => {
      const error = new ZodError([
        {
          path: ["username"],
          message: "Required",
          code: "invalid_type",
          expected: "string",
          received: "undefined",
        },
      ]);
      expect(formatZodError(error)).toBe("username: Required");
    });

    it("formats errors without paths", () => {
      const error = new ZodError([
        { path: [], message: "Invalid input", code: "custom" },
      ]);
      expect(formatZodError(error)).toBe("Invalid input");
    });

    it("joins multiple errors with semicolons", () => {
      const error = new ZodError([
        {
          path: ["username"],
          message: "Required",
          code: "invalid_type",
          expected: "string",
          received: "undefined",
        },
        {
          path: ["password"],
          message: "Too short",
          code: "too_small",
          minimum: 8,
          inclusive: true,
          type: "string",
        },
      ]);
      expect(formatZodError(error)).toBe(
        "username: Required; password: Too short",
      );
    });
  });

  describe("getPremiumFeatures", () => {
    it("returns free tier features when no subscription", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(undefined);
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
      const req = mockExpressReq({ userId: "1" });
      const features = await getPremiumFeatures(req);
      expect(features.maxDailyScans).toBe(3);
      expect(features.recipeGeneration).toBe(false);
    });

    it("returns premium features for premium tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
      const req = mockExpressReq({ userId: "1" });
      const features = await getPremiumFeatures(req);
      expect(features.maxDailyScans).toBe(999999);
      expect(features.recipeGeneration).toBe(true);
    });

    it("falls back to free for invalid tier", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "invalid_tier" as "free",
        expiresAt: null,
      });
      const req = mockExpressReq({ userId: "1" });
      const features = await getPremiumFeatures(req);
      expect(features.maxDailyScans).toBe(3);
    });
  });

  describe("checkPremiumFeature", () => {
    it("returns features when user has the premium feature", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue({
        tier: "premium",
        expiresAt: null,
      });
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("premium");
      const req = mockExpressReq({ userId: "1" });
      const res = mockExpressRes();
      const features = await checkPremiumFeature(
        req,
        res,
        "recipeGeneration",
        "Recipe generation",
      );
      expect(features).not.toBeNull();
      expect(features!.recipeGeneration).toBe(true);
    });

    it("sends 403 and returns null when user lacks the feature", async () => {
      vi.mocked(storage.getSubscriptionStatus).mockResolvedValue(undefined);
      vi.mocked(storage.getEffectiveTierForUser).mockResolvedValue("free");
      const req = mockExpressReq({ userId: "1" });
      const res = mockExpressRes();
      const features = await checkPremiumFeature(
        req,
        res,
        "recipeGeneration",
        "Recipe generation",
      );
      expect(features).toBeNull();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining("premium subscription"),
        }),
      );
    });
  });
});
