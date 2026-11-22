# Email Verification via Resend — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **AUTH/SECURITY = NEVER-DELEGATE.** This plan is implemented by hand (not via a todo-executor or cheap worker). Spec: `docs/superpowers/specs/2026-06-18-email-verification-resend-design.md`.

**Goal:** Verify the email collected at signup via Resend, with a hard gate that blocks login until verified, failing open whenever email sending is unconfigured.

**Architecture:** A stateless, purpose+audience-partitioned JWT carries the verification claim (no new table, no migration). Three enforcement points — register withholds the token, login returns `403 EMAIL_NOT_VERIFIED`, and `requireAuth` rejects a present-and-false claim — are ALL gated by a single `emailVerificationEnabled()` predicate so the whole feature is transparent until `RESEND_API_KEY` is set. Anti-enumeration: every signup response is byte-identical; the server branches internally on the existing account's verified state. Email sends are fire-and-forget (timing-oracle safe) with an in-service per-recipient throttle (email-bomb safe).

**Tech Stack:** Express 5 + TypeScript, `jsonwebtoken`, `resend` SDK, Drizzle ORM, Vitest + supertest (server), React Native / Expo + React Navigation v7 (client).

## Global Constraints

- **No new prod DDL.** Only the existing `users.email` / `users.emailVerified` columns are touched; existing-account safety is a one-time data backfill, not a migration.
- **Token TTL:** 24h. **Verify-token audience:** `ocrecipes-email-verify` (distinct from the access-token audience `ocrecipes-client`). **Verify-token purpose claim:** `"email-verify"`. **Verify token carries NO `tokenVersion`.**
- **`/verify-email` issues NO access token** — verifying proves email ownership, not password possession. Minting a token there is an auth bypass.
- **Fail-open:** when `emailVerificationEnabled()` is false, login issues tokens normally, register auto-logs-in (old behavior), and `requireAuth` does not reject. Never lock out dev / `demo/demo123` / prod-before-DNS.
- **Anti-enumeration:** all three signup outcomes (new / existing-unverified / existing-verified) return a byte-identical neutral `200`. Username-taken still `409` (pre-existing residual). Check **username before email** (`server/routes/auth.ts`).
- **Re-registration of an existing unverified email: resend verification; NEVER update the existing password.**
- **Secrets:** `RESEND_API_KEY`, `EMAIL_FROM` — no `EXPO_PUBLIC_` prefix; documented in `docs/DEV_SETUP.md`.
- **Error UI rule** (`ocrecipes/no-error-message-in-ui`): client never renders `error.message`; branch on `ApiError.code`.
- **Commit style:** conventional commits; pre-commit runs `lint-staged` (ESLint + Prettier) + tests; CI enforces the full gate.

---

## Pre-flight (read before Task 1)

This plan was verified against the codebase on 2026-06-18. These are the load-bearing facts a fresh-context executor should confirm still hold (the repo moves between sessions — if one has drifted, re-derive it before writing code rather than trusting this list):

1. **`JWT_SECRET` is set by `test/setup.ts:54-56`** (a vitest `setupFiles` entry that runs before test modules are imported). So `verification-token.ts`'s load-time `if (!JWT_SECRET) throw` is satisfied in tests — no per-test fallback needed. If `test/setup.ts` ever stops setting it, Task 1 fails at import.
2. **`vi.clearAllMocks()` runs globally (`test/setup.ts:62`) but clears call history ONLY — NOT return values.** The `emailVerificationEnabled` mock's `mockReturnValue` therefore persists across tests; Task 5 sets an OFF default in the Auth-Routes `beforeEach` to stop leakage. Keep it.
3. **`generateToken` is replaced by a manual mock (`server/middleware/__mocks__/auth.ts`) in `auth.test.ts`**, returning `"mock-jwt-token"` regardless of args — so the new 3-arg signature needs no mock change, and the auth route tests never exercise the real `requireAuth` gate (Task 4's dedicated test does, via the real module).
4. **Only one app caller of `register`** (`client/screens/LoginScreen.tsx:95`, updated in Task 11). Existing `useAuth` register tests pass unchanged (Task 9 Step 4 explains why); `AuthContext.test.ts:91`'s typed mock is the only existing client-test edit.
5. **The Resend `https` link only opens the app if AASA / `assetlinks.json` cover `/verify-email`** — a Task 12 gate-on checklist item, not a code task.

---

## File Structure

**Server — new files**

- `server/lib/email-config.ts` — `emailVerificationEnabled()` predicate (live env read). Lowest layer so both middleware and services can import it without a layering violation.
- `server/lib/verification-token.ts` — `signVerificationToken` / `verifyVerificationToken` (partitioned JWT).
- `server/services/email.ts` — Resend wrapper: `sendVerificationEmail`, `sendSignupAttemptNotice`, in-service per-recipient throttle; no-op when unconfigured.

**Server — modified**

- `shared/constants/error-codes.ts` — add `EMAIL_NOT_VERIFIED`.
- `server/lib/jwt-types.ts` — add optional `emailVerified` to `AccessTokenPayload`.
- `server/middleware/auth.ts` — `generateToken` takes `emailVerified`; `requireAuth` rejects present-false claim when verification enabled.
- `server/storage/users.ts` + `server/storage/index.ts` — `markEmailVerified`.
- `server/routes/_schemas.ts` — `verifyEmailSchema`, `resendVerificationSchema`.
- `server/routes/_rate-limiters.ts` — `verifyEmailLimiter`, `resendVerificationLimiter`.
- `server/routes/auth.ts` — register rewrite (3-branch), login gate, `POST /verify-email`, `POST /resend-verification`.
- `server/scripts/seed-recipes.ts` — demo account `emailVerified: true`.

**Client — new**

- `client/screens/VerifyEmailScreen.tsx` + `client/screens/VerifyEmailScreen-utils.ts`.

**Client — modified**

- `shared/types/auth.ts` — add `EMAIL_NOT_VERIFIED` to the `ApiError.code` union.
- `client/hooks/useAuth.ts` — `register` returns a discriminated result; no auto-login when verification pending.
- `client/context/AuthContext.tsx` — update `register` return type.
- `client/screens/LoginScreen.tsx` — navigate to `VerifyEmail` on pending-register and on `EMAIL_NOT_VERIFIED`.
- `client/navigation/RootStackNavigator.tsx` — register `VerifyEmail` in the unauthenticated branch.
- `client/navigation/linking.ts` — `verify-email` deep-link path.

**Ops/docs**

- `docs/DEV_SETUP.md` — Resend env + the gate-flip runbook.

---

## PHASE A — Server foundation (ships gate-OFF-safe; the API is inert until `RESEND_API_KEY` is set)

### Task 1: `EMAIL_NOT_VERIFIED` error code + verification-token lib

**Files:**

- Modify: `shared/constants/error-codes.ts:36`
- Create: `server/lib/verification-token.ts`
- Test: `server/lib/__tests__/verification-token.test.ts`

**Interfaces:**

- Produces: `signVerificationToken(userId: string, email: string): string`; `verifyVerificationToken(token: string): { sub: string; email: string; purpose: "email-verify" } | null`; `ErrorCode.EMAIL_NOT_VERIFIED`.

- [ ] **Step 1: Add the error code**

In `shared/constants/error-codes.ts`, add inside the `ErrorCode` object (e.g. after `UNAUTHORIZED`):

```ts
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
```

- [ ] **Step 2: Write the failing test**

Create `server/lib/__tests__/verification-token.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import {
  signVerificationToken,
  verifyVerificationToken,
} from "../verification-token";

// JWT_SECRET is set by the global test setup (test/setup.ts), which runs BEFORE
// this module is imported — so verification-token.ts's load-time
// `if (!JWT_SECRET) throw` is already satisfied. No local fallback is needed
// (a beforeAll would run too late — after the static import has already thrown).

describe("verification-token", () => {
  it("round-trips a valid token", () => {
    const token = signVerificationToken("user-123", "a@b.com");
    const payload = verifyVerificationToken(token);
    expect(payload).toEqual({
      sub: "user-123",
      email: "a@b.com",
      purpose: "email-verify",
    });
  });

  it("rejects an expired token", () => {
    const secret = process.env.JWT_SECRET as string;
    const expired = jwt.sign(
      { email: "a@b.com", purpose: "email-verify" },
      secret,
      {
        subject: "user-123",
        audience: "ocrecipes-email-verify",
        issuer: "ocrecipes-api",
        expiresIn: -10,
      },
    );
    expect(verifyVerificationToken(expired)).toBeNull();
  });

  it("rejects an access token presented as a verification token (audience mismatch)", () => {
    const secret = process.env.JWT_SECRET as string;
    const accessToken = jwt.sign({ sub: "user-123", tokenVersion: 0 }, secret, {
      audience: "ocrecipes-client",
      issuer: "ocrecipes-api",
      expiresIn: "7d",
    });
    expect(verifyVerificationToken(accessToken)).toBeNull();
  });

  it("rejects a tampered token", () => {
    const token = signVerificationToken("user-123", "a@b.com");
    expect(verifyVerificationToken(token.slice(0, -2) + "xx")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `npx vitest run server/lib/__tests__/verification-token.test.ts`
Expected: FAIL (`Cannot find module '../verification-token'`).

- [ ] **Step 4: Implement**

Create `server/lib/verification-token.ts`:

```ts
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}
const jwtSecret: string = JWT_SECRET;

// Same issuer as access tokens, but a DISTINCT audience — this partitions
// verification tokens from access tokens so neither can be used as the other,
// even though they share JWT_SECRET. The verify token also carries no
// tokenVersion, so it fails the access-token payload guard in requireAuth.
const VERIFY_ISSUER = "ocrecipes-api";
const VERIFY_AUDIENCE = "ocrecipes-email-verify";
const VERIFY_TTL = "24h";

export interface VerificationTokenPayload {
  sub: string;
  email: string;
  purpose: "email-verify";
}

export function signVerificationToken(userId: string, email: string): string {
  return jwt.sign({ email, purpose: "email-verify" }, jwtSecret, {
    subject: userId,
    audience: VERIFY_AUDIENCE,
    issuer: VERIFY_ISSUER,
    expiresIn: VERIFY_TTL,
  });
}

export function verifyVerificationToken(
  token: string,
): VerificationTokenPayload | null {
  try {
    const payload = jwt.verify(token, jwtSecret, {
      audience: VERIFY_AUDIENCE,
      issuer: VERIFY_ISSUER,
    });
    if (
      typeof payload === "object" &&
      payload !== null &&
      typeof payload.sub === "string" &&
      payload.sub.length > 0 &&
      typeof (payload as Record<string, unknown>).email === "string" &&
      (payload as Record<string, unknown>).purpose === "email-verify"
    ) {
      return {
        sub: payload.sub,
        email: (payload as { email: string }).email,
        purpose: "email-verify",
      };
    }
    return null;
  } catch {
    // Expired, wrong audience/issuer, or tampered — all collapse to null so
    // callers cannot distinguish failure modes.
    return null;
  }
}
```

- [ ] **Step 5: Run — verify pass**

Run: `npx vitest run server/lib/__tests__/verification-token.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add shared/constants/error-codes.ts server/lib/verification-token.ts server/lib/__tests__/verification-token.test.ts
git commit -m "feat(auth): add email-verify token lib + EMAIL_NOT_VERIFIED code"
```

---

### Task 2: Email config predicate + Resend service (no-op + per-recipient throttle)

**Files:**

- Create: `server/lib/email-config.ts`
- Create: `server/services/email.ts`
- Test: `server/services/__tests__/email.test.ts`
- Modify: `package.json` (add `resend`)

**Interfaces:**

- Produces: `emailVerificationEnabled(): boolean`; `sendVerificationEmail(to: string, token: string): Promise<void>`; `sendSignupAttemptNotice(to: string): Promise<void>`.

- [ ] **Step 1: Install the SDK**

Run: `npm install resend`
Expected: `resend` added to `dependencies`.

- [ ] **Step 2: Write `email-config.ts`** (no test of its own — exercised everywhere downstream)

Create `server/lib/email-config.ts`:

```ts
/**
 * Single source of truth for "is email verification enforced?".
 * Read live (not cached at module load) so tests can toggle it via stubEnv and
 * so a deploy can flip the gate by setting RESEND_API_KEY without a code change.
 * Placed in lib/ (lowest layer) so middleware AND services may import it.
 */
export function emailVerificationEnabled(): boolean {
  return Boolean(process.env.RESEND_API_KEY);
}
```

- [ ] **Step 3: Write the failing test**

Create `server/services/__tests__/email.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSend = vi
  .fn()
  .mockResolvedValue({ data: { id: "mock" }, error: null });
vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(() => ({ emails: { send: mockSend } })),
}));

describe("email service", () => {
  beforeEach(() => {
    mockSend.mockClear();
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is a no-op when RESEND_API_KEY is absent", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { sendVerificationEmail } = await import("../email");
    await sendVerificationEmail("a@b.com", "tok");
    expect(mockSend).not.toHaveBeenCalled();
  });

  it("sends a verification email when configured", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { sendVerificationEmail } = await import("../email");
    await sendVerificationEmail("a@b.com", "tok123");
    expect(mockSend).toHaveBeenCalledTimes(1);
    const arg = mockSend.mock.calls[0][0];
    expect(arg.to).toBe("a@b.com");
    expect(arg.html).toContain("verify-email?token=tok123");
  });

  it("throttles to at most 5 sends per recipient", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { sendVerificationEmail } = await import("../email");
    for (let i = 0; i < 7; i++) await sendVerificationEmail("c@d.com", "t");
    expect(mockSend).toHaveBeenCalledTimes(5);
  });
});
```

- [ ] **Step 4: Run — verify it fails**

Run: `npx vitest run server/services/__tests__/email.test.ts`
Expected: FAIL (`Cannot find module '../email'`).

- [ ] **Step 5: Implement the service**

Create `server/services/email.ts`:

```ts
import { Resend } from "resend";
import { emailVerificationEnabled } from "../lib/email-config";
import { createServiceLogger, toError } from "../lib/logger";

const logger = createServiceLogger("email");

const APP_URL = process.env.EMAIL_VERIFY_BASE_URL ?? "https://ocrecipes.app";
const EMAIL_FROM =
  process.env.EMAIL_FROM ?? "OCRecipes <noreply@ocrecipes.app>";

// In-service per-recipient throttle. The signup-attempt notice has no endpoint
// of its own, so the per-IP register limiter cannot cap how many emails a
// victim's inbox receives. This sliding window is THE per-recipient cap for all
// outbound mail (notice + verification), regardless of entry point.
const RECIPIENT_WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_RECIPIENT = 5;
const recipientSends = new Map<string, number[]>();

function canSendTo(email: string): boolean {
  const now = Date.now();
  const key = email.toLowerCase();
  const times = (recipientSends.get(key) ?? []).filter(
    (t) => now - t < RECIPIENT_WINDOW_MS,
  );
  if (times.length >= MAX_PER_RECIPIENT) {
    recipientSends.set(key, times);
    return false;
  }
  times.push(now);
  recipientSends.set(key, times);
  return true;
}

function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  return key ? new Resend(key) : null;
}

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to)) {
    logger.warn({ to }, "verification email throttled (per-recipient cap)");
    return;
  }
  const url = `${APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Verify your email for OCRecipes",
    html: `<p>Welcome to OCRecipes! Confirm your email to finish setting up your account.</p>
<p><a href="${url}">Verify my email</a></p>
<p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`,
  });
  if (error) logger.error({ err: toError(error) }, "verification email failed");
}

export async function sendSignupAttemptNotice(to: string): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to)) {
    logger.warn({ to }, "signup-attempt notice throttled (per-recipient cap)");
    return;
  }
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Someone tried to sign up with your email",
    html: `<p>Someone just tried to create an OCRecipes account with this email address, but you already have one.</p>
<p>If this was you, simply <a href="${APP_URL}">log in</a> instead. If it wasn't, no action is needed — no account was created.</p>`,
  });
  if (error)
    logger.error({ err: toError(error) }, "signup-attempt notice failed");
}
```

- [ ] **Step 6: Run — verify pass**

Run: `npx vitest run server/services/__tests__/email.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json server/lib/email-config.ts server/services/email.ts server/services/__tests__/email.test.ts
git commit -m "feat(auth): add Resend email service with no-op guard + per-recipient throttle"
```

---

### Task 3: `markEmailVerified` storage function

**Files:**

- Modify: `server/storage/users.ts` (after `updateUser`, ~line 118)
- Modify: `server/storage/index.ts` (add to the `storage` object)

**Interfaces:**

- Produces: `storage.markEmailVerified(id: string): Promise<SafeUser | undefined>` — idempotent (sets `emailVerified = true`).

- [ ] **Step 1: Add the function**

In `server/storage/users.ts`, after `updateUser`:

```ts
/**
 * Idempotently mark a user's email as verified. Returns the updated SafeUser,
 * or undefined if no user matches. `emailVerified` is intentionally NOT in
 * UpdatableUserFields (the general update whitelist) — verification is a
 * dedicated, single-purpose mutation, not a client-settable profile field.
 */
export async function markEmailVerified(
  id: string,
): Promise<SafeUser | undefined> {
  const [user] = await db
    .update(users)
    .set({ emailVerified: true })
    .where(eq(users.id, id))
    .returning(safeUserColumns);
  return user || undefined;
}
```

- [ ] **Step 2: Wire it into the barrel**

In `server/storage/index.ts`, inside the `export const storage = { ... }` object, next to the other `users.*` entries (e.g. after `getUserByEmail`), add:

```ts
  markEmailVerified: users.markEmailVerified,
```

- [ ] **Step 3: Verify it surfaces + types pass**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i markEmailVerified || echo "OK: no type errors for markEmailVerified"`
Expected: `OK: no type errors for markEmailVerified` (the function is exercised by the verify-endpoint tests in Task 7).

- [ ] **Step 4: Commit**

```bash
git add server/storage/users.ts server/storage/index.ts
git commit -m "feat(auth): add storage.markEmailVerified"
```

---

### Task 4: Access-token `emailVerified` claim + `requireAuth` guard

**Files:**

- Modify: `server/lib/jwt-types.ts`
- Modify: `server/middleware/auth.ts` (`generateToken` ~line 153; `requireAuth` ~line 113)
- Test: `server/middleware/__tests__/email-verified-gate.test.ts`

**Interfaces:**

- Consumes: `emailVerificationEnabled()` (Task 2).
- Produces: `generateToken(userId: string, tokenVersion: number, emailVerified: boolean): string`.

- [ ] **Step 1: Widen the payload type**

In `server/lib/jwt-types.ts`, add to `AccessTokenPayload`:

```ts
  emailVerified?: boolean; // present on tokens minted after the verification feature shipped
```

- [ ] **Step 2: Write the failing test**

Create `server/middleware/__tests__/email-verified-gate.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import jwt from "jsonwebtoken";

vi.mock("../../storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "u1", tokenVersion: 0 }),
  },
}));

function makeReqRes(token: string) {
  const req = { headers: { authorization: `Bearer ${token}` } } as never;
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(c: number) {
      (this as { statusCode: number }).statusCode = c;
      return this;
    },
    json(b: unknown) {
      (this as { body: unknown }).body = b;
      return this;
    },
  };
  return { req, res };
}

describe("requireAuth email-verified gate", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a present-and-false emailVerified claim when verification is ON", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { requireAuth } = await import("../auth");
    const token = jwt.sign(
      { sub: "u1", tokenVersion: 0, emailVerified: false },
      process.env.JWT_SECRET as string,
      {
        issuer: "ocrecipes-api",
        audience: "ocrecipes-client",
        expiresIn: "7d",
      },
    );
    const { req, res } = makeReqRes(token);
    const next = vi.fn();
    await requireAuth(req, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect((res.body as { code: string }).code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("allows a present-and-false claim when verification is OFF (fail-open)", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const { requireAuth } = await import("../auth");
    const token = jwt.sign(
      { sub: "u1", tokenVersion: 0, emailVerified: false },
      process.env.JWT_SECRET as string,
      {
        issuer: "ocrecipes-api",
        audience: "ocrecipes-client",
        expiresIn: "7d",
      },
    );
    const { req, res } = makeReqRes(token);
    const next = vi.fn();
    await requireAuth(req, res as never, next);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run — verify it fails**

Run: `npx vitest run server/middleware/__tests__/email-verified-gate.test.ts`
Expected: FAIL (no 403 branch yet).

- [ ] **Step 4: Implement**

In `server/middleware/auth.ts`:

(a) Add the import near the top:

```ts
import { emailVerificationEnabled } from "../lib/email-config";
```

(b) In `requireAuth`, immediately AFTER the `isAccessTokenPayload(payload)` check (the block that returns `"Invalid token payload"`), insert:

```ts
// Defense-in-depth (spec §5): the real gate is login/register withholding
// tokens from unverified users, so this rarely fires. Gated on
// emailVerificationEnabled() to preserve fail-open. A claimless (pre-feature)
// token passes here — the one-time backfill is what verifies those users.
if (emailVerificationEnabled() && payload.emailVerified === false) {
  sendError(res, 403, "Email not verified", "EMAIL_NOT_VERIFIED");
  return;
}
```

(c) Change `generateToken` to:

```ts
export function generateToken(
  userId: string,
  tokenVersion: number,
  emailVerified: boolean,
): string {
  return jwt.sign({ sub: userId, tokenVersion, emailVerified }, jwtSecret, {
    expiresIn: "7d",
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
  });
}
```

- [ ] **Step 5: Run — verify pass**

Run: `npx vitest run server/middleware/__tests__/email-verified-gate.test.ts`
Expected: PASS (2 tests). (Callers of `generateToken` are updated in Tasks 5–6; expect a temporary type error there until then — do not commit until Task 6 if running `tsc` repo-wide.)

- [ ] **Step 6: Commit**

```bash
git add server/lib/jwt-types.ts server/middleware/auth.ts server/middleware/__tests__/email-verified-gate.test.ts
git commit -m "feat(auth): add emailVerified claim + fail-open requireAuth gate"
```

---

### Task 5: Login gate (403 `EMAIL_NOT_VERIFIED`, fail-open) + `generateToken` callsite

**Files:**

- Modify: `server/routes/auth.ts` (login handler ~line 167; import)
- Test: `server/routes/__tests__/auth.test.ts` (add cases)

**Interfaces:**

- Consumes: `emailVerificationEnabled()`, `generateToken(userId, tokenVersion, emailVerified)`.

- [ ] **Step 1a: Extend the mocks + default the flag OFF**

In `server/routes/__tests__/auth.test.ts`:

1. In the existing `vi.mock("../../storage", () => ({ storage: { … } }))` factory, add `markEmailVerified: vi.fn(),` (alongside `getUserByEmail`, which is already present).
2. At the TOP of the file (with the other `vi.mock` calls — they are hoisted), add:

```ts
import { emailVerificationEnabled } from "../../lib/email-config";
vi.mock("../../lib/email-config", () => ({
  emailVerificationEnabled: vi.fn(),
}));
// CRITICAL: the mocks MUST return resolved promises. The handlers call
// `fireAndForget(label, sendVerificationEmail(...))`, and fireAndForget does
// `promise.catch(...)`. A bare vi.fn() returns undefined → `undefined.catch()`
// throws synchronously inside the handler's try → 500 (not the 200 you assert).
vi.mock("../../services/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendSignupAttemptNotice: vi.fn().mockResolvedValue(undefined),
}));
```

3. **This project's Vitest config has no global `clearMocks`/`resetMocks`, so a `mockReturnValue` persists across tests.** Add an OFF default to the existing `beforeEach` in the `describe("Auth Routes")` block so every pre-existing test keeps the old behavior and only the new ON-tests opt in:

```ts
beforeEach(() => {
  app = createApp();
  vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
  vi.mocked(emailVerificationEnabled).mockReturnValue(false); // OFF default
});
```

- [ ] **Step 1b: Write the failing login tests**

Add inside the `describe("POST /api/auth/login", …)` block, mirroring the existing tests' dynamic-import bcrypt pattern (`await import("bcrypt")`, rounds 10):

```ts
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
  expect(res.body.token).toBe("mock-jwt-token"); // generateToken is mocked by the __mocks__/auth manual mock
});
```

> `createMockUser` (from `../../__tests__/factories`) returns the full `@shared/schema` User including `password`; `request`, `vi`, `storage` are already imported in the file.

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run server/routes/__tests__/auth.test.ts -t "EMAIL_NOT_VERIFIED"`
Expected: FAIL.

- [ ] **Step 3: Implement**

In `server/routes/auth.ts`, add imports:

```ts
import { emailVerificationEnabled } from "../lib/email-config";
import { signVerificationToken } from "../lib/verification-token";
import {
  sendVerificationEmail,
  sendSignupAttemptNotice,
} from "../services/email";
```

In the login handler, replace the success block (currently `const token = generateToken(user.id.toString(), user.tokenVersion);` + `res.json(...)`) with:

```ts
if (emailVerificationEnabled() && !user.emailVerified) {
  // Reachable only AFTER correct credentials → not an enumeration oracle.
  return sendError(
    res,
    403,
    "Email not verified",
    ErrorCode.EMAIL_NOT_VERIFIED,
  );
}

const token = generateToken(
  user.id.toString(),
  user.tokenVersion,
  user.emailVerified,
);

res.json({ user: serializeUser(user), token });
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/routes/__tests__/auth.test.ts -t "verification"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts server/routes/__tests__/auth.test.ts
git commit -m "feat(auth): gate login on verified email (fail-open)"
```

---

### Task 6: Register rewrite — 3-branch anti-enumeration, no token, fire-and-forget

**Files:**

- Modify: `server/routes/auth.ts` (register handler, lines 62–134)
- Test: `server/routes/__tests__/auth.test.ts`

**Interfaces:**

- Consumes: `emailVerificationEnabled`, `signVerificationToken`, `sendVerificationEmail`, `sendSignupAttemptNotice`, `fireAndForget`.

- [ ] **Step 1: Write the failing tests**

Add to `server/routes/__tests__/auth.test.ts`:

```ts
import {
  sendVerificationEmail,
  sendSignupAttemptNotice,
} from "../../services/email";

it("new email → neutral check-inbox, no token, verification email sent", async () => {
  vi.mocked(emailVerificationEnabled).mockReturnValue(true);
  vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
  vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
  vi.mocked(storage.createUser).mockResolvedValue(
    createMockUser({ id: "new1", email: "new@x.com" }),
  );
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      username: "newbie",
      password: "pw12pw12",
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
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      username: "other",
      password: "pw12pw12",
      email: "dup@x.com",
      ageConfirmed: true,
    });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("verification_pending");
  expect(storage.createUser).not.toHaveBeenCalled();
  expect(sendVerificationEmail).toHaveBeenCalled();
  expect(sendSignupAttemptNotice).not.toHaveBeenCalled();
});

it("existing VERIFIED email → identical neutral 200, owner notice, no createUser", async () => {
  vi.mocked(emailVerificationEnabled).mockReturnValue(true);
  vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
  vi.mocked(storage.getUserByEmail).mockResolvedValue(
    createMockUser({ id: "old2", emailVerified: true }),
  );
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      username: "other2",
      password: "pw12pw12",
      email: "taken@x.com",
      ageConfirmed: true,
    });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("verification_pending");
  expect(storage.createUser).not.toHaveBeenCalled();
  expect(sendSignupAttemptNotice).toHaveBeenCalled();
  expect(sendVerificationEmail).not.toHaveBeenCalled();
});

it("username taken → 409 (checked before email)", async () => {
  vi.mocked(emailVerificationEnabled).mockReturnValue(true);
  vi.mocked(storage.getUserByUsername).mockResolvedValue(
    createMockUser({ id: "u" }),
  );
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      username: "taken",
      password: "pw12pw12",
      email: "x@x.com",
      ageConfirmed: true,
    });
  expect(res.status).toBe(409);
});

it("verification OFF → old behavior: auto-login with token", async () => {
  vi.mocked(emailVerificationEnabled).mockReturnValue(false);
  vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
  vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
  vi.mocked(storage.createUser).mockResolvedValue(createMockUser({ id: "n2" }));
  const res = await request(app)
    .post("/api/auth/register")
    .send({
      username: "newb2",
      password: "pw12pw12",
      email: "n2@x.com",
      ageConfirmed: true,
    });
  expect(res.status).toBe(201);
  expect(res.body.token).toBeTruthy();
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run server/routes/__tests__/auth.test.ts -t "neutral check-inbox"`
Expected: FAIL.

- [ ] **Step 3: Implement the register rewrite**

In `server/routes/auth.ts`, add a small helper above `register(app)`:

```ts
function sendVerificationPending(res: Response): void {
  // Content-free neutral response — identical for new / existing-unverified /
  // existing-verified signups so the registrant cannot enumerate emails.
  res
    .status(200)
    .json({
      status: "verification_pending",
      message: "Check your inbox to verify your email.",
    });
}
```

Replace the body of the `/api/auth/register` handler (after the `registerSchema.safeParse` validation block) with the **unified** version below. It keeps the original unique-violation race handling intact (so the existing race tests at `auth.test.ts:124,145` still pass under the OFF default) and lets the `verificationOn` flag change ONLY the email-collision response and the post-create step:

```ts
const { username, password, email } = parsed.data;
const verificationOn = emailVerificationEnabled();

// Username uniqueness FIRST — keeps the existing 409. This is the only
// signup response that is NOT the neutral check-inbox (spec §6a).
const existingUser = await storage.getUserByUsername(username);
if (existingUser) {
  return sendError(res, 409, "Username already exists", ErrorCode.CONFLICT);
}

const existingEmail = await storage.getUserByEmail(email);
if (existingEmail) {
  if (!verificationOn) {
    // Fail-open: pre-feature behavior (explicit 409, no anti-enum).
    return sendError(res, 409, "Email already registered", ErrorCode.CONFLICT);
  }
  // Verification ON: anti-enumeration. Same neutral response either way;
  // NEVER create an account and NEVER touch the existing password.
  if (!existingEmail.emailVerified) {
    // Unverified retry → help them finish, don't alarm them.
    fireAndForget(
      "resend-verification-on-reregister",
      sendVerificationEmail(
        email,
        signVerificationToken(existingEmail.id, email),
      ),
    );
  } else {
    fireAndForget("signup-attempt-notice", sendSignupAttemptNotice(email));
  }
  return sendVerificationPending(res);
}

const hashedPassword = await bcrypt.hash(password, 12);
let user;
try {
  user = await storage.createUser({
    username,
    password: hashedPassword,
    email,
  });
} catch (err) {
  // Catch unique-violation from a concurrent registration (unchanged).
  if (isUniqueViolation(err)) {
    const constraint = uniqueViolationConstraint(err);
    if (constraint?.includes("email")) {
      // Email-constraint race: ON → neutral (no existence leak);
      // OFF → original explicit message.
      return verificationOn
        ? sendVerificationPending(res)
        : sendError(res, 409, "Email already registered", ErrorCode.CONFLICT);
    }
    return sendError(res, 409, "Username already exists", ErrorCode.CONFLICT);
  }
  throw err;
}

if (verificationOn) {
  fireAndForget(
    "send-verification-email",
    sendVerificationEmail(email, signVerificationToken(user.id, email)),
  );
  return sendVerificationPending(res);
}

// Fail-open: pre-feature auto-login (201 + token).
const token = generateToken(
  user.id.toString(),
  user.tokenVersion,
  user.emailVerified,
);
return res.status(201).json({ user: serializeUser(user), token });
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run server/routes/__tests__/auth.test.ts`
Expected: PASS (all register + login cases). Update/remove any pre-existing register test that asserted the old `409 "Email already registered"` or a token on register WHEN verification is on — those behaviors moved; keep the OFF-path assertions.

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts server/routes/__tests__/auth.test.ts
git commit -m "feat(auth): anti-enumeration register flow with email verification"
```

---

### Task 7: `POST /verify-email` endpoint

**Files:**

- Modify: `server/routes/_schemas.ts`, `server/routes/_rate-limiters.ts`, `server/routes/auth.ts`
- Test: `server/routes/__tests__/auth.test.ts`

**Interfaces:**

- Consumes: `verifyVerificationToken`, `storage.markEmailVerified`, `verifyEmailLimiter`, `verifyEmailSchema`.

- [ ] **Step 1: Add schema + limiter**

In `server/routes/_schemas.ts`:

```ts
export const verifyEmailSchema = z.object({
  token: z.string().min(1, "Token is required").max(2000),
});

export const resendVerificationSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address")
    .max(254),
});
```

In `server/routes/_rate-limiters.ts` (in the Auth section):

```ts
// Unauthenticated; does a JWT-verify + DB write per call — IP-keyed guard.
export const verifyEmailLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many verification attempts, please try again later",
  keyByUser: false,
});

export const resendVerificationLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: "Too many resend requests, please try again later",
  keyByUser: false,
});
```

- [ ] **Step 2: Write the failing tests**

Add to `auth.test.ts` (note: `signVerificationToken` is imported from `../../lib/verification-token`):

```ts
import { signVerificationToken } from "../../lib/verification-token";

it("verifies a valid token, flips emailVerified, issues NO token", async () => {
  vi.mocked(storage.markEmailVerified).mockResolvedValue(
    createMockUser({ emailVerified: true }),
  );
  const token = signVerificationToken("u1", "a@b.com");
  const res = await request(app).post("/api/auth/verify-email").send({ token });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("verified");
  expect(res.body.token).toBeUndefined();
  expect(storage.markEmailVerified).toHaveBeenCalledWith("u1");
});

it("rejects a garbage token with 400", async () => {
  const res = await request(app)
    .post("/api/auth/verify-email")
    .send({ token: "not-a-jwt" });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 3: Run — verify it fails**

Run: `npx vitest run server/routes/__tests__/auth.test.ts -t "verifies a valid token"`
Expected: FAIL (route 404s).

- [ ] **Step 4: Implement the endpoint**

In `server/routes/auth.ts` add imports for `verifyEmailLimiter`, `resendVerificationLimiter` (from `_rate-limiters`), `verifyEmailSchema`, `resendVerificationSchema` (from `_schemas`), and `verifyVerificationToken` (from `../lib/verification-token`). Then add inside `register(app)`:

```ts
app.post(
  "/api/auth/verify-email",
  verifyEmailLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = verifyEmailSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          400,
          formatZodError(parsed.error),
          ErrorCode.VALIDATION_ERROR,
        );
        return;
      }
      const payload = verifyVerificationToken(parsed.data.token);
      if (!payload) {
        return sendError(
          res,
          400,
          "Invalid or expired verification link",
          ErrorCode.VALIDATION_ERROR,
        );
      }
      // Idempotent (already-verified is a harmless no-op). NO access token is
      // issued — verification proves email ownership, not password possession.
      const user = await storage.markEmailVerified(payload.sub);
      if (!user) {
        return sendError(
          res,
          400,
          "Invalid or expired verification link",
          ErrorCode.VALIDATION_ERROR,
        );
      }
      res.status(200).json({ status: "verified" });
    } catch (error) {
      handleRouteError(res, error, "verify email");
    }
  },
);
```

- [ ] **Step 5: Run — verify pass**

Run: `npx vitest run server/routes/__tests__/auth.test.ts -t "verif"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/routes/_schemas.ts server/routes/_rate-limiters.ts server/routes/auth.ts server/routes/__tests__/auth.test.ts
git commit -m "feat(auth): POST /verify-email endpoint"
```

---

### Task 8: `POST /resend-verification` endpoint

**Files:**

- Modify: `server/routes/auth.ts`
- Test: `server/routes/__tests__/auth.test.ts`

**Interfaces:**

- Consumes: `resendVerificationLimiter`, `resendVerificationSchema`, `storage.getUserByEmail`, `signVerificationToken`, `sendVerificationEmail`.

- [ ] **Step 1: Write the failing tests**

```ts
it("resend: always neutral 200; sends only when account exists + unverified", async () => {
  vi.mocked(storage.getUserByEmail).mockResolvedValue(
    createMockUser({ id: "u9", emailVerified: false }),
  );
  const res = await request(app)
    .post("/api/auth/resend-verification")
    .send({ email: "u9@x.com" });
  expect(res.status).toBe(200);
  expect(sendVerificationEmail).toHaveBeenCalled();
});

it("resend: neutral 200 even when the email has no account (no oracle)", async () => {
  vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
  const res = await request(app)
    .post("/api/auth/resend-verification")
    .send({ email: "ghost@x.com" });
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("verification_pending");
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run server/routes/__tests__/auth.test.ts -t "resend"`
Expected: FAIL (404).

- [ ] **Step 3: Implement**

In `server/routes/auth.ts`, inside `register(app)`:

```ts
app.post(
  "/api/auth/resend-verification",
  resendVerificationLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = resendVerificationSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          400,
          formatZodError(parsed.error),
          ErrorCode.VALIDATION_ERROR,
        );
        return;
      }
      const { email } = parsed.data;
      // Always neutral (anti-enumeration). Only actually send for an existing,
      // still-unverified account; the per-recipient throttle in email.ts caps abuse.
      const user = await storage.getUserByEmail(email);
      if (user && !user.emailVerified) {
        fireAndForget(
          "resend-verification",
          sendVerificationEmail(email, signVerificationToken(user.id, email)),
        );
      }
      res
        .status(200)
        .json({
          status: "verification_pending",
          message: "If that account needs verification, we've sent a new link.",
        });
    } catch (error) {
      handleRouteError(res, error, "resend verification");
    }
  },
);
```

- [ ] **Step 4: Run — verify pass + full auth suite**

Run: `npx vitest run server/routes/__tests__/auth.test.ts`
Expected: PASS (whole file).

- [ ] **Step 5: Commit**

```bash
git add server/routes/auth.ts server/routes/__tests__/auth.test.ts
git commit -m "feat(auth): POST /resend-verification endpoint"
```

---

## PHASE B — Client

### Task 9: `register` contract change + `EMAIL_NOT_VERIFIED` code

**Files:**

- Modify: `shared/types/auth.ts`, `client/hooks/useAuth.ts`, `client/context/AuthContext.tsx`
- Test: `client/hooks/__tests__/useAuth.test.ts` (create if absent — see note)

**Interfaces:**

- Produces: `register(...) => Promise<{ status: "authenticated"; user: User } | { status: "verification_pending" }>`.

- [ ] **Step 1: Widen the error-code union**

In `shared/types/auth.ts`, change the `ApiError.code` union to include the new code:

```ts
  code?: "TOKEN_EXPIRED" | "TOKEN_INVALID" | "TOKEN_REVOKED" | "NO_TOKEN" | "EMAIL_NOT_VERIFIED";
```

- [ ] **Step 2: Update `register` in `useAuth.ts`**

Replace the `register` callback body with:

```ts
const register = useCallback(
  async (
    username: string,
    password: string,
    email: string,
    ageConfirmed: boolean,
  ): Promise<
    { status: "authenticated"; user: User } | { status: "verification_pending" }
  > => {
    const response = await apiRequest("POST", "/api/auth/register", {
      username,
      password,
      email,
      ageConfirmed,
    });
    const data = await response.json();
    // Verification OFF (fail-open) → server returns a token → auto-login.
    if (data.token) {
      await tokenStorage.set(data.token);
      await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data.user));
      setState({ user: data.user, isLoading: false, isAuthenticated: true });
      registerPushToken().catch(() => {});
      return { status: "authenticated", user: data.user };
    }
    // Verification ON → no token; caller routes to the verify screen.
    return { status: "verification_pending" };
  },
  [],
);
```

- [ ] **Step 3: Update the `AuthContextType` in `AuthContext.tsx`**

```ts
register: (
  username: string,
  password: string,
  email: string,
  ageConfirmed: boolean,
) =>
  Promise<
    { status: "authenticated"; user: User } | { status: "verification_pending" }
  >;
```

- [ ] **Step 4: Add the verification-pending test + verify existing register tests still pass**

The existing `client/hooks/__tests__/useAuth.test.ts` register tests do NOT regress:

- `:388` "stores token, caches user, sets authenticated" mocks a response WITH a token → hits the new `data.token` branch → old behavior. ✓
- `:665` "propagates API errors" → `apiRequest` rejects before `.json()` → still throws. ✓

Add ONE new test in the `describe("register", …)` block for the new no-token path:

```ts
it("does NOT authenticate when the server returns verification_pending (no token)", async () => {
  mockTokenStorage.get.mockResolvedValue(null);
  mockApiRequest.mockResolvedValue({
    json: () => Promise.resolve({ status: "verification_pending" }),
  });
  const { result } = renderHook(() => useAuth());
  await waitFor(() => expect(result.current.isLoading).toBe(false));

  let res: { status: string } | undefined;
  await act(async () => {
    res = await result.current.register(
      "newuser",
      "password456",
      "new@example.com",
      true,
    );
  });

  expect(res).toEqual({ status: "verification_pending" });
  expect(mockTokenStorage.set).not.toHaveBeenCalled();
  expect(result.current.isAuthenticated).toBe(false);
});
```

- [ ] **Step 5: Fix the typed mock in `AuthContext.test.ts`**

`client/context/__tests__/AuthContext.test.ts:91` defines a fake `register: async (_u, _p) => ({}) as unknown as User`. The new `AuthContextType.register` return type makes that cast a type error. Run `npx tsc --noEmit 2>&1 | grep AuthContext`; if it flags line 91, change that mock to return the union shape:

```ts
        register: async () => ({ status: "verification_pending" }) as const,
```

- [ ] **Step 6: Type-check + run the client auth tests**

Run: `npx tsc --noEmit 2>&1 | grep -E "useAuth|AuthContext" || echo "OK"; npx vitest run client/hooks/__tests__/useAuth.test.ts client/context/__tests__/AuthContext.test.ts`
Expected: `OK` for the grep (a LoginScreen error is expected until Task 11) and PASS for both test files.

- [ ] **Step 7: Commit**

```bash
git add shared/types/auth.ts client/hooks/useAuth.ts client/context/AuthContext.tsx client/hooks/__tests__/useAuth.test.ts client/context/__tests__/AuthContext.test.ts
git commit -m "feat(auth): register returns verification-pending result (no auto-login)"
```

---

### Task 10: `VerifyEmailScreen` (pending + confirm modes)

**Files:**

- Create: `client/screens/VerifyEmailScreen-utils.ts`, `client/screens/VerifyEmailScreen.tsx`
- Test: `client/screens/__tests__/VerifyEmailScreen-utils.test.ts`

**Interfaces:**

- Consumes: `apiRequest`. Route params: `{ token?: string; email?: string }`.
- Produces: `verifyEmailRequest(token: string): Promise<void>`; `resendVerificationRequest(email: string): Promise<void>`; `isValidEmailShape(email: string): boolean`.

- [ ] **Step 1: Write the failing util test**

Create `client/screens/__tests__/VerifyEmailScreen-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { isValidEmailShape } from "../VerifyEmailScreen-utils";

describe("VerifyEmailScreen-utils", () => {
  it("accepts a well-formed email", () => {
    expect(isValidEmailShape("a@b.com")).toBe(true);
  });
  it("rejects malformed input", () => {
    expect(isValidEmailShape("nope")).toBe(false);
    expect(isValidEmailShape("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run client/screens/__tests__/VerifyEmailScreen-utils.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement the utils**

Create `client/screens/VerifyEmailScreen-utils.ts`:

```ts
import { apiRequest } from "@/lib/query-client";

// Pragmatic client mirror; the server re-validates with zero trust.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailShape(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export async function verifyEmailRequest(token: string): Promise<void> {
  await apiRequest("POST", "/api/auth/verify-email", { token });
}

export async function resendVerificationRequest(email: string): Promise<void> {
  await apiRequest("POST", "/api/auth/resend-verification", {
    email: email.trim(),
  });
}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run client/screens/__tests__/VerifyEmailScreen-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the screen**

Create `client/screens/VerifyEmailScreen.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  isValidEmailShape,
  verifyEmailRequest,
  resendVerificationRequest,
} from "./VerifyEmailScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "VerifyEmail">;

type Status = "confirming" | "confirmed" | "failed" | "pending";

export default function VerifyEmailScreen({ route, navigation }: Props) {
  const { theme } = useTheme();
  const tokenParam = route.params?.token;
  const [status, setStatus] = useState<Status>(
    tokenParam ? "confirming" : "pending",
  );
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Confirm flow: a deep link delivered a token → verify it on mount.
  useEffect(() => {
    if (!tokenParam) return;
    let cancelled = false;
    (async () => {
      try {
        await verifyEmailRequest(tokenParam);
        if (!cancelled) setStatus("confirmed");
      } catch {
        if (!cancelled) setStatus("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tokenParam]);

  const onResend = async () => {
    setError("");
    if (!isValidEmailShape(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      await resendVerificationRequest(email);
      setError("");
      setStatus("pending");
    } catch {
      // Resend is always neutral server-side; only a network error lands here.
      setError("Couldn't resend right now. Please try again shortly.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.content}>
        {status === "confirming" ? (
          <ThemedText type="h2">Verifying your email…</ThemedText>
        ) : status === "confirmed" ? (
          <>
            <ThemedText type="h2">Email verified ✓</ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              You can now sign in.
            </ThemedText>
            <Button
              onPress={() => navigation.navigate("Login")}
              style={styles.button}
            >
              Back to sign in
            </Button>
          </>
        ) : status === "failed" ? (
          <>
            <ThemedText type="h2">Link expired or invalid</ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              Enter your email and we'll send a fresh link.
            </ThemedText>
            <TextInput
              leftIcon="mail"
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              testID="input-resend-email"
            />
            <InlineError message={error} />
            <Button onPress={onResend} loading={busy} style={styles.button}>
              Resend verification email
            </Button>
          </>
        ) : (
          <>
            <ThemedText type="h2">Check your inbox</ThemedText>
            <ThemedText type="body" style={{ color: theme.textSecondary }}>
              We've sent a verification link{email ? ` to ${email}` : ""}. Click
              it to finish setting up your account.
            </ThemedText>
            <TextInput
              leftIcon="mail"
              placeholder="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              testID="input-resend-email"
            />
            <InlineError message={error} />
            <Button onPress={onResend} loading={busy} style={styles.button}>
              Resend email
            </Button>
          </>
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: Spacing["2xl"],
    gap: Spacing.lg,
  },
  button: { marginTop: Spacing.sm },
});
```

> The confirmed-state "Back to sign in" calls `navigation.navigate("Login")` — verify issues NO token, so the user must be routed explicitly. `checkAuth()` alone would NOT move them (`isAuthenticated` stays false → they'd be stranded on VerifyEmail). The verify screen and Login share the unauthenticated stack (wired in Task 11). This also covers the cold-start deep-link case: a user who taps the link with the app closed lands on VerifyEmail and reaches Login via this button.

- [ ] **Step 6: Commit**

```bash
git add client/screens/VerifyEmailScreen.tsx client/screens/VerifyEmailScreen-utils.ts client/screens/__tests__/VerifyEmailScreen-utils.test.ts
git commit -m "feat(auth): VerifyEmailScreen (confirm + pending/resend)"
```

---

### Task 11: Wire LoginScreen + navigation + deep linking

**Files:**

- Modify: `client/screens/LoginScreen.tsx`
- Modify: `client/navigation/RootStackNavigator.tsx`
- Modify: `client/navigation/linking.ts`
- Test: `client/screens/__tests__/LoginScreen.test.tsx` (extend existing)

**Interfaces:**

- Consumes: `register` discriminated result (Task 9); `ApiError` from `@/lib/api-error`.

- [ ] **Step 1: Register the route in the param list + navigator**

In `client/navigation/RootStackNavigator.tsx`:

(a) Add the import:

```ts
import VerifyEmailScreen from "@/screens/VerifyEmailScreen";
```

(b) Add to `RootStackParamList` (near `Login: undefined;`):

```ts
  VerifyEmail: { token?: string; email?: string } | undefined;
```

(c) In the `!isAuthenticated` branch, wrap Login + VerifyEmail in a fragment so both are reachable pre-auth and via deep link:

```tsx
      {!isAuthenticated ? (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="VerifyEmail" component={VerifyEmailScreen} options={{ headerShown: false }} />
        </>
      ) : needsOnboarding ? (
```

> Keep the existing `options` you find on the current `Login` screen; mirror them. Known minor gap (spec §11/§12): a deep link tapped while already authenticated won't resolve `VerifyEmail` — acceptable, since the hard gate means an authenticated user is already verified.

- [ ] **Step 2: Add the deep-link path**

In `client/navigation/linking.ts`, add inside `config.screens` (sibling of `Scan`):

```ts
      VerifyEmail: "verify-email",
```

> React Navigation maps the `?token=…` query string to `route.params.token` automatically when the path has no positional params.

- [ ] **Step 3: Write the failing LoginScreen test**

Extend `client/screens/__tests__/LoginScreen.test.tsx` (it already renders the screen with mocked auth + navigation). Add:

```tsx
it("navigates to VerifyEmail after a verification-pending registration", async () => {
  mockRegister.mockResolvedValue({ status: "verification_pending" });
  // ...render, switch to register mode, fill valid fields, submit...
  await waitFor(() =>
    expect(mockNavigate).toHaveBeenCalledWith("VerifyEmail", {
      email: "new@x.com",
    }),
  );
});

it("navigates to VerifyEmail when login returns EMAIL_NOT_VERIFIED", async () => {
  mockLogin.mockRejectedValue(new ApiError("403: ...", "EMAIL_NOT_VERIFIED"));
  // ...render in login mode, fill fields, submit...
  await waitFor(() =>
    expect(mockNavigate).toHaveBeenCalledWith("VerifyEmail", {}),
  );
});
```

> Match the existing test's mocking style (how `useAuthContext` and `useNavigation` are mocked). `ApiError` imports from `@/lib/api-error`.

- [ ] **Step 4: Run — verify it fails**

Run: `npx vitest run client/screens/__tests__/LoginScreen.test.tsx -t "VerifyEmail"`
Expected: FAIL.

- [ ] **Step 5: Implement the LoginScreen wiring**

In `client/screens/LoginScreen.tsx`:

(a) Add imports:

```ts
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { ApiError } from "@/lib/api-error";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
```

(b) Inside the component:

```ts
const navigation =
  useNavigation<NativeStackNavigationProp<RootStackParamList>>();
```

(c) Replace the `try { … } catch { … }` inside `handleSubmit` with:

```ts
try {
  if (mode === "login") {
    await login(username.trim(), password);
    haptics.notification(Haptics.NotificationFeedbackType.Success);
  } else {
    const result = await register(
      username.trim(),
      password,
      email.trim(),
      ageConfirmed,
    );
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    if (result.status === "verification_pending") {
      navigation.navigate("VerifyEmail", { email: email.trim() });
    }
  }
} catch (err) {
  if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
    // Valid credentials, unverified email → route to the verify screen
    // (login path has no email to prefill).
    navigation.navigate("VerifyEmail", {});
    return;
  }
  setError(getAuthErrorMessage(err, mode));
  haptics.notification(Haptics.NotificationFeedbackType.Error);
} finally {
  setIsLoading(false);
}
```

- [ ] **Step 6: Run — verify pass**

Run: `npx vitest run client/screens/__tests__/LoginScreen.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/screens/LoginScreen.tsx client/navigation/RootStackNavigator.tsx client/navigation/linking.ts client/screens/__tests__/LoginScreen.test.tsx
git commit -m "feat(auth): wire verify-email screen into login flow + deep linking"
```

---

## PHASE C — Ops & safe rollout

### Task 12: Seed safety + env docs + backfill runbook

**Files:**

- Modify: `server/scripts/seed-recipes.ts:241`
- Modify: `docs/DEV_SETUP.md`

- [ ] **Step 1: Make the demo account pre-verified**

In `server/scripts/seed-recipes.ts`, in the demo `users` insert `.values({ … })`, add:

```ts
      emailVerified: true,
```

> Belt-and-suspenders with fail-open: even if `RESEND_API_KEY` is set in a dev/test env, `demo/demo123` is never gated.

- [ ] **Step 2: Document env + the gate-flip runbook**

In `docs/DEV_SETUP.md`, add an "Email verification (Resend)" section:

````markdown
## Email verification (Resend)

Email verification is OFF unless `RESEND_API_KEY` is set (fail-open). Secrets —
no `EXPO_PUBLIC_` prefix:

- `RESEND_API_KEY` — Resend API key. Absent → verification disabled (login/register
  behave as before). Present → hard gate ON.
- `EMAIL_FROM` — e.g. `OCRecipes <noreply@ocrecipes.app>` (verified sending domain).
- `EMAIL_VERIFY_BASE_URL` — optional; defaults to `https://ocrecipes.app`. The
  verification link is `${EMAIL_VERIFY_BASE_URL}/verify-email?token=…`.

### Turning the gate ON in prod (sequenced — see spec §9)

1. Deploy the feature with `RESEND_API_KEY` UNSET → gate stays off; nothing changes
   for users.
2. Configure Resend; verify the sending domain's SPF / DKIM / DMARC. **Also confirm
   the `https://ocrecipes.app/verify-email` universal link opens the APP, not the
   website** — i.e. the iOS `apple-app-site-association` (AASA) and Android
   `assetlinks.json` served at the domain cover the `/verify-email` path, and the app's
   `associatedDomains` / intent filters are set (native config lives in the gitignored
   `ios/` / `android/`). If they don't, the email link opens a browser instead of
   `VerifyEmailScreen`, and the only path to verify is the in-app resend.
3. **Immediately before flipping**, backfill existing users so they aren't locked out
   (point-in-time — re-run right before step 4 to catch gate-off-window signups):

   ```bash
   railway run --service Postgres -- sh -c 'psql "$DATABASE_PUBLIC_URL" -c "UPDATE users SET email_verified = true WHERE email_verified = false;"'
   ```
````

4. Set `RESEND_API_KEY` in the Railway service env → the gate is now ON. New signups
   must verify; existing users are grandfathered by step 3.

> Accepted cost once ON: login availability is coupled to Resend uptime; a failed
> send strands a new user until resend succeeds. Verify the resend path works end to end.

````

- [ ] **Step 3: Commit**

```bash
git add server/scripts/seed-recipes.ts docs/DEV_SETUP.md
git commit -m "chore(auth): pre-verify demo seed + document Resend env and gate-flip runbook"
````

---

## Self-Review (completed by plan author)

**Spec coverage** (spec §→task): §2 token → T1; §2 fail-open predicate → T2; §4 email service/throttle → T2; §4 markEmailVerified → T3; §5 claim+requireAuth → T4; §6/§6a/§7 register branches → T6; login gate → T5; §8 verify endpoint (no token) → T7; §4 resend → T8; client register contract → T9; VerifyEmailScreen → T10; nav/linking/login wiring → T11; §9 seed+env+backfill → T12. Anti-enum holes: timing (fireAndForget) T6/T8; email-bomb (throttle) T2; residual username 409 T6. No spec section is unmapped.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; test steps contain real assertions. Two explicit "match the existing harness" notes (useAuth render test, LoginScreen mocks) point at concrete existing files rather than hand-waving new infrastructure.

**Type consistency:** `generateToken(userId, tokenVersion, emailVerified)` defined T4, called T5 + T6 (OFF-path) with 3 args; `markEmailVerified` defined T3, mocked T5–T8, called T7; `signVerificationToken(userId, email)` / `verifyVerificationToken(token)` defined T1, used T6/T7/T8; `register` return type defined T9, consumed T11; `VerifyEmail` param shape `{ token?; email? }` consistent across T10/T11.

---

## Execution Handoff

This plan is **auth/security work → NEVER-DELEGATE**. Both standard execution sub-skills dispatch subagents or batch through tasks; given the never-delegate constraint, the intended mode is **inline, hand-implemented by the primary engineer**, task-by-task, with the full Vitest suite + `tsc` + lint gate run before each commit and the whole `server/routes/__tests__/auth.test.ts` re-run after Tasks 5–8.
