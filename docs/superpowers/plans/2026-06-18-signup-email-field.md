# Signup Email Field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **NEVER-DELEGATE:** This touches the auth register route + validation. Per project CLAUDE.md it must be implemented directly by Claude (not a cheap worker / Copilot). If executed via subagents, they are Claude subagents only.

**Goal:** Collect a required, unique, normalized email address at signup (login stays username + password), with a forward-compatible `emailVerified` column for later verification.

**Architecture:** Add `email` (`NOT NULL UNIQUE`) + `emailVerified` (`boolean default false`) columns to `users`. Thread `email` through the three hand-synced validation layers (`registerSchema` → `validateAuthForm` → the form) and the client `register` signature, keeping the COPPA `ageConfirmed` attestation threaded as live state. Convert the register route's body validation to `safeParse` (rule compliance). Verification is deferred to a separate spec.

**Tech Stack:** Drizzle ORM + PostgreSQL, Zod 3.25.76, Express 5, React Native (Expo), Vitest, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-06-18-signup-email-field-design.md`

## Global Constraints

- **Email column:** `email: text("email").notNull().unique()` — required, unique.
- **Verification column (groundwork, ungated):** `emailVerified: boolean("email_verified").default(false).notNull()`.
- **Normalization:** server normalizes via `z.string().trim().toLowerCase().email(...).max(254)` (zod 3.25.76 supports chained `.trim()`/`.toLowerCase()`).
- **Request-body validation:** the register route MUST use `registerSchema.safeParse(req.body)` (not `.parse()`) — `docs/rules/api.md:6`, `docs/rules/security.md:12`. Error path: `sendError(res, 400, formatZodError(parsed.error), ErrorCode.VALIDATION_ERROR)`.
- **`ageConfirmed`:** stays threaded as live state end-to-end; NEVER hardcoded to a literal; validated by `z.literal(true)`; NEVER persisted to the DB.
- **Client `User` contract:** `email?`/`emailVerified?` typed OPTIONAL in `shared/types/auth.ts` (lenient consumer, `typescript.md:10`); server `serializeUser` always returns both (runtime-guaranteed, asserted in tests).
- **Final register arg order (fixed):** `register(username, password, email, ageConfirmed)`.
- **Conflict copy:** duplicate email → `409` "Email already registered"; UI stays generic ("Registration failed.") — no enumeration.
- **`no-error-message-in-ui`:** never render raw server body; branch on `ApiError.code`.

---

### Task 1: Server foundation — schema, migration, fixtures, required-email registration

The compile-coupled core: adding `email` as `NOT NULL` makes it **required in `InsertUser`**, so every `createUser`/`insert(users)` site and both user factories must supply it simultaneously, the migration must run (Vitest hits the real `nutricam` DB), and `registerSchema` must provide `validated.email`. Also converts the route to `safeParse`.

**Files:**

- Modify: `shared/schema.ts` (`users` table, ~line 33)
- Modify: `server/routes/_schemas.ts` (`registerSchema`, ~line 28)
- Modify: `server/routes/auth.ts` (`register` handler `:62-102`; import `formatZodError`)
- Modify: `test/db-test-utils.ts` (`createTestUser` defaults, `:193`)
- Modify: `server/__tests__/factories/user.ts` (`createMockUser` / default user, `:5`,`:28`)
- Modify: `server/storage/__tests__/nutrition.concurrent.test.ts:40` (direct `.insert(users)`)
- Modify: `server/storage/__tests__/verification.concurrent.test.ts:53` (direct `.insert(users)`)
- Modify: `server/scripts/seed-recipes.ts` (demo user insert, `:240-242`)
- Test: `server/routes/__tests__/auth.test.ts` (register suite)

**Interfaces:**

- Produces: `users.email: string`, `users.emailVerified: boolean` columns; `InsertUser` now requires `email`. `registerSchema` output gains `email: string` (normalized). Register route persists `email`; rejects invalid bodies with `400 VALIDATION_ERROR` via `safeParse`.

- [ ] **Step 1: Add the columns to the schema**

In `shared/schema.ts`, in the `users` `pgTable`, immediately after the `username` line (`:33`):

```ts
    username: text("username").notNull().unique(),
    email: text("email").notNull().unique(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    password: text("password").notNull(),
```

(`boolean` is already imported — used by `onboardingCompleted`.)

- [ ] **Step 2: Update both user factories + direct inserts + the seed (compile-forced)**

`test/db-test-utils.ts` — in `createTestUser` `defaults` (`:193`), add a unique email beside the unique username:

```ts
const defaults: schema.InsertUser = {
  username: `testuser_${userSeq}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
  email: `testuser_${userSeq}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}@test.invalid`,
  password: "hashed_password_placeholder",
  ...overrides,
};
```

`server/__tests__/factories/user.ts` — in the base mock user object (`:5`), add:

```ts
  username: "testuser",
  email: "testuser@example.com",
  emailVerified: false,
```

`server/storage/__tests__/nutrition.concurrent.test.ts:40` and `verification.concurrent.test.ts:53` — add a unique `email` to each `.insert(users).values({ ... })` (e.g. `email: \`concurrent*${Date.now()}*${Math.random().toString(36).slice(2)}@test.invalid\``; if the file forbids `Math.random`, reuse its existing unique-username expression with an `@test.invalid` suffix).

`server/scripts/seed-recipes.ts` — in the demo `.insert(users).values({ username: "demo", ... })` (`:240`), add `email: "demo@ocrecipes.test"`.

- [ ] **Step 3: Run the dev migration (Path A — delete disposable test rows, then push)**

```bash
psql postgresql://localhost/nutricam -c "SELECT count(*) FROM users;"   # confirm only test rows
psql postgresql://localhost/nutricam -c "DELETE FROM users;"            # cascades via existing FKs
npm run db:push                                                         # adds email NOT NULL UNIQUE + email_verified on empty table
```

Expected: `db:push` applies cleanly (no "column contains null values" error, because the table is empty).

- [ ] **Step 4: Recreate the demo account with an email**

```bash
npm run seed:recipes   # ensureDemoUser now writes demo@ocrecipes.test (slow ~1.5min, needs OpenAI)
```

If OpenAI/seed is unavailable locally, instead insert a demo row directly with a bcrypt hash of `demo123` and `email = 'demo@ocrecipes.test'` (the Vitest suite does not depend on the demo account — it uses `createTestUser` — so this only restores manual/simulator login).

- [ ] **Step 5: Add `email` to `registerSchema` + write the failing route tests**

In `server/routes/_schemas.ts`, `registerSchema` (`:28`), add the `email` field after `password`:

```ts
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address")
    .max(254),
```

In `server/routes/__tests__/auth.test.ts`: (a) add a valid `email` to **every existing** register-test payload (`:93`, `:109`, `:129`, and any later register payloads — otherwise `safeParse` 400s on the now-required email); (b) add these new tests:

```ts
it("persists the normalized email and rejects missing ageConfirmed", async () => {
  vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
  vi.mocked(storage.createUser).mockResolvedValue(mockUser);

  const res = await request(app).post("/api/auth/register").send({
    username: "newuser",
    password: "password123",
    email: "  NewUser@Example.COM ",
    ageConfirmed: true,
  });

  expect(res.status).toBe(201);
  expect(storage.createUser).toHaveBeenCalledWith(
    expect.objectContaining({ email: "newuser@example.com" }), // trimmed + lowercased
  );
});

it("returns 400 when ageConfirmed is missing even with a valid email", async () => {
  const res = await request(app).post("/api/auth/register").send({
    username: "newuser",
    password: "password123",
    email: "newuser@example.com",
    // ageConfirmed omitted
  });
  expect(res.status).toBe(400);
});

it("returns 400 for an invalid email", async () => {
  const res = await request(app).post("/api/auth/register").send({
    username: "newuser",
    password: "password123",
    email: "not-an-email",
    ageConfirmed: true,
  });
  expect(res.status).toBe(400);
});
```

- [ ] **Step 6: Run the new tests — verify they fail**

Run: `npm run test:run -- server/routes/__tests__/auth.test.ts`
Expected: FAIL — the persist/normalize test fails (route doesn't pass `email` to `createUser` yet); the invalid-email test may already pass via schema, the missing-ageConfirmed test already passes.

- [ ] **Step 7: Convert the route to `safeParse` and persist `email`**

In `server/routes/auth.ts`: import `formatZodError` from `./_helpers` (line `16` currently imports `handleRouteError`):

```ts
import { handleRouteError, formatZodError } from "./_helpers";
```

Replace the register handler's validation + createUser (`:63`,`:80-83`):

```ts
        const parsed = registerSchema.safeParse(req.body);
        if (!parsed.success) {
          sendError(res, 400, formatZodError(parsed.error), ErrorCode.VALIDATION_ERROR);
          return;
        }
        const validated = parsed.data;

        const existingUser = await storage.getUserByUsername(validated.username);
        // ...unchanged 409 block...

        const hashedPassword = await bcrypt.hash(validated.password, 12);
        let user;
        try {
          user = await storage.createUser({
            username: validated.username,
            password: hashedPassword,
            email: validated.email,
          });
```

(`ageConfirmed` is in `validated` but is NOT passed to `createUser` — attestation is never persisted.)

- [ ] **Step 8: Run the auth suite — verify green**

Run: `npm run test:run -- server/routes/__tests__/auth.test.ts`
Expected: PASS (all register tests, including the 3 new ones).

- [ ] **Step 9: Run the storage suite — verify the fixture sweep holds**

Run: `npm run test:run -- server/storage`
Expected: PASS — the `createTestUser` email default covers the 27 dependents; the 2 direct-insert files supply their own.

- [ ] **Step 10: Commit**

```bash
git add shared/schema.ts server/routes/_schemas.ts server/routes/auth.ts test/db-test-utils.ts server/__tests__/factories/user.ts server/storage/__tests__/nutrition.concurrent.test.ts server/storage/__tests__/verification.concurrent.test.ts server/scripts/seed-recipes.ts server/routes/__tests__/auth.test.ts
git commit -m "feat(auth): collect required email at signup (schema, validation, safeParse)"
```

---

### Task 2: Email uniqueness — `getUserByEmail` lookup + register pre-check

**Files:**

- Modify: `server/storage/users.ts` (add `getUserByEmail` after `getUserByUsername`, ~line 52)
- Modify: `server/storage/index.ts` (re-export `getUserByEmail`)
- Modify: `server/routes/auth.ts` (register handler — email pre-check after the username pre-check)
- Test: `server/storage/__tests__/users.test.ts`, `server/routes/__tests__/auth.test.ts`

**Interfaces:**

- Consumes: `users.email` column (Task 1).
- Produces: `storage.getUserByEmail(email: string): Promise<SafeUser | undefined>`. Register returns `409 CONFLICT` "Email already registered" on a pre-existing email.

- [ ] **Step 1: Write the failing storage test**

In `server/storage/__tests__/users.test.ts`, inside the existing transaction-based suite (mirror the `getUserByUsername` test):

```ts
it("getUserByEmail returns the user (without password) or undefined", async () => {
  const created = await createTestUser(tx, { email: "lookup@test.invalid" });
  const found = await usersStorage.getUserByEmail("lookup@test.invalid");
  expect(found?.id).toBe(created.id);
  expect(found).not.toHaveProperty("password");
  expect(
    await usersStorage.getUserByEmail("missing@test.invalid"),
  ).toBeUndefined();
});
```

(Use the same `tx`/storage import style already in this file.)

- [ ] **Step 2: Run it — verify it fails**

Run: `npm run test:run -- server/storage/__tests__/users.test.ts`
Expected: FAIL — `getUserByEmail` is not a function.

- [ ] **Step 3: Implement `getUserByEmail`**

In `server/storage/users.ts`, after `getUserByUsername` (`:52`):

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

Re-export it through `server/storage/index.ts` wherever `getUserByUsername` is exposed on the storage facade (mirror that line exactly).

- [ ] **Step 4: Run the storage test — verify green**

Run: `npm run test:run -- server/storage/__tests__/users.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing route test (duplicate email → 409)**

In `server/routes/__tests__/auth.test.ts`: add `getUserByEmail: vi.fn()` to the storage mock object (`:28-39`). Default the new mock to `undefined` in the existing register tests' `beforeEach`/setup so they still create users (add `vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined)` alongside the existing `getUserByUsername` default). Then:

```ts
it("returns 409 if the email is already registered", async () => {
  vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
  vi.mocked(storage.getUserByEmail).mockResolvedValue(mockUser);

  const res = await request(app).post("/api/auth/register").send({
    username: "newuser",
    password: "password123",
    email: "taken@example.com",
    ageConfirmed: true,
  });

  expect(res.status).toBe(409);
  expect(res.body.error).toBe("Email already registered");
});
```

- [ ] **Step 6: Run it — verify it fails**

Run: `npm run test:run -- server/routes/__tests__/auth.test.ts -t "email is already registered"`
Expected: FAIL (route has no email pre-check; returns 201).

- [ ] **Step 7: Add the pre-check to the register handler**

In `server/routes/auth.ts`, after the username 409 block and before `bcrypt.hash`:

```ts
const existingEmail = await storage.getUserByEmail(validated.email);
if (existingEmail) {
  return sendError(res, 409, "Email already registered", ErrorCode.CONFLICT);
}
```

- [ ] **Step 8: Run the auth suite — verify green**

Run: `npm run test:run -- server/routes/__tests__/auth.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add server/storage/users.ts server/storage/index.ts server/routes/auth.ts server/storage/__tests__/users.test.ts server/routes/__tests__/auth.test.ts
git commit -m "feat(auth): reject duplicate email at signup (getUserByEmail + pre-check)"
```

---

### Task 3: Auth response contract — `serializeUser` + shared `User` type

**Files:**

- Modify: `server/routes/auth.ts` (`serializeUser`, `:35-55`)
- Modify: `shared/types/auth.ts` (`User` interface, `:8`)
- Test: `server/routes/__tests__/auth.test.ts`

**Interfaces:**

- Produces: every auth response's `user` includes `email: string` + `emailVerified: boolean`. Client `User` gains optional `email?`/`emailVerified?`.

- [ ] **Step 1: Write the failing response-shape test**

In `server/routes/__tests__/auth.test.ts`, extend the "creates a new user" test (or add one) to assert the response carries both fields. Ensure `mockUser` (via `createMockUser`, updated in Task 1) has `email: "testuser@example.com"`, `emailVerified: false`:

```ts
it("returns email and emailVerified in the auth response", async () => {
  vi.mocked(storage.getUserByUsername).mockResolvedValue(undefined);
  vi.mocked(storage.getUserByEmail).mockResolvedValue(undefined);
  vi.mocked(storage.createUser).mockResolvedValue(mockUser);

  const res = await request(app).post("/api/auth/register").send({
    username: "newuser",
    password: "password123",
    email: "newuser@example.com",
    ageConfirmed: true,
  });

  expect(res.body.user).toMatchObject({
    email: "testuser@example.com",
    emailVerified: false,
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `npm run test:run -- server/routes/__tests__/auth.test.ts -t "email and emailVerified"`
Expected: FAIL — `serializeUser` doesn't return those fields.

- [ ] **Step 3: Update `serializeUser`**

In `server/routes/auth.ts`, add to BOTH the input type and the returned object:

```ts
function serializeUser(user: {
  id: string;
  username: string;
  email: string;
  emailVerified: boolean;
  displayName: string | null;
  avatarUrl: string | null;
  dailyCalorieGoal: number | null;
  onboardingCompleted: boolean | null;
  subscriptionTier: string | null;
  measurementUnit: MeasurementUnit;
}) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    dailyCalorieGoal: user.dailyCalorieGoal,
    onboardingCompleted: user.onboardingCompleted,
    subscriptionTier: user.subscriptionTier || "free",
    measurementUnit: user.measurementUnit,
  };
}
```

- [ ] **Step 4: Update the shared client `User` type**

In `shared/types/auth.ts`, `User` interface (`:8`), add after `username`:

```ts
  email?: string;
  emailVerified?: boolean;
```

- [ ] **Step 5: Run the auth suite + typecheck — verify green**

Run: `npm run test:run -- server/routes/__tests__/auth.test.ts`
Expected: PASS.
Run: `npm run check:types`
Expected: 0 errors (all four `serializeUser` call sites pass full `User`/`SafeUser` rows that carry the new columns).

- [ ] **Step 6: Commit**

```bash
git add server/routes/auth.ts shared/types/auth.ts server/routes/__tests__/auth.test.ts
git commit -m "feat(auth): include email + emailVerified in auth response contract"
```

---

### Task 4: Client validation — `validateAuthForm` email rule

**Files:**

- Modify: `client/screens/LoginScreen-utils.ts` (`AuthFormInput`, `validateAuthForm`)
- Test: `client/screens/__tests__/LoginScreen-utils.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `AuthFormInput` gains `email: string`; `validateAuthForm` returns an email error string in register mode for empty/malformed email, `null` when valid; login mode ignores email.

- [ ] **Step 1: Write the failing tests**

In `client/screens/__tests__/LoginScreen-utils.test.ts`, first add `email: "chef@example.com"` to the shared `validRegister` fixture (`:8` area). Then:

```ts
it("rejects a register with a missing email", () => {
  expect(validateAuthForm({ ...validRegister, email: "" })).toBe(
    "Please enter your email address",
  );
});

it("rejects a register with a malformed email", () => {
  expect(validateAuthForm({ ...validRegister, email: "nope" })).toBe(
    "Please enter a valid email address",
  );
});

it("accepts a register with a valid email", () => {
  expect(
    validateAuthForm({ ...validRegister, email: "chef@example.com" }),
  ).toBeNull();
});

it("ignores email in login mode", () => {
  expect(
    validateAuthForm({
      mode: "login",
      username: "chef_tony",
      password: "pw",
      confirmPassword: "",
      ageConfirmed: false,
      email: "",
    }),
  ).toBeNull();
});
```

- [ ] **Step 2: Run them — verify they fail**

Run: `npm run test:run -- client/screens/__tests__/LoginScreen-utils.test.ts`
Expected: FAIL — `AuthFormInput` has no `email`; no email rule.

- [ ] **Step 3: Add `email` to `AuthFormInput` and the email rule**

In `client/screens/LoginScreen-utils.ts`, add to `AuthFormInput` (`:38`):

```ts
email: string;
```

Add the pattern constant near the others (`:30`):

```ts
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // client mirror of registerSchema.email
```

In `validateAuthForm`, in the register-only block (after the username rules, before password), add:

```ts
const email = input.email.trim();
if (!email) {
  return "Please enter your email address";
}
if (!EMAIL_PATTERN.test(email)) {
  return "Please enter a valid email address";
}
```

- [ ] **Step 4: Run the tests — verify green**

Run: `npm run test:run -- client/screens/__tests__/LoginScreen-utils.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/screens/LoginScreen-utils.ts client/screens/__tests__/LoginScreen-utils.test.ts
git commit -m "feat(auth): client-side email validation in validateAuthForm"
```

---

### Task 5: Client wiring — `register` signature threads email

**Files:**

- Modify: `client/hooks/useAuth.ts` (`register`, `:149-167`)
- Modify: `client/context/AuthContext.tsx` (`register` type, `:10-14`)
- Test: `client/hooks/__tests__/useAuth.test.ts`

**Interfaces:**

- Consumes: nothing new.
- Produces: `register(username, password, email, ageConfirmed)` posting `{ username, password, email, ageConfirmed }`.

- [ ] **Step 1: Write the failing test**

In `client/hooks/__tests__/useAuth.test.ts`, in the register test (`:408` area), update the call to `register("newuser", "password123", "new@example.com", true)` and assert the request body:

```ts
expect(apiRequest).toHaveBeenCalledWith("POST", "/api/auth/register", {
  username: "newuser",
  password: "password123",
  email: "new@example.com",
  ageConfirmed: true,
});
```

(Match the existing `apiRequest` mock assertion style in this file; if it asserts via `mock.calls`, mirror that.)

- [ ] **Step 2: Run it — verify it fails**

Run: `npm run test:run -- client/hooks/__tests__/useAuth.test.ts`
Expected: FAIL — `register` arity/body don't include email.

- [ ] **Step 3: Update `useAuth.register`**

In `client/hooks/useAuth.ts` (`:150-157`):

```ts
  const register = useCallback(
    async (username: string, password: string, email: string, ageConfirmed: boolean) => {
      const response = await apiRequest("POST", "/api/auth/register", {
        username,
        password,
        email,
        // COPPA 13+ age attestation — caller forwards user's actual checkbox
        // state; server enforces with `z.literal(true)` (zero trust on client).
        ageConfirmed,
      });
```

- [ ] **Step 4: Update the `AuthContext` register type**

In `client/context/AuthContext.tsx` (`:10-14`):

```ts
register: (
  username: string,
  password: string,
  email: string,
  ageConfirmed: boolean,
) => Promise<User>;
```

- [ ] **Step 5: Run the hook test — verify green**

Run: `npm run test:run -- client/hooks/__tests__/useAuth.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client/hooks/useAuth.ts client/context/AuthContext.tsx client/hooks/__tests__/useAuth.test.ts
git commit -m "feat(auth): thread email through register hook + context"
```

---

### Task 6: LoginScreen — Email input field

**Files:**

- Modify: `client/screens/LoginScreen.tsx` (state `:48`, form `:168`, `handleSubmit` `:75`/`:93`)
- Test: `client/screens/__tests__/LoginScreen.test.tsx`

**Interfaces:**

- Consumes: `register(username, password, email, ageConfirmed)` (Task 5); `validateAuthForm` email rule (Task 4).

- [ ] **Step 1: Write the failing render + submit tests**

In `client/screens/__tests__/LoginScreen.test.tsx` (mirror existing register-mode tests; switch to register mode first):

```ts
it("shows the email field in register mode with email keyboard", () => {
  const { getByTestId, queryByTestId } = render(<LoginScreen />);
  fireEvent.press(getByTestId("toggle-auth-mode")); // switch to register (match existing toggle testID)
  const email = getByTestId("input-email");
  expect(email).toBeTruthy();
  expect(email.props.keyboardType).toBe("email-address");
  expect(email.props.autoCapitalize).toBe("none");
});

it("does not show the email field in login mode", () => {
  const { queryByTestId } = render(<LoginScreen />);
  expect(queryByTestId("input-email")).toBeNull();
});
```

(Use the actual mode-toggle testID from the file — see `:105` `toggle`/`setMode` handler; if it has no testID, add `testID="toggle-auth-mode"` to that control.)

- [ ] **Step 2: Run them — verify they fail**

Run: `npm run test:run -- client/screens/__tests__/LoginScreen.test.tsx`
Expected: FAIL — no `input-email`.

- [ ] **Step 3: Add email state**

In `client/screens/LoginScreen.tsx`, beside the other auth state (`:48`):

```ts
const [email, setEmail] = useState("");
```

- [ ] **Step 4: Add the Email TextInput (register mode), after the Username input (`:168`)**

```tsx
{
  mode === "register" ? (
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
      testID="input-email"
      accessibilityLabel="Email"
      accessibilityHint="Enter your email address"
    />
  ) : null;
}
```

Verify the custom `TextInput` wrapper forwards `keyboardType`/`textContentType`/`autoComplete` to the underlying RN `TextInput` (it spreads `...rest` for the other inputs); if it whitelists props, add these to its passthrough.

- [ ] **Step 5: Thread email into validation + submit**

In `handleSubmit` (`:75`), add `email` to the `validateAuthForm({ ... })` object. At the register call (`:93`):

```ts
await register(username.trim(), password, email.trim(), ageConfirmed);
```

- [ ] **Step 6: Run the screen tests — verify green**

Run: `npm run test:run -- client/screens/__tests__/LoginScreen.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/screens/LoginScreen.tsx client/screens/__tests__/LoginScreen.test.tsx
git commit -m "feat(auth): add email input to signup form"
```

---

## Production migration (post-merge, ops — gated on user confirmation)

Not part of the test cycle. Run AFTER the PR merges, with the user's go-ahead (the spec's approved Path A):

```bash
# Point at prod and confirm only test accounts exist:
railway run psql "$DATABASE_URL" -c "SELECT count(*), array_agg(username) FROM users;"
# After confirming all rows are disposable test accounts + reviewing the db:push diff:
railway run psql "$DATABASE_URL" -c "DELETE FROM users;"
DATABASE_URL=<prod> npm run db:push
```

Fallback (Path B — only if a row must be preserved): add `email` nullable → push → backfill `<id>@legacy.invalid` + set `emailVerified` → change schema to `.notNull()` → push again.

## Final verification (after all tasks)

```bash
npm run test:run     # full suite green; watch the broad DB-touching suite (NOT NULL ripple)
npm run check:types  # 0 errors
npm run lint         # 0 errors
```

Then `/codify` any novel patterns and open the PR.

## Self-Review (author checklist — done)

- **Spec coverage:** schema+emailVerified (T1), normalization+safeParse (T1), getUserByEmail+pre-check (T2), serializeUser+shared type (T3), validateAuthForm (T4), useAuth/AuthContext (T5), LoginScreen (T6), fixture sweep (T1), migration (T1 dev + ops section prod), ageConfirmed non-regression (T1 test). All spec sections map to a task.
- **Placeholder scan:** every code step has concrete code; the two "verify the wrapper/toggle testID" notes are explicit verification instructions with a defined fallback, not vague TODOs.
- **Type consistency:** `register(username, password, email, ageConfirmed)` identical in T5 (useAuth/AuthContext) and T6 (LoginScreen call); `getUserByEmail(email): Promise<SafeUser | undefined>` consistent T2↔usage; `email`/`emailVerified` names consistent across schema, serializeUser, shared type, factories.
