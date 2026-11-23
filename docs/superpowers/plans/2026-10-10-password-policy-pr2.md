# Password policy — PR 2 (upgrade pass, sign-up switch, sign-in gate) Implementation Plan

> **STATUS: SUPERSEDED — do not implement or re-propose.** The sign-in gate and forced upgrade for passwords under 15 characters were overruled: no forced stop at sign-in, ever, and the minimum is 8 for everyone. See `docs/OWNER_RULINGS.md` → Auth (2026-10-12).

> **Execution:** superpowers:executing-plans, in-session only (`/todo-fast` Step 2b gate override — the todo is `human_led`; auth work is never delegated to implementer subagents). **DB-serial:** touches `shared/schema.ts` and `migrations/`. Review roster at the final head: `code-reviewer` + `security-auditor` + `server-reviewer` + `mobile-reviewer`. The PR is `security`-labelled and merges only on the owner's explicit yes. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A password under 15 characters can no longer sign in on its own. An account without two-step that signs in (or answers the Google/Apple Connect prompt) with one gets a short-lived restricted pass instead of a session. With that pass it can either turn on two-step or choose a longer password. Sign-up gains a "Use two-step verification" switch that lowers the minimum to 8.

**Architecture:**

- **The pass is opaque, not a JWT.** It is a random token, and only its SHA-256 is stored, in a new `password_upgrade_passes` table bound to the user's `tokenVersion`.
- **Separate auth scheme.** A middleware accepts only `Authorization: UpgradePass <token>`, so `requireAuth` (Bearer JWT) and the pass can never stand in for each other.
- **Shared TOTP logic.** Staging a secret and confirming first enrollment move into a service, so `/mfa/totp/*` and the new `/upgrade/totp/*` share them.
- **Atomic finish.** Each success path consumes the pass in the same transaction that changes the account.
- **App side.** A new pre-auth screen offers the two ways out. It reuses the authenticator setup steps lifted out of `TwoStepSetupScreen`.

**Tech Stack:** TypeScript, Express, zod 3, Drizzle/PostgreSQL, node:crypto, Vitest + supertest, React Native (Expo), React Navigation native-stack, @testing-library/react-native.

**Spec:** `docs/superpowers/specs/2026-10-10-password-policy-design.md` (rev 3, with §2/§5.4 amended after PR 1). PR 2 scope is spec §9 "PR 2": §6, the §5.1 switch, and §5.2. PR 1 shipped as #1368 (`4feb0d5`).

## Global Constraints

- **Migration number and timing:** the migration is `migrations/0020_password_upgrade_passes.sql`, not the spec's 0019, which `recipe_tries` already took.
  - It is hand-written, additive and idempotent.
  - The **owner applies it to prod before merge**, the same way 0019 was applied: the owner runs it, and only on their explicit yes.
  - Locally, `npm run db:push` creates the table in the dev/test DB.
- **Rollout order:** migration on prod, then merge (Railway deploys the server), then the prod OTA (owner's yes). The rollout section at the end explains the window between deploy and OTA.
- **Pass format:** the pass token is `crypto.randomBytes(32).toString("base64url")`. Only `sha256("pw-upgrade:" + token)` (hex) is stored.
- **Pass limits:** each pass lives `UPGRADE_PASS_TTL_MINUTES = 30` minutes and allows at most `UPGRADE_PASS_MAX_ATTEMPTS = 10` code attempts.
- **Pass storage on the phone:** memory only, as a navigation param or component state. Never Keychain, AsyncStorage or the token store.
- **Sign-in gate:** it fires only when the account has no two-step (`mfaEnabledAt === null`) and `passwordLength(input) < PASSWORD_MIN_SINGLE_FACTOR` (15).
  - `canUseTwoStep = passwordLength(input) >= PASSWORD_MIN_WITH_MFA` (8).
  - The answer is **HTTP 200** `{ status: "upgrade_required", pass, canUseTwoStep }` with no token. It is 200, like `mfa_required`, so `loginAccountLimiter` never counts a correct password as a failure.
- **Policy rejections:** answer a policy rejection derived from a new password with `sendError` in the handler. Never throw it into `handleRouteError`, because the CodeQL clear-text-logging path (#248) starts there.
- **Static copy:** the client shows static copy per `ApiError.code`, never `error.message` (`ocrecipes/no-error-message-in-ui`).
- **Error codes:** new codes are `UPGRADE_PASS_EXPIRED` (spec §8) and `UPGRADE_TWO_STEP_NOT_ALLOWED` (a ruling below).
- **Sign-up switch copy (spec P4):** "Use two-step verification (lets you use 8+ characters)".
- **Sign-up message with the switch off (spec §2):** "Use at least 15 characters, or turn on two-step verification to use 8."
- **Commits:** lint-staged only; never `--no-verify`. Write the message to a scratchpad file and run `git commit -F`. Inside the worktree, use `/usr/bin/git`.
- **Hooks don't run in the worktree:** run `npm run preflight:fast` by hand before the push. It writes the stamp that PR creation needs.

### Rulings carried into this plan (spec amendments made in Task 15)

| #   | Ruling                                                                                                                                                                         | Why                                                                                                                                                                                                | Cost if wrong                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| R1  | Migration `0020`, not `0019`                                                                                                                                                   | 0019 is `recipe_tries` (#1365)                                                                                                                                                                     | None                                                                                                   |
| R2  | New error code `UPGRADE_TWO_STEP_NOT_ALLOWED` (403) for a pass whose sign-in password was under 8, on `/upgrade/totp/*`                                                        | Spec §6 says "403" with no code, and the client must branch on a code to hide the choice                                                                                                           | One more code in `error-codes.ts`                                                                      |
| R3  | `/upgrade/password` does **not** reserve a pass attempt                                                                                                                        | A policy or breach rejection is not a guess. The 10-cap exists to bound TOTP guessing. The IP limiter still bounds the route                                                                       | A pass could be hit with up to 30 rejected passwords per 15 minutes from one IP, which reveals nothing |
| R4  | Expired or consumed passes are deleted **both** when the same user gets a new pass (as `createMfaChallenge` does) and by a sweep in `cleanup-retention.ts`                     | The retention job is prod-gated off until ≥2026-11-03, so the inline sweep keeps the table small before then                                                                                       | None                                                                                                   |
| R5  | Two-step turned on through the pass sends a new notice kind, `enabled_at_sign_in`, which says that a password reset by email won't turn it off                                 | Spec §6 asks the notice to say how to recover if it wasn't them                                                                                                                                    | One more template                                                                                      |
| R6  | `confirmTotpEnrollment` gains an optional `upgradePass` guard. In the **same** transaction it consumes the pass and requires `users.token_version` to equal the pass's version | Spec §6 needs consumption to be atomic. One transaction means a double submit can't mint two sessions or two code sets                                                                             | None                                                                                                   |
| R7  | The app holds the session that `/upgrade/totp/confirm` returns and calls `finishSignIn` only when Done is tapped on the save-codes step                                        | `establishSession` flips `isAuthenticated`, which swaps the root stack and would unmount the screen with the codes unsaved. `TwoStepCodeScreen` defers sign-in for a replacement code the same way | None                                                                                                   |

## Review Focus

1. **Recovery codes on screen when the session lands.** After `/upgrade/totp/confirm`, the codes must stay on screen until "I've saved these" + Done. Signing in early unmounts the pre-auth stack and loses them. → Task 13 test: `finishSignIn` is not called until Done.
2. **Double submit on `/upgrade/totp/confirm`.** Two confirms with the same valid code must produce exactly one session and one set of 10 recovery codes. The other gets `401 UPGRADE_PASS_EXPIRED`. → Task 10 itest (real DB, concurrent requests) and Task 2 storage test.
3. **A pass used after the password changed elsewhere.** A pass used after a reset (or sign-out-everywhere) bumped `tokenVersion` must be refused by the middleware, and also by the transaction if the bump lands between them. → Task 3 and Task 2 tests.
4. **Switch on, but a 15+ password typed anyway.** Such an account must never see the pass at sign-in. → Task 6 test (15-char no-MFA login gives a token).
5. **No usable choice left.** When `canUseTwoStep` is false, or `/upgrade/totp/setup` answers `MFA_SETUP_DISABLED`/`UPGRADE_TWO_STEP_NOT_ALLOWED`, the screen must show only "Choose a longer password" and never a dead end. → Task 13 utils and screen tests.

---

### Task 1: Table, migration and constants

**Files:**

- Create: `shared/constants/password-upgrade.ts`
- Modify: `shared/schema.ts` (after the `mfaTrustedDevices` table)
- Create: `migrations/0020_password_upgrade_passes.sql`
- Test: `server/storage/__tests__/password-upgrade-schema.test.ts`

**Interfaces:**

- Produces: `UPGRADE_PASS_TTL_MINUTES = 30`, `UPGRADE_PASS_MAX_ATTEMPTS = 10`; table `passwordUpgradePasses`; type `PasswordUpgradePass`.

- [ ] **Step 1: Constants**

```ts
// shared/constants/password-upgrade.ts
/**
 * The restricted pass a short password earns at sign-in (spec
 * docs/superpowers/specs/2026-10-10-password-policy-design.md §6).
 */
export const UPGRADE_PASS_TTL_MINUTES = 30;
/** Wrong two-step codes one pass absorbs before it is dead. */
export const UPGRADE_PASS_MAX_ATTEMPTS = 10;
```

- [ ] **Step 2: Write the failing schema test**

Copy the scaffolding from `server/storage/__tests__/mfa-schema.test.ts` (the transaction setup and the `pgCode` helper):

```ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { users, passwordUpgradePasses } from "@shared/schema";
import { eq } from "drizzle-orm";

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;
const inAMinute = () => new Date(Date.now() + 60_000);

describe("password upgrade pass schema (migration 0020)", () => {
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

  it("stores a pass with attempts 0 and no consumed_at by default", async () => {
    await tx.insert(passwordUpgradePasses).values({
      idHash: "h1",
      userId: testUser.id,
      tokenVersion: 0,
      twoStepAllowed: true,
      expiresAt: inAMinute(),
    });
    const [row] = await tx
      .select()
      .from(passwordUpgradePasses)
      .where(eq(passwordUpgradePasses.idHash, "h1"));
    expect(row.attempts).toBe(0);
    expect(row.consumedAt).toBeNull();
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  it("is deleted with its user", async () => {
    await tx.insert(passwordUpgradePasses).values({
      idHash: "h2",
      userId: testUser.id,
      tokenVersion: 0,
      twoStepAllowed: false,
      expiresAt: inAMinute(),
    });
    await tx.delete(users).where(eq(users.id, testUser.id));
    const rows = await tx
      .select()
      .from(passwordUpgradePasses)
      .where(eq(passwordUpgradePasses.idHash, "h2"));
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run server/storage/__tests__/password-upgrade-schema.test.ts`
Expected: FAIL. `passwordUpgradePasses` is not exported from `@shared/schema`.

- [ ] **Step 4: Add the table to `shared/schema.ts`**

```ts
/**
 * A short password's restricted pass (password policy spec §6): an opaque
 * token, never a JWT, so requireAuth can never accept it. Only its hash is
 * stored, bound to the user's tokenVersion.
 */
export const passwordUpgradePasses = pgTable(
  "password_upgrade_passes",
  {
    /** sha256(`pw-upgrade:${token}`); the token itself only ever lives in app memory. */
    idHash: text("id_hash").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenVersion: integer("token_version").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    /** The sign-in password was ≥8, so turning two-step on leaves a valid account. */
    twoStepAllowed: boolean("two_step_allowed").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [
    index("password_upgrade_passes_user_id_idx").on(t.userId),
    index("password_upgrade_passes_expires_at_idx").on(t.expiresAt),
  ],
);
export type PasswordUpgradePass = typeof passwordUpgradePasses.$inferSelect;
```

- [ ] **Step 5: Push to the local dev/test DB**

Run: `npm run db:push`
Expected: drizzle-kit creates `password_upgrade_passes` and its two indexes, with no destructive prompts. If it proposes dropping or altering anything else, **stop** and report it, because the local DB has drifted.

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run server/storage/__tests__/password-upgrade-schema.test.ts`
Expected: PASS (2/2).

- [ ] **Step 7: Write the prod migration**

```sql
-- Password policy part 2: the restricted pass a password under 15 earns at
-- sign-in on an account without two-step (spec 2026-10-10 password policy §6).
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle writes password_upgrade_passes on every short-password sign-in, so the
-- table must exist before that bundle deploys. Applying early is safe for the
-- old bundle: a new table it never reads and two indexes. Additive and
-- idempotent; no backfill. Constraint and index names match Drizzle's.

CREATE TABLE IF NOT EXISTS password_upgrade_passes (
  id_hash text NOT NULL PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT password_upgrade_passes_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  token_version integer NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  two_step_allowed boolean NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS password_upgrade_passes_user_id_idx
  ON password_upgrade_passes (user_id);
CREATE INDEX IF NOT EXISTS password_upgrade_passes_expires_at_idx
  ON password_upgrade_passes (expires_at);
```

Then check the SQL against the Drizzle-generated names: `psql "$DATABASE_URL" -c '\d password_upgrade_passes'` on the local DB must list the same FK name and index names.

- [ ] **Step 8: Commit**

```bash
/usr/bin/git add shared/constants/password-upgrade.ts shared/schema.ts migrations/0020_password_upgrade_passes.sql server/storage/__tests__/password-upgrade-schema.test.ts
/usr/bin/git commit -F <scratchpad>/commit-msg.txt   # "feat(db): password upgrade pass table (migration 0020)"
```

---

### Task 2: Pass storage, token helpers, and the pass guard on first enrollment

**Files:**

- Create: `server/storage/upgrade-passes.ts`
- Modify: `server/storage/mfa.ts`:
  - Export `GuardFailed` and `guarded`.
  - Add the `upgradePass` option to `confirmTotpEnrollment`.
- Modify: `server/storage/index.ts`: wire the four new functions.
- Create: `server/lib/upgrade-pass.ts`
- Test: `server/storage/__tests__/upgrade-passes.test.ts` (real DB), `server/lib/__tests__/upgrade-pass.test.ts`

**Interfaces:**

- Consumes: `passwordUpgradePasses`, `UPGRADE_PASS_TTL_MINUTES`, `UPGRADE_PASS_MAX_ATTEMPTS` (Task 1).
- Produces:
  - `storage.createUpgradePass(p: { idHash: string; userId: string; tokenVersion: number; twoStepAllowed: boolean }): Promise<void>`
  - `storage.getLiveUpgradePass(idHash: string): Promise<PasswordUpgradePass | undefined>`: unconsumed, unexpired, and `attempts < 10`.
  - `storage.reserveUpgradePassAttempt(idHash: string): Promise<PasswordUpgradePass | undefined>`
  - `storage.completePasswordUpgrade(p: { idHash: string; userId: string; tokenVersion: number; newPasswordHash: string }): Promise<number | undefined>`: returns the new tokenVersion.
  - `storage.confirmTotpEnrollment(userId, { acceptedStep, recoveryHashes, upgradePass?: { idHash: string; tokenVersion: number } })`
  - `newUpgradePassToken(): string`, `hashUpgradePassToken(token: string): string`
  - `needsPasswordUpgrade(user: { mfaEnabledAt: Date | null }, password: string): boolean`
  - `type UpgradeRequired = { status: "upgrade_required"; pass: string; canUseTwoStep: boolean }`
  - `startUpgradePass(user: { id: string; tokenVersion: number }, password: string): Promise<UpgradeRequired>`

- [ ] **Step 1: Write the failing storage tests**

`server/storage/__tests__/upgrade-passes.test.ts`. Use the same scaffolding as `mfa.test.ts`: `vi.mock("../../db", () => ({ get db() { return getTestTx(); } }))`, then `const passes = await import("../upgrade-passes"); const mfa = await import("../mfa");`.

```ts
const pass = (
  over: Partial<{
    idHash: string;
    tokenVersion: number;
    twoStepAllowed: boolean;
  }> = {},
) => ({
  idHash: "hash-a",
  userId: testUser.id,
  tokenVersion: testUser.tokenVersion,
  twoStepAllowed: true,
  ...over,
});

it("a fresh pass is live; a consumed or expired one is not", async () => {
  await passes.createUpgradePass(pass());
  expect(await passes.getLiveUpgradePass("hash-a")).toMatchObject({
    userId: testUser.id,
    attempts: 0,
  });
  await tx
    .update(passwordUpgradePasses)
    .set({ expiresAt: sql`now() - interval '1 second'` })
    .where(eq(passwordUpgradePasses.idHash, "hash-a"));
  expect(await passes.getLiveUpgradePass("hash-a")).toBeUndefined();
});

it("reserves at most 10 attempts, then the pass is dead", async () => {
  await passes.createUpgradePass(pass());
  for (let i = 1; i <= 10; i++) {
    expect((await passes.reserveUpgradePassAttempt("hash-a"))?.attempts).toBe(
      i,
    );
  }
  expect(await passes.reserveUpgradePassAttempt("hash-a")).toBeUndefined();
  expect(await passes.getLiveUpgradePass("hash-a")).toBeUndefined();
});

it("a new pass for the same user deletes that user's dead passes, not live ones or other users'", async () => {
  await passes.createUpgradePass(pass({ idHash: "old-dead" }));
  await tx
    .update(passwordUpgradePasses)
    .set({ consumedAt: sql`now()` })
    .where(eq(passwordUpgradePasses.idHash, "old-dead"));
  await passes.createUpgradePass(pass({ idHash: "old-live" }));
  await passes.createUpgradePass({
    ...pass({ idHash: "other-dead" }),
    userId: otherUser.id,
    tokenVersion: otherUser.tokenVersion,
  });
  await tx
    .update(passwordUpgradePasses)
    .set({ consumedAt: sql`now()` })
    .where(eq(passwordUpgradePasses.idHash, "other-dead"));
  await passes.createUpgradePass(pass({ idHash: "new" }));
  const ids = (
    await tx
      .select({ id: passwordUpgradePasses.idHash })
      .from(passwordUpgradePasses)
  )
    .map((r) => r.id)
    .sort();
  expect(ids).toEqual(["new", "old-live", "other-dead"]);
});

it("completePasswordUpgrade: new hash, version bump, trusted phones gone, staged email dropped, pass consumed", async () => {
  await tx
    .update(users)
    .set({ pendingEmail: "new@test.invalid" })
    .where(eq(users.id, testUser.id));
  await tx.insert(mfaTrustedDevices).values({
    userId: testUser.id,
    keyHash: "k",
    expiresAt: new Date(Date.now() + 60_000),
  });
  await passes.createUpgradePass(pass());
  const v = await passes.completePasswordUpgrade({
    idHash: "hash-a",
    userId: testUser.id,
    tokenVersion: testUser.tokenVersion,
    newPasswordHash: "pv2$new",
  });
  expect(v).toBe(testUser.tokenVersion + 1);
  const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
  expect(u.password).toBe("pv2$new");
  expect(u.pendingEmail).toBeNull();
  expect(
    await tx
      .select()
      .from(mfaTrustedDevices)
      .where(eq(mfaTrustedDevices.userId, testUser.id)),
  ).toHaveLength(0);
  expect(await passes.getLiveUpgradePass("hash-a")).toBeUndefined();
});

it("completePasswordUpgrade refuses a second use, and a tokenVersion that moved on", async () => {
  await passes.createUpgradePass(pass());
  const args = {
    idHash: "hash-a",
    userId: testUser.id,
    tokenVersion: testUser.tokenVersion,
    newPasswordHash: "pv2$x",
  };
  expect(await passes.completePasswordUpgrade(args)).toBeDefined();
  expect(await passes.completePasswordUpgrade(args)).toBeUndefined();

  await passes.createUpgradePass(pass({ idHash: "hash-b" }));
  // A reset elsewhere bumped the version AFTER the pass was minted.
  const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
  await tx
    .update(users)
    .set({ tokenVersion: u.tokenVersion + 1 })
    .where(eq(users.id, testUser.id));
  expect(
    await passes.completePasswordUpgrade({
      ...args,
      idHash: "hash-b",
      tokenVersion: u.tokenVersion,
    }),
  ).toBeUndefined();
  // Rolled back: the pass is still unconsumed, the password untouched.
  const [after] = await tx
    .select()
    .from(users)
    .where(eq(users.id, testUser.id));
  expect(after.password).toBe(u.password);
});

it("confirmTotpEnrollment with an upgradePass consumes it in the same transaction; a second confirm loses", async () => {
  await passes.createUpgradePass(pass());
  await mfa.startTotpEnrollment(testUser.id, "enc");
  const opts = {
    acceptedStep: 1,
    recoveryHashes: ["h1"],
    upgradePass: { idHash: "hash-a", tokenVersion: testUser.tokenVersion },
  };
  expect(await mfa.confirmTotpEnrollment(testUser.id, opts)).toBe(
    testUser.tokenVersion + 1,
  );
  expect(await mfa.confirmTotpEnrollment(testUser.id, opts)).toBeUndefined();
  expect(await passes.getLiveUpgradePass("hash-a")).toBeUndefined();
});

it("confirmTotpEnrollment with a consumed pass changes nothing", async () => {
  await passes.createUpgradePass(pass());
  await tx
    .update(passwordUpgradePasses)
    .set({ consumedAt: sql`now()` })
    .where(eq(passwordUpgradePasses.idHash, "hash-a"));
  await mfa.startTotpEnrollment(testUser.id, "enc");
  expect(
    await mfa.confirmTotpEnrollment(testUser.id, {
      acceptedStep: 1,
      recoveryHashes: ["h1"],
      upgradePass: { idHash: "hash-a", tokenVersion: testUser.tokenVersion },
    }),
  ).toBeUndefined();
  const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
  expect(u.mfaEnabledAt).toBeNull();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/storage/__tests__/upgrade-passes.test.ts`
Expected: FAIL. `../upgrade-passes` does not exist.

- [ ] **Step 3: Export the guard helpers from `server/storage/mfa.ts`**

Change `class GuardFailed` and `async function guarded` to `export class GuardFailed` and `export async function guarded`. Nothing else changes.

- [ ] **Step 4: Add `upgradePass` to `confirmTotpEnrollment`**

```ts
export async function confirmTotpEnrollment(
  userId: string,
  opts: {
    acceptedStep: number;
    recoveryHashes: string[];
    /** Turned on through a short password's pass (spec §6): consumed in this transaction. */
    upgradePass?: { idHash: string; tokenVersion: number };
  },
): Promise<number | undefined> {
  return guarded(() =>
    db.transaction(async (tx) => {
      if (opts.upgradePass) {
        const [p] = await tx
          .update(passwordUpgradePasses)
          .set({ consumedAt: sql`now()` })
          .where(
            and(
              eq(passwordUpgradePasses.idHash, opts.upgradePass.idHash),
              eq(passwordUpgradePasses.userId, userId),
              isNull(passwordUpgradePasses.consumedAt),
              gt(passwordUpgradePasses.expiresAt, sql`now()`),
            ),
          )
          .returning({ idHash: passwordUpgradePasses.idHash });
        if (!p) throw new GuardFailed();
      }
      const [promoted] = /* unchanged */;
      if (!promoted) throw new GuardFailed();
      const [u] = await tx
        .update(users)
        .set({ mfaEnabledAt: sql`now()`, tokenVersion: sql`${users.tokenVersion} + 1` })
        .where(
          and(
            eq(users.id, userId),
            isNull(users.mfaEnabledAt),
            ...(opts.upgradePass
              ? [eq(users.tokenVersion, opts.upgradePass.tokenVersion)]
              : []),
          ),
        )
        .returning({ tokenVersion: users.tokenVersion });
      // …rest unchanged
```

Import `passwordUpgradePasses` from `@shared/schema`.

- [ ] **Step 5: Create `server/storage/upgrade-passes.ts`**

```ts
import {
  mfaTrustedDevices,
  passwordUpgradePasses,
  users,
  type PasswordUpgradePass,
} from "@shared/schema";
import {
  UPGRADE_PASS_MAX_ATTEMPTS,
  UPGRADE_PASS_TTL_MINUTES,
} from "@shared/constants/password-upgrade";
import { db } from "../db";
import { and, eq, gt, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { GuardFailed, guarded } from "./mfa";

// A short password's restricted pass (password policy spec §6). Every
// expiry / counter / single-use check is ONE statement on the database clock,
// the pattern of mfa.ts.

const live = (idHash: string) =>
  and(
    eq(passwordUpgradePasses.idHash, idHash),
    isNull(passwordUpgradePasses.consumedAt),
    gt(passwordUpgradePasses.expiresAt, sql`now()`),
  );

/** Mint a pass; drops this user's dead ones first (as createMfaChallenge does). */
export async function createUpgradePass(p: {
  idHash: string;
  userId: string;
  tokenVersion: number;
  twoStepAllowed: boolean;
}): Promise<void> {
  await db
    .delete(passwordUpgradePasses)
    .where(
      and(
        eq(passwordUpgradePasses.userId, p.userId),
        or(
          lte(passwordUpgradePasses.expiresAt, sql`now()`),
          isNotNull(passwordUpgradePasses.consumedAt),
        ),
      ),
    );
  await db.insert(passwordUpgradePasses).values({
    ...p,
    expiresAt: sql`now() + (${UPGRADE_PASS_TTL_MINUTES} * interval '1 minute')`,
  });
}

/** Unconsumed, unexpired, and not yet out of attempts. */
export async function getLiveUpgradePass(
  idHash: string,
): Promise<PasswordUpgradePass | undefined> {
  const [row] = await db
    .select()
    .from(passwordUpgradePasses)
    .where(
      and(
        live(idHash),
        lt(passwordUpgradePasses.attempts, UPGRADE_PASS_MAX_ATTEMPTS),
      ),
    );
  return row;
}

/** Count one code attempt; undefined once the pass is dead, spent or capped. */
export async function reserveUpgradePassAttempt(
  idHash: string,
): Promise<PasswordUpgradePass | undefined> {
  const [row] = await db
    .update(passwordUpgradePasses)
    .set({ attempts: sql`${passwordUpgradePasses.attempts} + 1` })
    .where(
      and(
        live(idHash),
        lt(passwordUpgradePasses.attempts, UPGRADE_PASS_MAX_ATTEMPTS),
      ),
    )
    .returning();
  return row;
}

/**
 * "Choose a longer password": consume the pass, write the hash, end every
 * session, forget trusted phones, drop a staged email change, all in one
 * transaction. Refused (undefined) when the pass was already used or the
 * account's tokenVersion moved on since it was minted.
 */
export async function completePasswordUpgrade(p: {
  idHash: string;
  userId: string;
  tokenVersion: number;
  newPasswordHash: string;
}): Promise<number | undefined> {
  return guarded(() =>
    db.transaction(async (tx) => {
      const [consumed] = await tx
        .update(passwordUpgradePasses)
        .set({ consumedAt: sql`now()` })
        .where(and(live(p.idHash), eq(passwordUpgradePasses.userId, p.userId)))
        .returning({ idHash: passwordUpgradePasses.idHash });
      if (!consumed) throw new GuardFailed();
      const [u] = await tx
        .update(users)
        .set({
          password: p.newPasswordHash,
          pendingEmail: null,
          tokenVersion: sql`${users.tokenVersion} + 1`,
        })
        .where(
          and(
            eq(users.id, p.userId),
            eq(users.tokenVersion, p.tokenVersion),
            isNull(users.mfaEnabledAt),
          ),
        )
        .returning({ tokenVersion: users.tokenVersion });
      if (!u) throw new GuardFailed();
      await tx
        .delete(mfaTrustedDevices)
        .where(eq(mfaTrustedDevices.userId, p.userId));
      return u.tokenVersion;
    }),
  );
}
```

Wire `createUpgradePass`, `getLiveUpgradePass`, `reserveUpgradePassAttempt` and `completePasswordUpgrade` into `server/storage/index.ts`, next to the `mfa.*` block (`import * as upgradePasses from "./upgrade-passes";`).

- [ ] **Step 6: Run the storage tests**

Run: `npx vitest run server/storage/__tests__/upgrade-passes.test.ts server/storage/__tests__/mfa.test.ts`
Expected: PASS. This includes every existing `mfa.test.ts` case.

- [ ] **Step 7: Write the failing lib test**

`server/lib/__tests__/upgrade-pass.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { storage } from "../../storage";
import {
  hashUpgradePassToken,
  needsPasswordUpgrade,
  newUpgradePassToken,
  startUpgradePass,
} from "../upgrade-pass";
import { hashChallengeToken } from "../mfa/mfa-secrets";

vi.mock("../../storage", () => ({ storage: { createUpgradePass: vi.fn() } }));
beforeEach(() => vi.resetAllMocks());

describe("upgrade pass helpers", () => {
  it("hash is sha256 of 'pw-upgrade:' + token, distinct from a challenge hash", () => {
    const t = newUpgradePassToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashUpgradePassToken(t)).toBe(
      crypto.createHash("sha256").update(`pw-upgrade:${t}`).digest("hex"),
    );
    expect(hashUpgradePassToken(t)).not.toBe(hashChallengeToken(t));
  });

  it.each([
    [null, "a".repeat(14), true],
    [null, "a".repeat(15), false],
    [new Date(), "a".repeat(8), false],
    [null, "😀".repeat(14), true], // code points, not UTF-16 units
  ])("needsPasswordUpgrade(mfa=%s, len) → %s", (mfaEnabledAt, pw, want) => {
    expect(needsPasswordUpgrade({ mfaEnabledAt }, pw)).toBe(want);
  });

  it("startUpgradePass stores only the hash, bound to tokenVersion; ≥8 allows two-step", async () => {
    const r = await startUpgradePass(
      { id: "u1", tokenVersion: 3 },
      "a".repeat(8),
    );
    expect(r).toEqual({
      status: "upgrade_required",
      pass: expect.any(String),
      canUseTwoStep: true,
    });
    expect(storage.createUpgradePass).toHaveBeenCalledWith({
      idHash: hashUpgradePassToken(r.pass),
      userId: "u1",
      tokenVersion: 3,
      twoStepAllowed: true,
    });
  });

  it("a password under 8 gets a pass that does not allow two-step", async () => {
    const r = await startUpgradePass({ id: "u1", tokenVersion: 0 }, "demo123");
    expect(r.canUseTwoStep).toBe(false);
    expect(
      vi.mocked(storage.createUpgradePass).mock.calls[0][0].twoStepAllowed,
    ).toBe(false);
  });
});
```

- [ ] **Step 8: Run to verify it fails**

Run: `npx vitest run server/lib/__tests__/upgrade-pass.test.ts`
Expected: FAIL. `../upgrade-pass` does not exist.

- [ ] **Step 9: Create `server/lib/upgrade-pass.ts`**

```ts
import crypto from "node:crypto";
import { storage } from "../storage";
import {
  PASSWORD_MIN_SINGLE_FACTOR,
  PASSWORD_MIN_WITH_MFA,
  passwordLength,
} from "@shared/constants/password-policy";

/**
 * A correct password under 15 on an account without two-step (password
 * policy spec §5.2): a restricted pass, no session. Answered with HTTP 200,
 * like MfaRequired, so loginAccountLimiter never counts a correct password.
 */
export type UpgradeRequired = {
  status: "upgrade_required";
  pass: string;
  canUseTwoStep: boolean;
};

export function newUpgradePassToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashUpgradePassToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(`pw-upgrade:${token}`)
    .digest("hex");
}

export function needsPasswordUpgrade(
  user: { mfaEnabledAt: Date | null },
  password: string,
): boolean {
  return (
    user.mfaEnabledAt === null &&
    passwordLength(password) < PASSWORD_MIN_SINGLE_FACTOR
  );
}

/**
 * Below 8, turning two-step on would still leave the password under the
 * floor, so that pass only offers "choose a longer password".
 */
export async function startUpgradePass(
  user: { id: string; tokenVersion: number },
  password: string,
): Promise<UpgradeRequired> {
  const pass = newUpgradePassToken();
  const canUseTwoStep = passwordLength(password) >= PASSWORD_MIN_WITH_MFA;
  await storage.createUpgradePass({
    idHash: hashUpgradePassToken(pass),
    userId: user.id,
    tokenVersion: user.tokenVersion,
    twoStepAllowed: canUseTwoStep,
  });
  return { status: "upgrade_required", pass, canUseTwoStep };
}
```

- [ ] **Step 10: Run the lib and storage tests**

Run: `npx vitest run server/lib/__tests__/upgrade-pass.test.ts server/storage/__tests__/upgrade-passes.test.ts`
Expected: PASS.

- [ ] **Step 11: Commit** `feat(server): upgrade pass storage and helpers`

---

### Task 3: `requireUpgradePass` middleware

**Files:**

- Create: `server/middleware/upgrade-pass.ts`
- Test: `server/middleware/__tests__/upgrade-pass.test.ts`

**Interfaces:**

- Consumes: `storage.getLiveUpgradePass`, `storage.getUserForAuth`, `hashUpgradePassToken` (Task 2).
- Produces:
  - `requireUpgradePass(req, res, next): Promise<void>`
  - `interface UpgradePassContext { idHash: string; tokenVersion: number; twoStepAllowed: boolean; user: User }`
  - `upgradePassOf(res: Response): UpgradePassContext`
  - `UPGRADE_PASS_EXPIRED_MESSAGE = "This sign-in expired. Please sign in again."`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { storage } from "../../storage";
import { requireUpgradePass, upgradePassOf } from "../upgrade-pass";
import { hashUpgradePassToken } from "../../lib/upgrade-pass";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: { getLiveUpgradePass: vi.fn(), getUserForAuth: vi.fn() },
}));

const TOKEN = "t".repeat(43);
function app() {
  const a = express();
  a.post("/x", requireUpgradePass, (req, res) => {
    const ctx = upgradePassOf(res);
    res.json({ userId: req.userId, twoStepAllowed: ctx.twoStepAllowed });
  });
  return a;
}
const livePass = (over = {}) => ({
  idHash: hashUpgradePassToken(TOKEN),
  userId: "1",
  tokenVersion: 0,
  attempts: 0,
  twoStepAllowed: true,
  expiresAt: new Date(Date.now() + 60_000),
  consumedAt: null,
  createdAt: new Date(),
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(storage.getLiveUpgradePass).mockResolvedValue(livePass());
  vi.mocked(storage.getUserForAuth).mockResolvedValue(
    createMockUser({ id: "1", tokenVersion: 0, mfaEnabledAt: null }),
  );
});

const expired = (res: request.Response) => {
  expect(res.status).toBe(401);
  expect(res.body.code).toBe("UPGRADE_PASS_EXPIRED");
};

describe("requireUpgradePass", () => {
  it("a live pass → next(), with req.userId and the pass context set", async () => {
    const res = await request(app())
      .post("/x")
      .set("Authorization", `UpgradePass ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ userId: "1", twoStepAllowed: true });
    expect(storage.getLiveUpgradePass).toHaveBeenCalledWith(
      hashUpgradePassToken(TOKEN),
    );
  });
  it("a Bearer header (a JWT) is never accepted, and storage is never asked", async () => {
    expired(
      await request(app()).post("/x").set("Authorization", `Bearer ${TOKEN}`),
    );
    expect(storage.getLiveUpgradePass).not.toHaveBeenCalled();
  });
  it("no header → 401", async () => expired(await request(app()).post("/x")));
  it("an absurd token length → 401 without a lookup", async () => {
    expired(
      await request(app())
        .post("/x")
        .set("Authorization", `UpgradePass ${"t".repeat(500)}`),
    );
    expect(storage.getLiveUpgradePass).not.toHaveBeenCalled();
  });
  it("unknown, consumed, expired or capped (no live row) → 401", async () => {
    vi.mocked(storage.getLiveUpgradePass).mockResolvedValue(undefined);
    expired(
      await request(app())
        .post("/x")
        .set("Authorization", `UpgradePass ${TOKEN}`),
    );
  });
  it("tokenVersion moved on (a reset elsewhere) → 401", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({ id: "1", tokenVersion: 1, mfaEnabledAt: null }),
    );
    expired(
      await request(app())
        .post("/x")
        .set("Authorization", `UpgradePass ${TOKEN}`),
    );
  });
  it("the account turned two-step on since → 401", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({ id: "1", tokenVersion: 0, mfaEnabledAt: new Date() }),
    );
    expired(
      await request(app())
        .post("/x")
        .set("Authorization", `UpgradePass ${TOKEN}`),
    );
  });
  it("user deleted → 401", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(undefined);
    expired(
      await request(app())
        .post("/x")
        .set("Authorization", `UpgradePass ${TOKEN}`),
    );
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/middleware/__tests__/upgrade-pass.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Implement**

```ts
import type { NextFunction, Request, Response } from "express";
import type { User } from "@shared/schema";
import { ErrorCode } from "@shared/constants/error-codes";
import { storage } from "../storage";
import { sendError } from "../lib/api-errors";
import { setRequestUserId } from "../lib/request-context";
import { hashUpgradePassToken } from "../lib/upgrade-pass";
import { createServiceLogger, toError } from "../lib/logger";

const logger = createServiceLogger("upgrade-pass");
const SCHEME = "UpgradePass ";
export const UPGRADE_PASS_EXPIRED_MESSAGE =
  "This sign-in expired. Please sign in again.";

export interface UpgradePassContext {
  idHash: string;
  tokenVersion: number;
  twoStepAllowed: boolean;
  user: User;
}

/** The pass the middleware accepted. Only call behind requireUpgradePass. */
export function upgradePassOf(res: Response): UpgradePassContext {
  return res.locals.upgradePass as UpgradePassContext;
}

/**
 * Accepts ONLY `Authorization: UpgradePass <token>` (password policy spec §6).
 * A different scheme from requireAuth's Bearer, so neither credential can
 * stand in for the other.
 */
export async function requireUpgradePass(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const expired = () =>
    sendError(
      res,
      401,
      UPGRADE_PASS_EXPIRED_MESSAGE,
      ErrorCode.UPGRADE_PASS_EXPIRED,
    );
  const header = req.headers.authorization;
  if (!header?.startsWith(SCHEME)) return expired();
  const token = header.slice(SCHEME.length);
  if (token.length < 20 || token.length > 100) return expired();
  try {
    const idHash = hashUpgradePassToken(token);
    const pass = await storage.getLiveUpgradePass(idHash);
    if (!pass) return expired();
    const user = await storage.getUserForAuth(pass.userId);
    if (
      !user ||
      user.tokenVersion !== pass.tokenVersion ||
      user.mfaEnabledAt !== null
    )
      return expired();
    req.userId = user.id;
    setRequestUserId(user.id);
    res.locals.upgradePass = {
      idHash,
      tokenVersion: pass.tokenVersion,
      twoStepAllowed: pass.twoStepAllowed,
      user,
    } satisfies UpgradePassContext;
    next();
  } catch (err) {
    logger.error({ err: toError(err) }, "upgrade pass check failed");
    sendError(res, 500, "Something went wrong", ErrorCode.INTERNAL_ERROR);
  }
}
```

Add `UPGRADE_PASS_EXPIRED: "UPGRADE_PASS_EXPIRED"` and `UPGRADE_TWO_STEP_NOT_ALLOWED: "UPGRADE_TWO_STEP_NOT_ALLOWED"` to `shared/constants/error-codes.ts` next to the `PASSWORD_*` codes. Check whether that file has a test that enumerates its codes, and update it if so.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/middleware/__tests__/upgrade-pass.test.ts`
Expected: PASS (8/8).

- [ ] **Step 5: Commit** `feat(server): requireUpgradePass middleware`

---

### Task 4: Move TOTP staging and first-enrollment confirm into a service

**Files:**

- Create: `server/services/mfa-totp.ts`
- Modify: `server/routes/auth-mfa.ts`: `/totp/setup`, `/totp/reset` and `/totp/confirm` call the service, and `stageSecret` is deleted.
- Modify: `server/services/email.ts`: add the `enabled_at_sign_in` notice kind (R5).
- Test: `server/services/__tests__/mfa-totp.test.ts`. The regression gate is `server/routes/__tests__/auth-mfa-manage.test.ts`, which must stay green unchanged.

**Interfaces:**

- Produces:
  - `class TotpUnavailableError extends Error`
  - `stageTotpSecret(user: Pick<User, "id" | "username">): Promise<{ secret: string; otpauthUrl: string }>`: throws `TotpUnavailableError` when no key is configured.
  - `checkPendingTotpCode(userId: string, code: string): Promise<{ ok: true; step: number } | { ok: false; reason: "wrong_code" | "unavailable" }>`
  - `confirmFirstEnrollment(user: User, step: number, opts?: { upgradePass?: { idHash: string; tokenVersion: number } }): Promise<string[] | undefined>`: returns the plain recovery codes, or `undefined` when the storage guard refused.

- [ ] **Step 1: Write the failing service test**

Mock `../../storage` (`startTotpEnrollment`, `getPendingTotpSecret`, `confirmTotpEnrollment`) and `../email` (`sendTwoFactorNotice`). Set `MFA_SECRET_ENC_KEY` the way `auth-mfa-manage.test.ts` does. Cases:

```ts
it("stageTotpSecret stores only the encrypted secret and returns the authenticator link", async () => {
  const r = await stageTotpSecret({ id: "1", username: "testuser" });
  expect(r.secret).toMatch(/^[A-Z2-7]{32}$/);
  expect(r.otpauthUrl).toContain("OCRecipes:testuser");
  expect(vi.mocked(storage.startTotpEnrollment).mock.calls[0][1]).toMatch(
    /^v1:/,
  );
});
it("stageTotpSecret with no key → TotpUnavailableError, nothing stored", async () => {
  delete process.env.MFA_SECRET_ENC_KEY;
  await expect(
    stageTotpSecret({ id: "1", username: "u" }),
  ).rejects.toBeInstanceOf(TotpUnavailableError);
  expect(storage.startTotpEnrollment).not.toHaveBeenCalled();
});
describe("checkPendingTotpCode", () => {
  const SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
  const now = () => hotp(base32Decode(SECRET), timeStep(Date.now()));
  it("right code → ok with its step", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      encryptMfaSecret(SECRET),
    );
    expect(await checkPendingTotpCode("1", now())).toEqual({
      ok: true,
      step: expect.any(Number),
    });
  });
  it("wrong code → wrong_code", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      encryptMfaSecret(SECRET),
    );
    const wrong = now() === "000000" ? "111111" : "000000";
    expect(await checkPendingTotpCode("1", wrong)).toEqual({
      ok: false,
      reason: "wrong_code",
    });
  });
  it("nothing pending (or expired) → wrong_code", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(undefined);
    expect(await checkPendingTotpCode("1", "123456")).toEqual({
      ok: false,
      reason: "wrong_code",
    });
  });
  it("a pending secret the key can't decrypt → unavailable", async () => {
    vi.mocked(storage.getPendingTotpSecret).mockResolvedValue(
      "v1:not-really-ciphertext",
    );
    expect(await checkPendingTotpCode("1", "123456")).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
it("confirmFirstEnrollment returns 10 codes, stores only their hashes, passes upgradePass through, sends the notice", async () => {
  vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(1);
  const codes = await confirmFirstEnrollment(user, 5, {
    upgradePass: { idHash: "h", tokenVersion: 0 },
  });
  expect(codes).toHaveLength(10);
  const [, opts] = vi.mocked(storage.confirmTotpEnrollment).mock.calls[0];
  expect(opts.upgradePass).toEqual({ idHash: "h", tokenVersion: 0 });
  expect(opts.recoveryHashes).not.toContain(codes![0]);
  expect(sendTwoFactorNotice).toHaveBeenCalledWith(
    user.email,
    user.username,
    "enabled_at_sign_in",
  );
});
it("confirmFirstEnrollment without a pass sends the ordinary 'enabled' notice", async () => {
  /* … "enabled" */
});
it("the guard refused → undefined, no notice", async () => {
  vi.mocked(storage.confirmTotpEnrollment).mockResolvedValue(undefined);
  expect(await confirmFirstEnrollment(user, 5)).toBeUndefined();
  expect(sendTwoFactorNotice).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/services/__tests__/mfa-totp.test.ts`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Implement the service**

```ts
import type { User } from "@shared/schema";
import { storage } from "../storage";
import { sendTwoFactorNotice } from "./email";
import { fireAndForget } from "../lib/fire-and-forget";
import { base32Decode, matchTotp, otpauthUrl } from "../lib/mfa/totp";
import {
  decryptMfaSecret,
  encryptMfaSecret,
  generateRecoveryCodes,
  hashRecoveryCode,
  mfaConfigured,
  newTotpSecret,
  normalizeRecoveryCode,
} from "../lib/mfa/mfa-secrets";

// Authenticator setup shared by /api/auth/mfa/totp/* (signed in) and
// /api/auth/upgrade/totp/* (a short password's pass), password policy spec §6.
// Callers have already authenticated the user; they map results to responses.

export class TotpUnavailableError extends Error {}

export async function stageTotpSecret(user: Pick<User, "id" | "username">) {
  if (!mfaConfigured()) throw new TotpUnavailableError();
  const secret = newTotpSecret();
  await storage.startTotpEnrollment(user.id, encryptMfaSecret(secret));
  return { secret, otpauthUrl: otpauthUrl(secret, user.username) };
}

export async function checkPendingTotpCode(
  userId: string,
  code: string,
): Promise<
  | { ok: true; step: number }
  | { ok: false; reason: "wrong_code" | "unavailable" }
> {
  const pendingEnc = await storage.getPendingTotpSecret(userId);
  if (!pendingEnc) return { ok: false, reason: "wrong_code" };
  let secret: Buffer;
  try {
    secret = base32Decode(decryptMfaSecret(pendingEnc));
  } catch {
    return { ok: false, reason: "unavailable" };
  }
  const step = matchTotp(secret, code, Date.now());
  return step === null
    ? { ok: false, reason: "wrong_code" }
    : { ok: true, step };
}

export async function confirmFirstEnrollment(
  user: User,
  step: number,
  opts: { upgradePass?: { idHash: string; tokenVersion: number } } = {},
): Promise<string[] | undefined> {
  const recoveryCodes = generateRecoveryCodes();
  const version = await storage.confirmTotpEnrollment(user.id, {
    acceptedStep: step,
    recoveryHashes: recoveryCodes.map((c) =>
      hashRecoveryCode(user.id, normalizeRecoveryCode(c)!),
    ),
    ...(opts.upgradePass ? { upgradePass: opts.upgradePass } : {}),
  });
  if (version === undefined) return undefined;
  fireAndForget(
    "mfa-notice",
    sendTwoFactorNotice(
      user.email,
      user.username,
      opts.upgradePass ? "enabled_at_sign_in" : "enabled",
    ),
  );
  return recoveryCodes;
}
```

In `server/services/email.ts`, add `"enabled_at_sign_in"` to `TwoFactorNoticeKind` and to `TWO_FACTOR_NOTICES`:

```ts
  enabled_at_sign_in: {
    subject: "Two-step verification is on",
    first: (u) =>
      `Two-step verification was turned on for <strong>${u}</strong> while signing in, and other devices were signed out. Resetting your password by email won't turn it off, so if this wasn't you, contact support (below) rather than resetting.`,
  },
```

- [ ] **Step 4: Point the auth-mfa routes at the service**

In `server/routes/auth-mfa.ts`:

- **Delete** `stageSecret`.
- **`/totp/setup`:** replace `res.json(await stageSecret(user));` with `res.json(await stageTotpSecret(user));`.
- **`/totp/reset`:** keep `requireConfigured()` before the factor (a missing key must not spend a recovery code). Then `res.json({ ...(await stageTotpSecret(user)), ...replacement });`.
- **`answer()`:** map `TotpUnavailableError` to `Reply(503, MFA_UNAVAILABLE, MFA_UNAVAILABLE_MESSAGE)`. Add `if (error instanceof TotpUnavailableError) return sendError(res, 503, MFA_UNAVAILABLE_MESSAGE, ErrorCode.MFA_UNAVAILABLE, extra);` before the `Reply` check.
- **`/totp/confirm`:** replace the pending-secret block with:

```ts
const check = await checkPendingTotpCode(user.id, code);
if (!check.ok) {
  if (check.reason === "unavailable")
    throw new Reply(503, ErrorCode.MFA_UNAVAILABLE, MFA_UNAVAILABLE_MESSAGE);
  throw wrong;
}
let recoveryCodes: string[] | undefined;
if (user.mfaEnabledAt === null) {
  recoveryCodes = await confirmFirstEnrollment(user, check.step);
  if (!recoveryCodes)
    throw new Reply(
      409,
      ErrorCode.MFA_ALREADY_ENABLED,
      "Two-step verification is already on.",
    );
} else {
  // new-phone branch unchanged, using check.step
}
```

Delete the `notice(user, "enabled")` call on the first-setup path (the service sends it). Remove now-unused imports. The `lint` step of preflight catches leftovers.

- [ ] **Step 5: Run the service test and the regression gate**

Run: `npx vitest run server/services/__tests__/mfa-totp.test.ts server/routes/__tests__/auth-mfa-manage.test.ts server/routes/__tests__/auth-mfa-verify.test.ts`
Expected: PASS. `auth-mfa-manage.test.ts` must pass **unchanged**. If it asserts `sendTwoFactorNotice(..., "enabled")` on first setup, it still does, because the service sends `"enabled"` without a pass.

- [ ] **Step 6: Commit** `refactor(server): share authenticator setup between sign-in paths`

---

### Task 5: The upgrade routes

**Files:**

- Create: `server/routes/auth-upgrade.ts`
- Modify: `server/routes/_rate-limiters.ts`: add `upgradePassLimiter`.
- Modify: `server/routes/_schemas.ts`: add `upgradePasswordSchema`.
- Modify: `server/routes.ts`: register it after `registerAuthMfa`.
- Test: `server/routes/__tests__/auth-upgrade.test.ts`

**Interfaces:**

- Consumes: `requireUpgradePass`, `upgradePassOf`, `UPGRADE_PASS_EXPIRED_MESSAGE` (Task 3); `stageTotpSecret`, `checkPendingTotpCode`, `confirmFirstEnrollment`, `TotpUnavailableError` (Task 4); `storage.reserveUpgradePassAttempt`, `storage.completePasswordUpgrade` (Task 2); `checkNewPassword` (PR 1); `issueSession` (`auth-social.ts`).
- Produces: `POST /api/auth/upgrade/totp/setup` → `{ secret, otpauthUrl }`; `POST /api/auth/upgrade/totp/confirm { code }` → `{ status: "signed_in", user, token, recoveryCodes }`; `POST /api/auth/upgrade/password { newPassword }` → `{ status: "signed_in", user, token }`.

- [ ] **Step 1: Write the failing route tests**

Use the scaffolding of `auth-mfa-manage.test.ts`, with the **real** `requireUpgradePass`.

- Mock `../../storage` with `getLiveUpgradePass`, `getUserForAuth`, `getUser`, `reserveUpgradePassAttempt`, `completePasswordUpgrade`, `startTotpEnrollment`, `getPendingTotpSecret` and `confirmTotpEnrollment`.
- Mock `../../middleware/auth` (for `generateToken`/`invalidateTokenVersionCache`), `express-rate-limit`, `../../lib/pwned-password` (`isBreached` → false) and `../../services/email`.
- Requests send `Authorization: UpgradePass ${TOKEN}`.
- The `beforeEach` makes `getLiveUpgradePass` return a live pass (`tokenVersion: 0`, `twoStepAllowed: true`), makes the user no-MFA with `tokenVersion: 0`, and sets `MFA_SETUP_ENABLED=true` and `MFA_SECRET_ENC_KEY`.

Cases (each its own `it`):

`/upgrade/totp/setup`

1. Live pass → 200 with a secret. `startTotpEnrollment` is called for that user, and the body has no `password` requirement.
2. `MFA_SETUP_ENABLED` unset → 403 `MFA_SETUP_DISABLED`, nothing staged.
3. Pass with `twoStepAllowed: false` → 403 `UPGRADE_TWO_STEP_NOT_ALLOWED`, nothing staged.
4. No `MFA_SECRET_ENC_KEY` → 503 `MFA_UNAVAILABLE`.
5. `Authorization: Bearer <anything>` → 401 `UPGRADE_PASS_EXPIRED`.

`/upgrade/totp/confirm` 6. Right code → 200 with `token` and 10 `recoveryCodes`. `reserveUpgradePassAttempt` is called once, before the code is checked. `confirmTotpEnrollment` gets `upgradePass: { idHash: hashUpgradePassToken(TOKEN), tokenVersion: 0 }`. `invalidateTokenVersionCache("1")` is called. 7. Wrong code → 400 `INVALID_SECOND_FACTOR`. The attempt was still reserved, and nothing was confirmed. 8. `reserveUpgradePassAttempt` → undefined (capped or dead) → 401 `UPGRADE_PASS_EXPIRED`, and the code is never checked (`getPendingTotpSecret` not called). 9. The storage guard refused (`confirmTotpEnrollment` → undefined, a concurrent confirm won) → 401 `UPGRADE_PASS_EXPIRED`, no token. 10. Malformed code (`"12ab"`) → 400 `VALIDATION_ERROR`, no attempt reserved. 11. `twoStepAllowed: false` → 403, no attempt reserved.

`/upgrade/password` 12. 15+ new password → 200 with token. `completePasswordUpgrade` gets a `pv2$` hash, the pass `idHash`, `tokenVersion: 0` and `userId: "1"`. `sendPasswordChangedNotice` is called. 13. 14-character new password → 400 `PASSWORD_TOO_SHORT`, and the message is "Use at least 15 characters.". Nothing written, and no attempt reserved (R3). 14. Breached → 400 `PASSWORD_BREACHED`, nothing written. 15. `completePasswordUpgrade` → undefined (used twice, or a reset elsewhere) → 401 `UPGRADE_PASS_EXPIRED`, no token, no notice.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/routes/__tests__/auth-upgrade.test.ts`
Expected: FAIL. `../auth-upgrade` does not exist.

- [ ] **Step 3: Limiter and schema**

In `_rate-limiters.ts`:

```ts
/**
 * Short-password upgrade routes (password policy spec §6). Pre-auth, so
 * IP-keyed: mounted BEFORE requireUpgradePass, and keyByUser:false so it never
 * keys on the req.userId the pass sets. The per-pass cap (10) is in the DB.
 */
export const upgradePassLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many attempts, please try again later",
  keyByUser: false,
});
```

In `_schemas.ts`: `export const upgradePasswordSchema = z.object({ newPassword: newPasswordSchema });`

- [ ] **Step 4: Implement `server/routes/auth-upgrade.ts`**

```ts
import type { Express, Request, Response } from "express";
import { storage } from "../storage";
import { invalidateTokenVersionCache } from "../middleware/auth";
import {
  requireUpgradePass,
  upgradePassOf,
  UPGRADE_PASS_EXPIRED_MESSAGE,
} from "../middleware/upgrade-pass";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { handleRouteError, formatZodError } from "./_helpers";
import { upgradePassLimiter } from "./_rate-limiters";
import { mfaConfirmSchema, upgradePasswordSchema } from "./_schemas";
import { checkNewPassword } from "./_password-rules";
import { hashPassword } from "../lib/password-hash";
import { PASSWORD_MIN_SINGLE_FACTOR } from "@shared/constants/password-policy";
import { fireAndForget } from "../lib/fire-and-forget";
import { sendPasswordChangedNotice } from "../services/email";
import {
  checkPendingTotpCode,
  confirmFirstEnrollment,
  stageTotpSecret,
  TotpUnavailableError,
} from "../services/mfa-totp";
import { INVALID_SECOND_FACTOR_MESSAGE } from "../lib/mfa/password-proof-gate";
import { HttpFailure, issueSession } from "./auth-social";

// A short password's way out (password policy spec §6). Every route sits
// behind the pass, never requireAuth; the limiter comes first so guesses at
// the pass itself are counted per IP. Never log a code, secret or password.

const MFA_UNAVAILABLE_MESSAGE =
  "Two-step verification is unavailable right now. Please try again later.";

const expired = (res: Response) =>
  sendError(
    res,
    401,
    UPGRADE_PASS_EXPIRED_MESSAGE,
    ErrorCode.UPGRADE_PASS_EXPIRED,
  );

/** The two-step choice is closed: flag off, or the sign-in password was under 8. */
function twoStepClosed(res: Response): boolean {
  if (process.env.MFA_SETUP_ENABLED !== "true") {
    sendError(
      res,
      403,
      "Two-step verification isn't available yet.",
      ErrorCode.MFA_SETUP_DISABLED,
    );
    return true;
  }
  if (!upgradePassOf(res).twoStepAllowed) {
    sendError(
      res,
      403,
      "Choose a longer password instead.",
      ErrorCode.UPGRADE_TWO_STEP_NOT_ALLOWED,
    );
    return true;
  }
  return false;
}

function answer(res: Response, error: unknown, label: string) {
  if (error instanceof TotpUnavailableError)
    return sendError(
      res,
      503,
      MFA_UNAVAILABLE_MESSAGE,
      ErrorCode.MFA_UNAVAILABLE,
    );
  if (error instanceof HttpFailure)
    return sendError(res, error.status, error.message, error.code);
  handleRouteError(res, error, label);
}

export function register(app: Express): void {
  app.post(
    "/api/auth/upgrade/totp/setup",
    upgradePassLimiter,
    requireUpgradePass,
    async (_req: Request, res: Response) => {
      try {
        if (twoStepClosed(res)) return;
        res.json(await stageTotpSecret(upgradePassOf(res).user));
      } catch (error) {
        answer(res, error, "start two-step setup at sign-in");
      }
    },
  );

  app.post(
    "/api/auth/upgrade/totp/confirm",
    upgradePassLimiter,
    requireUpgradePass,
    async (req: Request, res: Response) => {
      try {
        const parsed = mfaConfirmSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        if (twoStepClosed(res)) return;
        const ctx = upgradePassOf(res);
        // Count the guess before checking it (cap 10 per pass).
        if (!(await storage.reserveUpgradePassAttempt(ctx.idHash)))
          return expired(res);
        const check = await checkPendingTotpCode(ctx.user.id, parsed.data.code);
        if (!check.ok) {
          return check.reason === "unavailable"
            ? sendError(
                res,
                503,
                MFA_UNAVAILABLE_MESSAGE,
                ErrorCode.MFA_UNAVAILABLE,
              )
            : sendError(
                res,
                400,
                INVALID_SECOND_FACTOR_MESSAGE,
                ErrorCode.INVALID_SECOND_FACTOR,
              );
        }
        // Consumes the pass in the same transaction: a double submit gets 401.
        const recoveryCodes = await confirmFirstEnrollment(
          ctx.user,
          check.step,
          {
            upgradePass: { idHash: ctx.idHash, tokenVersion: ctx.tokenVersion },
          },
        );
        if (!recoveryCodes) return expired(res);
        invalidateTokenVersionCache(ctx.user.id);
        res.json({ ...(await issueSession(ctx.user.id)), recoveryCodes });
      } catch (error) {
        answer(res, error, "confirm two-step setup at sign-in");
      }
    },
  );

  app.post(
    "/api/auth/upgrade/password",
    upgradePassLimiter,
    requireUpgradePass,
    async (req: Request, res: Response) => {
      try {
        const parsed = upgradePasswordSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const ctx = upgradePassOf(res);
        const rejected = await checkNewPassword(
          parsed.data.newPassword,
          PASSWORD_MIN_SINGLE_FACTOR,
          "single_factor",
        );
        // Answered here, never thrown: the rejection derives from the password.
        if (rejected)
          return sendError(
            res,
            rejected.status,
            rejected.message,
            rejected.code,
          );
        const version = await storage.completePasswordUpgrade({
          idHash: ctx.idHash,
          userId: ctx.user.id,
          tokenVersion: ctx.tokenVersion,
          newPasswordHash: await hashPassword(parsed.data.newPassword),
        });
        if (version === undefined) return expired(res);
        invalidateTokenVersionCache(ctx.user.id);
        fireAndForget(
          "password-changed-notice",
          sendPasswordChangedNotice(ctx.user.email, ctx.user.username),
        );
        res.json(await issueSession(ctx.user.id));
      } catch (error) {
        answer(res, error, "set a longer password at sign-in");
      }
    },
  );
}
```

In `server/routes.ts`: `import { register as registerAuthUpgrade } from "./routes/auth-upgrade";` and call `registerAuthUpgrade(app)` right after `registerAuthMfa(app)`.

- [ ] **Step 5: Run the route tests**

Run: `npx vitest run server/routes/__tests__/auth-upgrade.test.ts`
Expected: PASS (15/15).

- [ ] **Step 6: Commit** `feat(server): upgrade routes for a short password's pass`

---

### Task 6: The sign-in gate

**Files:**

- Modify: `server/routes/auth.ts`: the login route.
- Test: `server/routes/__tests__/auth.test.ts`

**Interfaces:**

- Consumes: `needsPasswordUpgrade`, `startUpgradePass` (Task 2).
- Produces: `POST /api/auth/login` → `200 { status: "upgrade_required", pass, canUseTwoStep }` for a correct password under 15 on a no-MFA account.

- [ ] **Step 1: Write the failing tests**

Add `createUpgradePass: vi.fn()` to the storage mock in `auth.test.ts`. In `beforeAll`, hash a 14-char and a 15-char password with `hashPassword` (PR 1 facade), and a 7-char one. New `describe("sign-in gate (spec §5.2)")`:

```ts
it("no two-step, correct 14-character password → 200 upgrade_required with a pass, NO token", async () => {
  vi.mocked(storage.getUserByUsernameForAuth).mockResolvedValue(
    createMockUser({
      password: pv2Fourteen,
      tokenVersion: 4,
      mfaEnabledAt: null,
    }),
  );
  const res = await request(app)
    .post("/api/auth/login")
    .send({ username: "testuser", password: FOURTEEN });
  expect(res.status).toBe(200);
  expect(res.body).toEqual({
    status: "upgrade_required",
    pass: expect.any(String),
    canUseTwoStep: true,
  });
  expect(res.body.token).toBeUndefined();
  expect(storage.createUpgradePass).toHaveBeenCalledWith(
    expect.objectContaining({ tokenVersion: 4, twoStepAllowed: true }),
  );
  expect(generateToken).not.toHaveBeenCalled();
});
it("a 7-character password → canUseTwoStep false", async () => {
  /* … */
});
it("a 15-character password → a session as before (switch on, but typed 15+ anyway)", async () => {
  /* token */
});
it("a two-step account with a 10-character password still gets the challenge, never the pass", async () => {
  /* mfa_required, createUpgradePass not called */
});
it("a wrong short password → 401, no pass", async () => {
  /* … */
});
it("email not verified wins over the gate (403 EMAIL_NOT_VERIFIED, no pass)", async () => {
  /* RESEND on, unverified */
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `npx vitest run server/routes/__tests__/auth.test.ts -t "sign-in gate"`
Expected: FAIL. The 14-char case returns a token.

- [ ] **Step 3: Implement**

In `auth.ts`, import `needsPasswordUpgrade, startUpgradePass` from `../lib/upgrade-pass`. Insert after the two-step `if (…) { return res.json(await startMfaChallenge(…)); }` block and before `generateToken`:

```ts
// A password under 15 can't stand alone on an account without
// two-step (password policy spec §5.2): a restricted pass, never a
// session. 200, like the challenge, so loginAccountLimiter doesn't
// count a correct password as a failure.
if (needsPasswordUpgrade(user, validated.password)) {
  return res.json(await startUpgradePass(user, validated.password));
}
```

- [ ] **Step 4: Run the whole auth test file and lengthen flipped fixtures**

Run: `npx vitest run server/routes/__tests__/auth.test.ts`
Expected: the new gate tests PASS. Existing success-path login tests that use `password123` (11 characters) on a no-MFA user now get `upgrade_required`. **That is the gate working, not a regression.** For each such test:

- If it asserts a token, switch it to a 15+ password (add `LONG_PASSWORD = "password123-long-enough"` and its pv2 hash next to `pv2Password123`).
- Leave the 401 tests, which never reach the gate, unchanged.

Re-run until green. Then sweep the whole directory, not just this file: `grep -ln 'api/auth/login' server/routes/__tests__/*.ts` (it also finds short fixtures like `whatever1` and `correctpassword`, e.g. `auth-reset-revocation.test.ts` signs in after a reset), and run `npx vitest run server/routes/__tests__/`. Apply the same fix wherever a success login with a short password on a no-MFA user expects a token.

- [ ] **Step 5: Commit** `feat(auth): a password under 15 gets the upgrade pass at sign-in`

---

### Task 7: The sign-up switch

**Files:**

- Modify: `shared/constants/password-policy.ts`: the `"signup"` message.
- Modify: `server/routes/_schemas.ts`: `registerSchema.twoStep`.
- Modify: `server/routes/auth.ts`: register route.
- Test: `shared/constants/__tests__/password-policy.test.ts`, `server/routes/__tests__/auth.test.ts`, `client/screens/__tests__/LoginScreen-utils.test.ts` (copy only)

**Interfaces:**

- Produces: `POST /api/auth/register` accepts `twoStep?: boolean` (default false). Minimum = 8 when true, else 15. The verification-off branch answers `201 { status: "upgrade_required", pass, canUseTwoStep }` instead of a token when the password is under 15.
- `passwordMessage("too_short", "signup")` → "Use at least 15 characters, or turn on two-step verification to use 8."

- [ ] **Step 1: Failing tests**

Policy test: `expect(passwordMessage("too_short", "signup")).toBe("Use at least 15 characters, or turn on two-step verification to use 8.")`. Update the existing assertion that expects "Use at least 15 characters." for `"signup"`. The `"single_factor"` copy stays.

Register tests in `auth.test.ts`:

```ts
it(
  "twoStep on: a 10-character password is accepted" /* 201 or verification_pending */,
);
it(
  "twoStep off (default): a 10-character password → 400 PASSWORD_TOO_SHORT with the switch copy" /* message toBe the new copy */,
);
it(
  "twoStep on: a 7-character password → 400 PASSWORD_TOO_SHORT 'Use at least 8 characters.'" /* … */,
);
it("verification OFF, twoStep on, 10 characters → 201 upgrade_required, NO token", async () => {
  // RESEND off (fail-open path); createUser resolves a no-MFA user
  expect(res.status).toBe(201);
  expect(res.body.status).toBe("upgrade_required");
  expect(res.body.token).toBeUndefined();
  expect(storage.createUpgradePass).toHaveBeenCalled();
});
it("verification OFF, 15+ characters → 201 token as before" /* … */);
it("twoStep must be a boolean" /* "yes" → 400 VALIDATION_ERROR */);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run shared/constants/__tests__/password-policy.test.ts server/routes/__tests__/auth.test.ts -t "twoStep|signup"`
Expected: FAIL.

- [ ] **Step 3: Implement**

`password-policy.ts`:

```ts
/** signup = sign-up with the two-step switch off; mfa = two-step on (or the switch on); single_factor = two-step off. */
export type PasswordContext = "signup" | "mfa" | "single_factor";
…
  if (context === "mfa") return `Use at least ${PASSWORD_MIN_WITH_MFA} characters.`;
  if (context === "signup")
    return `Use at least ${PASSWORD_MIN_SINGLE_FACTOR} characters, or turn on two-step verification to use ${PASSWORD_MIN_WITH_MFA}.`;
  return `Use at least ${PASSWORD_MIN_SINGLE_FACTOR} characters.`;
```

`_schemas.ts`, inside `registerSchema`:

```ts
  /** The sign-up "Use two-step verification" switch (spec P4): sets the minimum only, never stored. */
  twoStep: z.boolean().optional().default(false),
```

`auth.ts` register:

```ts
        const { username, password, email, twoStep } = parsed.data;
        …
        const rejected = await checkNewPassword(
          password,
          twoStep ? PASSWORD_MIN_WITH_MFA : PASSWORD_MIN_SINGLE_FACTOR,
          twoStep ? "mfa" : "signup",
        );
        …
        // Fail-open: pre-feature auto-login — but never a full session for a
        // password under 15 (spec §5.1): the switch-on account gets the pass.
        if (needsPasswordUpgrade(user, password)) {
          return res.status(201).json(await startUpgradePass(user, password));
        }
        const token = generateToken(…);
```

- [ ] **Step 4: Run, and fix copy-only fallout**

Run: `npx vitest run shared/constants/__tests__/password-policy.test.ts server/routes/__tests__/auth.test.ts client/screens/__tests__/LoginScreen-utils.test.ts client/screens/__tests__/LoginScreen.test.tsx`
Expected: PASS once every assertion on the old `"signup"` copy is updated to the new sentence. Only assertions that name the `"signup"` context change.

- [ ] **Step 5: Commit** `feat(auth): sign-up two-step switch sets the minimum to 8`

---

### Task 8: The Connect gate

**Files:**

- Modify: `server/routes/auth-social.ts`: the `/api/auth/social/link` password branch.
- Test: `server/routes/__tests__/auth-social.test.ts`

- [ ] **Step 1: Failing tests**

Add `createUpgradePass: vi.fn()` to that file's storage mock.

```ts
it("password branch, no two-step, correct 11-character password → 200 upgrade_required, NOTHING linked", async () => {
  // target: no MFA, hash of "right-pass1"
  expect(res.status).toBe(200);
  expect(res.body.status).toBe("upgrade_required");
  expect(storage.completeLinkFromTicket).not.toHaveBeenCalled();
  expect(res.body.token).toBeUndefined();
});
it("password branch, 15+ password → links and signs in as before" /* … */);
it(
  "provider branch (already-linked provider as proof) is never gated" /* short-password account, provider proof → links */,
);
it(
  "two-step account with a short password → still the challenge, not the pass" /* mfa_required */,
);
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run server/routes/__tests__/auth-social.test.ts -t "upgrade|gated|15\\+"`
Expected: the first case FAILS, because it links.

- [ ] **Step 3: Implement**

Import `needsPasswordUpgrade, startUpgradePass` from `../lib/upgrade-pass`. Right after the `if ("password" in body && secondFactor.requiresSecondFactor(target)) { … }` block, before `completeLinkFromTicket`:

```ts
// A short password on an account without two-step earns only the pass
// and links nothing (spec §5.2, P3): a linked provider signs in with
// no second factor, so linking first would walk around the gate.
if ("password" in body && needsPasswordUpgrade(target, body.password)) {
  return res.json(await startUpgradePass(target, body.password));
}
```

- [ ] **Step 4: Run the file and lengthen flipped fixtures**

Run: `npx vitest run server/routes/__tests__/auth-social.test.ts server/routes/__tests__/auth-social-link-throttle.test.ts`
Expected: the new tests PASS. Existing link-success tests using `right-pass1` (11 characters) on no-MFA users now get `upgrade_required`. Switch them to a 15+ password (and its hash) where they assert a session. Re-run until green.

- [ ] **Step 5: Commit** `feat(auth): Connect with a short password gets the pass and links nothing`

---

### Task 9: Retention sweep of dead passes

**Files:**

- Modify: `server/scripts/cleanup-retention.ts`
- Test: `server/scripts/__tests__/cleanup-retention.test.ts` (the existing file; add a `describe`)

**Interfaces:**

- Produces: `purgeDeadUpgradePasses(database: RetentionDb, now: Date): Promise<PurgeResult>` with `domain: "password_upgrade_passes"`, `retentionDays: 1`. `runRetentionCleanup` appends its result.

- [ ] **Step 1: Failing test**

Using the real test DB (copy that test file's existing setup), insert three passes for a test user:

- (a) expired 2 days ago;
- (b) consumed 2 days ago, unexpired;
- (c) live.

Run `purgeDeadUpgradePasses(tx, new Date())`. Expect `rowsDeleted: 2` and only (c) left. Also assert a pass expired 1 hour ago survives, since it is not yet a day dead.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/scripts/__tests__/cleanup-retention.test.ts -t "upgrade pass"`
Expected: FAIL. The function does not exist.

- [ ] **Step 3: Implement**

```ts
/**
 * Upgrade passes (password policy spec §6) die 30 minutes after they're
 * minted; drop rows a day after they died. Not per-user retention: no
 * active-user exemption applies. New passes also sweep their own user's
 * dead rows (storage/upgrade-passes.ts).
 */
export async function purgeDeadUpgradePasses(
  database: RetentionDb,
  now: Date,
): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const deleted = await database
    .delete(passwordUpgradePasses)
    .where(
      or(
        lt(passwordUpgradePasses.expiresAt, cutoff),
        lt(passwordUpgradePasses.consumedAt, cutoff),
      ),
    )
    .returning({ idHash: passwordUpgradePasses.idHash });
  return {
    domain: "password_upgrade_passes",
    rowsDeleted: deleted.length,
    retentionDays: 1,
  };
}
```

In `runRetentionCleanup`, after the scanned_items push: `results.push(await purgeDeadUpgradePasses(database, now));`. Add a line for it to `main()`'s banner.

- [ ] **Step 4: Run the whole cleanup test file**

Run: `npx vitest run server/scripts/__tests__/cleanup-retention.test.ts`
Expected: PASS. Any test that asserts `results.length === 3` becomes 4. Update it.

- [ ] **Step 5: Commit** `feat(server): retention sweep drops dead upgrade passes`

---

### Task 10: Integration test with real `requireAuth`, real DB and concurrent requests

**Files:**

- Modify: `test/integration/auth-routes.itest.ts`

- [ ] **Step 1: Write the new journeys**

Add `const { register: registerAuthUpgrade } = await import("../../server/routes/auth-upgrade");` and register it in `buildApp()`. Also import `registerAuthSocial` only if the link journey is added here. The Connect gate is already covered by unit tests in Task 8, so do **not** add it.

Helper: create a short-password user directly. The register route enforces 15 with the switch off, so use `storage.createUser({ username, email, password: await hashPassword("short-pass-12") })` (12 characters), then mark them verified if the verification path needs it.

```ts
describe("password upgrade pass (spec §6)", () => {
  it("short password → pass; the pass is useless on requireAuth routes; a longer password signs in and kills the pass", async () => {
    const { username } = await shortUser();
    const login = await request(buildApp())
      .post("/api/auth/login")
      .send({ username, password: "short-pass-12" });
    expect(login.status).toBe(200);
    expect(login.body.status).toBe("upgrade_required");
    expect(login.body.token).toBeUndefined();
    const pass = login.body.pass as string;

    // The pass is not a session, under either scheme name.
    expect(
      (
        await request(buildApp())
          .get("/api/auth/me")
          .set("Authorization", `Bearer ${pass}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(buildApp())
          .get("/api/auth/me")
          .set("Authorization", `UpgradePass ${pass}`)
      ).status,
    ).toBe(401);

    const done = await request(buildApp())
      .post("/api/auth/upgrade/password")
      .set("Authorization", `UpgradePass ${pass}`)
      .send({ newPassword: "a much longer password 2026" });
    expect(done.status).toBe(200);
    const me = await request(buildApp())
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${done.body.token}`);
    expect(me.status).toBe(200);

    // Single use.
    const again = await request(buildApp())
      .post("/api/auth/upgrade/password")
      .set("Authorization", `UpgradePass ${pass}`)
      .send({ newPassword: "another longer password 2026" });
    expect(again.status).toBe(401);
    expect(again.body.code).toBe("UPGRADE_PASS_EXPIRED");
  });

  it("a real JWT is refused by every upgrade route", async () => {
    const creds = uniqueCredentials();
    const reg = await request(buildApp())
      .post("/api/auth/register")
      .send(creds);
    for (const path of ["totp/setup", "totp/confirm", "password"]) {
      const r = await request(buildApp())
        .post(`/api/auth/upgrade/${path}`)
        .set("Authorization", `Bearer ${reg.body.token}`)
        .send({ code: "123456", newPassword: "x".repeat(20) });
      expect(r.status).toBe(401);
      expect(r.body.code).toBe("UPGRADE_PASS_EXPIRED");
    }
  });

  it("two concurrent confirms with the same right code: exactly one session and one set of 10 codes", async () => {
    // MFA_SETUP_ENABLED=true and MFA_SECRET_ENC_KEY stubbed as in the existing two-step journey.
    const { username, id } = await shortUser();
    const { pass } = (
      await request(buildApp())
        .post("/api/auth/login")
        .send({ username, password: "short-pass-12" })
    ).body;
    const setup = await request(buildApp())
      .post("/api/auth/upgrade/totp/setup")
      .set("Authorization", `UpgradePass ${pass}`);
    expect(setup.status).toBe(200);
    const code = hotp(base32Decode(setup.body.secret), timeStep(Date.now()));
    const confirm = () =>
      request(buildApp())
        .post("/api/auth/upgrade/totp/confirm")
        .set("Authorization", `UpgradePass ${pass}`)
        .send({ code });
    const results = await Promise.all([confirm(), confirm()]);
    // Exactly one winner. The loser's status depends on where the two
    // handlers interleave: 401 UPGRADE_PASS_EXPIRED (pass consumed, or the
    // transaction guard refused) or 400 INVALID_SECOND_FACTOR (the winner
    // already promoted the pending secret before the loser checked its code).
    // Both are correct; what must never happen is a second 200.
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect([400, 401]).toContain(statuses.find((s) => s !== 200));
    const winner = results.find((r) => r.status === 200)!;
    expect(winner.body.recoveryCodes).toHaveLength(10);
    const rows = await tx
      .select()
      .from(mfaRecoveryCodes)
      .where(eq(mfaRecoveryCodes.userId, id));
    expect(rows).toHaveLength(10);
  });
});
```

The `Promise.all` in the third test runs over the suite's single test transaction (one connection), so the two requests serialize. The test still pins that the guard admits exactly one winner, as `mfa.test.ts` documents. Say so in a comment, and do not claim true parallelism.

- [ ] **Step 2: Run**

Run: `npm run test:integration -- auth-routes` (or whichever script the README in `test/integration/` names)
Expected: PASS. If two 200s ever appear, the transaction guard (R6) is broken. Stop and debug it; never loosen the assertion.

- [ ] **Step 3: Commit** `test(auth): upgrade pass journeys against the real DB and requireAuth`

---

### Task 11: App — result types, request helper, `useAuth`

**Files:**

- Modify: `shared/types/auth.ts`
- Create: `client/lib/upgrade-pass-request.ts`
- Modify: `client/hooks/useAuth.ts`, `client/context/AuthContext.tsx`
- Test: `client/lib/__tests__/upgrade-pass-request.test.ts`, `client/hooks/__tests__/useAuth.test.ts`

**Interfaces:**

- Produces:
  - `type UpgradeRequiredResult = { status: "upgrade_required"; pass: string; canUseTwoStep: boolean }`
  - `SessionResult = SignedInResult | MfaChallengeResult | UpgradeRequiredResult`
  - `upgradeRequest(route: string, pass: string, data?: unknown): Promise<Response>`
  - `useAuth().register(username, password, email, ageConfirmed, twoStep): Promise<{ status: "authenticated"; user } | { status: "verification_pending" } | UpgradeRequiredResult>`
  - `useAuth().upgradeStartTwoStep(pass): Promise<TwoStepSecret>`
  - `useAuth().upgradeConfirmTwoStep(pass, code): Promise<{ session: SignedInResult; recoveryCodes: string[] }>`: does **not** sign in (R7).
  - `useAuth().upgradeSetPassword(pass, newPassword): Promise<void>`: signs in.

- [ ] **Step 1: Failing helper test**

```ts
it("sends UpgradePass, never the stored Bearer token", async () => {
  await tokenStorage.set("stored-jwt");
  const fetchSpy = vi
    .spyOn(global, "fetch")
    .mockResolvedValue(new Response("{}", { status: 200 }));
  await upgradeRequest("/api/auth/upgrade/password", "the-pass", {
    newPassword: "x",
  });
  const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
  expect(headers.Authorization).toBe("UpgradePass the-pass");
  expect(JSON.stringify(headers)).not.toContain("stored-jwt");
});
it(
  "a 401 throws ApiError(UPGRADE_PASS_EXPIRED) and does NOT fire the session-expired toast" /* mock notifyIfSessionExpired path per query-client's tests */,
);
```

Follow the existing mocking style of `client/lib/__tests__/query-client*.test.ts` for `fetch` and `tokenStorage`.

- [ ] **Step 2: Run to verify it fails**, then implement:

```ts
// client/lib/upgrade-pass-request.ts
import { apiRequest } from "@/lib/query-client";

/**
 * A request on a short password's restricted pass (password policy spec §6).
 * authToken null pins "no Bearer", so the stored session token is never sent
 * and a 401 never reads as an expired session.
 */
export function upgradeRequest(
  route: string,
  pass: string,
  data: unknown = {},
): Promise<Response> {
  return apiRequest(
    "POST",
    route,
    data,
    { headers: { Authorization: `UpgradePass ${pass}` } },
    null,
  );
}
```

- [ ] **Step 3: Types**

In `shared/types/auth.ts`:

```ts
/** A correct password under 15 on an account without two-step (password policy spec §5.2): a pass, no session. */
export type UpgradeRequiredResult = {
  status: "upgrade_required";
  pass: string;
  canUseTwoStep: boolean;
};
/** POST /api/auth/login and the password branch of /api/auth/social/link. */
export type SessionResult =
  | SignedInResult
  | MfaChallengeResult
  | UpgradeRequiredResult;
```

Run `npx tsc --noEmit -p .`. Every `SessionResult` consumer that now misses a branch shows up as a type error, or as a silent fall-through to the success branch: `LoginScreen`, `ConnectAccountScreen`, `AuthContext`. Those are fixed in Task 13. For now `useAuth` must compile.

- [ ] **Step 4: Failing `useAuth` tests**

In `useAuth.test.ts`:

- **login upgrade:** `login` returns `{ status: "upgrade_required", … }` unchanged and stores nothing (`tokenStorage.set` not called).
- **register upgrade:** `register(…, true)` sends `twoStep: true`. A `201 upgrade_required` body returns that result and stores nothing.
- **`upgradeConfirmTwoStep`:** returns `{ session, recoveryCodes }`, and `tokenStorage.set` is **not** called.
- **`upgradeSetPassword`:** calls `establishSession`, so `tokenStorage.set` is called with the returned token.

- [ ] **Step 5: Implement in `useAuth.ts`**

```ts
const data = (await response.json()) as
  | MfaChallengeResult
  | UpgradeRequiredResult
  | { user: User; token: string };
if ("status" in data) return data;
```

Add `twoStep: boolean` as the fifth `register` parameter, sent as `twoStep`. After `const data = await response.json();`:
`if (data.status === "upgrade_required") return data as UpgradeRequiredResult;` (before the `data.token` branch).

```ts
const upgradeStartTwoStep = useCallback(
  async (pass: string): Promise<TwoStepSecret> => {
    const res = await upgradeRequest("/api/auth/upgrade/totp/setup", pass);
    return (await res.json()) as TwoStepSecret;
  },
  [],
);

/** Returns the session WITHOUT signing in: the codes must be saved first (spec §6, R7). */
const upgradeConfirmTwoStep = useCallback(
  async (
    pass: string,
    code: string,
  ): Promise<{ session: SignedInResult; recoveryCodes: string[] }> => {
    const res = await upgradeRequest("/api/auth/upgrade/totp/confirm", pass, {
      code,
    });
    const { recoveryCodes, ...session } =
      (await res.json()) as SignedInResult & { recoveryCodes: string[] };
    return { session, recoveryCodes };
  },
  [],
);

const upgradeSetPassword = useCallback(
  async (pass: string, newPassword: string) => {
    const res = await upgradeRequest("/api/auth/upgrade/password", pass, {
      newPassword,
    });
    const { user, token } = (await res.json()) as SignedInResult;
    await establishSession(user, token);
  },
  [establishSession],
);
```

Expose all three, and add them plus the new `register` signature to `AuthContext`'s type.

- [ ] **Step 6: Run**

Run: `npx vitest run client/lib/__tests__/upgrade-pass-request.test.ts client/hooks/__tests__/useAuth.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit** `feat(client): upgrade pass request helper and auth calls`

---

### Task 12: Lift the authenticator setup steps into a shared component

**Files:**

- Create: `client/components/TotpEnrollmentSteps.tsx`
- Modify: `client/screens/TwoStepSetupScreen.tsx`
- Test: `client/components/__tests__/TotpEnrollmentSteps.test.tsx`. The regression gate is `client/screens/__tests__/TwoStepSetupScreen.test.tsx` and `TwoStepSetupScreen-utils.test.ts`, which stay green **unchanged**.

**Interfaces:**

- Produces:

```ts
type TotpEnrollmentStart =
  | { kind: "secret"; secret: { secret: string; otpauthUrl: string } }
  | { kind: "codes"; codes: string[] }; // "new recovery codes": straight to save-codes

interface TotpEnrollmentStepsProps {
  start: TotpEnrollmentStart;
  /** Checks the 6-digit code. Recovery codes on a first setup; undefined on a new phone. Throws ApiError. */
  confirm: (code: string) => Promise<string[] | undefined>;
  /** Static copy for a failed confirm other than a wrong code. */
  messageFor: (err: unknown) => string;
  /** Codes saved (issued = true) or none were issued (new phone). */
  onDone: (issued: boolean) => void;
  /** The #1364 leave guard input: true while codes are on screen unsaved. */
  onGuardChange: (guard: boolean) => void;
}
```

- [ ] **Step 1: Failing component tests**

Render with `@testing-library/react-native`, using the same providers as `TwoStepSetupScreen.test.tsx`:

1. With `start: secret`, it shows the formatted key. Next → code field. A 6-digit code + Confirm calls `confirm("123456")`.
2. `confirm` rejects with `ApiError(…, "INVALID_SECOND_FACTOR", 400)` → "That code didn't work. Check the time on your phone and try again." is shown.
3. `confirm` resolves with codes → the codes are listed. Done is disabled until "I've saved these" is ticked. Then Done calls `onDone(true)`.
4. `onGuardChange` is called with `true` when the save-codes step appears unticked, and with `false` after ticking.
5. `confirm` resolves `undefined` (new phone) → `onDone(false)` is called without a save step.
6. `start: codes` opens directly on save-codes.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run client/components/__tests__/TotpEnrollmentSteps.test.tsx`
Expected: FAIL. The module does not exist.

- [ ] **Step 3: Implement by moving code, not rewriting it**

- **What moves:** cut the `add-key`, `enter-code` and `save-codes` JSX, plus `openAuthenticator`, `copy` and `onConfirmCode`, from `TwoStepSetupScreen.tsx` into the component, unchanged except for reading props.
- **State the component owns:** `step: "add-key" | "enter-code" | "save-codes"` (starting at `start.kind === "codes" ? "save-codes" : "add-key"`), `code`, `codes`, `saved`, `busy`, `error`.
- **Guard reporting:** report the guard **from the same event handlers that change `step` or `saved`**: the confirm handler that enters save-codes calls `onGuardChange(true)`, and the "I've saved these" toggle calls `onGuardChange(shouldGuardLeave("save-codes", nextSaved))`. No `useEffect`: an effect lags one render, so the host's `usePreventRemove` would briefly see `false` with codes on screen. `TwoStepSetupScreen.test.tsx` reads the latest `usePreventRemove` call (`h.usePreventRemove.mock.calls.at(-1)`). For `start.kind === "codes"`, the host sets its guard to `true` itself when it sets `start`. The component imports `shouldGuardLeave`, `canFinishSaveCodes`, `formatSetupKey` and `recoveryCodesText` from `@/screens/TwoStepSetupScreen-utils`.
- **No `try/finally`, and no `&&`/ternary inside `try`.** React Compiler can't lower those (see `docs/solutions/code-quality/react-compiler-bails-on-a-conditional-inside-a-try-2026-10-10.md`). Keep the existing structure.

In `TwoStepSetupScreen.tsx`:

- **Leave guard:** `const [guard, setGuard] = useState(false); usePreventRemove(guard, …)` with the same Alert.
- **Confirm step:** keep the "confirm" (password + factor) step. On success:
  - `setup` / `new_phone` → `setStart({ kind: "secret", secret })`
  - `new_codes` → `setStart({ kind: "codes", codes })`
- **Render the component** when `start` is set:

```tsx
<TotpEnrollmentSteps
  start={start}
  confirm={async (c) => (await auth.confirmTwoStep(c)).recoveryCodes}
  messageFor={messageFor}
  onGuardChange={setGuard}
  onDone={(issued) =>
    finish(
      issued
        ? mode === "setup"
          ? "Two-step verification is on"
          : "New recovery codes saved"
        : "Two-step verification moved to this phone",
    )
  }
/>
```

Compute that `finish` message with a small helper in `TwoStepSetupScreen-utils.ts` (`finishMessage(mode, issued)`, unit-tested) rather than a nested ternary in JSX.

- [ ] **Step 4: Run the component tests and the regression gate**

Run: `npx vitest run client/components/__tests__/TotpEnrollmentSteps.test.tsx client/screens/__tests__/TwoStepSetupScreen.test.tsx client/screens/__tests__/TwoStepSetupScreen-utils.test.ts`
Expected: PASS. The screen tests pass **unchanged**. If one fails, the move changed behaviour. Fix the move, never the test.

Then run `npm run check:compiler-bailouts` (or the preflight bailout ratchet step), and expect 0 new bailouts.

- [ ] **Step 5: Commit** `refactor(client): shared authenticator setup steps`

---

### Task 13: `PasswordUpgradeScreen` and routing to it

**Files:**

- Create: `client/screens/PasswordUpgradeScreen.tsx`, `client/screens/PasswordUpgradeScreen-utils.ts`
- Modify: `client/navigation/RootStackNavigator.tsx`: param list + registration in the `!isAuthenticated` group.
- Modify: `client/screens/LoginScreen.tsx`: route `upgrade_required` from login **and** register.
- Modify: `client/screens/ConnectAccountScreen.tsx`
- Test: `client/screens/__tests__/PasswordUpgradeScreen-utils.test.ts`, `client/screens/__tests__/PasswordUpgradeScreen.test.tsx`, additions to `LoginScreen.test.tsx` and `ConnectAccountScreen.test.tsx`

**Interfaces:**

- Consumes: `upgradeStartTwoStep`, `upgradeConfirmTwoStep`, `upgradeSetPassword`, `finishSignIn` (Task 11); `TotpEnrollmentSteps` (Task 12); `validateNewPassword`, `BREACHED_PASSWORD_MESSAGE` (`LoginScreen-utils`).
- Produces: route `PasswordUpgrade: { pass: string; canUseTwoStep: boolean; purpose: "login" | "link" }`.

- [ ] **Step 1: Failing utils tests**

```ts
import {
  upgradeMessageFor,
  showTwoStepChoice,
  isPassExpired,
} from "../PasswordUpgradeScreen-utils";
it("two-step choice shows only when the pass allows it and setup isn't closed", () => {
  expect(showTwoStepChoice(true, false)).toBe(true);
  expect(showTwoStepChoice(false, false)).toBe(false);
  expect(showTwoStepChoice(true, true)).toBe(false);
});
it.each([
  ["UPGRADE_PASS_EXPIRED", "This sign-in expired. Please sign in again."],
  ["PASSWORD_TOO_SHORT", "Use at least 15 characters."],
  [
    "PASSWORD_BREACHED",
    "That password has appeared in a data breach. Choose a different one.",
  ],
  [
    "MFA_SETUP_DISABLED",
    "Two-step verification isn't available right now. Choose a longer password instead.",
  ],
  [
    "UPGRADE_TWO_STEP_NOT_ALLOWED",
    "Two-step verification isn't available right now. Choose a longer password instead.",
  ],
  [
    "RATE_LIMITED",
    "Too many attempts. Please wait a few minutes and try again.",
  ],
])("%s → static copy", (code, msg) =>
  expect(upgradeMessageFor(new ApiError("raw", code, 400))).toBe(msg),
);
it("an unknown error never shows its message", () =>
  expect(upgradeMessageFor(new Error("raw body"))).toBe(
    "Something went wrong. Please try again.",
  ));
it("isPassExpired", () =>
  expect(isPassExpired(new ApiError("x", "UPGRADE_PASS_EXPIRED", 401))).toBe(
    true,
  ));
```

Plus `closesTwoStep(err)`, which is true for `MFA_SETUP_DISABLED` / `UPGRADE_TWO_STEP_NOT_ALLOWED`.

- [ ] **Step 2: Run to verify they fail**, then implement the utils (pure, static copy per code).

- [ ] **Step 3: Failing screen tests (Review Focus 1 and 5)**

Mock `useAuthContext` with jest-style fns for the four calls.

1. With `canUseTwoStep: true`, both buttons render, "Turn on two-step verification" first.
2. With `canUseTwoStep: false`, only "Choose a longer password" renders.
3. **Codes before session (R7):** two-step → `upgradeStartTwoStep` resolves a secret → Next → enter code → Confirm → `upgradeConfirmTwoStep` resolves `{ session, recoveryCodes }`. At this point `finishSignIn` has **not** been called, and the codes are visible. Tick "I've saved these", then Done → `finishSignIn(session.user, session.token)` is called once.
4. `upgradeStartTwoStep` rejects `MFA_SETUP_DISABLED` → back on the choice view, the two-step button is gone, and the message is shown.
5. Longer-password path: a 14-char entry → "Use at least 15 characters." and `upgradeSetPassword` not called. A 15-char entry + matching confirm → `upgradeSetPassword(pass, pw)` is called.
6. Any call rejecting `UPGRADE_PASS_EXPIRED` → the expired message and a "Back to sign in" button that calls `navigation.goBack()` (Login is below it in the stack).
7. `purpose: "link"` shows "After this, tap Google or Apple again to connect it."

- [ ] **Step 4: Implement the screen**

Structure:

- **State:** `view: "choose" | "two-step" | "password"`, `twoStepClosed: boolean`, `secret`, `session` (held in state, R7), `guard`, `newPassword`, `confirmNewPassword`, `busy`, `error`, `expired`.
- **Leave guard:** `usePreventRemove(guard, …)` with the same Alert copy as `TwoStepSetupScreen`. The guard only applies while codes are unsaved.
- **Choose view:**
  - Title "Make your sign-in stronger".
  - Body "Your password is shorter than 15 characters. To keep signing in with it, turn on two-step verification, or choose a longer password."
  - The two buttons, gated by `showTwoStepChoice(canUseTwoStep, twoStepClosed)`. "Turn on two-step verification" calls `upgradeStartTwoStep`, then sets `view: "two-step"`.
- **Two-step view:**

```tsx
<TotpEnrollmentSteps
  start={{ kind: "secret", secret }}
  confirm={async (code) => {
    const r = await auth.upgradeConfirmTwoStep(pass, code);
    setSession(r.session);
    return r.recoveryCodes;
  }}
  messageFor={upgradeMessageFor}
  onGuardChange={setGuard}
  onDone={() => {
    if (session) void auth.finishSignIn(session.user, session.token);
  }}
/>
```

`onDone` reads `session` from state. The component only calls `onDone` after Confirm resolved and the codes were saved, so `session` is set. Keep the `if` guard anyway for the type.

- **Password view:**
  - New + confirm fields: `textContentType="newPassword"`, `autoComplete="new-password"`, `passwordRules="minlength: 15; maxlength: 128;"`, accessibility hint "At least 15 characters".
  - Validate with `validateNewPassword(pw, confirm, { min: PASSWORD_MIN_SINGLE_FACTOR, context: "single_factor" })`, then `upgradeSetPassword`. The stack swaps on success, so no navigation call is needed.
- **Error path:** route every caught error through `upgradeMessageFor`. Expired → `setExpired(true)`. `closesTwoStep(err)` → `setTwoStepClosed(true); setView("choose")`.
- **React Compiler:** no `try/finally`, and no conditionals inside `try` (compute them before).

Register the screen in `RootStackNavigator.tsx`:

- Add `PasswordUpgrade: { pass: string; canUseTwoStep: boolean; purpose: "login" | "link" };` to `RootStackParamList`, with a comment: "the pass lives only in this param, never in storage".
- Add a `<Stack.Screen name="PasswordUpgrade" component={PasswordUpgradeScreen} options={{ title: "Stronger sign-in" }} />` in the `!isAuthenticated` group, next to `TwoStepCode`.

- [ ] **Step 5: Route to it**

`LoginScreen.tsx`, login branch, after the `mfa_required` check:

```ts
if (result.status === "upgrade_required") {
  navigation.navigate("PasswordUpgrade", {
    pass: result.pass,
    canUseTwoStep: result.canUseTwoStep,
    purpose: "login",
  });
  return;
}
```

Register branch (verification off, switch on, under 15): the same navigation with `purpose: "login"`, placed **directly after `await register(…)` and before the existing `haptics.notification(Success)` line**. Today that haptic fires before `result.status` is read, and the upgrade case must not fire it.

`ConnectAccountScreen.tsx` `onPassword`, after the `mfa_required` branch:

```ts
if (result.status === "upgrade_required") {
  setBusy(false);
  navigation.replace("PasswordUpgrade", {
    pass: result.pass,
    canUseTwoStep: result.canUseTwoStep,
    purpose: "link",
  });
  return;
}
```

Add tests to `LoginScreen.test.tsx` and `ConnectAccountScreen.test.tsx`: `upgrade_required` navigates with the right params, and no success haptic fires.

- [ ] **Step 6: Run**

Run: `npx vitest run client/screens/__tests__/PasswordUpgradeScreen-utils.test.ts client/screens/__tests__/PasswordUpgradeScreen.test.tsx client/screens/__tests__/LoginScreen.test.tsx client/screens/__tests__/ConnectAccountScreen.test.tsx && npx tsc --noEmit -p .`
Expected: PASS, and tsc clean.

- [ ] **Step 7: Commit** `feat(client): password upgrade screen after a short-password sign-in`

---

### Task 14: The sign-up switch in the app

**Files:**

- Modify: `client/screens/LoginScreen-utils.ts`: `AuthFormInput.twoStep`, `validateAuthForm`, `getAuthErrorMessage`, plus new `registerPasswordRules(twoStep)` and `registerPasswordHint(twoStep)`.
- Modify: `client/screens/LoginScreen.tsx`
- Test: `client/screens/__tests__/LoginScreen-utils.test.ts`, `client/screens/__tests__/LoginScreen.test.tsx`

**Interfaces:**

- Produces:
  - `registerPasswordRules(twoStep: boolean): string`: `"minlength: 8; maxlength: 128;"` / `"minlength: 15; maxlength: 128;"`
  - `registerPasswordHint(twoStep: boolean): string`: "At least 8 characters." / "At least 15 characters, or 8 with two-step verification."
  - `getAuthErrorMessage(err, mode, opts?: { twoStep?: boolean })`

- [ ] **Step 1: Failing utils tests**

```ts
it("switch on: a 10-character sign-up password passes", () =>
  expect(
    validateAuthForm({
      ...validRegister,
      password: "a".repeat(10),
      confirmPassword: "a".repeat(10),
      twoStep: true,
    }),
  ).toBeNull());
it("switch off: 10 characters → the switch copy", () =>
  expect(
    validateAuthForm({
      ...validRegister,
      password: "a".repeat(10),
      confirmPassword: "a".repeat(10),
      twoStep: false,
    }),
  ).toBe(
    "Use at least 15 characters, or turn on two-step verification to use 8.",
  ));
it("switch on: 7 characters → 'Use at least 8 characters.'" /* … */);
it("server PASSWORD_TOO_SHORT with the switch on → the 8 copy", () =>
  expect(
    getAuthErrorMessage(
      new ApiError("x", "PASSWORD_TOO_SHORT", 400),
      "register",
      { twoStep: true },
    ),
  ).toBe("Use at least 8 characters."));
it("passwordRules and hint track the switch" /* both helpers, both values */);
```

Every existing `validateAuthForm` call site in tests gains `twoStep: false`. That is a type-required field change only.

- [ ] **Step 2: Run to verify they fail**, then implement:

```ts
// validateAuthForm, register branch:
const passwordError = validateNewPassword(
  input.password,
  input.confirmPassword,
  {
    min: input.twoStep ? PASSWORD_MIN_WITH_MFA : PASSWORD_MIN_SINGLE_FACTOR,
    context: input.twoStep ? "mfa" : "signup",
  },
);
```

`getAuthErrorMessage`: `passwordMessage("too_short", opts?.twoStep ? "mfa" : "signup")`.

- [ ] **Step 3: Failing screen test**

In register mode:

- A switch labelled "Use two-step verification (lets you use 8+ characters)" is present (`accessibilityRole="switch"`).
- Toggling it changes the hint text and the password field's `passwordRules`.
- Submitting calls `register(…, true)`.

In login mode the switch is absent.

- [ ] **Step 4: Implement in `LoginScreen.tsx`**

- **State:** `const [twoStep, setTwoStep] = useState(false);`. Reset it in `toggleMode`.
- **Form input:** `formInput` gains `twoStep`, `register(…, ageConfirmed, twoStep)`, and `getAuthErrorMessage(err, mode, { twoStep })`.
- **Password fields:** both register-mode fields use `passwordRules={registerPasswordRules(twoStep)}`. Delete the `REGISTER_PASSWORD_RULES` constant.
- **Switch row:** in register mode, above the age checkbox, a row with RN `Switch` (pattern from `TwoStepCodeScreen.tsx`, which already uses `Switch`): `value={twoStep}`, `onValueChange={setTwoStep}`, `accessibilityLabel="Use two-step verification (lets you use 8+ characters)"`, the label text beside it, and min height 44.
- **Hint:** under the password field in register mode, `<ThemedText type="small" style={{ color: theme.textSecondary }}>{registerPasswordHint(twoStep)}</ThemedText>`.

- [ ] **Step 5: Run**

Run: `npx vitest run client/screens/__tests__/LoginScreen-utils.test.ts client/screens/__tests__/LoginScreen.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit** `feat(client): sign-up two-step switch`

---

### Task 15: Dev account, docs and spec bookkeeping

**Files:**

- Modify: `.claude/skills/verify-ui/SKILL.md:35,142`, `.claude/skills/regression-triage/SKILL.md:16`, `docs/DEV_SETUP.md:145`, `server/scripts/seed-recipes.ts:267` (comment only)
- Modify (gitignored, main checkout): `docs/superpowers/specs/2026-10-10-password-policy-design.md`
- Modify: `todos/P2-2026-09-26-password-length-policy.md`
- Memory: `user_test_account.md` (and the `MEMORY.md` pointer line)

- [ ] **Step 1: Reset the dev `demo` password to 15+ (spec §5.7). Local dev DB only.**

Write `<scratchpad>/reset-demo-password.ts`:

```ts
import pg from "pg";
import { hashPassword } from "../../server/lib/password-hash"; // adjust to an absolute import path from the worktree
const url = new URL(process.env.DATABASE_URL!);
if (!["localhost", "127.0.0.1"].includes(url.hostname)) {
  throw new Error(`refusing: DATABASE_URL host is ${url.hostname}, not local`);
}
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();
const r = await client.query(
  "UPDATE users SET password = $1, token_version = token_version + 1 WHERE username = 'demo' RETURNING id",
  [await hashPassword("demo-password-2026")],
);
console.log(`updated ${r.rowCount} row(s)`);
await client.end();
```

Run it with `NODE_ENV=development npx tsx --env-file=.env <scratchpad>/reset-demo-password.ts`. The shell exports `NODE_ENV=production` (memory), so set it explicitly.
Expected: `updated 1 row(s)`. Then `curl -s -X POST localhost:3000/api/auth/login -H 'content-type: application/json' -d '{"username":"demo","password":"demo-password-2026"}'` against a dev server running this branch returns a `token` (18 characters, so no pass).

- [ ] **Step 2: Update the references**

Replace `demo123` with `demo-password-2026` in `verify-ui/SKILL.md` (both lines), `regression-triage/SKILL.md` and `DEV_SETUP.md`. Leave `seed-recipes.ts:267`'s comment as "demo account" without the old password. Update the `user_test_account.md` memory and its `MEMORY.md` line ("demo/demo-password-2026").

- [ ] **Step 3: Amend the spec (local, gitignored)**

- **§6 migration:** 0019 → 0020 (R1).
- **§6 cleanup:** "also swept per user on each new pass" (R4).
- **§6 attempts:** "`/upgrade/password` does not reserve an attempt" (R3).
- **§6 confirm:** "consumption shares `confirmTotpEnrollment`'s transaction" (R6).
- **§6 client:** "the app holds the confirm session until the codes are saved" (R7).
- **§8:** add `UPGRADE_TWO_STEP_NOT_ALLOWED` (R2).
- **Notice kind** `enabled_at_sign_in` (R5).

- [ ] **Step 4: Close the todo**

Tick the remaining acceptance criteria in `todos/P2-2026-09-26-password-length-policy.md`, citing PR 1 (#1368) and this PR. Set `status: done` and move the file to `todos/archive/`, never `done/`. Archiving happens in this PR, so the merge closes it.

- [ ] **Step 5: Commit** `docs: password policy part 2 bookkeeping; dev demo password is 15+`

---

## After the last task (not tasks: the executing skill's finish, listed so nothing is missed)

1. **Final whole-branch review** at the final head: the roster of 4, using `docs/AI_WORKFLOW.md`'s dispatch prompt verbatim with the `gh pr diff --name-only` list.
2. **Verification gates:**
   - Full Vitest suite and the integration suite green.
   - `npm run preflight:fast` by hand (it writes the stamp).
   - React Compiler bailouts: 0 new.
3. **PR:** `security` label. The body carries the rollout section below.
4. **Before merge (owner):**
   - Apply `migrations/0020_password_upgrade_passes.sql` to prod. The owner runs it, on their explicit yes, as with 0019.
   - Confirm the prod count:
     `SELECT count(*) FROM users WHERE mfa_enabled_at IS NULL AND password IS NOT NULL;`
5. **Merge** only on the owner's explicit yes.

## Rollout and the old-app window

- **Order:**
  1. The owner applies 0020 to prod.
  2. Merge; Railway deploys the server.
  3. Prod OTA, which the owner decides. Pull main into the main checkout first; see the memory "pull main before OTA".
- **Between deploy and OTA, an un-updated app misreads the new answer.** It treats `upgrade_required` as a session (`data as { user, token }`), stores `undefined` and lands on a broken signed-in state. This only affects an account with **no two-step and a password under 15**.
- **Who that hits today:** prod has only the owner's account, which has two-step on (device test 2026-10-10), so no one in prod. The dev `demo` account is fixed by Task 15 before then.
- **Why it isn't engineered around:** the app has no users (owner, 2026-10-06), and the OTA follows the deploy within minutes.
- **Rollback hazard (from PR 1, still in force):** never redeploy a server older than `4feb0d5`. Fix forward.
