/**
 * Real-DB HTTP integration harness for the auth route group.
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * Every suite under `server/routes/__tests__/` does
 * `vi.mock("../../storage")` AND `vi.mock("../../middleware/auth")`. That
 * proves handler logic, but the request never actually flows through real
 * Express middleware composition, real `requireAuth` (JWT verify + DB
 * tokenVersion lookup), or a real Postgres row — so a route that breaks the
 * auth wiring seam (e.g. a revocation check that silently no-ops) can pass
 * every existing test while shipping a real regression. See
 * `docs/solutions/conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md`
 * and [[project-auth-recurring-breakage]].
 *
 * This suite closes that gap for ONE critical route group (auth) by driving
 * a real Express app — built from the actual `register()` export in
 * `server/routes/auth.ts` — through `supertest`, with:
 *   - the REAL `requireAuth` middleware (not mocked)
 *   - the REAL `storage` layer (not mocked)
 *   - a REAL Postgres transaction, via `test/db-test-utils.ts`
 *
 * The only thing mocked is `server/db`'s `db` export, redirected to the
 * current test's transaction (`getTestTx()`) so every write this suite makes
 * rolls back in `afterEach` — the SAME pattern already used by every
 * `server/storage/__tests__/*.test.ts` suite (see `users.test.ts`).
 * `express-rate-limit` is also mocked to its project-standard pass-through
 * (`__mocks__/express-rate-limit.ts`) purely to avoid the shared in-memory
 * limiter store leaking 429s across unrelated cases in the same worker —
 * that is a hygiene measure, not a mock of storage or auth.
 *
 * HARNESS SHAPE DECISIONS (see Implementation Notes on the originating todo)
 * ---------------------------------------------------------------------------
 * - Isolation: per-test transaction + rollback (`setupTestTransaction` /
 *   `rollbackTestTransaction`), not truncate-between-tests — reuses the
 *   exact machinery the storage-layer integration tests already rely on,
 *   and rollback is both faster and immune to leaking partial writes on a
 *   failed assertion.
 * - Fixtures: `createTestUser()` for tests that only need a *userId* +
 *   *tokenVersion* pair (the `/me` wiring-seam tests below) — it writes a
 *   placeholder password hash, which is fine there since those tests never
 *   authenticate with a password. Tests that exercise password verification
 *   (register/login) go through the real HTTP endpoints instead, so the
 *   real bcrypt hash + real bcrypt.compare path is what's actually proven.
 * - Auth tokens: minted directly via the real `generateToken()` for the
 *   `/me` tests (matches `server/routes/__tests__/auth-route-wiring.test.ts`)
 *   — `requireAuth` only cares that the signature and DB tokenVersion check
 *   out, not how the token was produced, so this exercises the identical
 *   composition path as a client-issued token.
 *
 * HOW TO RUN — see `test/integration/README.md` for the full explanation of
 * why this suite is intentionally NOT part of `npm run test:run` / CI.
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { users } from "@shared/schema";

import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../db-test-utils";

// Real DB, redirected to the per-test transaction. NOT storage, NOT auth
// middleware — the AC for this suite requires both stay real.
vi.mock("../../server/db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Pass-through rate limiter (root __mocks__/express-rate-limit.ts) — same
// hygiene measure server/routes/__tests__/auth-route-wiring.test.ts uses, so
// the shared in-memory limiter store can't leak a 429 into an unrelated case.
vi.mock("express-rate-limit");

// Dynamic import so the route module's dependency graph (storage → db)
// resolves against the mocks registered above, mirroring
// server/storage/__tests__/users.test.ts's `await import(...)` pattern.
const { register: registerAuth } = await import("../../server/routes/auth");
const { generateToken } = await import("../../server/middleware/auth");
const { storage } = await import("../../server/storage");

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  registerAuth(app);
  return app;
}

function uniqueCredentials() {
  const id = crypto.randomUUID().slice(0, 8);
  return {
    // `testuser_` prefix (not just `itest_`) so a row that escapes rollback
    // (a killed process, a timeout before afterEach runs) is still caught by
    // test/global-teardown.ts's `username LIKE 'testuser_%'` safety-net sweep
    // — the same convention test/db-test-utils.ts's createTestUser() follows.
    // This suite's register/login tests are the only ones that write a real
    // row outside createTestUser() (deliberately, to exercise real bcrypt).
    username: `testuser_itest_${id}`,
    email: `itest_${id}@test.invalid`,
    // registerSchema requires at least one letter AND one digit.
    password: "correct horse battery staple 9",
    // COPPA 13+ attestation — registerSchema rejects false/undefined/missing.
    ageConfirmed: true as const,
  };
}

let tx: NodePgDatabase<typeof schema>;

beforeEach(async () => {
  tx = await setupTestTransaction();
  // Deterministic regardless of the developer's local .env: force the
  // fail-open (no email-verification round-trip) register/login path so
  // these HTTP-level tests aren't coupled to whether RESEND_API_KEY happens
  // to be configured on this machine.
  vi.stubEnv("RESEND_API_KEY", "");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rollbackTestTransaction();
});

afterAll(async () => {
  await closeTestPool();
});

describe("auth routes — real Express app, real requireAuth, real test DB", () => {
  describe("POST /api/auth/register", () => {
    it("writes a real user row and returns a usable token", async () => {
      const creds = uniqueCredentials();

      const res = await request(buildApp())
        .post("/api/auth/register")
        .send(creds);

      expect(res.status).toBe(201);
      expect(typeof res.body.token).toBe("string");
      expect(res.body.user.username).toBe(creds.username);

      // Prove the write actually landed in Postgres — not just that the
      // handler returned success. A mocked-storage test cannot make this
      // assertion at all.
      const [row] = await tx
        .select()
        .from(users)
        .where(eq(users.id, res.body.user.id));
      expect(row).toBeDefined();
      expect(row.email).toBe(creds.email.toLowerCase());
      // Real bcrypt hash, not the storage-test placeholder.
      expect(row.password).not.toBe("hashed_password_placeholder");
      expect(row.password.startsWith("$2")).toBe(true);
    });
  });

  describe("POST /api/auth/login", () => {
    it("verifies a real bcrypt hash end-to-end and returns a valid token", async () => {
      const creds = uniqueCredentials();
      const registerRes = await request(buildApp())
        .post("/api/auth/register")
        .send(creds);
      expect(registerRes.status).toBe(201);

      const loginRes = await request(buildApp())
        .post("/api/auth/login")
        .send({ username: creds.username, password: creds.password });

      expect(loginRes.status).toBe(200);
      expect(typeof loginRes.body.token).toBe("string");
      expect(loginRes.body.user.username).toBe(creds.username);
    });

    it("rejects an incorrect password with 401, without leaking which field was wrong", async () => {
      const creds = uniqueCredentials();
      await request(buildApp()).post("/api/auth/register").send(creds);

      const res = await request(buildApp()).post("/api/auth/login").send({
        username: creds.username,
        password: "wrong password entirely",
      });

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("UNAUTHORIZED");
    });
  });

  describe("GET /api/auth/me — the requireAuth wiring seam", () => {
    it("401s with no token, never reaching storage", async () => {
      const res = await request(buildApp()).get("/api/auth/me");
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("NO_TOKEN");
    });

    it("200s with the real user when a valid token's tokenVersion matches the DB", async () => {
      const user = await createTestUser(tx);
      const token = generateToken(
        user.id,
        user.tokenVersion,
        user.emailVerified,
      );

      const res = await request(buildApp())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.username).toBe(user.username);
    });

    it("401 TOKEN_REVOKED when the DB tokenVersion no longer matches the token — the exact scenario a mocked-auth route test cannot catch", async () => {
      const user = await createTestUser(tx);
      const token = generateToken(
        user.id,
        user.tokenVersion,
        user.emailVerified,
      );

      // Simulate a logout via the REAL storage layer (real DB write).
      await storage.incrementTokenVersion(user.id);

      // This MUST be the first request for this userId in the process: the
      // real requireAuth's in-memory tokenVersionCache (60s TTL, module-level
      // state) is unpopulated for a never-seen id, so the lookup is
      // guaranteed to hit the real DB rather than serve a stale cache hit.
      const res = await request(buildApp())
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("TOKEN_REVOKED");
    });
  });
});
