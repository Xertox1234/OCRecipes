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
// RESOLVED — the original flake report's transient `404` (investigated
// 2026-06-26, todo P3-2026-06-26-auth-throttle-test-transient-404):
// closed not-reproducible because a 404 from THIS app is structurally
// impossible after `beforeAll`, not merely "not reproduced again".
//   - The login handler + its middleware emit only 401 / 403 / 200 / 429, and
//     handleRouteError maps ZodError → 400 / everything else → 500 — never 404.
//     The ONLY 404 source on `POST /api/auth/login` is Express's
//     unmatched-route default, i.e. the route was absent when the request fired.
//   - But the login route is registered UNCONDITIONALLY and SYNCHRONOUSLY by
//     register(app) (server/routes/auth.ts) inside an awaited `beforeAll`, and
//     Vitest guarantees `beforeAll` completes before any test runs — so the
//     route is always present by request time. The three candidate triggers are
//     all excluded: (a) beforeAll-incomplete — register() is sync, nothing in
//     beforeAll is left unawaited; (b) cross-file `vi.mock` bleed of register —
//     impossible: `pool: "forks"` + default `isolate: true` give each file its
//     own isolated module graph, AND `../auth` (the SUT exporting register) is
//     never mocked here (only `../../storage` and `../../middleware/auth` are,
//     neither of which gates route registration); (c)
//     module-init ordering race — register runs to completion in beforeAll, well
//     after the import graph is wired.
//   - The single observation (one retry attempt in one PR#460 preflight run;
//     this file passes 11/11 in isolation, CI green, no recurrence since) has no
//     in-file mechanism — attributable to cross-test output aggregation / worker
//     noise under peak full-suite parallelism. It belongs to the documented
//     load-flake FAMILY (docs/LEARNINGS.md → "Load-Induced vitest vi.mock
//     Application Flake", 2026-05-17), cited here for load-context only: that
//     doc's specific mechanism (a vi.mock failing to apply → real code RUNS →
//     wrong handler status) yields a handler status, never a route-absent 404,
//     so it is NOT the literal mechanism here. Per that learning's rule, NO
//     defensive guard is added, by design — a guard would mask, not fix, and
//     there is no reproducible cause.
//
// (For reference: a 404 still cannot originate from a rate limiter either —
// that path returns 429 — so the PR #462 store reset above was correctly scoped
// to exclude it.)

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
// the shared module-level MemoryStore. resetKey is typed `() => void` and
// MemoryStore clears the bucket synchronously (a plain Map.delete with no
// internal await), so a sync loop is both correct and avoids awaiting a
// non-thenable. Extracted as a named helper so the regression test below can
// exercise the IDENTICAL drain logic — keeping them in lockstep.
function drainTouchedBuckets() {
  for (const key of touchedAccountKeys) loginAccountLimiter.resetKey(key);
  for (const key of touchedIpKeys) loginLimiter.resetKey(key);
  touchedAccountKeys.clear();
  touchedIpKeys.clear();
}

// Vitest is verified to run beforeEach before EACH retry attempt, so wiring the
// drain here also neutralizes the retry:2-in-a-polluted-process failure that
// per-test unique namespacing alone could not fix.
beforeEach(drainTouchedBuckets);

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

describe("store reset clears a polluted bucket (regression: P3 store-pollution flake)", () => {
  // Self-contained and ORDER-INDEPENDENT — it pollutes, drains, and asserts in a
  // single test, so it can never silently false-pass under sequence.shuffle the
  // way an ordered [setup]/[verify] pair could (a sibling running first would
  // leave a clean bucket → vacuous 401). It calls drainTouchedBuckets() — the
  // exact function the beforeEach hook runs — so a regression in the drain logic
  // (dropped resetKey, wrong key derivation, changed prefix) flips the final
  // assert from 401 to a leaked 429. Mutation-confirmed.
  it("a per-account bucket filled to lockout returns 401 again after the drain", async () => {
    const SHARED = "reset-probe-account";

    // Pollute: fill the per-account bucket past the lockout threshold (rotating
    // IPs so only the account-keyed layer trips, never the IP-keyed one).
    for (let i = 1; i <= LIMIT; i++) {
      expect((await login(SHARED, `10.7.0.${i}`)).status).toBe(401);
    }
    expect((await login(SHARED, "10.7.1.1")).status).toBe(429);

    // Drain exactly as the beforeEach hook does between tests.
    drainTouchedBuckets();

    // Cleared: the same username gets the generic 401 again, not the leaked 429.
    expect((await login(SHARED, "10.7.2.1")).status).toBe(401);
  });
});
