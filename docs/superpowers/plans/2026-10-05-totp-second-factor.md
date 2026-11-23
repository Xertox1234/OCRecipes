# Authenticator-App Second Factor (TOTP) Implementation Plan

> **STATUS: SUPERSEDED — do not implement or re-propose.** Replaced by `2026-10-10-totp-second-factor.md`, which was itself overruled: authenticator apps and recovery codes were removed. Two-step is optional and by emailed code only. See `docs/OWNER_RULINGS.md` → Auth (2026-10-12).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any account turn on a second factor (a 6-digit code from an authenticator app, with one-time recovery codes), and require it before ANY session is issued: password login, Google/Apple sign-in, and linking a provider to an existing account.

**Architecture:** One gate function, `beginSession`, replaces every direct session mint for existing accounts. For an account with 2FA it creates a short-lived **challenge row** in the database (not a JWT) and answers `200 { status: "mfa_required", challenge }`; `POST /api/auth/mfa/verify` checks the code and only then mints the normal access token. All counters (per-challenge attempts, per-account failures, TOTP replay step, single-use recovery codes) are single atomic SQL statements on the database clock, the same pattern as `server/storage/password-reset.ts`.

**Tech Stack:** Express 5 + Drizzle/PostgreSQL (server), `node:crypto` only (TOTP is hand-written against RFC 6238 test vectors — no new server dependency), Expo/React Native client (no new native module, so the client part ships by OTA).

**Spec:** `todos/P2-2026-09-26-add-second-factor-authentication.md` (on `main`). Auth rulings: memory `project_auth_review_decisions_2026_09_26.md`.

---

## Decisions for the owner (approve or change before execution)

1. **Scope of this plan = TOTP + recovery codes + the sign-in gate + Settings enroll/disable.** NOT in this plan (the todo stays open for them):
   - **Passkeys** — need a native build; wait for build 7.
   - **Signup enrollment on the 8-character path** and **"turning 2FA off needs a 15+ character password"** — both only make sense once the password-length rule exists, so they move to the password-policy plan (`P2-2026-09-26-password-length-policy.md`). Until then 2FA is purely opt-in on top of today's 8-character rule, which already passes everything this plan adds.
2. **No QR code.** On a phone the authenticator app is usually on the same phone, so setup offers **"Open in authenticator app"** (an `otpauth://` link) plus a **copyable setup key**. A QR code (`react-native-qrcode-svg`, JS-only) can be added later for people whose authenticator is on another device.
3. **New server secret `MFA_SECRET_ENC_KEY`** (32 random bytes, base64) encrypts the authenticator secrets at rest. Deliberately separate from `JWT_SECRET` and `IDENTITY_TOKEN_ENC_KEY`, so rotating either never breaks anyone's 2FA. Without it, 2FA setup answers "unavailable" (sign-in for already-enrolled accounts cannot happen without it, so setup is the only place it can be missing).
4. **Lockout numbers:** 5 tries per challenge; every 10 consecutive wrong codes on an account locks 2FA for 15 minutes; at 100 consecutive wrong codes the authenticator-app code is refused and only a recovery code works (SP 800-63B-4's cap). A correct code resets the count.
5. **10 recovery codes**, 80 random bits each, shown once, formatted `XXXX-XXXX-XXXX-XXXX`. Using one consumes it and immediately shows a **replacement** (and emails a notice), per SP 800-63B-4.
6. **Turning 2FA on or off signs out every other device** (`tokenVersion` bump, per the todo's Implementation Notes); the current device gets a fresh token and stays signed in.

## Owner actions (the PR cannot merge until both are done)

- **Apply `migrations/0018_mfa_totp.sql` to production BEFORE merging** (same rule as `0017`): the new server bundle reads the new `users.mfa_enabled_at` column on every user load.
- **Set `MFA_SECRET_ENC_KEY` on Railway** (`openssl rand -base64 32`). Keep a copy in the password manager; losing it means every enrolled user must use a recovery code and re-enroll.

## Global Constraints

- Never delegate auth implementation (memory `project_auth_recurring_breakage`); every task is done in-session or by an executor whose output is reviewed line by line.
- TOTP: SHA-1, 6 digits, 30-second period, ±1 step tolerance (RFC 6238 defaults; what every authenticator app uses).
- A "2FA required" answer is **HTTP 200**, never 4xx: `loginAccountLimiter` uses `skipSuccessfulRequests`, so a non-2xx would count a CORRECT password as a failed login.
- The challenge token must never be accepted by `requireAuth` (it is an opaque random string, not a JWT — asserted by an integration test).
- Nothing is linked and no session is issued before the second factor passes (`server/lib/social-identity/sign-in-gates.ts` contract).
- Every code/counter check is ONE atomic SQL statement evaluated with `now()` on the database clock.
- Error copy never says whether a code was "wrong" vs "already used" vs "expired" for the challenge (one generic message).
- **Password reset stays as it is and never mints a session**, and it must NOT clear 2FA. So someone holding only the mailbox can reset the password but still hits the challenge at the next sign-in; a user who lost their phone signs in with the password plus a recovery code (the todo's "a compromised mailbox alone can't take over an MFA account"). A reset during an open challenge bumps `tokenVersion`, which kills that challenge (Task 7 handler step 3, tested there as Review Focus 2).
- Base branch: `origin/main`, created explicitly (`git worktree add … origin/main`) — the main checkout changes branches under other sessions.
- **Start only after `fix/siwa-minors` has merged** (it changes `auth-social.ts`, `identities.ts`, `SocialSignInButtons`, `ConnectAccountScreen`, `LoginScreen`, `SignInMethodsScreen`). If it is still open, ask the owner.
- PR: label `security`, reviewers `security-auditor` + `server-reviewer` + `mobile-reviewer` + `code-reviewer`; never auto-merged; ask the owner before merging.

## Review Focus

1. **Same valid code sent twice at once** (double-tap, retry) — exactly one request signs in; the other gets the generic invalid answer. Pinned in Task 4 (atomic step update) and Task 7 (route).
2. **Password reset or "sign out everywhere" while a challenge is open** — the challenge must die (its stored `token_version` no longer matches). Pinned in Task 7.
3. **A provider link on a 2FA account where the code is never entered** — no identity row may exist afterwards. Pinned in Task 6.
4. **Clock drift of one step either side / a code from 2 steps ago** — accepted / rejected. Pinned in Task 1.
5. **Recovery code typed with spaces, lowercase, or without dashes** — accepted. Pinned in Task 2.

---

## File map

| File                                                                                                                                | Responsibility                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `server/lib/mfa/totp.ts` (new)                                                                                                      | base32, HOTP/TOTP, `matchTotp`, `otpauthUrl` — pure                                                                               |
| `server/lib/mfa/mfa-secrets.ts` (new)                                                                                               | `MFA_SECRET_ENC_KEY` loading, secret encrypt/decrypt, recovery-code generate/normalize/hash, challenge token generate/hash — pure |
| `shared/constants/mfa.ts` (new)                                                                                                     | every number in "Decisions" 4–5                                                                                                   |
| `shared/schema.ts`, `migrations/0018_mfa_totp.sql` (new)                                                                            | `users.mfa_enabled_at`; tables `user_mfa`, `mfa_recovery_codes`, `mfa_challenges`                                                 |
| `server/storage/mfa.ts` (new) + `server/storage/index.ts`                                                                           | all MFA SQL                                                                                                                       |
| `server/storage/identities.ts`                                                                                                      | `completeLinkByTicketHash` (challenge stores only the ticket's hash)                                                              |
| `server/lib/mfa/verify-second-factor.ts` (new)                                                                                      | code/recovery-code check + failure accounting (no HTTP)                                                                           |
| `server/lib/mfa/begin-session.ts` (new)                                                                                             | THE gate: mint or challenge                                                                                                       |
| `server/lib/social-identity/sign-in-gates.ts`                                                                                       | real `requiresSecondFactor`; second-factor branch moves to `beginSession`                                                         |
| `server/routes/auth.ts`, `server/routes/auth-social.ts`                                                                             | call `beginSession`; `/me` gains `twoFactor`                                                                                      |
| `server/routes/auth-mfa.ts` (new) + route registration                                                                              | verify, setup, confirm, disable, recovery-codes                                                                                   |
| `server/routes/_schemas.ts`, `server/routes/_rate-limiters.ts`, `shared/constants/error-codes.ts`, `server/services/email.ts`       | schemas, `mfaVerifyLimiter`, codes, `sendTwoFactorNotice`                                                                         |
| `test/integration/auth-routes.itest.ts`                                                                                             | end-to-end gate checks against a real DB                                                                                          |
| `shared/types/auth.ts`                                                                                                              | `SessionResult`, `MfaChallengeResult`, `TwoFactorStatus`                                                                          |
| `client/hooks/useAuth.ts`, `client/context/AuthContext.tsx`                                                                         | return the union; `verifySecondFactor`, `finishSignIn`, 2FA management calls                                                      |
| `client/screens/LoginScreen.tsx`, `client/components/SocialSignInButtons.tsx`, `client/screens/ConnectAccountScreen.tsx`            | route `mfa_required` to the challenge screen                                                                                      |
| `client/screens/MfaChallengeScreen.tsx` + `-utils.ts` (new)                                                                         | enter code / recovery code; show replacement code                                                                                 |
| `client/screens/TwoFactorSetupScreen.tsx` + `-utils.ts` (new)                                                                       | confirm identity → key/link → code → recovery codes; turn off; new codes                                                          |
| `client/navigation/RootStackNavigator.tsx`, `client/navigation/ProfileStackNavigator.tsx`, `client/screens/SignInMethodsScreen.tsx` | register screens, entry row                                                                                                       |
| `.env.example`                                                                                                                      | `MFA_SECRET_ENC_KEY`                                                                                                              |

---

### Task 0: Branch and scope contract

**Files:** Modify `todos/P2-2026-09-26-add-second-factor-authentication.md`

- [ ] **Step 1:** Create the worktree from `origin/main` (never from the current checkout):

```bash
git fetch origin
git worktree add .claude/worktrees/totp-2fa -b feat/totp-second-factor origin/main
ln -s "$PWD/node_modules" .claude/worktrees/totp-2fa/node_modules
bash scripts/declare-worktree.sh "$PWD/.claude/worktrees/totp-2fa"
```

- [ ] **Step 2:** In the todo, replace the `**Files in scope:**` line with the File map above (every path), and append under `## Updates`:

```markdown
### 2026-10-05

- Plan `docs/superpowers/plans/2026-10-05-totp-second-factor.md` implements TOTP + recovery codes + the sign-in gate + Settings enroll/disable. Still open after it ships: passkeys (build 7), signup enrollment and the 15+-to-disable rule (password-policy todo). Keep this todo open.
```

- [ ] **Step 3:** Commit: `git commit -m "docs(todos): widen MFA scope contract for the TOTP plan"` (message via Write + `-F`).

---

### Task 1: TOTP primitives

**Files:** Create `server/lib/mfa/totp.ts`, `server/lib/mfa/__tests__/totp.test.ts`

**Interfaces — Produces:** `base32Encode(buf: Buffer): string`, `base32Decode(s: string): Buffer`, `hotp(secret: Buffer, counter: number): string`, `timeStep(nowMs: number): number`, `matchTotp(secret: Buffer, code: string, nowMs: number): number | null` (the matched step), `otpauthUrl(secretB32: string, accountName: string): string`.

- [ ] **Step 1: Write the failing tests** (RFC 6238 Appendix B SHA-1 vectors; the 6-digit code is the last 6 digits of the 8-digit vector because 10^6 divides 10^8):

```ts
import { describe, it, expect } from "vitest";
import {
  base32Encode,
  base32Decode,
  hotp,
  timeStep,
  matchTotp,
  otpauthUrl,
} from "../totp";

const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

describe("base32", () => {
  it("encodes the RFC secret", () => {
    expect(base32Encode(RFC_SECRET)).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });
  it("round-trips arbitrary bytes, case- and space-insensitive on decode", () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7]);
    const enc = base32Encode(buf);
    expect(base32Decode(enc.toLowerCase().replace(/(.{4})/g, "$1 "))).toEqual(
      buf,
    );
  });
});

describe("RFC 6238 vectors (SHA-1, 6 digits)", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("t=%i → %s", (t, code) => {
    expect(hotp(RFC_SECRET, timeStep(t * 1000))).toBe(code);
  });
});

describe("matchTotp", () => {
  const now = 1111111111 * 1000;
  const step = timeStep(now);
  it("accepts the current step and one either side, returning the matched step", () => {
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step), now)).toBe(step);
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 1), now)).toBe(
      step - 1,
    );
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step + 1), now)).toBe(
      step + 1,
    );
  });
  it("rejects two steps away, wrong length, and non-digits", () => {
    expect(matchTotp(RFC_SECRET, hotp(RFC_SECRET, step - 2), now)).toBeNull();
    expect(matchTotp(RFC_SECRET, "12345", now)).toBeNull();
    expect(matchTotp(RFC_SECRET, "12a456", now)).toBeNull();
  });
});

describe("otpauthUrl", () => {
  it("builds an authenticator link with an encoded label", () => {
    expect(otpauthUrl("ABC", "chef name")).toBe(
      "otpauth://totp/OCRecipes:chef%20name?secret=ABC&issuer=OCRecipes&algorithm=SHA1&digits=6&period=30",
    );
  });
});
```

- [ ] **Step 2:** Run `npx vitest run server/lib/mfa/__tests__/totp.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
import crypto from "node:crypto";
import {
  TOTP_CODE_LENGTH,
  TOTP_PERIOD_SECONDS,
  TOTP_WINDOW_STEPS,
} from "@shared/constants/mfa";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32, no padding (what authenticator apps expect). */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    // Only the low `bits` (≤ 12) bits are ever read; mask to stay in int range.
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32");
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin =
    ((h[off] & 0x7f) << 24) |
    (h[off + 1] << 16) |
    (h[off + 2] << 8) |
    h[off + 3];
  return (bin % 10 ** TOTP_CODE_LENGTH)
    .toString()
    .padStart(TOTP_CODE_LENGTH, "0");
}

export function timeStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The matched time step, or null. Constant-time per comparison. */
export function matchTotp(
  secret: Buffer,
  code: string,
  nowMs: number,
): number | null {
  if (!new RegExp(`^\\d{${TOTP_CODE_LENGTH}}$`).test(code)) return null;
  const given = Buffer.from(code);
  const current = timeStep(nowMs);
  for (let d = -TOTP_WINDOW_STEPS; d <= TOTP_WINDOW_STEPS; d++) {
    const expected = Buffer.from(hotp(secret, current + d));
    if (crypto.timingSafeEqual(expected, given)) return current + d;
  }
  return null;
}

export function otpauthUrl(secretB32: string, accountName: string): string {
  const label = `OCRecipes:${encodeURIComponent(accountName)}`;
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=OCRecipes&algorithm=SHA1&digits=${TOTP_CODE_LENGTH}&period=${TOTP_PERIOD_SECONDS}`;
}
```

Also create `shared/constants/mfa.ts`:

```ts
// Second factor (TOTP + recovery codes). Numbers chosen in
// docs/superpowers/plans/2026-10-05-totp-second-factor.md "Decisions".
export const TOTP_CODE_LENGTH = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW_STEPS = 1;
export const TOTP_SECRET_BYTES = 20;
export const MFA_ENROLL_TTL_MINUTES = 10;
export const MFA_CHALLENGE_TTL_MINUTES = 5;
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
export const MFA_LOCK_EVERY_FAILURES = 10;
export const MFA_LOCK_MINUTES = 15;
/** SP 800-63B-4: ≤ 100 consecutive failures before the authenticator is disabled. */
export const MFA_TOTP_FAILURE_CAP = 100;
export const MFA_RECOVERY_CODE_COUNT = 10;
export const MFA_RECOVERY_CODE_BYTES = 10; // 80 bits → 16 base32 chars
```

- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Commit `feat(server): TOTP primitives checked against the RFC 6238 vectors`.

---

### Task 2: Secrets, recovery codes, challenge tokens

**Files:** Create `server/lib/mfa/mfa-secrets.ts`, `server/lib/mfa/__tests__/mfa-secrets.test.ts`; modify `.env.example`

**Interfaces — Consumes:** `encryptToken(plain, key)`, `decryptToken(blob, key)` from `server/lib/social-identity/token-crypto.ts`; `base32Encode` (Task 1).
**Produces:** `class MfaUnavailableError extends Error`; `loadMfaKey(raw?: string): Buffer`; `mfaConfigured(): boolean`; `encryptMfaSecret(b32: string, key?: Buffer): string`; `decryptMfaSecret(blob: string, key?: Buffer): string`; `newTotpSecret(): string` (base32); `generateRecoveryCodes(n?: number): string[]` (display form); `normalizeRecoveryCode(input: string): string | null`; `hashRecoveryCode(userId: string, normalized: string): string`; `newChallengeToken(): string`; `hashChallengeToken(token: string): string`.

Recovery and challenge hashes are plain SHA-256 (no server key): both are ≥ 80-bit random values, which a database leak cannot brute-force, and no key means rotating any secret never invalidates them.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import {
  loadMfaKey,
  MfaUnavailableError,
  encryptMfaSecret,
  decryptMfaSecret,
  generateRecoveryCodes,
  normalizeRecoveryCode,
  hashRecoveryCode,
  newChallengeToken,
  hashChallengeToken,
  newTotpSecret,
} from "../mfa-secrets";

const KEY = crypto.randomBytes(32);

describe("loadMfaKey", () => {
  it("throws MfaUnavailableError when unset", () => {
    expect(() => loadMfaKey("")).toThrow(MfaUnavailableError);
  });
  it("rejects a key that is not 32 bytes", () => {
    expect(() => loadMfaKey(Buffer.alloc(16).toString("base64"))).toThrow(
      /32 bytes/,
    );
  });
});

it("encrypts and decrypts a secret; ciphertext differs per call", () => {
  const a = encryptMfaSecret("ABCDEF", KEY);
  expect(a).not.toBe(encryptMfaSecret("ABCDEF", KEY));
  expect(decryptMfaSecret(a, KEY)).toBe("ABCDEF");
});

it("newTotpSecret is 20 random bytes in base32 (32 chars)", () => {
  expect(newTotpSecret()).toMatch(/^[A-Z2-7]{32}$/);
});

describe("recovery codes", () => {
  it("generates 10 distinct XXXX-XXXX-XXXX-XXXX codes", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/);
  });
  it.each([
    ["abcd-efgh-ijkl-mnop", "ABCDEFGHIJKLMNOP"],
    [" ABCD EFGH IJKL MNOP ", "ABCDEFGHIJKLMNOP"],
    ["ABCDEFGHIJKLMNOP", "ABCDEFGHIJKLMNOP"],
  ])("normalizes %j", (input, out) => {
    expect(normalizeRecoveryCode(input)).toBe(out);
  });
  it.each(["", "ABCD-EFGH", "ABCD-EFGH-IJKL-MNO1", "ABCD-EFGH-IJKL-MNOP-QRST"])(
    "rejects %j",
    (input) => expect(normalizeRecoveryCode(input)).toBeNull(),
  );
  it("hash is per-user", () => {
    expect(hashRecoveryCode("u1", "ABCDEFGHIJKLMNOP")).not.toBe(
      hashRecoveryCode("u2", "ABCDEFGHIJKLMNOP"),
    );
  });
});

it("challenge tokens are 43-char base64url and hash deterministically", () => {
  const t = newChallengeToken();
  expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hashChallengeToken(t)).toBe(hashChallengeToken(t));
  expect(hashChallengeToken(t)).toMatch(/^[0-9a-f]{64}$/);
});
```

- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement**

```ts
import crypto from "node:crypto";
import {
  MFA_RECOVERY_CODE_BYTES,
  MFA_RECOVERY_CODE_COUNT,
  TOTP_SECRET_BYTES,
} from "@shared/constants/mfa";
import { decryptToken, encryptToken } from "../social-identity/token-crypto";
import { base32Encode } from "./totp";

export class MfaUnavailableError extends Error {
  constructor() {
    super("MFA_SECRET_ENC_KEY is not set");
  }
}

// Independent of JWT_SECRET and IDENTITY_TOKEN_ENC_KEY: rotating either must
// never make stored authenticator secrets unreadable.
export function loadMfaKey(
  raw: string | undefined = process.env.MFA_SECRET_ENC_KEY,
): Buffer {
  if (!raw) throw new MfaUnavailableError();
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("MFA_SECRET_ENC_KEY must decode to 32 bytes");
  }
  return key;
}

export function mfaConfigured(): boolean {
  try {
    loadMfaKey();
    return true;
  } catch {
    return false;
  }
}

export const encryptMfaSecret = (b32: string, key = loadMfaKey()) =>
  encryptToken(b32, key);
export const decryptMfaSecret = (blob: string, key = loadMfaKey()) =>
  decryptToken(blob, key);

export function newTotpSecret(): string {
  return base32Encode(crypto.randomBytes(TOTP_SECRET_BYTES));
}

export function generateRecoveryCodes(
  n: number = MFA_RECOVERY_CODE_COUNT,
): string[] {
  const codes = new Set<string>();
  while (codes.size < n) {
    const raw = base32Encode(crypto.randomBytes(MFA_RECOVERY_CODE_BYTES));
    codes.add(raw.match(/.{4}/g)!.join("-"));
  }
  return [...codes];
}

/** Upper-case, drop spaces/dashes; null unless exactly 16 base32 chars. */
export function normalizeRecoveryCode(input: string): string | null {
  const clean = input.toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z2-7]{16}$/.test(clean) ? clean : null;
}

export function hashRecoveryCode(userId: string, normalized: string): string {
  return crypto
    .createHash("sha256")
    .update(`${userId}:${normalized}`)
    .digest("hex");
}

export function newChallengeToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashChallengeToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
```

Append to `.env.example`:

```
# Encrypts authenticator-app (TOTP) secrets at rest. 32 random bytes, base64:
#   openssl rand -base64 32
# Unset ⇒ 2FA setup answers MFA_UNAVAILABLE. Never reuse JWT_SECRET.
MFA_SECRET_ENC_KEY=
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(server): MFA secret encryption, recovery codes and challenge tokens`.

---

### Task 3: Schema and migration

**Files:** Modify `shared/schema.ts`; create `migrations/0018_mfa_totp.sql`; test `server/storage/__tests__/mfa-schema.test.ts`

**Produces (Drizzle):** `users.mfaEnabledAt` (`timestamptz`, nullable — non-null ⇔ 2FA on; NOT a secret, safe on every user row); tables `userMfa`, `mfaRecoveryCodes`, `mfaChallenges` and their `$inferSelect` types `UserMfa`, `MfaChallenge`.

- [ ] **Step 1: Failing test** (real DB via `test/db-test-utils`, same header as `users-password-reset.test.ts`): insert a user, a `user_mfa` row, two recovery codes and a challenge; delete the user; assert all three tables are empty for that user (cascade), and that inserting the same `(user_id, code_hash)` twice throws a unique violation.

- [ ] **Step 2:** Run `npx vitest run server/storage/__tests__/mfa-schema.test.ts` → FAIL.

- [ ] **Step 3: Implement.** In `users`, after `tokenVersion`:

```ts
    /**
     * When the second factor (authenticator app) was turned on; NULL = off.
     * Not a secret — the secret lives in user_mfa. Read by
     * secondFactor.requiresSecondFactor on every sign-in path.
     */
    mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
```

New tables (place after `pendingSocialSignIns`):

```ts
/** One row per account that has started or finished 2FA setup. Never serialized. */
export const userMfa = pgTable("user_mfa", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** AES-256-GCM (MFA_SECRET_ENC_KEY) of the base32 secret; NULL until confirmed. */
  totpSecretEnc: text("totp_secret_enc"),
  /** Highest accepted TOTP time step — replay guard (a code is usable once). */
  totpLastStep: integer("totp_last_step"),
  /** Setup in progress: encrypted candidate secret + its expiry. */
  pendingSecretEnc: text("pending_secret_enc"),
  pendingExpiresAt: timestamp("pending_expires_at", { withTimezone: true }),
  /** Consecutive failed second-factor checks (reset by any success). */
  failedAttempts: integer("failed_attempts").default(0).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
});

export const mfaRecoveryCodes = pgTable(
  "mfa_recovery_codes",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256(`${userId}:${normalizedCode}`) — server/lib/mfa/mfa-secrets.ts */
    codeHash: text("code_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("mfa_recovery_codes_user_hash_unique").on(t.userId, t.codeHash),
  ],
);

/** A password/provider check passed; the second factor has not. Single use. */
export const mfaChallenges = pgTable(
  "mfa_challenges",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** users.token_version at creation — a reset/sign-out-everywhere kills it. */
    tokenVersion: integer("token_version").notNull(),
    purpose: text("purpose").notNull(), // "login" | "link"
    /** purpose=link: sha256 of the pending link ticket, completed only after verify. */
    linkTicketHash: text("link_ticket_hash"),
    linkMarkEmailVerified: boolean("link_mark_email_verified")
      .default(false)
      .notNull(),
    attempts: integer("attempts").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [
    index("mfa_challenges_user_id_idx").on(t.userId),
    check(
      "mfa_challenges_purpose_check",
      sql`${t.purpose} IN ('login', 'link')`,
    ),
  ],
);
export type UserMfa = typeof userMfa.$inferSelect;
export type MfaChallenge = typeof mfaChallenges.$inferSelect;
```

`migrations/0018_mfa_totp.sql` — header copies 0017's ordering rule:

```sql
-- Second factor (authenticator app + recovery codes).
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle selects users.mfa_enabled_at on every user load (Drizzle lists columns
-- by name), so it must exist before that bundle deploys. Applying early is safe
-- for the old bundle: a new nullable column and three new tables it never reads.
-- Additive and idempotent; no backfill. Constraint names match Drizzle's.

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled_at timestamp with time zone;

CREATE TABLE IF NOT EXISTS user_mfa (
  user_id varchar NOT NULL PRIMARY KEY
    CONSTRAINT user_mfa_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  totp_secret_enc text,
  totp_last_step integer,
  pending_secret_enc text,
  pending_expires_at timestamp with time zone,
  failed_attempts integer DEFAULT 0 NOT NULL,
  locked_until timestamp with time zone
);

CREATE TABLE IF NOT EXISTS mfa_recovery_codes (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT mfa_recovery_codes_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS mfa_recovery_codes_user_hash_unique
  ON mfa_recovery_codes (user_id, code_hash);

CREATE TABLE IF NOT EXISTS mfa_challenges (
  token_hash text NOT NULL PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT mfa_challenges_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  token_version integer NOT NULL,
  purpose text NOT NULL CONSTRAINT mfa_challenges_purpose_check CHECK (purpose IN ('login', 'link')),
  link_ticket_hash text,
  link_mark_email_verified boolean DEFAULT false NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX IF NOT EXISTS mfa_challenges_user_id_idx ON mfa_challenges (user_id);
```

Apply locally: `psql postgresql://localhost/nutricam -f migrations/0018_mfa_totp.sql`, then `npm run db:push` must report **no changes** (constraint names match). If it proposes changes, fix the SQL names, not the schema.

- [ ] **Step 4:** Run the schema test → PASS. Confirm `serializeUser` (`server/routes/_serialize-user.ts`) is an explicit field list (it is: it takes named fields), so `mfaEnabledAt` is not leaked raw.
- [ ] **Step 5:** Commit `feat(db): MFA tables and users.mfa_enabled_at (migration 0018)`.

---

### Task 4: MFA storage

**Files:** Create `server/storage/mfa.ts`, `server/storage/__tests__/mfa.test.ts`; modify `server/storage/index.ts`, `server/storage/identities.ts`

**Interfaces — Produces (all on `storage.*`):**

- `startTotpEnrollment(userId, pendingSecretEnc): Promise<void>` — upsert pending secret, expiry `now() + MFA_ENROLL_TTL_MINUTES`.
- `getPendingTotpSecret(userId): Promise<string | undefined>` — only if unexpired.
- `confirmTotpEnrollment(userId, { acceptedStep, recoveryHashes }): Promise<number | undefined>` — ONE transaction: pending→active (guarded on pending unexpired and `mfa_enabled_at IS NULL`), `totp_last_step = acceptedStep`, counters reset, replace recovery codes, `users.mfa_enabled_at = now()`, `token_version + 1`; returns the new tokenVersion.
- `getActiveTotp(userId): Promise<{ secretEnc: string; lastStep: number | null; failedAttempts: number; locked: boolean } | undefined>` — `locked` computed in SQL (`locked_until > now()`).
- `acceptTotpStep(userId, step): Promise<boolean>` — `UPDATE user_mfa SET totp_last_step = $step, failed_attempts = 0, locked_until = NULL WHERE user_id = $1 AND (totp_last_step IS NULL OR totp_last_step < $step) AND (locked_until IS NULL OR locked_until <= now()) RETURNING`.
- `recordMfaFailure(userId): Promise<number>` — `failed_attempts + 1`; when the new value is a multiple of `MFA_LOCK_EVERY_FAILURES`, `locked_until = now() + MFA_LOCK_MINUTES`; returns the new count.
- `consumeRecoveryCode(userId, codeHash, replacementHash): Promise<boolean>` — ONE transaction: `DELETE … WHERE user_id AND code_hash RETURNING`; if deleted, insert the replacement and reset `failed_attempts`/`locked_until`.
- `replaceRecoveryCodes(userId, hashes): Promise<void>`; `countRecoveryCodes(userId): Promise<number>`.
- `disableMfa(userId): Promise<number | undefined>` — transaction: delete `user_mfa`, recovery codes, challenges; `mfa_enabled_at = NULL`; `token_version + 1`; returns new tokenVersion.
- `createMfaChallenge({ tokenHash, userId, tokenVersion, purpose, linkTicketHash?, linkMarkEmailVerified? }): Promise<void>` — expiry `now() + MFA_CHALLENGE_TTL_MINUTES`; also deletes this user's expired challenges.
- `reserveMfaChallengeAttempt(tokenHash): Promise<MfaChallenge | undefined>` — `attempts + 1 WHERE token_hash AND expires_at > now() AND attempts < MFA_CHALLENGE_MAX_ATTEMPTS RETURNING *`.
- `consumeMfaChallenge(tokenHash): Promise<boolean>` — `DELETE … RETURNING`.
- In `identities.ts`: `completeLinkByTicketHash(ticketHash, opts)` with the body of today's `completeLinkFromTicket`; `completeLinkFromTicket(ticket, opts)` becomes `completeLinkByTicketHash(sha256Hex(ticket), opts)`.

- [ ] **Step 1: Failing tests** (real DB, `users-password-reset.test.ts` header). One `it` per behavior; the load-bearing ones written out:

```ts
it("acceptTotpStep accepts a step once and refuses it (and older) after", async () => {
  await confirmEnrolled(testUser.id, 100); // helper: start + confirm with acceptedStep 100
  expect(await mfa.acceptTotpStep(testUser.id, 100)).toBe(false); // same step
  expect(await mfa.acceptTotpStep(testUser.id, 99)).toBe(false);
  expect(await mfa.acceptTotpStep(testUser.id, 101)).toBe(true);
  expect(await mfa.acceptTotpStep(testUser.id, 101)).toBe(false);
});

it("two concurrent accepts of the same step: exactly one wins", async () => {
  await confirmEnrolled(testUser.id, 100);
  const r = await Promise.all([
    mfa.acceptTotpStep(testUser.id, 101),
    mfa.acceptTotpStep(testUser.id, 101),
  ]);
  expect(r.filter(Boolean)).toHaveLength(1);
});

it("every 10th failure locks; a lock refuses acceptTotpStep until it lapses", async () => {
  await confirmEnrolled(testUser.id, 100);
  for (let i = 1; i <= 9; i++) await mfa.recordMfaFailure(testUser.id);
  expect((await mfa.getActiveTotp(testUser.id))!.locked).toBe(false);
  expect(await mfa.recordMfaFailure(testUser.id)).toBe(10);
  expect((await mfa.getActiveTotp(testUser.id))!.locked).toBe(true);
  expect(await mfa.acceptTotpStep(testUser.id, 200)).toBe(false);
  await tx.execute(
    sql`UPDATE user_mfa SET locked_until = now() - interval '1 second' WHERE user_id = ${testUser.id}`,
  );
  expect(await mfa.acceptTotpStep(testUser.id, 200)).toBe(true);
  expect((await mfa.getActiveTotp(testUser.id))!.failedAttempts).toBe(0);
});

it("a recovery code works once and is replaced", async () => {
  await confirmEnrolled(testUser.id, 100, ["h1", "h2"]);
  expect(await mfa.consumeRecoveryCode(testUser.id, "h1", "h3")).toBe(true);
  expect(await mfa.consumeRecoveryCode(testUser.id, "h1", "h4")).toBe(false);
  expect(await mfa.countRecoveryCodes(testUser.id)).toBe(2); // h2 + h3
});

it("confirm bumps tokenVersion and sets mfa_enabled_at; a second confirm is a no-op", async () => {
  const before = testUser.tokenVersion;
  await mfa.startTotpEnrollment(testUser.id, "enc");
  expect(
    await mfa.confirmTotpEnrollment(testUser.id, {
      acceptedStep: 5,
      recoveryHashes: ["a"],
    }),
  ).toBe(before + 1);
  expect(
    await mfa.confirmTotpEnrollment(testUser.id, {
      acceptedStep: 6,
      recoveryHashes: ["b"],
    }),
  ).toBeUndefined();
  const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
  expect(u.mfaEnabledAt).not.toBeNull();
});

it("an expired pending secret cannot be confirmed", async () => {
  /* set pending_expires_at in the past → undefined */
});

it("disableMfa clears everything and bumps tokenVersion", async () => {
  /* rows gone, mfa_enabled_at null, version +1 */
});

it("challenge: 5 reservations then refused; expired refused; consume once", async () => {
  await mfa.createMfaChallenge({
    tokenHash: "t",
    userId: testUser.id,
    tokenVersion: 0,
    purpose: "login",
  });
  for (let i = 0; i < 5; i++)
    expect(await mfa.reserveMfaChallengeAttempt("t")).toBeDefined();
  expect(await mfa.reserveMfaChallengeAttempt("t")).toBeUndefined();
  expect(await mfa.consumeMfaChallenge("t")).toBe(true);
  expect(await mfa.consumeMfaChallenge("t")).toBe(false);
});
```

Write the two `/* … */` bodies as real assertions in the same style — they are listed here only for brevity of the plan, not to be skipped.

- [ ] **Step 2:** Run `npx vitest run server/storage/__tests__/mfa.test.ts` → FAIL.
- [ ] **Step 3: Implement** `server/storage/mfa.ts` following `password-reset.ts` exactly: `db.update(...).set(...).where(and(...)).returning(...)`; every time comparison is `sql\`… now()\``; multi-statement operations use `db.transaction(async (tx) => …)`. Lock-on-multiple-of-10:

```ts
export async function recordMfaFailure(userId: string): Promise<number> {
  const next = sql`${userMfa.failedAttempts} + 1`;
  const [row] = await db
    .update(userMfa)
    .set({
      failedAttempts: next,
      lockedUntil: sql`CASE WHEN (${next}) % ${MFA_LOCK_EVERY_FAILURES} = 0
        THEN now() + (${MFA_LOCK_MINUTES} * interval '1 minute')
        ELSE ${userMfa.lockedUntil} END`,
    })
    .where(eq(userMfa.userId, userId))
    .returning({ failedAttempts: userMfa.failedAttempts });
  return row?.failedAttempts ?? 0;
}
```

Register every function in `server/storage/index.ts` under a `// Second factor` comment.

- [ ] **Step 4:** Run → PASS. Also run `npx vitest run server/storage/__tests__/identities.test.ts` (the link refactor must not change behavior).
- [ ] **Step 5:** Commit `feat(storage): atomic MFA enrollment, step replay guard, lockout, recovery codes, challenges`.

---

### Task 5: Second-factor verification (no HTTP)

**Files:** Create `server/lib/mfa/verify-second-factor.ts`, `server/lib/mfa/__tests__/verify-second-factor.test.ts`

**Interfaces — Consumes:** Task 1 `matchTotp`, `base32Decode`; Task 2 `decryptMfaSecret`, `normalizeRecoveryCode`, `hashRecoveryCode`, `generateRecoveryCodes`; Task 4 storage functions.
**Produces:**

```ts
export type SecondFactorProof = { code: string } | { recoveryCode: string };
export type SecondFactorResult =
  | { ok: true; usedRecoveryCode: boolean; replacementRecoveryCode?: string }
  | { ok: false; reason: "invalid" | "locked" };
export async function verifySecondFactor(
  userId: string,
  proof: SecondFactorProof,
  nowMs?: number,
): Promise<SecondFactorResult>;
```

Rules: no active TOTP → `invalid`. `locked` (from `getActiveTotp`) → `locked` for BOTH proof kinds, without counting. TOTP proof when `failedAttempts >= MFA_TOTP_FAILURE_CAP` → `invalid` without matching (recovery code only). TOTP match → `acceptTotpStep(step)`; false (replay or a lock that began in between) → `recordMfaFailure`, `invalid`. Recovery proof → normalize (null ⇒ failure), hash, `consumeRecoveryCode(userId, hash, hashOf(replacement))`; true ⇒ `{ ok, usedRecoveryCode: true, replacementRecoveryCode }`. Every non-locked failure calls `recordMfaFailure` exactly once.

- [ ] **Step 1: Failing tests** with `vi.mock("../../../storage")` and a fixed secret/`nowMs`: correct code → ok and `acceptTotpStep` called with the matched step; correct code but `acceptTotpStep` false → invalid + one failure recorded; wrong code → invalid + one failure; locked → `locked`, no failure recorded, `matchTotp` not consulted; `failedAttempts = 100` + correct TOTP → invalid; `failedAttempts = 100` + good recovery code → ok; malformed recovery code → invalid + one failure; good recovery code → ok with a replacement that matches `/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/` and whose hash was passed to `consumeRecoveryCode`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(server): verifySecondFactor with replay guard, lockout and the 100-failure cap`.

---

### Task 6: The gate — `beginSession`

**Files:** Create `server/lib/mfa/begin-session.ts` + test; modify `server/lib/social-identity/sign-in-gates.ts` (+ its test), `server/routes/auth.ts` (login), `server/routes/auth-social.ts` (sign_in, auto_link, link); update `server/routes/__tests__/auth.test.ts`, `auth-social.test.ts`

**Interfaces — Produces:**

```ts
export type MfaRequired = { status: "mfa_required"; challenge: string };
export async function beginSession(
  user: { id: string; tokenVersion: number; mfaEnabledAt: Date | null },
  opts?: { link?: { ticket: string; markEmailVerified: boolean } },
): Promise<Awaited<ReturnType<typeof issueSession>> | MfaRequired>;
```

- No 2FA → `opts.link` ? (`completeLinkFromTicket` then `issueSession`) : `issueSession(user.id)`. (Moving the link completion inside keeps "link, then mint" in one place.)
- 2FA on → `createMfaChallenge({ tokenHash: hashChallengeToken(t), userId, tokenVersion, purpose: link ? "link" : "login", linkTicketHash: link && sha256Hex(link.ticket), linkMarkEmailVerified })` and return `{ status: "mfa_required", challenge: t }`. **Nothing else is written.**
- `sign-in-gates.ts`: `requiresSecondFactor(user: { mfaEnabledAt: Date | null })` returns `user.mfaEnabledAt !== null`. `signInGate` drops its second-factor branch (it now only checks email verification); update the file's doc comment: "second factor is enforced by beginSession, which every existing-account session goes through".
- Call sites:
  - `auth.ts` login: replace the `generateToken` + `res.json` with `res.json(await beginSession(user))` (response gains `status: "signed_in"`; `user`/`token` unchanged).
  - `auth-social.ts` sign_in: `return res.json(await beginSession(user))` (the existing refresh-token/touch writes for an ALREADY-linked identity stay — they link nothing).
  - auto_link: keep the policy refusal (`linking-policy.ts` never auto-links a second-factor account); add a defensive `if (secondFactor.requiresSecondFactor(user)) throw new HttpFailure(403, ErrorCode.SECOND_FACTOR_REQUIRED, "Second factor required");` before `insertIdentity`.
  - link: replace `completeLinkFromTicket` + `issueSession(target.id)` with `res.json(await beginSession(target, { link: { ticket: body.ticket, markEmailVerified } }))`; keep the `isUniqueViolation` → 409 mapping around it and the `!identity → expired` check inside `beginSession`'s no-2FA branch (throw the same `HttpFailure`).
  - complete-sign-up: unchanged (a brand-new account has no 2FA).

- [ ] **Step 1: Failing tests.** `begin-session.test.ts` (mocked storage): 2FA off → `issueSession` result; 2FA on → `mfa_required`, challenge stored with the user's `tokenVersion`, `issueSession` NOT called; link + 2FA on → challenge has `purpose: "link"` and `linkTicketHash === sha256Hex(ticket)`, `completeLinkFromTicket` NOT called. Route tests: login for a `mfaEnabledAt` user answers **200** `{ status: "mfa_required", challenge: expect.any(String) }` and never calls `generateToken`; social sign_in same; `/api/auth/social/link` with a 2FA target answers 200 `mfa_required` and `completeLinkFromTicket` is never called (Review Focus 3).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run the four test files → PASS.
- [ ] **Step 5:** Commit `feat(auth): every existing-account session goes through beginSession (2FA challenge)`.

---

### Task 7: `POST /api/auth/mfa/verify`

**Files:** Create `server/routes/auth-mfa.ts`, `server/routes/__tests__/auth-mfa-verify.test.ts`; modify the route registry that calls `registerAuthSocial` (register `auth-mfa` beside it — find it with `grep -rn "auth-social" server/routes/index.ts server/routes.ts`), `server/routes/_schemas.ts`, `server/routes/_rate-limiters.ts`, `shared/constants/error-codes.ts`, `server/services/email.ts`

**Interfaces — Produces:** `mfaVerifySchema = z.object({ challenge: z.string().min(20).max(100) }).and(z.union([z.object({ code: z.string().regex(/^\d{6}$/) }), z.object({ recoveryCode: z.string().min(1).max(40) })]))`; `mfaVerifyLimiter` (IP, 15 min, 30, `keyByUser: false`); error codes `MFA_CHALLENGE_INVALID`, `MFA_CODE_INVALID`, `MFA_LOCKED`, `MFA_UNAVAILABLE`, `MFA_ALREADY_ENABLED`, `MFA_NOT_ENABLED`; `sendTwoFactorNotice(to, username, kind: "enabled" | "disabled" | "recovery_code_used" | "recovery_codes_replaced")` (same shape as `sendPasswordChangedNotice`, `account-security` cap).

Handler order:

1. Parse; 400 on failure.
2. `row = reserveMfaChallengeAttempt(hashChallengeToken(challenge))`; none → **401 `MFA_CHALLENGE_INVALID`** ("This sign-in expired. Please sign in again.").
3. `user = getUserForAuth(row.userId)`; missing or `user.tokenVersion !== row.tokenVersion` → `consumeMfaChallenge`, 401 `MFA_CHALLENGE_INVALID` (Review Focus 2).
4. `result = verifySecondFactor(user.id, proof)`; `locked` → **429 `MFA_LOCKED`** ("Too many wrong codes. Try again in 15 minutes, or use a recovery code later."); `invalid` → **401 `MFA_CODE_INVALID`** ("That code didn't work. Check your authenticator app and try again.").
5. `consumeMfaChallenge` false (a concurrent success won) → 401 `MFA_CHALLENGE_INVALID`.
6. `purpose === "link"` → `completeLinkByTicketHash(row.linkTicketHash!, { markEmailVerified: row.linkMarkEmailVerified })`; undefined → 401 `MFA_CHALLENGE_INVALID`; unique violation → 409 `IDENTITY_IN_USE`.
7. `session = issueSession(user.id)`; if `result.usedRecoveryCode` → `fireAndForget("mfa-recovery-notice", sendTwoFactorNotice(user.email, user.username, "recovery_code_used"))`.
8. `res.json({ ...session, ...(result.replacementRecoveryCode && { replacementRecoveryCode: result.replacementRecoveryCode }) })`.

Never log the code, recovery code, or challenge (assert with the `mockLog` pattern from `auth-password-reset.test.ts`).

- [ ] **Step 1: Failing tests** for each numbered branch, plus: two concurrent verifies with the same valid code → exactly one 200 (mock `acceptTotpStep` to resolve true once, false after) (Review Focus 1); recovery-code success response carries `replacementRecoveryCode` and sends the notice; no secret value appears in any log call.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(auth): POST /api/auth/mfa/verify completes a challenged sign-in`.

---

### Task 8: Setup, confirm, disable, new recovery codes, `/me`

**Files:** Modify `server/routes/auth-mfa.ts`, `server/routes/auth.ts` (`/me`), `server/routes/_schemas.ts`; test `server/routes/__tests__/auth-mfa-manage.test.ts`

All four routes: `requireAuth`, `reauthLimiter`; `me = storage.getUserForAuth(req.userId)`.

| Route                               | Body                                                       | Checks                                                                                                                                                         | Effect                                                                                                                                                       | Response                                                  |
| ----------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| `POST /api/auth/mfa/totp/setup`     | `reauthProofSchema`                                        | `reauthenticate(me.id, me.password, proof)` else 401 `UNAUTHORIZED`; `me.mfaEnabledAt` → 409 `MFA_ALREADY_ENABLED`; `!mfaConfigured()` → 503 `MFA_UNAVAILABLE` | `secret = newTotpSecret()`; `startTotpEnrollment(me.id, encryptMfaSecret(secret))`                                                                           | `{ secret, otpauthUrl: otpauthUrl(secret, me.username) }` |
| `POST /api/auth/mfa/totp/confirm`   | `{ code }`                                                 | pending secret exists else 400 `MFA_CODE_INVALID`; `matchTotp` else 400 `MFA_CODE_INVALID`                                                                     | `codes = generateRecoveryCodes()`; `v = confirmTotpEnrollment(...)` (undefined → 409 `MFA_ALREADY_ENABLED`); `invalidateTokenVersionCache`; notice `enabled` | `{ ...issueSession(me.id), recoveryCodes: codes }`        |
| `POST /api/auth/mfa/disable`        | `reauthProofSchema` AND (`{ code }` \| `{ recoveryCode }`) | reauth; not enabled → 409 `MFA_NOT_ENABLED`; `verifySecondFactor` (locked → 429, invalid → 401 `MFA_CODE_INVALID`)                                             | `disableMfa`; `invalidateTokenVersionCache`; notice `disabled`                                                                                               | `issueSession(me.id)`                                     |
| `POST /api/auth/mfa/recovery-codes` | `reauthProofSchema` AND `{ code }`                         | reauth; enabled; `verifySecondFactor` with the code                                                                                                            | `replaceRecoveryCodes`; notice `recovery_codes_replaced`                                                                                                     | `{ recoveryCodes }`                                       |

`/api/auth/me` adds `twoFactor: { enabled: user.mfaEnabledAt !== null, recoveryCodesRemaining: enabled ? await storage.countRecoveryCodes(user.id) : 0 }`.

`reauthenticate` is exported from `auth-social.ts` today; import it from there (do not copy it).

- [ ] **Step 1: Failing tests:** each row's happy path and each check's failure; setup never returns a secret without a passing re-auth; confirm's response token was minted AFTER the version bump (mock `confirmTotpEnrollment` → 4, `getUser` → tokenVersion 4, assert `generateToken` called with 4); `/me` never contains `totpSecretEnc`, `pendingSecretEnc` or any `code_hash` (serialize a fully-populated row and assert the key set).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(auth): 2FA setup, confirm, turn-off and new recovery codes`.

---

### Task 9: Real-database gate test

**Files:** Modify `test/integration/auth-routes.itest.ts`

Real server, real DB, real `requireAuth` (route tests mock it, so only this suite can catch a token mint that skips the gate). Set `process.env.MFA_SECRET_ENC_KEY` to a fixed test key in the suite's setup.

- [ ] **Step 1: Write the tests:**
  1. Register + verify a user, `POST /setup` with the password, compute the code from the returned secret with `hotp(base32Decode(secret), timeStep(Date.now()))`, `POST /confirm` → 200 with 10 recovery codes and a token.
  2. `POST /api/auth/login` → **200** `{ status: "mfa_required", challenge }` and **no** `token` key.
  3. `GET /api/auth/me` with `Authorization: Bearer <challenge>` → **401**.
  4. Verify with the current code → 200 + token; `GET /me` with it → 200 and `twoFactor.enabled === true`.
  5. Log in again; verify with the SAME code as step 4 → 401 `MFA_CODE_INVALID` (replay); verify with a recovery code → 200 with `replacementRecoveryCode`; the same recovery code again on a fresh challenge → 401.
  6. The token from step 1's confirm still works; a token minted BEFORE confirm → 401 `TOKEN_REVOKED`.
- [ ] **Step 2:** Run `npm run test:integration:http` with local Postgres → PASS (each step is a positive control for the next: step 2 must FAIL if `beginSession` is bypassed — check that once by temporarily reverting the login call site, then restore).
- [ ] **Step 3:** Commit `test(integration): 2FA gate end to end against a real database`.

---

### Task 10: Client — challenge screen and every sign-in path

**Files:** Modify `shared/types/auth.ts`, `client/hooks/useAuth.ts`, `client/context/AuthContext.tsx`, `client/screens/LoginScreen.tsx`, `client/components/SocialSignInButtons.tsx`, `client/screens/ConnectAccountScreen.tsx`, `client/navigation/RootStackNavigator.tsx`; create `client/screens/MfaChallengeScreen.tsx`, `client/screens/MfaChallengeScreen-utils.ts`, tests for both

**Interfaces — Produces:**

```ts
// shared/types/auth.ts
export type MfaChallengeResult = { status: "mfa_required"; challenge: string };
export type SignedInResult = { status: "signed_in"; user: User; token: string };
export type SessionResult = SignedInResult | MfaChallengeResult;
export interface MfaVerifyResult extends SignedInResult {
  replacementRecoveryCode?: string;
}
export interface TwoFactorStatus {
  enabled: boolean;
  recoveryCodesRemaining: number;
}
// SocialSignInResult gains `| MfaChallengeResult`.
// ApiError["code"] gains "MFA_CHALLENGE_INVALID" | "MFA_CODE_INVALID" | "MFA_LOCKED".
```

- `useAuth`: `login`, `linkWithPassword`, `linkWithProvider` return `SessionResult` (they `establishSession` only on `signed_in`); `signInWithProvider` already returns the union. New `verifySecondFactor(challenge, proof): Promise<MfaVerifyResult>` (does NOT establish the session) and `finishSignIn(user, token)` (= `establishSession`), both exposed through `AuthContext`.
- Route param: `MfaChallenge: { challenge: string }` in `RootStackParamList`, registered in the `!isAuthenticated` group beside `ResetPassword`, title "Two-step verification".
- Callers: `LoginScreen` (`if (result.status === "mfa_required") navigation.navigate("MfaChallenge", { challenge: result.challenge })`), `SocialSignInButtons` (same, beside its existing `choose_username`/`link_required` handling), `ConnectAccountScreen` (`navigation.replace("MfaChallenge", …)` for both handlers).
- `MfaChallengeScreen-utils.ts`: `normalizeCodeInput(raw): string` (digits only, max 6); `getMfaErrorMessage(err): { message: string; restart: boolean }` keyed on `ApiError.code` (`MFA_CHALLENGE_INVALID` → restart true; `MFA_LOCKED`; `MFA_CODE_INVALID`; default "Couldn't check that code. Please try again.").
- Screen: one code field (`textContentType="oneTimeCode"`, `keyboardType="number-pad"`, autofocus, auto-submits at 6 digits), a "Use a recovery code instead" toggle (text field, `autoCapitalize="characters"`), errors via `InlineError`. On success: no replacement → `finishSignIn`; replacement → show it in a card ("Your recovery code was used. Here's a new one — save it now.") with Copy (`expo-clipboard`) and a "I've saved it" button that calls `finishSignIn`. `restart` errors → `navigation.popToTop()` with the message shown on Login. Root `accessibilityViewIsModal` not needed (stack screen, not modal).

- [ ] **Step 1: Failing tests:** utils table tests; `useAuth` test: `login` returns the challenge and does NOT write `tokenStorage` (mock `apiRequest`); screen test (`renderComponent` harness, `reference_client_component_test_harness`): typing 6 digits calls `verifySecondFactor` once; replacement code renders and `finishSignIn` waits for the button; `MFA_CHALLENGE_INVALID` pops to top. `LoginScreen` test: `mfa_required` navigates with the challenge.
- [ ] **Step 2:** Run the client tests → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(client): two-step verification screen on every sign-in path`.

---

### Task 11: Client — Settings: turn on, turn off, new recovery codes

**Files:** Create `client/screens/TwoFactorSetupScreen.tsx`, `client/screens/TwoFactorSetupScreen-utils.ts` + tests; modify `client/hooks/useAuth.ts`, `client/context/AuthContext.tsx`, `client/navigation/ProfileStackNavigator.tsx`, `client/screens/SignInMethodsScreen.tsx`

**Interfaces — Consumes:** `DeleteAccountProof` and the existing provider re-auth in `deleteAccount` — extract its proof-to-body code into a private `reauthBody(proof): Promise<Record<string, string> | null>` in `useAuth.ts` (null = sheet cancelled) and use it in `deleteAccount` and the new calls (no copy).
**Produces (useAuth / AuthContext):** `startTwoFactorSetup(proof) → { secret, otpauthUrl } | null`, `confirmTwoFactor(code) → string[]` (stores the returned token via `establishSession`), `disableTwoFactor(proof, second) → void` (stores the new token), `replaceRecoveryCodes(proof, code) → string[]`; `TwoFactorSetup: undefined` in `ProfileStackParamList`.

- Utils: `formatSetupKey(b32) → "ABCD EFGH …"` (groups of 4); `recoveryCodesText(codes) → string` (one per line, header "OCRecipes recovery codes — each works once"); `getTwoFactorErrorMessage(err)`.
- Screen states: `confirm-identity` (password field, or "Continue with Apple/Google" for password-less accounts — same split `SignInMethodsScreen` already makes for delete) → `add-key` ("Open in authenticator app" = `Linking.openURL(otpauthUrl)` in a try/catch that falls back to a "No authenticator app found — copy the key instead" `InlineError`; the grouped key with Copy) → `enter-code` → `save-codes` (list, Copy all, "I've saved them") → done. When already on: "Turn off two-step verification" and "Get new recovery codes" (both: confirm identity + a current code), and the remaining-codes count from `/me`'s `twoFactor`.
- `SignInMethodsScreen`: a "Two-step verification — On/Off" row navigating to `TwoFactorSetup`.

- [ ] **Step 1: Failing tests:** utils; `useAuth.confirmTwoFactor` stores the new token; screen: walks setup to the codes, Copy all copies `recoveryCodesText`, `openURL` rejection shows the fallback, "Turn off" requires both proof and code before calling.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(client): turn two-step verification on and off in Sign-in methods`.

---

### Task 12: Finish

- [ ] Simulator check (`verify-ui` skill, iPhone 17 Pro UDID, local server with `MFA_SECRET_ENC_KEY` in `.env`): turn on with demo/demo123 (compute codes with a one-line `node -e` using `hotp` from the server lib, since there is no authenticator app on the simulator), sign out, sign in → challenge → code → in; recovery code path shows a replacement; turn off.
- [ ] Push (preflight:fast), open the PR with label `security` and the "Owner actions" section copied into the body; dispatch the four reviewers with the `docs/AI_WORKFLOW.md` prompt verbatim.
- [ ] After review: `/codify` the challenge-row + `beginSession` pattern; update the todo's Updates section; **do not archive the todo** (passkeys and the password-policy items remain).
- [ ] Ask the owner to run the two Owner actions, then ask before merging.
