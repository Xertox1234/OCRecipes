# Change Password (signed in) Implementation Plan

> **STATUS: PARTLY SUPERSEDED.** The password rule in this plan (15 characters, or 8 with two-step) was overruled: the minimum is 8 for everyone. Read the current code for the rule, not this plan. See `docs/OWNER_RULINGS.md` → Auth (2026-10-12).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A signed-in person can set a new password by proving who they are with their current password, a fresh Google/Apple confirmation, or a code emailed to them — and a stranger who knows only their email cannot block it.

**Architecture:** Two signed-in server routes in a new `server/routes/auth-password.ts` (send a code; change the password) over a new `password_change_codes` table (migration `0022`) and a new storage module `server/storage/password-change.ts`. The existing `reauthenticate()`, `secondFactorForPasswordProof()`, `checkNewPassword()` and `issueSession()` do the proof, two-step, policy and session work. The app gets a `ChangePasswordScreen` in the Profile stack, opened from Sign-in methods, backed by two new `useAuth` calls.

**Tech Stack:** Express + Zod + Drizzle/Postgres (server); Expo/React Native + TanStack Query (app); Vitest + supertest (tests).

**Spec:** `docs/superpowers/specs/2026-10-11-change-password-design.md` (local-only, gitignored — read it before starting).

## Global Constraints

- **Auth is high-risk:** implemented by hand, strict TDD (each test seen failing first). Never delegated to the kimi cheap-worker scripts.
- **Git:** feature branch + PR, never `main`; no destructive git; in a worktree use `/usr/bin/git`; commit messages written to a file and passed with `-F`; end each with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Two PRs:** server (Tasks 1–7) then app (Tasks 8–11). Both `security`-labelled; owner says yes before merge.
- **Migration 0022 is applied on prod by the owner BEFORE the server PR merges**; merge only on a non-null `to_regclass('public.password_change_codes')` pasted output. The owner runs prod commands in the VS Code terminal (the extension's `!` does not execute).
- **Code limits (spec §4.2):** 15-minute code lifetime; 5 wrong guesses per code; 5 codes per account per fixed 24 h window starting at the first code.
- **Password rules:** `checkNewPassword(newPassword, mfa ? PASSWORD_MIN_WITH_MFA : PASSWORD_MIN_SINGLE_FACTOR, mfa ? "mfa" : "single_factor")` — 15+, or 8+ with two-step; breach-checked.
- **Messages (spec §3), verbatim:**
  - wrong current password / failed Google-Apple check → `That didn't match. Try again.`
  - wrong/expired/used-up code → `That code didn't work. Request a new one.`
  - code limit → `You've requested too many codes today. Try again tomorrow, or use Google/Apple.`
  - version moved mid-request → `Please sign in again.`
- **React Compiler:** no `?.`, `&&` or ternary inside a `try` block in client code.
- **CI is the source of truth** — run only the targeted tests named in each step; the pre-push `preflight:fast` gate runs on push.

## Review Focus

1. **A pending email change** — the person changed their email and hasn't confirmed it: the code must go to the account's current address, never the pending one. → Task 5 test "sends to the current address, never pendingEmail".
2. **Requesting a second code** while one is live: the new code replaces the old, the old stops working, and guesses start again from 0. → Task 2 test "a new code replaces the live one".
3. **A wrong two-step code after a right emailed code**: the emailed code must not be consumed — the person retries with the same email code. → Task 6 test "wrong two-step code: emailed code survives".
4. **A password-less account with two-step on** using the emailed code: it still needs the authenticator code (no back door through "Set a password"). → Task 6 test "password-less + two-step: emailCode needs the code".
5. **Double-tapping Save** or leaving the screen mid-request: one request at a time, and a late reply never replaces a newer sign-in on the phone. → Task 9 stale-reply test and Task 10 submit-guard test.

---

## PR 1 — Server

Setup (once, before Task 1), from the main checkout:

```bash
cd /Users/williamtower/projects/OCRecipes
/usr/bin/git fetch -q origin
/usr/bin/git worktree add -b feat/change-password-server .worktrees/change-password-server origin/main
cd .worktrees/change-password-server
bash .claude/hooks/worktree-deps.sh
bash scripts/declare-worktree.sh "$(/usr/bin/git rev-parse --show-toplevel)"
```

### Task 1: Table, migration 0022, constants and code hash

**Files:**

- Create: `shared/constants/password-change.ts`
- Modify: `shared/schema.ts` (add `passwordChangeCodes` right after `socialLinkGuesses`)
- Create: `migrations/0022_password_change_codes.sql`
- Modify: `server/lib/password-reset-code.ts` (add `hashChangeCode`, `changeCodeMatches`)
- Test: `server/lib/__tests__/password-reset-code.test.ts` (extend; create if absent)

**Interfaces:**

- Produces: `CHANGE_CODE_TTL_MINUTES = 15`, `CHANGE_CODE_MAX_ATTEMPTS = 5`, `CHANGE_CODE_DAILY_ISSUE_CAP = 5` (from `@shared/constants/password-change`); table `passwordChangeCodes` with columns `userId`, `codeHash`, `expiresAt`, `attempts`, `issueCount`, `windowStart`; `hashChangeCode(userId: string, code: string): string`; `changeCodeMatches(userId: string, code: string, storedHash: string): boolean`.

- [ ] **Step 1: Write the failing tests**

Check first: `ls server/lib/__tests__/password-reset-code.test.ts`. If it exists, append the `describe` below; if not, create the file with these imports.

```ts
import { describe, it, expect } from "vitest";
import {
  hashResetCode,
  hashChangeCode,
  changeCodeMatches,
} from "../password-reset-code";

describe("change-password code hash", () => {
  const user = "11111111-1111-1111-1111-111111111111";

  it("never equals the reset-code hash for the same user and digits", () => {
    expect(hashChangeCode(user, "123456")).not.toBe(
      hashResetCode(user, "123456"),
    );
  });

  it("matches the code it was made from, and only that code", () => {
    const stored = hashChangeCode(user, "123456");
    expect(changeCodeMatches(user, "123456", stored)).toBe(true);
    expect(changeCodeMatches(user, "123457", stored)).toBe(false);
    expect(changeCodeMatches("someone-else", "123456", stored)).toBe(false);
  });

  it("a reset-code hash is never accepted as a change code", () => {
    expect(
      changeCodeMatches(user, "123456", hashResetCode(user, "123456")),
    ).toBe(false);
  });

  it("a malformed stored hash is false, not a throw", () => {
    expect(changeCodeMatches(user, "123456", "abc")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/lib/__tests__/password-reset-code.test.ts`
Expected: FAIL — `hashChangeCode is not a function` (or an import error).

- [ ] **Step 3: Implement**

`shared/constants/password-change.ts`:

```ts
/** Code emailed for a signed-in password change (change-password spec §4.2). */
export const CHANGE_CODE_TTL_MINUTES = 15;
/** Wrong guesses allowed per live code. */
export const CHANGE_CODE_MAX_ATTEMPTS = 5;
/** Codes per account per fixed 24 h window, starting at the first code. */
export const CHANGE_CODE_DAILY_ISSUE_CAP = 5;
```

Append to `server/lib/password-reset-code.ts`:

```ts
/**
 * HMAC for the signed-in change-password code (change-password spec §4.2).
 * Same key as reset codes, but a distinct `pw-change:` prefix: a change-code
 * hash never equals a reset-code hash for the same user and digits, so one
 * kind of code can never be spent as the other.
 */
export function hashChangeCode(userId: string, code: string): string {
  return crypto
    .createHmac("sha256", HMAC_KEY)
    .update(`pw-change:${userId}:${code}`)
    .digest("hex");
}

/** Constant-time comparison of a submitted change code against the stored HMAC. */
export function changeCodeMatches(
  userId: string,
  code: string,
  storedHash: string,
): boolean {
  const expected = Buffer.from(hashChangeCode(userId, code), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (stored.length !== expected.length) {
    // Burn the same compare cost, then fail — malformed input is never a match.
    crypto.timingSafeEqual(expected, expected);
    return false;
  }
  return crypto.timingSafeEqual(expected, stored);
}
```

In `shared/schema.ts`, directly after the `socialLinkGuesses` table:

```ts
/**
 * Code emailed for a signed-in password change (change-password spec §4.2).
 * Its own table — not the Forgot password columns on users — so a stranger
 * who knows only the email can neither use up its limit nor overwrite the
 * code. One row per user; the issue window survives a password change.
 */
export const passwordChangeCodes = pgTable("password_change_codes", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** HMAC of the live code (hashChangeCode); NULL when none. */
  codeHash: text("code_hash"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  /** Wrong guesses on the live code. */
  attempts: integer("attempts").default(0).notNull(),
  /** Codes issued in the current window. */
  issueCount: integer("issue_count").default(0).notNull(),
  /** Start of the fixed 24 h issue window. */
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
});
```

`migrations/0022_password_change_codes.sql`:

```sql
-- Signed-in password change: the emailed code (change-password spec §4.2).
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle reads and writes password_change_codes on every code request and
-- every email-code password change, so the table must exist before that
-- bundle deploys. Applying early is safe for the old bundle: a new table it
-- never reads. Additive and idempotent; no backfill. Constraint names match
-- Drizzle's.

CREATE TABLE IF NOT EXISTS password_change_codes (
  user_id varchar NOT NULL PRIMARY KEY
    CONSTRAINT password_change_codes_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  code_hash text,
  expires_at timestamp with time zone,
  attempts integer DEFAULT 0 NOT NULL,
  issue_count integer DEFAULT 0 NOT NULL,
  window_start timestamp with time zone NOT NULL
);
```

Apply it to the LOCAL dev database only (the storage tests in Task 2 need it). The script refuses anything but localhost:

```bash
node -e 'require("dotenv").config({quiet:true}); const {Client}=require("pg"); const fs=require("fs"); (async()=>{const u=new URL(process.env.DATABASE_URL); if(u.hostname!=="localhost") throw new Error("not local"); const c=new Client({connectionString:process.env.DATABASE_URL}); await c.connect(); await c.query(fs.readFileSync(process.cwd()+"/migrations/0022_password_change_codes.sql","utf8")); console.log((await c.query("select to_regclass($1) t",["password_change_codes"])).rows[0]); await c.end();})().catch(e=>{console.error(e.message);process.exit(1)})'
```

Expected output: `{ t: 'password_change_codes' }`

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/lib/__tests__/password-reset-code.test.ts && npx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add shared/constants/password-change.ts shared/schema.ts migrations/0022_password_change_codes.sql server/lib/password-reset-code.ts server/lib/__tests__/password-reset-code.test.ts
/usr/bin/git commit -F <msg-file>   # "feat(auth): password_change_codes table (migration 0022) and a domain-separated change-code hash"
```

### Task 2: Storage — issue and reserve a change code

**Files:**

- Create: `server/storage/password-change.ts`
- Modify: `server/storage/index.ts` (export the new functions)
- Test: `server/storage/__tests__/password-change.test.ts` (new)

**Interfaces:**

- Consumes: `passwordChangeCodes` table and the three constants (Task 1); `issuePasswordResetCode` (existing, `server/storage/password-reset.ts`).
- Produces: `issuePasswordChangeCode(userId: string, codeHash: string): Promise<boolean>`; `reservePasswordChangeAttempt(userId: string): Promise<string | undefined>` (the live code hash, or `undefined`). Exposed as `storage.issuePasswordChangeCode` / `storage.reservePasswordChangeAttempt`.

- [ ] **Step 1: Write the failing tests**

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
import { eq, sql } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { passwordChangeCodes } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const pc = await import("../password-change");
const reset = await import("../password-reset");

let tx: NodePgDatabase<typeof schema>;

describe("password change codes (real DB)", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  // The spec's success criterion (§1): a stranger exhausting Forgot password
  // cannot block the signed-in path, and the reverse.
  it("an exhausted Forgot password cap does not block a change code", async () => {
    const user = await createTestUser(tx);
    let issued = 0;
    while (await reset.issuePasswordResetCode(user.id, `r${issued}`)) issued++;
    expect(issued).toBe(6);
    expect(await pc.issuePasswordChangeCode(user.id, "c1")).toBe(true);
  });

  it("an exhausted change-code cap does not block a Forgot password code", async () => {
    const user = await createTestUser(tx);
    for (let i = 0; i < 5; i++)
      expect(await pc.issuePasswordChangeCode(user.id, `c${i}`)).toBe(true);
    expect(await pc.issuePasswordChangeCode(user.id, "c5")).toBe(false);
    expect(await reset.issuePasswordResetCode(user.id, "r0")).toBe(true);
  });

  it("5 codes per window; once 24 h have passed, issuing starts again at 1", async () => {
    const user = await createTestUser(tx);
    for (let i = 0; i < 5; i++)
      await pc.issuePasswordChangeCode(user.id, `c${i}`);
    expect(await pc.issuePasswordChangeCode(user.id, "c5")).toBe(false);
    await tx
      .update(passwordChangeCodes)
      .set({ windowStart: sql`now() - interval '25 hours'` })
      .where(eq(passwordChangeCodes.userId, user.id));
    expect(await pc.issuePasswordChangeCode(user.id, "c6")).toBe(true);
    const [row] = await tx
      .select()
      .from(passwordChangeCodes)
      .where(eq(passwordChangeCodes.userId, user.id));
    expect(row.issueCount).toBe(1);
  });

  it("reserve returns the live hash and counts the guess; the 6th is refused", async () => {
    const user = await createTestUser(tx);
    await pc.issuePasswordChangeCode(user.id, "hash-1");
    for (let i = 0; i < 5; i++)
      expect(await pc.reservePasswordChangeAttempt(user.id)).toBe("hash-1");
    expect(await pc.reservePasswordChangeAttempt(user.id)).toBeUndefined();
  });

  it("an expired code is not reservable", async () => {
    const user = await createTestUser(tx);
    await pc.issuePasswordChangeCode(user.id, "hash-1");
    await tx
      .update(passwordChangeCodes)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(passwordChangeCodes.userId, user.id));
    expect(await pc.reservePasswordChangeAttempt(user.id)).toBeUndefined();
  });

  it("no code at all → undefined", async () => {
    const user = await createTestUser(tx);
    expect(await pc.reservePasswordChangeAttempt(user.id)).toBeUndefined();
  });

  // Review Focus 2.
  it("a new code replaces the live one and resets its guesses", async () => {
    const user = await createTestUser(tx);
    await pc.issuePasswordChangeCode(user.id, "hash-1");
    for (let i = 0; i < 5; i++) await pc.reservePasswordChangeAttempt(user.id);
    await pc.issuePasswordChangeCode(user.id, "hash-2");
    expect(await pc.reservePasswordChangeAttempt(user.id)).toBe("hash-2");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/storage/__tests__/password-change.test.ts`
Expected: FAIL — cannot resolve `../password-change`.

- [ ] **Step 3: Implement** `server/storage/password-change.ts`

```ts
import { and, eq, gt, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { passwordChangeCodes } from "@shared/schema";
import {
  CHANGE_CODE_DAILY_ISSUE_CAP,
  CHANGE_CODE_MAX_ATTEMPTS,
  CHANGE_CODE_TTL_MINUTES,
} from "@shared/constants/password-change";

/**
 * Store a new change-password code (replacing any live one, guesses back to
 * 0) IF the account is under CHANGE_CODE_DAILY_ISSUE_CAP codes in its fixed
 * 24 h window. One atomic upsert; expiry on the DB clock. Only a signed-in
 * session reaches this (change-password spec §4.1), so a stranger can't use
 * the cap up. Returns false at the cap (nothing stored).
 */
export async function issuePasswordChangeCode(
  userId: string,
  codeHash: string,
): Promise<boolean> {
  const windowExpired = sql`${passwordChangeCodes.windowStart} <= now() - interval '24 hours'`;
  const expiresAt = sql`now() + (${CHANGE_CODE_TTL_MINUTES} * interval '1 minute')`;
  const [row] = await db
    .insert(passwordChangeCodes)
    .values({
      userId,
      codeHash,
      expiresAt,
      attempts: 0,
      issueCount: 1,
      windowStart: sql`now()`,
    })
    .onConflictDoUpdate({
      target: passwordChangeCodes.userId,
      set: {
        codeHash,
        expiresAt,
        attempts: 0,
        issueCount: sql`CASE WHEN ${windowExpired} THEN 1 ELSE ${passwordChangeCodes.issueCount} + 1 END`,
        windowStart: sql`CASE WHEN ${windowExpired} THEN now() ELSE ${passwordChangeCodes.windowStart} END`,
      },
      setWhere: sql`${windowExpired} OR ${passwordChangeCodes.issueCount} < ${CHANGE_CODE_DAILY_ISSUE_CAP}`,
    })
    .returning({ userId: passwordChangeCodes.userId });
  return Boolean(row);
}

/**
 * Use up one guess against the live code, atomically (concurrent guesses
 * serialize on the row, so attempts never pass the cap). Returns the stored
 * hash to compare against, or undefined when there is no live, unexpired,
 * under-cap code.
 */
export async function reservePasswordChangeAttempt(
  userId: string,
): Promise<string | undefined> {
  const [row] = await db
    .update(passwordChangeCodes)
    .set({ attempts: sql`${passwordChangeCodes.attempts} + 1` })
    .where(
      and(
        eq(passwordChangeCodes.userId, userId),
        isNotNull(passwordChangeCodes.codeHash),
        gt(passwordChangeCodes.expiresAt, sql`now()`),
        lt(passwordChangeCodes.attempts, CHANGE_CODE_MAX_ATTEMPTS),
      ),
    )
    .returning({ codeHash: passwordChangeCodes.codeHash });
  return row?.codeHash ?? undefined;
}
```

In `server/storage/index.ts`: add `import * as passwordChange from "./password-change";` beside the other module imports, and inside the `storage` object (next to the password-reset entries):

```ts
  issuePasswordChangeCode: passwordChange.issuePasswordChangeCode,
  reservePasswordChangeAttempt: passwordChange.reservePasswordChangeAttempt,
```

(Check how `index.ts` imports `password-reset` and follow that exact style.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/storage/__tests__/password-change.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add server/storage/password-change.ts server/storage/index.ts server/storage/__tests__/password-change.test.ts
/usr/bin/git commit -F <msg-file>   # "feat(auth): issue and reserve change-password codes (own durable caps)"
```

### Task 3: Storage — commit the password change

**Files:**

- Modify: `server/storage/password-change.ts`
- Modify: `server/storage/index.ts`
- Test: `server/storage/__tests__/password-change.test.ts` (extend)

**Interfaces:**

- Consumes: Task 2's module; `CLEARED_RESET_CODE` (`server/storage/password-reset.ts`); `mfaTrustedDevices`, `users` (`@shared/schema`).
- Produces: `changePassword(opts: { userId: string; expectedTokenVersion: number; newPasswordHash: string; consumeCodeHash?: string }): Promise<number | undefined>` — the new `tokenVersion`, or `undefined` when the version moved or the code was already consumed. Exposed as `storage.changePassword`.

- [ ] **Step 1: Write the failing tests** (append inside the same `describe`; add `mfaTrustedDevices`, `users` to the `@shared/schema` import)

```ts
async function seed() {
  const user = await createTestUser(tx);
  await tx
    .update(users)
    .set({
      pendingEmail: "staged@example.com",
      resetCodeHash: "live-reset",
      resetCodeExpiresAt: sql`now() + interval '10 minutes'`,
    })
    .where(eq(users.id, user.id));
  await tx.insert(mfaTrustedDevices).values({
    userId: user.id,
    keyHash: `k-${user.id}`,
    expiresAt: sql`now() + interval '30 days'`,
  });
  return user;
}

it("changePassword: new hash, version+1, staged email + reset code + trusted phones gone", async () => {
  const user = await seed();
  const v = await pc.changePassword({
    userId: user.id,
    expectedTokenVersion: user.tokenVersion,
    newPasswordHash: "pv2$new",
  });
  expect(v).toBe(user.tokenVersion + 1);
  const [u] = await tx.select().from(users).where(eq(users.id, user.id));
  expect(u.password).toBe("pv2$new");
  expect(u.pendingEmail).toBeNull();
  expect(u.resetCodeHash).toBeNull();
  expect(u.emailVerified).toBe(user.emailVerified); // untouched (spec §4.2)
  const phones = await tx
    .select()
    .from(mfaTrustedDevices)
    .where(eq(mfaTrustedDevices.userId, user.id));
  expect(phones).toHaveLength(0);
});

it("changePassword refuses when the token version moved — nothing written", async () => {
  const user = await seed();
  expect(
    await pc.changePassword({
      userId: user.id,
      expectedTokenVersion: user.tokenVersion - 1,
      newPasswordHash: "pv2$new",
    }),
  ).toBeUndefined();
  const [u] = await tx.select().from(users).where(eq(users.id, user.id));
  expect(u.password).toBe(user.password);
  expect(u.pendingEmail).toBe("staged@example.com");
});

it("changePassword consumes the code; the same code a second time is refused and rolls back", async () => {
  const user = await createTestUser(tx);
  await pc.issuePasswordChangeCode(user.id, "hash-1");
  const v1 = await pc.changePassword({
    userId: user.id,
    expectedTokenVersion: user.tokenVersion,
    newPasswordHash: "pv2$a",
    consumeCodeHash: "hash-1",
  });
  expect(v1).toBe(user.tokenVersion + 1);
  expect(await pc.reservePasswordChangeAttempt(user.id)).toBeUndefined();
  // A second request racing with the same code, under the NEW version:
  expect(
    await pc.changePassword({
      userId: user.id,
      expectedTokenVersion: v1!,
      newPasswordHash: "pv2$b",
      consumeCodeHash: "hash-1",
    }),
  ).toBeUndefined();
  const [u] = await tx.select().from(users).where(eq(users.id, user.id));
  expect(u.password).toBe("pv2$a"); // rolled back, not overwritten
  expect(u.tokenVersion).toBe(v1);
});

it("the issue window survives a change (the cap persists)", async () => {
  const user = await createTestUser(tx);
  for (let i = 0; i < 5; i++)
    await pc.issuePasswordChangeCode(user.id, `c${i}`);
  await pc.changePassword({
    userId: user.id,
    expectedTokenVersion: user.tokenVersion,
    newPasswordHash: "pv2$a",
    consumeCodeHash: "c4",
  });
  expect(await pc.issuePasswordChangeCode(user.id, "c5")).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/storage/__tests__/password-change.test.ts`
Expected: FAIL — `pc.changePassword is not a function`.

- [ ] **Step 3: Implement** (append to `server/storage/password-change.ts`; extend the imports with `mfaTrustedDevices, users` and `CLEARED_RESET_CODE`)

```ts
import { CLEARED_RESET_CODE } from "./password-reset";
// (add mfaTrustedDevices, users to the @shared/schema import)

/** Thrown inside the transaction to roll it back when the code was already spent. */
class CodeAlreadyUsed extends Error {}

/**
 * Commit a signed-in password change in one transaction (change-password
 * spec §4.2): new hash, tokenVersion + 1 (signs out every other device),
 * a staged email change dropped, any Forgot password code cleared (as
 * completePasswordReset does), trusted phones forgotten — pinned to the
 * version the route checked, so a concurrent reset or sign-out wins.
 * With `consumeCodeHash`, the emailed code is spent in the same
 * transaction; a code already spent rolls everything back. emailVerified
 * is NOT touched: a password or Google/Apple proof says nothing about the
 * inbox. The change-code issue window is kept (its cap must persist).
 * Returns the new tokenVersion, or undefined (nothing written).
 */
export async function changePassword(opts: {
  userId: string;
  expectedTokenVersion: number;
  newPasswordHash: string;
  consumeCodeHash?: string;
}): Promise<number | undefined> {
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          password: opts.newPasswordHash,
          tokenVersion: sql`${users.tokenVersion} + 1`,
          pendingEmail: null,
          ...CLEARED_RESET_CODE,
        })
        .where(
          and(
            eq(users.id, opts.userId),
            eq(users.tokenVersion, opts.expectedTokenVersion),
          ),
        )
        .returning({ tokenVersion: users.tokenVersion });
      if (!row) return undefined;
      if (opts.consumeCodeHash !== undefined) {
        const [used] = await tx
          .update(passwordChangeCodes)
          .set({ codeHash: null, expiresAt: null })
          .where(
            and(
              eq(passwordChangeCodes.userId, opts.userId),
              eq(passwordChangeCodes.codeHash, opts.consumeCodeHash),
            ),
          )
          .returning({ userId: passwordChangeCodes.userId });
        if (!used) throw new CodeAlreadyUsed();
      }
      await tx
        .delete(mfaTrustedDevices)
        .where(eq(mfaTrustedDevices.userId, opts.userId));
      return row.tokenVersion;
    });
  } catch (err) {
    if (err instanceof CodeAlreadyUsed) return undefined;
    throw err;
  }
}
```

Add `changePassword: passwordChange.changePassword,` to `storage` in `server/storage/index.ts`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/storage/__tests__/password-change.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add server/storage/password-change.ts server/storage/index.ts server/storage/__tests__/password-change.test.ts
/usr/bin/git commit -F <msg-file>   # "feat(auth): commit a signed-in password change atomically, pinned to the checked version"
```

### Task 4: Email — the change-password code

**Files:**

- Modify: `server/services/email.ts` (add `sendPasswordChangeCode` after `sendPasswordResetCode`)
- Test: `server/services/__tests__/email.test.ts` (extend the "account-security bucket" describe)

**Interfaces:**

- Consumes: `CHANGE_CODE_TTL_MINUTES` (Task 1).
- Produces: `sendPasswordChangeCode(to: string, code: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
it("change-password code: the code, its lifetime, and a not-you warning", async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  const { sendPasswordChangeCode } = await import("../email");
  await sendPasswordChangeCode("r@x.com", "042917");
  const arg = mockSend.mock.calls[0][0];
  expect(arg.to).toBe("r@x.com");
  expect(arg.subject).toBe("Your OCRecipes code to change your password");
  expect(arg.html).toContain("042917");
  expect(arg.html).toContain("15 minutes");
  expect(arg.html).toContain("mailto:support@ocrecipes.com");
});

it("change-password code uses the account-security bucket (sent after general is exhausted)", async () => {
  vi.stubEnv("RESEND_API_KEY", "re_test");
  const { sendSignupAttemptNotice, sendPasswordChangeCode } = await import(
    "../email"
  );
  for (let i = 0; i < 6; i++)
    await sendSignupAttemptNotice("v@x.com", "victim");
  mockSend.mockClear();
  await sendPasswordChangeCode("v@x.com", "123456");
  expect(mockSend).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/services/__tests__/email.test.ts -t "change-password code"`
Expected: FAIL — `sendPasswordChangeCode is not a function`.

- [ ] **Step 3: Implement** (add `import { CHANGE_CODE_TTL_MINUTES } from "@shared/constants/password-change";` at the top)

```ts
/**
 * The code for a signed-in password change (change-password spec §4.1). Only
 * a signed-in session can trigger it, so the account-security bucket is safe
 * (attacker-triggered mail must not share it; this is not attacker-triggered).
 */
export async function sendPasswordChangeCode(
  to: string,
  code: string,
): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to, "account-security")) {
    // Never log the code — only the recipient.
    logger.warn(
      { to },
      "change-password code throttled (account-security cap)",
    );
    return;
  }
  const error = await sendWithRetry(resend, {
    from: EMAIL_FROM,
    to,
    subject: "Your OCRecipes code to change your password",
    html: `<p>Use this code in the app to change your OCRecipes password:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${escapeHtml(code)}</p>
<p>It expires in ${CHANGE_CODE_TTL_MINUTES} minutes. If you requested more than one code, use the one in the most recent email.</p>
<p>If you didn't ask for this, someone may be signed in to your account. Don't share the code, and contact <a href="mailto:support@ocrecipes.com">support@ocrecipes.com</a>.</p>`,
  });
  // Log only the Resend error — the payload (which holds the code) never.
  if (error)
    logger.error({ resendError: error }, "change-password code email failed");
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/services/__tests__/email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add server/services/email.ts server/services/__tests__/email.test.ts
/usr/bin/git commit -F <msg-file>   # "feat(auth): email for the signed-in change-password code"
```

### Task 5: Route — send a code

**Files:**

- Modify: `server/routes/_rate-limiters.ts` (add `changePasswordCodeLimiter`)
- Create: `server/routes/auth-password.ts`
- Modify: `server/routes.ts` (register it after `registerAuthUpgrade(app)`)
- Test: `server/routes/__tests__/auth-password.test.ts` (new)

**Interfaces:**

- Consumes: `storage.issuePasswordChangeCode` (Task 2), `sendPasswordChangeCode` (Task 4), `generateResetCode` + `hashChangeCode` (`server/lib/password-reset-code.ts`).
- Produces: `POST /api/auth/change-password/code` → `200 { status: "code_sent" }` | `429 RATE_LIMITED`. `register(app: Express)` exported from `auth-password.ts`.

- [ ] **Step 1: Write the failing tests** (`server/routes/__tests__/auth-password.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import bcrypt from "bcrypt";
import { storage } from "../../storage";
import { register } from "../auth-password";
import {
  requireAuth,
  invalidateTokenVersionCache,
} from "../../middleware/auth";
import {
  sendPasswordChangeCode,
  sendPasswordChangedNotice,
} from "../../services/email";
import { reauthenticate, issueSession } from "../auth-social";
import { createMockUser } from "../../__tests__/factories";
import { hashChangeCode } from "../../lib/password-reset-code";

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: () => false,
  storage: {
    getUserForAuth: vi.fn(),
    issuePasswordChangeCode: vi.fn(),
    reservePasswordChangeAttempt: vi.fn(),
    changePassword: vi.fn(),
    listIdentities: vi.fn(),
  },
}));
vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");
vi.mock("../../lib/pwned-password", () => ({
  isBreached: vi.fn().mockResolvedValue(false),
}));
vi.mock("../../services/email", () => ({
  sendPasswordChangeCode: vi.fn(),
  sendPasswordChangedNotice: vi.fn(),
}));
// reauthenticate and issueSession have their own tests in auth-social; here
// they are seams so each proof branch and the mint can be asserted.
vi.mock("../auth-social", async (orig) => ({
  ...(await orig<typeof import("../auth-social")>()),
  reauthenticate: vi.fn(),
  issueSession: vi.fn(),
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
const post = (path: string, body: object = {}) =>
  request(app())
    .post(`/api/auth/${path}`)
    .set("Authorization", "Bearer t")
    .send(body);

const LONG = "a-long-new-passphrase-1"; // 23
let user: ReturnType<typeof createMockUser>;

beforeEach(async () => {
  vi.resetAllMocks();
  vi.mocked(requireAuth).mockImplementation(async (req, _res, next) => {
    req.userId = "1";
    next();
  });
  user = createMockUser({
    id: "1",
    email: "owner@example.com",
    pendingEmail: "staged@example.com",
    tokenVersion: 4,
    mfaEnabledAt: null,
    password: await bcrypt.hash("current-pass-123", 4),
  });
  vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
  vi.mocked(storage.issuePasswordChangeCode).mockResolvedValue(true);
  vi.mocked(storage.listIdentities).mockResolvedValue([]);
  vi.mocked(sendPasswordChangeCode).mockResolvedValue(undefined);
  vi.mocked(sendPasswordChangedNotice).mockResolvedValue(undefined);
  mockVerifySecondFactor.mockResolvedValue({ ok: true });
});

describe("POST /api/auth/change-password/code", () => {
  // Review Focus 1.
  it("stores a hashed code and sends it to the current address, never pendingEmail", async () => {
    const res = await post("change-password/code");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "code_sent" });
    const [uid, stored] = vi.mocked(storage.issuePasswordChangeCode).mock
      .calls[0];
    expect(uid).toBe("1");
    const [to, code] = vi.mocked(sendPasswordChangeCode).mock.calls[0];
    expect(to).toBe("owner@example.com");
    expect(code).toMatch(/^\d{6}$/);
    expect(stored).toBe(hashChangeCode("1", code)); // only the hash is stored
  });

  it("at the cap → 429 with the plain message, nothing sent", async () => {
    vi.mocked(storage.issuePasswordChangeCode).mockResolvedValue(false);
    const res = await post("change-password/code");
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error:
        "You've requested too many codes today. Try again tomorrow, or use Google/Apple.",
      code: "RATE_LIMITED",
    });
    expect(sendPasswordChangeCode).not.toHaveBeenCalled();
  });

  it("the user vanished → 404", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(undefined);
    expect((await post("change-password/code")).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/__tests__/auth-password.test.ts`
Expected: FAIL — cannot resolve `../auth-password`.

- [ ] **Step 3: Implement**

In `server/routes/_rate-limiters.ts`, after `reauthLimiter`:

```ts
/**
 * Change-password code requests (change-password spec §4.1): a burst guard
 * only — the real bound is the durable 5-per-24h cap in password_change_codes.
 */
export const changePasswordCodeLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000,
  max: 3,
  message: "Too many code requests. Please wait.",
});
```

`server/routes/auth-password.ts`:

```ts
import type { Express, Response } from "express";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { fireAndForget } from "../lib/fire-and-forget";
import { handleRouteError } from "./_helpers";
import { changePasswordCodeLimiter } from "./_rate-limiters";
import { generateResetCode, hashChangeCode } from "../lib/password-reset-code";
import { sendPasswordChangeCode } from "../services/email";

export const CODE_LIMIT_MESSAGE =
  "You've requested too many codes today. Try again tomorrow, or use Google/Apple.";

// Signed-in password change (change-password spec, 2026-10-11): a person who
// can prove who they are another way can always set a new password, and a
// stranger who knows only the email can't block it (auth audit L5).
export function register(app: Express): void {
  // Email a code to the account's CURRENT address (never pendingEmail).
  app.post(
    "/api/auth/change-password/code",
    requireAuth,
    changePasswordCodeLimiter,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const user = await storage.getUserForAuth(req.userId);
        if (!user) {
          return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
        }
        const code = generateResetCode();
        if (
          !(await storage.issuePasswordChangeCode(
            user.id,
            hashChangeCode(user.id, code),
          ))
        ) {
          return sendError(
            res,
            429,
            CODE_LIMIT_MESSAGE,
            ErrorCode.RATE_LIMITED,
          );
        }
        fireAndForget(
          "password-change-code",
          sendPasswordChangeCode(user.email, code),
        );
        res.json({ status: "code_sent" });
      } catch (error) {
        handleRouteError(res, error, "send password change code");
      }
    },
  );
}
```

In `server/routes.ts`: `import { register as registerAuthPassword } from "./routes/auth-password";` beside the other auth imports, and `registerAuthPassword(app);` on the line after `registerAuthUpgrade(app);`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/routes/__tests__/auth-password.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add server/routes/_rate-limiters.ts server/routes/auth-password.ts server/routes.ts server/routes/__tests__/auth-password.test.ts
/usr/bin/git commit -F <msg-file>   # "feat(auth): signed-in route to email a change-password code"
```

### Task 6: Route — change the password

**Files:**

- Modify: `server/routes/_schemas.ts` (add `changePasswordSchema`)
- Modify: `server/routes/auth-password.ts`
- Test: `server/routes/__tests__/auth-password.test.ts` (extend)

**Interfaces:**

- Consumes: `reauthProofSchema`, `secondFactorSchema`, `newPasswordSchema` (existing, `_schemas.ts`); `reauthenticate`, `issueSession`, `HttpFailure` (`./auth-social`); `secondFactorForPasswordProof` (`../lib/mfa/password-proof-gate`); `checkNewPassword` (`./_password-rules`); `hashPassword` (`../lib/password-hash`); `changeCodeMatches` (Task 1); `storage.reservePasswordChangeAttempt` / `storage.changePassword` (Tasks 2–3); `invalidateTokenVersionCache`; `sendPasswordChangedNotice`; `reauthLimiter`.
- Produces: `POST /api/auth/change-password` → `200 { status: "signed_in", user, token, replacementRecoveryCode? }` | `400 VALIDATION_ERROR | INVALID_RESET_CODE | PASSWORD_TOO_SHORT | PASSWORD_BREACHED` | `401 UNAUTHORIZED | INVALID_SECOND_FACTOR | TOKEN_REVOKED` | `403 SECOND_FACTOR_REQUIRED` | `404` | `503 MFA_UNAVAILABLE`.

- [ ] **Step 1: Write the failing tests** (append to `auth-password.test.ts`)

```ts
const SESSION = {
  status: "signed_in" as const,
  user: { id: "1" },
  token: "jwt-new",
};

describe("POST /api/auth/change-password", () => {
  beforeEach(() => {
    vi.mocked(reauthenticate).mockResolvedValue(true);
    vi.mocked(storage.changePassword).mockResolvedValue(5);
    vi.mocked(issueSession).mockResolvedValue(SESSION as never);
  });

  it("current password → changed, others signed out, this phone gets a session under the new version", async () => {
    const res = await post("change-password", {
      proof: { password: "current-pass-123" },
      newPassword: LONG,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(SESSION);
    expect(reauthenticate).toHaveBeenCalledWith("1", user.password, {
      password: "current-pass-123",
    });
    const call = vi.mocked(storage.changePassword).mock.calls[0][0];
    expect(call.userId).toBe("1");
    expect(call.expectedTokenVersion).toBe(4); // the version the route loaded
    expect(call.consumeCodeHash).toBeUndefined();
    expect(call.newPasswordHash).not.toBe(LONG); // hashed, never stored raw
    expect(invalidateTokenVersionCache).toHaveBeenCalledWith("1");
    expect(issueSession).toHaveBeenCalledWith("1", 5);
    await vi.waitFor(() =>
      expect(sendPasswordChangedNotice).toHaveBeenCalledWith(
        "owner@example.com",
        user.username,
        [],
      ),
    );
  });

  it("Google/Apple proof is passed through to reauthenticate unchanged", async () => {
    const proof = { provider: "google", idToken: "id", nonce: "n" };
    const res = await post("change-password", { proof, newPassword: LONG });
    expect(res.status).toBe(200);
    expect(reauthenticate).toHaveBeenCalledWith("1", user.password, proof);
  });

  it("wrong current password / failed Google check → 401, nothing written", async () => {
    vi.mocked(reauthenticate).mockResolvedValue(false);
    const res = await post("change-password", {
      proof: { password: "nope" },
      newPassword: LONG,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "That didn't match. Try again.",
      code: "UNAUTHORIZED",
    });
    expect(storage.changePassword).not.toHaveBeenCalled();
  });

  it("emailed code → changed, and that code is consumed in the commit", async () => {
    vi.mocked(storage.reservePasswordChangeAttempt).mockResolvedValue(
      hashChangeCode("1", "123456"),
    );
    const res = await post("change-password", {
      proof: { emailCode: "123456" },
      newPassword: LONG,
    });
    expect(res.status).toBe(200);
    expect(reauthenticate).not.toHaveBeenCalled();
    expect(
      vi.mocked(storage.changePassword).mock.calls[0][0].consumeCodeHash,
    ).toBe(hashChangeCode("1", "123456"));
  });

  it.each([
    ["wrong code", hashChangeCode("1", "999999")],
    ["no live code", undefined],
  ])("%s → 400 INVALID_RESET_CODE, nothing written", async (_label, stored) => {
    vi.mocked(storage.reservePasswordChangeAttempt).mockResolvedValue(stored);
    const res = await post("change-password", {
      proof: { emailCode: "123456" },
      newPassword: LONG,
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: "That code didn't work. Request a new one.",
      code: "INVALID_RESET_CODE",
    });
    expect(storage.changePassword).not.toHaveBeenCalled();
  });

  describe("two-step on", () => {
    beforeEach(() => {
      user.mfaEnabledAt = new Date();
    });

    it("password proof without the code → 403 SECOND_FACTOR_REQUIRED", async () => {
      const res = await post("change-password", {
        proof: { password: "current-pass-123" },
        newPassword: LONG,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("SECOND_FACTOR_REQUIRED");
      expect(storage.changePassword).not.toHaveBeenCalled();
    });

    it("emailed code also needs the authenticator code", async () => {
      vi.mocked(storage.reservePasswordChangeAttempt).mockResolvedValue(
        hashChangeCode("1", "123456"),
      );
      const res = await post("change-password", {
        proof: { emailCode: "123456" },
        newPassword: LONG,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("SECOND_FACTOR_REQUIRED");
    });

    it("Google/Apple proof needs no authenticator code", async () => {
      const res = await post("change-password", {
        proof: { provider: "apple", idToken: "id", nonce: "n" },
        newPassword: LONG,
      });
      expect(res.status).toBe(200);
      expect(mockVerifySecondFactor).not.toHaveBeenCalled();
    });

    // Review Focus 3.
    it("wrong two-step code: 401 and the emailed code is NOT consumed", async () => {
      vi.mocked(storage.reservePasswordChangeAttempt).mockResolvedValue(
        hashChangeCode("1", "123456"),
      );
      mockVerifySecondFactor.mockResolvedValue({
        ok: false,
        reason: "invalid",
      });
      const res = await post("change-password", {
        proof: { emailCode: "123456", secondFactor: { code: "000000" } },
        newPassword: LONG,
      });
      expect(res.status).toBe(401);
      expect(res.body.code).toBe("INVALID_SECOND_FACTOR");
      expect(storage.changePassword).not.toHaveBeenCalled();
    });

    it("a spent recovery code's replacement rides the success answer", async () => {
      mockVerifySecondFactor.mockResolvedValue({
        ok: true,
        replacementRecoveryCode: "new-recovery-1",
      });
      const res = await post("change-password", {
        proof: {
          password: "current-pass-123",
          secondFactor: { recoveryCode: "old-1" },
        },
        newPassword: "eight-ch", // 8 is enough with two-step
      });
      expect(res.status).toBe(200);
      expect(res.body.replacementRecoveryCode).toBe("new-recovery-1");
    });

    it("…and a later failure still hands it back", async () => {
      mockVerifySecondFactor.mockResolvedValue({
        ok: true,
        replacementRecoveryCode: "new-recovery-1",
      });
      vi.mocked(storage.changePassword).mockResolvedValue(undefined);
      const res = await post("change-password", {
        proof: {
          password: "current-pass-123",
          secondFactor: { recoveryCode: "old-1" },
        },
        newPassword: LONG,
      });
      expect(res.status).toBe(401);
      expect(res.body.replacementRecoveryCode).toBe("new-recovery-1");
    });
  });

  // Review Focus 4.
  it("password-less + two-step: emailCode still needs the authenticator code", async () => {
    user.password = null;
    user.mfaEnabledAt = new Date();
    vi.mocked(storage.reservePasswordChangeAttempt).mockResolvedValue(
      hashChangeCode("1", "123456"),
    );
    const res = await post("change-password", {
      proof: { emailCode: "123456" },
      newPassword: LONG,
    });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SECOND_FACTOR_REQUIRED");
  });

  it("password-less account: Set a password with Google works", async () => {
    user.password = null;
    const res = await post("change-password", {
      proof: { provider: "google", idToken: "id", nonce: "n" },
      newPassword: LONG,
    });
    expect(res.status).toBe(200);
    expect(reauthenticate).toHaveBeenCalledWith("1", null, expect.anything());
  });

  it("too short for an account without two-step → 400 PASSWORD_TOO_SHORT, nothing written", async () => {
    const res = await post("change-password", {
      proof: { password: "current-pass-123" },
      newPassword: "short-pass-1", // 12 < 15
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PASSWORD_TOO_SHORT");
    expect(storage.changePassword).not.toHaveBeenCalled();
  });

  it("a reset or sign-out landed mid-request → 401 TOKEN_REVOKED", async () => {
    vi.mocked(storage.changePassword).mockResolvedValue(undefined);
    const res = await post("change-password", {
      proof: { password: "current-pass-123" },
      newPassword: LONG,
    });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({
      error: "Please sign in again.",
      code: "TOKEN_REVOKED",
    });
    expect(issueSession).not.toHaveBeenCalled();
  });

  it("the mint is refused (version moved again after commit) → 401 TOKEN_REVOKED", async () => {
    const { HttpFailure } = await import("../auth-social");
    vi.mocked(issueSession).mockRejectedValue(
      new HttpFailure(401, "MFA_CHALLENGE_EXPIRED", "x"),
    );
    const res = await post("change-password", {
      proof: { password: "current-pass-123" },
      newPassword: LONG,
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_REVOKED");
  });

  it("a proof of no known kind → 400 VALIDATION_ERROR", async () => {
    const res = await post("change-password", {
      proof: { magic: true },
      newPassword: LONG,
    });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/__tests__/auth-password.test.ts`
Expected: FAIL — the new route answers 404 for every new test.

- [ ] **Step 3: Implement**

In `server/routes/_schemas.ts`, after `reauthProofSchema`:

```ts
// Signed-in password change (change-password spec §4.1). The password and
// Google/Apple variants are reauthProofSchema's own, unchanged; the emailed
// code carries the second factor INSIDE the proof, as the password one does.
export const changePasswordSchema = z.object({
  proof: z.union([
    ...reauthProofSchema.options,
    z.object({
      emailCode: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
      secondFactor: secondFactorSchema.optional(),
    }),
  ]),
  newPassword: newPasswordSchema,
});
```

(`newPasswordSchema` must be declared above this point — if it is declared further down the file, place `changePasswordSchema` after it.)

Add to `server/routes/auth-password.ts` — imports:

```ts
import { invalidateTokenVersionCache } from "../middleware/auth";
import { formatZodError } from "./_helpers";
import { reauthLimiter } from "./_rate-limiters";
import { changePasswordSchema } from "./_schemas";
import { reauthenticate, issueSession, HttpFailure } from "./auth-social";
import { secondFactorForPasswordProof } from "../lib/mfa/password-proof-gate";
import { checkNewPassword } from "./_password-rules";
import { hashPassword } from "../lib/password-hash";
import { changeCodeMatches } from "../lib/password-reset-code";
import { sendPasswordChangedNotice } from "../services/email";
import {
  PASSWORD_MIN_SINGLE_FACTOR,
  PASSWORD_MIN_WITH_MFA,
} from "@shared/constants/password-policy";
```

(merge with the existing import lines — one import per module.) Then, inside `register`, after the code route:

```ts
// Set a new password, proven by the current password, a fresh Google/Apple
// confirmation, or the emailed code (spec §4.1 order: proof → second factor
// → policy → one pinned commit → session).
app.post(
  "/api/auth/change-password",
  requireAuth,
  reauthLimiter,
  async (req: AuthenticatedRequest, res: Response) => {
    // Once a recovery code is spent, every answer carries its replacement.
    let replacement: { replacementRecoveryCode?: string } = {};
    try {
      const parsed = changePasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return sendError(
          res,
          400,
          formatZodError(parsed.error),
          ErrorCode.VALIDATION_ERROR,
        );
      }
      const { proof, newPassword } = parsed.data;
      const user = await storage.getUserForAuth(req.userId);
      if (!user) {
        return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);
      }

      let consumeCodeHash: string | undefined;
      if ("emailCode" in proof) {
        const stored = await storage.reservePasswordChangeAttempt(user.id);
        if (!stored || !changeCodeMatches(user.id, proof.emailCode, stored)) {
          return sendError(
            res,
            400,
            "That code didn't work. Request a new one.",
            ErrorCode.INVALID_RESET_CODE,
          );
        }
        consumeCodeHash = stored;
      } else if (!(await reauthenticate(user.id, user.password, proof))) {
        return sendError(
          res,
          401,
          "That didn't match. Try again.",
          ErrorCode.UNAUTHORIZED,
        );
      }

      // An emailed code is one factor, like a password: on a two-step
      // account it also needs the code (2FA spec D2). Only a Google/Apple
      // confirmation is exempt (D1).
      const singleFactor = "password" in proof || "emailCode" in proof;
      const gate = await secondFactorForPasswordProof(
        user,
        singleFactor,
        "provider" in proof ? undefined : proof.secondFactor,
      );
      if (!gate.ok) return sendError(res, gate.status, gate.message, gate.code);
      if (gate.replacementRecoveryCode) {
        replacement = { replacementRecoveryCode: gate.replacementRecoveryCode };
      }

      const mfa = user.mfaEnabledAt !== null;
      const rejected = await checkNewPassword(
        newPassword,
        mfa ? PASSWORD_MIN_WITH_MFA : PASSWORD_MIN_SINGLE_FACTOR,
        mfa ? "mfa" : "single_factor",
      );
      if (rejected) {
        return sendError(
          res,
          rejected.status,
          rejected.message,
          rejected.code,
          replacement,
        );
      }

      const newVersion = await storage.changePassword({
        userId: user.id,
        expectedTokenVersion: user.tokenVersion,
        newPasswordHash: await hashPassword(newPassword),
        consumeCodeHash,
      });
      if (newVersion === undefined) {
        return sendError(
          res,
          401,
          "Please sign in again.",
          "TOKEN_REVOKED",
          replacement,
        );
      }
      invalidateTokenVersionCache(user.id);
      fireAndForget(
        "password-changed-notice",
        (async () => {
          // A failed lookup must not cost the notice itself.
          const ids = await storage.listIdentities(user.id).catch(() => []);
          await sendPasswordChangedNotice(
            user.email,
            user.username,
            ids.map((i) => i.provider),
          );
        })(),
      );
      const session = await issueSession(user.id, newVersion);
      res.json({ ...session, ...replacement });
    } catch (error) {
      if (error instanceof HttpFailure && error.status === 401) {
        return sendError(
          res,
          401,
          "Please sign in again.",
          "TOKEN_REVOKED",
          replacement,
        );
      }
      handleRouteError(res, error, "change password", replacement);
    }
  },
);
```

Check `sendError`'s signature accepts the 5th `extra` argument and `handleRouteError` the 4th (both are used that way in `server/routes/auth.ts` change-email). Note `checkNewPassword` rejection carries `replacement` too.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/routes/__tests__/auth-password.test.ts && npx tsc --noEmit -p .`
Expected: PASS (all tests), no type errors.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add server/routes/_schemas.ts server/routes/auth-password.ts server/routes/__tests__/auth-password.test.ts
/usr/bin/git commit -F <msg-file>   # "feat(auth): signed-in password change by current password, Google/Apple or an emailed code"
```

### Task 7: Runbook, review, server PR

**Files:**

- Modify: `docs/runbooks/password-reset-lockout.md` ("Open decision" → the new way out)

- [ ] **Step 1: Update the runbook.** Replace the `## Open decision` section with:

```markdown
## Change password (signed in)

Someone still signed in on their phone can set a new password without a reset code: **Profile → Sign-in methods → Change password**, then their current password, **"I forgot it"** → Google/Apple, or **"Email me a code"**. That code is separate from the Forgot password code and only a signed-in person can request it, so the attacker using up the reset codes can't block it. Two-step accounts also enter their authenticator code (not with Google/Apple).
```

And in `## Help`, insert as step 2 (renumber after): `2. If they are still signed in on any phone, they can use **Change password** there (above).`

- [ ] **Step 2: Run the related suites**

Run: `npx vitest related --run server/routes/auth-password.ts server/storage/password-change.ts server/services/email.ts server/lib/password-reset-code.ts server/routes/_schemas.ts server/routes/_rate-limiters.ts shared/schema.ts`
Expected: all pass.

- [ ] **Step 3: Commit**, then dispatch reviewers (commit BEFORE dispatching): `security-auditor` + `server-reviewer` + `code-reviewer`, each with the `docs/AI_WORKFLOW.md` Review Policy dispatch prompt **verbatim** (REVIEWED-SHA on the same line), file list from `git diff --name-only origin/main...HEAD`. Fix any finding test-first, commit, re-review at the new head.

- [ ] **Step 4: Push and open the PR** (`git push -u origin feat/change-password-server` runs `preflight:fast`). Open the PR with `mcp__github__create_pull_request`, then add the `security` label. The PR body starts with the migration block, verbatim:

```markdown
## ⚠️ Before merge: apply migration 0022 on prod

Run these in the VS Code terminal from /Users/williamtower/projects/OCRecipes and paste the output:

    railway run --service Postgres --environment production -- sh -c 'psql "$DATABASE_PUBLIC_URL" -v ON_ERROR_STOP=1 -f /Users/williamtower/projects/OCRecipes/.worktrees/change-password-server/migrations/0022_password_change_codes.sql'

    railway run --service Postgres --environment production -- sh -c 'psql "$DATABASE_PUBLIC_URL" -c "SELECT to_regclass('\''public.password_change_codes'\'');"'

Merge only when the second command prints `password_change_codes`.
```

- [ ] **Step 5: Merge** only after: owner yes + pasted non-null `to_regclass` + all 9 required checks green; `mcp__github__merge_pull_request` squash with `expectedHeadSha`. Pull main into the main checkout; confirm the Railway deploy succeeds and `curl -s -o /dev/null -w "%{http_code}" -X POST https://api.ocrecipes.com/api/auth/change-password/code` returns `401` (route live, auth required). Remove the worktree.

---

## PR 2 — App

Start only after PR 1 is merged and deployed. Setup:

```bash
cd /Users/williamtower/projects/OCRecipes
/usr/bin/git fetch -q origin
/usr/bin/git worktree add -b feat/change-password-app .worktrees/change-password-app origin/main
cd .worktrees/change-password-app
bash .claude/hooks/worktree-deps.sh
bash scripts/declare-worktree.sh "$(/usr/bin/git rev-parse --show-toplevel)"
```

### Task 8: Screen logic (pure helpers)

**Files:**

- Modify: `client/lib/second-factor-utils.ts` (export the existing private `errorBody`)
- Create: `client/screens/ChangePasswordScreen-utils.ts`
- Test: `client/screens/__tests__/ChangePasswordScreen-utils.test.ts` (new)

**Interfaces:**

- Produces: `forgotOptions(providers: readonly SocialProvider[]): ForgotOption[]` where `ForgotOption = { kind: "provider"; provider: SocialProvider; label: string } | { kind: "email"; label: string }`; `changePasswordErrorMessage(err: unknown): string`; `codeRequestErrorMessage(err: unknown): string`; `errorBody(err: unknown)` now exported from `second-factor-utils`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-error";
import {
  forgotOptions,
  changePasswordErrorMessage,
  codeRequestErrorMessage,
} from "../ChangePasswordScreen-utils";

const apiErr = (status: number, body: object) =>
  new ApiError(
    `${status}: ${JSON.stringify(body)}`,
    (body as { code?: string }).code,
    status,
  );

describe("forgotOptions", () => {
  it("lists only connected providers, Google before Apple, then the email code", () => {
    expect(forgotOptions(["apple", "google"])).toEqual([
      { kind: "provider", provider: "google", label: "Confirm with Google" },
      { kind: "provider", provider: "apple", label: "Confirm with Apple" },
      { kind: "email", label: "Email me a code" },
    ]);
  });
  it("no providers → only the email code", () => {
    expect(forgotOptions([])).toEqual([
      { kind: "email", label: "Email me a code" },
    ]);
  });
});

describe("changePasswordErrorMessage", () => {
  it.each([
    [
      apiErr(401, { error: "x", code: "UNAUTHORIZED" }),
      "That didn't match. Try again.",
    ],
    [
      apiErr(400, { error: "x", code: "INVALID_RESET_CODE" }),
      "That code didn't work. Request a new one.",
    ],
    [
      apiErr(401, { error: "x", code: "TOKEN_REVOKED" }),
      "Please sign in again.",
    ],
    [
      apiErr(429, { error: "x", code: "RATE_LIMITED" }),
      "Too many attempts. Please try again later.",
    ],
    [
      apiErr(400, {
        error: "Use at least 15 characters.",
        code: "PASSWORD_TOO_SHORT",
      }),
      "Use at least 15 characters.",
    ],
    [
      apiErr(400, {
        error:
          "That password has appeared in a data breach. Choose a different one.",
        code: "PASSWORD_BREACHED",
      }),
      "That password has appeared in a data breach. Choose a different one.",
    ],
    [new Error("network"), "Something went wrong. Please try again."],
  ])("%#", (err, message) => {
    expect(changePasswordErrorMessage(err)).toBe(message);
  });
});

describe("codeRequestErrorMessage", () => {
  it("429 → the daily-limit message", () => {
    expect(
      codeRequestErrorMessage(
        apiErr(429, { error: "x", code: "RATE_LIMITED" }),
      ),
    ).toBe(
      "You've requested too many codes today. Try again tomorrow, or use Google/Apple.",
    );
  });
  it("anything else → the generic message", () => {
    expect(codeRequestErrorMessage(new Error("x"))).toBe(
      "Couldn't send the code. Please try again.",
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/screens/__tests__/ChangePasswordScreen-utils.test.ts`
Expected: FAIL — cannot resolve `../ChangePasswordScreen-utils`.

- [ ] **Step 3: Implement**

In `client/lib/second-factor-utils.ts` change `function errorBody(` to `export function errorBody(` (no other change).

`client/screens/ChangePasswordScreen-utils.ts`:

```ts
import { ApiError } from "@/lib/api-error";
import { errorBody } from "@/lib/second-factor-utils";
import type { SocialProvider } from "@shared/types/auth";

export type ForgotOption =
  | { kind: "provider"; provider: SocialProvider; label: string }
  | { kind: "email"; label: string };

const PROVIDER_ORDER: readonly SocialProvider[] = ["google", "apple"];
const PROVIDER_LABEL: Record<SocialProvider, string> = {
  google: "Confirm with Google",
  apple: "Confirm with Apple",
};

/** "I forgot it": the connected Google/Apple sign-ins, then the emailed code. */
export function forgotOptions(
  providers: readonly SocialProvider[],
): ForgotOption[] {
  return [
    ...PROVIDER_ORDER.filter((p) => providers.includes(p)).map(
      (provider): ForgotOption => ({
        kind: "provider",
        provider,
        label: PROVIDER_LABEL[provider],
      }),
    ),
    { kind: "email", label: "Email me a code" },
  ];
}

/** Plain-words message for a failed change (change-password spec §3). */
export function changePasswordErrorMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : undefined;
  if (code === "UNAUTHORIZED") return "That didn't match. Try again.";
  if (code === "INVALID_RESET_CODE")
    return "That code didn't work. Request a new one.";
  if (code === "TOKEN_REVOKED") return "Please sign in again.";
  if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_BREACHED") {
    const message = errorBody(err)?.error;
    if (typeof message === "string") return message;
  }
  if (err instanceof ApiError && err.status === 429)
    return "Too many attempts. Please try again later.";
  return "Something went wrong. Please try again.";
}

/** Plain-words message for a failed "Email me a code". */
export function codeRequestErrorMessage(err: unknown): string {
  if (err instanceof ApiError && err.status === 429)
    return "You've requested too many codes today. Try again tomorrow, or use Google/Apple.";
  return "Couldn't send the code. Please try again.";
}
```

(Check `SocialProvider` is exported from `@shared/types/auth` — `useAuth.ts` imports it from there.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/screens/__tests__/ChangePasswordScreen-utils.test.ts client/lib/__tests__/second-factor-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add client/lib/second-factor-utils.ts client/screens/ChangePasswordScreen-utils.ts client/screens/__tests__/ChangePasswordScreen-utils.test.ts
/usr/bin/git commit -F <msg-file>   # "feat(auth): change-password screen helpers (options and plain-words errors)"
```

### Task 9: `useAuth` — request a code, change the password

**Files:**

- Modify: `client/hooks/useAuth.ts` (two callbacks + return them)
- Modify: `client/context/AuthContext.tsx` (types)
- Test: `client/hooks/__tests__/useAuth.test.ts` (extend; the `// @vitest-environment jsdom` pragma must stay on line 1)

**Interfaces:**

- Consumes: `fetchNonce`, `getProviderToken`, `apiRequest`, `tokenStorage`, `establishSession` (all already in `useAuth.ts`).
- Produces (exported type in `useAuth.ts`): `ChangePasswordProof = { password: string } | { provider: SocialProvider } | { emailCode: string }`; `requestPasswordChangeCode(): Promise<void>`; `changePassword(proof: ChangePasswordProof, newPassword: string, secondFactor?: SecondFactorInput): Promise<{ done: boolean; replacementRecoveryCode?: string }>` — `done: false` only when the Google/Apple sheet was cancelled.

- [ ] **Step 1: Write the failing tests.** Add a new top-level `describe` at the end of `client/hooks/__tests__/useAuth.test.ts`, using the file's existing hoisted mocks (`mockApiRequest`, `mockTokenStorage`, `mockGetProviderToken`) and the same local helpers the "two-step verification" block defines (`ready`, `jsonOnce`):

```ts
describe("change password (signed in)", () => {
  async function ready() {
    mockTokenStorage.get.mockResolvedValue(null);
    const hook = renderHook(() => useAuth());
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    return hook;
  }
  const jsonOnce = (body: unknown) =>
    mockApiRequest.mockResolvedValueOnce({ json: () => Promise.resolve(body) });
  const user: User = { id: "u1", username: "testuser" };
  const NEW = "a-long-new-passphrase-1";

  it("current password: posts the proof with its second factor, stores the new session", async () => {
    const { result } = await ready();
    jsonOnce({ status: "signed_in", user, token: "t-new" });
    let out: { done: boolean; replacementRecoveryCode?: string } | undefined;
    await act(async () => {
      out = await result.current.changePassword({ password: "old" }, NEW, {
        code: "123456",
      });
    });
    expect(mockApiRequest).toHaveBeenLastCalledWith(
      "POST",
      "/api/auth/change-password",
      {
        proof: { password: "old", secondFactor: { code: "123456" } },
        newPassword: NEW,
      },
    );
    expect(mockTokenStorage.set).toHaveBeenCalledWith("t-new");
    expect(out).toEqual({ done: true, replacementRecoveryCode: undefined });
  });

  it("emailed code: posts { emailCode } with no second factor", async () => {
    const { result } = await ready();
    jsonOnce({ status: "signed_in", user, token: "t-new" });
    await act(async () => {
      await result.current.changePassword({ emailCode: "654321" }, NEW);
    });
    expect(mockApiRequest).toHaveBeenLastCalledWith(
      "POST",
      "/api/auth/change-password",
      { proof: { emailCode: "654321" }, newPassword: NEW },
    );
  });

  it("Google: a reauth nonce, the provider token, no second factor", async () => {
    const { result } = await ready();
    jsonOnce({ nonce: "n1", nonceHash: "h1" });
    mockGetProviderToken.mockResolvedValueOnce({ idToken: "id-1" });
    jsonOnce({ status: "signed_in", user, token: "t-new" });
    await act(async () => {
      await result.current.changePassword({ provider: "google" }, NEW);
    });
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/auth/social/nonce",
      {
        purpose: "reauth",
      },
    );
    expect(mockGetProviderToken).toHaveBeenCalledWith("google", "h1");
    expect(mockApiRequest).toHaveBeenLastCalledWith(
      "POST",
      "/api/auth/change-password",
      {
        proof: { provider: "google", nonce: "n1", idToken: "id-1" },
        newPassword: NEW,
      },
    );
  });

  it("Google sheet cancelled → { done: false } and no change request", async () => {
    const { result } = await ready();
    jsonOnce({ nonce: "n1", nonceHash: "h1" });
    mockGetProviderToken.mockResolvedValueOnce(null);
    let out: { done: boolean } | undefined;
    await act(async () => {
      out = await result.current.changePassword({ provider: "google" }, NEW);
    });
    expect(out).toEqual({ done: false });
    expect(mockApiRequest).not.toHaveBeenCalledWith(
      "POST",
      "/api/auth/change-password",
      expect.anything(),
    );
  });

  // Review Focus 5 (auth audit L7 rule).
  it("someone else signed in while it was in flight → the late reply does NOT sign in", async () => {
    const { result } = await ready();
    mockApiRequest.mockImplementationOnce(async () => {
      mockTokenStorage.get.mockResolvedValue("t-other");
      return {
        json: () =>
          Promise.resolve({ status: "signed_in", user, token: "t-new" }),
      };
    });
    await act(async () => {
      await result.current.changePassword({ password: "old" }, NEW);
    });
    expect(mockTokenStorage.set).not.toHaveBeenCalledWith("t-new");
  });

  it("returns a spent recovery code's replacement", async () => {
    const { result } = await ready();
    jsonOnce({
      status: "signed_in",
      user,
      token: "t-new",
      replacementRecoveryCode: "r-1",
    });
    let out: { done: boolean; replacementRecoveryCode?: string } | undefined;
    await act(async () => {
      out = await result.current.changePassword({ password: "old" }, NEW, {
        recoveryCode: "old-r",
      });
    });
    expect(out?.replacementRecoveryCode).toBe("r-1");
  });

  it("requestPasswordChangeCode posts to the code route", async () => {
    const { result } = await ready();
    jsonOnce({ status: "code_sent" });
    await act(async () => {
      await result.current.requestPasswordChangeCode();
    });
    expect(mockApiRequest).toHaveBeenLastCalledWith(
      "POST",
      "/api/auth/change-password/code",
      {},
    );
  });
});
```

(`User` is already imported in this file — the "two-step verification" block uses it. If the nonce request in this file is answered through `mockFetch` rather than `mockApiRequest`, follow how the existing `deleteAccount` provider test answers it.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/hooks/__tests__/useAuth.test.ts -t "changePassword|requestPasswordChangeCode"`
Expected: FAIL — `result.current.changePassword is not a function`.

- [ ] **Step 3: Implement.** In `client/hooks/useAuth.ts`, next to `DeleteAccountProof`:

```ts
export type ChangePasswordProof =
  | { password: string }
  | { provider: SocialProvider }
  | { emailCode: string };
```

Inside `useAuth`, after `upgradeSetPassword`:

```ts
/** Email a code for a signed-in password change ("I forgot it"). */
const requestPasswordChangeCode = useCallback(async () => {
  await apiRequest("POST", "/api/auth/change-password/code", {});
}, []);

/**
 * Set a new password while signed in (change-password spec §5). The server
 * signs every other device out and answers with a session for this phone;
 * it is stored only if no one else signed in here meanwhile (auth audit L7).
 * Resolves done:false only when the Google/Apple sheet was cancelled.
 */
const changePassword = useCallback(
  async (
    proof: ChangePasswordProof,
    newPassword: string,
    secondFactor?: SecondFactorInput,
  ): Promise<{ done: boolean; replacementRecoveryCode?: string }> => {
    const before = await tokenStorage.get();
    let body: object;
    if ("provider" in proof) {
      const { nonce, nonceHash } = await fetchNonce("reauth");
      const token = await getProviderToken(proof.provider, nonceHash);
      if (!token) return { done: false };
      body = {
        proof: { provider: proof.provider, nonce, idToken: token.idToken },
        newPassword,
      };
    } else {
      const withFactor = secondFactor ? { ...proof, secondFactor } : proof;
      body = { proof: withFactor, newPassword };
    }
    const res = await apiRequest("POST", "/api/auth/change-password", body);
    const data = (await res.json()) as SignedInResult & {
      replacementRecoveryCode?: string;
    };
    if ((await tokenStorage.get()) === before) {
      await establishSession(data.user, data.token);
    }
    return {
      done: true,
      replacementRecoveryCode: data.replacementRecoveryCode,
    };
  },
  [establishSession],
);
```

Add `requestPasswordChangeCode, changePassword,` to the returned object. In `client/context/AuthContext.tsx`, add to the context type (next to `upgradeSetPassword`):

```ts
requestPasswordChangeCode: () => Promise<void>;
changePassword: (
  proof: ChangePasswordProof,
  newPassword: string,
  secondFactor?: SecondFactorInput,
) => Promise<{ done: boolean; replacementRecoveryCode?: string }>;
```

(import `ChangePasswordProof` from `@/hooks/useAuth`, `SecondFactorInput` from `@shared/types/auth` if not already imported).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/hooks/__tests__/useAuth.test.ts && npx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add client/hooks/useAuth.ts client/context/AuthContext.tsx client/hooks/__tests__/useAuth.test.ts
/usr/bin/git commit -F <msg-file>   # "feat(auth): useAuth can request a change code and change the password while signed in"
```

### Task 10: The screen and its entry point

**Files:**

- Create: `client/screens/ChangePasswordScreen.tsx`
- Modify: `client/navigation/ProfileStackNavigator.tsx` (param + screen)
- Modify: `client/screens/SignInMethodsScreen.tsx` (the "Change"/"Set up" button navigates instead of signing out)
- Test: `client/screens/__tests__/ChangePasswordScreen.test.tsx` (new); `client/screens/__tests__/SignInMethodsScreen.test.tsx` (extend)

**Interfaces:**

- Consumes: `useAuthContext().changePassword / requestPasswordChangeCode` (Task 9); `forgotOptions`, `changePasswordErrorMessage`, `codeRequestErrorMessage` (Task 8); existing `TextInput`, `Button`, `InlineError`, `SecondFactorField`, `ReplacementCodeCard`, `isSecondFactorRequired`, `isTwoStepCheckError`, `secondFactorErrorMessage`, `replacementFromError`.
- Produces: route `ChangePassword: { hasPassword: boolean; providers: SocialProvider[] }` in `ProfileStackParamList`.

- [ ] **Step 1: Write the failing tests.** Read `client/screens/__tests__/SignInMethodsScreen.test.tsx` first and copy its render/mocking setup (auth context mock, navigation mock, theme provider). Then:

`ChangePasswordScreen.test.tsx` — harness first (same mocking style as `SignInMethodsScreen.test.tsx`), then the tests:

```tsx
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { ApiError } from "@/lib/api-error";
import type { SocialProvider } from "@shared/types/auth";
import { renderComponent } from "../../../test/utils/render-component";
import ChangePasswordScreen from "../ChangePasswordScreen";

const auth = vi.hoisted(() => ({
  changePassword: vi.fn(),
  requestPasswordChangeCode: vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({ useAuthContext: () => auth }));
// The replacement-code card copies with expo-clipboard (native module).
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

const navigation = { goBack: vi.fn() };

function renderScreen(params: {
  hasPassword: boolean;
  providers: SocialProvider[];
}) {
  // The screen only reads route.params and navigation.goBack.
  const props = {
    route: { key: "ChangePassword", name: "ChangePassword", params },
    navigation,
  } as unknown as React.ComponentProps<typeof ChangePasswordScreen>;
  return renderComponent(<ChangePasswordScreen {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("shows the current-password field and 'I forgot it' when the account has a password", () => {
  renderScreen({ hasPassword: true, providers: [] });
  expect(screen.getByLabelText("Current password")).toBeTruthy();
  expect(screen.getByText("I forgot it")).toBeTruthy();
});

it("a password-less account starts at the forgot options, titled Set a password", () => {
  renderScreen({ hasPassword: false, providers: ["google"] });
  expect(screen.queryByLabelText("Current password")).toBeNull();
  expect(screen.getByText("Confirm with Google")).toBeTruthy();
  expect(screen.getByText("Email me a code")).toBeTruthy();
});

it("saves with the current password and goes back", async () => {
  auth.changePassword.mockResolvedValue({ done: true });
  renderScreen({ hasPassword: true, providers: [] });
  fireEvent.changeText(screen.getByLabelText("Current password"), "old-pass");
  fireEvent.changeText(
    screen.getByLabelText("New password"),
    "a-long-new-passphrase-1",
  );
  await act(async () => fireEvent.press(screen.getByText("Save new password")));
  expect(auth.changePassword).toHaveBeenCalledWith(
    { password: "old-pass" },
    "a-long-new-passphrase-1",
    undefined,
  );
  expect(navigation.goBack).toHaveBeenCalled();
});

it("Email me a code → sends, then shows the code field and saves with { emailCode }", async () => {
  auth.requestPasswordChangeCode.mockResolvedValue(undefined);
  auth.changePassword.mockResolvedValue({ done: true });
  renderScreen({ hasPassword: true, providers: [] });
  fireEvent.press(screen.getByText("I forgot it"));
  await act(async () => fireEvent.press(screen.getByText("Email me a code")));
  fireEvent.changeText(screen.getByLabelText("Code from the email"), "123456");
  fireEvent.changeText(
    screen.getByLabelText("New password"),
    "a-long-new-passphrase-1",
  );
  await act(async () => fireEvent.press(screen.getByText("Save new password")));
  expect(auth.changePassword).toHaveBeenCalledWith(
    { emailCode: "123456" },
    "a-long-new-passphrase-1",
    undefined,
  );
});

it("SECOND_FACTOR_REQUIRED reveals the authenticator field", async () => {
  auth.changePassword.mockRejectedValueOnce(
    new ApiError(
      '403: {"code":"SECOND_FACTOR_REQUIRED"}',
      "SECOND_FACTOR_REQUIRED",
      403,
    ),
  );
  renderScreen({ hasPassword: true, providers: [] });
  fireEvent.changeText(screen.getByLabelText("Current password"), "old-pass");
  fireEvent.changeText(
    screen.getByLabelText("New password"),
    "a-long-new-passphrase-1",
  );
  await act(async () => fireEvent.press(screen.getByText("Save new password")));
  expect(screen.getByLabelText("6-digit code")).toBeTruthy(); // SecondFactorField's input
});

it("a wrong current password shows the plain message and stays", async () => {
  auth.changePassword.mockRejectedValueOnce(
    new ApiError('401: {"code":"UNAUTHORIZED"}', "UNAUTHORIZED", 401),
  );
  renderScreen({ hasPassword: true, providers: [] });
  fireEvent.changeText(screen.getByLabelText("Current password"), "nope");
  fireEvent.changeText(
    screen.getByLabelText("New password"),
    "a-long-new-passphrase-1",
  );
  await act(async () => fireEvent.press(screen.getByText("Save new password")));
  expect(screen.getByText("That didn't match. Try again.")).toBeTruthy();
  expect(navigation.goBack).not.toHaveBeenCalled();
});

// Review Focus 5.
it("a second tap while saving sends nothing more", async () => {
  let resolve!: () => void;
  auth.changePassword.mockReturnValue(
    new Promise((r) => {
      resolve = () => r({ done: true });
    }),
  );
  renderScreen({ hasPassword: true, providers: [] });
  fireEvent.changeText(screen.getByLabelText("Current password"), "old-pass");
  fireEvent.changeText(
    screen.getByLabelText("New password"),
    "a-long-new-passphrase-1",
  );
  fireEvent.press(screen.getByText("Save new password"));
  fireEvent.press(screen.getByText("Save new password"));
  await act(async () => resolve());
  expect(auth.changePassword).toHaveBeenCalledTimes(1);
});

it("a spent recovery code's replacement is shown before going back", async () => {
  auth.changePassword.mockResolvedValue({
    done: true,
    replacementRecoveryCode: "r-1",
  });
  renderScreen({ hasPassword: true, providers: [] });
  fireEvent.changeText(screen.getByLabelText("Current password"), "old-pass");
  fireEvent.changeText(
    screen.getByLabelText("New password"),
    "a-long-new-passphrase-1",
  );
  await act(async () => fireEvent.press(screen.getByText("Save new password")));
  expect(screen.getByText("r-1")).toBeTruthy();
  expect(navigation.goBack).not.toHaveBeenCalled();
});
```

`SignInMethodsScreen.test.tsx` — replace any test asserting the old sign-out prompt for the password row with:

```tsx
it("the password row's Change opens Change password with the account's shape", () => {
  // methods: password set, google connected (use the file's existing fixture)
  fireEvent.press(screen.getByLabelText("Change password"));
  expect(navigation.navigate).toHaveBeenCalledWith("ChangePassword", {
    hasPassword: true,
    providers: ["google"],
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/screens/__tests__/ChangePasswordScreen.test.tsx client/screens/__tests__/SignInMethodsScreen.test.tsx`
Expected: FAIL — cannot resolve `../ChangePasswordScreen`; the Sign-in methods test fails (still opens the sign-out prompt).

- [ ] **Step 3: Implement**

`ProfileStackNavigator.tsx`: add `ChangePassword: { hasPassword: boolean; providers: SocialProvider[] };` to `ProfileStackParamList` (import `SocialProvider` from `@shared/types/auth`), import `ChangePasswordScreen`, and register after `TwoStepSetup`:

```tsx
<Stack.Screen
  name="ChangePassword"
  component={ChangePasswordScreen}
  options={({ route }) => {
    const title = route.params.hasPassword
      ? "Change password"
      : "Set a password";
    return {
      title,
      headerTitle: () => <HeaderTitle title={title} showIcon={false} />,
    };
  }}
/>
```

`SignInMethodsScreen.tsx`: delete `askPasswordReset` and change the button's `onPress` to:

```tsx
              onPress={() =>
                navigation.navigate("ChangePassword", {
                  hasPassword: methods.password,
                  providers: PROVIDERS.map((p) => p.provider).filter(
                    (p) => methods[p] !== null,
                  ),
                })
              }
```

(`SignInMethods` is `{ password: boolean; google: {…} | null; apple: {…} | null }`, so a connected provider is a non-null field. `PROVIDERS` lists Apple first, so the param is `["apple", "google"]`-ordered; the screen re-orders via `forgotOptions`. Remove `logout`/`confirm` from the component's destructuring only if nothing else in it uses them — `askDisconnect`/`askForgetPhones` use `confirm`.)

`client/screens/ChangePasswordScreen.tsx` (field styling follows `client/components/ChangeEmailModal.tsx`; reuse its `styles` names where they match):

```tsx
import React, { useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

import { ScreenScrollView } from "@/components/ScreenScrollView";
import { ThemedText } from "@/components/ThemedText";
import { TextInput } from "@/components/TextInput";
import { Button } from "@/components/Button";
import { InlineError } from "@/components/InlineError";
import { SecondFactorField } from "@/components/SecondFactorField";
import { ReplacementCodeCard } from "@/components/ReplacementCodeCard";
import { useAuthContext } from "@/context/AuthContext";
import { useTheme } from "@/hooks/useTheme";
import type { ChangePasswordProof } from "@/hooks/useAuth";
import {
  isSecondFactorRequired,
  isTwoStepCheckError,
  normalizeCodeInput,
  replacementFromError,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";
import {
  changePasswordErrorMessage,
  codeRequestErrorMessage,
  forgotOptions,
} from "./ChangePasswordScreen-utils";
import { passwordMessage } from "@shared/constants/password-policy";
import type { SecondFactorInput, SocialProvider } from "@shared/types/auth";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import { Spacing } from "@/constants/theme";

type Props = NativeStackScreenProps<ProfileStackParamList, "ChangePassword">;
type Mode = "current" | "forgot" | "code";

/**
 * Change (or set) the password while signed in — change-password spec §3.
 * Proof: the current password, a fresh Google/Apple confirmation, or a code
 * emailed to the account; two-step accounts add the authenticator code for
 * the first and last. A stranger who knows only the email can't block it.
 */
export default function ChangePasswordScreen({ route, navigation }: Props) {
  const { hasPassword, providers } = route.params;
  const { theme } = useTheme();
  const { changePassword, requestPasswordChangeCode } = useAuthContext();
  const [mode, setMode] = useState<Mode>(hasPassword ? "current" : "forgot");
  const [current, setCurrent] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [needsFactor, setNeedsFactor] = useState(false);
  const [factor, setFactor] = useState<SecondFactorInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A ref, not state: a second tap in the same frame must see it (Review Focus 5).
  const busyRef = useRef(false);
  const [replacement, setReplacement] = useState<string | null>(null);

  const proofFor = (provider?: SocialProvider): ChangePasswordProof => {
    if (provider) return { provider };
    if (mode === "code") return { emailCode };
    return { password: current };
  };

  // Outside the try (React Compiler: no conditionals inside a try).
  const handleSaveError = (err: unknown) => {
    const spent = replacementFromError(err);
    if (spent) setReplacement(spent);
    if (isSecondFactorRequired(err)) {
      setNeedsFactor(true);
      return;
    }
    setError(
      isTwoStepCheckError(err)
        ? secondFactorErrorMessage(err).message
        : changePasswordErrorMessage(err),
    );
  };
  const finishSave = (out: {
    done: boolean;
    replacementRecoveryCode?: string;
  }) => {
    if (!out.done) return; // the Google/Apple sheet was cancelled
    if (out.replacementRecoveryCode)
      setReplacement(out.replacementRecoveryCode);
    else navigation.goBack();
  };

  const save = async (provider?: SocialProvider) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const proof = proofFor(provider);
    const secondFactor = needsFactor && factor ? factor : undefined;
    let out: { done: boolean; replacementRecoveryCode?: string } | null = null;
    let failure: unknown = null;
    try {
      out = await changePassword(proof, newPassword, secondFactor);
    } catch (err) {
      failure = err;
    }
    busyRef.current = false;
    setBusy(false);
    if (failure !== null) handleSaveError(failure);
    else if (out) finishSave(out);
  };

  const sendCode = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    let failure: unknown = null;
    try {
      await requestPasswordChangeCode();
    } catch (err) {
      failure = err;
    }
    busyRef.current = false;
    setBusy(false);
    if (failure !== null) setError(codeRequestErrorMessage(failure));
    else setMode("code");
  };

  if (replacement) {
    return (
      <ScreenScrollView contentContainerStyle={styles.content}>
        <ReplacementCodeCard
          code={replacement}
          onDone={() => navigation.goBack()}
        />
      </ScreenScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.backgroundRoot }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScreenScrollView contentContainerStyle={styles.content}>
        {mode === "current" ? (
          <View style={styles.group}>
            <TextInput
              accessibilityLabel="Current password"
              placeholder="Current password"
              value={current}
              onChangeText={setCurrent}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="current-password"
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => setMode("forgot")}
              style={styles.link}
            >
              <ThemedText type="small" style={{ color: theme.link }}>
                I forgot it
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        {mode === "code" ? (
          <View style={styles.group}>
            <TextInput
              accessibilityLabel="Code from the email"
              placeholder="6-digit code"
              value={emailCode}
              onChangeText={(t) => setEmailCode(normalizeCodeInput(t))}
              keyboardType="number-pad"
              autoComplete="one-time-code"
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => void sendCode()}
              style={styles.link}
            >
              <ThemedText type="small" style={{ color: theme.link }}>
                Send a new code
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <TextInput
          accessibilityLabel="New password"
          placeholder="New password"
          value={newPassword}
          onChangeText={setNewPassword}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
        />
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          {passwordMessage("too_short", needsFactor ? "mfa" : "single_factor")}
        </ThemedText>

        {needsFactor ? (
          <SecondFactorField onChange={setFactor} busy={busy} />
        ) : null}
        {error ? <InlineError message={error} /> : null}

        {mode === "forgot" ? (
          <View style={styles.group}>
            {forgotOptions(providers).map((option) => (
              <Button
                key={option.kind === "provider" ? option.provider : "email"}
                variant="outline"
                disabled={busy}
                onPress={() =>
                  option.kind === "provider"
                    ? void save(option.provider)
                    : void sendCode()
                }
              >
                {option.label}
              </Button>
            ))}
          </View>
        ) : (
          <Button disabled={busy} onPress={() => void save()}>
            Save new password
          </Button>
        )}
      </ScreenScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, gap: Spacing.md },
  group: { gap: Spacing.sm },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
});
```

Before relying on them, confirm with LSP/grep: `ScreenScrollView` path (SignInMethodsScreen imports it), `InlineError`'s prop is `message`, `TextInput` forwards `accessibilityLabel`, and `passwordMessage`'s `"too_short"` problem name (`shared/constants/password-policy.ts`). Fix any mismatch to the real API — don't add new props to shared components.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run client/screens/__tests__/ChangePasswordScreen.test.tsx client/screens/__tests__/SignInMethodsScreen.test.tsx && npx tsc --noEmit -p .`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add client/screens/ChangePasswordScreen.tsx client/navigation/ProfileStackNavigator.tsx client/screens/SignInMethodsScreen.tsx client/screens/__tests__/ChangePasswordScreen.test.tsx client/screens/__tests__/SignInMethodsScreen.test.tsx
/usr/bin/git commit -F <msg-file>   # "feat(auth): Change password screen, opened from Sign-in methods"
```

### Task 11: Review, app PR, OTA

- [ ] **Step 1:** `npx vitest related --run` over every client file touched in Tasks 8–10. Expected: all pass.
- [ ] **Step 2:** Sim check on the iOS simulator (UDID explicit; check the API IP first — `curl $EXPO_PUBLIC_DOMAIN/api/health`): Profile → Sign-in methods → Change → change with the current password (demo account: `demo` / `demo-password-2026`), then "I forgot it" → Email me a code (local server logs the send). Screenshot both.
- [ ] **Step 3:** Commit; dispatch `security-auditor` + `mobile-reviewer` + `code-reviewer` with the verbatim `docs/AI_WORKFLOW.md` dispatch prompt; fix findings test-first; re-review at the new head.
- [ ] **Step 4:** Push (`preflight:fast`), open the PR with `mcp__github__create_pull_request`, label `security`. Body notes: needs an OTA after merge; server PR already live.
- [ ] **Step 5:** After owner yes + 9 checks: merge with `expectedHeadSha`; **pull main into the main checkout**; hand the owner the OTA command (`npm run update:production -- --message "Change password while signed in"`); after the OTA, confirm `POST /api/auth/change-password` appears in the Railway HTTP logs from a device. Update `docs/runbooks/password-reset-lockout.md` only if the shipped wording differs. Remove the worktree; update memory (`project_auth_audit_2026_10_10.md`).
