# Sign in with Google and Apple Implementation Plan

> **STATUS: SHIPPED — history, not instructions.** Checked 2026-11-22: the files this plan creates are on `main`. The current code and `docs/OWNER_RULINGS.md` win over anything below.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Users can create an account or sign in with Google or Apple; the server verifies every provider ID token, links identities only under the spec's safe-linking rules, and revokes Apple tokens on account deletion.

**Architecture:** Native SDKs on the client (`expo-apple-authentication`, Universal Sign In edition of `@react-native-google-signin/google-signin`) return provider ID tokens bound to a server-issued one-use nonce. A new `server/routes/auth-social.ts` verifies them with `jose`, asks a pure `linking-policy.ts` what to do, and issues the existing JWT through a single gate (`sign-in-gates.ts`). Identities live in a new `user_identities` table; `users.password` becomes nullable.

**Tech Stack:** Express 5, Drizzle ORM / PostgreSQL, `jose` (new), Vitest + supertest, Expo SDK 54 / React Native 0.81, React Navigation native-stack.

**Spec:** `docs/superpowers/specs/2026-10-04-sign-in-with-google-and-apple-design.md` (owner-approved 2026-10-04). Read it before any task. Todo: `todos/P1-2026-09-26-sign-in-with-google-and-apple.md` (`human_led`, `security`).

## Global Constraints

- **Auth is high-risk in this repo: NEVER delegate a task in this plan to a cheap worker (kimi-\*).** Subagent implementers are fine; every task is reviewed.
- Five stacked PRs, one per Part below. Branches: `feat/siwa-1-schema` (from `main`), `feat/siwa-2-server-sign-in` (from 1), `feat/siwa-3-server-lifecycle` (from 2), `feat/siwa-4-client-sign-in` (from 3), `feat/siwa-5-client-settings` (from 4). **Retarget a child PR to `main` BEFORE merging its base.**
- Every PR: `security-auditor` + `code-reviewer` (dispatch prompt from `docs/AI_WORKFLOW.md` → Review Policy, verbatim), `human_led`, **never auto-merged**.
- Strict TDD: failing test → minimal code → green → commit. Commit messages go through Write + `git commit -F`.
- Do not run `test:run` / `check:types` / `lint` ad-hoc beyond the per-task targeted `npx vitest run <file>`; push runs `preflight:fast`; CI is the source of truth.
- Storage tests use the real dev DB via `test/db-test-utils.ts` (transaction per test). Run `npm run db:push` once after Task 1 so the dev DB has the new columns/tables.
- Route tests mock `../../storage` and `express-rate-limit`. Tests that assert anything about authentication **must NOT mock `../../middleware/auth`** (pattern: `server/routes/__tests__/auth-reset-revocation.test.ts`).
- Error codes are added to `shared/constants/error-codes.ts` (`ErrorCode`): `INVALID_PROVIDER_TOKEN`, `PROVIDER_EMAIL_REQUIRED`, `PROVIDER_NOT_CONFIGURED`, `PROVIDER_EXCHANGE_FAILED`, `INVALID_SIGN_IN_TICKET`, `IDENTITY_IN_USE`, `PROVIDER_ALREADY_CONNECTED`, `LAST_SIGN_IN_METHOD`, `SECOND_FACTOR_REQUIRED`.
- Nonce: server returns `{nonce, nonceHash}`; the client passes **`nonceHash`** to both SDKs and sends **`nonce`** back; server requires `claims.nonce === sha256Hex(nonce)` and then consumes the row. Expo's Apple module passes the nonce through unhashed (verified 2026-10-04).
- Google token: `aud === GOOGLE_OAUTH_WEB_CLIENT_ID`, `azp ∈ GOOGLE_OAUTH_APP_CLIENT_IDS`. Apple token: `aud === APPLE_BUNDLE_ID`, `iss === "https://appleid.apple.com"`.
- `requiresSecondFactor(user)` returns `false` until MFA ships. When true: respond **403 `SECOND_FACTOR_REQUIRED`, no token, no identity inserted**.
- Social sign-up requires `ageConfirmed: true` (`z.literal(true)`, same as `registerSchema`).
- iOS shows the Google button only when Apple is also available (guideline 4.8).
- PR 4 bumps `app.json` `runtimeVersion` `1.3.0` → `1.4.0`.
- PR 4 cannot merge until the Universal Sign In registry token is set on Railway, EAS, and GitHub Actions (owner).

## Review Focus

1. **Wrong password on the Connect prompt** — a person who mistypes once expects to retry, not to restart the Google/Apple sheet. Pinned in Task 11 (`link` attempts cap 5, ticket survives a wrong password).
2. **Username taken on ChooseUsername** — a 409 must leave the ticket usable so the person can try another name. Pinned in Task 4 (`createUserWithIdentity` rolls back) and Task 11 (route).
3. **Apple repeat sign-in without an email claim, on an already-linked account** — must still sign in; the missing-email 400 applies only when the identity is not yet linked. Pinned in Task 11.
4. **A social-only user opens Change Email** — the existing route requires a password; a `NULL` password must yield the normal 401, never a 500. Pinned in Task 2.
5. **Apple token exchange times out on a returning user who already has a stored token** — must not block the sign-in. Pinned in Task 11 (exchange skipped when a token is stored).

---

# Part 1 — PR 1: Schema + storage (`feat/siwa-1-schema`)

### Task 1: Schema — nullable password and three new tables

**Files:**

- Modify: `shared/schema.ts` (users.password at line ~61; new tables after `users`; types near line 1255)
- Test: `server/storage/__tests__/identities-schema.test.ts`

**Interfaces:**

- Produces: tables `userIdentities`, `authNonces`, `pendingSocialSignIns`; types `UserIdentity`, `InsertUserIdentity`, `AuthNonce`, `PendingSocialSignIn`; `User["password"]` becomes `string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// server/storage/__tests__/identities-schema.test.ts
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import { userIdentities, users } from "@shared/schema";
import { eq } from "drizzle-orm";

describe("identity schema", () => {
  beforeEach(async () => {
    await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("allows a user with a NULL password", async () => {
    const u = await createTestUser(getTestTx(), { password: null });
    expect(u.password).toBeNull();
  });

  it("rejects the same (provider, subject) twice", async () => {
    const tx = getTestTx();
    const a = await createTestUser(tx);
    const b = await createTestUser(tx);
    await tx
      .insert(userIdentities)
      .values({ userId: a.id, provider: "google", providerSubject: "sub-1" });
    await expect(
      tx
        .insert(userIdentities)
        .values({ userId: b.id, provider: "google", providerSubject: "sub-1" }),
    ).rejects.toThrow(/user_identities_provider_subject_unique/);
  });

  it("rejects a second identity of the same provider on one user", async () => {
    const tx = getTestTx();
    const a = await createTestUser(tx);
    await tx
      .insert(userIdentities)
      .values({ userId: a.id, provider: "apple", providerSubject: "s1" });
    await expect(
      tx
        .insert(userIdentities)
        .values({ userId: a.id, provider: "apple", providerSubject: "s2" }),
    ).rejects.toThrow(/user_identities_user_provider_unique/);
  });

  it("rejects an unknown provider", async () => {
    const tx = getTestTx();
    const a = await createTestUser(tx);
    await expect(
      tx
        .insert(userIdentities)
        .values({ userId: a.id, provider: "facebook", providerSubject: "x" }),
    ).rejects.toThrow(/user_identities_provider_check/);
  });

  it("cascades identities when the user is deleted", async () => {
    const tx = getTestTx();
    const a = await createTestUser(tx);
    await tx
      .insert(userIdentities)
      .values({ userId: a.id, provider: "google", providerSubject: "g" });
    await tx.delete(users).where(eq(users.id, a.id));
    const left = await tx
      .select()
      .from(userIdentities)
      .where(eq(userIdentities.userId, a.id));
    expect(left).toHaveLength(0);
  });
});
```

Note: the `rejects.toThrow(/constraint_name/)` match relies on pg putting the constraint name in the message. If it does not, assert `err.cause?.constraint` via `uniqueViolationConstraint` from `server/lib/db-errors.ts` instead.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/storage/__tests__/identities-schema.test.ts`
Expected: FAIL — `userIdentities` is not exported / type error on `password: null`.

- [ ] **Step 3: Implement the schema**

In `shared/schema.ts`, change `password: text("password").notNull(),` to:

```ts
    /**
     * bcrypt hash, or NULL for an account created through Google/Apple that has
     * never set a password. Password login treats NULL as a wrong password (same
     * 401 + dummy bcrypt compare). A password reset sets one.
     */
    password: text("password"),
```

After the `users` table, add:

```ts
/**
 * One row per linked Google/Apple login. Matched ONLY on (provider,
 * provider_subject) — never on email (emails change; Apple's may be a relay).
 * See docs/superpowers/specs/2026-10-04-sign-in-with-google-and-apple-design.md §3.2.
 */
export const userIdentities = pgTable(
  "user_identities",
  {
    id: varchar("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    /** Display only — never used for matching. */
    email: text("email"),
    isPrivateRelay: boolean("is_private_relay").default(false).notNull(),
    /** AES-256-GCM ciphertext (server/lib/social-identity/token-crypto.ts). Apple only. */
    appleRefreshTokenEnc: text("apple_refresh_token_enc"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => ({
    providerSubjectUnique: uniqueIndex(
      "user_identities_provider_subject_unique",
    ).on(table.provider, table.providerSubject),
    userProviderUnique: uniqueIndex("user_identities_user_provider_unique").on(
      table.userId,
      table.provider,
    ),
    userIdIdx: index("user_identities_user_id_idx").on(table.userId),
    providerCheck: check(
      "user_identities_provider_check",
      sql`${table.provider} in ('google', 'apple')`,
    ),
  }),
);

/** One-use sign-in nonces. Only the SHA-256 hex of the raw nonce is stored. */
export const authNonces = pgTable(
  "auth_nonces",
  {
    nonceHash: text("nonce_hash").primaryKey(),
    purpose: text("purpose").notNull(),
    /** NULL for public nonces; the signed-in user for bound ones (checked at consume). */
    userId: varchar("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    purposeCheck: check(
      "auth_nonces_purpose_check",
      sql`${table.purpose} in ('sign_in', 'link', 'reauth')`,
    ),
    expiresIdx: index("auth_nonces_expires_at_idx").on(table.expiresAt),
  }),
);

/**
 * A verified provider identity waiting on ChooseUsername or the Connect prompt.
 * The client holds only the raw ticket; we store its SHA-256 hex.
 */
export const pendingSocialSignIns = pgTable(
  "pending_social_sign_ins",
  {
    ticketHash: text("ticket_hash").primaryKey(),
    kind: text("kind").notNull(),
    provider: text("provider").notNull(),
    providerSubject: text("provider_subject").notNull(),
    email: text("email").notNull(),
    isPrivateRelay: boolean("is_private_relay").default(false).notNull(),
    /** isAuthoritative(claims) at verification time (linking-policy.ts). */
    providerAuthoritative: boolean("provider_authoritative").notNull(),
    displayName: text("display_name"),
    appleRefreshTokenEnc: text("apple_refresh_token_enc"),
    targetUserId: varchar("target_user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    /** Wrong-password attempts on the Connect prompt; capped at 5. */
    attempts: integer("attempts").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    kindCheck: check(
      "pending_social_sign_ins_kind_check",
      sql`${table.kind} in ('sign_up', 'link')`,
    ),
    expiresIdx: index("pending_social_sign_ins_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);
```

Ensure `index`, `uniqueIndex`, `check`, `integer`, `boolean`, `varchar`, `timestamp` are in the `drizzle-orm/pg-core` import at the top (most already are; add any missing).

Near the other `$inferSelect` types (line ~1256):

```ts
export type UserIdentity = typeof userIdentities.$inferSelect;
export type InsertUserIdentity = typeof userIdentities.$inferInsert;
export type AuthNonce = typeof authNonces.$inferSelect;
export type PendingSocialSignIn = typeof pendingSocialSignIns.$inferSelect;
```

- [ ] **Step 4: Push the schema to the dev DB and run the test**

Run: `npm run db:push` then `npx vitest run server/storage/__tests__/identities-schema.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/schema.ts server/storage/__tests__/identities-schema.test.ts
git commit -F <msg-file>   # "feat(auth): identities schema + nullable password"
```

### Task 2: Make every `user.password` reader NULL-safe

**Files:**

- Modify: `server/routes/auth.ts` (login ~line 362, change-email ~646, delete-account ~826); export `serializeUser` and `DUMMY_PASSWORD_HASH`
- Create: `server/lib/password-check.ts`
- Test: `server/lib/__tests__/password-check.test.ts`, extend `server/routes/__tests__/auth.test.ts`

**Interfaces:**

- Produces: `passwordMatches(input: string, hash: string | null): Promise<boolean>` — always does one bcrypt compare. `serializeUser` and `DUMMY_PASSWORD_HASH` exported from `server/routes/auth.ts`.

- [ ] **Step 1: Find every reader**

Run: `grep -rn "\.password\b" server shared --include='*.ts' | grep -v __tests__`
Expected today: `auth.ts` login, change-email, delete-account. Any additional hit gets the same treatment.

- [ ] **Step 2: Write the failing tests**

```ts
// server/lib/__tests__/password-check.test.ts
import { describe, it, expect, vi } from "vitest";
import bcrypt from "bcrypt";
import { passwordMatches } from "../password-check";

describe("passwordMatches", () => {
  it("is false for a NULL hash and still runs one bcrypt compare", async () => {
    const spy = vi.spyOn(bcrypt, "compare");
    await expect(passwordMatches("anything", null)).resolves.toBe(false);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("is true for the right password", async () => {
    const hash = await bcrypt.hash("correct horse", 4);
    await expect(passwordMatches("correct horse", hash)).resolves.toBe(true);
  });

  it("is false for the wrong password", async () => {
    const hash = await bcrypt.hash("correct horse", 4);
    await expect(passwordMatches("nope", hash)).resolves.toBe(false);
  });
});
```

In `server/routes/__tests__/auth.test.ts`, add (using the file's existing `app`/mock setup and `createMockUser`):

```ts
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
      .set("Authorization", "Bearer x")
      .send({ newEmail: "new@example.com", password: "whatever1" });
    expect(res.status).toBe(401);
  });

  it("delete-account with a password body returns 401, not 500", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({ id: "1", password: null }),
    );
    const res = await request(app)
      .delete("/api/auth/account")
      .set("Authorization", "Bearer x")
      .send({ password: "whatever1" });
    expect(res.status).toBe(401);
  });
});
```

(Match the file's existing pattern for authenticated requests — it mocks `../../middleware/auth`, so follow how existing change-email / delete tests set `req.userId`.)

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run server/lib/__tests__/password-check.test.ts server/routes/__tests__/auth.test.ts -t "NULL password|passwordMatches"`
Expected: FAIL — module missing; routes 500 on `bcrypt.compare(x, null)` (or a type error).

- [ ] **Step 4: Implement**

```ts
// server/lib/password-check.ts
import bcrypt from "bcrypt";

// Same fixed cost-12 hash login uses for the missing-user branch, so a NULL
// password (social-only account) costs the same ~250ms as a wrong one.
export const DUMMY_PASSWORD_HASH =
  "$2b$12$Dr3GzjhqTPluaG3QtTffX.SA5LiZi/05bbk8i97iK0z0QygBxFIgy";

/** One bcrypt compare, always. NULL hash ⇒ false (never a throw, never a fast path). */
export async function passwordMatches(
  input: string,
  hash: string | null,
): Promise<boolean> {
  if (hash === null) {
    await bcrypt.compare(input, DUMMY_PASSWORD_HASH);
    return false;
  }
  return bcrypt.compare(input, hash);
}
```

In `server/routes/auth.ts`:

- Delete the local `DUMMY_PASSWORD_HASH` constant and `import { passwordMatches, DUMMY_PASSWORD_HASH } from "../lib/password-check";` (the login missing-user branch still compares against `DUMMY_PASSWORD_HASH` directly).
- Replace the three `bcrypt.compare(<pw>, user.password)` calls with `passwordMatches(<pw>, user.password)`.
- Change `function serializeUser(` to `export function serializeUser(`.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run server/lib/__tests__/password-check.test.ts server/routes/__tests__/auth.test.ts`
Expected: PASS (whole file — existing tests must stay green).

- [ ] **Step 6: Pin "add a password via reset" on a NULL-password account** — in `server/storage/__tests__/users-password-reset.test.ts`, add a case: `createTestUser(tx, { password: null })`, issue a code, reserve, `completePasswordReset(id, hash, newHash)` → `true`, and the row's `password` equals `newHash`. Run it; it should pass without code changes (the reset path never reads the old password). If it fails, fix the storage function in this task.

- [ ] **Step 7: Commit** — `fix(auth): NULL-safe password checks for social-only accounts`

### Task 3: Token encryption for Apple refresh tokens

**Files:**

- Create: `server/lib/social-identity/token-crypto.ts`
- Test: `server/lib/social-identity/__tests__/token-crypto.test.ts`

**Interfaces:**

- Produces: `loadIdentityKey(raw?: string): Buffer`; `encryptToken(plain: string, key?: Buffer): string`; `decryptToken(blob: string, key?: Buffer): string`. Format `v1:<iv b64>:<tag b64>:<ciphertext b64>`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { encryptToken, decryptToken, loadIdentityKey } from "../token-crypto";

const key = crypto.randomBytes(32);

describe("token-crypto", () => {
  it("round-trips", () => {
    const blob = encryptToken("r.apple-refresh", key);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(blob).not.toContain("r.apple-refresh");
    expect(decryptToken(blob, key)).toBe("r.apple-refresh");
  });

  it("uses a fresh IV each time", () => {
    expect(encryptToken("same", key)).not.toBe(encryptToken("same", key));
  });

  it("rejects a tampered ciphertext", () => {
    const [v, iv, tag, ct] = encryptToken("secret", key).split(":");
    const flipped = Buffer.from(ct, "base64");
    flipped[0] ^= 1;
    expect(() =>
      decryptToken([v, iv, tag, flipped.toString("base64")].join(":"), key),
    ).toThrow();
  });

  it("rejects the wrong key", () => {
    const blob = encryptToken("secret", key);
    expect(() => decryptToken(blob, crypto.randomBytes(32))).toThrow();
  });

  it("loadIdentityKey requires exactly 32 bytes", () => {
    expect(() => loadIdentityKey(undefined)).toThrow(/IDENTITY_TOKEN_ENC_KEY/);
    expect(() =>
      loadIdentityKey(crypto.randomBytes(16).toString("base64")),
    ).toThrow(/32 bytes/);
    expect(loadIdentityKey(key.toString("base64"))).toHaveLength(32);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/lib/social-identity/__tests__/token-crypto.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// server/lib/social-identity/token-crypto.ts
import crypto from "node:crypto";

// Independent of JWT_SECRET on purpose: rotating JWT_SECRET must not make
// stored Apple refresh tokens unreadable (we could no longer revoke them).
export function loadIdentityKey(
  raw: string | undefined = process.env.IDENTITY_TOKEN_ENC_KEY,
): Buffer {
  if (!raw) throw new Error("IDENTITY_TOKEN_ENC_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("IDENTITY_TOKEN_ENC_KEY must decode to 32 bytes");
  }
  return key;
}

export function encryptToken(
  plain: string,
  key: Buffer = loadIdentityKey(),
): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64"),
    tag.toString("base64"),
    ct.toString("base64"),
  ].join(":");
}

export function decryptToken(
  blob: string,
  key: Buffer = loadIdentityKey(),
): string {
  const [version, iv, tag, ct] = blob.split(":");
  if (version !== "v1" || !iv || !tag || !ct)
    throw new Error("Unrecognised token blob");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ct, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
```

- [ ] **Step 4: Run** — Expected: PASS (5).
- [ ] **Step 5: Commit** — `feat(auth): AES-256-GCM helper for stored provider tokens`

### Task 4: Identity storage (nonces, tickets, identities, social user creation)

**Files:**

- Create: `server/lib/social-identity/nonce.ts`, `server/storage/identities.ts`
- Modify: `server/storage/index.ts` (import + register functions on `storage`)
- Test: `server/storage/__tests__/identities.test.ts`

**Interfaces:**

- Produces (in `nonce.ts`): `sha256Hex(s: string): string`; `randomToken(): string` (32 random bytes, base64url).
- Produces (on `storage`):
  - `issueNonce(purpose: NoncePurpose, userId: string | null): Promise<{ nonce: string; nonceHash: string }>`
  - `consumeNonce(nonce: string, purpose: NoncePurpose, userId: string | null): Promise<boolean>`
  - `createPendingSignIn(input: PendingSignInInput): Promise<string>` (returns raw ticket)
  - `reservePendingLinkAttempt(ticket: string): Promise<PendingSocialSignIn | undefined>` (increments `attempts`, only while `< 5` and unexpired, `kind = 'link'`)
  - `getPendingSignIn(ticket: string, kind: "sign_up" | "link"): Promise<PendingSocialSignIn | undefined>`
  - `completeLinkFromTicket(ticket: string, opts: { markEmailVerified: boolean }): Promise<UserIdentity | undefined>` (txn: delete ticket, insert identity, optionally set `users.email_verified = true`)
  - `createUserWithIdentity(ticket: string, username: string): Promise<User | undefined>` (txn; `undefined` = ticket invalid; throws `ReservedUsernameError` / unique violations, which roll back so the ticket survives)
  - `findIdentity(provider: ProviderName, sub: string): Promise<UserIdentity | undefined>`
  - `listIdentities(userId: string): Promise<UserIdentity[]>`
  - `insertIdentity(input: InsertUserIdentity): Promise<UserIdentity>`
  - `deleteIdentity(userId: string, provider: ProviderName): Promise<UserIdentity | undefined>`
  - `setAppleRefreshToken(identityId: string, enc: string): Promise<void>`
  - `touchIdentity(identityId: string): Promise<void>`
  - `getSignInMethods(userId: string): Promise<SignInMethods>`
- Types exported from `server/storage/identities.ts`: `NoncePurpose = "sign_in" | "link" | "reauth"`; `ProviderName = "google" | "apple"`; `PendingSignInInput`; `SignInMethods = { password: boolean; google: { email: string | null } | null; apple: { email: string | null; isPrivateRelay: boolean } | null }`.

- [ ] **Step 1: Write the failing tests**

```ts
// server/storage/__tests__/identities.test.ts
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import { authNonces, pendingSocialSignIns, users } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { sha256Hex } from "../../lib/social-identity/nonce";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const ids = await import("../identities");

const baseTicket = {
  provider: "google" as const,
  providerSubject: "g-sub",
  email: "new@gmail.com",
  isPrivateRelay: false,
  providerAuthoritative: true,
  displayName: "New Person",
  appleRefreshTokenEnc: null,
};

describe("identities storage", () => {
  beforeEach(async () => {
    await setupTestTransaction();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  describe("nonces", () => {
    it("issues a nonce whose hash is stored, and consumes it exactly once", async () => {
      const { nonce, nonceHash } = await ids.issueNonce("sign_in", null);
      expect(nonceHash).toBe(sha256Hex(nonce));
      expect(await ids.consumeNonce(nonce, "sign_in", null)).toBe(true);
      expect(await ids.consumeNonce(nonce, "sign_in", null)).toBe(false);
    });

    it("rejects the wrong purpose", async () => {
      const { nonce } = await ids.issueNonce("sign_in", null);
      expect(await ids.consumeNonce(nonce, "reauth", null)).toBe(false);
    });

    it("rejects an expired nonce", async () => {
      const { nonce, nonceHash } = await ids.issueNonce("sign_in", null);
      await getTestTx()
        .update(authNonces)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(authNonces.nonceHash, nonceHash));
      expect(await ids.consumeNonce(nonce, "sign_in", null)).toBe(false);
    });

    it("binds a reauth nonce to its user", async () => {
      const a = await createTestUser(getTestTx());
      const b = await createTestUser(getTestTx());
      const { nonce } = await ids.issueNonce("reauth", a.id);
      expect(await ids.consumeNonce(nonce, "reauth", b.id)).toBe(false);
      expect(await ids.consumeNonce(nonce, "reauth", a.id)).toBe(true);
    });

    it("accepts a public link nonce from an unauthenticated caller", async () => {
      const { nonce } = await ids.issueNonce("link", null);
      expect(await ids.consumeNonce(nonce, "link", null)).toBe(true);
    });

    it("rejects a user-bound link nonce for another user", async () => {
      const a = await createTestUser(getTestTx());
      const b = await createTestUser(getTestTx());
      const { nonce } = await ids.issueNonce("link", a.id);
      expect(await ids.consumeNonce(nonce, "link", b.id)).toBe(false);
    });
  });

  describe("createUserWithIdentity", () => {
    it("creates a passwordless verified user with the identity and burns the ticket", async () => {
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "sign_up",
        targetUserId: null,
      });
      const user = await ids.createUserWithIdentity(ticket, "new_person");
      expect(user?.password).toBeNull();
      expect(user?.emailVerified).toBe(true);
      expect(user?.displayName).toBe("New Person");
      expect(await ids.findIdentity("google", "g-sub")).toMatchObject({
        userId: user!.id,
      });
      expect(
        await ids.createUserWithIdentity(ticket, "other_name"),
      ).toBeUndefined();
    });

    it("keeps the ticket when the username is taken", async () => {
      await createTestUser(getTestTx(), { username: "taken_name" });
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "sign_up",
        targetUserId: null,
      });
      await expect(
        ids.createUserWithIdentity(ticket, "taken_name"),
      ).rejects.toThrow();
      const user = await ids.createUserWithIdentity(ticket, "free_name");
      expect(user?.username).toBe("free_name");
    });

    it("refuses a link-kind ticket", async () => {
      const target = await createTestUser(getTestTx());
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "link",
        targetUserId: target.id,
      });
      expect(
        await ids.createUserWithIdentity(ticket, "someone"),
      ).toBeUndefined();
    });
  });

  describe("link tickets", () => {
    it("allows at most 5 reserved attempts", async () => {
      const target = await createTestUser(getTestTx());
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "link",
        targetUserId: target.id,
      });
      for (let i = 0; i < 5; i++)
        expect(await ids.reservePendingLinkAttempt(ticket)).toBeDefined();
      expect(await ids.reservePendingLinkAttempt(ticket)).toBeUndefined();
    });

    it("completeLinkFromTicket inserts the identity, can verify the email, and burns the ticket", async () => {
      const target = await createTestUser(getTestTx(), {
        emailVerified: false,
      });
      const ticket = await ids.createPendingSignIn({
        ...baseTicket,
        kind: "link",
        targetUserId: target.id,
      });
      const identity = await ids.completeLinkFromTicket(ticket, {
        markEmailVerified: true,
      });
      expect(identity).toMatchObject({ userId: target.id, provider: "google" });
      const [row] = await getTestTx()
        .select()
        .from(users)
        .where(eq(users.id, target.id));
      expect(row.emailVerified).toBe(true);
      expect(
        await ids.completeLinkFromTicket(ticket, { markEmailVerified: false }),
      ).toBeUndefined();
    });
  });

  describe("getSignInMethods", () => {
    it("reports password presence and linked providers", async () => {
      const u = await createTestUser(getTestTx(), { password: null });
      await ids.insertIdentity({
        userId: u.id,
        provider: "apple",
        providerSubject: "a",
        email: "x@privaterelay.appleid.com",
        isPrivateRelay: true,
      });
      expect(await ids.getSignInMethods(u.id)).toEqual({
        password: false,
        google: null,
        apple: { email: "x@privaterelay.appleid.com", isPrivateRelay: true },
      });
    });
  });

  it("deleteIdentity removes only that provider", async () => {
    const u = await createTestUser(getTestTx());
    await ids.insertIdentity({
      userId: u.id,
      provider: "apple",
      providerSubject: "a",
    });
    await ids.insertIdentity({
      userId: u.id,
      provider: "google",
      providerSubject: "g",
    });
    expect(await ids.deleteIdentity(u.id, "apple")).toMatchObject({
      provider: "apple",
    });
    expect((await ids.listIdentities(u.id)).map((i) => i.provider)).toEqual([
      "google",
    ]);
  });

  it("pending tickets store only the hash", async () => {
    const ticket = await ids.createPendingSignIn({
      ...baseTicket,
      kind: "sign_up",
      targetUserId: null,
    });
    const rows = await getTestTx().select().from(pendingSocialSignIns);
    expect(rows.some((r) => r.ticketHash === sha256Hex(ticket))).toBe(true);
    expect(rows.some((r) => r.ticketHash === ticket)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/storage/__tests__/identities.test.ts` — Expected: FAIL (modules missing).

- [ ] **Step 3: Implement `nonce.ts`**

```ts
// server/lib/social-identity/nonce.ts
import crypto from "node:crypto";

export function sha256Hex(s: string): string {
  return crypto.createHash("sha256").update(s, "utf8").digest("hex");
}

/** 32 random bytes, base64url — used for nonces and pending-sign-in tickets. */
export function randomToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}
```

- [ ] **Step 4: Implement `server/storage/identities.ts`**

```ts
import {
  authNonces,
  pendingSocialSignIns,
  userIdentities,
  users,
  type InsertUserIdentity,
  type PendingSocialSignIn,
  type User,
  type UserIdentity,
} from "@shared/schema";
import { db } from "../db";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { randomToken, sha256Hex } from "../lib/social-identity/nonce";
import { isReservedUsername, ReservedUsernameError } from "./users";

export type NoncePurpose = "sign_in" | "link" | "reauth";
export type ProviderName = "google" | "apple";

export interface SignInMethods {
  password: boolean;
  google: { email: string | null } | null;
  apple: { email: string | null; isPrivateRelay: boolean } | null;
}

export interface PendingSignInInput {
  kind: "sign_up" | "link";
  provider: ProviderName;
  providerSubject: string;
  email: string;
  isPrivateRelay: boolean;
  providerAuthoritative: boolean;
  displayName: string | null;
  appleRefreshTokenEnc: string | null;
  targetUserId: string | null;
}

const NONCE_TTL = sql`now() + interval '10 minutes'`;
const TICKET_TTL = sql`now() + interval '15 minutes'`;
const MAX_LINK_ATTEMPTS = 5;

export async function issueNonce(
  purpose: NoncePurpose,
  userId: string | null,
): Promise<{ nonce: string; nonceHash: string }> {
  await db.delete(authNonces).where(lt(authNonces.expiresAt, sql`now()`));
  const nonce = randomToken();
  const nonceHash = sha256Hex(nonce);
  await db
    .insert(authNonces)
    .values({ nonceHash, purpose, userId, expiresAt: NONCE_TTL });
  return { nonce, nonceHash };
}

/**
 * Atomic check-and-burn. A `reauth` nonce must be bound to exactly this user.
 * A `link`/`sign_in` nonce issued publicly (user_id NULL) is accepted from
 * anyone; one bound to a user is accepted only from that user.
 */
export async function consumeNonce(
  nonce: string,
  purpose: NoncePurpose,
  userId: string | null,
): Promise<boolean> {
  const owner =
    purpose === "reauth"
      ? userId === null
        ? sql`false`
        : eq(authNonces.userId, userId)
      : userId === null
        ? isNull(authNonces.userId)
        : or(isNull(authNonces.userId), eq(authNonces.userId, userId));
  const rows = await db
    .delete(authNonces)
    .where(
      and(
        eq(authNonces.nonceHash, sha256Hex(nonce)),
        eq(authNonces.purpose, purpose),
        gt(authNonces.expiresAt, sql`now()`),
        owner,
      ),
    )
    .returning();
  return rows.length === 1;
}

export async function createPendingSignIn(
  input: PendingSignInInput,
): Promise<string> {
  await db
    .delete(pendingSocialSignIns)
    .where(lt(pendingSocialSignIns.expiresAt, sql`now()`));
  const ticket = randomToken();
  await db.insert(pendingSocialSignIns).values({
    ...input,
    ticketHash: sha256Hex(ticket),
    expiresAt: TICKET_TTL,
  });
  return ticket;
}

export async function getPendingSignIn(
  ticket: string,
  kind: "sign_up" | "link",
): Promise<PendingSocialSignIn | undefined> {
  const [row] = await db
    .select()
    .from(pendingSocialSignIns)
    .where(
      and(
        eq(pendingSocialSignIns.ticketHash, sha256Hex(ticket)),
        eq(pendingSocialSignIns.kind, kind),
        gt(pendingSocialSignIns.expiresAt, sql`now()`),
      ),
    );
  return row;
}

export async function reservePendingLinkAttempt(
  ticket: string,
): Promise<PendingSocialSignIn | undefined> {
  const [row] = await db
    .update(pendingSocialSignIns)
    .set({ attempts: sql`${pendingSocialSignIns.attempts} + 1` })
    .where(
      and(
        eq(pendingSocialSignIns.ticketHash, sha256Hex(ticket)),
        eq(pendingSocialSignIns.kind, "link"),
        gt(pendingSocialSignIns.expiresAt, sql`now()`),
        lt(pendingSocialSignIns.attempts, MAX_LINK_ATTEMPTS),
      ),
    )
    .returning();
  return row;
}

export async function completeLinkFromTicket(
  ticket: string,
  opts: { markEmailVerified: boolean },
): Promise<UserIdentity | undefined> {
  return db.transaction(async (tx) => {
    const [t] = await tx
      .delete(pendingSocialSignIns)
      .where(
        and(
          eq(pendingSocialSignIns.ticketHash, sha256Hex(ticket)),
          eq(pendingSocialSignIns.kind, "link"),
          gt(pendingSocialSignIns.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!t || !t.targetUserId) return undefined;
    const [identity] = await tx
      .insert(userIdentities)
      .values({
        userId: t.targetUserId,
        provider: t.provider,
        providerSubject: t.providerSubject,
        email: t.email,
        isPrivateRelay: t.isPrivateRelay,
        appleRefreshTokenEnc: t.appleRefreshTokenEnc,
        lastUsedAt: sql`now()`,
      })
      .returning();
    if (opts.markEmailVerified) {
      await tx
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, t.targetUserId));
    }
    return identity;
  });
}

/**
 * Burn a sign_up ticket and create the account + identity in ONE transaction.
 * A unique violation (username/email race) or ReservedUsernameError throws and
 * rolls back, so the ticket survives and the person can pick another name.
 */
export async function createUserWithIdentity(
  ticket: string,
  username: string,
): Promise<User | undefined> {
  if (isReservedUsername(username)) throw new ReservedUsernameError(username);
  return db.transaction(async (tx) => {
    const [t] = await tx
      .delete(pendingSocialSignIns)
      .where(
        and(
          eq(pendingSocialSignIns.ticketHash, sha256Hex(ticket)),
          eq(pendingSocialSignIns.kind, "sign_up"),
          gt(pendingSocialSignIns.expiresAt, sql`now()`),
        ),
      )
      .returning();
    if (!t) return undefined;
    const [user] = await tx
      .insert(users)
      .values({
        username,
        email: t.email,
        password: null,
        emailVerified: true,
        displayName: t.displayName,
      })
      .returning();
    await tx.insert(userIdentities).values({
      userId: user.id,
      provider: t.provider,
      providerSubject: t.providerSubject,
      email: t.email,
      isPrivateRelay: t.isPrivateRelay,
      appleRefreshTokenEnc: t.appleRefreshTokenEnc,
      lastUsedAt: sql`now()`,
    });
    return user;
  });
}

export async function findIdentity(
  provider: ProviderName,
  sub: string,
): Promise<UserIdentity | undefined> {
  const [row] = await db
    .select()
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, provider),
        eq(userIdentities.providerSubject, sub),
      ),
    );
  return row;
}

export async function listIdentities(userId: string): Promise<UserIdentity[]> {
  return db
    .select()
    .from(userIdentities)
    .where(eq(userIdentities.userId, userId));
}

export async function insertIdentity(
  input: InsertUserIdentity,
): Promise<UserIdentity> {
  const [row] = await db
    .insert(userIdentities)
    .values({ ...input, lastUsedAt: sql`now()` })
    .returning();
  return row;
}

export async function deleteIdentity(
  userId: string,
  provider: ProviderName,
): Promise<UserIdentity | undefined> {
  const [row] = await db
    .delete(userIdentities)
    .where(
      and(
        eq(userIdentities.userId, userId),
        eq(userIdentities.provider, provider),
      ),
    )
    .returning();
  return row;
}

export async function setAppleRefreshToken(
  identityId: string,
  enc: string,
): Promise<void> {
  await db
    .update(userIdentities)
    .set({ appleRefreshTokenEnc: enc })
    .where(eq(userIdentities.id, identityId));
}

export async function touchIdentity(identityId: string): Promise<void> {
  await db
    .update(userIdentities)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(userIdentities.id, identityId));
}

export async function getSignInMethods(userId: string): Promise<SignInMethods> {
  const [u] = await db
    .select({ hasPassword: sql<boolean>`${users.password} is not null` })
    .from(users)
    .where(eq(users.id, userId));
  const identities = await listIdentities(userId);
  const google = identities.find((i) => i.provider === "google");
  const apple = identities.find((i) => i.provider === "apple");
  return {
    password: Boolean(u?.hasPassword),
    google: google ? { email: google.email } : null,
    apple: apple
      ? { email: apple.email, isPrivateRelay: apple.isPrivateRelay }
      : null,
  };
}
```

Register in `server/storage/index.ts`: `import * as identities from "./identities";` and add each function above to the `storage` object (`issueNonce: identities.issueNonce`, …). Export the types: `export type { NoncePurpose, ProviderName, SignInMethods, PendingSignInInput } from "./identities";`.

- [ ] **Step 5: Run** `npx vitest run server/storage/__tests__/identities.test.ts` — Expected: PASS.
- [ ] **Step 6: Commit** — `feat(auth): identity, nonce and pending-sign-in storage`
- [ ] **Step 7: Open PR 1** — push `feat/siwa-1-schema`, create the PR (body: what/why, "no user-visible change", link the spec and todo), dispatch `security-auditor` + `code-reviewer`, repair, merge only on owner go-ahead.

---

# Part 2 — PR 2: Server sign-in (`feat/siwa-2-server-sign-in`)

### Task 5: Provider configuration + env validation

**Files:**

- Create: `server/lib/social-identity/config.ts`
- Modify: `server/lib/env.ts` (add optional vars), `shared/constants/error-codes.ts` (all codes from Global Constraints)
- Test: `server/lib/social-identity/__tests__/config.test.ts`

**Interfaces:**

- Produces: `GoogleConfig { webClientId: string; appClientIds: string[] }`; `AppleConfig { teamId: string; keyId: string; privateKey: string; bundleId: string }`; `getSocialConfig(env?: NodeJS.ProcessEnv): { google: GoogleConfig | null; apple: AppleConfig | null }`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { getSocialConfig } from "../config";

const encKey = crypto.randomBytes(32).toString("base64");
const pem = "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----";

describe("getSocialConfig", () => {
  it("both providers off with no env", () => {
    expect(getSocialConfig({})).toEqual({ google: null, apple: null });
  });

  it("google needs the web client id AND at least one app client id", () => {
    expect(
      getSocialConfig({ GOOGLE_OAUTH_WEB_CLIENT_ID: "web" }).google,
    ).toBeNull();
    expect(
      getSocialConfig({
        GOOGLE_OAUTH_WEB_CLIENT_ID: "web",
        GOOGLE_OAUTH_APP_CLIENT_IDS: " ios , android ",
      }).google,
    ).toEqual({ webClientId: "web", appClientIds: ["ios", "android"] });
  });

  it("apple needs team, key id, key, bundle id AND the encryption key", () => {
    const env = {
      APPLE_TEAM_ID: "T",
      APPLE_SIGN_IN_KEY_ID: "K",
      APPLE_SIGN_IN_PRIVATE_KEY: pem,
      APPLE_BUNDLE_ID: "com.ocrecipes.app",
    };
    expect(getSocialConfig(env).apple).toBeNull();
    const apple = getSocialConfig({
      ...env,
      IDENTITY_TOKEN_ENC_KEY: encKey,
    }).apple;
    expect(apple?.bundleId).toBe("com.ocrecipes.app");
    expect(apple?.privateKey).toContain("\nabc\n"); // literal \n expanded
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/lib/social-identity/__tests__/config.test.ts` — FAIL.

- [ ] **Step 3: Implement**

```ts
// server/lib/social-identity/config.ts
export interface GoogleConfig {
  webClientId: string;
  appClientIds: string[];
}
export interface AppleConfig {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
}

/** A provider is "configured" only when every var it needs is present. */
export function getSocialConfig(env: NodeJS.ProcessEnv = process.env): {
  google: GoogleConfig | null;
  apple: AppleConfig | null;
} {
  const appClientIds = (env.GOOGLE_OAUTH_APP_CLIENT_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const google =
    env.GOOGLE_OAUTH_WEB_CLIENT_ID && appClientIds.length > 0
      ? { webClientId: env.GOOGLE_OAUTH_WEB_CLIENT_ID, appClientIds }
      : null;
  const apple =
    env.APPLE_TEAM_ID &&
    env.APPLE_SIGN_IN_KEY_ID &&
    env.APPLE_SIGN_IN_PRIVATE_KEY &&
    env.APPLE_BUNDLE_ID &&
    env.IDENTITY_TOKEN_ENC_KEY
      ? {
          teamId: env.APPLE_TEAM_ID,
          keyId: env.APPLE_SIGN_IN_KEY_ID,
          privateKey: env.APPLE_SIGN_IN_PRIVATE_KEY.replace(/\\n/g, "\n"),
          bundleId: env.APPLE_BUNDLE_ID,
        }
      : null;
  return { google, apple };
}
```

In `server/lib/env.ts` `envSchema`, add (optional; malformed fails boot):

```ts
  // Sign in with Google / Apple — a provider is enabled only when all its vars are set
  GOOGLE_OAUTH_WEB_CLIENT_ID: z.string().optional(),
  GOOGLE_OAUTH_APP_CLIENT_IDS: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_SIGN_IN_KEY_ID: z.string().optional(),
  APPLE_SIGN_IN_PRIVATE_KEY: z
    .string()
    .refine((v) => v.includes("BEGIN PRIVATE KEY"), {
      message: "APPLE_SIGN_IN_PRIVATE_KEY must be the .p8 PEM contents",
    })
    .optional(),
  IDENTITY_TOKEN_ENC_KEY: z
    .string()
    .refine((v) => Buffer.from(v, "base64").length === 32, {
      message: "IDENTITY_TOKEN_ENC_KEY must be 32 bytes, base64 (openssl rand -base64 32)",
    })
    .optional(),
```

(`APPLE_BUNDLE_ID` already exists for IAP — do not duplicate it.) Add the nine error codes to `ErrorCode` with a `// Sign in with Google/Apple` comment.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `feat(auth): social provider config and env validation`

### Task 6: Linking policy (pure)

**Files:**

- Create: `server/lib/social-identity/linking-policy.ts`, `server/lib/social-identity/types.ts`
- Test: `server/lib/social-identity/__tests__/linking-policy.test.ts`

**Interfaces:**

- Produces (`types.ts`): `ProviderClaims { provider: ProviderName; sub: string; email: string | null; emailVerified: boolean; hostedDomain: string | null; isPrivateRelay: boolean; nonce: string | null }`; `SignInMethod = "password" | "google" | "apple"`.
- Produces (`linking-policy.ts`): `normaliseEmail(e: string): string`; `isAuthoritative(c: ProviderClaims): boolean`; `PolicyAccount { id: string; email: string; emailVerified: boolean; hasSecondFactor: boolean; methods: SignInMethod[] }`; `LinkDecision`; `decideLink(input: { claims: ProviderClaims; linkedUserId: string | null; emailAccount: PolicyAccount | null }): LinkDecision`.

- [ ] **Step 1: Write the failing table test**

```ts
import { describe, it, expect } from "vitest";
import { decideLink, isAuthoritative } from "../linking-policy";
import type { ProviderClaims } from "../types";

const g = (o: Partial<ProviderClaims> = {}): ProviderClaims => ({
  provider: "google",
  sub: "g1",
  email: "me@gmail.com",
  emailVerified: true,
  hostedDomain: null,
  isPrivateRelay: false,
  nonce: null,
  ...o,
});
const a = (o: Partial<ProviderClaims> = {}): ProviderClaims => ({
  provider: "apple",
  sub: "a1",
  email: "me@icloud.com",
  emailVerified: true,
  hostedDomain: null,
  isPrivateRelay: false,
  nonce: null,
  ...o,
});
const acct = (o = {}) => ({
  id: "u1",
  email: "me@gmail.com",
  emailVerified: true,
  hasSecondFactor: false,
  methods: ["password" as const],
  ...o,
});

describe("isAuthoritative", () => {
  it.each([
    ["gmail", g(), true],
    ["GMAIL uppercase", g({ email: "Me@GMAIL.com" }), true],
    ["googlemail", g({ email: "me@googlemail.com" }), true],
    [
      "workspace hd + verified",
      g({ email: "me@acme.com", hostedDomain: "acme.com" }),
      true,
    ],
    [
      "workspace hd but unverified",
      g({
        email: "me@acme.com",
        hostedDomain: "acme.com",
        emailVerified: false,
      }),
      false,
    ],
    ["other domain, verified, no hd", g({ email: "me@yahoo.com" }), false],
    ["apple non-relay verified", a(), true],
    [
      "apple relay",
      a({ email: "x@privaterelay.appleid.com", isPrivateRelay: true }),
      false,
    ],
    ["apple unverified", a({ emailVerified: false }), false],
    ["no email", g({ email: null }), false],
  ])("%s", (_n, claims, expected) => {
    expect(isAuthoritative(claims)).toBe(expected);
  });
});

describe("decideLink", () => {
  it("already linked → sign_in, even if an MFA account owns the email", () => {
    expect(
      decideLink({
        claims: g(),
        linkedUserId: "u9",
        emailAccount: acct({ hasSecondFactor: true }),
      }),
    ).toEqual({ kind: "sign_in", userId: "u9" });
  });
  it("no account with the email → choose_username", () => {
    expect(
      decideLink({ claims: g(), linkedUserId: null, emailAccount: null }),
    ).toEqual({ kind: "choose_username" });
  });
  it("gmail + verified account + no MFA → auto_link", () => {
    expect(
      decideLink({ claims: g(), linkedUserId: null, emailAccount: acct() }),
    ).toEqual({ kind: "auto_link", userId: "u1" });
  });
  it("MFA account is never auto-linked", () => {
    expect(
      decideLink({
        claims: g(),
        linkedUserId: null,
        emailAccount: acct({ hasSecondFactor: true }),
      }),
    ).toEqual({ kind: "link_required", userId: "u1", methods: ["password"] });
  });
  it("non-authoritative google address → link_required", () => {
    expect(
      decideLink({
        claims: g({ email: "me@yahoo.com" }),
        linkedUserId: null,
        emailAccount: acct({ email: "me@yahoo.com" }),
      }).kind,
    ).toBe("link_required");
  });
  it("account email not verified → link_required", () => {
    expect(
      decideLink({
        claims: g(),
        linkedUserId: null,
        emailAccount: acct({ emailVerified: false }),
      }).kind,
    ).toBe("link_required");
  });
  it("apple relay never auto-links", () => {
    const relay = "x@privaterelay.appleid.com";
    expect(
      decideLink({
        claims: a({ email: relay, isPrivateRelay: true }),
        linkedUserId: null,
        emailAccount: acct({ email: relay }),
      }).kind,
    ).toBe("link_required");
  });
  it("reports an apple-only account's methods", () => {
    expect(
      decideLink({
        claims: g(),
        linkedUserId: null,
        emailAccount: acct({ methods: ["apple"], hasSecondFactor: true }),
      }),
    ).toEqual({ kind: "link_required", userId: "u1", methods: ["apple"] });
  });
});
```

(The `pendingEmail` rule is enforced by the caller: `emailAccount` comes from `getUserByEmailForAuth`, which matches `users.email` only. Task 11 pins it with a route test.)

- [ ] **Step 2: Run** `npx vitest run server/lib/social-identity/__tests__/linking-policy.test.ts` — FAIL.

- [ ] **Step 3: Implement**

```ts
// server/lib/social-identity/types.ts
import type { ProviderName } from "../../storage/identities";
export type { ProviderName };
export type SignInMethod = "password" | "google" | "apple";
export interface ProviderClaims {
  provider: ProviderName;
  sub: string;
  email: string | null;
  emailVerified: boolean;
  hostedDomain: string | null;
  isPrivateRelay: boolean;
  nonce: string | null;
}
```

```ts
// server/lib/social-identity/linking-policy.ts
import type { ProviderClaims, SignInMethod } from "./types";

export interface PolicyAccount {
  id: string;
  email: string;
  emailVerified: boolean;
  hasSecondFactor: boolean;
  methods: SignInMethod[];
}

export type LinkDecision =
  | { kind: "sign_in"; userId: string }
  | { kind: "choose_username" }
  | { kind: "auto_link"; userId: string }
  | { kind: "link_required"; userId: string; methods: SignInMethod[] };

export function normaliseEmail(e: string): string {
  return e.trim().toLowerCase();
}

// Google's "Verify the Google ID token" guide: Google is authoritative for
// gmail addresses, or Workspace (hd set) with email_verified. Elsewhere,
// email_verified only meant "verified at account creation".
const GOOGLE_CONSUMER_DOMAINS = ["@gmail.com", "@googlemail.com"];

export function isAuthoritative(c: ProviderClaims): boolean {
  if (!c.email) return false;
  const email = normaliseEmail(c.email);
  if (c.provider === "google") {
    if (GOOGLE_CONSUMER_DOMAINS.some((d) => email.endsWith(d))) return true;
    return c.emailVerified && Boolean(c.hostedDomain);
  }
  return c.emailVerified && !c.isPrivateRelay;
}

/** Spec §4.3 — precedence matters: already-linked wins, auto-link needs EVERY condition. */
export function decideLink(input: {
  claims: ProviderClaims;
  linkedUserId: string | null;
  emailAccount: PolicyAccount | null;
}): LinkDecision {
  const { claims, linkedUserId, emailAccount } = input;
  if (linkedUserId) return { kind: "sign_in", userId: linkedUserId };
  if (!emailAccount) return { kind: "choose_username" };
  const sameAddress =
    claims.email !== null &&
    normaliseEmail(claims.email) === normaliseEmail(emailAccount.email);
  if (
    !emailAccount.hasSecondFactor &&
    emailAccount.emailVerified &&
    sameAddress &&
    isAuthoritative(claims)
  ) {
    return { kind: "auto_link", userId: emailAccount.id };
  }
  return {
    kind: "link_required",
    userId: emailAccount.id,
    methods: emailAccount.methods,
  };
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `feat(auth): pure linking policy for provider sign-in`

### Task 7: ID token verification (Google + Apple)

**Files:**

- Modify: `package.json` (add `jose` dependency: `npm install jose` — NOT while `/todo` executors run in the main checkout)
- Create: `server/lib/social-identity/verify.ts`
- Test: `server/lib/social-identity/__tests__/verify.test.ts`

**Interfaces:**

- Consumes: `ProviderClaims`, `GoogleConfig`, `AppleConfig`, `sha256Hex`.
- Produces: `class TokenVerificationError extends Error`; `verifyGoogleIdToken(idToken: string, nonce: string, cfg: GoogleConfig, getKey?: JWTVerifyGetKey): Promise<ProviderClaims>`; `verifyAppleIdToken(idToken: string, nonce: string, cfg: AppleConfig, getKey?: JWTVerifyGetKey): Promise<ProviderClaims>`.

(Google is verified with `jose` against Google's JWKS rather than `google-auth-library`, so both providers share one code path and tests can inject a local JWKS. The checks are the ones spec §4.1 lists.)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeAll } from "vitest";
import {
  SignJWT,
  generateKeyPair,
  exportJWK,
  createLocalJWKSet,
  type JWTVerifyGetKey,
} from "jose";
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
  TokenVerificationError,
} from "../verify";
import { sha256Hex } from "../nonce";

const google = {
  webClientId: "web-id",
  appClientIds: ["ios-id", "android-id"],
};
const apple = {
  teamId: "T",
  keyId: "K",
  privateKey: "unused",
  bundleId: "com.ocrecipes.app",
};
const nonce = "raw-nonce";

let goodKey: JWTVerifyGetKey;
let privateKey: CryptoKey;
let otherPrivate: CryptoKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  privateKey = kp.privateKey;
  otherPrivate = (await generateKeyPair("RS256")).privateKey;
  const jwk = { ...(await exportJWK(kp.publicKey)), kid: "k1", alg: "RS256" };
  goodKey = createLocalJWKSet({ keys: [jwk] });
});

async function sign(
  claims: Record<string, unknown>,
  key = privateKey,
  expSeconds = 300,
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expSeconds)
    .sign(key);
}

const googleClaims = {
  iss: "https://accounts.google.com",
  aud: "web-id",
  azp: "ios-id",
  sub: "g-1",
  email: "Me@Gmail.com",
  email_verified: true,
  nonce: sha256Hex(nonce),
};
const appleClaims = {
  iss: "https://appleid.apple.com",
  aud: "com.ocrecipes.app",
  sub: "a-1",
  email: "x@privaterelay.appleid.com",
  email_verified: "true",
  is_private_email: "true",
  nonce: sha256Hex(nonce),
};

describe("verifyGoogleIdToken", () => {
  it("accepts a good token and normalises claims", async () => {
    const claims = await verifyGoogleIdToken(
      await sign(googleClaims),
      nonce,
      google,
      goodKey,
    );
    expect(claims).toMatchObject({
      provider: "google",
      sub: "g-1",
      email: "me@gmail.com",
      emailVerified: true,
      hostedDomain: null,
    });
  });
  it.each([
    ["bad signature", async () => sign(googleClaims, otherPrivate)],
    [
      "wrong iss",
      async () => sign({ ...googleClaims, iss: "https://evil.example" }),
    ],
    ["wrong aud", async () => sign({ ...googleClaims, aud: "ios-id" })],
    [
      "azp not ours",
      async () => sign({ ...googleClaims, azp: "someone-else" }),
    ],
    ["expired", async () => sign(googleClaims, privateKey, -120)],
    [
      "nonce mismatch",
      async () => sign({ ...googleClaims, nonce: sha256Hex("other") }),
    ],
    ["nonce missing", async () => sign({ ...googleClaims, nonce: undefined })],
  ])("rejects %s", async (_n, make) => {
    await expect(
      verifyGoogleIdToken(await make(), nonce, google, goodKey),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });
});

describe("verifyAppleIdToken", () => {
  it("accepts a good token and parses string booleans", async () => {
    const claims = await verifyAppleIdToken(
      await sign(appleClaims),
      nonce,
      apple,
      goodKey,
    );
    expect(claims).toMatchObject({
      provider: "apple",
      sub: "a-1",
      emailVerified: true,
      isPrivateRelay: true,
    });
  });
  it("tolerates a missing email (repeat sign-in)", async () => {
    const { email: _e, ...noEmail } = appleClaims;
    const claims = await verifyAppleIdToken(
      await sign(noEmail),
      nonce,
      apple,
      goodKey,
    );
    expect(claims.email).toBeNull();
  });
  it.each([
    ["wrong aud", { aud: "com.other.app" }],
    ["wrong iss", { iss: "https://accounts.google.com" }],
    ["nonce mismatch", { nonce: sha256Hex("x") }],
  ])("rejects %s", async (_n, patch) => {
    await expect(
      verifyAppleIdToken(
        await sign({ ...appleClaims, ...patch }),
        nonce,
        apple,
        goodKey,
      ),
    ).rejects.toBeInstanceOf(TokenVerificationError);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/lib/social-identity/__tests__/verify.test.ts` — FAIL.

- [ ] **Step 3: Implement**

```ts
// server/lib/social-identity/verify.ts
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose";
import type { AppleConfig, GoogleConfig } from "./config";
import { normaliseEmail } from "./linking-policy";
import { sha256Hex } from "./nonce";
import type { ProviderClaims } from "./types";

export class TokenVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenVerificationError";
  }
}

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
const APPLE_JWKS = createRemoteJWKSet(
  new URL("https://appleid.apple.com/auth/keys"),
);

function bool(v: unknown): boolean {
  return v === true || v === "true";
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

async function verifyJwt(
  idToken: string,
  getKey: JWTVerifyGetKey,
  issuer: string | string[],
  audience: string,
): Promise<JWTPayload> {
  try {
    const { payload } = await jwtVerify(idToken, getKey, {
      issuer,
      audience,
      algorithms: ["RS256"],
      clockTolerance: 60,
    });
    return payload;
  } catch (err) {
    throw new TokenVerificationError(
      err instanceof Error ? err.message : "invalid token",
    );
  }
}

function checkNonce(payload: JWTPayload, nonce: string): void {
  if (payload.nonce !== sha256Hex(nonce)) {
    throw new TokenVerificationError("nonce mismatch");
  }
}

function requireSub(payload: JWTPayload): string {
  if (!payload.sub) throw new TokenVerificationError("missing sub");
  return payload.sub;
}

export async function verifyGoogleIdToken(
  idToken: string,
  nonce: string,
  cfg: GoogleConfig,
  getKey: JWTVerifyGetKey = GOOGLE_JWKS,
): Promise<ProviderClaims> {
  const payload = await verifyJwt(
    idToken,
    getKey,
    ["accounts.google.com", "https://accounts.google.com"],
    cfg.webClientId,
  );
  if (
    typeof payload.azp !== "string" ||
    !cfg.appClientIds.includes(payload.azp)
  ) {
    throw new TokenVerificationError("azp not an OCRecipes app client");
  }
  checkNonce(payload, nonce);
  const email = str(payload.email);
  return {
    provider: "google",
    sub: requireSub(payload),
    email: email ? normaliseEmail(email) : null,
    emailVerified: bool(payload.email_verified),
    hostedDomain: str(payload.hd),
    isPrivateRelay: false,
    nonce: str(payload.nonce),
  };
}

export async function verifyAppleIdToken(
  idToken: string,
  nonce: string,
  cfg: AppleConfig,
  getKey: JWTVerifyGetKey = APPLE_JWKS,
): Promise<ProviderClaims> {
  const payload = await verifyJwt(
    idToken,
    getKey,
    "https://appleid.apple.com",
    cfg.bundleId,
  );
  checkNonce(payload, nonce);
  const email = str(payload.email);
  return {
    provider: "apple",
    sub: requireSub(payload),
    email: email ? normaliseEmail(email) : null,
    emailVerified: bool(payload.email_verified),
    hostedDomain: null,
    isPrivateRelay: bool(payload.is_private_email),
    nonce: str(payload.nonce),
  };
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `feat(auth): verify Google and Apple ID tokens`

### Task 8: Apple code exchange + revoke

**Files:**

- Create: `server/lib/social-identity/apple-tokens.ts`
- Test: `server/lib/social-identity/__tests__/apple-tokens.test.ts`

**Interfaces:**

- Produces: `buildAppleClientSecret(cfg: AppleConfig, nowMs?: number): Promise<string>`; `exchangeAppleCode(code: string, cfg: AppleConfig, fetchImpl?: typeof fetch): Promise<string>` (returns refresh token; throws on any failure); `revokeAppleToken(refreshToken: string, cfg: AppleConfig, fetchImpl?: typeof fetch): Promise<void>` (throws on failure; callers decide).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeAll } from "vitest";
import {
  generateKeyPair,
  exportPKCS8,
  decodeJwt,
  decodeProtectedHeader,
} from "jose";
import {
  buildAppleClientSecret,
  exchangeAppleCode,
  revokeAppleToken,
} from "../apple-tokens";

let cfg: {
  teamId: string;
  keyId: string;
  privateKey: string;
  bundleId: string;
};
beforeAll(async () => {
  const { privateKey } = await generateKeyPair("ES256", { extractable: true });
  cfg = {
    teamId: "TEAM",
    keyId: "KEY",
    privateKey: await exportPKCS8(privateKey),
    bundleId: "com.ocrecipes.app",
  };
});

describe("apple-tokens", () => {
  it("client secret has Apple's required claims", async () => {
    const jwt = await buildAppleClientSecret(cfg, 1_700_000_000_000);
    expect(decodeProtectedHeader(jwt)).toMatchObject({
      alg: "ES256",
      kid: "KEY",
    });
    expect(decodeJwt(jwt)).toMatchObject({
      iss: "TEAM",
      sub: "com.ocrecipes.app",
      aud: "https://appleid.apple.com",
      iat: 1_700_000_000,
      exp: 1_700_000_300,
    });
  });

  it("exchange posts the code and returns the refresh token", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ refresh_token: "r1" }), { status: 200 }),
      );
    await expect(exchangeAppleCode("code-1", cfg, fetchImpl)).resolves.toBe(
      "r1",
    );
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://appleid.apple.com/auth/token");
    const body = new URLSearchParams(init.body);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("code-1");
    expect(body.get("client_id")).toBe("com.ocrecipes.app");
  });

  it("exchange throws on a non-200 or a missing refresh token", async () => {
    await expect(
      exchangeAppleCode(
        "c",
        cfg,
        vi.fn().mockResolvedValue(new Response("{}", { status: 400 })),
      ),
    ).rejects.toThrow();
    await expect(
      exchangeAppleCode(
        "c",
        cfg,
        vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
      ),
    ).rejects.toThrow();
  });

  it("revoke posts the refresh token with the hint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("", { status: 200 }));
    await revokeAppleToken("r1", cfg, fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://appleid.apple.com/auth/revoke");
    const body = new URLSearchParams(init.body);
    expect(body.get("token")).toBe("r1");
    expect(body.get("token_type_hint")).toBe("refresh_token");
  });

  it("revoke throws on failure", async () => {
    await expect(
      revokeAppleToken(
        "r1",
        cfg,
        vi.fn().mockResolvedValue(new Response("", { status: 500 })),
      ),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/lib/social-identity/__tests__/apple-tokens.test.ts` — FAIL.

- [ ] **Step 3: Implement**

```ts
// server/lib/social-identity/apple-tokens.ts
import { SignJWT, importPKCS8 } from "jose";
import type { AppleConfig } from "./config";

const APPLE = "https://appleid.apple.com";
const TIMEOUT_MS = 5000;

export async function buildAppleClientSecret(
  cfg: AppleConfig,
  nowMs = Date.now(),
): Promise<string> {
  const key = await importPKCS8(cfg.privateKey, "ES256");
  const iat = Math.floor(nowMs / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: cfg.keyId })
    .setIssuer(cfg.teamId)
    .setSubject(cfg.bundleId)
    .setAudience(APPLE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 300)
    .sign(key);
}

async function post(
  path: string,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
) {
  return fetchImpl(`${APPLE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

export async function exchangeAppleCode(
  code: string,
  cfg: AppleConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const res = await post(
    "/auth/token",
    {
      grant_type: "authorization_code",
      code,
      client_id: cfg.bundleId,
      client_secret: await buildAppleClientSecret(cfg),
    },
    fetchImpl,
  );
  if (!res.ok) throw new Error(`Apple token exchange failed: ${res.status}`);
  const body = (await res.json()) as { refresh_token?: unknown };
  if (typeof body.refresh_token !== "string")
    throw new Error("Apple returned no refresh_token");
  return body.refresh_token;
}

export async function revokeAppleToken(
  refreshToken: string,
  cfg: AppleConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await post(
    "/auth/revoke",
    {
      client_id: cfg.bundleId,
      client_secret: await buildAppleClientSecret(cfg),
      token: refreshToken,
      token_type_hint: "refresh_token",
    },
    fetchImpl,
  );
  if (!res.ok) throw new Error(`Apple revoke failed: ${res.status}`);
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `feat(auth): Apple authorization-code exchange and token revoke`

### Task 9: Sign-in gates + username suggestion

**Files:**

- Create: `server/lib/social-identity/sign-in-gates.ts`, `server/lib/social-identity/suggest-username.ts`
- Test: `server/lib/social-identity/__tests__/sign-in-gates.test.ts`, `__tests__/suggest-username.test.ts`

**Interfaces:**

- Produces: `requiresSecondFactor(user: { id: string }): boolean` (always `false` today); `GateResult = { ok: true } | { ok: false; status: 403; code: string; message: string }`; `signInGate(user: { id: string; emailVerified: boolean }, opts: { emailWillBeVerified: boolean; verificationOn: boolean }): GateResult`; `suggestUsername(seed: string | null, isTaken: (u: string) => Promise<boolean>): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

```ts
// sign-in-gates.test.ts
import { describe, it, expect, vi } from "vitest";
import * as gates from "../sign-in-gates";

describe("signInGate", () => {
  const user = { id: "u1", emailVerified: true };
  it("passes a verified user with no second factor", () => {
    expect(
      gates.signInGate(user, {
        emailWillBeVerified: false,
        verificationOn: true,
      }),
    ).toEqual({ ok: true });
  });
  it("blocks an unverified user when verification is on", () => {
    expect(
      gates.signInGate(
        { ...user, emailVerified: false },
        { emailWillBeVerified: false, verificationOn: true },
      ),
    ).toMatchObject({ ok: false, status: 403, code: "EMAIL_NOT_VERIFIED" });
  });
  it("lets the link verify the email", () => {
    expect(
      gates.signInGate(
        { ...user, emailVerified: false },
        { emailWillBeVerified: true, verificationOn: true },
      ),
    ).toEqual({ ok: true });
  });
  it("blocks with SECOND_FACTOR_REQUIRED when the account needs one", () => {
    vi.spyOn(gates.secondFactor, "requiresSecondFactor").mockReturnValue(true);
    expect(
      gates.signInGate(user, {
        emailWillBeVerified: false,
        verificationOn: true,
      }),
    ).toMatchObject({ ok: false, status: 403, code: "SECOND_FACTOR_REQUIRED" });
    vi.restoreAllMocks();
  });
});
```

Note: the hook lives on an exported object (`secondFactor.requiresSecondFactor`) because `vi.spyOn` cannot intercept a same-module function call. Route tests in Task 11 spy the same object.

```ts
// suggest-username.test.ts
import { describe, it, expect } from "vitest";
import { suggestUsername } from "../suggest-username";

const none = async () => false;

describe("suggestUsername", () => {
  it("derives from a name", async () => {
    expect(await suggestUsername("Jane Doe", none)).toBe("janedoe");
  });
  it("strips illegal characters and pads short seeds", async () => {
    expect(await suggestUsername("Zé", none)).toMatch(/^z[a-z0-9_]{2,}$/);
  });
  it("adds digits when taken", async () => {
    const taken = async (u: string) => u === "janedoe";
    expect(await suggestUsername("Jane Doe", taken)).toMatch(/^janedoe\d{4}$/);
  });
  it("falls back to user + digits with no seed", async () => {
    expect(await suggestUsername(null, none)).toMatch(/^user\d{6}$/);
  });
  it("never exceeds 30 characters", async () => {
    expect(
      (await suggestUsername("a".repeat(80), async () => true)).length,
    ).toBeLessThanOrEqual(30);
  });
});
```

- [ ] **Step 2: Run** both — FAIL.

- [ ] **Step 3: Implement**

```ts
// sign-in-gates.ts
import { ErrorCode } from "@shared/constants/error-codes";

export type GateResult =
  | { ok: true }
  | { ok: false; status: 403; code: string; message: string };

/** MFA hook point. Always false until the MFA todo ships (it replaces this). */
function requiresSecondFactor(_user: { id: string }): boolean {
  return false;
}
export const secondFactor = { requiresSecondFactor };

/**
 * The single gate every social sign-in passes BEFORE anything is linked or a
 * session issued. Order: second factor first, then email verification
 * (mirrors /api/auth/login's EMAIL_NOT_VERIFIED).
 */
export function signInGate(
  user: { id: string; emailVerified: boolean },
  opts: { emailWillBeVerified: boolean; verificationOn: boolean },
): GateResult {
  if (secondFactor.requiresSecondFactor(user)) {
    return {
      ok: false,
      status: 403,
      code: ErrorCode.SECOND_FACTOR_REQUIRED,
      message: "Second factor required",
    };
  }
  if (opts.verificationOn && !user.emailVerified && !opts.emailWillBeVerified) {
    return {
      ok: false,
      status: 403,
      code: ErrorCode.EMAIL_NOT_VERIFIED,
      message: "Email not verified",
    };
  }
  return { ok: true };
}
```

```ts
// suggest-username.ts
import crypto from "node:crypto";

const MAX = 30;
const digits = (n: number) =>
  String(crypto.randomInt(0, 10 ** n)).padStart(n, "0");

/** Name-derived, collision-checked suggestion for ChooseUsername. Editable by the user. */
export async function suggestUsername(
  seed: string | null,
  isTaken: (u: string) => Promise<boolean>,
): Promise<string> {
  let base = (seed ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, MAX - 4);
  if (base.length > 0 && base.length < 3) base = base.padEnd(3, "_");
  if (base && !(await isTaken(base))) return base;
  if (base) {
    for (let i = 0; i < 5; i++) {
      const candidate = `${base}${digits(4)}`;
      if (!(await isTaken(candidate))) return candidate;
    }
  }
  return `user${digits(6)}`;
}
```

`isTaken` in routes = `async (u) => isReservedUsername(u) || Boolean(await storage.getUserByUsername(u))`. Fix the "Zé" test expectation if the implementation yields `z__` (it should: `zé` → `z` → padded `z__`, which matches `/^z[a-z0-9_]{2,}$/`).

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `feat(auth): sign-in gate (MFA hook) and username suggestion`

### Task 10: Rate limiter + request schemas

**Files:**

- Modify: `server/routes/_rate-limiters.ts`, `server/routes/_schemas.ts`
- Test: `server/routes/__tests__/social-schemas.test.ts`

**Interfaces:**

- Produces: `socialAuthLimiter` (IP-keyed, 15 min, max 20); schemas `socialNonceSchema`, `socialSignInSchema`, `completeSocialSignUpSchema`, `socialLinkSchema`, `connectIdentitySchema`, `providerParamSchema`; `deleteAccountSchema` becomes a union (Task 13 uses it).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  socialSignInSchema,
  completeSocialSignUpSchema,
  socialLinkSchema,
  socialNonceSchema,
} from "../_schemas";

describe("social schemas", () => {
  it("sign-in accepts google without code and apple with code + name", () => {
    expect(
      socialSignInSchema.safeParse({
        provider: "google",
        idToken: "t",
        nonce: "n",
      }).success,
    ).toBe(true);
    expect(
      socialSignInSchema.safeParse({
        provider: "apple",
        idToken: "t",
        nonce: "n",
        authorizationCode: "c",
        fullName: { givenName: "A", familyName: null },
      }).success,
    ).toBe(true);
    expect(
      socialSignInSchema.safeParse({
        provider: "facebook",
        idToken: "t",
        nonce: "n",
      }).success,
    ).toBe(false);
  });
  it("complete-sign-up requires ageConfirmed: true and a valid username", () => {
    expect(
      completeSocialSignUpSchema.safeParse({
        ticket: "t",
        username: "ok_name",
        ageConfirmed: true,
      }).success,
    ).toBe(true);
    expect(
      completeSocialSignUpSchema.safeParse({
        ticket: "t",
        username: "ok_name",
        ageConfirmed: false,
      }).success,
    ).toBe(false);
    expect(
      completeSocialSignUpSchema.safeParse({
        ticket: "t",
        username: "no spaces",
        ageConfirmed: true,
      }).success,
    ).toBe(false);
  });
  it("link accepts password OR provider proof, not neither", () => {
    expect(
      socialLinkSchema.safeParse({ ticket: "t", password: "p" }).success,
    ).toBe(true);
    expect(
      socialLinkSchema.safeParse({
        ticket: "t",
        provider: "apple",
        idToken: "i",
        nonce: "n",
      }).success,
    ).toBe(true);
    expect(socialLinkSchema.safeParse({ ticket: "t" }).success).toBe(false);
  });
  it("nonce purpose is an enum", () => {
    expect(socialNonceSchema.safeParse({ purpose: "reauth" }).success).toBe(
      true,
    );
    expect(socialNonceSchema.safeParse({ purpose: "admin" }).success).toBe(
      false,
    );
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** in `_schemas.ts` (reuse `registerSchema.shape.username` and `registerSchema.shape.ageConfirmed` so rules never drift):

```ts
const providerEnum = z.enum(["google", "apple"]);
const tokenField = z.string().min(1).max(8192);

export const socialNonceSchema = z.object({
  purpose: z.enum(["sign_in", "link", "reauth"]),
});

export const socialSignInSchema = z.object({
  provider: providerEnum,
  idToken: tokenField,
  nonce: z.string().min(1).max(200),
  authorizationCode: z.string().min(1).max(2048).optional(),
  fullName: z
    .object({
      givenName: z.string().max(100).nullable(),
      familyName: z.string().max(100).nullable(),
    })
    .optional(),
});

export const completeSocialSignUpSchema = z.object({
  ticket: z.string().min(1).max(200),
  username: registerSchema.shape.username,
  ageConfirmed: registerSchema.shape.ageConfirmed,
});

export const socialLinkSchema = z.union([
  z.object({
    ticket: z.string().min(1).max(200),
    password: z.string().min(1).max(200),
  }),
  z.object({
    ticket: z.string().min(1).max(200),
    provider: providerEnum,
    idToken: tokenField,
    nonce: z.string().min(1).max(200),
  }),
]);

export const connectIdentitySchema = socialSignInSchema.omit({
  fullName: true,
});

export const providerParamSchema = providerEnum;
```

In `_rate-limiters.ts`:

```ts
// Public Google/Apple endpoints — IP-keyed (no userId before sign-in).
export const socialAuthLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: "Too many sign-in attempts, please try again later",
  keyByUser: false,
});
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `feat(auth): social sign-in request schemas and limiter`

### Task 11: `auth-social.ts` routes — config, nonce, sign-in, complete-sign-up, link

**Files:**

- Create: `server/routes/auth-social.ts`
- Modify: `server/routes.ts` (register after `registerAuth(app)`), `server/routes/__tests__/auth-route-wiring.test.ts` (add the new public routes to its public-route list, per that file's pattern)
- Test: `server/routes/__tests__/auth-social.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 4–10; `serializeUser` (Task 2); `generateToken`; `emailVerificationEnabled`; `passwordMatches`.
- Produces: `register(app: Express): void`; helper `verifyProviderToken(provider, idToken, nonce): Promise<ProviderClaims>` and `issueSession(user)` (exported for Task 12/13 reuse); response shapes:
  - `{ status: "signed_in", user, token }`
  - `{ status: "choose_username", ticket, suggestedUsername }`
  - `{ status: "link_required", ticket, methods: SignInMethod[], email }`

- [ ] **Step 1: Write the failing route tests**

The test file mocks `../../storage` (all functions used below as `vi.fn()`), `express-rate-limit`, `../../lib/email-config`, and `../../lib/social-identity/verify` (so `verifyGoogleIdToken`/`verifyAppleIdToken` return chosen claims) and `../../lib/social-identity/apple-tokens`. It does **not** mock `../../middleware/auth`. Set env in `beforeEach` (`GOOGLE_OAUTH_WEB_CLIENT_ID`, `GOOGLE_OAUTH_APP_CLIENT_IDS`, the Apple vars, `IDENTITY_TOKEN_ENC_KEY` = 32 random bytes base64) and restore in `afterEach`.

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import bcrypt from "bcrypt";
import { storage } from "../../storage";
import { register } from "../auth-social";
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
  TokenVerificationError,
} from "../../lib/social-identity/verify";
import { exchangeAppleCode } from "../../lib/social-identity/apple-tokens";
import { secondFactor } from "../../lib/social-identity/sign-in-gates";
import { emailVerificationEnabled } from "../../lib/email-config";
import { createMockUser } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  ReservedUsernameError: class ReservedUsernameErrorMock extends Error {},
  isReservedUsername: (u: string) => u.toLowerCase() === "demo",
  storage: {
    issueNonce: vi.fn(),
    consumeNonce: vi.fn(),
    findIdentity: vi.fn(),
    listIdentities: vi.fn(),
    insertIdentity: vi.fn(),
    setAppleRefreshToken: vi.fn(),
    touchIdentity: vi.fn(),
    createPendingSignIn: vi.fn(),
    getPendingSignIn: vi.fn(),
    reservePendingLinkAttempt: vi.fn(),
    completeLinkFromTicket: vi.fn(),
    createUserWithIdentity: vi.fn(),
    getUserByEmailForAuth: vi.fn(),
    getUserForAuth: vi.fn(),
    getUserByUsername: vi.fn(),
    getUser: vi.fn(),
  },
}));
vi.mock("express-rate-limit");
vi.mock("../../lib/email-config", () => ({
  emailVerificationEnabled: vi.fn(),
}));
vi.mock("../../lib/social-identity/verify", async (orig) => ({
  ...(await orig<typeof import("../../lib/social-identity/verify")>()),
  verifyGoogleIdToken: vi.fn(),
  verifyAppleIdToken: vi.fn(),
}));
vi.mock("../../lib/social-identity/apple-tokens", () => ({
  exchangeAppleCode: vi.fn(),
  revokeAppleToken: vi.fn(),
}));

const ENV_KEYS = [
  "GOOGLE_OAUTH_WEB_CLIENT_ID",
  "GOOGLE_OAUTH_APP_CLIENT_IDS",
  "APPLE_TEAM_ID",
  "APPLE_SIGN_IN_KEY_ID",
  "APPLE_SIGN_IN_PRIVATE_KEY",
  "APPLE_BUNDLE_ID",
  "IDENTITY_TOKEN_ENC_KEY",
];
let savedEnv: Record<string, string | undefined>;

function app() {
  const a = express();
  a.use(express.json());
  register(a);
  return a;
}

const gmailClaims = {
  provider: "google" as const,
  sub: "g-1",
  email: "me@gmail.com",
  emailVerified: true,
  hostedDomain: null,
  isPrivateRelay: false,
  nonce: null,
};

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    GOOGLE_OAUTH_WEB_CLIENT_ID: "web",
    GOOGLE_OAUTH_APP_CLIENT_IDS: "ios",
    APPLE_TEAM_ID: "T",
    APPLE_SIGN_IN_KEY_ID: "K",
    APPLE_SIGN_IN_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----x",
    APPLE_BUNDLE_ID: "com.ocrecipes.app",
    IDENTITY_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  });
  vi.mocked(emailVerificationEnabled).mockReturnValue(true);
  vi.mocked(storage.consumeNonce).mockResolvedValue(true);
  vi.mocked(storage.listIdentities).mockResolvedValue([]);
  vi.mocked(storage.findIdentity).mockResolvedValue(undefined);
  vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(undefined);
  vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
  vi.mocked(storage.createPendingSignIn).mockResolvedValue("ticket-1");
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("GET /api/auth/social/config", () => {
  it("reports configured providers", async () => {
    const res = await request(app()).get("/api/auth/social/config");
    expect(res.body).toEqual({ google: true, apple: true });
  });
  it("reports apple false without the encryption key", async () => {
    delete process.env.IDENTITY_TOKEN_ENC_KEY;
    const res = await request(app()).get("/api/auth/social/config");
    expect(res.body).toEqual({ google: true, apple: false });
  });
});

describe("POST /api/auth/social", () => {
  const body = { provider: "google", idToken: "t", nonce: "n" };

  it("401 when the token does not verify", async () => {
    vi.mocked(verifyGoogleIdToken).mockRejectedValue(
      new TokenVerificationError("bad"),
    );
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("INVALID_PROVIDER_TOKEN");
  });

  it("401 when the nonce was already used", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.consumeNonce).mockResolvedValue(false);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(401);
    expect(storage.consumeNonce).toHaveBeenCalledWith("n", "sign_in", null);
  });

  it("404 PROVIDER_NOT_CONFIGURED when the provider is off", async () => {
    delete process.env.GOOGLE_OAUTH_WEB_CLIENT_ID;
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("PROVIDER_NOT_CONFIGURED");
  });

  it("signs in an already-linked identity with a working session token", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue({
      id: "i1",
      userId: "u1",
      provider: "google",
    } as never);
    const user = createMockUser({
      id: "u1",
      emailVerified: true,
      tokenVersion: 0,
    });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("signed_in");
    // REAL requireAuth accepts the token (proves it is our normal session JWT)
    const authed = express();
    authed.use(express.json());
    const { requireAuth } = await import("../../middleware/auth");
    authed.get("/probe", requireAuth, (_req, r) => {
      r.json({ ok: true });
    });
    const probe = await request(authed)
      .get("/probe")
      .set("Authorization", `Bearer ${res.body.token}`);
    expect(probe.status).toBe(200);
  });

  it("choose_username when no account has the email", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body).toMatchObject({
      status: "choose_username",
      ticket: "ticket-1",
      suggestedUsername: expect.any(String),
    });
    expect(storage.createPendingSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "sign_up", email: "me@gmail.com" }),
    );
  });

  it("400 PROVIDER_EMAIL_REQUIRED when unlinked and no email", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({
      ...gmailClaims,
      email: null,
    });
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PROVIDER_EMAIL_REQUIRED");
  });

  it("auto-links a gmail address onto a verified account", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    const user = createMockUser({
      id: "u1",
      email: "me@gmail.com",
      emailVerified: true,
    });
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body.status).toBe("signed_in");
    expect(storage.insertIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        provider: "google",
        providerSubject: "g-1",
      }),
    );
  });

  it("link_required for a non-gmail Google address, without inserting", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue({
      ...gmailClaims,
      email: "me@yahoo.com",
    });
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(
      createMockUser({ id: "u1", email: "me@yahoo.com", emailVerified: true }),
    );
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body).toMatchObject({
      status: "link_required",
      methods: ["password"],
    });
    expect(storage.insertIdentity).not.toHaveBeenCalled();
  });

  it("an address present only as someone's pendingEmail is treated as unregistered", async () => {
    // getUserByEmailForAuth matches users.email only, so a pendingEmail holder is invisible here.
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.getUserByEmailForAuth).mockResolvedValue(undefined);
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.body.status).toBe("choose_username");
  });

  it("first Apple sign-in fails when the code exchange fails, creating nothing", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      email: "me@icloud.com",
    });
    vi.mocked(exchangeAppleCode).mockRejectedValue(new Error("apple down"));
    const res = await request(app())
      .post("/api/auth/social")
      .send({
        provider: "apple",
        idToken: "t",
        nonce: "n",
        authorizationCode: "c",
      });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("PROVIDER_EXCHANGE_FAILED");
    expect(storage.createPendingSignIn).not.toHaveBeenCalled();
  });

  it("repeat Apple sign-in with a stored token skips the exchange and tolerates no email", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      email: null,
    });
    vi.mocked(storage.findIdentity).mockResolvedValue({
      id: "i1",
      userId: "u1",
      provider: "apple",
      appleRefreshTokenEnc: "v1:x",
    } as never);
    const user = createMockUser({ id: "u1", emailVerified: true });
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    const res = await request(app())
      .post("/api/auth/social")
      .send({
        provider: "apple",
        idToken: "t",
        nonce: "n",
        authorizationCode: "c",
      });
    expect(res.body.status).toBe("signed_in");
    expect(exchangeAppleCode).not.toHaveBeenCalled();
  });

  it("first Apple sign-in stores the name and encrypted refresh token on the ticket", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      email: "me@icloud.com",
    });
    vi.mocked(exchangeAppleCode).mockResolvedValue("refresh-1");
    await request(app())
      .post("/api/auth/social")
      .send({
        provider: "apple",
        idToken: "t",
        nonce: "n",
        authorizationCode: "c",
        fullName: { givenName: "Ann", familyName: "Lee" },
      });
    const input = vi.mocked(storage.createPendingSignIn).mock.calls[0][0];
    expect(input.displayName).toBe("Ann Lee");
    expect(input.appleRefreshTokenEnc).toMatch(/^v1:/);
    expect(input.appleRefreshTokenEnc).not.toContain("refresh-1");
  });

  it("SECOND_FACTOR_REQUIRED: 403, no token, nothing inserted", async () => {
    vi.spyOn(secondFactor, "requiresSecondFactor").mockReturnValue(true);
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue({
      id: "i1",
      userId: "u1",
      provider: "google",
    } as never);
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({ id: "u1", emailVerified: true }),
    );
    const res = await request(app()).post("/api/auth/social").send(body);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("SECOND_FACTOR_REQUIRED");
    expect(res.body.token).toBeUndefined();
  });
});

describe("POST /api/auth/social/complete-sign-up", () => {
  it("creates the account and signs in", async () => {
    const user = createMockUser({
      id: "u2",
      username: "new_name",
      emailVerified: true,
    });
    vi.mocked(storage.createUserWithIdentity).mockResolvedValue(user);
    const res = await request(app())
      .post("/api/auth/social/complete-sign-up")
      .send({ ticket: "t", username: "new_name", ageConfirmed: true });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("signed_in");
  });
  it("400 without the age confirmation", async () => {
    const res = await request(app())
      .post("/api/auth/social/complete-sign-up")
      .send({ ticket: "t", username: "new_name", ageConfirmed: false });
    expect(res.status).toBe(400);
  });
  it("409 on a username race (unique violation), never 500", async () => {
    const err = Object.assign(new Error("dup"), {
      code: "23505",
      constraint: "users_username_unique",
    });
    vi.mocked(storage.createUserWithIdentity).mockRejectedValue(err);
    const res = await request(app())
      .post("/api/auth/social/complete-sign-up")
      .send({ ticket: "t", username: "new_name", ageConfirmed: true });
    expect(res.status).toBe(409);
  });
  it("400 INVALID_SIGN_IN_TICKET for a spent ticket", async () => {
    vi.mocked(storage.createUserWithIdentity).mockResolvedValue(undefined);
    const res = await request(app())
      .post("/api/auth/social/complete-sign-up")
      .send({ ticket: "t", username: "new_name", ageConfirmed: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SIGN_IN_TICKET");
  });
});

describe("POST /api/auth/social/link", () => {
  const ticketRow = {
    kind: "link",
    provider: "google",
    providerSubject: "g-1",
    email: "me@yahoo.com",
    providerAuthoritative: false,
    targetUserId: "u1",
    attempts: 1,
  };

  it("wrong password → 401 and the ticket survives (no completeLink call)", async () => {
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(
      ticketRow as never,
    );
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({
        id: "u1",
        password: await bcrypt.hash("right-pass1", 4),
      }),
    );
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", password: "wrong-pass1" });
    expect(res.status).toBe(401);
    expect(storage.completeLinkFromTicket).not.toHaveBeenCalled();
  });

  it("right password → links and signs in", async () => {
    const user = createMockUser({
      id: "u1",
      emailVerified: true,
      password: await bcrypt.hash("right-pass1", 4),
    });
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(
      ticketRow as never,
    );
    vi.mocked(storage.getUserForAuth).mockResolvedValue(user);
    vi.mocked(storage.getUser).mockResolvedValue(user);
    vi.mocked(storage.completeLinkFromTicket).mockResolvedValue({
      id: "i9",
    } as never);
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", password: "right-pass1" });
    expect(res.body.status).toBe("signed_in");
    expect(storage.completeLinkFromTicket).toHaveBeenCalledWith("t", {
      markEmailVerified: false,
    });
  });

  it("MFA account: right password → 403 and NO identity row", async () => {
    vi.spyOn(secondFactor, "requiresSecondFactor").mockReturnValue(true);
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(
      ticketRow as never,
    );
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({
        id: "u1",
        emailVerified: true,
        password: await bcrypt.hash("right-pass1", 4),
      }),
    );
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", password: "right-pass1" });
    expect(res.status).toBe(403);
    expect(storage.completeLinkFromTicket).not.toHaveBeenCalled();
  });

  it("provider proof must be an identity already linked to the target", async () => {
    vi.mocked(storage.getPendingSignIn).mockResolvedValue(ticketRow as never);
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
      sub: "a-9",
    });
    vi.mocked(storage.findIdentity).mockResolvedValue({
      id: "x",
      userId: "someone-else",
      provider: "apple",
    } as never);
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", provider: "apple", idToken: "i", nonce: "n" });
    expect(res.status).toBe(401);
    expect(storage.consumeNonce).toHaveBeenCalledWith("n", "link", null);
    expect(storage.completeLinkFromTicket).not.toHaveBeenCalled();
  });

  it("400 when attempts are exhausted or the ticket is gone", async () => {
    vi.mocked(storage.reservePendingLinkAttempt).mockResolvedValue(undefined);
    const res = await request(app())
      .post("/api/auth/social/link")
      .send({ ticket: "t", password: "x" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_SIGN_IN_TICKET");
  });
});

describe("POST /api/auth/social/nonce", () => {
  it("issues a public sign_in nonce", async () => {
    vi.mocked(storage.issueNonce).mockResolvedValue({
      nonce: "n",
      nonceHash: "h",
    });
    const res = await request(app())
      .post("/api/auth/social/nonce")
      .send({ purpose: "sign_in" });
    expect(res.body).toEqual({ nonce: "n", nonceHash: "h" });
    expect(storage.issueNonce).toHaveBeenCalledWith("sign_in", null);
  });
  it("refuses an unauthenticated reauth nonce", async () => {
    const res = await request(app())
      .post("/api/auth/social/nonce")
      .send({ purpose: "reauth" });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run server/routes/__tests__/auth-social.test.ts` — FAIL (module missing).

- [ ] **Step 3: Implement `server/routes/auth-social.ts`**

```ts
import type { Express, Request, Response } from "express";
import { storage, ReservedUsernameError, isReservedUsername } from "../storage";
import type { ProviderName } from "../storage";
import {
  generateToken,
  requireAuth,
  type AuthenticatedRequest,
} from "../middleware/auth";
import { sendError } from "../lib/api-errors";
import { ErrorCode } from "@shared/constants/error-codes";
import { handleRouteError, formatZodError } from "./_helpers";
import { socialAuthLimiter } from "./_rate-limiters";
import {
  socialNonceSchema,
  socialSignInSchema,
  completeSocialSignUpSchema,
  socialLinkSchema,
} from "./_schemas";
import { serializeUser } from "./auth";
import { emailVerificationEnabled } from "../lib/email-config";
import { isUniqueViolation, uniqueViolationConstraint } from "../lib/db-errors";
import { passwordMatches } from "../lib/password-check";
import { getSocialConfig } from "../lib/social-identity/config";
import {
  verifyGoogleIdToken,
  verifyAppleIdToken,
  TokenVerificationError,
} from "../lib/social-identity/verify";
import {
  decideLink,
  isAuthoritative,
  type PolicyAccount,
} from "../lib/social-identity/linking-policy";
import { exchangeAppleCode } from "../lib/social-identity/apple-tokens";
import { encryptToken } from "../lib/social-identity/token-crypto";
import { signInGate, secondFactor } from "../lib/social-identity/sign-in-gates";
import { suggestUsername } from "../lib/social-identity/suggest-username";
import type {
  ProviderClaims,
  SignInMethod,
} from "../lib/social-identity/types";
import { createServiceLogger, toError } from "../lib/logger";
import type { User } from "@shared/schema";

const logger = createServiceLogger("auth-social");

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function fail(res: Response, f: HttpFailure) {
  sendError(res, f.status, f.message, f.code);
}

/** Verify a provider token for a configured provider. Throws HttpFailure. */
export async function verifyProviderToken(
  provider: ProviderName,
  idToken: string,
  nonce: string,
): Promise<ProviderClaims> {
  const cfg = getSocialConfig();
  try {
    if (provider === "google") {
      if (!cfg.google)
        throw new HttpFailure(
          404,
          ErrorCode.PROVIDER_NOT_CONFIGURED,
          "Sign-in provider not available",
        );
      return await verifyGoogleIdToken(idToken, nonce, cfg.google);
    }
    if (!cfg.apple)
      throw new HttpFailure(
        404,
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        "Sign-in provider not available",
      );
    return await verifyAppleIdToken(idToken, nonce, cfg.apple);
  } catch (err) {
    if (err instanceof TokenVerificationError) {
      throw new HttpFailure(
        401,
        ErrorCode.INVALID_PROVIDER_TOKEN,
        "Sign-in could not be verified",
      );
    }
    throw err;
  }
}

/** Exchange Apple's one-time code and return the ENCRYPTED refresh token. Throws HttpFailure. */
export async function appleRefreshTokenFor(
  code: string | undefined,
): Promise<string> {
  const cfg = getSocialConfig().apple;
  if (!cfg || !code) {
    throw new HttpFailure(
      502,
      ErrorCode.PROVIDER_EXCHANGE_FAILED,
      "Apple sign-in could not be completed. Please try again.",
    );
  }
  try {
    return encryptToken(await exchangeAppleCode(code, cfg));
  } catch (err) {
    logger.warn({ err: toError(err) }, "apple code exchange failed");
    throw new HttpFailure(
      502,
      ErrorCode.PROVIDER_EXCHANGE_FAILED,
      "Apple sign-in could not be completed. Please try again.",
    );
  }
}

export async function issueSession(userId: string) {
  const user = await storage.getUser(userId);
  if (!user)
    throw new HttpFailure(401, ErrorCode.UNAUTHORIZED, "User not found");
  return {
    status: "signed_in" as const,
    user: serializeUser(user),
    token: generateToken(user.id, user.tokenVersion, user.emailVerified),
  };
}

async function methodsFor(
  user: Pick<User, "id" | "password">,
): Promise<SignInMethod[]> {
  const identities = await storage.listIdentities(user.id);
  return [
    ...(user.password !== null ? (["password"] as const) : []),
    ...identities.map((i) => i.provider as SignInMethod),
  ];
}

function displayNameFrom(fullName?: {
  givenName: string | null;
  familyName: string | null;
}): string | null {
  const name = [fullName?.givenName, fullName?.familyName]
    .filter(Boolean)
    .join(" ")
    .trim();
  return name || null;
}

const isTaken = async (u: string) =>
  isReservedUsername(u) || Boolean(await storage.getUserByUsername(u));

export function register(app: Express): void {
  app.get("/api/auth/social/config", (_req: Request, res: Response) => {
    const cfg = getSocialConfig();
    res.json({ google: cfg.google !== null, apple: cfg.apple !== null });
  });

  // sign_in/link are public; reauth requires a session. A link nonce issued
  // to a signed-in caller is bound to them (POST /api/auth/identities).
  app.post(
    "/api/auth/social/nonce",
    socialAuthLimiter,
    async (req: Request, res: Response, next) => {
      const parsed = socialNonceSchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          formatZodError(parsed.error),
          ErrorCode.VALIDATION_ERROR,
        );
      const auth = req.headers.authorization;
      if (
        parsed.data.purpose === "reauth" ||
        (parsed.data.purpose === "link" && auth)
      ) {
        return requireAuth(req as AuthenticatedRequest, res, next);
      }
      next();
    },
    async (req: Request, res: Response) => {
      try {
        const { purpose } = socialNonceSchema.parse(req.body);
        const userId =
          purpose === "sign_in"
            ? null
            : ((req as AuthenticatedRequest).userId ?? null);
        res.json(await storage.issueNonce(purpose, userId));
      } catch (error) {
        handleRouteError(res, error, "issue sign-in nonce");
      }
    },
  );

  app.post(
    "/api/auth/social",
    socialAuthLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = socialSignInSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const body = parsed.data;

        const claims = await verifyProviderToken(
          body.provider,
          body.idToken,
          body.nonce,
        );
        if (!(await storage.consumeNonce(body.nonce, "sign_in", null))) {
          throw new HttpFailure(
            401,
            ErrorCode.INVALID_PROVIDER_TOKEN,
            "Sign-in could not be verified",
          );
        }

        const linked = await storage.findIdentity(claims.provider, claims.sub);
        if (!linked && !claims.email) {
          throw new HttpFailure(
            400,
            ErrorCode.PROVIDER_EMAIL_REQUIRED,
            "Your account didn't share an email address. Please try again and allow email.",
          );
        }

        let emailAccount: PolicyAccount | null = null;
        let emailUser: User | undefined;
        if (!linked && claims.email) {
          emailUser = await storage.getUserByEmailForAuth(claims.email);
          if (emailUser) {
            emailAccount = {
              id: emailUser.id,
              email: emailUser.email,
              emailVerified: emailUser.emailVerified,
              hasSecondFactor: secondFactor.requiresSecondFactor(emailUser),
              methods: await methodsFor(emailUser),
            };
          }
        }

        const decision = decideLink({
          claims,
          linkedUserId: linked?.userId ?? null,
          emailAccount,
        });

        // Apple: a NEW identity must carry a refresh token (fail closed); an
        // existing one without a stored token gets a best-effort exchange.
        let appleTokenEnc: string | null = null;
        if (claims.provider === "apple") {
          if (!linked) {
            appleTokenEnc = await appleRefreshTokenFor(body.authorizationCode);
          } else if (!linked.appleRefreshTokenEnc && body.authorizationCode) {
            try {
              appleTokenEnc = await appleRefreshTokenFor(
                body.authorizationCode,
              );
            } catch {
              appleTokenEnc = null; // logged inside; never blocks a returning user
            }
          }
        }

        const verificationOn = emailVerificationEnabled();

        if (decision.kind === "sign_in") {
          const user = await storage.getUserForAuth(decision.userId);
          if (!user)
            throw new HttpFailure(
              401,
              ErrorCode.UNAUTHORIZED,
              "User not found",
            );
          const gate = signInGate(user, {
            emailWillBeVerified: false,
            verificationOn,
          });
          if (!gate.ok)
            throw new HttpFailure(gate.status, gate.code, gate.message);
          if (appleTokenEnc && linked)
            await storage.setAppleRefreshToken(linked.id, appleTokenEnc);
          if (linked) await storage.touchIdentity(linked.id);
          return res.json(await issueSession(user.id));
        }

        if (decision.kind === "auto_link") {
          const user = emailUser!;
          const gate = signInGate(user, {
            emailWillBeVerified: true,
            verificationOn,
          });
          if (!gate.ok)
            throw new HttpFailure(gate.status, gate.code, gate.message);
          try {
            await storage.insertIdentity({
              userId: user.id,
              provider: claims.provider,
              providerSubject: claims.sub,
              email: claims.email,
              isPrivateRelay: claims.isPrivateRelay,
              appleRefreshTokenEnc: appleTokenEnc,
            });
          } catch (err) {
            if (isUniqueViolation(err))
              throw new HttpFailure(
                409,
                ErrorCode.IDENTITY_IN_USE,
                "This account is already connected.",
              );
            throw err;
          }
          return res.json(await issueSession(user.id));
        }

        const ticket = await storage.createPendingSignIn({
          kind: decision.kind === "choose_username" ? "sign_up" : "link",
          provider: claims.provider,
          providerSubject: claims.sub,
          email: claims.email!,
          isPrivateRelay: claims.isPrivateRelay,
          providerAuthoritative: isAuthoritative(claims),
          displayName: displayNameFrom(body.fullName),
          appleRefreshTokenEnc: appleTokenEnc,
          targetUserId:
            decision.kind === "link_required" ? decision.userId : null,
        });

        if (decision.kind === "choose_username") {
          const seed =
            displayNameFrom(body.fullName) ?? claims.email!.split("@")[0];
          return res.json({
            status: "choose_username",
            ticket,
            suggestedUsername: await suggestUsername(seed, isTaken),
          });
        }
        return res.json({
          status: "link_required",
          ticket,
          methods: decision.methods,
          email: claims.email,
        });
      } catch (error) {
        if (error instanceof HttpFailure) return fail(res, error);
        handleRouteError(res, error, "sign in with provider");
      }
    },
  );

  app.post(
    "/api/auth/social/complete-sign-up",
    socialAuthLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = completeSocialSignUpSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const { ticket, username } = parsed.data;
        let user: User | undefined;
        try {
          user = await storage.createUserWithIdentity(ticket, username);
        } catch (err) {
          if (err instanceof ReservedUsernameError) {
            return sendError(
              res,
              409,
              "That username is reserved. Please choose another.",
              ErrorCode.CONFLICT,
            );
          }
          if (isUniqueViolation(err)) {
            const constraint = uniqueViolationConstraint(err) ?? "";
            return sendError(
              res,
              409,
              constraint.includes("email")
                ? "An account with this email already exists."
                : "Username already exists",
              ErrorCode.CONFLICT,
            );
          }
          throw err;
        }
        if (!user)
          return sendError(
            res,
            400,
            "This sign-in has expired. Please start again.",
            ErrorCode.INVALID_SIGN_IN_TICKET,
          );
        res.status(201).json(await issueSession(user.id));
      } catch (error) {
        if (error instanceof HttpFailure) return fail(res, error);
        handleRouteError(res, error, "complete social sign-up");
      }
    },
  );

  app.post(
    "/api/auth/social/link",
    socialAuthLimiter,
    async (req: Request, res: Response) => {
      try {
        const parsed = socialLinkSchema.safeParse(req.body);
        if (!parsed.success)
          return sendError(
            res,
            400,
            formatZodError(parsed.error),
            ErrorCode.VALIDATION_ERROR,
          );
        const body = parsed.data;
        const expired = new HttpFailure(
          400,
          ErrorCode.INVALID_SIGN_IN_TICKET,
          "This sign-in has expired. Please start again.",
        );

        let pending;
        if ("password" in body) {
          // Attempts are counted (max 5) so a wrong password keeps the ticket alive.
          pending = await storage.reservePendingLinkAttempt(body.ticket);
          if (!pending?.targetUserId) throw expired;
          const target = await storage.getUserForAuth(pending.targetUserId);
          if (
            !target ||
            !(await passwordMatches(body.password, target.password))
          ) {
            return sendError(
              res,
              401,
              "Invalid credentials",
              ErrorCode.UNAUTHORIZED,
            );
          }
        } else {
          pending = await storage.getPendingSignIn(body.ticket, "link");
          if (!pending?.targetUserId) throw expired;
          const proof = await verifyProviderToken(
            body.provider,
            body.idToken,
            body.nonce,
          );
          if (!(await storage.consumeNonce(body.nonce, "link", null))) {
            throw new HttpFailure(
              401,
              ErrorCode.INVALID_PROVIDER_TOKEN,
              "Sign-in could not be verified",
            );
          }
          const owned = await storage.findIdentity(proof.provider, proof.sub);
          if (!owned || owned.userId !== pending.targetUserId) {
            return sendError(
              res,
              401,
              "Invalid credentials",
              ErrorCode.UNAUTHORIZED,
            );
          }
        }

        const target = await storage.getUserForAuth(pending.targetUserId);
        if (!target) throw expired;
        const markEmailVerified =
          pending.providerAuthoritative &&
          pending.email === target.email.toLowerCase();
        const gate = signInGate(target, {
          emailWillBeVerified: markEmailVerified,
          verificationOn: emailVerificationEnabled(),
        });
        // Gate BEFORE inserting: a password alone never attaches a provider to an MFA account.
        if (!gate.ok)
          throw new HttpFailure(gate.status, gate.code, gate.message);

        let identity;
        try {
          identity = await storage.completeLinkFromTicket(body.ticket, {
            markEmailVerified,
          });
        } catch (err) {
          if (isUniqueViolation(err))
            throw new HttpFailure(
              409,
              ErrorCode.IDENTITY_IN_USE,
              "This account is already connected.",
            );
          throw err;
        }
        if (!identity) throw expired;
        res.json(await issueSession(target.id));
      } catch (error) {
        if (error instanceof HttpFailure) return fail(res, error);
        handleRouteError(res, error, "link provider");
      }
    },
  );
}
```

Register in `server/routes.ts`: `import { register as registerAuthSocial } from "./routes/auth-social";` and call `registerAuthSocial(app);` right after `registerAuth(app);`.

Check the `sendError` signature accepts a string code (it is called with `"TOKEN_EXPIRED"` in middleware, so yes). Check `createMockUser` accepts `password: null` (update the factory default type if TypeScript complains).

- [ ] **Step 4: Run** `npx vitest run server/routes/__tests__/auth-social.test.ts server/routes/__tests__/auth-route-wiring.test.ts` — PASS. Iterate on mock shapes until green; do not weaken an assertion to get there.

- [ ] **Step 5: Commit** — `feat(auth): Google/Apple sign-in, sign-up and link endpoints`
- [ ] **Step 6: Open PR 2** (base `feat/siwa-1-schema`); reviews per Global Constraints. PR body records the linking rule (todo AC) verbatim from spec §4.3.

---

# Part 3 — PR 3: Server lifecycle (`feat/siwa-3-server-lifecycle`)

### Task 12: `signInMethods` on `/me`; connect and disconnect

**Files:**

- Modify: `server/routes/auth.ts` (`/api/auth/me`), `server/routes/auth-social.ts` (two routes)
- Test: `server/routes/__tests__/auth-identities.test.ts` (real `requireAuth`, mocked storage); extend `auth.test.ts` for `/me`

**Interfaces:**

- Produces: `GET /api/auth/me` → `{ ...serializeUser(user), signInMethods: SignInMethods }`; `POST /api/auth/identities` and `DELETE /api/auth/identities/:provider` → `{ signInMethods }`.

- [ ] **Step 1: Write the failing tests** (`auth-identities.test.ts`; same mock scaffold as Task 11 plus `getSignInMethods`, `deleteIdentity`; a real token from `generateToken("u1", 0, true)` and `storage.getUser` returning `createMockUser({ id: "u1", tokenVersion: 0 })` so the real `requireAuth` accepts it):

```ts
describe("POST /api/auth/identities", () => {
  it("401 without a session", async () => {
    const res = await request(app())
      .post("/api/auth/identities")
      .send({ provider: "google", idToken: "t", nonce: "n" });
    expect(res.status).toBe(401);
  });
  it("binds the nonce to the caller", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.getSignInMethods).mockResolvedValue({
      password: true,
      google: { email: "me@gmail.com" },
      apple: null,
    });
    await request(app())
      .post("/api/auth/identities")
      .set(auth)
      .send({ provider: "google", idToken: "t", nonce: "n" });
    expect(storage.consumeNonce).toHaveBeenCalledWith("n", "link", "u1");
  });
  it("409 IDENTITY_IN_USE when another account owns it", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue({
      userId: "other",
    } as never);
    const res = await request(app())
      .post("/api/auth/identities")
      .set(auth)
      .send({ provider: "google", idToken: "t", nonce: "n" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("IDENTITY_IN_USE");
  });
  it("409 PROVIDER_ALREADY_CONNECTED when this account already has google", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.listIdentities).mockResolvedValue([
      { provider: "google" } as never,
    ]);
    const res = await request(app())
      .post("/api/auth/identities")
      .set(auth)
      .send({ provider: "google", idToken: "t", nonce: "n" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PROVIDER_ALREADY_CONNECTED");
  });
  it("apple connect fails closed when the exchange fails", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...gmailClaims,
      provider: "apple",
    });
    vi.mocked(exchangeAppleCode).mockRejectedValue(new Error("down"));
    const res = await request(app())
      .post("/api/auth/identities")
      .set(auth)
      .send({
        provider: "apple",
        idToken: "t",
        nonce: "n",
        authorizationCode: "c",
      });
    expect(res.status).toBe(502);
    expect(storage.insertIdentity).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/auth/identities/:provider", () => {
  it("409 LAST_SIGN_IN_METHOD for the only method", async () => {
    vi.mocked(storage.getSignInMethods).mockResolvedValue({
      password: false,
      google: null,
      apple: { email: null, isPrivateRelay: true },
    });
    const res = await request(app())
      .delete("/api/auth/identities/apple")
      .set(auth);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("LAST_SIGN_IN_METHOD");
    expect(storage.deleteIdentity).not.toHaveBeenCalled();
  });
  it("disconnects apple, revoking first; a revoke failure does not block", async () => {
    vi.mocked(storage.getSignInMethods).mockResolvedValue({
      password: true,
      google: null,
      apple: { email: null, isPrivateRelay: true },
    });
    vi.mocked(storage.listIdentities).mockResolvedValue([
      {
        id: "i1",
        provider: "apple",
        appleRefreshTokenEnc: encryptToken("r1"),
      } as never,
    ]);
    vi.mocked(revokeAppleToken).mockRejectedValue(new Error("apple down"));
    const res = await request(app())
      .delete("/api/auth/identities/apple")
      .set(auth);
    expect(res.status).toBe(200);
    expect(revokeAppleToken).toHaveBeenCalledWith("r1", expect.anything());
    expect(storage.deleteIdentity).toHaveBeenCalledWith("u1", "apple");
  });
  it("404 when not connected", async () => {
    vi.mocked(storage.getSignInMethods).mockResolvedValue({
      password: true,
      google: null,
      apple: null,
    });
    const res = await request(app())
      .delete("/api/auth/identities/google")
      .set(auth);
    expect(res.status).toBe(404);
  });
  it("400 for an unknown provider", async () => {
    const res = await request(app())
      .delete("/api/auth/identities/facebook")
      .set(auth);
    expect(res.status).toBe(400);
  });
});
```

And in `auth.test.ts`: `/me` includes `signInMethods` from `storage.getSignInMethods` (add it to that file's storage mock).

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — in `auth.ts` `/me`: `res.json({ ...serializeUser(user), signInMethods: await storage.getSignInMethods(user.id) });`.

In `auth-social.ts`, add a shared helper and two routes inside `register`:

```ts
import { revokeAppleToken } from "../lib/social-identity/apple-tokens";
import { decryptToken } from "../lib/social-identity/token-crypto";
import { reportError } from "../lib/error-reporter";
import { connectIdentitySchema, providerParamSchema } from "./_schemas";
import { crudRateLimit } from "./_rate-limiters";

/** Best-effort: never throws. Used by disconnect and account deletion. */
export async function revokeAppleIdentities(
  identities: { provider: string; appleRefreshTokenEnc: string | null }[],
): Promise<void> {
  const cfg = getSocialConfig().apple;
  for (const i of identities) {
    if (i.provider !== "apple" || !i.appleRefreshTokenEnc) continue;
    try {
      if (!cfg) throw new Error("Apple not configured; cannot revoke");
      await revokeAppleToken(decryptToken(i.appleRefreshTokenEnc), cfg);
    } catch (err) {
      logger.error({ err: toError(err) }, "apple token revoke failed");
      reportError(err, "apple-token-revoke");
    }
  }
}

app.post(
  "/api/auth/identities",
  requireAuth,
  crudRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const parsed = connectIdentitySchema.safeParse(req.body);
      if (!parsed.success)
        return sendError(
          res,
          400,
          formatZodError(parsed.error),
          ErrorCode.VALIDATION_ERROR,
        );
      const body = parsed.data;
      const claims = await verifyProviderToken(
        body.provider,
        body.idToken,
        body.nonce,
      );
      if (!(await storage.consumeNonce(body.nonce, "link", req.userId))) {
        throw new HttpFailure(
          401,
          ErrorCode.INVALID_PROVIDER_TOKEN,
          "Sign-in could not be verified",
        );
      }
      const existing = await storage.findIdentity(claims.provider, claims.sub);
      if (existing && existing.userId !== req.userId) {
        const label = claims.provider === "google" ? "Google" : "Apple";
        throw new HttpFailure(
          409,
          ErrorCode.IDENTITY_IN_USE,
          `This ${label} account is already used by another OCRecipes account.`,
        );
      }
      const mine = await storage.listIdentities(req.userId);
      if (existing || mine.some((i) => i.provider === claims.provider)) {
        throw new HttpFailure(
          409,
          ErrorCode.PROVIDER_ALREADY_CONNECTED,
          "Already connected.",
        );
      }
      const appleTokenEnc =
        claims.provider === "apple"
          ? await appleRefreshTokenFor(body.authorizationCode)
          : null;
      try {
        await storage.insertIdentity({
          userId: req.userId,
          provider: claims.provider,
          providerSubject: claims.sub,
          email: claims.email,
          isPrivateRelay: claims.isPrivateRelay,
          appleRefreshTokenEnc: appleTokenEnc,
        });
      } catch (err) {
        if (isUniqueViolation(err))
          throw new HttpFailure(
            409,
            ErrorCode.PROVIDER_ALREADY_CONNECTED,
            "Already connected.",
          );
        throw err;
      }
      res.json({ signInMethods: await storage.getSignInMethods(req.userId) });
    } catch (error) {
      if (error instanceof HttpFailure) return fail(res, error);
      handleRouteError(res, error, "connect provider");
    }
  },
);

app.delete(
  "/api/auth/identities/:provider",
  requireAuth,
  crudRateLimit,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const provider = providerParamSchema.safeParse(req.params.provider);
      if (!provider.success)
        return sendError(
          res,
          400,
          "Unknown provider",
          ErrorCode.VALIDATION_ERROR,
        );
      const methods = await storage.getSignInMethods(req.userId);
      if (!methods[provider.data])
        return sendError(res, 404, "Not connected", ErrorCode.NOT_FOUND);
      const remaining =
        Number(methods.password) +
        Number(methods.google !== null) +
        Number(methods.apple !== null);
      if (remaining <= 1) {
        return sendError(
          res,
          409,
          "Set a password with “Forgot password” before disconnecting your only sign-in method.",
          ErrorCode.LAST_SIGN_IN_METHOD,
        );
      }
      if (provider.data === "apple") {
        await revokeAppleIdentities(
          (await storage.listIdentities(req.userId)).filter(
            (i) => i.provider === "apple",
          ),
        );
      }
      await storage.deleteIdentity(req.userId, provider.data);
      res.json({ signInMethods: await storage.getSignInMethods(req.userId) });
    } catch (error) {
      handleRouteError(res, error, "disconnect provider");
    }
  },
);
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `feat(auth): sign-in methods on /me; connect and disconnect providers`

### Task 13: Account deletion by provider re-auth + Apple revoke

**Files:**

- Modify: `server/routes/_schemas.ts` (`deleteAccountSchema`), `server/routes/auth.ts` (DELETE `/api/auth/account`)
- Test: `server/routes/__tests__/auth-delete-social.test.ts` (real `requireAuth`)

**Interfaces:**

- Consumes: `verifyProviderToken`, `revokeAppleIdentities` from `auth-social.ts`.
- Produces: `deleteAccountSchema = z.union([{ password }, { provider, idToken, nonce }])`.

- [ ] **Step 1: Write the failing tests**

```ts
describe("DELETE /api/auth/account — provider re-auth", () => {
  it("accepts a fresh Apple token for a linked identity and revokes before deleting", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...appleClaims,
      sub: "a-1",
    });
    vi.mocked(storage.findIdentity).mockResolvedValue({
      userId: "u1",
      provider: "apple",
    } as never);
    vi.mocked(storage.listIdentities).mockResolvedValue([
      { provider: "apple", appleRefreshTokenEnc: encryptToken("r1") } as never,
    ]);
    const order: string[] = [];
    vi.mocked(revokeAppleToken).mockImplementation(async () => {
      order.push("revoke");
    });
    vi.mocked(storage.deleteUser).mockImplementation(async () => {
      order.push("delete");
      return true;
    });
    const res = await request(app())
      .delete("/api/auth/account")
      .set(auth)
      .send({ provider: "apple", idToken: "t", nonce: "n" });
    expect(res.status).toBe(200);
    expect(storage.consumeNonce).toHaveBeenCalledWith("n", "reauth", "u1");
    expect(order).toEqual(["revoke", "delete"]);
  });

  it("still deletes when Apple revoke fails", async () => {
    vi.mocked(verifyAppleIdToken).mockResolvedValue({
      ...appleClaims,
      sub: "a-1",
    });
    vi.mocked(storage.findIdentity).mockResolvedValue({
      userId: "u1",
      provider: "apple",
    } as never);
    vi.mocked(storage.listIdentities).mockResolvedValue([
      { provider: "apple", appleRefreshTokenEnc: encryptToken("r1") } as never,
    ]);
    vi.mocked(revokeAppleToken).mockRejectedValue(new Error("down"));
    const res = await request(app())
      .delete("/api/auth/account")
      .set(auth)
      .send({ provider: "apple", idToken: "t", nonce: "n" });
    expect(res.status).toBe(200);
    expect(storage.deleteUser).toHaveBeenCalledWith("u1");
  });

  it("rejects a provider token linked to a different account", async () => {
    vi.mocked(verifyGoogleIdToken).mockResolvedValue(gmailClaims);
    vi.mocked(storage.findIdentity).mockResolvedValue({
      userId: "someone-else",
    } as never);
    const res = await request(app())
      .delete("/api/auth/account")
      .set(auth)
      .send({ provider: "google", idToken: "t", nonce: "n" });
    expect(res.status).toBe(401);
    expect(storage.deleteUser).not.toHaveBeenCalled();
  });

  it("password deletion also revokes Apple tokens", async () => {
    vi.mocked(storage.getUserForAuth).mockResolvedValue(
      createMockUser({ id: "u1", password: await bcrypt.hash("pw-123456", 4) }),
    );
    vi.mocked(storage.listIdentities).mockResolvedValue([
      { provider: "apple", appleRefreshTokenEnc: encryptToken("r1") } as never,
    ]);
    const res = await request(app())
      .delete("/api/auth/account")
      .set(auth)
      .send({ password: "pw-123456" });
    expect(res.status).toBe(200);
    expect(revokeAppleToken).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** — schema:

```ts
export const deleteAccountSchema = z.union([
  z.object({ password: z.string().min(1, "Password is required") }),
  z.object({
    provider: z.enum(["google", "apple"]),
    idToken: z.string().min(1).max(8192),
    nonce: z.string().min(1).max(200),
  }),
]);
```

In the DELETE handler, replace the password check with:

```ts
const validated = deleteAccountSchema.parse(req.body);
const user = await storage.getUserForAuth(req.userId);
if (!user) return sendError(res, 404, "User not found", ErrorCode.NOT_FOUND);

if ("password" in validated) {
  if (!(await passwordMatches(validated.password, user.password))) {
    return sendError(res, 401, "Invalid credentials", ErrorCode.UNAUTHORIZED);
  }
} else {
  let claims;
  try {
    claims = await verifyProviderToken(
      validated.provider,
      validated.idToken,
      validated.nonce,
    );
  } catch {
    return sendError(res, 401, "Invalid credentials", ErrorCode.UNAUTHORIZED);
  }
  const owned = await storage.findIdentity(claims.provider, claims.sub);
  if (
    !(await storage.consumeNonce(validated.nonce, "reauth", req.userId)) ||
    !owned ||
    owned.userId !== req.userId
  ) {
    return sendError(res, 401, "Invalid credentials", ErrorCode.UNAUTHORIZED);
  }
}

// Revoke BEFORE the delete cascades the rows away; failures never block deletion.
await revokeAppleIdentities(await storage.listIdentities(req.userId));
```

…then the existing `collectUserImageUrls` / `deleteUser` / cache-invalidation / image-cleanup code unchanged. Import `verifyProviderToken` and `revokeAppleIdentities` from `./auth-social` (no import cycle problem: `auth-social` imports only `serializeUser` from `auth`, but to be safe move `serializeUser` to `server/routes/_serialize-user.ts` and import it from both if the cycle trips Vitest).

Add `findIdentity`, `listIdentities`, `consumeNonce`, `getSignInMethods` to `auth.test.ts`'s storage mock so its existing delete tests keep passing.

- [ ] **Step 4: Run** `npx vitest run server/routes/__tests__/auth-delete-social.test.ts server/routes/__tests__/auth.test.ts` — PASS.
- [ ] **Step 5: Commit** — `feat(auth): delete account by provider re-auth; revoke Apple tokens first`
- [ ] **Step 6: Open PR 3** (base `feat/siwa-2-server-sign-in`); reviews per Global Constraints.

---

# Part 4 — PR 4: Client sign-in (`feat/siwa-4-client-sign-in`)

**Precondition:** the owner has the Universal Sign In license and the registry token is set as an EAS secret, a GitHub Actions secret, and a Railway variable. Without it, stop and ask; do not merge.

### Task 14: Dependencies, native config, runtime version

**Files:**

- Modify: `package.json`, `package-lock.json`, `.npmrc` (create if absent), `app.json`, `ios/OCRecipes/OCRecipes.entitlements`, `ios/OCRecipes/Info.plist`, `.github/workflows/ci.yml` (registry env), `eas.json` if build env needs the var
- Test: `client/lib/__tests__/native-config.test.ts`

- [ ] **Step 1: Write the failing config test** (pins what a reviewer would otherwise eyeball):

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import appJson from "../../../app.json";

describe("native sign-in config", () => {
  it("bumps the runtime version past 1.3.0", () => {
    expect(appJson.expo.runtimeVersion).toBe("1.4.0");
  });
  it("declares the Sign in with Apple entitlement", () => {
    const xml = fs.readFileSync("ios/OCRecipes/OCRecipes.entitlements", "utf8");
    expect(xml).toContain("<key>com.apple.developer.applesignin</key>");
    expect(xml).toContain("<string>Default</string>");
  });
  it("registers the Google reversed client id URL scheme", () => {
    const plist = fs.readFileSync("ios/OCRecipes/Info.plist", "utf8");
    expect(plist).toMatch(/com\.googleusercontent\.apps\./);
  });
  it("lists both plugins in app.json", () => {
    const plugins = JSON.stringify(appJson.expo.plugins);
    expect(plugins).toContain("expo-apple-authentication");
    expect(plugins).toContain("@react-native-google-signin/google-signin");
  });
});
```

- [ ] **Step 2: Run** `npx vitest run client/lib/__tests__/native-config.test.ts` — FAIL.

- [ ] **Step 3: Install and configure**
  1. Follow the Universal Sign In install doc (Context7 `/react-native-google-signin/docs` → "Installation", paid version) for the registry URL; add to `.npmrc`: `@react-native-google-signin:registry=<url>` and `//<host>/:_authToken=${RNGS_REGISTRY_TOKEN}` (env var, never a literal token).
  2. `npx expo install expo-apple-authentication` and install the paid package at the version its doc pins for SDK 54.
  3. `app.json`: `runtimeVersion` → `"1.4.0"`; add `"expo-apple-authentication"` and `["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.<IOS_CLIENT_ID_PREFIX>" }]` to `plugins` (owner supplies the iOS client ID).
  4. `ios/OCRecipes/OCRecipes.entitlements`: replace `<dict/>` with
     ```xml
     <dict>
       <key>com.apple.developer.applesignin</key>
       <array>
         <string>Default</string>
       </array>
     </dict>
     ```
  5. `ios/OCRecipes/Info.plist`: add the reversed iOS client ID to `CFBundleURLTypes` → `CFBundleURLSchemes` (append a new dict entry; keep the existing `ocrecipes` scheme).
  6. `cd ios && pod install` (commit `Podfile.lock`).
  7. CI: add `RNGS_REGISTRY_TOKEN: ${{ secrets.RNGS_REGISTRY_TOKEN }}` to the env of every job that runs `npm ci`.
  8. Add `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` to `.env.example`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `build(ios): Sign in with Apple entitlement, Google sign-in SDK, runtime 1.4.0`

### Task 15: Client social-auth logic

**Files:**

- Create: `client/lib/social-auth-utils.ts`, `client/lib/social-sign-in.ts`
- Modify: `client/hooks/useAuth.ts` (extract `establishSession`, add `signInWithProvider`, `completeSocialSignUp`, `linkWithPassword`, `linkWithProvider`), `client/context/AuthContext.tsx` (expose them), `shared/types/auth.ts` (response types)
- Test: `client/lib/__tests__/social-auth-utils.test.ts`

**Interfaces:**

- Produces (`shared/types/auth.ts`): `SocialProvider = "google" | "apple"`; `SocialSignInResult = { status: "signed_in"; user: User; token: string } | { status: "choose_username"; ticket: string; suggestedUsername: string } | { status: "link_required"; ticket: string; methods: ("password" | SocialProvider)[]; email: string }`; `SignInMethods` (same shape as server).
- Produces (`social-auth-utils.ts`): `visibleProviders(config: { google: boolean; apple: boolean }, platform: "ios" | "android" | "web"): SocialProvider[]`; `canDisconnect(methods: SignInMethods, provider: SocialProvider): boolean`.
- Produces (`social-sign-in.ts`): `getProviderToken(provider: SocialProvider, nonceHash: string): Promise<ProviderToken | null>` (null = cancelled) where `ProviderToken = { idToken: string; authorizationCode?: string; fullName?: { givenName: string | null; familyName: string | null } }`.
- Produces (`useAuth`): `signInWithProvider(provider): Promise<SocialSignInResult | null>`; `completeSocialSignUp(ticket, username, ageConfirmed): Promise<void>`; `linkWithPassword(ticket, password): Promise<void>`; `linkWithProvider(ticket, provider): Promise<void>`.

- [ ] **Step 1: Write the failing util tests**

```ts
import { describe, it, expect } from "vitest";
import { visibleProviders, canDisconnect } from "../social-auth-utils";

describe("visibleProviders", () => {
  it("iOS: apple first, google only alongside apple (guideline 4.8)", () => {
    expect(visibleProviders({ google: true, apple: true }, "ios")).toEqual([
      "apple",
      "google",
    ]);
    expect(visibleProviders({ google: true, apple: false }, "ios")).toEqual([]);
    expect(visibleProviders({ google: false, apple: true }, "ios")).toEqual([
      "apple",
    ]);
  });
  it("Android: google only, never apple", () => {
    expect(visibleProviders({ google: true, apple: true }, "android")).toEqual([
      "google",
    ]);
  });
  it("web: none", () => {
    expect(visibleProviders({ google: true, apple: true }, "web")).toEqual([]);
  });
});

describe("canDisconnect", () => {
  it("false for the only method", () => {
    expect(
      canDisconnect(
        {
          password: false,
          google: null,
          apple: { email: null, isPrivateRelay: true },
        },
        "apple",
      ),
    ).toBe(false);
  });
  it("true when a password remains", () => {
    expect(
      canDisconnect(
        { password: true, google: { email: "a@gmail.com" }, apple: null },
        "google",
      ),
    ).toBe(true);
  });
  it("true when another provider remains", () => {
    expect(
      canDisconnect(
        {
          password: false,
          google: { email: "a@gmail.com" },
          apple: { email: null, isPrivateRelay: true },
        },
        "apple",
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run client/lib/__tests__/social-auth-utils.test.ts` — FAIL.

- [ ] **Step 3: Implement**

```ts
// client/lib/social-auth-utils.ts
import type { SignInMethods, SocialProvider } from "@shared/types/auth";

/** Apple is iOS-only; on iOS Google never appears without Apple (App Store 4.8). */
export function visibleProviders(
  config: { google: boolean; apple: boolean },
  platform: "ios" | "android" | "web",
): SocialProvider[] {
  if (platform === "ios") {
    if (!config.apple) return [];
    return config.google ? ["apple", "google"] : ["apple"];
  }
  if (platform === "android") return config.google ? ["google"] : [];
  return [];
}

export function canDisconnect(
  methods: SignInMethods,
  provider: SocialProvider,
): boolean {
  const count =
    Number(methods.password) +
    Number(methods.google !== null) +
    Number(methods.apple !== null);
  return methods[provider] !== null && count > 1;
}
```

```ts
// client/lib/social-sign-in.ts — native SDK calls only; no logic worth unit-testing here.
import * as AppleAuthentication from "expo-apple-authentication";
import { GoogleOneTapSignIn } from "@react-native-google-signin/google-signin";
import type { SocialProvider } from "@shared/types/auth";

export interface ProviderToken {
  idToken: string;
  authorizationCode?: string;
  fullName?: { givenName: string | null; familyName: string | null };
}

let googleConfigured = false;
function configureGoogle() {
  if (googleConfigured) return;
  GoogleOneTapSignIn.configure({
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID!,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  });
  googleConfigured = true;
}

/** Returns null when the person cancels the sheet (callers show nothing). */
export async function getProviderToken(
  provider: SocialProvider,
  nonceHash: string,
): Promise<ProviderToken | null> {
  if (provider === "apple") {
    try {
      const cred = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: nonceHash, // passed through unhashed by Expo (verified 2026-10-04)
      });
      if (!cred.identityToken)
        throw new Error("Apple returned no identity token");
      return {
        idToken: cred.identityToken,
        authorizationCode: cred.authorizationCode ?? undefined,
        fullName: cred.fullName
          ? {
              givenName: cred.fullName.givenName,
              familyName: cred.fullName.familyName,
            }
          : undefined,
      };
    } catch (err) {
      if ((err as { code?: string }).code === "ERR_REQUEST_CANCELED")
        return null;
      throw err;
    }
  }
  configureGoogle();
  const { user, isCancelled, error } = await GoogleOneTapSignIn.authenticate({
    nonce: nonceHash,
  });
  if (isCancelled) return null;
  if (error || !user?.idToken)
    throw error ?? new Error("Google returned no ID token");
  return { idToken: user.idToken };
}
```

Before writing `social-sign-in.ts`, open the installed package's type declarations (`node_modules/@react-native-google-signin/google-signin/lib/typescript/**/*.d.ts`) and confirm `authenticate`'s param and result field names (`nonce`, `user.idToken`, `isCancelled`, `error`); adjust to the real names if they differ.

In `useAuth.ts`, extract the body of `login` after the fetch into `establishSession(user, token)` and reuse it:

```ts
const establishSession = useCallback(async (user: User, token: string) => {
  await tokenStorage.set(token);
  await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(user));
  await reconcileOwnerFor(user.id);
  setState({ user, isLoading: false, isAuthenticated: true });
  registerPushToken().catch(() => {});
}, []);

const login = useCallback(
  async (username: string, password: string) => {
    const response = await apiRequest("POST", "/api/auth/login", {
      username,
      password,
    });
    const { user, token } = await response.json();
    await establishSession(user, token);
    return user;
  },
  [establishSession],
);

async function fetchNonce(purpose: "sign_in" | "link" | "reauth") {
  const res = await apiRequest("POST", "/api/auth/social/nonce", { purpose });
  return (await res.json()) as { nonce: string; nonceHash: string };
}

const signInWithProvider = useCallback(
  async (provider: SocialProvider): Promise<SocialSignInResult | null> => {
    const { nonce, nonceHash } = await fetchNonce("sign_in");
    const token = await getProviderToken(provider, nonceHash);
    if (!token) return null;
    const res = await apiRequest("POST", "/api/auth/social", {
      provider,
      nonce,
      ...token,
    });
    const result = (await res.json()) as SocialSignInResult;
    if (result.status === "signed_in")
      await establishSession(result.user, result.token);
    return result;
  },
  [establishSession],
);

const completeSocialSignUp = useCallback(
  async (ticket: string, username: string, ageConfirmed: boolean) => {
    const res = await apiRequest("POST", "/api/auth/social/complete-sign-up", {
      ticket,
      username,
      ageConfirmed,
    });
    const { user, token } = await res.json();
    await establishSession(user, token);
  },
  [establishSession],
);

const linkWithPassword = useCallback(
  async (ticket: string, password: string) => {
    const res = await apiRequest("POST", "/api/auth/social/link", {
      ticket,
      password,
    });
    const { user, token } = await res.json();
    await establishSession(user, token);
  },
  [establishSession],
);

const linkWithProvider = useCallback(
  async (ticket: string, provider: SocialProvider) => {
    const { nonce, nonceHash } = await fetchNonce("link");
    const token = await getProviderToken(provider, nonceHash);
    if (!token) return;
    const res = await apiRequest("POST", "/api/auth/social/link", {
      ticket,
      provider,
      nonce,
      idToken: token.idToken,
    });
    const { user, token: session } = await res.json();
    await establishSession(user, session);
  },
  [establishSession],
);
```

Return the four new functions from the hook and add them to `AuthContext`'s value type.

- [ ] **Step 4: Run** the util tests and the existing `client/hooks/__tests__/useAuth*` / `client/context/__tests__/*` tests (`npx vitest run client/lib/__tests__/social-auth-utils.test.ts client/hooks client/context`) — PASS (the `login` refactor must keep existing tests green).
- [ ] **Step 5: Commit** — `feat(client): social sign-in session plumbing`

### Task 16: Login buttons

**Files:**

- Create: `client/components/SocialSignInButtons.tsx`, `client/hooks/useSocialConfig.ts`
- Modify: `client/screens/LoginScreen.tsx`
- Test: `client/components/__tests__/SocialSignInButtons.test.tsx` (use `renderComponent` per `reference_client_component_test_harness`)

**Interfaces:**

- Produces: `useSocialConfig(): { google: boolean; apple: boolean }` (TanStack Query on `GET /api/auth/social/config`, default `{google:false, apple:false}` while loading or on error); `<SocialSignInButtons onResult(result: SocialSignInResult) onError(message: string) />`.

- [ ] **Step 1: Write the failing component test**

```tsx
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "@/test/render-component"; // use the repo's actual helper path
import { SocialSignInButtons } from "../SocialSignInButtons";

vi.mock("@/hooks/useSocialConfig", () => ({
  useSocialConfig: () => ({ google: true, apple: false }),
}));
vi.mock("react-native", async (orig) => ({
  ...(await orig<object>()),
  Platform: { OS: "ios", select: (o: any) => o.ios },
}));

describe("SocialSignInButtons", () => {
  it("renders nothing on iOS when Apple is not configured", () => {
    const { queryByLabelText } = renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={vi.fn()} />,
    );
    expect(queryByLabelText("Continue with Google")).toBeNull();
  });
});
```

(Add a second case with `{google:true, apple:true}` asserting both labels render, Apple first. Find the real render helper with `grep -rn "export function renderComponent" client test`.)

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement** `useSocialConfig` (`useQuery({ queryKey: ["/api/auth/social/config"], staleTime: 5 * 60_000 })`, mapping errors to both false) and `SocialSignInButtons`:
  - `const providers = visibleProviders(useSocialConfig(), Platform.OS as "ios" | "android" | "web")`; return `null` when empty.
  - Apple: `<AppleAuthentication.AppleAuthenticationButton buttonType={CONTINUE} buttonStyle={theme dark ? WHITE : BLACK} cornerRadius={BorderRadius.md} style={{ height: 48, width: "100%" }} onPress={() => run("apple")} />`.
  - Google: a `Pressable` at the same 48pt height and full width, Google "G" logo asset (`assets/images/google-g.png`, from Google's branding kit) + "Continue with Google", `accessibilityRole="button"`, `accessibilityLabel="Continue with Google"`, styled per Google's branding guidelines (white/neutral background, 1pt border).
  - `run(provider)`: haptic, disable both buttons while in flight, `const r = await signInWithProvider(provider); if (r) onResult(r)`; catch → `onError(getAuthErrorMessage(err))`; cancellation (`null`) shows nothing.
  - Then an "or" divider row.
  - Apply the `interaction-feel` skill's pressed-state guidance.

In `LoginScreen.tsx`, render `<SocialSignInButtons>` above the form in **login mode and register mode**, with:

```tsx
onResult={(r) => {
  if (r.status === "choose_username") navigation.navigate("ChooseUsername", { ticket: r.ticket, suggestedUsername: r.suggestedUsername });
  else if (r.status === "link_required") navigation.navigate("ConnectAccount", { ticket: r.ticket, methods: r.methods, email: r.email });
  // signed_in: the root navigator switches stacks on its own
}}
onError={setError}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `feat(client): Continue with Apple / Google on the login screen`

### Task 17: ChooseUsername and ConnectAccount screens

**Files:**

- Create: `client/screens/ChooseUsernameScreen.tsx`, `client/screens/ConnectAccountScreen.tsx`, `client/screens/ConnectAccountScreen-utils.ts`
- Modify: `client/navigation/RootStackNavigator.tsx` (param list + two `Stack.Screen`s in the unauthenticated group, `headerShown: false` like siblings)
- Test: `client/screens/__tests__/ConnectAccountScreen-utils.test.ts`

**Interfaces:**

- Produces: `RootStackParamList.ChooseUsername: { ticket: string; suggestedUsername: string }`; `RootStackParamList.ConnectAccount: { ticket: string; methods: ("password" | "google" | "apple")[]; email: string }`; `connectPromptMode(methods, platform): { kind: "password" } | { kind: "provider"; provider: SocialProvider } | { kind: "reset_only" }`.

- [ ] **Step 1: Write the failing util test**

```ts
import { describe, it, expect } from "vitest";
import { connectPromptMode } from "../ConnectAccountScreen-utils";

describe("connectPromptMode", () => {
  it("password when the account has one", () => {
    expect(connectPromptMode(["password", "apple"], "ios")).toEqual({
      kind: "password",
    });
  });
  it("the linked provider for a provider-only account", () => {
    expect(connectPromptMode(["apple"], "ios")).toEqual({
      kind: "provider",
      provider: "apple",
    });
  });
  it("Apple-only account on Android can only reset", () => {
    expect(connectPromptMode(["apple"], "android")).toEqual({
      kind: "reset_only",
    });
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```ts
// ConnectAccountScreen-utils.ts
import type { SocialProvider } from "@shared/types/auth";
type Method = "password" | SocialProvider;

export function connectPromptMode(
  methods: Method[],
  platform: "ios" | "android" | "web",
):
  | { kind: "password" }
  | { kind: "provider"; provider: SocialProvider }
  | { kind: "reset_only" } {
  if (methods.includes("password")) return { kind: "password" };
  const usable = methods.filter(
    (m): m is SocialProvider =>
      m !== "password" && (m !== "apple" || platform === "ios"),
  );
  return usable[0]
    ? { kind: "provider", provider: usable[0] }
    : { kind: "reset_only" };
}
```

Screens (follow `ForgotPasswordScreen.tsx` for layout, `ThemedText`/`TextInput`/`Button`/`InlineError`, keyboard handling and haptics):

- **ChooseUsernameScreen**: title "Choose a username"; `TextInput` prefilled with `suggestedUsername` (autoCapitalize none, autoCorrect off); the same 13+ checkbox component/copy LoginScreen uses for register; submit disabled until checked; validates with LoginScreen-utils' username rule; `completeSocialSignUp(ticket, username, ageConfirmed)`; `ApiError` 409 → inline "That username is taken — try another"; `INVALID_SIGN_IN_TICKET` → toast "That took too long — please start again" + `navigation.navigate("Login")`. On success the root navigator moves to onboarding by itself.
- **ConnectAccountScreen**: copy "You already have an OCRecipes account with {email}." Then by `connectPromptMode`:
  - `password`: password field + "Connect and sign in" → `linkWithPassword`; 401 → inline "Incorrect password"; ticket errors → as above.
  - `provider`: "Continue with Apple/Google to connect" (Apple uses `AppleAuthenticationButton`) → `linkWithProvider`.
  - always: a "Forgot password?" link → `navigation.navigate("ForgotPassword", { email })`.
  - `SECOND_FACTOR_REQUIRED` (future) → inline "This account uses two-step sign-in. Sign in with your password first, then connect from Settings."

- [ ] **Step 4: Run** util test — PASS. Then `/verify-ui` both screens in the simulator (deep-link or temporary navigation; follow the `verify-ui` skill).
- [ ] **Step 5: Commit** — `feat(client): ChooseUsername and ConnectAccount screens`
- [ ] **Step 6: Open PR 4** (base `feat/siwa-3-server-lifecycle`). Add `mobile-reviewer` to the reviewers. PR body: "requires native build 1.4.0; registry token on Railway/EAS/CI before merge".

---

# Part 5 — PR 5: Client settings (`feat/siwa-5-client-settings`)

### Task 18: Sign-in methods screen

**Files:**

- Create: `client/screens/SignInMethodsScreen.tsx`
- Modify: `client/navigation/ProfileStackNavigator.tsx` (`SignInMethods: undefined` + screen with `HeaderTitle title="Sign-in methods"`), `client/screens/SettingsScreen.tsx` (new `SETTINGS_ITEMS` row `{ id: "signInMethods", icon: "key", label: "Sign-in methods" }` placed before `changeEmail`, and its `case` navigating to `SignInMethods`), `client/hooks/useAuth.ts` (`connectProvider(provider)`, `disconnectProvider(provider)`), `shared/types/auth.ts` (`User.signInMethods?: SignInMethods`)
- Test: extend `client/lib/__tests__/social-auth-utils.test.ts` if new logic appears; `/verify-ui` for the screen

**Interfaces:**

- Consumes: `canDisconnect`, `visibleProviders`, `getProviderToken`, `/api/auth/me` `signInMethods`.
- Produces: `connectProvider(provider): Promise<SignInMethods | null>`; `disconnectProvider(provider): Promise<SignInMethods>`.

- [ ] **Step 1: Write a failing test** for any screen-level pure logic you extract (e.g. row label: `email ?? "Hidden by Apple"` when `isPrivateRelay`). Put it in `client/screens/SignInMethodsScreen-utils.ts` with a test:

```ts
import { describe, it, expect } from "vitest";
import { methodSubtitle } from "../SignInMethodsScreen-utils";

describe("methodSubtitle", () => {
  it("hides relay addresses", () => {
    expect(
      methodSubtitle({
        email: "x@privaterelay.appleid.com",
        isPrivateRelay: true,
      }),
    ).toBe("Hidden by Apple");
  });
  it("shows the email otherwise", () => {
    expect(methodSubtitle({ email: "a@gmail.com" })).toBe("a@gmail.com");
  });
  it("not connected", () => {
    expect(methodSubtitle(null)).toBe("Not connected");
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** `methodSubtitle`, the two hook functions (`connectProvider`: `fetchNonce("link")` → `getProviderToken` → `POST /api/auth/identities` → refresh the `/api/auth/me` query; `disconnectProvider`: `DELETE /api/auth/identities/:provider`), and the screen:
  - Rows: **Password** — "Set" when `!password` → `navigate("ForgotPassword", { email: user.email })` (it lives in the root stack; navigate via the parent navigator) / "Change" via the same flow when set. **Google**, **Apple** (Apple row iOS-only) — subtitle `methodSubtitle(...)`, trailing button "Connect" or "Disconnect".
  - Disconnect: disabled when `!canDisconnect(...)`, with helper text "Add a password or another sign-in method first." Confirm via the in-app `confirm()` sheet used in `SettingsScreen` (never `Alert.alert`).
  - Errors: `IDENTITY_IN_USE` / `PROVIDER_ALREADY_CONNECTED` → toast with the server message.
- [ ] **Step 4: Run** test — PASS; `/verify-ui` the screen.
- [ ] **Step 5: Commit** — `feat(client): Settings → Sign-in methods`

### Task 19: Delete account confirmed by provider

**Files:**

- Modify: `client/components/DeleteAccountModal.tsx`, `client/hooks/useAuth.ts` (`deleteAccount` accepts `{ password } | { provider }`), `client/screens/SettingsScreen.tsx` (pass `signInMethods`)
- Test: `client/components/__tests__/DeleteAccountModal.test.tsx` (extend existing if present)

**Interfaces:**

- Produces: `deleteAccount(proof: { password: string } | { provider: SocialProvider }): Promise<void>`; `DeleteAccountModalProps.onConfirm(proof)`; new prop `signInMethods: SignInMethods`.

- [ ] **Step 1: Write the failing test**: with `signInMethods = { password: false, google: null, apple: {...} }` the modal shows "Confirm with Apple" and no password field; with `password: true` it shows the password field (current behaviour).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**: `deleteAccount` — for `{ provider }`: `fetchNonce("reauth")` → `getProviderToken(provider, nonceHash)` (null → return without deleting) → `apiRequest("DELETE", "/api/auth/account", { provider, nonce, idToken })`, then the existing local cleanup. Update the one `SettingsScreen` call site.
- [ ] **Step 4: Run** — PASS; `/verify-ui` Settings → Delete Account for a social-only mock user.
- [ ] **Step 5: Commit** — `feat(client): delete a Google/Apple-only account`
- [ ] **Step 6: Open PR 5** (base `feat/siwa-4-client-sign-in`); `security-auditor` + `code-reviewer` + `mobile-reviewer`.

---

## After all five PRs

- [ ] Retarget each child PR to `main` before merging its base (memory: stacked-PR rule). Merge in order 1→5 on owner go-ahead.
- [ ] `/codify` the reusable lessons (provider token verification with injected JWKS; ticket-attempt pattern; gate-before-insert).
- [ ] Update the todo's **Updates** section with PR numbers; archive it to `todos/archive/` only after the owner's device smoke test (spec §7).
- [ ] Owner: Railway vars, 1.4.0 build, device smoke list (spec §7 owner checklist).
