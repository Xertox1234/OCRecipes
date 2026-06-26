import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";
// Same IP-key normalizer the production keyGenerator runs (via ipKeyGenerator),
// so the test reconstructs the exact loginLimiter store key it needs to reset.
import { ipKeyGenerator as normalizeIpKey } from "express-rate-limit";

import { createMockUser } from "../../__tests__/factories";
import { storage } from "../../storage";
import {
  loginLimiter,
  loginAccountLimiter,
  normalizeUsernameKey,
  LOGIN_ACCOUNT_KEY_PREFIX,
} from "../_rate-limiters";
import { register } from "../auth";

// NOTE: deliberately NO vi.mock("express-rate-limit") here — this file
// exercises the REAL limiter middleware (lockout threshold, failed-attempt
// counting, skipSuccessfulRequests). The route tests in auth.test.ts use the
// passthrough mock instead.
//
// The real limiters' MemoryStore persists for the lifetime of this file's
// module graph, so without intervention a bucket filled in one test (or one
// retry attempt) leaks into the next — `retry:2` re-runs in the SAME polluted
// process, so it cannot rescue this. PRIMARY isolation is therefore an active
// store reset in `beforeEach` (verified to run before every retry attempt, not
// just once per test): the `login()` helper records the exact production store
// keys it touches, and the hook drains them via `resetKey` on both real
// limiters. Per-test unique usernames + X-Forwarded-For IP ranges are retained
// as defense-in-depth (and keep the IP-keyed loginLimiter buckets distinct).
//
// MAINTAINER NOTES:
//  - The "beforeEach runs before every retry attempt" invariant was confirmed
//    with a throwaway probe (Vitest 4.1.7) but is NOT guarded by a kept test —
//    if a future Vitest changes per-retry hook semantics this isolation could
//    regress silently. Re-run such a probe if you bump Vitest majors.
//  - loginAccountLimiter uses skipSuccessfulRequests, whose decrement fires on
//    the response `finish` event — i.e. possibly AFTER supertest resolves and
//    after this beforeEach reset. Benign today (the only shared-key case below
//    has zero successful logins). If you add a shared-key case whose first test
//    includes SUCCESSFUL logins, that pending decrement can race the next
//    reset — reset by absolute count or settle the response first.
//
// NOTE on the original flake report: a transient `404` was also observed. A 404
// cannot originate from a rate limiter (that path returns 429), so this
// reset does NOT address it — it points at a separate `register(app)` /
// module-init timing symptom and is out of scope for this test-isolation fix.

vi.mock("../../storage", () => ({
  storage: {
    getUserByUsernameForAuth: vi.fn(),
  },
}));

vi.mock("../../middleware/auth");

const LIMIT = 10; // mirrors loginAccountLimiter's max

let app: express.Express;
// Real bcrypt hash of "correct-password" (project convention — auth.test.ts
// also exercises the real bcrypt.compare instead of mocking it).
let correctPasswordHash: string;

beforeAll(async () => {
  correctPasswordHash = await bcrypt.hash("correct-password", 10);

  app = express();
  // One trusted hop, mirroring production (trust proxy = 1) — lets tests
  // rotate the client IP via X-Forwarded-For to simulate a distributed
  // attacker while the loopback socket peer stays constant.
  app.set("trust proxy", 1);
  app.use(express.json());
  register(app);

  // Default storage behavior: no user matches → every login attempt fails
  // with the generic 401. Individual tests override for success paths.
  vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(undefined);
});

// Every login() records the exact production store keys it will hit, so the
// beforeEach reset can clear precisely those buckets — the limiter middleware
// exposes resetKey() but not resetAll(). Keys are derived with the SAME helpers
// the production keyGenerators use (normalizeUsernameKey / normalizeIpKey +
// LOGIN_ACCOUNT_KEY_PREFIX), so a reset can never silently drift from prod
// keying (a drift would make the deterministic isolation test below fail loud).
const touchedAccountKeys = new Set<string>();
const touchedIpKeys = new Set<string>();

function login(username: string, ip: string, password = "wrong-password") {
  // loginAccountLimiter keys failed attempts by normalized username (falling
  // back to the IP key when none is usable); loginLimiter keys by IP. All test
  // IPs are IPv4 in X-Forwarded-For with no RAILWAY_ENVIRONMENT_NAME set, so
  // normalizeIpKey(ip) === the production loginLimiter key for req.ip.
  const usernameKey = normalizeUsernameKey(username);
  const ipKey = normalizeIpKey(ip);
  touchedAccountKeys.add(
    usernameKey ? `${LOGIN_ACCOUNT_KEY_PREFIX}${usernameKey}` : ipKey,
  );
  touchedIpKeys.add(ipKey);
  return request(app)
    .post("/api/auth/login")
    .set("X-Forwarded-For", ip)
    .send({ username, password });
}

// PRIMARY isolation: clear every bucket the previous attempt (test OR retry)
// touched before the next one runs, so a filled bucket can never leak across
// the shared module-level MemoryStore. Vitest is verified to run beforeEach
// before EACH retry attempt, so this also neutralizes the
// retry:2-in-a-polluted-process failure that per-test unique namespacing alone
// could not fix. resetKey is typed `() => void` and MemoryStore clears the
// bucket synchronously (a plain Map.delete with no internal await), so a sync
// loop is both correct and avoids awaiting a non-thenable.
beforeEach(() => {
  for (const key of touchedAccountKeys) loginAccountLimiter.resetKey(key);
  for (const key of touchedIpKeys) loginLimiter.resetKey(key);
  touchedAccountKeys.clear();
  touchedIpKeys.clear();
});

function successUserFor(username: string) {
  // Make this username resolvable: logging in with "correct-password"
  // succeeds (real bcrypt.compare against the precomputed hash), any other
  // password fails with the generic 401.
  const user = createMockUser({ username, password: correctPasswordHash });
  vi.mocked(storage.getUserByUsernameForAuth).mockImplementation(
    async (name: string) => (name === username ? user : undefined),
  );
}

describe("normalizeUsernameKey", () => {
  it("trims and lowercases", () => {
    expect(normalizeUsernameKey("  Alice ")).toBe("alice");
  });

  it("caps the key length at 100 characters", () => {
    expect(normalizeUsernameKey("x".repeat(500))).toHaveLength(100);
  });

  it("coerces non-string JSON values without throwing", () => {
    // keyGenerator runs before Zod validation — body fields can be any JSON
    // type and must never throw.
    expect(normalizeUsernameKey({ a: 1 })).toBe("[object object]");
    expect(normalizeUsernameKey([1, 2])).toBe("1,2");
    expect(normalizeUsernameKey(42)).toBe("42");
    expect(normalizeUsernameKey(true)).toBe("true");
  });

  it("returns null when no usable username is present", () => {
    expect(normalizeUsernameKey(undefined)).toBeNull();
    expect(normalizeUsernameKey(null)).toBeNull();
    expect(normalizeUsernameKey("")).toBeNull();
    expect(normalizeUsernameKey("   ")).toBeNull();
  });
});

describe("per-account login throttling (real express-rate-limit)", () => {
  it("throttles repeated failed logins for one username across rotating source IPs", async () => {
    // Distributed attack: every attempt comes from a different IP, so the
    // IP-keyed loginLimiter never trips — only the username-keyed layer can.
    for (let i = 1; i <= LIMIT; i++) {
      const res = await login("victim-account", `10.1.0.${i}`);
      expect(res.status).toBe(401);
    }

    const blocked = await login("victim-account", "10.1.1.99");
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      error: "Too many login attempts, please try again later",
      code: "RATE_LIMITED",
    });
  });

  it("buckets cosmetic variants of the same username together", async () => {
    const variants = ["CasedUser", "caseduser", "  caseduser ", "CASEDUSER"];
    for (let i = 1; i <= LIMIT; i++) {
      const res = await login(variants[i % variants.length], `10.2.0.${i}`);
      expect(res.status).toBe(401);
    }

    const blocked = await login("CasedUser", "10.2.1.1");
    expect(blocked.status).toBe(429);
  });

  it("does not throttle other usernames when one account is locked out", async () => {
    for (let i = 1; i <= LIMIT; i++) {
      await login("locked-account", `10.3.0.${i}`);
    }
    expect((await login("locked-account", "10.3.1.1")).status).toBe(429);

    // A different account is untouched — buckets are per-username.
    const other = await login("innocent-account", "10.3.1.2");
    expect(other.status).toBe(401);
  });

  it("does not count successful logins toward the lockout threshold", async () => {
    successUserFor("happy-user");

    // Well past the failure threshold in successful logins…
    for (let i = 1; i <= LIMIT + 2; i++) {
      const res = await login("happy-user", `10.4.0.${i}`, "correct-password");
      expect(res.status).toBe(200);
    }

    // …and the account still is not locked: a subsequent failed attempt gets
    // the generic 401, not a 429.
    const failed = await login("happy-user", "10.4.1.1");
    expect(failed.status).toBe(401);
  });

  it("counts only failed attempts when failures and successes interleave", async () => {
    successUserFor("mixed-user");

    // 5 failures, 1 success (un-counted), 5 failures → 10 counted failures.
    for (let i = 1; i <= 5; i++) {
      expect((await login("mixed-user", `10.5.0.${i}`)).status).toBe(401);
    }
    expect(
      (await login("mixed-user", "10.5.0.6", "correct-password")).status,
    ).toBe(200);
    for (let i = 1; i <= 5; i++) {
      expect((await login("mixed-user", `10.5.1.${i}`)).status).toBe(401);
    }

    const blocked = await login("mixed-user", "10.5.2.1");
    expect(blocked.status).toBe(429);
  });

  it("returns a 429 indistinguishable from the generic IP-keyed rate limit (no account-existence oracle)", async () => {
    // Trip the per-account layer for one username (rotating IPs).
    for (let i = 1; i <= LIMIT; i++) {
      await login("oracle-probe", `10.6.0.${i}`);
    }
    const accountBlocked = await login("oracle-probe", "10.6.1.1");

    // Trip the generic IP-keyed loginLimiter from a single IP using a unique
    // username per request (so the per-account layer never reaches its
    // threshold first).
    let ipBlocked: request.Response | undefined;
    for (let i = 1; i <= LIMIT + 1; i++) {
      ipBlocked = await login(`ip-probe-${i}`, "10.6.2.2");
    }
    if (!ipBlocked) throw new Error("loop produced no response");

    // Same status, identical body, same rate-limit headers — a client cannot
    // tell the account-keyed throttle from the IP-keyed one, so a 429 reveals
    // nothing about whether the username exists. (The limiter never consults
    // storage, so timing is also independent of account existence.)
    expect(accountBlocked.status).toBe(429);
    expect(ipBlocked.status).toBe(429);
    expect(accountBlocked.body).toEqual(ipBlocked.body);
    expect(accountBlocked.headers["ratelimit-limit"]).toBe(
      ipBlocked.headers["ratelimit-limit"],
    );
  });
});

describe("beforeEach store reset isolates buckets across cases (regression: P3 store-pollution flake)", () => {
  // These two cases DELIBERATELY share a username (unlike the suite above, which
  // sidesteps pollution via unique namespacing). The bucket is filled to lockout
  // in the first case; the second case passing proves the beforeEach store reset
  // — not namespacing — cleared it. Vitest is verified to run beforeEach before
  // every retry attempt, so the same mechanism covers the
  // retry:2-in-a-polluted-process case the flake was actually about. Run in
  // isolation either case still passes (a clean bucket also returns 401), so the
  // proof is in their ordered pairing, never a false failure.
  const SHARED = "reset-probe-account";

  it("[setup] fills the shared account bucket to lockout (429)", async () => {
    for (let i = 1; i <= LIMIT; i++) {
      expect((await login(SHARED, `10.7.0.${i}`)).status).toBe(401);
    }
    // N+1th failed attempt is throttled — the SHARED bucket is now full.
    expect((await login(SHARED, "10.7.1.1")).status).toBe(429);
  });

  it("[verify] the next case sees the shared bucket reset, not a leaked 429", async () => {
    // Had the beforeEach reset not run (or missed the key), SHARED's bucket
    // would still sit at the lockout limit from the previous case and this lone
    // attempt would return 429. A 401 proves the reset cleared it.
    expect((await login(SHARED, "10.7.2.1")).status).toBe(401);
  });
});
