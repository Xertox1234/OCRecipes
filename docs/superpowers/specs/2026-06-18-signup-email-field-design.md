# Design — Add a required email field to signup

- **Date:** 2026-06-18
- **Status:** Approved (design); pending written-spec review (rev 3 — adds blast-radius/fixture sweep + concrete migration after advisor review)
- **Source todo:** `todos/P2-2026-06-18-signup-email-field.md`
- **Builds on:** PR #399 (P1 email-as-username fix) — MERGED
- **Follow-up (out of scope here):** Email verification via Resend → `todos/P2-2026-06-18-email-verification-resend.md`

## Summary

Keep the existing alphanumeric `username` as the login identifier, but also
collect a **required, unique, normalized email address** at signup (for future
password reset, receipts/IAP, notifications). Login is unchanged (still
username + password). Email **verification is explicitly deferred** to a
separate change; this spec only adds the field and a forward-compatible
`emailVerified` column so the verification work needs no second prod migration.

## Decisions (locked during brainstorming + review)

| Question                               | Decision                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Required or optional?                  | **Required** — `NOT NULL` in the DB. Pre-launch (test accounts only) → no real backfill pain; guarantees every account is reachable.                                                                                                                                                                                                                                                             |
| Unique?                                | **Yes** — unique index. One account per email.                                                                                                                                                                                                                                                                                                                                                   |
| Normalization                          | **trim + lowercase**, stored normalized. `Foo@X.com` and `foo@x.com` collide.                                                                                                                                                                                                                                                                                                                    |
| Verification (v1)?                     | **Deferred** to a separate Resend-based spec. Add `emailVerified boolean default false` now (ungated) so verification builds on it without a 2nd DDL.                                                                                                                                                                                                                                            |
| Existing accounts                      | Pre-launch test accounts only. Migration **deletes** the disposable test rows, then pushes the `NOT NULL` column onto an empty table (see Migration).                                                                                                                                                                                                                                            |
| Login by email?                        | **No** — login stays username + password.                                                                                                                                                                                                                                                                                                                                                        |
| Conflict / enumeration                 | **Mirror the existing username path** — API returns a distinct 409, but the client (`getAuthErrorMessage`) already collapses register failures to a generic message, so the UI never reveals whether an email is registered. True API-level anti-enumeration arrives with verification.                                                                                                          |
| **Request-body validation**            | **`safeParse` (must), not `.parse()`** — required by `docs/rules/api.md:6` + `docs/rules/security.md:12`. The register route is being edited anyway; converting its body validation to `safeParse` removes a pre-existing rule violation. See §4.                                                                                                                                                |
| **Auth response contract**             | **`serializeUser` MUST return `email` + `emailVerified`** (server-guaranteed at runtime). **The shared `User` type MUST gain both as OPTIONAL** — matches the file's existing all-optional convention + the lenient-consumer rule (`typescript.md:10`), and avoids a gratuitous client-mock sweep. Contract still cannot drift: the fields are present and the route test asserts them. See §4b. |
| **Legal attestation (`ageConfirmed`)** | **MUST stay threaded as live state end-to-end** and **MUST NOT be hardcoded** to a literal anywhere. Parsed by the server, never persisted. See §3, §4, §7, and Non-Regression Guards.                                                                                                                                                                                                           |

## Final locked signatures (end state — implement exactly)

Authoritative end-state shapes. Argument order is fixed; do not reorder or drop a parameter.

```ts
// shared/types/auth.ts — client/server contract (fields OPTIONAL, per the file's convention)
export interface User {
  id: string;
  username: string;
  email?: string;          // NEW — server always returns it; optional type = lenient consumer
  emailVerified?: boolean;  // NEW — forward-compat for the verification spec
  displayName?: string;
  avatarUrl?: string | null;
  dailyCalorieGoal?: number;
  onboardingCompleted?: boolean;
  subscriptionTier?: SubscriptionTier;
  measurementUnit?: MeasurementUnit;
}

// server/routes/_schemas.ts — registerSchema gains `email`; ageConfirmed UNCHANGED
registerSchema = z.object({
  username: /* unchanged */,
  password: /* unchanged */,
  email: z.string().trim().toLowerCase().email("Please enter a valid email address").max(254), // NEW
  ageConfirmed: z.literal(true, { /* unchanged COPPA gate */ }),
});

// client/context/AuthContext.tsx — register signature
register: (
  username: string,
  password: string,
  email: string,        // NEW (inserted before ageConfirmed)
  ageConfirmed: boolean,
) => Promise<User>;

// client/hooks/useAuth.ts — register signature + POST body
register(username: string, password: string, email: string, ageConfirmed: boolean)
// POST /api/auth/register body: { username, password, email, ageConfirmed }

// client/screens/LoginScreen.tsx — submit call
await register(username.trim(), password, email.trim(), ageConfirmed);

// client/screens/LoginScreen-utils.ts — AuthFormInput gains `email`
interface AuthFormInput { mode; username; password; confirmPassword; ageConfirmed; email: string }
```

## Architecture / changes by file

### 1. Database — `shared/schema.ts` (`users` table, ~line 33)

Add two columns after `username`:

```ts
email: text("email").notNull().unique(),
emailVerified: boolean("email_verified").default(false).notNull(),
```

- Postgres auto-creates a unique index for `email`.
- `emailVerified` is **groundwork only** — nothing gates on it in this change.
- `boolean` is already imported (used by `onboardingCompleted`).
- `User` (`shared/schema.ts:1111`, `typeof users.$inferSelect`), `InsertUser`, and
  `safeUserColumns` (`server/storage/users.ts:31`) pick up both columns automatically.

### 2. Server validation — `server/routes/_schemas.ts` (`registerSchema`, ~line 28)

Add the `email` field from the locked signatures. zod is pinned at **3.25.76**;
`.trim()` / `.toLowerCase()` apply (in declaration order) _before_ `.email()`
validates the normalized value. `loginSchema` and the `ageConfirmed` gate are unchanged.

### 3. Storage — `server/storage/users.ts`

Add `getUserByEmail` mirroring `getUserByUsername` (returns `SafeUser`, uses `safeUserColumns`):

```ts
export async function getUserByEmail(
  email: string,
): Promise<SafeUser | undefined> {
  const [user] = await db
    .select(safeUserColumns)
    .from(users)
    .where(eq(users.email, email));
  return user || undefined;
}
```

`createUser` signature is **unchanged** — `InsertUser` gains `email` automatically.
Re-export `getUserByEmail` through the storage facade (`server/storage/index.ts`)
the same way `getUserByUsername` is exposed.

### 4. Register route — `server/routes/auth.ts` (`register`, ~line 58)

**4a. Switch body validation to `safeParse` (must — rule compliance).** Replace
`const validated = registerSchema.parse(req.body)` with the codebase's canonical
shape (mirrors `server/routes/cookbooks.ts:68`):

```ts
const parsed = registerSchema.safeParse(req.body);
if (!parsed.success) {
  sendError(res, 400, formatZodError(parsed.error), ErrorCode.VALIDATION_ERROR);
  return;
}
const validated = parsed.data;
```

Import `formatZodError` from `./_helpers` (alongside `handleRouteError`). Keep the
surrounding `try/catch` → `handleRouteError` for non-Zod failures (bcrypt / DB).
This removes the route's pre-existing violation of `api.md:6` / `security.md:12`,
and is response-equivalent for invalid input (still `400 VALIDATION_ERROR` via
`formatZodError`), so existing 400-path tests keep passing.

**4b. Persist email; preserve attestation behavior.** Final `createUser` call:

```ts
user = await storage.createUser({
  username: validated.username,
  password: hashedPassword,
  email: validated.email, // NEW
});
```

`ageConfirmed` is **validated only, never persisted** — do **NOT** add it to
`createUser` or the `users` table. See Non-Regression Guards.

**4c. Email conflict pre-check** (mirror the username pre-check):

```ts
const existingEmail = await storage.getUserByEmail(validated.email);
if (existingEmail) {
  return sendError(res, 409, "Email already registered", ErrorCode.CONFLICT);
}
```

The existing `isUniqueViolation(err)` catch around `createUser` already covers the
concurrent-registration race for either unique column; keep its response generic.

### 4b (contract). Auth response — `serializeUser` + shared `User` type

**`server/routes/auth.ts` `serializeUser` (line 35) MUST update** — add both
fields to the input type _and_ the returned object:

```ts
function serializeUser(user: {
  id: string;
  username: string;
  email: string; // NEW
  emailVerified: boolean; // NEW
  displayName: string | null;
  /* ...existing fields unchanged... */
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email, // NEW
    emailVerified: user.emailVerified, // NEW
    /* ...existing returned fields unchanged... */
  };
}
```

**`shared/types/auth.ts` `User` interface (line 8) MUST update** — add
`email?: string;` and `emailVerified?: boolean;` (**optional**, per the file's
all-optional convention + lenient-consumer rule `typescript.md:10`). The server
guarantees both at runtime; the route test asserts presence — so the contract
cannot drift despite the permissive type, and existing client `User` mocks need
no change.

**Call sites verified — all compile with no change.** All four `serializeUser`
callers pass a source that carries the two new columns:

| Caller                  | Source                     | Type                                          |
| ----------------------- | -------------------------- | --------------------------------------------- |
| register (`:80`)        | `createUser`               | `User` (full row)                             |
| login (`:114`)          | `getUserByUsernameForAuth` | `User` (full row)                             |
| `/me` (`:179`)          | `getUser`                  | `SafeUser` (`safeUserColumns` incl. new cols) |
| profile update (`:218`) | `updateUser`               | `User` (full row)                             |

Consequence: **login and `/me` responses also start returning `email` +
`emailVerified`** — intended (the client's own data; one consistent `User` contract).

### 5. Client utils — `client/screens/LoginScreen-utils.ts`

- Extend `AuthFormInput` with `email: string`.
- The top-of-function "all fields present" guard MUST require `email` in register mode.
- Add a **register-only** email rule after the username rules (mirrors `registerSchema`;
  honors the "KEEP IN SYNC (manual)" header):

```ts
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // pragmatic client mirror
const email = input.email.trim();
if (!email) return "Please enter your email address";
if (!EMAIL_PATTERN.test(email)) return "Please enter a valid email address";
```

### 6. Client screen — `client/screens/LoginScreen.tsx`

- Add `const [email, setEmail] = useState("")`.
- New Email `TextInput`, register mode only: `keyboardType="email-address"`,
  `autoCapitalize="none"`, `autoComplete="email"`, `textContentType="emailAddress"`,
  a11y label + hint, InlineError on failure.
- Pass `email` into the `validateAuthForm({ ... })` object (`:75`).
- Submit call (`:93`) MUST become
  `await register(username.trim(), password, email.trim(), ageConfirmed)` —
  `ageConfirmed` stays the live `useState` value, never a literal.

### 7. Client hook/context — `client/hooks/useAuth.ts` + `client/context/AuthContext.tsx`

- `useAuth.register` (`:149`) + `AuthContext`'s `register` type (`:10`) MUST adopt
  `(username, password, email, ageConfirmed)`.
- `useAuth.register` MUST add `email` to the POST body, keeping `ageConfirmed` (`:156`).
- Login is untouched.

## Test-fixture blast radius (must sweep — `NOT NULL` ripple)

Vitest runs against the same `nutricam` DB, so once `email` is `NOT NULL`, every
fixture that inserts a user without one throws. Centralized + minimal:

1. **`test/db-test-utils.ts` `createTestUser` (`:193` defaults) — add a unique
   `email` default**, reusing the existing unique-username generator pattern:
   ```ts
   email: `testuser_${userSeq}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}@test.invalid`,
   ```
   The column is `UNIQUE`, so the email MUST be generated unique per call (a static
   default collides on the 2nd insert). **This one edit fixes all 27 storage test
   files** that seed users via `createTestUser`.
2. **Direct `.insert(users)` calls (2)** — add a unique `email`:
   `server/storage/__tests__/nutrition.concurrent.test.ts:40`,
   `server/storage/__tests__/verification.concurrent.test.ts:53`.
3. **`server/storage/__tests__/users.test.ts:99`** — the direct `createUser({...})`
   test: add `email` (also part of the named storage-test work below).
4. **Route tests** posting to `/api/auth/register` (`auth.test.ts`) — payloads gain `email`.
5. **`server/scripts/seed-recipes.ts`** — if it seeds a demo user directly, add an
   `email` (demo account) so `npm run seed:recipes` doesn't break.
6. **Client `User` mocks need NO change** — `User.email`/`emailVerified` are typed
   optional (see §4b), so `AuthContext.test.ts:55`, `useAuth.test.ts:72` `fakeUser`,
   and `session-expiry-integration.test.tsx:49` `fakeUser` still compile.

> Implementer: after editing `createTestUser`, run the storage suite once to
> confirm the centralized fix covers the 27 dependents before hand-touching others.

## Non-Regression Guards (must hold after the change)

- **`ageConfirmed` is never hardcoded** to a literal in `LoginScreen.tsx`,
  `useAuth.ts`, `AuthContext.tsx`, or the request body. A test MUST assert the
  server rejects a payload with `ageConfirmed` missing/false even when email is valid.
- **`ageConfirmed` is never persisted** — not added to `createUser`, `InsertUser`
  usage, or the `users` table.
- **Login still works with username + password only** — `loginSchema` unchanged.
- **No raw `req.body` field access** in the register route — all via `parsed.data`.

## Error / conflict handling

- Duplicate username → `409 CONFLICT` (unchanged).
- Duplicate email → `409 CONFLICT` "Email already registered".
- Concurrent unique-violation race → `409 CONFLICT` generic.
- Invalid body (bad/missing email, missing `ageConfirmed`) → `400 VALIDATION_ERROR`
  via `formatZodError(parsed.error)`.
- **All** register failures render the static "Registration failed. Please try
  again." via `getAuthErrorMessage` — no field-level enumeration.
- `no-error-message-in-ui` preserved (branch on `ApiError.code`).

## Migration plan (serial DDL — own batch)

Declarative `db:push` cannot add a `NOT NULL`-without-default column to a non-empty
table, and cannot "backfill then push" in one step. Both DBs hold only disposable
pre-launch test accounts, so:

**Path A (chosen — simplest):**

1. Add the two columns to `shared/schema.ts`.
2. **Dev (`nutricam`):** `psql $DATABASE_URL -c "SELECT count(*) FROM users;"` to
   confirm only test rows, then delete them (cascades clean via existing FK
   `onDelete: cascade`): `DELETE FROM users;`. Run `npm run db:push` → creates
   `email NOT NULL UNIQUE` + `email_verified` on the now-empty table.
3. **Re-seed dev:** recreate the `demo`/`demo123` account _with an email_ (update
   `seed-recipes.ts` / demo seeding) so local + Vitest logins work.
4. **Prod (Railway):** verify `DATABASE_URL` → prod, `SELECT count(*), array_agg(username) FROM users;`
   to confirm all rows are test accounts, review the `db:push` diff, then the same
   delete → push. DB/DDL is DB-serial; this owns its batch.

**Path B (fallback — only if a row must be preserved):** add `email` nullable →
push → backfill unique placeholders (`<id>@legacy.invalid`) + set `emailVerified`
→ change schema to `.notNull()` → push again.

## Testing (required files — all must be updated/added)

- **`server/routes/__tests__/auth.test.ts`** (real-module preferred — auth is
  historically fragile): register persists `email`; duplicate email → 409;
  **register with missing/false `ageConfirmed` still 400 even with a valid email**
  (attestation non-regression); existing username conflict still 409; login
  unaffected; response body includes `email` + `emailVerified`.
- **`server/routes/__tests__/_helpers.test.ts`**: `formatZodError` output for a
  register validation failure is shaped as expected (covers the new safeParse path).
- **`server/storage/__tests__/users.test.ts`**: `getUserByEmail` returns row /
  `undefined`, excludes password (`SafeUser`); the `createUser` test passes `email`.
- **`client/hooks/__tests__/useAuth.test.ts`**: `register` sends `email` in the body
  and threads `ageConfirmed` as passed (asserts the literal value isn't forced).
- **`client/screens/__tests__/LoginScreen-utils.test.ts`**: `validateAuthForm` email
  rules (empty, malformed, valid; login mode ignores email). Update the
  `validRegister` fixture to include `email`.
- **`client/screens/__tests__/LoginScreen.test.tsx`**: register mode shows the Email
  field with correct a11y + keyboard props; login mode does not; submit passes live `ageConfirmed`.
- **Fixture sweep (above):** `test/db-test-utils.ts` `createTestUser` gains a unique
  `email` default; the 2 direct `.insert(users)` tests get `email`. Run the full
  storage suite to confirm the 27 dependents pass.
- **Regression:** all PR #399 tests still pass; the broad DB-touching suite (not just
  the named files) is green — the `NOT NULL` ripple is the failure mode to watch.

## Out of scope (→ separate spec)

- **Email verification via Resend** (`todos/P2-2026-06-18-email-verification-resend.md`).
- Password reset; switching login to accept email.

## Security notes

- Registration/validation is in the **NEVER-delegate** set — implemented directly.
- Server re-validates with zero trust (now via `safeParse`); client validation is UX only.
- Conflict path does not leak existence beyond the existing username path (generic UI copy).
