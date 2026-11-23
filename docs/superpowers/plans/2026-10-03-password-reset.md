# Password Reset and Sign-In by Email — Implementation Plan

> **STATUS: SHIPPED — history, not instructions.** Checked 2026-11-22: the files this plan creates are on `main`. The current code and `docs/OWNER_RULINGS.md` win over anything below.

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). **Do NOT use subagent-driven-development for this plan.** Auth is a hard-exclusion path in this repo (`server/routes/auth.ts`, never delegated), so every task is implemented inline in the main session, and only the final _review_ is dispatched. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user who forgot their password reset it with a 6-digit emailed code, and let any user sign in with their email instead of their username.

**Architecture:** One live code per account, stored as an HMAC on five nullable or defaulted `users` columns. Every check (expiry, the 5-guess cap, the 6-per-24 h issuance cap) runs as one atomic SQL predicate on the database clock. Two new public endpoints (`forgot-password`, `reset-password`) give uniform answers whether or not the account exists. Two new logged-out screens reuse the existing design-system primitives.

**Tech Stack:** Express 5, Drizzle ORM / PostgreSQL, express-rate-limit, bcrypt, Node `crypto`, Resend; Expo / React Native with React Navigation native-stack; Vitest + Supertest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-03-password-reset-design.md` (read it alongside this plan; §-references below point into it).

## Global Constraints

- Code: 6 digits, `crypto.randomInt(0, 1_000_000)` zero-padded; lifetime **15 minutes**; **5** guesses per code; **6** codes per account per rolling **24 h**.
- Code storage: HMAC-SHA256 hex of `` `${userId}:${code}` `` keyed with `HMAC-SHA256(JWT_SECRET, "password-reset-code:v1")`. Never stored or logged in plain form.
- All expiry/window math happens in SQL against `now()`; both timestamps are `timestamp with time zone`.
- Limits: forgot-password **10 / 15 min per IP**, **3 / hour per email**; reset-password **20 / 15 min per IP**, **10 / 15 min per email**. Email keys go through the existing `normalizeUsernameKey`, falling back to the IP key.
- Email buckets: `"general"` 5/hour (unchanged), `"account-security"` 10/hour (reset code + password-changed notice).
- Uniform failure for reset-password: `400 { error: "That code is incorrect or expired.", code: "INVALID_RESET_CODE" }`.
- Neutral forgot-password body: `200 { status: "reset_code_sent", message: "If an account uses that email, we've sent a 6-digit code. It expires in 15 minutes." }`.
- Success: no token issued; `token_version + 1` **and** `invalidateTokenVersionCache`; `email_verified = true`; `pending_email = NULL`.
- Login keeps the body field name `username`; a value containing `@` is an email.
- Support contact copy: `support@ocrecipes.app`.
- Password rule unchanged: min 8, max 200, at least one letter and one digit.
- UI: only `ThemedView`, `ThemedText`, `TextInput`, `Button`, `InlineError`, `KeyboardAwareScrollViewCompat`, `useToast`; colors from `useTheme()` (`theme.link` for text links, `theme.accentSolid` for fills), never raw hex; `Spacing` / `BorderRadius` tokens.
- Implementation inline only; review roster `code-reviewer` + `security-auditor` + `server-reviewer` + `mobile-reviewer`; **never auto-merged**.
- Commit messages are written with the Write tool to the scratchpad and committed with `git commit -F <file>`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD per task: run only the task's own test files (`npx vitest run <paths>`). The full suite runs in CI and in the push hook, not ad hoc.

## Deliberate deviations from the spec (decided while planning; tell the owner)

1. **§5.3 shared password fragment.** On the server, the rule becomes one exported `newPasswordSchema` in `server/routes/_schemas.ts`, used by register and reset. The client keeps its **hand-synced mirror** (`LoginScreen-utils.ts`), now exported as `validateNewPassword` and reused by the reset screen. Reason: repo convention, set by `docs/solutions/logic-errors/client-mirror-server-validation-signup-email-trap-2026-06-18.md` and restated in `shared/constants/email-patterns.ts`, is that client validators are deliberately independent mirrors, not shared literals.
2. **§5.1 headers.** The two new screens use `headerShown: false` with an in-screen ghost **"Back to sign in"** button, exactly like `VerifyEmailScreen`, instead of a native header with a static title. Reason: the owner's design-system requirement (§5.2) asks for visual continuity with Login and VerifyEmail, which are both headerless. The iOS swipe-back gesture still works.
3. **Constants module.** The numeric limits live in `shared/constants/password-reset.ts` (no env access), so `server/storage/users.ts` and the client can import them without pulling in the `JWT_SECRET` check.

## Review Focus

1. **A legacy row whose stored email isn't lowercase** (`Alice@Example.com`). Forgot, reset, and login-by-email must still find it, so every new email lookup compares `lower(email) = lower($1)`. Pinned in Task 3 (`getUserByEmailForAuth` + `reservePasswordResetAttempt` with a mixed-case stored row).
2. **An email with surrounding spaces or capitals typed into forgot or reset** (`"  Foo@X.com "`) must reach the same rate-limit bucket and the same account as `foo@x.com`. Pinned in Task 6 (limiter key test) and Task 5 (schema normalization).
3. **A code pasted or autofilled with spaces or a dash** (`"123 456"`, `"123-456"`) must be accepted; the client strips non-digits before submit. Pinned in Task 9 (`normalizeResetCode`).
4. **The user enters the older of two codes** after requesting a second one. Rejected with the uniform message. Pinned in Task 3 (new issue kills the old code) and Task 6 (route returns the uniform 400).
5. **The keyboard hiding the confirm field or the Reset button** on a small iPhone. The Reset screen scrolls via `KeyboardAwareScrollViewCompat`. Pinned in Task 12 (verify-ui on the smallest available simulator, keyboard up).

---

## File Map

| File                                           | Status               | Responsibility                                                                                                                                                        |
| ---------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `migrations/0015_users_password_reset.sql`     | Create               | Adds the five columns (applied by hand before merge)                                                                                                                  |
| `shared/schema.ts`                             | Modify (users table) | Column definitions                                                                                                                                                    |
| `shared/constants/password-reset.ts`           | Create               | Numeric limits shared by server storage, routes, and client                                                                                                           |
| `shared/constants/error-codes.ts`              | Modify               | `INVALID_RESET_CODE`                                                                                                                                                  |
| `server/lib/password-reset-code.ts`            | Create               | Generate, HMAC, constant-time compare (pure)                                                                                                                          |
| `server/lib/html-escape.ts`                    | Create               | `escapeHtml`                                                                                                                                                          |
| `server/storage/users.ts`                      | Modify               | SafeUser exclusion; `getUserByEmailForAuth`, `issuePasswordResetCode`, `reservePasswordResetAttempt`, `completePasswordReset`; clear code at both email-commit points |
| `server/storage/index.ts`                      | Modify               | Expose the four new functions                                                                                                                                         |
| `server/services/email.ts`                     | Modify               | Buckets; `sendPasswordResetCode`, `sendPasswordChangedNotice`; signup notice gains username                                                                           |
| `server/routes/_schemas.ts`                    | Modify               | `newPasswordSchema`, `forgotPasswordSchema`, `resetPasswordSchema`; `loginSchema` widened                                                                             |
| `server/routes/_rate-limiters.ts`              | Modify               | Four new limiters                                                                                                                                                     |
| `server/routes/auth.ts`                        | Modify               | Two new routes; login by email + dummy compare; register passes username to the notice                                                                                |
| `client/screens/LoginScreen-utils.ts`          | Modify               | Export `validateNewPassword`                                                                                                                                          |
| `client/screens/ForgotPasswordScreen-utils.ts` | Create               | Request helper, error classification                                                                                                                                  |
| `client/screens/ResetPasswordScreen-utils.ts`  | Create               | Code normalization, form validation, error copy, cooldown math, request helper                                                                                        |
| `client/screens/ForgotPasswordScreen.tsx`      | Create               | Screen                                                                                                                                                                |
| `client/screens/ResetPasswordScreen.tsx`       | Create               | Screen                                                                                                                                                                |
| `client/screens/LoginScreen.tsx`               | Modify               | "Username or email", "Forgot password?" link, prefill + toast from params                                                                                             |
| `client/navigation/RootStackNavigator.tsx`     | Modify               | Param types + two logged-out screens                                                                                                                                  |
| Tests                                          | Create/Modify        | Listed per task                                                                                                                                                       |

---

### Task 1: Schema columns, migration, constants, SafeUser exclusion

**Files:**

- Create: `migrations/0015_users_password_reset.sql`
- Create: `shared/constants/password-reset.ts`
- Modify: `shared/schema.ts` (users table, after `tokenVersion`)
- Modify: `server/storage/users.ts:38-43`
- Test: `server/storage/__tests__/users-password-reset.test.ts` (new)

**Interfaces:**

- Produces: `users.resetCodeHash: string | null`, `users.resetCodeExpiresAt: Date | null`, `users.resetCodeAttempts: number`, `users.resetIssueCount: number`, `users.resetIssueWindowStart: Date | null`. Constants `RESET_CODE_LENGTH = 6`, `RESET_CODE_TTL_MINUTES = 15`, `RESET_CODE_MAX_ATTEMPTS = 5`, `RESET_CODE_DAILY_ISSUE_CAP = 6`, `RESET_RESEND_COOLDOWN_SECONDS = 60`. `SafeUser` no longer carries the five keys.

- [ ] **Step 1: Write the constants module**

`shared/constants/password-reset.ts`:

```ts
/**
 * Password-reset limits shared by the server (storage predicates, routes) and
 * the client (code input length, resend cooldown). Pure constants — no env
 * access — so storage and the client can import them freely.
 * Spec: docs/superpowers/specs/2026-10-03-password-reset-design.md
 */
export const RESET_CODE_LENGTH = 6;
export const RESET_CODE_TTL_MINUTES = 15;
/** Guesses allowed against one issued code before it stops working. */
export const RESET_CODE_MAX_ATTEMPTS = 5;
/** Codes one account can be issued per rolling 24 h (durable, in the DB). */
export const RESET_CODE_DAILY_ISSUE_CAP = 6;
export const RESET_RESEND_COOLDOWN_SECONDS = 60;
```

- [ ] **Step 2: Add the columns to `shared/schema.ts`** (directly after `tokenVersion: …`):

```ts
    /**
     * Password reset (emailed 6-digit code). HMAC-SHA256 hex of `userId:code`
     * keyed from JWT_SECRET (server/lib/password-reset-code.ts); NULL = no live
     * code. One live code per account: issuing overwrites, a reset or a
     * committed email change clears. NEVER returned by SafeUser.
     */
    resetCodeHash: text("reset_code_hash"),
    /** Written as now() + 15 min IN SQL — compared against now() in SQL only. */
    resetCodeExpiresAt: timestamp("reset_code_expires_at", {
      withTimezone: true,
    }),
    /** Guesses (failed + in-flight) against the current code; cap 5. */
    resetCodeAttempts: integer("reset_code_attempts").default(0).notNull(),
    /** Codes issued in the current 24 h window — the durable issuance cap. */
    resetIssueCount: integer("reset_issue_count").default(0).notNull(),
    /** Start of that window; NULL = no window open. */
    resetIssueWindowStart: timestamp("reset_issue_window_start", {
      withTimezone: true,
    }),
```

- [ ] **Step 3: Write the migration** `migrations/0015_users_password_reset.sql`:

```sql
-- users.reset_code_* / reset_issue_*: password reset by emailed 6-digit code
-- (todos/P1-2026-09-26-no-password-reset-or-account-recovery.md; spec
-- docs/superpowers/specs/2026-10-03-password-reset-design.md §3).
--
-- reset_code_hash is an HMAC (never the code); NULL = no live code. Both
-- timestamps are timestamptz and are only ever written/compared in SQL
-- against now(), so the 15-minute window cannot drift with a session TZ.
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle reads and writes these columns on login (getUserByEmailForAuth
-- selects the full row) and on both reset routes. The old running bundle
-- never touches them (Drizzle selects named columns), so applying early is
-- safe. Additive only: nullable or NOT NULL DEFAULT 0, no backfill.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reset_code_hash text,
  ADD COLUMN IF NOT EXISTS reset_code_expires_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS reset_code_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reset_issue_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reset_issue_window_start timestamp with time zone;
```

- [ ] **Step 4: Apply it to the local dev/test DB**

Run: `psql postgresql://localhost/nutricam -f migrations/0015_users_password_reset.sql`
Expected: `ALTER TABLE`

- [ ] **Step 5: Write the failing SafeUser test**

Create `server/storage/__tests__/users-password-reset.test.ts`:

```ts
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { sql, eq } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { users } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const users_ = await import("../users");

const RESET_KEYS = [
  "resetCodeHash",
  "resetCodeExpiresAt",
  "resetCodeAttempts",
  "resetIssueCount",
  "resetIssueWindowStart",
] as const;

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("password reset storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  describe("SafeUser never carries reset columns", () => {
    it("getUser omits all five reset keys", async () => {
      const u = await users_.getUser(testUser.id);
      for (const key of RESET_KEYS) expect(u).not.toHaveProperty(key);
    });
    it("getUserByEmail omits all five reset keys", async () => {
      const u = await users_.getUserByEmail(testUser.email);
      for (const key of RESET_KEYS) expect(u).not.toHaveProperty(key);
    });
  });
});
```

- [ ] **Step 6: Run it, expect FAIL**

Run: `npx vitest run server/storage/__tests__/users-password-reset.test.ts`
Expected: FAIL — `expected {...} not to have property "resetCodeHash"`.

- [ ] **Step 7: Exclude the columns** in `server/storage/users.ts` (replace lines 38–43):

```ts
// Exclude password AND the password-reset columns from default queries —
// defense-in-depth against accidental leaks. Only the *ForAuth getters return
// the password hash. The REAL guard for HTTP responses is response shaping
// (serializeUser / explicit picks in routes); full-row paths (createUser,
// updateUser .returning(), *ForAuth) still carry these columns — never strip
// them here instead of shaping the response.
const {
  password: _password,
  resetCodeHash: _resetCodeHash,
  resetCodeExpiresAt: _resetCodeExpiresAt,
  resetCodeAttempts: _resetCodeAttempts,
  resetIssueCount: _resetIssueCount,
  resetIssueWindowStart: _resetIssueWindowStart,
  ...safeUserColumns
} = getTableColumns(users);

type ResetColumnKey =
  | "resetCodeHash"
  | "resetCodeExpiresAt"
  | "resetCodeAttempts"
  | "resetIssueCount"
  | "resetIssueWindowStart";

/** User row without password hash or password-reset state */
export type SafeUser = Omit<User, "password" | ResetColumnKey>;
```

- [ ] **Step 8: Run it, expect PASS**

Run: `npx vitest run server/storage/__tests__/users-password-reset.test.ts`
Expected: 2 passed.

- [ ] **Step 9: Check the type blast radius of `SafeUser`**

Use the LSP tool: `findReferences` on `SafeUser` in `server/storage/users.ts` (hover first to warm the server). Any consumer that reads one of the five keys from a `SafeUser` is a compile error to fix by switching it to `User`. Expected: none read them.

- [ ] **Step 10: Commit**

Message file text:

```
feat(auth): add password-reset columns and keep them out of SafeUser

Five nullable/defaulted users columns for the emailed reset code (HMAC,
expiry, attempts, durable 24 h issuance window). Migration 0015 is
additive and must be applied before merge.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

Run: `git add migrations/0015_users_password_reset.sql shared/constants/password-reset.ts shared/schema.ts server/storage/users.ts server/storage/__tests__/users-password-reset.test.ts && git commit -F <scratchpad>/commit-msg-reset-t1.txt`

---

### Task 2: Pure helpers — reset-code crypto and HTML escaping

**Files:**

- Create: `server/lib/password-reset-code.ts`, `server/lib/html-escape.ts`
- Test: `server/lib/__tests__/password-reset-code.test.ts`, `server/lib/__tests__/html-escape.test.ts`

**Interfaces:**

- Produces: `generateResetCode(): string`, `hashResetCode(userId: string, code: string): string`, `resetCodeMatches(userId: string, code: string, storedHash: string): boolean`, `DUMMY_RESET_USER_ID: string`, `DUMMY_RESET_HASH: string`, `escapeHtml(value: string): string`.

- [ ] **Step 1: Write the failing tests**

`server/lib/__tests__/password-reset-code.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  generateResetCode,
  hashResetCode,
  resetCodeMatches,
  DUMMY_RESET_HASH,
} from "../password-reset-code";

describe("password-reset-code", () => {
  afterEach(() => vi.restoreAllMocks());

  it("generates exactly 6 digits", () => {
    for (let i = 0; i < 200; i++)
      expect(generateResetCode()).toMatch(/^\d{6}$/);
  });

  it("zero-pads small values", () => {
    vi.spyOn(crypto, "randomInt").mockImplementation(() => 42);
    expect(generateResetCode()).toBe("000042");
  });

  it("hash is deterministic per user+code and 64 hex chars", () => {
    const a = hashResetCode("user-1", "123456");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(hashResetCode("user-1", "123456")).toBe(a);
  });

  it("the same code hashes differently for different users", () => {
    expect(hashResetCode("user-1", "123456")).not.toBe(
      hashResetCode("user-2", "123456"),
    );
  });

  it("is keyed — not a plain SHA-256 of the input", () => {
    const plain = crypto
      .createHash("sha256")
      .update("user-1:123456")
      .digest("hex");
    expect(hashResetCode("user-1", "123456")).not.toBe(plain);
  });

  it("matches the right code and rejects a wrong one", () => {
    const stored = hashResetCode("user-1", "123456");
    expect(resetCodeMatches("user-1", "123456", stored)).toBe(true);
    expect(resetCodeMatches("user-1", "654321", stored)).toBe(false);
    expect(resetCodeMatches("user-2", "123456", stored)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", () => {
    expect(resetCodeMatches("user-1", "123456", "")).toBe(false);
    expect(resetCodeMatches("user-1", "123456", "zz")).toBe(false);
    expect(resetCodeMatches("user-1", "123456", DUMMY_RESET_HASH)).toBe(false);
  });
});
```

`server/lib/__tests__/html-escape.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { escapeHtml } from "../html-escape";

describe("escapeHtml", () => {
  it("escapes all five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;",
    );
  });
  it("leaves plain text untouched", () => {
    expect(escapeHtml("alice_99")).toBe("alice_99");
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (modules missing)

Run: `npx vitest run server/lib/__tests__/password-reset-code.test.ts server/lib/__tests__/html-escape.test.ts`
Expected: FAIL — `Failed to resolve import "../password-reset-code"`.

- [ ] **Step 3: Implement**

`server/lib/password-reset-code.ts`:

```ts
import crypto from "node:crypto";
import { RESET_CODE_LENGTH } from "@shared/constants/password-reset";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required");
}

// Domain-separated subkey: the reset-code HMAC never shares a key with JWT
// signing even though both derive from JWT_SECRET. Rotating JWT_SECRET
// invalidates live codes (acceptable — they last 15 minutes). A plain SHA-256
// over a 10^6 code space is reversible from a DB leak in milliseconds; the
// keyed HMAC is not without the server secret.
const HMAC_KEY = crypto
  .createHmac("sha256", JWT_SECRET)
  .update("password-reset-code:v1")
  .digest();

/** Stand-in id for the unknown-account branch, so both branches do one HMAC. */
export const DUMMY_RESET_USER_ID = "00000000-0000-0000-0000-000000000000";
/** Stand-in stored hash for the unknown-account branch (never a real HMAC). */
export const DUMMY_RESET_HASH = "0".repeat(64);

export function generateResetCode(): string {
  return crypto
    .randomInt(0, 10 ** RESET_CODE_LENGTH)
    .toString()
    .padStart(RESET_CODE_LENGTH, "0");
}

export function hashResetCode(userId: string, code: string): string {
  return crypto
    .createHmac("sha256", HMAC_KEY)
    .update(`${userId}:${code}`)
    .digest("hex");
}

/** Constant-time comparison of a submitted code against the stored HMAC. */
export function resetCodeMatches(
  userId: string,
  code: string,
  storedHash: string,
): boolean {
  const expected = Buffer.from(hashResetCode(userId, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (stored.length !== expected.length) {
    // Burn the same compare cost, then fail — malformed input is never a match.
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, stored);
}
```

`server/lib/html-escape.ts`:

```ts
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escape a value for interpolation into an HTML email body or attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run server/lib/__tests__/password-reset-code.test.ts server/lib/__tests__/html-escape.test.ts`
Expected: 9 passed.

- [ ] **Step 5: Commit**

Message: `feat(auth): add reset-code HMAC helpers and an HTML escaper` + blank line + Co-Authored-By line.
Run: `git add server/lib/password-reset-code.ts server/lib/html-escape.ts server/lib/__tests__/password-reset-code.test.ts server/lib/__tests__/html-escape.test.ts && git commit -F <scratchpad>/commit-msg-reset-t2.txt`

---

### Task 3: Storage — issue, use up an attempt, complete, and clear on email commit

**Files:**

- Modify: `server/storage/users.ts` (imports; new functions after `getUserByUsernameForAuth`; `updateUserEmail`; `applyEmailVerification` branch 2)
- Modify: `server/storage/index.ts` (users section)
- Test: `server/storage/__tests__/users-password-reset.test.ts`

**Interfaces:**

- Consumes: Task 1 columns and constants; `hashResetCode` from Task 2 (tests only).
- Produces (all exported from `users.ts` and exposed on `storage`):
  - `getUserByEmailForAuth(email: string): Promise<User | undefined>` (matches `lower(email)`, never `pending_email`)
  - `issuePasswordResetCode(userId: string, codeHash: string): Promise<boolean>` (false = daily cap hit, nothing stored)
  - `reservePasswordResetAttempt(email: string): Promise<{ id: string; username: string; email: string; resetCodeHash: string } | undefined>`
  - `completePasswordReset(userId: string, matchedHash: string, newPasswordHash: string): Promise<boolean>`

- [ ] **Step 1: Write the failing tests** (append inside the top-level `describe` of `users-password-reset.test.ts`; add `import { hashResetCode } from "../../lib/password-reset-code";` at the top)

```ts
async function setWindowStart(id: string, ago: string) {
  await tx.execute(
    sql`UPDATE users SET reset_issue_window_start = now() - ${ago}::interval WHERE id = ${id}`,
  );
}
async function expireCode(id: string) {
  await tx.execute(
    sql`UPDATE users SET reset_code_expires_at = now() - interval '16 minutes' WHERE id = ${id}`,
  );
}
async function row(id: string) {
  const [r] = await tx.select().from(users).where(eq(users.id, id));
  return r;
}

describe("getUserByEmailForAuth", () => {
  it("matches case-insensitively, including a legacy mixed-case stored row", async () => {
    const legacy = await createTestUser(tx, {
      email: "Alice.Legacy@Example.com",
    });
    const found = await users_.getUserByEmailForAuth(
      "alice.legacy@example.com",
    );
    expect(found?.id).toBe(legacy.id);
    expect(found?.password).toBeDefined();
  });
  it("never matches a staged pending_email", async () => {
    await users_.stagePendingEmail(testUser.id, "staged-only@example.com");
    expect(
      await users_.getUserByEmailForAuth("staged-only@example.com"),
    ).toBeUndefined();
  });
});

describe("issuePasswordResetCode", () => {
  it("stores the hash with a ~15 min DB-clock expiry and zero attempts", async () => {
    const hash = hashResetCode(testUser.id, "123456");
    expect(await users_.issuePasswordResetCode(testUser.id, hash)).toBe(true);
    const r = await row(testUser.id);
    expect(r.resetCodeHash).toBe(hash);
    expect(r.resetCodeAttempts).toBe(0);
    const [{ live }] = (
      await tx.execute(
        sql`SELECT (reset_code_expires_at > now() + interval '14 minutes'
                  AND reset_code_expires_at <= now() + interval '15 minutes') AS live
              FROM users WHERE id = ${testUser.id}`,
      )
    ).rows as { live: boolean }[];
    expect(live).toBe(true);
  });

  it("a new issue overwrites the old code and resets attempts", async () => {
    await users_.issuePasswordResetCode(
      testUser.id,
      hashResetCode(testUser.id, "111111"),
    );
    await users_.reservePasswordResetAttempt(testUser.email);
    const second = hashResetCode(testUser.id, "222222");
    await users_.issuePasswordResetCode(testUser.id, second);
    const r = await row(testUser.id);
    expect(r.resetCodeHash).toBe(second);
    expect(r.resetCodeAttempts).toBe(0);
  });

  it("allows 6 issues per 24 h window and refuses the 7th without storing", async () => {
    for (let i = 0; i < 6; i++) {
      expect(
        await users_.issuePasswordResetCode(
          testUser.id,
          hashResetCode(testUser.id, `00000${i}`),
        ),
      ).toBe(true);
    }
    const seventh = hashResetCode(testUser.id, "999999");
    expect(await users_.issuePasswordResetCode(testUser.id, seventh)).toBe(
      false,
    );
    expect((await row(testUser.id)).resetCodeHash).not.toBe(seventh);
  });

  it("re-opens the window after 24 h", async () => {
    for (let i = 0; i < 6; i++) {
      await users_.issuePasswordResetCode(
        testUser.id,
        hashResetCode(testUser.id, `00000${i}`),
      );
    }
    await setWindowStart(testUser.id, "24 hours 1 second");
    expect(
      await users_.issuePasswordResetCode(
        testUser.id,
        hashResetCode(testUser.id, "777777"),
      ),
    ).toBe(true);
    expect((await row(testUser.id)).resetIssueCount).toBe(1);
  });
});

describe("reservePasswordResetAttempt", () => {
  beforeEach(async () => {
    await users_.issuePasswordResetCode(
      testUser.id,
      hashResetCode(testUser.id, "123456"),
    );
  });

  it("returns the row and increments attempts", async () => {
    const r = await users_.reservePasswordResetAttempt(
      testUser.email.toUpperCase(),
    );
    expect(r?.id).toBe(testUser.id);
    expect(r?.resetCodeHash).toBe(hashResetCode(testUser.id, "123456"));
    expect((await row(testUser.id)).resetCodeAttempts).toBe(1);
  });

  it("stops after 5 attempts (6th returns undefined)", async () => {
    for (let i = 0; i < 5; i++) {
      expect(
        await users_.reservePasswordResetAttempt(testUser.email),
      ).toBeDefined();
    }
    expect(
      await users_.reservePasswordResetAttempt(testUser.email),
    ).toBeUndefined();
    expect((await row(testUser.id)).resetCodeAttempts).toBe(5);
  });

  it("6 parallel attempts still cap at 5", async () => {
    // Same connection (test transaction) — proves the predicate, not lock
    // contention; atomicity across connections follows from it being one UPDATE.
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        users_.reservePasswordResetAttempt(testUser.email),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(5);
  });

  it("rejects an expired code", async () => {
    await expireCode(testUser.id);
    expect(
      await users_.reservePasswordResetAttempt(testUser.email),
    ).toBeUndefined();
  });

  it("returns undefined for an unknown email and for a pending_email", async () => {
    expect(
      await users_.reservePasswordResetAttempt("nobody@example.com"),
    ).toBeUndefined();
    await users_.stagePendingEmail(testUser.id, "pending@example.com");
    expect(
      await users_.reservePasswordResetAttempt("pending@example.com"),
    ).toBeUndefined();
  });

  it("matches a legacy mixed-case stored email", async () => {
    const legacy = await createTestUser(tx, { email: "Bob.Mixed@Example.com" });
    await users_.issuePasswordResetCode(
      legacy.id,
      hashResetCode(legacy.id, "123456"),
    );
    expect(
      (await users_.reservePasswordResetAttempt("bob.mixed@example.com"))?.id,
    ).toBe(legacy.id);
  });

  it.each(["America/Los_Angeles", "Asia/Tokyo"])(
    "expiry is correct with session time zone %s",
    async (zone) => {
      await tx.execute(sql.raw(`SET LOCAL TIME ZONE '${zone}'`));
      expect(
        await users_.reservePasswordResetAttempt(testUser.email),
      ).toBeDefined();
      await expireCode(testUser.id);
      expect(
        await users_.reservePasswordResetAttempt(testUser.email),
      ).toBeUndefined();
    },
  );
});

describe("completePasswordReset", () => {
  const matched = () => hashResetCode(testUser.id, "123456");
  beforeEach(async () => {
    await users_.issuePasswordResetCode(testUser.id, matched());
  });

  it("sets the password, bumps tokenVersion, verifies email, clears code and pending_email", async () => {
    await users_.stagePendingEmail(testUser.id, "attacker@example.com");
    const before = await row(testUser.id);
    expect(
      await users_.completePasswordReset(testUser.id, matched(), "new-hash"),
    ).toBe(true);
    const r = await row(testUser.id);
    expect(r.password).toBe("new-hash");
    expect(r.tokenVersion).toBe(before.tokenVersion + 1);
    expect(r.emailVerified).toBe(true);
    expect(r.pendingEmail).toBeNull();
    expect(r.resetCodeHash).toBeNull();
    expect(r.resetCodeExpiresAt).toBeNull();
    expect(r.resetCodeAttempts).toBe(0);
  });

  it("cancels a staged email change: the old change link then updates 0 rows", async () => {
    await users_.stagePendingEmail(testUser.id, "attacker@example.com");
    await users_.completePasswordReset(testUser.id, matched(), "new-hash");
    expect(
      await users_.applyEmailVerification(testUser.id, "attacker@example.com"),
    ).toBeUndefined();
    expect((await row(testUser.id)).email).toBe(testUser.email);
  });

  it("is single-use (second completion fails)", async () => {
    expect(
      await users_.completePasswordReset(testUser.id, matched(), "h1"),
    ).toBe(true);
    expect(
      await users_.completePasswordReset(testUser.id, matched(), "h2"),
    ).toBe(false);
  });

  it("fails when a newer code replaced the matched one", async () => {
    await users_.issuePasswordResetCode(
      testUser.id,
      hashResetCode(testUser.id, "654321"),
    );
    expect(
      await users_.completePasswordReset(testUser.id, matched(), "h"),
    ).toBe(false);
  });

  it("keeps the issuance counters (a reset does not refill the daily cap)", async () => {
    await users_.completePasswordReset(testUser.id, matched(), "h");
    expect((await row(testUser.id)).resetIssueCount).toBe(1);
  });
});

describe("email-change commit points kill a live code", () => {
  beforeEach(async () => {
    await users_.issuePasswordResetCode(
      testUser.id,
      hashResetCode(testUser.id, "123456"),
    );
  });

  it("applyEmailVerification branch 2 (commit staged change) clears the code", async () => {
    await users_.stagePendingEmail(testUser.id, "new-addr@example.com");
    await users_.applyEmailVerification(testUser.id, "new-addr@example.com");
    expect((await row(testUser.id)).resetCodeHash).toBeNull();
  });

  it("updateUserEmail (gate off) clears the code", async () => {
    await users_.updateUserEmail(testUser.id, "direct@example.com");
    expect((await row(testUser.id)).resetCodeHash).toBeNull();
  });

  it("stagePendingEmail does NOT clear the code", async () => {
    await users_.stagePendingEmail(testUser.id, "staged@example.com");
    expect((await row(testUser.id)).resetCodeHash).not.toBeNull();
  });

  it("applyEmailVerification branch 1 (re-verify same address) does NOT clear the code", async () => {
    await users_.applyEmailVerification(testUser.id, testUser.email);
    expect((await row(testUser.id)).resetCodeHash).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run server/storage/__tests__/users-password-reset.test.ts`
Expected: FAIL — `users_.getUserByEmailForAuth is not a function` (and similar).

- [ ] **Step 3: Implement in `server/storage/users.ts`**

Add `lt` to the `drizzle-orm` import, and add:

```ts
import {
  RESET_CODE_TTL_MINUTES,
  RESET_CODE_MAX_ATTEMPTS,
  RESET_CODE_DAILY_ISSUE_CAP,
} from "@shared/constants/password-reset";
```

After `getUserByUsernameForAuth`, add:

```ts
/**
 * Full user row by VERIFIED email (the `email` column), case-insensitive —
 * login-by-email and forgot-password. NEVER matches `pending_email`: a staged,
 * unproven address must not receive a reset code or sign anyone in.
 * lower() on both sides tolerates a legacy row stored mixed-case.
 */
export async function getUserByEmailForAuth(
  email: string,
): Promise<User | undefined> {
  const [user] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`);
  return user || undefined;
}

/** Column values that kill a live reset code (issuance counters untouched). */
const CLEARED_RESET_CODE = {
  resetCodeHash: null,
  resetCodeExpiresAt: null,
  resetCodeAttempts: 0,
} as const;

/**
 * Store a new reset code (overwriting any live one) IF the account is under
 * the durable issuance cap: RESET_CODE_DAILY_ISSUE_CAP codes per rolling 24 h.
 * One atomic UPDATE enforces the cap and writes the code, so it survives
 * deploys and concurrent requests. Expiry is computed on the DB clock.
 * Returns false when the cap is hit (nothing stored) — callers stay silent,
 * since only real accounts can hit it (surfacing it would leak existence).
 */
export async function issuePasswordResetCode(
  userId: string,
  codeHash: string,
): Promise<boolean> {
  const windowExpired = sql`(${users.resetIssueWindowStart} IS NULL OR ${users.resetIssueWindowStart} <= now() - interval '24 hours')`;
  const [row] = await db
    .update(users)
    .set({
      resetCodeHash: codeHash,
      resetCodeExpiresAt: sql`now() + (${RESET_CODE_TTL_MINUTES} * interval '1 minute')`,
      resetCodeAttempts: 0,
      resetIssueCount: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${users.resetIssueCount} + 1 END`,
      resetIssueWindowStart: sql`CASE WHEN ${windowExpired} THEN now() ELSE ${users.resetIssueWindowStart} END`,
    })
    .where(
      and(
        eq(users.id, userId),
        sql`(${windowExpired} OR ${users.resetIssueCount} < ${RESET_CODE_DAILY_ISSUE_CAP})`,
      ),
    )
    .returning({ id: users.id });
  return Boolean(row);
}

/**
 * Use up one guess against the live code for `email`, atomically. The SAME
 * statement runs for real and unknown emails (uniform work); concurrent
 * guesses serialize on the row lock, so attempts can never exceed the cap.
 * Returns the row's id/username/email and stored HMAC, or undefined when there
 * is no live, unexpired, under-cap code (or no such verified email).
 */
export async function reservePasswordResetAttempt(
  email: string,
): Promise<
  | { id: string; username: string; email: string; resetCodeHash: string }
  | undefined
> {
  const [row] = await db
    .update(users)
    .set({ resetCodeAttempts: sql`${users.resetCodeAttempts} + 1` })
    .where(
      and(
        sql`lower(${users.email}) = lower(${email})`,
        isNotNull(users.resetCodeHash),
        sql`${users.resetCodeExpiresAt} > now()`,
        lt(users.resetCodeAttempts, RESET_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({
      id: users.id,
      username: users.username,
      email: users.email,
      resetCodeHash: users.resetCodeHash,
    });
  if (!row?.resetCodeHash) return undefined;
  return { ...row, resetCodeHash: row.resetCodeHash };
}

/**
 * Commit a reset in ONE statement: new password hash, tokenVersion + 1 (the
 * caller MUST also invalidateTokenVersionCache), email verified (the code
 * proved inbox control), staged email change DISCARDED (an outstanding
 * change-email link is a 24 h JWT with no tokenVersion — clearing
 * pending_email makes applyEmailVerification's commit branch match nothing),
 * and the code cleared. Guarded on the matched hash so a code reissued in the
 * meantime is never consumed by mistake. Issuance counters are kept.
 */
export async function completePasswordReset(
  userId: string,
  matchedHash: string,
  newPasswordHash: string,
): Promise<boolean> {
  const [row] = await db
    .update(users)
    .set({
      password: newPasswordHash,
      tokenVersion: sql`${users.tokenVersion} + 1`,
      emailVerified: true,
      pendingEmail: null,
      ...CLEARED_RESET_CODE,
    })
    .where(and(eq(users.id, userId), eq(users.resetCodeHash, matchedHash)))
    .returning({ id: users.id });
  return Boolean(row);
}
```

In `updateUserEmail`, change the `.set(...)` to:

```ts
    .set({
      email: newEmail,
      emailVerified: false,
      pendingEmail: null,
      // The verified address changed: a reset code issued to the OLD address
      // must die here (spec §3).
      ...CLEARED_RESET_CODE,
    })
```

In `applyEmailVerification` **branch 2 only**, change the `.set(...)` to:

```ts
    .set({
      email: sql`${users.pendingEmail}`,
      emailVerified: true,
      pendingEmail: null,
      // Committing a change moves the verified address: kill any reset code
      // issued to the previous one (spec §3). Branch 1 (same address) keeps it.
      ...CLEARED_RESET_CODE,
    })
```

Move `CLEARED_RESET_CODE` above `updateUserEmail` if `updateUserEmail` appears earlier in the file than the new functions (it does, at ~line 204), so it is defined before use.

- [ ] **Step 4: Expose on the storage facade** — in `server/storage/index.ts`, after `getUserByUsernameForAuth: users.getUserByUsernameForAuth,`:

```ts
  getUserByEmailForAuth: users.getUserByEmailForAuth,
  issuePasswordResetCode: users.issuePasswordResetCode,
  reservePasswordResetAttempt: users.reservePasswordResetAttempt,
  completePasswordReset: users.completePasswordReset,
```

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run server/storage/__tests__/users-password-reset.test.ts server/storage/__tests__/users.test.ts`
Expected: all pass (the existing `users.test.ts` change-email tests still pass with the extra cleared columns).

- [ ] **Step 6: Commit**

Message: `feat(auth): storage for issuing, guessing, and completing a password reset` / body: `Atomic DB-clock predicates for the 15 min expiry, 5-guess cap and 6/24 h issuance cap; a completed reset discards any staged email change; both email-commit points kill a live code.` / Co-Authored-By line.
Run: `git add server/storage/users.ts server/storage/index.ts server/storage/__tests__/users-password-reset.test.ts && git commit -F <scratchpad>/commit-msg-reset-t3.txt`

---

### Task 4: Email service — security bucket and the two new emails

**Files:**

- Modify: `server/services/email.ts`
- Test: `server/services/__tests__/email.test.ts`

**Interfaces:**

- Consumes: `escapeHtml` (Task 2).
- Produces: `sendPasswordResetCode(to: string, code: string): Promise<void>`, `sendPasswordChangedNotice(to: string, username: string): Promise<void>`, `sendSignupAttemptNotice(to: string, username: string): Promise<void>` (signature gains `username`).

- [ ] **Step 1: Write the failing tests** (append inside `describe("email service", …)`)

```ts
describe("account-security bucket", () => {
  it("sends a reset code with the code in the body and a 15-minute note", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { sendPasswordResetCode } = await import("../email");
    await sendPasswordResetCode("r@x.com", "042917");
    const arg = mockSend.mock.calls[0][0];
    expect(arg.to).toBe("r@x.com");
    expect(arg.subject).toBe("Your OCRecipes password reset code");
    expect(arg.html).toContain("042917");
    expect(arg.html).toContain("15 minutes");
  });

  it("password-changed notice includes the escaped username and support address", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { sendPasswordChangedNotice } = await import("../email");
    await sendPasswordChangedNotice("r@x.com", "<b>alice</b>");
    const arg = mockSend.mock.calls[0][0];
    expect(arg.subject).toBe("Your OCRecipes password was changed");
    expect(arg.html).toContain("&lt;b&gt;alice&lt;/b&gt;");
    expect(arg.html).toContain("support@ocrecipes.app");
  });

  it("still sends a reset code and a notice after the general bucket is exhausted", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const {
      sendSignupAttemptNotice,
      sendPasswordResetCode,
      sendPasswordChangedNotice,
    } = await import("../email");
    for (let i = 0; i < 7; i++)
      await sendSignupAttemptNotice("v@x.com", "victim");
    expect(mockSend).toHaveBeenCalledTimes(5);
    mockSend.mockClear();
    await sendPasswordResetCode("v@x.com", "123456");
    await sendPasswordChangedNotice("v@x.com", "victim");
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("caps the account-security bucket at 10 per hour per recipient", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const { sendPasswordResetCode } = await import("../email");
    for (let i = 0; i < 12; i++)
      await sendPasswordResetCode("s@x.com", "123456");
    expect(mockSend).toHaveBeenCalledTimes(10);
  });

  it("never logs the code when a send fails", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    mockSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "bad", statusCode: 422 },
    });
    const { sendPasswordResetCode } = await import("../email");
    await sendPasswordResetCode("f@x.com", "918273");
    expect(JSON.stringify(mockLoggerError.mock.calls)).not.toContain("918273");
  });
});

it("signup-attempt notice includes the username and points at Forgot password", async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  const { sendSignupAttemptNotice } = await import("../email");
  await sendSignupAttemptNotice("n@x.com", "alice_99");
  const arg = mockSend.mock.calls[0][0];
  expect(arg.html).toContain("alice_99");
  expect(arg.html).toContain("Forgot password?");
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run server/services/__tests__/email.test.ts`
Expected: FAIL — `sendPasswordResetCode is not a function`; the signup-notice test fails on missing `alice_99`.

- [ ] **Step 3: Implement in `server/services/email.ts`**

Add `import { escapeHtml } from "../lib/html-escape";` and `import { RESET_CODE_TTL_MINUTES } from "@shared/constants/password-reset";`.

Replace the throttle constants and `canSendTo` with a bucketed version (the `"general"` key stays the bare lowercased email so the existing sweep test's `recipientSends.has("fresh@example.com")` still holds):

```ts
// Per-recipient throttle, in two buckets. "general" (signup notice +
// verification) is the original shared 5/hour cap. "account-security" (reset
// code + password-changed notice) is separate: register is limited per IP
// only, so anyone who knows an address could otherwise drain the shared
// bucket with signup notices and silently swallow a reset code or the
// security notice. The route + DB issuance caps keep this bucket well under 10.
type SendBucket = "general" | "account-security";
const BUCKET_CAPS: Record<SendBucket, number> = {
  general: 5,
  "account-security": 10,
};
const MAX_PER_RECIPIENT = BUCKET_CAPS.general;

function bucketKey(email: string, bucket: SendBucket): string {
  const lower = email.toLowerCase();
  return bucket === "general" ? lower : `${bucket}:${lower}`;
}

function canSendTo(email: string, bucket: SendBucket = "general"): boolean {
  const now = Date.now();
  if (recipientSends.size > RECIPIENT_SWEEP_THRESHOLD) sweepExpired(now);
  const key = bucketKey(email, bucket);
  const times = (recipientSends.get(key) ?? []).filter(
    (t) => now - t < RECIPIENT_WINDOW_MS,
  );
  if (times.length === 0) {
    recipientSends.delete(key);
  }
  if (times.length >= BUCKET_CAPS[bucket]) {
    recipientSends.set(key, times);
    return false;
  }
  times.push(now);
  recipientSends.set(key, times);
  return true;
}
```

(Keep `RECIPIENT_WINDOW_MS`, `RECIPIENT_SWEEP_THRESHOLD`, `recipientSends`, `sweepExpired` exactly as they are. If `MAX_PER_RECIPIENT` ends up unreferenced, delete it rather than leaving an unused const.)

Change `sendSignupAttemptNotice`:

```ts
export async function sendSignupAttemptNotice(
  to: string,
  username: string,
): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to)) {
    logger.warn({ to }, "signup-attempt notice throttled (per-recipient cap)");
    return;
  }
  const error = await sendWithRetry(resend, {
    from: EMAIL_FROM,
    to,
    subject: "Someone tried to sign up with your email",
    html: `<p>Someone just tried to create an OCRecipes account with this email address, but you already have one.</p>
<p>Your username is <strong>${escapeHtml(username)}</strong>. You can also sign in with this email address.</p>
<p>If this was you, simply <a href="${APP_URL}">log in</a> instead. Forgot your password? Use "Forgot password?" on the sign-in screen. If it wasn't you, no action is needed — no account was created.</p>`,
  });
  if (error)
    logger.error({ resendError: error }, "signup-attempt notice failed");
}
```

Add the two senders:

```ts
export async function sendPasswordResetCode(
  to: string,
  code: string,
): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to, "account-security")) {
    // Never log the code — only the recipient.
    logger.warn({ to }, "reset code throttled (account-security cap)");
    return;
  }
  const error = await sendWithRetry(resend, {
    from: EMAIL_FROM,
    to,
    subject: "Your OCRecipes password reset code",
    html: `<p>Use this code to reset your OCRecipes password:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${escapeHtml(code)}</p>
<p>It expires in ${RESET_CODE_TTL_MINUTES} minutes. If you requested more than one code, use the one in the most recent email.</p>
<p>If you didn't ask to reset your password, you can ignore this email — your password hasn't changed.</p>`,
  });
  if (error) logger.error({ resendError: error }, "reset code email failed");
}

export async function sendPasswordChangedNotice(
  to: string,
  username: string,
): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to, "account-security")) {
    logger.warn(
      { to },
      "password-changed notice throttled (account-security cap)",
    );
    return;
  }
  const error = await sendWithRetry(resend, {
    from: EMAIL_FROM,
    to,
    subject: "Your OCRecipes password was changed",
    html: `<p>The password for your OCRecipes account <strong>${escapeHtml(username)}</strong> was just changed, and every device was signed out.</p>
<p>If this was you, there's nothing else to do.</p>
<p>If this wasn't you, contact <a href="mailto:support@ocrecipes.app">support@ocrecipes.app</a> right away.</p>`,
  });
  if (error)
    logger.error({ resendError: error }, "password-changed notice failed");
}
```

- [ ] **Step 4: Update the existing call site so types compile** — in `server/routes/auth.ts` register handler, change `sendSignupAttemptNotice(email)` to `sendSignupAttemptNotice(email, existingEmail.username)`. (`existingEmail` is a `SafeUser`, which has `username`.) In `server/routes/__tests__/auth.test.ts`, update any `expect(sendSignupAttemptNotice).toHaveBeenCalledWith(<email>)` to also expect the username: find them with `grep -n "sendSignupAttemptNotice).toHaveBeenCalledWith" server/routes/__tests__/auth.test.ts`, and add the mock user's `username` as the second argument.

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run server/services/__tests__/email.test.ts server/routes/__tests__/auth.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

Message: `feat(auth): reset-code and password-changed emails on their own send bucket` / body: `The signup-attempt notice now names the username (related gap 2).` / Co-Authored-By line.
Run: `git add server/services/email.ts server/services/__tests__/email.test.ts server/routes/auth.ts server/routes/__tests__/auth.test.ts && git commit -F <scratchpad>/commit-msg-reset-t4.txt`

---

### Task 5: Schemas, error code, and limiters

**Files:**

- Modify: `server/routes/_schemas.ts`, `shared/constants/error-codes.ts`, `server/routes/_rate-limiters.ts`
- Test: `server/routes/__tests__/_schemas-password-reset.test.ts` (new), `server/routes/__tests__/_rate-limiters.test.ts`

**Interfaces:**

- Produces: `newPasswordSchema`, `forgotPasswordSchema` (`{ email }`), `resetPasswordSchema` (`{ email, code, newPassword }`), `loginSchema.username` widened to trimmed `max(254)`; `ErrorCode.INVALID_RESET_CODE`; limiters `forgotPasswordIpLimiter`, `forgotPasswordEmailLimiter`, `resetPasswordIpLimiter`, `resetPasswordEmailLimiter`; `passwordResetEmailKey(prefix: string): (req: Request) => string`.

- [ ] **Step 1: Write the failing schema tests** — `server/routes/__tests__/_schemas-password-reset.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
  loginSchema,
  registerSchema,
} from "../_schemas";

describe("password-reset schemas", () => {
  it("forgot: trims and lowercases the email", () => {
    expect(forgotPasswordSchema.parse({ email: "  Foo@X.com " }).email).toBe(
      "foo@x.com",
    );
  });
  it("forgot: rejects a non-email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(
      false,
    );
  });
  it("reset: accepts exactly 6 digits only", () => {
    const base = { email: "a@b.com", newPassword: "abcdefg1" };
    expect(
      resetPasswordSchema.safeParse({ ...base, code: "012345" }).success,
    ).toBe(true);
    for (const code of ["12345", "1234567", "12a456", "123 456"]) {
      expect(resetPasswordSchema.safeParse({ ...base, code }).success).toBe(
        false,
      );
    }
  });
  it("reset: applies the same password rule as register", () => {
    const base = { email: "a@b.com", code: "123456" };
    for (const pw of ["short1", "allletters", "12345678"]) {
      expect(
        resetPasswordSchema.safeParse({ ...base, newPassword: pw }).success,
      ).toBe(false);
      expect(
        registerSchema.safeParse({
          username: "abc",
          email: "a@b.com",
          password: pw,
        }).success,
      ).toBe(false);
    }
  });
  it("login: trims and allows an email-length identifier", () => {
    const long = `${"a".repeat(60)}@example.com`;
    expect(
      loginSchema.parse({ username: `  ${long} `, password: "x" }).username,
    ).toBe(long);
  });
});
```

- [ ] **Step 2: Write the failing limiter-key test** — append to `server/routes/__tests__/_rate-limiters.test.ts` (match its existing import style; add `passwordResetEmailKey` to the import from `../_rate-limiters`):

```ts
describe("passwordResetEmailKey", () => {
  const key = passwordResetEmailKey("forgot-email:");
  const req = (body: unknown) =>
    ({
      body,
      headers: {},
      ip: "203.0.113.9",
      socket: {},
    }) as unknown as import("express").Request;

  it("keys the Zod-normalized form: spacing/case variants share a bucket", () => {
    expect(key(req({ email: "  Foo@X.com " }))).toBe(
      key(req({ email: "foo@x.com" })),
    );
    expect(key(req({ email: "foo@x.com" }))).toBe("forgot-email:foo@x.com");
  });
  it("falls back to the IP key when no email is present", () => {
    expect(key(req({}))).toBe("203.0.113.9");
  });
});
```

- [ ] **Step 3: Run, expect FAIL**

Run: `npx vitest run server/routes/__tests__/_schemas-password-reset.test.ts server/routes/__tests__/_rate-limiters.test.ts`
Expected: FAIL — missing exports.

- [ ] **Step 4: Implement schemas** in `server/routes/_schemas.ts`:

Change `loginSchema`:

```ts
// Login validation schema - lighter than registration (no format rules, just
// bounds). `username` holds EITHER a username or an email (the route branches
// on "@"; usernames are ^[a-zA-Z0-9_]+$ so the two never collide). The field
// name is kept so installed app versions keep working. 254 = max email length.
export const loginSchema = z.object({
  username: z.string().trim().min(1, "Username is required").max(254),
  password: z.string().min(1, "Password is required").max(200),
});
```

Above `registerSchema`, add and use:

```ts
// The one server-side password rule — register AND reset. The client keeps a
// hand-synced mirror in client/screens/LoginScreen-utils.ts (validateNewPassword).
export const newPasswordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(200)
  .regex(
    /(?=.*[a-zA-Z])(?=.*\d)/,
    "Password must contain at least one letter and one number",
  );
```

In `registerSchema`, replace the inline `password: z.string()…regex(…)` with `password: newPasswordSchema,`.

At the end of the auth schemas, add:

```ts
// Normalized identically to registerSchema.email (trim + lowercase) so the
// per-email limiter key, the lookup, and the stored address agree.
const resetEmail = z
  .string()
  .trim()
  .toLowerCase()
  .email("Please enter a valid email address")
  .max(254);

export const forgotPasswordSchema = z.object({ email: resetEmail });

export const resetPasswordSchema = z.object({
  email: resetEmail,
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  newPassword: newPasswordSchema,
});
```

- [ ] **Step 5: Add the error code** in `shared/constants/error-codes.ts` after `EMAIL_NOT_VERIFIED`:

```ts
  /** Uniform reset-password failure: wrong, expired, used-up, or no code — never says which. */
  INVALID_RESET_CODE: "INVALID_RESET_CODE",
```

- [ ] **Step 6: Implement limiters** in `server/routes/_rate-limiters.ts`, after `changeEmailLimiter`:

```ts
// --- Password reset (spec §4.1–4.2) ---
// Email-keyed limiters run BEFORE any account lookup, so a 429 is identical
// for real and unknown addresses (not an existence oracle) and the client may
// show it honestly. Route middleware → they also run before Zod validation,
// so malformed requests count against them too (intended).

/** Key on the normalized body email (same trim+lowercase as Zod), else IP. */
export function passwordResetEmailKey(prefix: string) {
  return (req: Request): string => {
    const email = normalizeUsernameKey(
      (req.body as { email?: unknown } | undefined)?.email,
    );
    return email ? `${prefix}${email}` : ipKeyGenerator(req);
  };
}

export const forgotPasswordIpLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many password reset requests, please try again later",
  keyByUser: false,
});

export const forgotPasswordEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: resolveRateLimitMax(3, process.env),
  message: {
    error: "Too many code requests for this email. Try again in an hour.",
    code: "RATE_LIMITED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: passwordResetEmailKey("forgot-email:"),
});

export const resetPasswordIpLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many password reset attempts, please try again later",
  keyByUser: false,
});

export const resetPasswordEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: resolveRateLimitMax(10, process.env),
  message: {
    error: "Too many attempts. Please wait a few minutes and try again.",
    code: "RATE_LIMITED",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: passwordResetEmailKey("reset-email:"),
});
```

Note: `normalizeUsernameKey` truncates keys to 100 chars. Emails longer than that share a bucket with any other email that has the same first 100 characters. That's harmless, so accept it.

- [ ] **Step 7: Run, expect PASS**

Run: `npx vitest run server/routes/__tests__/_schemas-password-reset.test.ts server/routes/__tests__/_rate-limiters.test.ts server/routes/__tests__/auth.test.ts`
Expected: all pass (existing register and login tests are unaffected).

- [ ] **Step 8: Commit**

Message: `feat(auth): reset schemas, INVALID_RESET_CODE, and email-keyed reset limiters` / Co-Authored-By line.
Run: `git add server/routes/_schemas.ts shared/constants/error-codes.ts server/routes/_rate-limiters.ts server/routes/__tests__/_schemas-password-reset.test.ts server/routes/__tests__/_rate-limiters.test.ts && git commit -F <scratchpad>/commit-msg-reset-t5.txt`

---

### Task 6: The two routes

**Files:**

- Modify: `server/routes/auth.ts`
- Modify: `server/routes/__tests__/auth-route-wiring.test.ts` (`PUBLIC_ROUTES`)
- Test: `server/routes/__tests__/auth-password-reset.test.ts` (new)

**Interfaces:**

- Consumes: Tasks 2–5.
- Produces: `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` with the bodies in Global Constraints.

- [ ] **Step 1: Write the failing route tests** — `server/routes/__tests__/auth-password-reset.test.ts`:

```ts
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
```

- [ ] **Step 2: Run, expect FAIL** (404s)

Run: `npx vitest run server/routes/__tests__/auth-password-reset.test.ts`
Expected: FAIL — status 404.

- [ ] **Step 3: Implement the routes** in `server/routes/auth.ts`

Imports: add `sendPasswordResetCode, sendPasswordChangedNotice` to the `../services/email` import; add the four limiters to the `./_rate-limiters` import; add `forgotPasswordSchema, resetPasswordSchema` to the `./_schemas` import; add:

```ts
import {
  generateResetCode,
  hashResetCode,
  resetCodeMatches,
  DUMMY_RESET_USER_ID,
  DUMMY_RESET_HASH,
} from "../lib/password-reset-code";
```

Module-level helpers (after `sendVerificationPending`):

```ts
const RESET_CODE_SENT_MESSAGE =
  "If an account uses that email, we've sent a 6-digit code. It expires in 15 minutes.";

/** The ONE reset-password failure — never says which check failed. */
function sendInvalidResetCode(res: Response): void {
  sendError(
    res,
    400,
    "That code is incorrect or expired.",
    ErrorCode.INVALID_RESET_CODE,
  );
}

/**
 * Background half of forgot-password: store the code (the DB enforces the
 * 6-per-24h cap atomically), then email it. A cap refusal is silent on
 * purpose — only real accounts can hit it, so surfacing it would leak
 * existence. Runs fire-and-forget so the DB write stays out of response time.
 */
async function issueAndSendResetCode(
  userId: string,
  email: string,
  codeHash: string,
  code: string,
): Promise<void> {
  const issued = await storage.issuePasswordResetCode(userId, codeHash);
  if (!issued) return;
  await sendPasswordResetCode(email, code);
}
```

Routes (after `/api/auth/resend-verification`):

```ts
// Forgot password (spec §4.1). Public and anti-enumerating: limiters run
// before the lookup; both branches do one lookup + one HMAC; the store+send
// is fire-and-forget; the body is identical either way. Looks up the
// VERIFIED email column only — never pending_email.
app.post(
  "/api/auth/forgot-password",
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = forgotPasswordSchema.safeParse(req.body);
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
      const user = await storage.getUserByEmailForAuth(email);
      const code = generateResetCode();
      const codeHash = hashResetCode(user?.id ?? DUMMY_RESET_USER_ID, code);
      if (user) {
        fireAndForget(
          "password-reset-code",
          issueAndSendResetCode(user.id, user.email, codeHash, code),
        );
      }
      res
        .status(200)
        .json({ status: "reset_code_sent", message: RESET_CODE_SENT_MESSAGE });
    } catch (error) {
      handleRouteError(res, error, "request password reset");
    }
  },
);

// Reset password (spec §4.2). Validation first (a weak password never uses
// up a code attempt); then ONE atomic UPDATE uses up an attempt for real and
// unknown emails alike; the HMAC compare runs on both branches. Every failure
// is the same 400. Success: one UPDATE commits password + tokenVersion+1 +
// verified + discards a staged email change + clears the code; then the
// tokenVersion cache is invalidated (an increment alone leaves stolen
// sessions alive up to 60s). No token is issued — the client signs in again.
app.post(
  "/api/auth/reset-password",
  resetPasswordIpLimiter,
  resetPasswordEmailLimiter,
  async (req: Request, res: Response) => {
    try {
      const parsed = resetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        sendError(
          res,
          400,
          formatZodError(parsed.error),
          ErrorCode.VALIDATION_ERROR,
        );
        return;
      }
      const { email, code, newPassword } = parsed.data;
      const reserved = await storage.reservePasswordResetAttempt(email);
      const matches = resetCodeMatches(
        reserved?.id ?? DUMMY_RESET_USER_ID,
        code,
        reserved?.resetCodeHash ?? DUMMY_RESET_HASH,
      );
      if (!reserved || !matches) {
        sendInvalidResetCode(res);
        return;
      }
      const newHash = await bcrypt.hash(newPassword, 12);
      const completed = await storage.completePasswordReset(
        reserved.id,
        reserved.resetCodeHash,
        newHash,
      );
      if (!completed) {
        sendInvalidResetCode(res);
        return;
      }
      invalidateTokenVersionCache(reserved.id);
      fireAndForget(
        "password-changed-notice",
        sendPasswordChangedNotice(reserved.email, reserved.username),
      );
      res.status(200).json({ status: "password_reset" });
    } catch (error) {
      handleRouteError(res, error, "reset password");
    }
  },
);
```

- [ ] **Step 4: Allowlist the routes** — in `auth-route-wiring.test.ts` `PUBLIC_ROUTES`, after the resend-verification entry:

```ts
    [
      "POST /api/auth/forgot-password",
      "pre-auth reset request — caller has no token; neutral response",
    ],
    [
      "POST /api/auth/reset-password",
      "pre-auth reset — emailed code carried in body",
    ],
```

- [ ] **Step 5: Run, expect PASS**

Run: `npx vitest run server/routes/__tests__/auth-password-reset.test.ts server/routes/__tests__/auth-route-wiring.test.ts server/routes/__tests__/auth.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

Message: `feat(auth): forgot-password and reset-password endpoints` / body: `Uniform responses for real and unknown emails; one atomic attempt per guess; success revokes every session immediately and sends the change notice; no token issued.` / Co-Authored-By line.
Run: `git add server/routes/auth.ts server/routes/__tests__/auth-password-reset.test.ts server/routes/__tests__/auth-route-wiring.test.ts && git commit -F <scratchpad>/commit-msg-reset-t6.txt`

---

### Task 7: Login by email, with the dummy compare

**Files:**

- Modify: `server/routes/auth.ts` (login handler)
- Test: `server/routes/__tests__/auth.test.ts` (`describe("POST /api/auth/login")`), `server/routes/__tests__/auth-account-throttle.test.ts`

**Interfaces:**

- Consumes: `storage.getUserByEmailForAuth` (Task 3), widened `loginSchema` (Task 5).

- [ ] **Step 1: Write the failing tests** — add `getUserByEmailForAuth: vi.fn(),` to the `storage` mock object in `auth.test.ts`, then append inside `describe("POST /api/auth/login", …)`:

```ts
it("signs in by email (any case), looking up the lowercased email only", async () => {
  const hash = await bcrypt.hash("password123", 10);
  vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(
    createMockUser({ password: hash }),
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
  vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(undefined);
  await request(app)
    .post("/api/auth/login")
    .send({ username: "MixedCase", password: "x" });
  expect(storage.getUserByUsernameForAuth).toHaveBeenCalledWith("MixedCase");
  expect(storage.getUserByEmailForAuth).not.toHaveBeenCalled();
});

it("missing user still pays a bcrypt compare (timing parity)", async () => {
  vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(undefined);
  const spy = vi.spyOn(bcrypt, "compare");
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "ghost@example.com", password: "whatever1" });
  expect(res.status).toBe(401);
  expect(spy).toHaveBeenCalledTimes(1);
  spy.mockRestore();
});
```

(Use the file's existing `beforeEach` clearing; if mocks aren't cleared between tests there, add `vi.mocked(storage.getUserByEmailForAuth).mockReset(); vi.mocked(storage.getUserByUsernameForAuth).mockReset();` at the top of each new test.)

In `auth-account-throttle.test.ts`, add one case that reuses its existing `login()` helper pattern. Send 10 failed logins as `"Victim@Example.com"`, then one as `" victim@example.com "`, and expect the 11th to get 429. That proves case and spacing variants of an email share the per-account bucket. Model it on that file's existing lockout test, including its `resetKey` bookkeeping via `normalizeUsernameKey` + `LOGIN_ACCOUNT_KEY_PREFIX`.

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run server/routes/__tests__/auth.test.ts server/routes/__tests__/auth-account-throttle.test.ts`
Expected: the email-login test fails (401, since `getUserByUsernameForAuth` was called with the email), and the dummy-compare test fails (0 calls).

- [ ] **Step 3: Implement** — in `server/routes/auth.ts` add the module constant:

```ts
// Fixed cost-12 bcrypt hash compared against on the missing-user login branch
// so "no such user" costs the same ~250ms as "wrong password" (related gap 3).
// The plaintext is irrelevant and matches nothing real.
const DUMMY_PASSWORD_HASH =
  "$2b$12$Dr3GzjhqTPluaG3QtTffX.SA5LiZi/05bbk8i97iK0z0QygBxFIgy";
```

In the login handler, replace the lookup and the `!user` branch:

```ts
const validated = loginSchema.parse(req.body);
const identifier = validated.username;

// "@" ⇒ email (usernames are ^[a-zA-Z0-9_]+$). Emails are matched on
// the VERIFIED column, lowercased; usernames stay an exact match.
const user = identifier.includes("@")
  ? await storage.getUserByEmailForAuth(identifier.toLowerCase())
  : await storage.getUserByUsernameForAuth(identifier);
if (!user) {
  await bcrypt.compare(validated.password, DUMMY_PASSWORD_HASH);
  return sendError(res, 401, "Invalid credentials", ErrorCode.UNAUTHORIZED);
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run server/routes/__tests__/auth.test.ts server/routes/__tests__/auth-account-throttle.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

Message: `feat(auth): sign in with username or email; equalize missing-user timing` / Co-Authored-By line.
Run: `git add server/routes/auth.ts server/routes/__tests__/auth.test.ts server/routes/__tests__/auth-account-throttle.test.ts && git commit -F <scratchpad>/commit-msg-reset-t7.txt`

---

### Task 8: Session revocation through the REAL `requireAuth`

**Files:**

- Test: `server/routes/__tests__/auth-reset-revocation.test.ts` (new; test-only task, which proves Task 6 wired the cache invalidation)

- [ ] **Step 1: Write the test** (no `vi.mock("../../middleware/auth")`, so the real middleware and its 60 s cache run):

```ts
import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

import { storage } from "../../storage";
import { generateToken } from "../../middleware/auth";
import { register } from "../auth";
import { hashResetCode } from "../../lib/password-reset-code";

// REAL requireAuth + REAL token-version cache. Only storage, limiters and
// email are mocked. Proves the reset invalidates the cache: without
// invalidateTokenVersionCache, the warmed cache would keep the old token
// alive for up to 60s and the second /me would return 200.
vi.mock("../../storage", () => ({
  ReservedUsernameError: class extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUser: vi.fn(),
    reservePasswordResetAttempt: vi.fn(),
    completePasswordReset: vi.fn(),
  },
}));
vi.mock("express-rate-limit");
vi.mock("../../services/email", () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
  sendSignupAttemptNotice: vi.fn().mockResolvedValue(undefined),
  sendPasswordResetCode: vi.fn().mockResolvedValue(undefined),
  sendPasswordChangedNotice: vi.fn().mockResolvedValue(undefined),
}));

describe("password reset revokes sessions immediately (real requireAuth)", () => {
  it("a token issued before the reset is rejected on the very next request", async () => {
    const app = express();
    app.use(express.json());
    register(app);

    const id = "revocation-user-1";
    let tokenVersion = 0;
    vi.mocked(storage.getUser).mockImplementation(
      async () =>
        ({
          id,
          username: "rev",
          email: "rev@example.com",
          emailVerified: true,
          displayName: null,
          avatarUrl: null,
          dailyCalorieGoal: null,
          onboardingCompleted: true,
          subscriptionTier: "free",
          measurementUnit: "metric",
          tokenVersion,
        }) as never,
    );
    vi.mocked(storage.reservePasswordResetAttempt).mockResolvedValue({
      id,
      username: "rev",
      email: "rev@example.com",
      resetCodeHash: hashResetCode(id, "123456"),
    });
    vi.mocked(storage.completePasswordReset).mockImplementation(async () => {
      tokenVersion += 1; // what the real UPDATE does
      return true;
    });

    const oldToken = generateToken(id, 0, true);

    // Warm the cache with version 0.
    const before = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${oldToken}`);
    expect(before.status).toBe(200);

    const reset = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: "rev@example.com",
        code: "123456",
        newPassword: "newpass99",
      });
    expect(reset.status).toBe(200);

    const after = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${oldToken}`);
    expect(after.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run, expect PASS** (Task 6 already wired it)

Run: `npx vitest run server/routes/__tests__/auth-reset-revocation.test.ts`
Expected: 1 passed.

- [ ] **Step 3: Prove it guards something (positive control).** Temporarily comment out `invalidateTokenVersionCache(reserved.id);` in the reset route and re-run the test. Expected: **FAIL** (`after.status` is 200). Restore the line and re-run. Expected: PASS. Record both results in the PR description.

- [ ] **Step 4: Commit**

Message: `test(auth): password reset revokes sessions immediately through the real requireAuth` / Co-Authored-By line.
Run: `git add server/routes/__tests__/auth-reset-revocation.test.ts && git commit -F <scratchpad>/commit-msg-reset-t8.txt`

---

### Task 9: Client utils

**Files:**

- Modify: `client/screens/LoginScreen-utils.ts`
- Create: `client/screens/ForgotPasswordScreen-utils.ts`, `client/screens/ResetPasswordScreen-utils.ts`
- Test: `client/screens/__tests__/LoginScreen-utils.test.ts`, `client/screens/__tests__/ForgotPasswordScreen-utils.test.ts`, `client/screens/__tests__/ResetPasswordScreen-utils.test.ts`

**Interfaces:**

- Produces:
  - `validateNewPassword(password: string, confirmPassword: string): string | null` (LoginScreen-utils)
  - `isValidResetEmail(email: string): boolean`, `requestResetCode(email: string): Promise<void>`, `getResetRequestErrorMessage(err: unknown): string` (ForgotPassword utils)
  - `normalizeResetCode(raw: string): string`, `validateResetForm(input: { code: string; password: string; confirmPassword: string }): string | null`, `getResetErrorMessage(err: unknown): string`, `resendSecondsRemaining(lastSentAt: number, now: number): number`, `resetPasswordRequest(email: string, code: string, newPassword: string): Promise<void>`, `INVALID_RESET_CODE_MESSAGE` (ResetPassword utils)

- [ ] **Step 1: Write the failing tests**

Append to `client/screens/__tests__/LoginScreen-utils.test.ts`:

```ts
import { validateNewPassword } from "../LoginScreen-utils";

describe("validateNewPassword (mirrors server newPasswordSchema)", () => {
  it("enforces length, letter+digit, and match, in that order", () => {
    expect(validateNewPassword("short1", "short1")).toBe(
      "Password must be at least 8 characters",
    );
    expect(validateNewPassword("allletters", "allletters")).toBe(
      "Password must contain at least one letter and one number",
    );
    expect(validateNewPassword("abcdefg1", "abcdefg2")).toBe(
      "Passwords do not match",
    );
    expect(validateNewPassword("abcdefg1", "abcdefg1")).toBeNull();
  });
});
```

`client/screens/__tests__/ForgotPasswordScreen-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  isValidResetEmail,
  getResetRequestErrorMessage,
} from "../ForgotPasswordScreen-utils";

describe("ForgotPasswordScreen-utils", () => {
  it("accepts a trimmed email shape", () => {
    expect(isValidResetEmail("  a@b.co ")).toBe(true);
    expect(isValidResetEmail("nope")).toBe(false);
  });
  it("a 429 gets the honest hourly-limit copy", () => {
    expect(
      getResetRequestErrorMessage(new ApiError("x", "RATE_LIMITED", 429)),
    ).toBe("Too many code requests for this email. Try again in an hour.");
  });
  it("anything else gets generic copy (never the raw server message)", () => {
    expect(
      getResetRequestErrorMessage(
        new ApiError("raw server text", "INTERNAL_ERROR", 500),
      ),
    ).toBe("Couldn't send a code right now. Please try again shortly.");
    expect(getResetRequestErrorMessage(new Error("network"))).toBe(
      "Couldn't send a code right now. Please try again shortly.",
    );
  });
});
```

`client/screens/__tests__/ResetPasswordScreen-utils.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  normalizeResetCode,
  validateResetForm,
  getResetErrorMessage,
  resendSecondsRemaining,
  INVALID_RESET_CODE_MESSAGE,
} from "../ResetPasswordScreen-utils";

describe("ResetPasswordScreen-utils", () => {
  it("strips spaces/dashes from pasted or autofilled codes and caps at 6", () => {
    expect(normalizeResetCode("123 456")).toBe("123456");
    expect(normalizeResetCode("123-456")).toBe("123456");
    expect(normalizeResetCode(" 1234567 ")).toBe("123456");
  });
  it("requires a 6-digit code before the password rules", () => {
    expect(
      validateResetForm({
        code: "123",
        password: "abcdefg1",
        confirmPassword: "abcdefg1",
      }),
    ).toBe("Enter the 6-digit code from the email");
    expect(
      validateResetForm({
        code: "123456",
        password: "short1",
        confirmPassword: "short1",
      }),
    ).toBe("Password must be at least 8 characters");
    expect(
      validateResetForm({
        code: "123456",
        password: "abcdefg1",
        confirmPassword: "abcdefg1",
      }),
    ).toBeNull();
  });
  it("maps INVALID_RESET_CODE to the uniform message", () => {
    expect(
      getResetErrorMessage(new ApiError("x", "INVALID_RESET_CODE", 400)),
    ).toBe(INVALID_RESET_CODE_MESSAGE);
    expect(INVALID_RESET_CODE_MESSAGE).toBe(
      "That code is incorrect or expired. After 5 wrong tries, request a new code.",
    );
  });
  it("maps 429 and other errors to static copy", () => {
    expect(getResetErrorMessage(new ApiError("x", "RATE_LIMITED", 429))).toBe(
      "Too many attempts. Please wait a few minutes and try again.",
    );
    expect(getResetErrorMessage(new Error("boom"))).toBe(
      "Couldn't reset your password right now. Please try again shortly.",
    );
  });
  it("counts the resend cooldown down from 60 s and never below 0", () => {
    expect(resendSecondsRemaining(1_000, 1_000)).toBe(60);
    expect(resendSecondsRemaining(1_000, 31_500)).toBe(30);
    expect(resendSecondsRemaining(1_000, 61_000)).toBe(0);
    expect(resendSecondsRemaining(1_000, 999_999)).toBe(0);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run client/screens/__tests__/LoginScreen-utils.test.ts client/screens/__tests__/ForgotPasswordScreen-utils.test.ts client/screens/__tests__/ResetPasswordScreen-utils.test.ts`
Expected: FAIL — missing exports and modules.

- [ ] **Step 3: Implement**

In `LoginScreen-utils.ts`, add (below the constants):

```ts
/**
 * New-password rules — the client mirror of server `newPasswordSchema`
 * (server/routes/_schemas.ts), shared by register and the reset screen.
 * KEEP IN SYNC (manual), per the client-mirror convention.
 */
export function validateNewPassword(
  password: string,
  confirmPassword: string,
): string | null {
  if (password.length < PASSWORD_MIN) {
    return `Password must be at least ${PASSWORD_MIN} characters`;
  }
  if (!PASSWORD_COMPLEXITY.test(password)) {
    return "Password must contain at least one letter and one number";
  }
  if (password !== confirmPassword) {
    return "Passwords do not match";
  }
  return null;
}
```

and in `validateAuthForm`, replace the three password/confirm checks with:

```ts
const passwordError = validateNewPassword(
  input.password,
  input.confirmPassword,
);
if (passwordError) return passwordError;
```

`client/screens/ForgotPasswordScreen-utils.ts`:

```ts
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";

// Pragmatic client mirror; the server re-validates with zero trust.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidResetEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export async function requestResetCode(email: string): Promise<void> {
  await apiRequest("POST", "/api/auth/forgot-password", {
    email: email.trim(),
  });
}

/**
 * Static copy only (never error.message). A 429 comes from the per-email /
 * per-IP limiters, which run BEFORE the account lookup — so it is identical
 * for real and unknown addresses and safe to state plainly.
 */
export function getResetRequestErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 429) {
    return "Too many code requests for this email. Try again in an hour.";
  }
  return "Couldn't send a code right now. Please try again shortly.";
}
```

`client/screens/ResetPasswordScreen-utils.ts`:

```ts
import { apiRequest } from "@/lib/query-client";
import { ApiError } from "@/lib/api-error";
import {
  RESET_CODE_LENGTH,
  RESET_RESEND_COOLDOWN_SECONDS,
} from "@shared/constants/password-reset";
import { validateNewPassword } from "./LoginScreen-utils";

export const INVALID_RESET_CODE_MESSAGE =
  "That code is incorrect or expired. After 5 wrong tries, request a new code.";

/** Keep digits only (autofill/paste may add spaces or a dash), max 6. */
export function normalizeResetCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, RESET_CODE_LENGTH);
}

export function validateResetForm(input: {
  code: string;
  password: string;
  confirmPassword: string;
}): string | null {
  if (input.code.length !== RESET_CODE_LENGTH) {
    return "Enter the 6-digit code from the email";
  }
  return validateNewPassword(input.password, input.confirmPassword);
}

/** Static copy keyed on ApiError.code/status — never error.message. */
export function getResetErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === "INVALID_RESET_CODE") return INVALID_RESET_CODE_MESSAGE;
    if (err.status === 429) {
      return "Too many attempts. Please wait a few minutes and try again.";
    }
    if (err.code === "VALIDATION_ERROR") {
      return "Please check the code and your new password, then try again.";
    }
  }
  return "Couldn't reset your password right now. Please try again shortly.";
}

export function resendSecondsRemaining(
  lastSentAt: number,
  now: number,
): number {
  const endsAt = lastSentAt + RESET_RESEND_COOLDOWN_SECONDS * 1000;
  return Math.max(0, Math.ceil((endsAt - now) / 1000));
}

export async function resetPasswordRequest(
  email: string,
  code: string,
  newPassword: string,
): Promise<void> {
  await apiRequest("POST", "/api/auth/reset-password", {
    email: email.trim(),
    code,
    newPassword,
  });
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run client/screens/__tests__/LoginScreen-utils.test.ts client/screens/__tests__/ForgotPasswordScreen-utils.test.ts client/screens/__tests__/ResetPasswordScreen-utils.test.ts`
Expected: all pass (the existing register-validation tests still pass after the refactor).

- [ ] **Step 5: Commit**

Message: `feat(client): password-reset form helpers and a shared new-password mirror` / Co-Authored-By line.
Run: `git add client/screens/LoginScreen-utils.ts client/screens/ForgotPasswordScreen-utils.ts client/screens/ResetPasswordScreen-utils.ts client/screens/__tests__/LoginScreen-utils.test.ts client/screens/__tests__/ForgotPasswordScreen-utils.test.ts client/screens/__tests__/ResetPasswordScreen-utils.test.ts && git commit -F <scratchpad>/commit-msg-reset-t9.txt`

---

### Task 10: Navigation, Forgot Password screen, Login changes

**Files:**

- Create: `client/screens/ForgotPasswordScreen.tsx`
- Modify: `client/navigation/RootStackNavigator.tsx`, `client/screens/LoginScreen.tsx`
- Test: `client/screens/__tests__/ForgotPasswordScreen.test.tsx` (new), `client/screens/__tests__/LoginScreen.test.tsx`

**Interfaces:**

- Produces: params `Login: { email?: string; passwordReset?: boolean } | undefined`, `ForgotPassword: { email?: string } | undefined`, `ResetPassword: { email: string }`.

- [ ] **Step 1: Before writing UI, run the design skills.** Invoke `frontend-design:frontend-design` with this brief: _"Two logged-out screens (Forgot Password: one email field; Reset Password: code + new password + confirm + resend countdown) that must read as one flow with the existing LoginScreen/VerifyEmailScreen, using only ThemedView/ThemedText/TextInput/Button/InlineError/KeyboardAwareScrollViewCompat and useTheme tokens. No new components, no raw hex."_ Then invoke `interaction-feel` for the "Forgot password?" link, the submit buttons, and the resend countdown. Apply what they recommend within the Global Constraints. If a recommendation needs a new component or a raw color, skip it and note it in the PR.

- [ ] **Step 2: Write the failing tests**

`client/screens/__tests__/ForgotPasswordScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ForgotPasswordScreen from "../ForgotPasswordScreen";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { ApiError } from "@/lib/api-error";

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">;

const { mockRequestResetCode } = vi.hoisted(() => ({
  mockRequestResetCode: vi.fn(),
}));
vi.mock("../ForgotPasswordScreen-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../ForgotPasswordScreen-utils")>();
  return { ...actual, requestResetCode: mockRequestResetCode };
});

function renderScreen(params?: RootStackParamList["ForgotPassword"]) {
  const navigate = vi.fn();
  const replace = vi.fn();
  const route = { params } as unknown as Props["route"];
  const navigation = { navigate, replace } as unknown as Props["navigation"];
  renderComponent(
    <ForgotPasswordScreen route={route} navigation={navigation} />,
  );
  return { navigate, replace };
}

describe("ForgotPasswordScreen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("prefills the email from params", () => {
    renderScreen({ email: "a@b.com" });
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "a@b.com",
    );
  });

  it("rejects an invalid email without calling the API", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByText("Send code"));
    expect(mockRequestResetCode).not.toHaveBeenCalled();
    expect(
      screen.getByText("Please enter a valid email address."),
    ).toBeTruthy();
  });

  it("on success moves to ResetPassword with the trimmed email", async () => {
    mockRequestResetCode.mockResolvedValue(undefined);
    const { replace } = renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: " a@b.com " },
    });
    fireEvent.click(screen.getByText("Send code"));
    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith("ResetPassword", {
        email: "a@b.com",
      }),
    );
  });

  it("on 429 stays put and shows the hourly-limit message", async () => {
    mockRequestResetCode.mockRejectedValue(
      new ApiError("x", "RATE_LIMITED", 429),
    );
    const { replace } = renderScreen();
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.click(screen.getByText("Send code"));
    await screen.findByText(
      "Too many code requests for this email. Try again in an hour.",
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("Back to sign in navigates to Login", () => {
    const { navigate } = renderScreen();
    fireEvent.click(screen.getByText("Back to sign in"));
    expect(navigate).toHaveBeenCalledWith("Login");
  });
});
```

In `client/screens/__tests__/LoginScreen.test.tsx`:

- Replace every `getByLabelText("Username")` with `getByLabelText("Username or email")`.
- Add the tests below. They use the file's existing navigation mock: check how it mocks `useNavigation`, and if needed extend that mock with `useRoute: () => ({ params: mockRouteParams })` using a hoisted `mockRouteParams` variable.

```tsx
it("shows Forgot password? in login mode only and navigates with an email-shaped identifier", () => {
  renderLogin();
  fireEvent.change(screen.getByLabelText("Username or email"), {
    target: { value: "a@b.com" },
  });
  fireEvent.click(screen.getByText("Forgot password?"));
  expect(mockNavigate).toHaveBeenCalledWith("ForgotPassword", {
    email: "a@b.com",
  });
  fireEvent.click(screen.getByLabelText("Switch to sign up"));
  expect(screen.queryByText("Forgot password?")).toBeNull();
});

it("does not forward a plain username as the reset email", () => {
  renderLogin();
  fireEvent.change(screen.getByLabelText("Username or email"), {
    target: { value: "alice" },
  });
  fireEvent.click(screen.getByText("Forgot password?"));
  expect(mockNavigate).toHaveBeenCalledWith("ForgotPassword", undefined);
});
```

(Use whatever render helper and navigate spy names the file already defines in place of `renderLogin` and `mockNavigate`.)

- [ ] **Step 3: Run, expect FAIL**

Run: `npx vitest run client/screens/__tests__/ForgotPasswordScreen.test.tsx client/screens/__tests__/LoginScreen.test.tsx`
Expected: FAIL — module missing; `Username or email` label not found.

- [ ] **Step 4: Navigation** — in `RootStackNavigator.tsx`:

Replace `Login: undefined;` with:

```ts
  Login:
    | {
        /** Prefill the identifier (e.g. after a password reset). */
        email?: string;
        /** Set by ResetPassword on success → one-time success toast. */
        passwordReset?: boolean;
      }
    | undefined;
  ForgotPassword: { email?: string } | undefined;
  ResetPassword: { email: string };
```

Add the imports `import ForgotPasswordScreen from "@/screens/ForgotPasswordScreen";` and `import ResetPasswordScreen from "@/screens/ResetPasswordScreen";`. In the `!isAuthenticated` branch, after `VerifyEmail`:

```tsx
          <Stack.Screen
            name="ForgotPassword"
            component={ForgotPasswordScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="ResetPassword"
            component={ResetPasswordScreen}
            options={{ headerShown: false }}
          />
```

(`ResetPasswordScreen` is created in Task 11. Until then, create a placeholder file exporting a component that renders `null` so this compiles, and replace it in Task 11. Do not commit the placeholder separately: Tasks 10 and 11 can share a commit if that's simpler.)

- [ ] **Step 5: Forgot Password screen** — `client/screens/ForgotPasswordScreen.tsx`:

```tsx
import React, { useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing } from "@/constants/theme";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  isValidResetEmail,
  requestResetCode,
  getResetRequestErrorMessage,
} from "./ForgotPasswordScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "ForgotPassword">;

export default function ForgotPasswordScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const [email, setEmail] = useState(route.params?.email ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const onSend = async () => {
    setError("");
    if (!isValidResetEmail(email)) {
      setError("Please enter a valid email address.");
      return;
    }
    setBusy(true);
    try {
      await requestResetCode(email);
      haptics.notification("success");
      AccessibilityInfo.announceForAccessibility(
        "If an account uses that email, we've sent a 6-digit code.",
      );
      // replace, not navigate: Back from the code screen returns to Login, not
      // to a screen that would send another code.
      navigation.replace("ResetPassword", { email: email.trim() });
    } catch (err) {
      haptics.notification("error");
      setError(getResetRequestErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing["3xl"],
            paddingBottom: insets.bottom + Spacing["2xl"],
          },
        ]}
      >
        <View style={styles.header}>
          <ThemedText type="h2" style={styles.title}>
            Forgot password?
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            Enter the email on your account and we&apos;ll send you a 6-digit
            code to reset your password.
          </ThemedText>
        </View>

        <View style={styles.form}>
          <TextInput
            leftIcon="mail"
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="emailAddress"
            autoComplete="email"
            returnKeyType="send"
            onSubmitEditing={onSend}
            testID="input-forgot-email"
            accessibilityLabel="Email"
            accessibilityHint="Enter the email address on your account"
            error={!!error}
            errorMessage={error || undefined}
          />
          <InlineError message={error} />
          <Button onPress={onSend} loading={busy} style={styles.button}>
            Send code
          </Button>
          <Button
            variant="ghost"
            onPress={() => navigation.navigate("Login")}
            style={styles.button}
          >
            Back to sign in
          </Button>
        </View>
      </KeyboardAwareScrollViewCompat>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: Spacing["2xl"], flexGrow: 1 },
  header: { alignItems: "flex-start", marginBottom: Spacing["3xl"] },
  title: { marginBottom: Spacing.xs },
  form: { gap: Spacing.lg },
  button: { marginTop: Spacing.sm },
});
```

Check `useHaptics()`'s real API before relying on `haptics.notification("success")`: open `client/hooks/useHaptics.ts` and use the method `LoginScreen.tsx` calls on a successful submit, with the same arguments. Check whether `TextInput` forwards `returnKeyType` / `onSubmitEditing` (open `client/components/TextInput.tsx`); if it doesn't, drop those two props.

- [ ] **Step 6: Login changes** — in `LoginScreen.tsx`:

1. Import `useRoute` / `RouteProp` and `useToast`:

```ts
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { useToast } from "@/context/ToastContext";
```

2. In the component:

```ts
const route = useRoute<RouteProp<RootStackParamList, "Login">>();
const toast = useToast();
```

Initialize the identifier state from params: change the `username` `useState("")` to `useState(route.params?.email ?? "")`.
Then add the one-time success toast:

```ts
const passwordReset = route.params?.passwordReset === true;
useEffect(() => {
  if (!passwordReset) return;
  toast.success("Password updated. Sign in with your new password.");
  // Consume the flag so a re-render or return visit doesn't re-toast.
  navigation.setParams({ passwordReset: undefined });
}, [passwordReset, toast, navigation]);
```

(Add `useEffect` to the React import.) 3. Field: `placeholder="Username or email"`, `accessibilityLabel="Username or email"`, `accessibilityHint="Enter your username or email address"`, `textContentType="username"`, `autoComplete="username"`. 4. Directly after the password `TextInput`, in login mode only:

```tsx
{
  mode === "login" ? (
    <Pressable
      onPress={() =>
        navigation.navigate(
          "ForgotPassword",
          username.includes("@") ? { email: username.trim() } : undefined,
        )
      }
      accessibilityRole="button"
      accessibilityLabel="Forgot password?"
      hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      style={({ pressed }) => [
        styles.forgotLink,
        { opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <ThemedText type="small" style={{ color: theme.link }}>
        Forgot password?
      </ThemedText>
    </Pressable>
  ) : null;
}
```

Add `forgotLink: { alignSelf: "flex-end", minHeight: 44, justifyContent: "center" },` to `styles`. Check that `ThemedText` supports `type="small"` (open `client/components/ThemedText.tsx`); if not, use the smallest body type it offers.

- [ ] **Step 7: Run, expect PASS**

Run: `npx vitest run client/screens/__tests__/ForgotPasswordScreen.test.tsx client/screens/__tests__/LoginScreen.test.tsx`
Expected: all pass.

- [ ] **Step 8: Commit** (or fold into Task 11's commit if the placeholder is still present)

Message: `feat(client): Forgot Password screen and sign-in by email on Login` / Co-Authored-By line.
Run: `git add client/screens/ForgotPasswordScreen.tsx client/screens/LoginScreen.tsx client/navigation/RootStackNavigator.tsx client/screens/__tests__/ForgotPasswordScreen.test.tsx client/screens/__tests__/LoginScreen.test.tsx client/screens/ResetPasswordScreen.tsx && git commit -F <scratchpad>/commit-msg-reset-t10.txt`

---

### Task 11: Reset Password screen

**Files:**

- Create (replace placeholder): `client/screens/ResetPasswordScreen.tsx`
- Test: `client/screens/__tests__/ResetPasswordScreen.test.tsx`

**Interfaces:**

- Consumes: Task 9 utils; `requestResetCode` (resend); route param `{ email }`.

- [ ] **Step 1: Write the failing tests** — `client/screens/__tests__/ResetPasswordScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ResetPasswordScreen from "../ResetPasswordScreen";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { ApiError } from "@/lib/api-error";

type Props = NativeStackScreenProps<RootStackParamList, "ResetPassword">;

const { mockReset, mockResend } = vi.hoisted(() => ({
  mockReset: vi.fn(),
  mockResend: vi.fn(),
}));
vi.mock("../ResetPasswordScreen-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../ResetPasswordScreen-utils")>();
  return { ...actual, resetPasswordRequest: mockReset };
});
vi.mock("../ForgotPasswordScreen-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../ForgotPasswordScreen-utils")>();
  return { ...actual, requestResetCode: mockResend };
});

function renderScreen() {
  const navigate = vi.fn();
  const reset = vi.fn();
  const route = { params: { email: "a@b.com" } } as unknown as Props["route"];
  const navigation = { navigate, reset } as unknown as Props["navigation"];
  renderComponent(
    <ResetPasswordScreen route={route} navigation={navigation} />,
  );
  return { navigate, reset };
}

function fill(code: string, pw = "newpass99", confirm = pw) {
  fireEvent.change(screen.getByLabelText("6-digit code"), {
    target: { value: code },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: pw },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: confirm },
  });
}

describe("ResetPasswordScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("normalizes a pasted code and submits; success resets to Login with params", async () => {
    mockReset.mockResolvedValue(undefined);
    const { reset } = renderScreen();
    fill("123 456");
    fireEvent.click(screen.getByText("Reset password"));
    await waitFor(() =>
      expect(mockReset).toHaveBeenCalledWith("a@b.com", "123456", "newpass99"),
    );
    expect(reset).toHaveBeenCalledWith({
      index: 0,
      routes: [
        { name: "Login", params: { email: "a@b.com", passwordReset: true } },
      ],
    });
  });

  it("shows the uniform message on INVALID_RESET_CODE", async () => {
    mockReset.mockRejectedValue(new ApiError("x", "INVALID_RESET_CODE", 400));
    renderScreen();
    fill("000000");
    fireEvent.click(screen.getByText("Reset password"));
    await screen.findByText(
      "That code is incorrect or expired. After 5 wrong tries, request a new code.",
    );
  });

  it("blocks submit on mismatched passwords without calling the API", () => {
    renderScreen();
    fill("123456", "newpass99", "newpass98");
    fireEvent.click(screen.getByText("Reset password"));
    expect(mockReset).not.toHaveBeenCalled();
    expect(screen.getByText("Passwords do not match")).toBeTruthy();
  });

  it("resend is disabled for 60 s, counts down, then sends", async () => {
    mockResend.mockResolvedValue(undefined);
    renderScreen();
    expect(screen.getByText("Resend code in 60s")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    fireEvent.click(screen.getByText("Resend code"));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith("a@b.com"));
    expect(await screen.findByText("Resend code in 60s")).toBeTruthy();
  });

  it("shows the spam/most-recent hint", () => {
    renderScreen();
    expect(
      screen.getByText(
        "Didn't get it? Check your spam folder, and use the most recent email.",
      ),
    ).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx vitest run client/screens/__tests__/ResetPasswordScreen.test.tsx`
Expected: FAIL (placeholder renders nothing).

- [ ] **Step 3: Implement** — `client/screens/ResetPasswordScreen.tsx`:

```tsx
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { KeyboardAwareScrollViewCompat } from "@/components/KeyboardAwareScrollViewCompat";
import { ThemedView } from "@/components/ThemedView";
import { ThemedText } from "@/components/ThemedText";
import { Button } from "@/components/Button";
import { TextInput } from "@/components/TextInput";
import { InlineError } from "@/components/InlineError";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { Spacing } from "@/constants/theme";
import { RESET_CODE_LENGTH } from "@shared/constants/password-reset";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import {
  normalizeResetCode,
  validateResetForm,
  getResetErrorMessage,
  resendSecondsRemaining,
  resetPasswordRequest,
} from "./ResetPasswordScreen-utils";
import {
  requestResetCode,
  getResetRequestErrorMessage,
} from "./ForgotPasswordScreen-utils";

type Props = NativeStackScreenProps<RootStackParamList, "ResetPassword">;

export default function ResetPasswordScreen({ route, navigation }: Props) {
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const haptics = useHaptics();
  const email = route.params.email;

  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The code was just sent by ForgotPassword, so the cooldown starts now.
  const [lastSentAt, setLastSentAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());

  const secondsLeft = resendSecondsRemaining(lastSentAt, now);
  useEffect(() => {
    if (secondsLeft === 0) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [secondsLeft]);

  const onSubmit = async () => {
    setError("");
    const invalid = validateResetForm({ code, password, confirmPassword });
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      await resetPasswordRequest(email, code, password);
      haptics.notification("success");
      navigation.reset({
        index: 0,
        routes: [{ name: "Login", params: { email, passwordReset: true } }],
      });
    } catch (err) {
      haptics.notification("error");
      const message = getResetErrorMessage(err);
      setError(message);
      AccessibilityInfo.announceForAccessibility(message);
    } finally {
      setBusy(false);
    }
  };

  const onResend = async () => {
    setError("");
    try {
      await requestResetCode(email);
      const sentAt = Date.now();
      setLastSentAt(sentAt);
      setNow(sentAt);
      AccessibilityInfo.announceForAccessibility("A new code has been sent.");
    } catch (err) {
      setError(getResetRequestErrorMessage(err));
    }
  };

  return (
    <ThemedView style={styles.container}>
      <KeyboardAwareScrollViewCompat
        style={styles.scrollView}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + Spacing["3xl"],
            paddingBottom: insets.bottom + Spacing["2xl"],
          },
        ]}
      >
        <View style={styles.header}>
          <ThemedText type="h2" style={styles.title}>
            Check your email
          </ThemedText>
          <ThemedText type="body" style={{ color: theme.textSecondary }}>
            If an account uses {email}, we&apos;ve sent a 6-digit code. It
            expires in 15 minutes.
          </ThemedText>
        </View>

        <View style={styles.form}>
          <TextInput
            leftIcon="hash"
            placeholder="6-digit code"
            value={code}
            onChangeText={(v) => setCode(normalizeResetCode(v))}
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={RESET_CODE_LENGTH + 2}
            testID="input-reset-code"
            accessibilityLabel="6-digit code"
            accessibilityHint="Enter the code from the email"
          />
          <TextInput
            leftIcon="lock"
            rightIcon={showPassword ? "eye-off" : "eye"}
            rightIconAccessibilityLabel={
              showPassword ? "Hide password" : "Show password"
            }
            onRightIconPress={() => setShowPassword(!showPassword)}
            placeholder="New password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            textContentType="newPassword"
            autoComplete="new-password"
            testID="input-reset-password"
            accessibilityLabel="New password"
            accessibilityHint="At least 8 characters, with a letter and a number"
          />
          <TextInput
            leftIcon="lock"
            placeholder="Confirm new password"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            textContentType="newPassword"
            autoComplete="new-password"
            testID="input-reset-confirm"
            accessibilityLabel="Confirm new password"
            accessibilityHint="Re-enter the new password"
          />
          <InlineError message={error} />
          <Button onPress={onSubmit} loading={busy} style={styles.button}>
            Reset password
          </Button>
          <Button
            variant="ghost"
            onPress={onResend}
            disabled={secondsLeft > 0}
            accessibilityLabel={
              secondsLeft > 0
                ? `Resend code available in ${secondsLeft} seconds`
                : "Resend code"
            }
            style={styles.button}
          >
            {secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
          </Button>
          <ThemedText
            type="small"
            style={[styles.hint, { color: theme.textSecondary }]}
          >
            Didn&apos;t get it? Check your spam folder, and use the most recent
            email.
          </ThemedText>
          <Button
            variant="ghost"
            onPress={() => navigation.navigate("Login")}
            style={styles.button}
          >
            Back to sign in
          </Button>
        </View>
      </KeyboardAwareScrollViewCompat>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollView: { flex: 1 },
  content: { paddingHorizontal: Spacing["2xl"], flexGrow: 1 },
  header: { alignItems: "flex-start", marginBottom: Spacing["3xl"] },
  title: { marginBottom: Spacing.xs },
  form: { gap: Spacing.lg },
  button: { marginTop: Spacing.sm },
  hint: { textAlign: "center" },
});
```

Before relying on them, verify against the real components:

- `Button` accepts `disabled` and `accessibilityLabel` (`client/components/Button.tsx`); if not, wrap the countdown state in the props it does take.
- `TextInput` forwards `maxLength`, `textContentType`, and `autoComplete`.
- Feather has a `hash` icon. If `leftIcon` is typed to a narrower set, use `"key"`.
- `maxLength` is `RESET_CODE_LENGTH + 2`, so a pasted "123 456" or "123-456" isn't cut off before normalization.

- [ ] **Step 4: Run, expect PASS**

Run: `npx vitest run client/screens/__tests__/ResetPasswordScreen.test.tsx client/screens/__tests__/ForgotPasswordScreen.test.tsx`
Expected: all pass.

- [ ] **Step 5: Commit**

Message: `feat(client): Reset Password screen with code autofill and resend cooldown` / Co-Authored-By line.
Run: `git add client/screens/ResetPasswordScreen.tsx client/screens/__tests__/ResetPasswordScreen.test.tsx && git commit -F <scratchpad>/commit-msg-reset-t11.txt`

---

### Task 12: Design and device verification

**Files:** none new (fixes go to the screen files from Tasks 10–11).

- [ ] **Step 1: Accessibility lint**

Run: `npm run lint:a11y`
Expected: no new findings in `ForgotPasswordScreen.tsx`, `ResetPasswordScreen.tsx`, or `LoginScreen.tsx`.

- [ ] **Step 2: Check the API IP first** (memory rule, before any simulator work).

Run: `curl -s "$EXPO_PUBLIC_DOMAIN/api/health"` (from the env the dev client uses)
Expected: a healthy JSON response. If it fails, fix the IP before going further.

- [ ] **Step 3: Visual check in the iOS Simulator** — invoke `verify-ui` for Login, ForgotPassword, and ResetPassword, each in **light and dark** mode, on the smallest available iPhone simulator. Also capture ResetPassword with the keyboard up and the Confirm field focused (Review Focus item 5). Assert for each:
- no raw-hex colors are visible as off-theme blocks;
- the "Forgot password?" link uses the link color;
- the countdown label reads correctly;
- the Reset button stays reachable with the keyboard up.

Fix anything found, re-run the screen's tests, and commit the fixes with the message `fix(client): reset screens polish from simulator check`.

- [ ] **Step 4: No local email end-to-end.** Local dev has no Resend key, so no code email is ever sent, and the codes are never logged by design. Don't add a logging fallback. The gates are the real-database storage tests (Task 3), the route tests (Task 6), and the real-middleware revocation test (Task 8). The full flow is checked on device after the preview OTA (Task 13, step 5). State this in the PR.

---

### Task 13: Review, PR, migration ordering, codify

- [ ] **Step 1: Push the branch** (the push hook runs `preflight:fast` and stamps HEAD)

Run: `git push -u origin feat/password-reset`
Expected: the preflight passes and the push succeeds. On failure, fix the reported step (only failed-step output is shown).

- [ ] **Step 2: One review pass with the roster** — commit everything first (memory rule: never dispatch a reviewer into uncommitted work). Dispatch in parallel, using the `docs/AI_WORKFLOW.md` → Review Policy dispatch prompt **verbatim**, with `REVIEWED-SHA` on the same line:
- `code-reviewer` (baseline)
- `security-auditor`: explicitly ask it to rule on the three §8 accepted risks (residual timing on reset, the 24 h targeted lockout, out-of-order code emails), and to confirm that the forgot and reset responses are byte-identical for real vs unknown emails.
- `server-reviewer` (routes, storage predicates, migration)
- `mobile-reviewer` (screens, a11y, theming)

Adjudicate each finding separately. Fix the real ones, then re-push.

- [ ] **Step 3: Open the PR** (GitHub MCP `create_pull_request`; labels `security`, `api`, `react-native`; **do not arm auto-merge**). The body includes:
- the spec link (local path), the deviations section from this plan, and the Task 8 positive-control results;
- **Ordering:** "Apply `migrations/0015_users_password_reset.sql` to production BEFORE merging." The owner runs it, since prod access goes through the owner via `!`;
- **Before production OTA:** support@ocrecipes.app exists;
- closing the todo: move `todos/P1-2026-09-26-no-password-reset-or-account-recovery.md` to `todos/archive/` in this PR, with an Updates entry.

- [ ] **Step 4: After the owner applies the migration and CI is green**, merge via MCP `merge_pull_request` with `expectedHeadSha` (squash). Railway deploys the server.

- [ ] **Step 5: Preview OTA** — `npm run update:preview -- --message "password reset + sign in by email"`, but only after the owner says go (an OTA is outward-facing). Then ask the owner to run the on-device smoke test: request a code → receive the email → reset → another signed-in device gets signed out → sign in by email.

- [ ] **Step 6: Codify** — run `/codify`. Candidate solution docs:
  - "a password reset must cancel every outstanding identity-changing credential (stateless change-email JWT ignores tokenVersion)";
  - "an in-memory issuance cap resets on every deploy; at this repo's merge rate it multiplies brute-force bounds — keep security caps durable";
  - "a shared per-recipient email cap is a budget an attacker can drain — security mail needs its own bucket".

---

## Self-Review Notes

- **Spec coverage:**

  | Spec section                           | Task(s)                             |
  | -------------------------------------- | ----------------------------------- |
  | §2 flow                                | 10, 11                              |
  | §3 columns, SafeUser, response shaping | 1                                   |
  | §3 death table                         | 3                                   |
  | §4.1                                   | 5, 6                                |
  | §4.2                                   | 3, 5, 6                             |
  | §4.3                                   | 5, 7                                |
  | §4.4                                   | 2, 4                                |
  | §4.5                                   | 5, 6                                |
  | §4.6                                   | 3 (durable caps)                    |
  | §5.1                                   | 10, 11                              |
  | §5.2                                   | 10 step 1, 12                       |
  | §5.3                                   | 9 (deviation 1)                     |
  | §6 server                              | 1–8                                 |
  | §6 client                              | 9–11                                |
  | §7                                     | 13                                  |
  | §8 risks                               | 13 step 2 (security-auditor ruling) |

- **Placeholders:** Task 12 step 4 is explicitly optional, with a stated fallback. Every code step has its code.
- **Type consistency:** `reservePasswordResetAttempt` returns `{ id, username, email, resetCodeHash }`, and Tasks 3, 6 and 8 all use that shape. `completePasswordReset(userId, matchedHash, newPasswordHash)` takes the same argument order in Tasks 3 and 6. `sendSignupAttemptNotice(to, username)` matches in Task 4 and its call site.
- **Review Focus:** all five items are pinned to tasks (3, 5/6, 9, 3/6, 12).
