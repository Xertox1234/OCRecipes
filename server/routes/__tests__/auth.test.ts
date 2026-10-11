import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { hashPassword } from "../../lib/password-hash";

import { storage, ReservedUsernameError } from "../../storage";
import { detectImageMimeType } from "../../lib/image-mime";
import { register } from "../auth";
import { ZodError } from "zod";
import { ipKeyGenerator } from "../_rate-limiters";
import {
  parsePositiveIntParam,
  parseQueryInt,
  parseQueryString,
  parseStringParam,
  formatZodError,
  getPremiumFeatures,
  checkPremiumFeature,
} from "../_helpers";
import { createMockUser } from "../../__tests__/factories";
import { emailVerificationEnabled } from "../../lib/email-config";
import {
  sendVerificationEmail,
  sendSignupAttemptNotice,
} from "../../services/email";
import { signVerificationToken } from "../../lib/verification-token";
import { isBreached } from "../../lib/pwned-password";
import {
  mockExpressReq,
  mockExpressRes,
} from "../../__tests__/utils/express-mocks";

// Mock storage before importing routes.
// `ReservedUsernameError` MUST be in this factory. Two DISTINCT things break
// without it, and only the first is about production behaviour:
//   1. auth.ts does `err instanceof ReservedUsernameError` in the register
//      catch block. An undefined right-hand side makes `instanceof` THROW, so
//      EVERY error reaching that catch — including the unique-violation races
//      below, which have nothing to do with reserved names — becomes a 500.
//      Observed: dropping it turned two pre-existing 409 tests into 500s.
//   2. Separately, the defence-in-depth test below constructs
//      `new ReservedUsernameError(...)`, which would fail at construction.
// Same shape as batch-scan.test.ts's BatchStorageErrorMock.
vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {
    constructor(public readonly username: string) {
      super(`Username "${username}" is reserved and cannot be registered`);
      this.name = "ReservedUsernameError";
    }
  },
  // Test double for the real normalizer in server/storage/users.ts. The REAL
  // function's trim/lowercase/whole-string semantics are pinned directly in
  // server/storage/__tests__/users.test.ts ("isReservedUsername (the real
  // exported normalizer)"); this stand-in only needs to be faithful enough to
  // drive the route's branch.
  isReservedUsername: (username: string) =>
    username.trim().toLowerCase() === "demo",
  storage: {
    getUserByUsername: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByUsernameForAuth: vi.fn(),
    getUserByEmailForAuth: vi.fn(),
    getUserForAuth: vi.fn(),
    createUser: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    updateUserEmail: vi.fn(),
    stagePendingEmail: vi.fn(),
    incrementTokenVersion: vi.fn(),
    upgradePasswordHash: vi.fn().mockResolvedValue(true),
    getSubscriptionStatus: vi.fn(),
    getEffectiveTierForUser: vi.fn(),
    deleteUser: vi.fn(),
    collectUserImageUrls: vi.fn().mockResolvedValue([]),
    takeAppleTokensOnTicketsTargeting: vi.fn().mockResolvedValue([]),
    filterUnreferencedImageUrls: vi.fn().mockResolvedValue([]),
    applyEmailVerification: vi.fn(),
    getSignInMethods: vi.fn(),
    findIdentity: vi.fn(),
    listIdentities: vi.fn().mockResolvedValue([]),
    consumeNonce: vi.fn(),
    isTrustedDevice: vi.fn(),
    createMfaChallenge: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

// Never call api.pwnedpasswords.com from a test.
vi.mock("../../lib/pwned-password", () => ({
  isBreached: vi.fn().mockResolvedValue(false),
}));

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

// The password-proof gate runs for real; only the code check is stubbed.
const { mockVerifySecondFactor } = vi.hoisted(() => ({
  mockVerifySecondFactor: vi.fn(),
}));
vi.mock("../../lib/mfa/verify-second-factor", () => ({
  verifySecondFactor: mockVerifySecondFactor,
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

// Sign-up needs 15+ characters (spec §2); no composition rule.
const GOOD_PASSWORD = "a-long-test-passphrase";

// pv2 fixtures for sign-ins that are NOT about rehashing: a legacy hash on a
// successful sign-in starts a background rehash (spec §3), which would run
// into the next test. Computed once — each is a cost-12 bcrypt.
let pv2Password123: string;
let pv2Correct: string;
beforeAll(async () => {
  [pv2Password123, pv2Correct] = await Promise.all([
    hashPassword("password123"),
    hashPassword("correctpassword"),
  ]);
});

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
    describe("password policy (spec §2, P2)", () => {
      const send = (password: string) =>
        request(app).post("/api/auth/register").send({
          username: "policyuser",
          password,
          email: "policy@example.com",
          ageConfirmed: true,
        });

      beforeEach(() => {
        vi.mocked(storage.getUserByUsername).mockReset();
        vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
        vi.mocked(storage.createUser).mockReset();
        vi.mocked(storage.createUser).mockResolvedValue(mockUser);
        vi.mocked(storage.getUserByEmail).mockClear();
        vi.mocked(isBreached).mockReset();
        vi.mocked(isBreached).mockResolvedValue(false);
      });

      it("14 characters → 400 PASSWORD_TOO_SHORT, no account", async () => {
        const res = await send("a".repeat(14));
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("PASSWORD_TOO_SHORT");
        expect(res.body.error).toBe("Use at least 15 characters.");
        expect(storage.createUser).not.toHaveBeenCalled();
      });

      it("15 letters, no digit → account created (no composition rule)", async () => {
        const res = await send("abcdefghijklmno");
        expect(res.status).toBe(201);
        expect(storage.createUser).toHaveBeenCalledTimes(1);
      });

      it("a breached password → 400 PASSWORD_BREACHED, before any account lookup", async () => {
        vi.mocked(isBreached).mockResolvedValue(true);
        const res = await send(GOOD_PASSWORD);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe("PASSWORD_BREACHED");
        expect(storage.getUserByUsername).not.toHaveBeenCalled();
        expect(storage.getUserByEmail).not.toHaveBeenCalled();
        expect(storage.createUser).not.toHaveBeenCalled();
      });

      it("breach check unavailable → account created (fail open)", async () => {
        vi.mocked(isBreached).mockResolvedValue("unavailable");
        const res = await send(GOOD_PASSWORD);
        expect(res.status).toBe(201);
        expect(storage.createUser).toHaveBeenCalledTimes(1);
      });

      it("stores a pv2 hash", async () => {
        await send(GOOD_PASSWORD);
        expect(vi.mocked(storage.createUser).mock.calls[0][0].password).toMatch(
          /^pv2\$/,
        );
      });
    });

    it("creates a new user and returns token", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.createUser).mockResolvedValue(mockUser);

      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: GOOD_PASSWORD,
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
        password: GOOD_PASSWORD,
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
        password: GOOD_PASSWORD,
        email: "raceuser@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Username already exists");
    });

    it("returns 409 for a reserved username, before any email lookup", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);

      const res = await request(app).post("/api/auth/register").send({
        username: "demo",
        password: GOOD_PASSWORD,
        email: "demo-registrant@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe(
        "That username is reserved. Please choose another.",
      );
      // Rejected BEFORE the email-existence branch — that ordering is the
      // anti-enumeration property pinned by the differential test below.
      expect(storage.getUserByEmail).not.toHaveBeenCalled();
      expect(storage.createUser).not.toHaveBeenCalled();
    });

    it("still maps a ReservedUsernameError from createUser to 409, not 500 (defense in depth)", async () => {
      // The route check above should make this unreachable in practice, but
      // createUser keeps its own throw for non-route callers, so the catch arm
      // must stay correct. This also guards the mock factory: drop
      // ReservedUsernameError from it and `instanceof` throws, turning this —
      // and the unique-violation races above — into 500s.
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
      vi.mocked(storage.createUser).mockRejectedValue(
        new ReservedUsernameError("demo"),
      );

      const res = await request(app).post("/api/auth/register").send({
        username: "not_reserved_here",
        password: GOOD_PASSWORD,
        email: "dind@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe(
        "That username is reserved. Please choose another.",
      );
    });

    it("does NOT leak email existence via a reserved username (anti-enumeration)", async () => {
      // REGRESSION PIN (review, 2026-08-17). When the reserved-name 409 lived
      // only in createUser's catch — i.e. AFTER the neutral email branch —
      // holding a reserved username fixed and varying ONLY the email produced
      // two different responses, making register a single-request
      // email-existence oracle: taken -> neutral 200, free -> 409.
      // `DEMO` is the payload on purpose: there is no lower(username) index,
      // so it MISSES the uniqueness pre-check in every environment and still
      // reaches the reserved check.
      vi.mocked(emailVerificationEnabled).mockReturnValue(true);
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);

      const send = (email: string) =>
        request(app).post("/api/auth/register").send({
          username: "DEMO",
          password: GOOD_PASSWORD,
          email,
          ageConfirmed: true,
        });

      vi.mocked(storage.getUserByEmail).mockResolvedValue(
        createMockUser({ id: "existing-id", emailVerified: true }),
      );
      const taken = await send("taken@example.com");

      vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
      const free = await send("free@example.com");

      expect(taken.status).toBe(free.status);
      expect(taken.body).toEqual(free.body);

      // NEGATIVE CONTROL: the same two requests with a NON-reserved username
      // must ALSO be indistinguishable. Without this, the assertion above
      // would still pass if the endpoint had simply become uniformly broken.
      vi.mocked(storage.createUser).mockResolvedValue(
        createMockUser({ id: "new-id", username: "unreserved_xyz" }),
      );
      const ctlSend = (email: string) =>
        request(app).post("/api/auth/register").send({
          username: "unreserved_xyz",
          password: GOOD_PASSWORD,
          email,
          ageConfirmed: true,
        });
      vi.mocked(storage.getUserByEmail).mockResolvedValue(
        createMockUser({ id: "existing-id", emailVerified: true }),
      );
      const ctlTaken = await ctlSend("taken2@example.com");
      vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
      const ctlFree = await ctlSend("free2@example.com");

      expect(ctlTaken.status).toBe(ctlFree.status);
      expect(ctlTaken.body).toEqual(ctlFree.body);
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
        password: GOOD_PASSWORD,
        email: "race@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Email already registered");
    });

    it("returns 400 for short username", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "ab",
        password: GOOD_PASSWORD,
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
        password: GOOD_PASSWORD,
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
        password: GOOD_PASSWORD,
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("ageConfirmed");
    });

    it("returns 400 when ageConfirmed is false (COPPA age gate)", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: GOOD_PASSWORD,
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
        password: GOOD_PASSWORD,
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
        password: GOOD_PASSWORD,
        email: "newuser@example.com",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("ageConfirmed");
    });

    it("returns 400 for an invalid email", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: GOOD_PASSWORD,
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
        password: GOOD_PASSWORD,
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
        password: GOOD_PASSWORD,
        email: "newuser@example.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(201);
      expect(res.body.user).toMatchObject({
        email: "testuser@example.com",
        emailVerified: false,
      });
    });

    it("new email → neutral check-inbox, no token, verification email sent", async () => {
      vi.mocked(emailVerificationEnabled).mockReturnValue(true);
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
      vi.mocked(storage.createUser).mockResolvedValue(
        createMockUser({ id: "new1", email: "new@x.com" }),
      );

      const res = await request(app).post("/api/auth/register").send({
        username: "newbie",
        password: GOOD_PASSWORD,
        email: "new@x.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBeUndefined();
      expect(res.body.status).toBe("verification_pending");
      expect(sendVerificationEmail).toHaveBeenCalled();
    });

    it("existing UNVERIFIED email → identical neutral 200, resend (not notice), no createUser", async () => {
      vi.mocked(emailVerificationEnabled).mockReturnValue(true);
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.getUserByEmail).mockResolvedValue(
        createMockUser({ id: "old1", emailVerified: false }),
      );

      const res = await request(app).post("/api/auth/register").send({
        username: "other",
        password: GOOD_PASSWORD,
        email: "dup@x.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("verification_pending");
      expect(storage.createUser).not.toHaveBeenCalled();
      expect(sendVerificationEmail).toHaveBeenCalled();
      expect(sendSignupAttemptNotice).not.toHaveBeenCalled();
    });

    it("ON existing-email path runs bcrypt too (constant-time anti-enumeration)", async () => {
      // Deterministic proxy for the timing defense: the existing-email branch
      // must pay the same bcrypt cost as the new-account branch, else response
      // latency leaks that the email already exists. A future "optimization"
      // that skips the hash on this branch reintroduces the oracle and fails here.
      vi.mocked(emailVerificationEnabled).mockReturnValue(true);
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.getUserByEmail).mockResolvedValue(
        createMockUser({ id: "old3", emailVerified: false }),
      );
      const hashSpy = vi.spyOn(bcrypt, "hash");

      const res = await request(app).post("/api/auth/register").send({
        username: "timing",
        password: GOOD_PASSWORD,
        email: "dup3@x.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(200);
      expect(storage.createUser).not.toHaveBeenCalled();
      expect(hashSpy).toHaveBeenCalled();
      hashSpy.mockRestore();
    });

    it("existing VERIFIED email → identical neutral 200, owner notice, no createUser", async () => {
      vi.mocked(emailVerificationEnabled).mockReturnValue(true);
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.getUserByEmail).mockResolvedValue(
        createMockUser({ id: "old2", emailVerified: true, username: "owner2" }),
      );

      const res = await request(app).post("/api/auth/register").send({
        username: "other2",
        password: GOOD_PASSWORD,
        email: "taken@x.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("verification_pending");
      expect(storage.createUser).not.toHaveBeenCalled();
      expect(sendSignupAttemptNotice).toHaveBeenCalledWith(
        "taken@x.com",
        "owner2",
      );
      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    it("username taken → 409 (checked before email) even when verification ON", async () => {
      vi.mocked(emailVerificationEnabled).mockReturnValue(true);
      vi.mocked(storage.getUserByUsername).mockResolvedValue(
        createMockUser({ id: "u" }),
      );

      const res = await request(app).post("/api/auth/register").send({
        username: "taken",
        password: GOOD_PASSWORD,
        email: "x@x.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(409);
    });

    it("verification OFF → old behavior: auto-login with token", async () => {
      vi.mocked(emailVerificationEnabled).mockReturnValue(false);
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
      vi.mocked(storage.createUser).mockResolvedValue(
        createMockUser({ id: "n2" }),
      );

      const res = await request(app).post("/api/auth/register").send({
        username: "newb2",
        password: GOOD_PASSWORD,
        email: "n2@x.com",
        ageConfirmed: true,
      });

      expect(res.status).toBe(201);
      expect(res.body.token).toBeTruthy();
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns user and token on valid credentials", async () => {
      const userWithHash = createMockUser({ password: pv2Password123 });

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

    describe("legacy hash upgrade (spec §3)", () => {
      beforeEach(() => {
        vi.mocked(storage.upgradePasswordHash).mockClear();
      });

      it("a correct sign-in on a legacy hash rehashes to pv2, compare-and-swap on the checked hash", async () => {
        const legacy = await bcrypt.hash("password123", 4);
        vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
          createMockUser({ id: "u-legacy", password: legacy }),
        );
        const res = await request(app)
          .post("/api/auth/login")
          .send({ username: "testuser", password: "password123" });
        expect(res.status).toBe(200);
        await vi.waitFor(
          () =>
            expect(storage.upgradePasswordHash).toHaveBeenCalledWith(
              "u-legacy",
              legacy,
              expect.stringMatching(/^pv2\$/),
            ),
          { timeout: 3000 },
        );
      });

      it("a pv2 hash is never rehashed", async () => {
        vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
          createMockUser({ password: pv2Password123 }),
        );
        const res = await request(app)
          .post("/api/auth/login")
          .send({ username: "testuser", password: "password123" });
        expect(res.status).toBe(200);
        // Longer than a cost-12 rehash takes to reach storage (the positive
        // case above lands well inside it), so a regression would show here.
        await new Promise((r) => setTimeout(r, 1000));
        expect(storage.upgradePasswordHash).not.toHaveBeenCalled();
      });

      it("an input over 72 bytes on a legacy hash is not rehashed (only 72 bytes were proven)", async () => {
        const typed = "a".repeat(80);
        const legacy = await bcrypt.hash(typed, 4);
        vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
          createMockUser({ password: legacy }),
        );
        const res = await request(app)
          .post("/api/auth/login")
          .send({ username: "testuser", password: typed });
        expect(res.status).toBe(200);
        // Longer than a cost-12 rehash takes to reach storage (the positive
        // case above lands well inside it), so a regression would show here.
        await new Promise((r) => setTimeout(r, 1000));
        expect(storage.upgradePasswordHash).not.toHaveBeenCalled();
      });
    });

    it("returns 400 for missing credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({});

      expect(res.status).toBe(400);
    });

    it("blocks login with 403 EMAIL_NOT_VERIFIED when unverified + verification ON", async () => {
      vi.mocked(emailVerificationEnabled).mockReturnValue(true);
      vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
        createMockUser({ emailVerified: false, password: pv2Password123 }),
      );

      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "testuser", password: "password123" });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
      expect(res.body.token).toBeUndefined();
    });

    it("allows unverified login when verification OFF (fail-open)", async () => {
      vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
        createMockUser({ emailVerified: false, password: pv2Password123 }),
      );

      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "testuser", password: "password123" });

      expect(res.status).toBe(200);
      expect(res.body.token).toBe("mock-jwt-token");
    });

    it("signs in by email (any case), looking up the lowercased email only", async () => {
      vi.mocked(storage.getUserByEmailForAuth).mockReset();
      vi.mocked(storage.getUserByUsernameForAuth).mockReset();
      vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(
        createMockUser({ password: pv2Password123 }),
      );
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "  Test@Example.COM ", password: "password123" });
      expect(res.status).toBe(200);
      expect(storage.getUserByEmailForAuth).toHaveBeenCalledWith(
        "test@example.com",
      );
      expect(storage.getUserByUsernameForAuth).not.toHaveBeenCalled();
    });

    it("a plain username never reaches the email lookup (and is not lowercased)", async () => {
      vi.mocked(storage.getUserByEmailForAuth).mockReset();
      vi.mocked(storage.getUserByUsernameForAuth).mockReset();
      vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(undefined);
      await request(app)
        .post("/api/auth/login")
        .send({ username: "MixedCase", password: "x" });
      expect(storage.getUserByUsernameForAuth).toHaveBeenCalledWith(
        "MixedCase",
      );
      expect(storage.getUserByEmailForAuth).not.toHaveBeenCalled();
    });

    it("missing user still pays a bcrypt compare (timing parity)", async () => {
      vi.mocked(storage.getUserByEmailForAuth).mockReset();
      vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(undefined);
      const spy = vi.spyOn(bcrypt, "compare");
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "ghost@example.com", password: "whatever1" });
      expect(res.status).toBe(401);
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });
  });

  describe("POST /api/auth/verify-email", () => {
    it("verifies a valid token, flips emailVerified, issues NO token", async () => {
      vi.mocked(storage.applyEmailVerification).mockResolvedValue(
        createMockUser({ emailVerified: true }),
      );
      const token = signVerificationToken("u1", "a@b.com");

      const res = await request(app)
        .post("/api/auth/verify-email")
        .send({ token });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("verified");
      // Verifying proves email ownership, NOT password possession — no access
      // token is minted here (issuing one would be an auth bypass).
      expect(res.body.token).toBeUndefined();
      expect(storage.applyEmailVerification).toHaveBeenCalledWith(
        "u1",
        "a@b.com",
      );
    });

    it("rejects a garbage token with 400", async () => {
      const res = await request(app)
        .post("/api/auth/verify-email")
        .send({ token: "not-a-jwt" });

      expect(res.status).toBe(400);
    });

    it("returns a clean 400 (not a 500) when committing a staged change collides at the unique index", async () => {
      // Rare race: the staged address was registered by someone else between
      // staging and this click, so the commit-swap raises a 23505.
      // applyVerificationToken catches it and treats it as a plain failed
      // verify, so the user gets the neutral 400 — never a 500.
      vi.mocked(storage.applyEmailVerification).mockRejectedValue({
        code: "23505",
      });
      const token = signVerificationToken("u1", "taken@example.com");

      const res = await request(app)
        .post("/api/auth/verify-email")
        .send({ token });

      expect(res.status).toBe(400);
    });
  });

  describe("GET /verify-email (browser landing)", () => {
    it("verifies a valid token and renders an HTML success page", async () => {
      vi.mocked(storage.applyEmailVerification).mockResolvedValue(
        createMockUser({ emailVerified: true }),
      );
      const token = signVerificationToken("u1", "a@b.com");

      const res = await request(app).get("/verify-email").query({ token });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toMatch(/verified/i);
      expect(storage.applyEmailVerification).toHaveBeenCalledWith(
        "u1",
        "a@b.com",
      );
    });

    it("renders a 400 HTML page for a garbage token without touching storage", async () => {
      const res = await request(app)
        .get("/verify-email")
        .query({ token: "not-a-jwt" });

      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toMatch(/expired|invalid/i);
      expect(storage.applyEmailVerification).not.toHaveBeenCalled();
    });

    it("renders a 400 HTML page when the token query param is missing", async () => {
      const res = await request(app).get("/verify-email");

      expect(res.status).toBe(400);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.text).toMatch(/expired|invalid/i);
      expect(storage.applyEmailVerification).not.toHaveBeenCalled();
    });

    it("renders a 500 HTML page if verification throws unexpectedly", async () => {
      vi.mocked(storage.applyEmailVerification).mockRejectedValue(
        new Error("db down"),
      );
      const token = signVerificationToken("u1", "a@b.com");

      const res = await request(app).get("/verify-email").query({ token });

      expect(res.status).toBe(500);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
    });
  });

  describe("POST /api/auth/resend-verification", () => {
    it("always neutral 200; sends only when account exists + unverified", async () => {
      vi.mocked(storage.getUserByEmail).mockResolvedValue(
        createMockUser({ id: "u9", emailVerified: false }),
      );

      const res = await request(app)
        .post("/api/auth/resend-verification")
        .send({ email: "u9@x.com" });

      expect(res.status).toBe(200);
      expect(sendVerificationEmail).toHaveBeenCalled();
    });

    it("neutral 200 even when the email has no account (no oracle)", async () => {
      vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/auth/resend-verification")
        .send({ email: "ghost@x.com" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("verification_pending");
      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    it("neutral 200 when the account is already verified (no send)", async () => {
      vi.mocked(storage.getUserByEmail).mockResolvedValue(
        createMockUser({ id: "u10", emailVerified: true }),
      );

      const res = await request(app)
        .post("/api/auth/resend-verification")
        .send({ email: "done@x.com" });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("verification_pending");
      expect(sendVerificationEmail).not.toHaveBeenCalled();
    });
  });

  describe("POST /api/auth/change-email", () => {
    async function userWithPassword(overrides: Partial<typeof mockUser> = {}) {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 10);
      return createMockUser({
        password: hash,
        email: "current@example.com",
        ...overrides,
      });
    }

    describe("gate ON (verification enforced)", () => {
      beforeEach(() => {
        vi.mocked(emailVerificationEnabled).mockReturnValue(true);
      });

      it("stages the new email (does NOT mutate the current one), sends verification, neutral 200", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(
          await userWithPassword(),
        );
        vi.mocked(storage.stagePendingEmail).mockResolvedValue(
          createMockUser({
            email: "current@example.com",
            pendingEmail: "new@example.com",
          }),
        );
        // Target is unregistered → the verification link IS emailed to it.
        vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);

        const res = await request(app)
          .post("/api/auth/change-email")
          .set("Authorization", "Bearer mock-token")
          .send({ newEmail: "new@example.com", password: "correctpassword" });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("verification_pending");
        // Neutral path leaks no user object or token.
        expect(res.body.user).toBeUndefined();
        expect(res.body.token).toBeUndefined();
        // The new address is STAGED, not committed — the login-gating `email`
        // column is untouched. This is what closes the /me enumeration oracle
        // and the typo-lockout the immediate-mutation design had.
        expect(storage.stagePendingEmail).toHaveBeenCalledWith(
          "1",
          "new@example.com",
        );
        expect(storage.updateUserEmail).not.toHaveBeenCalled();
        // Verification link is sent to the NEW address with a token bound to it.
        expect(sendVerificationEmail).toHaveBeenCalledWith(
          "new@example.com",
          expect.any(String),
        );
      });

      it("rejects a wrong password with 401 and does NOT stage anything", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(
          await userWithPassword(),
        );

        const res = await request(app)
          .post("/api/auth/change-email")
          .set("Authorization", "Bearer mock-token")
          .send({ newEmail: "new@example.com", password: "wrongpassword" });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe("Invalid credentials");
        expect(storage.stagePendingEmail).not.toHaveBeenCalled();
        expect(sendVerificationEmail).not.toHaveBeenCalled();
      });

      it("a target held by another account: neutral 200, staged, but NO verification link is emailed to the third party", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(
          await userWithPassword(),
        );
        vi.mocked(storage.stagePendingEmail).mockResolvedValue(
          createMockUser({
            email: "current@example.com",
            pendingEmail: "taken@example.com",
          }),
        );
        // The address already belongs to another account. The response stays
        // neutral and the work is equalized (always stage + always look up), but
        // mirroring register, NO verification link is emailed to an address that
        // is not the caller's — a link there would reach a third party and the
        // commit-swap would 23505 anyway.
        vi.mocked(storage.getUserByEmail).mockResolvedValue(
          createMockUser({ id: "other", email: "taken@example.com" }),
        );

        const res = await request(app)
          .post("/api/auth/change-email")
          .set("Authorization", "Bearer mock-token")
          .send({ newEmail: "taken@example.com", password: "correctpassword" });

        // Caller sees the SAME neutral response as the free-target path — no
        // 409, no 500, no body difference. Nothing distinguishes taken from free.
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("verification_pending");
        expect(storage.stagePendingEmail).toHaveBeenCalledWith(
          "1",
          "taken@example.com",
        );
        // The one observable difference is recipient-side, not caller-side: the
        // already-registered third party is NOT emailed a verification link.
        expect(sendVerificationEmail).not.toHaveBeenCalled();
      });

      it("same-as-current email is a neutral no-op (never stages, never sends)", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(
          await userWithPassword(),
        );

        const res = await request(app)
          .post("/api/auth/change-email")
          .set("Authorization", "Bearer mock-token")
          // Case-insensitive match of the current address.
          .send({
            newEmail: "CURRENT@example.com",
            password: "correctpassword",
          });

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("verification_pending");
        expect(storage.stagePendingEmail).not.toHaveBeenCalled();
        expect(storage.updateUserEmail).not.toHaveBeenCalled();
        expect(sendVerificationEmail).not.toHaveBeenCalled();
      });

      it("returns 404 when the user vanishes between auth and staging (stagePendingEmail → undefined)", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(
          await userWithPassword(),
        );
        vi.mocked(storage.stagePendingEmail).mockResolvedValue(undefined);

        const res = await request(app)
          .post("/api/auth/change-email")
          .set("Authorization", "Bearer mock-token")
          .send({ newEmail: "new@example.com", password: "correctpassword" });

        expect(res.status).toBe(404);
        // A vanished user must NOT trigger a verification send.
        expect(sendVerificationEmail).not.toHaveBeenCalled();
      });
    });

    describe("gate OFF (fail-open, no verification)", () => {
      // emailVerificationEnabled defaults to false via the outer beforeEach.

      it("changes to a free email: returns the updated user, sends NO email", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(
          await userWithPassword(),
        );
        vi.mocked(storage.updateUserEmail).mockResolvedValue(
          createMockUser({ email: "new@example.com", emailVerified: false }),
        );

        const res = await request(app)
          .post("/api/auth/change-email")
          .set("Authorization", "Bearer mock-token")
          .send({ newEmail: "new@example.com", password: "correctpassword" });

        expect(res.status).toBe(200);
        expect(res.body.email).toBe("new@example.com");
        expect(storage.updateUserEmail).toHaveBeenCalledWith(
          "1",
          "new@example.com",
        );
        expect(sendVerificationEmail).not.toHaveBeenCalled();
      });

      it("a duplicate email returns an explicit 409 (fail-open, no anti-enum)", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(
          await userWithPassword(),
        );
        vi.mocked(storage.updateUserEmail).mockRejectedValue({
          code: "23505",
          constraint: "users_email_unique",
        });

        const res = await request(app)
          .post("/api/auth/change-email")
          .set("Authorization", "Bearer mock-token")
          .send({ newEmail: "taken@example.com", password: "correctpassword" });

        expect(res.status).toBe(409);
      });
    });

    it("returns 404 when the user no longer exists", async () => {
      vi.mocked(storage.getUserForAuth).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/auth/change-email")
        .set("Authorization", "Bearer mock-token")
        .send({ newEmail: "new@example.com", password: "correctpassword" });

      expect(res.status).toBe(404);
      expect(storage.updateUserEmail).not.toHaveBeenCalled();
    });

    it("returns 404 when the user vanishes between auth and update (updateUserEmail → undefined)", async () => {
      vi.mocked(storage.getUserForAuth).mockResolvedValue(
        await userWithPassword(),
      );
      vi.mocked(storage.updateUserEmail).mockResolvedValue(undefined);

      const res = await request(app)
        .post("/api/auth/change-email")
        .set("Authorization", "Bearer mock-token")
        .send({ newEmail: "new@example.com", password: "correctpassword" });

      expect(res.status).toBe(404);
    });

    it("returns 400 for an invalid email (before any storage access)", async () => {
      const res = await request(app)
        .post("/api/auth/change-email")
        .set("Authorization", "Bearer mock-token")
        .send({ newEmail: "not-an-email", password: "correctpassword" });

      expect(res.status).toBe(400);
      expect(storage.getUserForAuth).not.toHaveBeenCalled();
    });

    it("returns 400 when the password is missing", async () => {
      const res = await request(app)
        .post("/api/auth/change-email")
        .set("Authorization", "Bearer mock-token")
        .send({ newEmail: "new@example.com" });

      expect(res.status).toBe(400);
      expect(storage.getUserForAuth).not.toHaveBeenCalled();
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

    it("includes the account's sign-in methods", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(mockUser);
      const methods = {
        password: false,
        google: null,
        apple: { email: "x@privaterelay.appleid.com", isPrivateRelay: true },
      };
      vi.mocked(storage.getSignInMethods).mockResolvedValue(methods);

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(200);
      expect(res.body.signInMethods).toEqual(methods);
      expect(storage.getSignInMethods).toHaveBeenCalledWith("1");
    });

    it("returns 401 if user not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(undefined);

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(401);
    });

    it("never exposes pending_email and shows the UNCHANGED current email while a change is staged (no /me oracle)", async () => {
      // A staged change must reveal nothing about the target address: /me shows
      // the current email, never `pending_email`. pending_email lives in
      // safeUserColumns now (getTableColumns minus password), so the ONLY thing
      // keeping it out of the response is serializeUser's whitelist — pin it.
      vi.mocked(storage.getUser).mockResolvedValue(
        createMockUser({
          email: "current@example.com",
          pendingEmail: "secret-target@example.com",
        }),
      );

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(200);
      expect(res.body.email).toBe("current@example.com");
      expect(res.body).not.toHaveProperty("pendingEmail");
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

    it("removes the account's cookbook covers and recipe images that nothing else references", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 10);
      vi.mocked(storage.getUserForAuth).mockResolvedValue(
        createMockUser({ password: hash }),
      );
      vi.mocked(storage.deleteUser).mockResolvedValue(true);
      const cover = {
        url: "https://cdn.test/cookbook-covers/a.jpg",
        kind: "cookbook" as const,
      };
      const recipe = {
        url: "https://cdn.test/recipe-images/b.jpg",
        kind: "recipe" as const,
      };
      vi.mocked(storage.collectUserImageUrls).mockResolvedValueOnce([
        cover,
        recipe,
      ]);
      vi.mocked(storage.filterUnreferencedImageUrls).mockResolvedValueOnce([
        cover,
        recipe,
      ]);
      mockDeleteImage.mockClear();

      const res = await request(app)
        .delete("/api/auth/account")
        .set("Authorization", "Bearer mock-token")
        .send({ password: "correctpassword" });

      expect(res.status).toBe(200);
      await vi.waitFor(() => {
        expect(mockDeleteImage).toHaveBeenCalledWith(cover.url, "cookbook");
        expect(mockDeleteImage).toHaveBeenCalledWith(recipe.url, "recipe");
      });
      // Collected while the rows exist; filtered once they are gone, so a
      // remaining reference can only be another account's.
      const collectOrder = vi.mocked(storage.collectUserImageUrls).mock
        .invocationCallOrder[0];
      const deleteOrder = vi.mocked(storage.deleteUser).mock
        .invocationCallOrder[0];
      const filterOrder = vi.mocked(storage.filterUnreferencedImageUrls).mock
        .invocationCallOrder[0];
      expect(storage.collectUserImageUrls).toHaveBeenCalledWith("1");
      expect(collectOrder).toBeLessThan(deleteOrder);
      expect(deleteOrder).toBeLessThan(filterOrder);
      expect(storage.filterUnreferencedImageUrls).toHaveBeenCalledWith([
        cover,
        recipe,
      ]);
    });

    it("leaves an image alone when another account still references it", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 10);
      vi.mocked(storage.getUserForAuth).mockResolvedValue(
        createMockUser({ password: hash }),
      );
      vi.mocked(storage.deleteUser).mockResolvedValue(true);
      const shared = {
        url: "https://cdn.test/recipe-images/shared.jpg",
        kind: "recipe" as const,
      };
      vi.mocked(storage.collectUserImageUrls).mockResolvedValueOnce([shared]);
      vi.mocked(storage.filterUnreferencedImageUrls).mockResolvedValueOnce([]);
      mockDeleteImage.mockClear();

      const res = await request(app)
        .delete("/api/auth/account")
        .set("Authorization", "Bearer mock-token")
        .send({ password: "correctpassword" });

      expect(res.status).toBe(200);
      await vi.waitFor(() =>
        expect(storage.filterUnreferencedImageUrls).toHaveBeenCalled(),
      );
      expect(mockDeleteImage).not.toHaveBeenCalledWith(shared.url, "recipe");
    });
  });

  describe("two-step verification on password proofs (spec D2)", () => {
    async function mfaUser() {
      return createMockUser({
        password: pv2Correct,
        email: "current@example.com",
        mfaEnabledAt: new Date(),
      });
    }

    beforeEach(() => {
      mockVerifySecondFactor.mockReset();
      vi.mocked(storage.updateUserEmail).mockReset();
      vi.mocked(storage.deleteUser).mockReset();
    });

    describe("GET /api/auth/me", () => {
      it("reports mfaEnabled and never a secret, pending secret or the raw timestamp", async () => {
        vi.mocked(storage.getUser).mockResolvedValue({
          ...createMockUser({ mfaEnabledAt: new Date() }),
          // A row that somehow carried MFA secrets must still not leak them.
          totpSecretEnc: "v1:secret",
          pendingSecretEnc: "v1:pending",
        } as unknown as Awaited<ReturnType<typeof storage.getUser>>);
        vi.mocked(storage.getSignInMethods).mockResolvedValue({
          password: true,
          google: null,
          apple: null,
        });
        const res = await request(app)
          .get("/api/auth/me")
          .set("Authorization", "Bearer mock-token");
        expect(res.status).toBe(200);
        expect(res.body.mfaEnabled).toBe(true);
        expect(res.body).not.toHaveProperty("mfaEnabledAt");
        expect(JSON.stringify(res.body)).not.toContain("v1:");
      });

      it("mfaEnabled is false when two-step verification is off", async () => {
        vi.mocked(storage.getUser).mockResolvedValue(createMockUser());
        vi.mocked(storage.getSignInMethods).mockResolvedValue({
          password: true,
          google: null,
          apple: null,
        });
        const res = await request(app)
          .get("/api/auth/me")
          .set("Authorization", "Bearer mock-token");
        expect(res.body.mfaEnabled).toBe(false);
      });
    });

    describe("POST /api/auth/login", () => {
      const login = (body: object = {}) =>
        request(app)
          .post("/api/auth/login")
          .send({ username: "testuser", password: "correctpassword", ...body });

      beforeEach(async () => {
        vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
          await mfaUser(),
        );
        vi.mocked(storage.createMfaChallenge).mockReset();
        vi.mocked(storage.createMfaChallenge).mockResolvedValue(undefined);
        vi.mocked(storage.isTrustedDevice).mockReset();
      });

      it("MFA, no trust key → 200 mfa_required with a challenge and NO token", async () => {
        const res = await login();
        expect(res.status).toBe(200);
        expect(res.body).toEqual({
          status: "mfa_required",
          challenge: expect.any(String),
        });
        expect(storage.createMfaChallenge).toHaveBeenCalledTimes(1);
        const authMod = await import("../../middleware/auth");
        expect(authMod.generateToken).not.toHaveBeenCalled();
      });

      it("MFA + a trusted phone's key → a normal token, no challenge", async () => {
        vi.mocked(storage.isTrustedDevice).mockResolvedValue(true);
        const trustKey = "k".repeat(43);
        const res = await login({ trustKey });
        expect(res.status).toBe(200);
        expect(res.body.token).toBe("mock-jwt-token");
        expect(storage.createMfaChallenge).not.toHaveBeenCalled();
        const { hashTrustKey } = await import("../../lib/mfa/mfa-secrets");
        expect(storage.isTrustedDevice).toHaveBeenCalledWith(
          "1",
          hashTrustKey(trustKey),
        );
      });

      it("MFA + a key that is not trusted for THIS user (expired, forgotten, someone else's) → challenge", async () => {
        vi.mocked(storage.isTrustedDevice).mockResolvedValue(false);
        const res = await login({ trustKey: "k".repeat(43) });
        expect(res.body.status).toBe("mfa_required");
        expect(res.body.token).toBeUndefined();
      });

      it("wrong password on an MFA account → 401 and no challenge", async () => {
        const res = await login({ password: "wrongpassword" });
        expect(res.status).toBe(401);
        expect(storage.createMfaChallenge).not.toHaveBeenCalled();
      });

      it("no MFA → the unchanged token response, no challenge", async () => {
        vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
          createMockUser({ password: pv2Correct }),
        );
        const res = await login();
        expect(res.body.token).toBe("mock-jwt-token");
        expect(storage.createMfaChallenge).not.toHaveBeenCalled();
      });
    });

    describe("POST /api/auth/change-email", () => {
      const send = (body: object) =>
        request(app)
          .post("/api/auth/change-email")
          .set("Authorization", "Bearer mock-token")
          .send({ newEmail: "new@example.com", ...body });

      it("right password, no code → 403 SECOND_FACTOR_REQUIRED and no write", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(await mfaUser());
        const res = await send({ password: "correctpassword" });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("SECOND_FACTOR_REQUIRED");
        expect(storage.updateUserEmail).not.toHaveBeenCalled();
        expect(storage.stagePendingEmail).not.toHaveBeenCalled();
      });

      it("wrong password, no code → the existing 401, never a 403", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(await mfaUser());
        const res = await send({ password: "wrongpassword" });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHORIZED");
        expect(mockVerifySecondFactor).not.toHaveBeenCalled();
      });

      it("wrong code → 401 INVALID_SECOND_FACTOR and no write", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(await mfaUser());
        mockVerifySecondFactor.mockResolvedValue({
          ok: false,
          reason: "invalid",
        });
        const res = await send({
          password: "correctpassword",
          secondFactor: { code: "000000" },
        });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("INVALID_SECOND_FACTOR");
        expect(storage.updateUserEmail).not.toHaveBeenCalled();
      });

      it("right code → the email changes", async () => {
        const user = await mfaUser();
        vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
        mockVerifySecondFactor.mockResolvedValue({ ok: true });
        vi.mocked(storage.updateUserEmail).mockResolvedValue({
          ...user,
          email: "new@example.com",
        });
        const res = await send({
          password: "correctpassword",
          secondFactor: { code: "123456" },
        });
        expect(res.status).toBe(200);
        expect(storage.updateUserEmail).toHaveBeenCalledWith(
          "1",
          "new@example.com",
        );
        expect(res.body.replacementRecoveryCode).toBeUndefined();
      });

      it("a recovery code → the response carries its replacement", async () => {
        const user = await mfaUser();
        vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
        mockVerifySecondFactor.mockResolvedValue({
          ok: true,
          replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
        });
        vi.mocked(storage.updateUserEmail).mockResolvedValue({
          ...user,
          email: "new@example.com",
        });
        const res = await send({
          password: "correctpassword",
          secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
        });
        expect(res.status).toBe(200);
        expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
      });

      it("a recovery code then an email collision → 409 that still carries its replacement", async () => {
        const user = await mfaUser();
        vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
        mockVerifySecondFactor.mockResolvedValue({
          ok: true,
          replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
        });
        vi.mocked(storage.updateUserEmail).mockRejectedValue(
          Object.assign(new Error("dup"), { code: "23505" }),
        );
        const res = await send({
          password: "correctpassword",
          secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
        });
        expect(res.status).toBe(409);
        expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
      });

      it("a recovery code then an unexpected error → 500 that still carries its replacement", async () => {
        const user = await mfaUser();
        vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
        mockVerifySecondFactor.mockResolvedValue({
          ok: true,
          replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
        });
        vi.mocked(storage.updateUserEmail).mockRejectedValue(new Error("db"));
        const res = await send({
          password: "correctpassword",
          secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
        });
        expect(res.status).toBe(500);
        expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
      });

      it("a recovery code on the verification-pending path also carries its replacement", async () => {
        vi.mocked(emailVerificationEnabled).mockReturnValue(true);
        const user = await mfaUser();
        vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
        vi.mocked(storage.stagePendingEmail).mockResolvedValue(user);
        mockVerifySecondFactor.mockResolvedValue({
          ok: true,
          replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
        });
        const res = await send({
          password: "correctpassword",
          secondFactor: { recoveryCode: "WXYZ-WXYZ-WXYZ-WXYZ" },
        });
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("verification_pending");
        expect(res.body.replacementRecoveryCode).toBe("AAAA-BBBB-CCCC-DDDD");
      });
    });

    describe("DELETE /api/auth/account", () => {
      const del = (body: object) =>
        request(app)
          .delete("/api/auth/account")
          .set("Authorization", "Bearer mock-token")
          .send(body);

      it("right password, no code → 403 and the account is NOT deleted", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(await mfaUser());
        const res = await del({ password: "correctpassword" });
        expect(res.status).toBe(403);
        expect(res.body.code).toBe("SECOND_FACTOR_REQUIRED");
        expect(storage.deleteUser).not.toHaveBeenCalled();
      });

      it("wrong password → 401 UNAUTHORIZED, never a 403", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(await mfaUser());
        const res = await del({ password: "wrongpassword" });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("UNAUTHORIZED");
      });

      it("wrong code → 401 INVALID_SECOND_FACTOR and no delete", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(await mfaUser());
        mockVerifySecondFactor.mockResolvedValue({
          ok: false,
          reason: "invalid",
        });
        const res = await del({
          password: "correctpassword",
          secondFactor: { code: "000000" },
        });
        expect(res.status).toBe(401);
        expect(res.body.code).toBe("INVALID_SECOND_FACTOR");
        expect(storage.deleteUser).not.toHaveBeenCalled();
      });

      it("right code → deleted", async () => {
        vi.mocked(storage.getUserForAuth).mockResolvedValue(await mfaUser());
        vi.mocked(storage.deleteUser).mockResolvedValue(true);
        mockVerifySecondFactor.mockResolvedValue({ ok: true });
        const res = await del({
          password: "correctpassword",
          secondFactor: { code: "123456" },
        });
        expect(res.status).toBe(200);
        expect(storage.deleteUser).toHaveBeenCalledWith("1");
      });
    });
  });

  describe("Error paths", () => {
    it("POST /api/auth/register returns 500 on storage error", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
      vi.mocked(storage.createUser).mockRejectedValue(new Error("DB error"));

      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: GOOD_PASSWORD,
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

  describe("NULL password (social-only account)", () => {
    it("login returns the ordinary 401", async () => {
      vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
        createMockUser({
          username: "social",
          password: null,
          emailVerified: true,
        }),
      );
      const res = await request(app)
        .post("/api/auth/login")
        .send({ username: "social", password: "whatever1" });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
    });

    it("change-email returns 401, not 500", async () => {
      vi.mocked(storage.getUserForAuth).mockResolvedValue(
        createMockUser({ id: "1", password: null }),
      );
      const res = await request(app)
        .post("/api/auth/change-email")
        .set("Authorization", "Bearer mock-token")
        .send({ newEmail: "new@example.com", password: "whatever1" });
      expect(res.status).toBe(401);
      expect(storage.stagePendingEmail).not.toHaveBeenCalled();
    });

    it("delete-account with a password body returns 401, not 500", async () => {
      vi.mocked(storage.getUserForAuth).mockResolvedValue(
        createMockUser({ id: "1", password: null }),
      );
      vi.mocked(storage.deleteUser).mockClear();
      const res = await request(app)
        .delete("/api/auth/account")
        .set("Authorization", "Bearer mock-token")
        .send({ password: "whatever1" });
      expect(res.status).toBe(401);
      expect(storage.deleteUser).not.toHaveBeenCalled();
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
