# Password policy — PR 1 (rule, hashing, breach check, reset, disable) Implementation Plan

> **Execution:** superpowers:executing-plans, in-session only (`/todo-fast` Step 2b gate override; auth work is never delegated to implementer subagents). Review roster at the final head. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every new password follows one shared rule (15 characters, or 8 on a two-step account; no composition rule; breached passwords refused), every character of a password counts, and turning two-step off can no longer leave a short password-only account.

**Architecture:** A pure policy module in `shared/constants/` is imported by server and client. The server gains a hashing facade (`pv2$` pre-hash before bcrypt, legacy hashes still verify and are upgraded by compare-and-swap at sign-in) and a fail-open HIBP range check. Register, reset and MFA-disable apply the state-dependent minimum where the account state is known. The client mirrors the rule from the same module and shows static copy for the new error codes.

**Tech Stack:** TypeScript, Express, zod 3, Drizzle/PostgreSQL, bcrypt 6.0.0, node:crypto, Vitest + supertest, React Native (Expo).

**Spec:** `docs/superpowers/specs/2026-10-10-password-policy-design.md` (rev 3). PR 1 scope = spec §9 "PR 1". The upgrade pass, the sign-up switch and the sign-in gate (§5.2, §6) are PR 2 and are **not** in this plan.

## Global Constraints

- Length = `[...pw.normalize("NFC")].length` everywhere; never `.length`.
- `PASSWORD_MIN_SINGLE_FACTOR = 15`, `PASSWORD_MIN_WITH_MFA = 8`, `PASSWORD_MAX = 128`. No composition rule.
- PR 1 sign-up minimum is **15** (no switch; copy names only the 15 rule).
- Stored hash for new passwords: `"pv2$" + bcrypt.hash(base64(sha256(NFC pw)), 12)`. Legacy `$2b$` hashes keep verifying.
- Breach check: only the first 5 hex chars of the SHA-1 leave the server; `Add-Padding: true`; 3000 ms timeout; fail open; never log password material.
- Client shows static copy per `ApiError.code`; never `error.message` (`ocrecipes/no-error-message-in-ui`).
- Error codes: `PASSWORD_TOO_SHORT`, `PASSWORD_UPGRADE_NEEDED`, `PASSWORD_BREACHED` (`UPGRADE_PASS_EXPIRED` is PR 2).
- Commits: lint-staged only; never `--no-verify`. Commit messages via a file in the scratchpad and `git commit -F`. Inside the worktree use `/usr/bin/git`.
- **Deviation from spec §5.4, adopted here:** the disable route checks the password length **before** `requireFactor`, so a policy rejection never consumes a recovery code (see `docs/solutions/logic-errors/spent-single-use-credential-replacement-lost-on-error-paths-2026-10-10.md`). Task 9 updates the spec to match.

## Review Focus

1. A password whose 72nd byte falls inside a multibyte character (e.g. 71 ASCII + "é") — must round-trip through `hashPassword`/`passwordMatches` and must not match a password differing only after byte 72. → Task 2 test.
2. A decomposed "é" typed on one device and composed "é" on another — must verify as the same password (NFC before hashing and before length). → Task 2 test.
3. Reset with a correct code and a breached password — code must stay usable; the next attempt with a good password succeeds. → Task 6 test.
4. Disable with a recovery code as the factor and a short current password but no `newPassword` — must return `PASSWORD_UPGRADE_NEEDED` without consuming the recovery code. → Task 7 test.
5. HIBP returning a body with Windows `\r\n` line endings and padded `:0` rows — must still detect a real hit and ignore padding. → Task 4 test.

---

### Task 1: The shared password policy

**Files:**

- Create: `shared/constants/password-policy.ts`
- Test: `shared/constants/__tests__/password-policy.test.ts`

**Interfaces:**

- Produces:
  - `passwordLength(pw: string): number`
  - `PASSWORD_MIN_SINGLE_FACTOR = 15`, `PASSWORD_MIN_WITH_MFA = 8`, `PASSWORD_MAX = 128`
  - `type PasswordProblem = "too_short" | "too_long"`
  - `newPasswordProblem(pw: string, opts: { min: number }): PasswordProblem | null`
  - `type PasswordContext = "signup" | "mfa" | "single_factor"`
  - `passwordMessage(problem: PasswordProblem, context: PasswordContext): string`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import {
  passwordLength,
  newPasswordProblem,
  passwordMessage,
  PASSWORD_MIN_SINGLE_FACTOR,
  PASSWORD_MIN_WITH_MFA,
  PASSWORD_MAX,
} from "../password-policy";

describe("passwordLength", () => {
  it("counts code points, not UTF-16 units", () => {
    expect("😀".length).toBe(2);
    expect(passwordLength("😀")).toBe(1);
  });
  it("normalizes to NFC first, so decomposed and composed é are equal", () => {
    expect(passwordLength("é")).toBe(1);
    expect(passwordLength("é")).toBe(1);
  });
});

describe("newPasswordProblem", () => {
  it.each([
    [14, PASSWORD_MIN_SINGLE_FACTOR, "too_short"],
    [15, PASSWORD_MIN_SINGLE_FACTOR, null],
    [7, PASSWORD_MIN_WITH_MFA, "too_short"],
    [8, PASSWORD_MIN_WITH_MFA, null],
    [128, PASSWORD_MIN_WITH_MFA, null],
    [129, PASSWORD_MIN_WITH_MFA, "too_long"],
  ] as const)("%i chars with min %i → %s", (n, min, want) => {
    expect(newPasswordProblem("a".repeat(n), { min })).toBe(want);
  });
  it("has no composition rule: 15 letters only is fine", () => {
    expect(newPasswordProblem("abcdefghijklmno", { min: 15 })).toBeNull();
  });
  it("counts an emoji as one character at the boundary", () => {
    expect(newPasswordProblem("a".repeat(14) + "😀", { min: 15 })).toBeNull();
  });
});

describe("passwordMessage", () => {
  it("one sentence per context", () => {
    expect(passwordMessage("too_short", "signup")).toBe(
      "Use at least 15 characters.",
    );
    expect(passwordMessage("too_short", "single_factor")).toBe(
      "Use at least 15 characters.",
    );
    expect(passwordMessage("too_short", "mfa")).toBe(
      "Use at least 8 characters.",
    );
    expect(passwordMessage("too_long", "signup")).toBe(
      "Use at most 128 characters.",
    );
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run shared/constants/__tests__/password-policy.test.ts`
Expected: FAIL — cannot resolve `../password-policy`.

- [ ] **Step 3: Implement**

```ts
/**
 * The one password rule (spec docs/superpowers/specs/2026-10-10-password-policy-design.md §2),
 * imported by server and client. SP 800-63B-4: 15 characters for a password
 * used alone, 8 when it is one of two factors; no composition rules; length
 * is counted in code points after NFC.
 */
export const PASSWORD_MIN_SINGLE_FACTOR = 15;
export const PASSWORD_MIN_WITH_MFA = 8;
export const PASSWORD_MAX = 128;

export type PasswordProblem = "too_short" | "too_long";
/** signup = PR 1 sign-up (15 only); mfa = two-step on; single_factor = two-step off. */
export type PasswordContext = "signup" | "mfa" | "single_factor";

export function passwordLength(pw: string): number {
  return [...pw.normalize("NFC")].length;
}

export function newPasswordProblem(
  pw: string,
  opts: { min: number },
): PasswordProblem | null {
  const n = passwordLength(pw);
  if (n < opts.min) return "too_short";
  if (n > PASSWORD_MAX) return "too_long";
  return null;
}

export function passwordMessage(
  problem: PasswordProblem,
  context: PasswordContext,
): string {
  if (problem === "too_long") return `Use at most ${PASSWORD_MAX} characters.`;
  return context === "mfa"
    ? `Use at least ${PASSWORD_MIN_WITH_MFA} characters.`
    : `Use at least ${PASSWORD_MIN_SINGLE_FACTOR} characters.`;
}
```

- [ ] **Step 4: Run it to verify it passes** — same command, expected PASS.

- [ ] **Step 5: Commit** — `feat(shared): one password policy, counted in code points`.

---

### Task 2: Hashing facade (`pv2$`) and the compare chokepoint

**Files:**

- Create: `server/lib/password-hash.ts`
- Modify: `server/lib/password-check.ts`
- Test: `server/lib/__tests__/password-hash.test.ts`, `server/lib/__tests__/password-check.test.ts`

**Interfaces:**

- Produces: `hashPassword(pw: string): Promise<string>`; `PASSWORD_HASH_PREFIX = "pv2$"`; `isLegacyHash(hash: string): boolean`; `passwordMatches(input, hash)` (unchanged signature, now prefix-aware).

- [ ] **Step 1: Write the failing tests** (`password-hash.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import bcrypt from "bcrypt";
import {
  hashPassword,
  isLegacyHash,
  PASSWORD_HASH_PREFIX,
} from "../password-hash";
import { passwordMatches, DUMMY_PASSWORD_HASH } from "../password-check";

describe("hashPassword / passwordMatches", () => {
  it("round-trips and carries the version prefix", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith(PASSWORD_HASH_PREFIX)).toBe(true);
    expect(isLegacyHash(h)).toBe(false);
    expect(await passwordMatches("correct horse battery", h)).toBe(true);
    expect(await passwordMatches("correct horse batterz", h)).toBe(false);
  });

  it("every character counts past 72 bytes (bcrypt alone would truncate)", async () => {
    const base = "a".repeat(80);
    const h = await hashPassword(base);
    expect(Buffer.byteLength(base, "utf8") > 72).toBe(true);
    expect(await passwordMatches(base.slice(0, 79) + "b", h)).toBe(false);
  });

  it("a multibyte character straddling byte 72 still round-trips", async () => {
    const pw = "a".repeat(71) + "é" + "tail";
    const h = await hashPassword(pw);
    expect(await passwordMatches(pw, h)).toBe(true);
    expect(await passwordMatches("a".repeat(71) + "é" + "tall", h)).toBe(false);
  });

  it("decomposed and composed é verify as the same password", async () => {
    const h = await hashPassword("café au lait please");
    expect(await passwordMatches("café au lait please", h)).toBe(true);
  });

  it("legacy bcrypt hashes still verify", async () => {
    const legacy = await bcrypt.hash("old-password-1", 4);
    expect(isLegacyHash(legacy)).toBe(true);
    expect(await passwordMatches("old-password-1", legacy)).toBe(true);
  });

  it("the dummy hash stays cost 12, the same as new hashes", async () => {
    const h = await hashPassword("x".repeat(20));
    expect(bcrypt.getRounds(DUMMY_PASSWORD_HASH)).toBe(12);
    expect(bcrypt.getRounds(h.slice(PASSWORD_HASH_PREFIX.length))).toBe(12);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run server/lib/__tests__/password-hash.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `server/lib/password-hash.ts`

```ts
import crypto from "node:crypto";
import bcrypt from "bcrypt";

/**
 * bcrypt 6 silently ignores input past 72 bytes. New passwords are condensed
 * to a 44-byte base64 SHA-256 first, so every character counts and no NUL
 * byte reaches bcrypt. The prefix marks the scheme; unprefixed hashes are
 * legacy and verify the old way. Spec §3.
 */
export const PASSWORD_HASH_PREFIX = "pv2$";
const COST = 12;

export function preHash(pw: string): string {
  return crypto
    .createHash("sha256")
    .update(pw.normalize("NFC"), "utf8")
    .digest("base64");
}

export async function hashPassword(pw: string): Promise<string> {
  return PASSWORD_HASH_PREFIX + (await bcrypt.hash(preHash(pw), COST));
}

export function isLegacyHash(hash: string): boolean {
  return !hash.startsWith(PASSWORD_HASH_PREFIX);
}
```

Modify `server/lib/password-check.ts` `passwordMatches`:

```ts
import { isLegacyHash, preHash, PASSWORD_HASH_PREFIX } from "./password-hash";
// …
if (hash === null) {
  await bcrypt.compare(input, DUMMY_PASSWORD_HASH);
  return false;
}
if (isLegacyHash(hash)) return bcrypt.compare(input, hash);
return bcrypt.compare(preHash(input), hash.slice(PASSWORD_HASH_PREFIX.length));
```

- [ ] **Step 4: Run** `password-hash.test.ts` and the existing `password-check.test.ts` — expected PASS.

- [ ] **Step 5: Commit** — `feat(server): pv2 password hashing — every character counts`.

---

### Task 3: Compare-and-swap rehash at sign-in

**Files:**

- Modify: `server/storage/users.ts` (add `upgradePasswordHash`), `server/storage/index.ts` (export it on `storage` the way the file's other user functions are exported), `server/routes/auth.ts` (login handler, after `isValidPassword`)
- Test: `server/storage/__tests__/users-upgrade-password-hash.test.ts` (real DB via `test/db-test-utils`, like the existing storage tests), `server/routes/__tests__/auth.test.ts`

**Interfaces:**

- Consumes: `hashPassword`, `isLegacyHash` (Task 2).
- Produces: `storage.upgradePasswordHash(userId: string, expectedHash: string, newHash: string): Promise<boolean>`.

- [ ] **Step 1: Write the failing storage test**

```ts
it("swaps only when the stored hash is still the one that was checked", async () => {
  const user = await createTestUser({ password: "LEGACY_HASH" });
  expect(await upgradePasswordHash(user.id, "LEGACY_HASH", "pv2$new")).toBe(
    true,
  );
  expect((await getUser(user.id))?.password).toBe("pv2$new");
});

it("loses to a concurrent change: never restores the old password", async () => {
  const user = await createTestUser({ password: "LEGACY_HASH" });
  await db
    .update(users)
    .set({ password: "pv2$reset" })
    .where(eq(users.id, user.id));
  expect(await upgradePasswordHash(user.id, "LEGACY_HASH", "pv2$rehash")).toBe(
    false,
  );
  expect((await getUser(user.id))?.password).toBe("pv2$reset");
});
```

(Use the helper names the neighbouring `server/storage/__tests__/*.test.ts` files use for creating a user and reading it back.)

- [ ] **Step 2: Run to verify it fails** — `npx vitest run server/storage/__tests__/users-upgrade-password-hash.test.ts`; expected FAIL (not exported).

- [ ] **Step 3: Implement**

```ts
/**
 * Upgrade a legacy hash to pv2 after a successful legacy sign-in. Compare-and-
 * swap on the hash that was checked: a reset or password change that committed
 * in between wins, and the old password is never written back. Spec §3.
 */
export async function upgradePasswordHash(
  userId: string,
  expectedHash: string,
  newHash: string,
): Promise<boolean> {
  const rows = await db
    .update(users)
    .set({ password: newHash })
    .where(and(eq(users.id, userId), eq(users.password, expectedHash)))
    .returning({ id: users.id });
  return rows.length === 1;
}
```

Login route, right after the `isValidPassword` check passes:

```ts
// Legacy hash → pv2, best effort. Only when the input is ≤72 bytes: a
// legacy compare proves just the first 72, so a longer input may not
// be the password the user really types (spec §3).
if (
  user.password !== null &&
  isLegacyHash(user.password) &&
  Buffer.byteLength(validated.password, "utf8") <= 72
) {
  const legacy = user.password;
  fireAndForget(
    "rehash-password",
    hashPassword(validated.password).then((h) =>
      storage.upgradePasswordHash(user.id, legacy, h),
    ),
  );
}
```

- [ ] **Step 4: Route tests.** First, `grep -rln '/api/auth/login' server/routes/__tests__ test/integration` and add `upgradePasswordHash: vi.fn().mockResolvedValue(true)` to every storage mock found. Give login fixtures that are **not** about rehashing a `pv2$` hash (compute once in `beforeAll` with `hashPassword`), so no background rehash runs into the next test; only the three rehash tests below use a legacy hash. In `auth.test.ts`:
  - legacy hash + correct ≤72-byte password → `await vi.waitFor(() => expect(storage.upgradePasswordHash).toHaveBeenCalledWith(id, legacyHash, expect.stringMatching(/^pv2\$/)))` (a cost-12 bcrypt outlasts one `setImmediate`).
  - pv2 hash → not called.
  - legacy hash + 80-byte password (legacy-matching) → not called.

Run `npx vitest run server/routes/__tests__/auth.test.ts server/storage/__tests__/users-upgrade-password-hash.test.ts` — expected PASS.

- [ ] **Step 5: Commit** — `feat(server): upgrade legacy password hashes at sign-in, compare-and-swap`.

---

### Task 4: Breach check (HIBP range, fail open)

**Files:**

- Create: `server/lib/pwned-password.ts`
- Test: `server/lib/__tests__/pwned-password.test.ts`

**Interfaces:**

- Produces: `isBreached(pw: string, fetchImpl?: typeof fetch): Promise<boolean | "unavailable">`; `PWNED_TIMEOUT_MS = 3000`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import crypto from "node:crypto";
import { isBreached } from "../pwned-password";

const sha1 = (s: string) =>
  crypto
    .createHash("sha1")
    .update(s.normalize("NFC"), "utf8")
    .digest("hex")
    .toUpperCase();

function fakeFetch(body: string, status = 200) {
  return vi.fn(async () => new Response(body, { status }));
}

describe("isBreached", () => {
  it("sends only the 5-hex prefix, with padding", async () => {
    const f = fakeFetch("");
    await isBreached("hunter2hunter2hunter2", f as unknown as typeof fetch);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      `https://api.pwnedpasswords.com/range/${sha1("hunter2hunter2hunter2").slice(0, 5)}`,
    );
    expect((init.headers as Record<string, string>)["Add-Padding"]).toBe(
      "true",
    );
    expect(url).not.toContain(sha1("hunter2hunter2hunter2").slice(5));
  });

  it("detects a hit with CRLF lines and ignores padded :0 rows", async () => {
    const h = sha1("password-password");
    const body = `0000000000000000000000000000000000A:0\r\n${h.slice(5)}:42\r\n`;
    expect(
      await isBreached(
        "password-password",
        fakeFetch(body) as unknown as typeof fetch,
      ),
    ).toBe(true);
  });

  it("a padded :0 row for our suffix is not a hit", async () => {
    const h = sha1("rare-pass-phrase");
    expect(
      await isBreached(
        "rare-pass-phrase",
        fakeFetch(`${h.slice(5)}:0\r\n`) as unknown as typeof fetch,
      ),
    ).toBe(false);
  });

  it("fails open on non-200 and on network errors", async () => {
    expect(
      await isBreached(
        "x".repeat(15),
        fakeFetch("", 503) as unknown as typeof fetch,
      ),
    ).toBe("unavailable");
    const boom = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    expect(
      await isBreached("x".repeat(15), boom as unknown as typeof fetch),
    ).toBe("unavailable");
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run server/lib/__tests__/pwned-password.test.ts`.

- [ ] **Step 3: Implement**

```ts
import crypto from "node:crypto";
import { createServiceLogger } from "./logger";

const log = createServiceLogger("pwned-password");
export const PWNED_TIMEOUT_MS = 3000;

/**
 * Have I Been Pwned range check (k-anonymity): only the first 5 hex chars of
 * the SHA-1 leave the server. Fails OPEN (spec P2): any error → "unavailable",
 * and the caller accepts the password. Never logs password material.
 */
export async function isBreached(
  pw: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean | "unavailable"> {
  const hash = crypto
    .createHash("sha1")
    .update(pw.normalize("NFC"), "utf8")
    .digest("hex")
    .toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  try {
    const res = await fetchImpl(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        headers: { "Add-Padding": "true", "User-Agent": "OCRecipes" },
        signal: AbortSignal.timeout(PWNED_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      log.warn({ status: res.status }, "breach check unavailable");
      return "unavailable";
    }
    for (const line of (await res.text()).split(/\r?\n/)) {
      const [s, count] = line.split(":");
      if (s === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch (err) {
    log.warn({ err: (err as Error).name }, "breach check unavailable");
    return "unavailable";
  }
}
```

(Check `server/lib/logger.ts` for the exact `createServiceLogger` export name before writing; the reset test above mocks it under that name.)

- [ ] **Step 4: Run** — expected PASS.
- [ ] **Step 5: Commit** — `feat(server): breached-password range check, fail open`.

---

### Task 5: Error codes, the new-password schema, and register

**Files:**

- Modify: `shared/constants/error-codes.ts`, `server/routes/_schemas.ts`, `server/routes/auth.ts` (register)
- Test: `server/routes/__tests__/auth.test.ts`, `server/routes/__tests__/_schemas-password-reset.test.ts`
- Fixtures: every register call in `server/routes/__tests__/auth.test.ts` and `test/integration/auth-routes.itest.ts` that sends a <15-char password; `e2e/helpers/enter-registration-passwords.yaml` and `e2e/helpers/enter-registration-passwords-retry.yaml` (`TestPass123!` → a 15+ value such as `TestPassphrase123!`)

**Interfaces:**

- Consumes: Task 1 policy, Task 2 `hashPassword`, Task 4 `isBreached`.
- Produces: `ErrorCode.PASSWORD_TOO_SHORT`, `ErrorCode.PASSWORD_UPGRADE_NEEDED`, `ErrorCode.PASSWORD_BREACHED`; `newPasswordSchema` (floor 8, max 128 code points, raw `.max(512)`); helper `checkNewPassword(pw, min, context): Promise<PasswordRejection | null>` in `server/routes/_password-rules.ts`.

- [ ] **Step 1: Add the error codes** (in the auth block, near `INVALID_RESET_CODE`):

```ts
  /** New password under the account's minimum (15, or 8 with two-step). */
  PASSWORD_TOO_SHORT: "PASSWORD_TOO_SHORT",
  /** Turning two-step off with a password under 15 needs a new 15+ one in the same step. */
  PASSWORD_UPGRADE_NEEDED: "PASSWORD_UPGRADE_NEEDED",
  /** The new password appears in a known breach (HIBP range check). */
  PASSWORD_BREACHED: "PASSWORD_BREACHED",
```

- [ ] **Step 2: Write the failing tests**

`_schemas-password-reset.test.ts` (new cases):

```ts
it("newPasswordSchema has no composition rule and counts code points", () => {
  expect(newPasswordSchema.safeParse("abcdefgh").success).toBe(true); // 8 letters, floor
  expect(newPasswordSchema.safeParse("abcdefg").success).toBe(false);
  expect(newPasswordSchema.safeParse("😀".repeat(128)).success).toBe(true); // 256 UTF-16 units
  expect(newPasswordSchema.safeParse("a".repeat(129)).success).toBe(false);
});
```

`auth.test.ts` (register; mock `../../lib/pwned-password` with `isBreached: vi.fn().mockResolvedValue(false)`):

- 14-char password → `400`, `code: "PASSWORD_TOO_SHORT"`, `createUser` not called.
- 15 letters, no digit → 201/200 (no composition rule).
- `isBreached` → `true` → `400 PASSWORD_BREACHED`, and `getUserByEmail` **not called** (breach check runs before the existence check).
- `isBreached` → `"unavailable"` → account created.
- created account's `password` passed to `createUser` matches `/^pv2\$/`.

- [ ] **Step 3: Run to verify they fail** — `npx vitest run server/routes/__tests__/auth.test.ts server/routes/__tests__/_schemas-password-reset.test.ts`.

- [ ] **Step 4: Implement**

`_schemas.ts`:

```ts
import {
  PASSWORD_MAX,
  PASSWORD_MIN_WITH_MFA,
  passwordLength,
} from "@shared/constants/password-policy";

// The one server-side new-password rule (register, reset, disable). Checks the
// FLOOR (8) and the max in code points; the state-dependent 15 is applied in
// the route, where the account is known (spec §2). No composition rule.
export const newPasswordSchema = z
  .string()
  .max(512)
  .superRefine((pw, ctx) => {
    const n = passwordLength(pw);
    if (n < PASSWORD_MIN_WITH_MFA)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Use at least ${PASSWORD_MIN_WITH_MFA} characters.`,
      });
    if (n > PASSWORD_MAX)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Use at most ${PASSWORD_MAX} characters.`,
      });
  });
```

`server/routes/_password-rules.ts`:

```ts
import { ErrorCode } from "@shared/constants/error-codes";
import {
  newPasswordProblem,
  passwordMessage,
  type PasswordContext,
} from "@shared/constants/password-policy";
import { isBreached } from "../lib/pwned-password";

export interface PasswordRejection {
  status: 400;
  code:
    | typeof ErrorCode.PASSWORD_TOO_SHORT
    | typeof ErrorCode.PASSWORD_BREACHED;
  message: string;
}

/** Length for the account's state, then the breach check. null = acceptable. */
export async function checkNewPassword(
  pw: string,
  min: number,
  context: PasswordContext,
): Promise<PasswordRejection | null> {
  const problem = newPasswordProblem(pw, { min });
  if (problem) {
    return {
      status: 400,
      code: ErrorCode.PASSWORD_TOO_SHORT,
      message: passwordMessage(problem, context),
    };
  }
  if ((await isBreached(pw)) === true) {
    return {
      status: 400,
      code: ErrorCode.PASSWORD_BREACHED,
      message:
        "That password has appeared in a data breach. Choose a different one.",
    };
  }
  return null;
}
```

Register, right after `const { username, password, email } = parsed.data;` (before the username check, so neither answer nor latency depends on the account):

```ts
const rejected = await checkNewPassword(
  password,
  PASSWORD_MIN_SINGLE_FACTOR,
  "signup",
);
if (rejected) {
  return sendError(res, rejected.status, rejected.message, rejected.code);
}
```

replace both `bcrypt.hash(password, 12)` calls with `hashPassword(password)`, and update the comment "Username uniqueness FIRST" to "After the password check, username uniqueness comes first among the account checks".

- [ ] **Step 5: Update fixtures** — change every register-path password under 15 in `auth.test.ts` and `test/integration/auth-routes.itest.ts` to a 15+ constant (`const GOOD_PASSWORD = "a-long-test-passphrase"`); add the `pwned-password` mock (`isBreached: vi.fn().mockResolvedValue(false)`) to every test file whose app registers the auth routes that set passwords — find them with `grep -rln 'register(' server/routes/__tests__ test/integration` and keep those that mount `../auth` or `../auth-mfa` (at least `auth.test.ts`, `auth-password-reset.test.ts`, `auth-password-reset-throttle.test.ts`, `auth-reset-revocation.test.ts`, `auth-route-wiring.test.ts`, `auth-mfa-manage.test.ts`, and **`test/integration/auth-routes.itest.ts`** with path `../../server/lib/pwned-password`), so no test calls api.pwnedpasswords.com; update the two e2e helpers.

- [ ] **Step 6: Run** the six route test files + `_schemas-password-reset.test.ts` — expected PASS.
- [ ] **Step 7: Commit** — `feat(server): 15-character sign-up, no composition rule, breach check`.

---

### Task 6: Password reset follows the account's two-step state

**Files:**

- Modify: `server/storage/password-reset.ts` (`reservePasswordResetAttempt` returns `mfaEnabledAt`), `server/routes/auth.ts` (reset handler)
- Test: `server/routes/__tests__/auth-password-reset.test.ts`, the storage test for `reservePasswordResetAttempt`

**Interfaces:**

- Consumes: `checkNewPassword` (Task 5), `hashPassword` (Task 2).
- Produces: `reservePasswordResetAttempt(email)` → `{ id, username, email, resetCodeHash, mfaEnabledAt: Date | null } | undefined`.

- [ ] **Step 1: Write the failing tests** (`auth-password-reset.test.ts`):

```ts
it("10 chars on a no-MFA account: 400 PASSWORD_TOO_SHORT after a correct code; code not consumed", async () => {
  mockReserved({ mfaEnabledAt: null }); // helper returning a row whose resetCodeHash matches CODE
  const res = await post({
    email: EMAIL,
    code: CODE,
    newPassword: "ten-chars!",
  });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe("PASSWORD_TOO_SHORT");
  expect(storage.completePasswordReset).not.toHaveBeenCalled();
});

it("10 chars on an MFA account: accepted", async () => {
  mockReserved({ mfaEnabledAt: new Date() });
  vi.mocked(storage.completePasswordReset).mockResolvedValue(true);
  const res = await post({
    email: EMAIL,
    code: CODE,
    newPassword: "ten-chars!",
  });
  expect(res.status).toBe(200);
});

it("a wrong code with a short password returns the invalid-code 400, never PASSWORD_TOO_SHORT", async () => {
  mockReserved({ mfaEnabledAt: null });
  const res = await post({
    email: EMAIL,
    code: "000000",
    newPassword: "ten-chars!",
  });
  expect(res.body.code).toBe("INVALID_RESET_CODE");
});

it("breached password: 400 PASSWORD_BREACHED, code not consumed, a good retry then succeeds", async () => {
  mockReserved({ mfaEnabledAt: null });
  vi.mocked(isBreached).mockResolvedValueOnce(true);
  const bad = await post({
    email: EMAIL,
    code: CODE,
    newPassword: "a-long-test-passphrase",
  });
  expect(bad.body.code).toBe("PASSWORD_BREACHED");
  expect(storage.completePasswordReset).not.toHaveBeenCalled();
  vi.mocked(storage.completePasswordReset).mockResolvedValue(true);
  const good = await post({
    email: EMAIL,
    code: CODE,
    newPassword: "another-long-passphrase",
  });
  expect(good.status).toBe(200);
  expect(vi.mocked(storage.completePasswordReset).mock.calls[0][2]).toMatch(
    /^pv2\$/,
  );
});
```

(`mockReserved` sets `storage.reservePasswordResetAttempt` to resolve `{ id: "1", username: "u", email: EMAIL, resetCodeHash: hashResetCode("1", CODE), mfaEnabledAt }`; reuse the file's existing CODE/EMAIL constants and `post` helper.)

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement** — add `mfaEnabledAt: users.mfaEnabledAt` to `.returning(...)` and the return type; in the route, after the `!reserved || !matches` check:

```ts
const rejected = await checkNewPassword(
  newPassword,
  reserved.mfaEnabledAt ? PASSWORD_MIN_WITH_MFA : PASSWORD_MIN_SINGLE_FACTOR,
  reserved.mfaEnabledAt ? "mfa" : "single_factor",
);
if (rejected) {
  sendError(res, rejected.status, rejected.message, rejected.code);
  return;
}
const newHash = await hashPassword(newPassword);
```

- [ ] **Step 4: Run** `auth-password-reset.test.ts`, `auth-reset-revocation.test.ts`, `auth-password-reset-throttle.test.ts` — expected PASS.
- [ ] **Step 5: Commit** — `feat(server): reset minimum follows the account's two-step state`.

---

### Task 7: Turning two-step off needs a 15+ password

**Files:**

- Modify: `server/routes/_schemas.ts` (`mfaDisableSchema`), `server/routes/auth-mfa.ts` (disable route), `server/storage/mfa.ts` (`disableMfa`)
- Test: `server/routes/__tests__/auth-mfa-manage.test.ts`, the real-DB storage test for `disableMfa` (`server/storage/__tests__/mfa*.test.ts`)

**Interfaces:**

- Consumes: `checkNewPassword`, `hashPassword`, `passwordLength`, `PASSWORD_MIN_SINGLE_FACTOR`; new imports in `auth-mfa.ts`: `fireAndForget` (same module `auth.ts` imports it from) and `sendPasswordChangedNotice` from `../services/email` (add it to the test file's `services/email` mock).
- Produces: `disableMfa(userId: string, opts?: { newPasswordHash?: string }): Promise<number | undefined>`; `mfaDisableSchema = mfaPasswordAndFactorSchema.extend({ newPassword: newPasswordSchema.optional() })`.

- [ ] **Step 1: Write the failing route tests** (existing disable tests: change their `password` fixture to a 15+ value so they keep testing what they tested):

```ts
it("short current password, no newPassword: 400 PASSWORD_UPGRADE_NEEDED before the factor is checked", async () => {
  mockUserWithPassword("short-pass-1"); // 12 chars, MFA on
  const res = await post("disable", {
    password: "short-pass-1",
    secondFactor: { recoveryCode: "ABCD-EFGH-IJKL-MNOP" },
  });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe("PASSWORD_UPGRADE_NEEDED");
  expect(mockVerifySecondFactor).not.toHaveBeenCalled(); // no recovery code spent
  expect(storage.disableMfa).not.toHaveBeenCalled();
});

it("short current password + a 15+ newPassword: disables and changes the password in one call", async () => {
  mockUserWithPassword("short-pass-1");
  mockVerifySecondFactor.mockResolvedValue({ ok: true });
  vi.mocked(storage.disableMfa).mockResolvedValue(6);
  const res = await post("disable", {
    password: "short-pass-1",
    secondFactor: { code: currentCode() },
    newPassword: "a-long-test-passphrase",
  });
  expect(res.status).toBe(200);
  const [, opts] = vi.mocked(storage.disableMfa).mock.calls[0];
  expect(opts?.newPasswordHash).toMatch(/^pv2\$/);
});

it("short newPassword: 400 PASSWORD_TOO_SHORT, nothing disabled", async () => {
  /* newPassword "still-short-1" */
});
it("breached newPassword: 400 PASSWORD_BREACHED, factor not checked", async () => {
  /* isBreached → true */
});
it("15+ current password needs no newPassword", async () => {
  /* unchanged path */
});
```

(Match `mockVerifySecondFactor`'s real resolved shape by reading `server/lib/mfa/verify-second-factor.ts` before writing these.)

Storage test: `disableMfa(id, { newPasswordHash: "pv2$x" })` → user row has `password = "pv2$x"`, `pendingEmail = null`, `mfaEnabledAt = null`, `tokenVersion` +1, trusted devices gone.

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

`_schemas.ts`: `export const mfaDisableSchema = mfaPasswordAndFactorSchema.extend({ newPassword: newPasswordSchema.optional() });`

Route:

```ts
const body = parse(mfaDisableSchema, req.body);
const user = await me(req);
await requirePassword(user, body.password);
requireEnabled(user);
// Before the factor check, so a policy rejection never spends a
// recovery code (spec §5.4 as amended by the PR 1 plan).
let newPasswordHash: string | undefined;
if (passwordLength(body.password) < PASSWORD_MIN_SINGLE_FACTOR) {
  if (!body.newPassword) {
    throw new Reply(
      400,
      ErrorCode.PASSWORD_UPGRADE_NEEDED,
      "Your password is shorter than 15 characters. Choose a new one of at least 15 to turn off two-step verification.",
    );
  }
}
if (body.newPassword) {
  const rejected = await checkNewPassword(
    body.newPassword,
    PASSWORD_MIN_SINGLE_FACTOR,
    "single_factor",
  );
  if (rejected)
    throw new Reply(rejected.status, rejected.code, rejected.message);
  newPasswordHash = await hashPassword(body.newPassword);
}
await requireFactor(user, body.secondFactor);
await storage.disableMfa(user.id, { newPasswordHash });
invalidateTokenVersionCache(user.id);
notice(user, "disabled");
if (newPasswordHash && user.email) {
  fireAndForget(
    "password-changed-notice",
    sendPasswordChangedNotice(user.email, user.username),
  );
}
res.json(await issueSession(user.id));
```

(Confirm `Reply`'s constructor argument order — `(status, code, message)` per its uses above — and that `user.email` is the verified address on this user type.)

Storage:

```ts
export async function disableMfa(
  userId: string,
  opts: { newPasswordHash?: string } = {},
): Promise<number | undefined> {
  return db.transaction(async (tx) => {
    // … existing four deletes …
    const [u] = await tx
      .update(users)
      .set({
        mfaEnabledAt: null,
        tokenVersion: sql`${users.tokenVersion} + 1`,
        ...(opts.newPasswordHash
          ? { password: opts.newPasswordHash, pendingEmail: null }
          : {}),
      })
      .where(eq(users.id, userId))
      .returning({ tokenVersion: users.tokenVersion });
    return u?.tokenVersion;
  });
}
```

`scripts/mfa-reset.ts` calls `disableMfa(userId)` — unchanged signature-compatible.

- [ ] **Step 4: Run** `auth-mfa-manage.test.ts` and the mfa storage test — expected PASS.
- [ ] **Step 5: Commit** — `feat(server): turning two-step off needs a 15+ password`.

---

### Task 8: Seed script through the facade, plus the facade guard

**Files:**

- Modify: `server/scripts/seed-recipes.ts:259`
- Create test: `server/lib/__tests__/bcrypt-hash-facade.test.ts`

- [ ] **Step 1: Write the failing guard test.**

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set([
  "server/lib/password-hash.ts",
  "server/storage/api-keys.ts",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "__tests__") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("bcrypt.hash is only called through the facade", () => {
  it("no user-password bcrypt.hash outside password-hash.ts", () => {
    const files = walk("server");
    expect(files.length).toBeGreaterThan(50); // non-vacuous walk
    const offenders = files.filter(
      (f) =>
        !ALLOWED.has(f) && /\bbcrypt\.hash\s*\(/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run server/lib/__tests__/bcrypt-hash-facade.test.ts`; expected FAIL listing only `server/scripts/seed-recipes.ts` (Tasks 5 and 6 already moved `auth.ts` to the facade).
- [ ] **Step 3:** Replace `await bcrypt.hash(plaintextPassword, 12)` with `await hashPassword(plaintextPassword)`; drop the `bcrypt` import if nothing else in the file uses it.
- [ ] **Step 4: Run** `npx vitest run server/lib/__tests__/bcrypt-hash-facade.test.ts server/scripts/__tests__/seed-recipes-utils.test.ts` — expected PASS.
- [ ] **Step 5: Commit** — `chore(server): one password-hashing facade, guarded`.

---

### Task 9: Client — one rule, clear errors, iOS password hints

**Files:**

- Modify: `client/screens/LoginScreen-utils.ts`, `client/screens/ResetPasswordScreen-utils.ts`, `client/screens/LoginScreen.tsx`, `client/screens/ResetPasswordScreen.tsx`
- Test: `client/screens/__tests__/LoginScreen-utils.test.ts`, `client/screens/__tests__/ResetPasswordScreen-utils.test.ts`

**Interfaces:**

- Consumes: Task 1 policy, Task 5 error codes.
- Produces: `validateNewPassword(password, confirmPassword, opts: { min: number; context: PasswordContext }): string | null`.

- [ ] **Step 1: Write the failing tests**

`LoginScreen-utils.test.ts`:

- register with 14 chars → `"Use at least 15 characters."`; 15 letters, no digit → valid.
- `getAuthErrorMessage(new ApiError(400, "x", "PASSWORD_TOO_SHORT"), "register")` → `"Use at least 15 characters."`
- `PASSWORD_BREACHED` on register → `"That password has appeared in a data breach. Choose a different one."`

`ResetPasswordScreen-utils.test.ts`:

- reset form with 8 chars → valid (floor; the server applies 15 for a no-MFA account).
- `getResetErrorMessage(PASSWORD_TOO_SHORT)` → `"Use at least 15 characters, or 8 if two-step verification is on."`
- `getResetErrorMessage(PASSWORD_BREACHED)` → the breach sentence.

(Construct `ApiError` the way the existing tests in these files do.)

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**
  - `LoginScreen-utils.ts`: delete `PASSWORD_COMPLEXITY`, `PASSWORD_MIN` and the KEEP-IN-SYNC note for the password; `validateNewPassword` uses `newPasswordProblem(password, { min })` and `passwordMessage(problem, context)`; register calls it with `{ min: PASSWORD_MIN_SINGLE_FACTOR, context: "signup" }`. Export `BREACHED_PASSWORD_MESSAGE`. `getAuthErrorMessage`: map `PASSWORD_TOO_SHORT` → `passwordMessage("too_short", "signup")`, `PASSWORD_BREACHED` → `BREACHED_PASSWORD_MESSAGE` (register mode only).
  - `ResetPasswordScreen-utils.ts`: `validateResetForm` calls `validateNewPassword(..., { min: PASSWORD_MIN_WITH_MFA, context: "mfa" })` (the floor — the account's MFA state is unknown on this screen); `getResetErrorMessage` maps `PASSWORD_TOO_SHORT` → `"Use at least 15 characters, or 8 if two-step verification is on."` and `PASSWORD_BREACHED` → `BREACHED_PASSWORD_MESSAGE`.
  - `LoginScreen.tsx` register password + confirm fields: `textContentType="newPassword"`, `autoComplete="new-password"`, `passwordRules="minlength: 15; maxlength: 128;"` (only in register mode; login mode gains `textContentType="password"`, which it lacks today).
  - `ResetPasswordScreen.tsx`: add `passwordRules="minlength: 8; maxlength: 128;"` to both fields.

- [ ] **Step 4: Run** both util test files plus `client/screens/__tests__/LoginScreen*.test.tsx` and `ResetPasswordScreen*.test.tsx` — expected PASS.
- [ ] **Step 4b: Hermes check** (Vitest runs on Node, so it can't catch this — the Hermes-no-`crypto` shape). On the iOS simulator dev build, open sign-up, type `café` + 11 more letters (15 code points) into the password field and confirm the form accepts it and 14 is refused with "Use at least 15 characters." If `String.prototype.normalize` is missing or a no-op on Hermes, stop and add a fallback in `passwordLength` (skip NFC when `"e\u0301".normalize("NFC").length !== 1`) and note it in the spec.
- [ ] **Step 5: Commit** — `feat(client): shared password rule, clear errors, iOS password hints`.

---

### Task 10: Client — turning two-step off with a short password

**Files:**

- Modify: `client/hooks/useAuth.ts` (`disableTwoStep` gains `newPassword?`), `client/context/AuthContext.tsx` (type), `client/screens/TwoStepSetupScreen.tsx`, `client/screens/TwoStepSetupScreen-utils.ts`
- Test: `client/screens/__tests__/TwoStepSetupScreen.test.tsx`

**Interfaces:**

- Produces: `disableTwoStep(password: string, secondFactor: SecondFactorInput, newPassword?: string): Promise<void>`.

- [ ] **Step 1: Write the failing screen test**

```ts
it("disable with a short password asks for a new 15+ one and resubmits", async () => {
  h.disableTwoStep
    .mockRejectedValueOnce(new ApiError(400, "x", "PASSWORD_UPGRADE_NEEDED"))
    .mockResolvedValueOnce(undefined);
  const navigation = renderScreen("disable");
  type("Password", "short-pass-1");
  type("6-digit code", "123456");
  press("Turn off");
  await screen.findByLabelText("New password");
  type("New password", "a-long-test-passphrase");
  type("Confirm new password", "a-long-test-passphrase");
  press("Turn off");
  await waitFor(() =>
    expect(h.disableTwoStep).toHaveBeenLastCalledWith(
      "short-pass-1",
      { code: "123456" },
      "a-long-test-passphrase",
    ),
  );
  await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
});

it("a mismatched or short new password is caught before sending", async () => {
  /* expect no second call */
});
```

- [ ] **Step 2: Run to verify it fails.**

- [ ] **Step 3: Implement**
  - `useAuth.disableTwoStep(password, secondFactor, newPassword?)` sends `newPassword` only when given.
  - `TwoStepSetupScreen`: state `needsNewPassword`, `newPassword`, `confirmNewPassword`. `messageFor` maps `PASSWORD_UPGRADE_NEEDED` → "Your password is shorter than 15 characters. Choose a new one of at least 15 to turn off two-step verification." and sets `needsNewPassword = true`; maps `PASSWORD_TOO_SHORT` / `PASSWORD_BREACHED` to the shared copy. When `needsNewPassword`, the confirm step shows "New password" and "Confirm new password" fields (`textContentType="newPassword"`, `passwordRules="minlength: 15; maxlength: 128;"`), validated with `validateNewPassword(..., { min: PASSWORD_MIN_SINGLE_FACTOR, context: "single_factor" })` before the request. The factor field keeps its value; if the user used a recovery code, the error came before the factor check, so it is still unspent.
  - Keep the handlers free of `try/finally` and of conditionals inside `try` (React Compiler; see `docs/solutions/code-quality/react-compiler-bails-on-a-conditional-inside-a-try-2026-10-10.md`).

- [ ] **Step 4: Run** `client/screens/__tests__/TwoStepSetupScreen*.test.ts*` — expected PASS.
- [ ] **Step 5: Commit** — `feat(client): ask for a 15+ password when turning two-step off`.

---

### Task 11: Docs, todo and spec bookkeeping

**Files:**

- Modify: `todos/P2-2026-09-26-password-length-policy.md`, `docs/superpowers/specs/2026-10-10-password-policy-design.md`, `docs/runbooks/` (new short entry, or an existing deploy runbook)

- [ ] **Step 1:** Update the todo's Scope Contract to list every file this plan touches; tick only the PR 1 criteria; add a 2026-10-10 Updates entry (PR 1 merged, PR 2 = upgrade pass + sign-up switch + sign-in gate still to come; "14" disposition per spec §7). **Do NOT archive the todo** — executor Step 8's archive does not apply; PR 2 continues under the same file. `/todo-fast` Step 6 records the root under `handed_to_user` with reason "PR 1 merged; PR 2 (spec §6) planned separately", not as done.
- [ ] **Step 2:** Amend spec §5.4 ordering (length check before `requireFactor`); copy the spec to the main checkout's `docs/superpowers/specs/` (`SKIP_WORKTREE_CONTRACT=1 cp …`).
- [ ] **Step 3:** Record the rollback hazard durably: a line in `docs/runbooks/` ("never redeploy a server older than the password-policy PR 1 once `pv2$` hashes exist — fix forward") and in the PR description.
- [ ] **Step 4: Commit** — `docs(todos): password policy PR 1 scope and progress`.

---

## Done when

- All tasks' tests pass; `preflight:fast` passes on push; CI green.
- Review roster (`code-reviewer` + `security-auditor` + `server-reviewer` + `mobile-reviewer`) clean on the final head.
- Before merge: the owner runs `SELECT count(*) FROM users WHERE mfa_enabled_at IS NULL AND password IS NOT NULL;` on prod via `!` (spec §9) and confirms the PR 1→PR 2 window is acceptable.
- The PR is `security`-labelled: merged only on the owner's explicit yes.
- PR description notes: login-mode password field gains `textContentType="password"` (deliberate autofill change); the rollback hazard (spec §3).
