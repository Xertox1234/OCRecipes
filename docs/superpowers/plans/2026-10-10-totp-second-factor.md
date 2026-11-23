# TOTP Second Factor (Part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an account with a password turn on an authenticator-app second factor (with recovery codes and 90-day trusted phones), required on every PASSWORD proof of identity, never on a Google/Apple proof.

**Architecture:** A correct password on an MFA account yields a short-lived **challenge row** (opaque random token, not a JWT), answered `200 { status: "mfa_required", challenge }`; `POST /api/auth/mfa/verify` checks the code and only then mints the normal token. Signed-in routes that take a password as proof (connect a sign-in method, delete account, change email) take the code inline through one helper. Every counter (challenge attempts, account failures, TOTP replay step, single-use recovery codes) is one atomic SQL statement on the database clock, the pattern of `server/storage/password-reset.ts`.

**Tech Stack:** Express 5 + Drizzle/PostgreSQL; `node:crypto` only (TOTP hand-written against RFC 6238 vectors — no new server dependency); Expo/React Native client with no new native module (ships by OTA).

**Spec:** `docs/superpowers/specs/2026-10-10-totp-second-factor-design.md` (rev 2, owner-approved 2026-10-10). Supersedes `docs/superpowers/plans/2026-10-05-totp-second-factor.md` (Tasks 1–2 code is carried over verbatim; the rest is re-derived for D1).

## Plan-level deviations from the spec (flag to the owner at plan review)

1. **Lockout counter never resets on lock.** Spec §6's SQL resets `failed_attempts` to 0 at 10, so the count can never reach SP 800-63B-4's 100-consecutive-failure cap — unlimited guessing over time. Instead: every 10th consecutive failure locks 15 minutes and `tripped = (new count % 10 = 0)`; at **100** consecutive failures the TOTP code is refused and only a recovery code works (80-bit, unguessable). Any success resets to 0.
2. **"Has MFA" is `users.mfa_enabled_at`** (non-null ⇔ on), not a join on `user_totp.confirmed_at`: every sign-in path already loads the user row, and `decideLink`'s `hasSecondFactor` needs it without another query. The secret row is `user_mfa`.
3. **Expired challenges and trusted phones are deleted opportunistically per user** (on insert), not by `server/scripts/cleanup-retention.ts`: that job is a user-data retention purge, gated off until `RETENTION_CLEANUP_ENABLED` (≥ 2026-11-03), and it exempts active users — the wrong tool for expired tokens.
4. **Recovery codes are deleted on use** (`DELETE … RETURNING`), not marked `used_at`. Same single-use guarantee, nothing to clean up.
5. **The link challenge stores the pending ticket's hash** (`link_ticket_hash`) rather than an FK to `pending_social_sign_ins` — `completeLinkFromTicket` already guards `kind = 'link' AND expires_at > now()` (`server/storage/identities.ts:183-185`, checked 2026-10-10), and `completeLinkByTicketHash` keeps that guard, so an expired ticket fails closed.
6. **Table name `mfa_trusted_devices`** (spec: `trusted_devices`) so all MFA tables share a prefix. **Error codes:** `MFA_CHALLENGE_EXPIRED`, `INVALID_SECOND_FACTOR`, plus `MFA_UNAVAILABLE`, `MFA_ALREADY_ENABLED`, `MFA_NOT_ENABLED`, `MFA_NEEDS_PASSWORD`, `MFA_SETUP_DISABLED`.
7. **The Security rows live in `SignInMethodsScreen`** (Profile → Sign-in methods), where connect/disconnect and delete already live, not `SettingsScreen`.

## Owner actions (the PR cannot merge until both are done)

- **Set `MFA_SECRET_ENC_KEY` on Railway** (`openssl rand -base64 32`), copy in the Passwords app. Losing it = every MFA user needs a recovery code or the manual runbook.
- **Apply `migrations/0018_mfa_totp.sql` to production BEFORE merging** (same rule as 0017): the new bundle selects `users.mfa_enabled_at` on every user load.
- After the device test: set `MFA_SETUP_ENABLED=true` on Railway (spec §8).

## Global Constraints

- **Never delegate auth implementation** (memory `project_auth_recurring_breakage`): every task runs in-session; any executor output is reviewed line by line.
- **D1:** the second factor is required only where a PASSWORD is the proof. A Google/Apple proof (sign-in with an already-linked identity, the provider branch of `/social/link`, a provider `reauth` proof) never needs it.
- TOTP: HMAC-SHA-1, 6 digits, 30-second step, **±1 step** (RFC 6238 defaults).
- A "code required" answer to **login and `/social/link` is HTTP 200** `{ status: "mfa_required", challenge }`, never 4xx: `loginAccountLimiter` uses `skipSuccessfulRequests`, so a 4xx would count a CORRECT password as a failed login.
- The challenge token must never be accepted by `requireAuth` (asserted against the real middleware in Task 10).
- Every code/counter check is ONE atomic SQL statement using `now()` on the database clock.
- One generic second-factor failure: `401 INVALID_SECOND_FACTOR`, "That code didn't work. After several wrong codes, codes pause for 15 minutes." (also returned while locked — no separate "locked" signal). A dead challenge: `401 MFA_CHALLENGE_EXPIRED`.
- Trusted phone = 90 days; **sign-out does NOT end it** (D5). Ended by: expiry, password reset, turning MFA off, confirming a new phone, "Forget trusted phones".
- **Password reset never requires the factor and never clears MFA** (D7); it deletes trusted phones in the same transaction, and its `tokenVersion` bump kills open challenges.
- Never log a code, recovery code, challenge, trust key or secret.
- Base: a worktree from `origin/main`; PR labelled `security`; reviewers `code-reviewer` + `security-auditor` + `server-reviewer` + `mobile-reviewer` (dispatch prompt verbatim from `docs/AI_WORKFLOW.md`); never auto-merged; ask the owner before merging.

## Review Focus

1. **Sign out, then sign in again on a trusted phone** — the code is skipped (D5). Pinned in Task 7 (server) and Task 12 (client: `logout` leaves the trust key in SecureStore).
2. **A recovery code is spent but the request then fails** (a concurrent verify consumed the challenge first, or the link ticket expired) — the response still carries `replacementRecoveryCode`, since the old code is gone. Pinned in Task 8.
3. **A phone holding user A's trust key signs in as user B** — B is challenged (keys are per user). Pinned in Task 7.
4. **`MFA_SECRET_ENC_KEY` missing on a server where users already have MFA** — `/mfa/verify` answers `503 MFA_UNAVAILABLE`, never a 500 stack or a silent pass. Pinned in Task 5 (`unavailable` result) and Task 8 (route).
5. **Password reset while a challenge is open or a phone is trusted** — the challenge dies (`tokenVersion` mismatch) and the trust is gone. Pinned in Task 4 (storage) and Task 8 (route).

---

## File map

| File                                                                                                                                                                                                                                                                                                                                                      | Responsibility                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `shared/constants/mfa.ts` (new)                                                                                                                                                                                                                                                                                                                           | every MFA number                                                                                                   |
| `server/lib/mfa/totp.ts` (new)                                                                                                                                                                                                                                                                                                                            | base32, HOTP/TOTP, `matchTotp`, `otpauthUrl` — pure                                                                |
| `server/lib/mfa/mfa-secrets.ts` (new)                                                                                                                                                                                                                                                                                                                     | `MFA_SECRET_ENC_KEY`, secret encrypt/decrypt, recovery codes, challenge tokens, trust keys — pure                  |
| `shared/schema.ts`, `migrations/0018_mfa_totp.sql` (new)                                                                                                                                                                                                                                                                                                  | `users.mfa_enabled_at`; `user_mfa`, `mfa_recovery_codes`, `mfa_challenges`, `mfa_trusted_devices`                  |
| `server/storage/mfa.ts` (new), `server/storage/index.ts`, `server/storage/identities.ts`, `server/storage/password-reset.ts`                                                                                                                                                                                                                              | all MFA SQL; `completeLinkByTicketHash`; reset deletes trusted phones                                              |
| `server/lib/mfa/verify-second-factor.ts` (new)                                                                                                                                                                                                                                                                                                            | code / recovery-code check + failure accounting + lock email                                                       |
| `server/lib/mfa/password-proof-gate.ts` (new)                                                                                                                                                                                                                                                                                                             | THE D2 helper for signed-in password proofs                                                                        |
| `server/lib/social-identity/sign-in-gates.ts`                                                                                                                                                                                                                                                                                                             | real `requiresSecondFactor`; `signInGate` loses its second-factor branch                                           |
| `server/routes/auth.ts`, `server/routes/auth-social.ts`                                                                                                                                                                                                                                                                                                   | login challenge + trust key; link challenge; inline proofs on change-email / delete / identities; `/me.mfaEnabled` |
| `server/routes/auth-mfa.ts` (new), `server/routes.ts`                                                                                                                                                                                                                                                                                                     | verify, setup, confirm, reset (new phone), disable, recovery-codes, trusted-devices                                |
| `server/routes/_schemas.ts`, `server/routes/_rate-limiters.ts`, `shared/constants/error-codes.ts`, `server/services/email.ts`                                                                                                                                                                                                                             | schemas, `mfaVerifyLimiter`, codes, `sendTwoFactorNotice`                                                          |
| `test/integration/auth-routes.itest.ts`                                                                                                                                                                                                                                                                                                                   | end-to-end against a real DB + the real `requireAuth`                                                              |
| `scripts/mfa-reset.ts` (new), `docs/runbooks/mfa-manual-reset.md` (new)                                                                                                                                                                                                                                                                                   | lost-phone-and-codes support path                                                                                  |
| `shared/types/auth.ts`, `client/hooks/useAuth.ts`, `client/context/AuthContext.tsx`, `client/lib/token-storage.ts`                                                                                                                                                                                                                                        | result unions, MFA calls, trust key                                                                                |
| `client/lib/second-factor-utils.ts` (new), `client/components/SecondFactorField.tsx` (new)                                                                                                                                                                                                                                                                | shared code input + error mapping                                                                                  |
| `client/screens/TwoStepCodeScreen.tsx` (+ `-utils.ts`) (new)                                                                                                                                                                                                                                                                                              | the challenge screen                                                                                               |
| `client/screens/TwoStepSetupScreen.tsx` (+ `-utils.ts`) (new)                                                                                                                                                                                                                                                                                             | setup, new phone, turn off, new codes                                                                              |
| `client/screens/LoginScreen.tsx`, `client/screens/ConnectAccountScreen.tsx` (+ `-utils.ts`), `client/lib/social-auth-utils.ts`, `client/components/DeleteAccountModal.tsx`, `client/components/ChangeEmailModal.tsx`, `client/screens/SignInMethodsScreen.tsx`, `client/navigation/RootStackNavigator.tsx`, `client/navigation/ProfileStackNavigator.tsx` | routing + inline code + Security rows                                                                              |
| `.env.example`                                                                                                                                                                                                                                                                                                                                            | `MFA_SECRET_ENC_KEY`, `MFA_SETUP_ENABLED`                                                                          |

---

### Task 0: Worktree and scope contract

**Files:** Modify `todos/P2-2026-09-26-add-second-factor-authentication.md`

- [ ] **Step 1:** Create the worktree from `origin/main` (never from the current checkout):

```bash
git fetch origin
git worktree add .claude/worktrees/totp-2fa -b feat/totp-second-factor origin/main
ln -s "$PWD/node_modules" .claude/worktrees/totp-2fa/node_modules
bash scripts/declare-worktree.sh "$PWD/.claude/worktrees/totp-2fa"
```

Inside the worktree use `/usr/bin/git` (memory `reference_rtk_worktree_guard_blocks_git`).

- [ ] **Step 2:** In the todo, replace the `**Files in scope:**` line with every path in the File map, and append under `## Updates`:

```markdown
### 2026-10-10

- Part 1 (TOTP + recovery codes + trusted phones) implemented per `docs/superpowers/specs/2026-10-10-totp-second-factor-design.md` and plan `docs/superpowers/plans/2026-10-10-totp-second-factor.md`. Still open: part 2 passkeys, part 3 the 8-character path. Keep this todo open.
```

- [ ] **Step 3:** Commit (message via Write + `-F`): `docs(todos): MFA part-1 scope contract`.

---

### Task 1: TOTP primitives and constants

**Files:** Create `shared/constants/mfa.ts`, `server/lib/mfa/totp.ts`, `server/lib/mfa/__tests__/totp.test.ts`

**Interfaces — Produces:** `base32Encode(buf: Buffer): string`, `base32Decode(s: string): Buffer`, `hotp(secret: Buffer, counter: number): string`, `timeStep(nowMs: number): number`, `matchTotp(secret: Buffer, code: string, nowMs: number): number | null` (the matched step), `otpauthUrl(secretB32: string, accountName: string): string`; every constant below.

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

- [ ] **Step 3: Implement** `shared/constants/mfa.ts`:

```ts
// Second factor (TOTP + recovery codes + trusted phones).
// Spec: docs/superpowers/specs/2026-10-10-totp-second-factor-design.md
export const TOTP_CODE_LENGTH = 6;
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_WINDOW_STEPS = 1;
export const TOTP_SECRET_BYTES = 20;
export const MFA_ENROLL_TTL_MINUTES = 10;
export const MFA_CHALLENGE_TTL_MINUTES = 5;
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
/** Every Nth consecutive failure locks the second factor for MFA_LOCK_MINUTES. */
export const MFA_LOCK_EVERY_FAILURES = 10;
export const MFA_LOCK_MINUTES = 15;
/** SP 800-63B-4: ≤ 100 consecutive failures; past it only a recovery code works. */
export const MFA_TOTP_FAILURE_CAP = 100;
export const MFA_RECOVERY_CODE_COUNT = 10;
export const MFA_RECOVERY_CODE_BYTES = 10; // 80 bits → 16 base32 chars
export const MFA_TRUST_DAYS = 90;
```

and `server/lib/mfa/totp.ts`:

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

- [ ] **Step 4:** Run the test → PASS.
- [ ] **Step 5:** Commit `feat(server): TOTP primitives checked against the RFC 6238 vectors`.

---

### Task 2: Secrets, recovery codes, challenge tokens, trust keys

**Files:** Create `server/lib/mfa/mfa-secrets.ts`, `server/lib/mfa/__tests__/mfa-secrets.test.ts`; modify `.env.example`

**Interfaces — Consumes:** `encryptToken(plain, key)`, `decryptToken(blob, key)` from `server/lib/social-identity/token-crypto.ts`; `base32Encode` (Task 1).
**Produces:** `class MfaUnavailableError extends Error`; `loadMfaKey(raw?: string): Buffer`; `mfaConfigured(): boolean`; `encryptMfaSecret(b32: string, key?: Buffer): string`; `decryptMfaSecret(blob: string, key?: Buffer): string`; `newTotpSecret(): string`; `generateRecoveryCodes(n?: number): string[]` (display form `XXXX-XXXX-XXXX-XXXX`); `normalizeRecoveryCode(input: string): string | null`; `hashRecoveryCode(userId: string, normalized: string): string`; `newChallengeToken(): string`; `hashChallengeToken(token: string): string`; `newTrustKey(): string`; `hashTrustKey(key: string): string`.

All hashes are unkeyed SHA-256 with a domain label (spec §2): every input is ≥ 80 random bits, so a database leak cannot brute-force them, and no key means no rotation ever voids them.

- [ ] **Step 1: Failing tests** — the carried-over suite:

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

plus, at the end of the same file:

```ts
it("trust keys are 43-char base64url; hashes are labelled per purpose", () => {
  const k = newTrustKey();
  expect(k).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hashTrustKey(k)).toMatch(/^[0-9a-f]{64}$/);
  // Same input, different purpose → different hash (domain separation).
  expect(hashTrustKey(k)).not.toBe(hashChallengeToken(k));
});
```

(add `newTrustKey, hashTrustKey` to the import list).

- [ ] **Step 2:** Run `npx vitest run server/lib/mfa/__tests__/mfa-secrets.test.ts` → FAIL.
- [ ] **Step 3: Implement** `server/lib/mfa/mfa-secrets.ts`:

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
    .update(`mfa-recovery:${userId}:${normalized}`)
    .digest("hex");
}

export function newChallengeToken(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashChallengeToken(token: string): string {
  return crypto
    .createHash("sha256")
    .update(`mfa-challenge:${token}`)
    .digest("hex");
}
```

and append:

```ts
export function newTrustKey(): string {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashTrustKey(key: string): string {
  return crypto.createHash("sha256").update(`mfa-trust:${key}`).digest("hex");
}
```

Append to `.env.example`:

```
# Encrypts authenticator-app (TOTP) secrets at rest. 32 random bytes, base64:
#   openssl rand -base64 32
# Unset ⇒ 2FA setup and verify answer MFA_UNAVAILABLE. Never reuse JWT_SECRET.
MFA_SECRET_ENC_KEY=
# "true" lets accounts turn two-step verification ON. Never gates sign-in for
# accounts that already have it.
MFA_SETUP_ENABLED=
```

- [ ] **Step 4:** Run → PASS. **Step 5:** Commit `feat(server): MFA secret encryption, recovery codes, challenge tokens and trust keys`.

---

### Task 3: Schema and migration 0018

**Files:** Modify `shared/schema.ts`; create `migrations/0018_mfa_totp.sql`; test `server/storage/__tests__/mfa-schema.test.ts`

**Produces (Drizzle):** `users.mfaEnabledAt`; tables `userMfa`, `mfaRecoveryCodes`, `mfaChallenges`, `mfaTrustedDevices`; types `UserMfa`, `MfaChallenge`.

- [ ] **Step 1: Failing test** (real DB — copy the header/transaction harness of `server/storage/__tests__/users-password-reset.test.ts`, which uses `test/db-test-utils`):
  - insert a user, a `user_mfa` row, two recovery codes, a `login` challenge and a trusted device; delete the user; assert all four tables are empty for that user (cascade);
  - inserting the same `(user_id, code_hash)` twice throws a unique violation (Postgres `23505`);
  - a challenge with `purpose = 'link'` and `link_ticket_hash = NULL` throws a check violation (`23514`), and so does `purpose = 'login'` with a ticket hash;
  - inserting two trusted devices with the same `key_hash` throws `23505`.

- [ ] **Step 2:** Run `npx vitest run server/storage/__tests__/mfa-schema.test.ts` → FAIL.

- [ ] **Step 3: Implement.** In `users`, after `tokenVersion`:

```ts
    /**
     * When two-step verification was turned on; NULL = off. Not a secret (the
     * secret lives in user_mfa). Read by secondFactor.requiresSecondFactor.
     */
    mfaEnabledAt: timestamp("mfa_enabled_at", { withTimezone: true }),
```

New tables, after `pendingSocialSignIns` (add `uniqueIndex`, `index`, `check`, `serial`, `boolean` to the existing `drizzle-orm/pg-core` import if missing):

```ts
/** One row per account that has started or finished 2FA setup. Never serialized. */
export const userMfa = pgTable("user_mfa", {
  userId: varchar("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** AES-256-GCM (MFA_SECRET_ENC_KEY) of the active base32 secret; NULL until confirmed. */
  totpSecretEnc: text("totp_secret_enc"),
  /** Highest accepted TOTP time step — replay guard (a code is usable once). */
  totpLastStep: integer("totp_last_step"),
  /** Setup or new phone in progress: encrypted candidate secret + its expiry. */
  pendingSecretEnc: text("pending_secret_enc"),
  pendingExpiresAt: timestamp("pending_expires_at", { withTimezone: true }),
  /** Consecutive failed second-factor checks (any success resets). */
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
    /** sha256(`mfa-recovery:${userId}:${normalizedCode}`) — server/lib/mfa/mfa-secrets.ts */
    codeHash: text("code_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("mfa_recovery_codes_user_hash_unique").on(t.userId, t.codeHash),
  ],
);

/** A password check passed; the second factor has not. Single use. */
export const mfaChallenges = pgTable(
  "mfa_challenges",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** users.token_version at creation — a reset or sign-out kills it. */
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
    check(
      "mfa_challenges_link_ticket_check",
      sql`(${t.purpose} = 'link') = (${t.linkTicketHash} IS NOT NULL)`,
    ),
  ],
);

/** "Trust this phone": skips the code on password sign-in until expiry (D5). */
export const mfaTrustedDevices = pgTable(
  "mfa_trusted_devices",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256(`mfa-trust:${key}`); the raw key lives only in the phone's Keychain. */
    keyHash: text("key_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => [
    uniqueIndex("mfa_trusted_devices_key_hash_unique").on(t.keyHash),
    index("mfa_trusted_devices_user_id_idx").on(t.userId),
  ],
);
export type UserMfa = typeof userMfa.$inferSelect;
export type MfaChallenge = typeof mfaChallenges.$inferSelect;
```

`migrations/0018_mfa_totp.sql`:

```sql
-- Second factor (authenticator app + recovery codes + trusted phones).
--
-- ORDERING — APPLY BEFORE MERGING THE PR THAT SHIPS THIS FILE. The new server
-- bundle selects users.mfa_enabled_at on every user load (Drizzle lists columns
-- by name), so it must exist before that bundle deploys. Applying early is safe
-- for the old bundle: a new nullable column and four tables it never reads.
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
  purpose text NOT NULL,
  link_ticket_hash text,
  link_mark_email_verified boolean DEFAULT false NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
  CONSTRAINT mfa_challenges_purpose_check CHECK (purpose IN ('login', 'link')),
  CONSTRAINT mfa_challenges_link_ticket_check
    CHECK ((purpose = 'link') = (link_ticket_hash IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS mfa_challenges_user_id_idx ON mfa_challenges (user_id);

CREATE TABLE IF NOT EXISTS mfa_trusted_devices (
  id serial PRIMARY KEY,
  user_id varchar NOT NULL
    CONSTRAINT mfa_trusted_devices_user_id_users_id_fk REFERENCES users(id) ON DELETE CASCADE,
  key_hash text NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS mfa_trusted_devices_key_hash_unique
  ON mfa_trusted_devices (key_hash);
CREATE INDEX IF NOT EXISTS mfa_trusted_devices_user_id_idx
  ON mfa_trusted_devices (user_id);
```

Apply locally (`psql "$DATABASE_URL" -f migrations/0018_mfa_totp.sql` with the dev URL from `MEMORY-reference.md` → "Database & Testing"), then `npm run db:push` must report **no changes**. If it proposes changes, fix the SQL names, not the schema — that is the migration-matches-schema check.

- [ ] **Step 4:** Run the schema test → PASS. Confirm `serializeUser` (`server/routes/_serialize-user.ts`) is an explicit field list, so `mfaEnabledAt` is not leaked raw.
- [ ] **Step 5:** Commit `feat(db): MFA tables, trusted devices and users.mfa_enabled_at (migration 0018)`.

---

### Task 4: MFA storage (+ reset deletes trusted phones)

**Files:** Create `server/storage/mfa.ts`, `server/storage/__tests__/mfa.test.ts`; modify `server/storage/index.ts`, `server/storage/identities.ts`, `server/storage/password-reset.ts`, `server/storage/__tests__/users-password-reset.test.ts`

**Interfaces — Produces (all on `storage.*`, registered in `server/storage/index.ts` under `// Second factor`):**

- `startTotpEnrollment(userId: string, pendingSecretEnc: string): Promise<void>` — upsert `pending_secret_enc`, `pending_expires_at = now() + MFA_ENROLL_TTL_MINUTES`. Used for first setup AND new phone (the active secret is untouched).
- `getPendingTotpSecret(userId): Promise<string | undefined>` — only if unexpired.
- `confirmTotpEnrollment(userId, { acceptedStep: number; recoveryHashes: string[] }): Promise<number | undefined>` — ONE transaction, guarded on pending unexpired AND `users.mfa_enabled_at IS NULL`: pending→active, `totp_last_step = acceptedStep`, counters reset, replace recovery codes, `mfa_enabled_at = now()`, `token_version + 1`. Returns the new tokenVersion; undefined when the guard fails.
- `confirmNewPhone(userId, { acceptedStep: number }): Promise<number | undefined>` — ONE transaction, guarded on pending unexpired AND `mfa_enabled_at IS NOT NULL`: pending→active, `totp_last_step`, counters reset, **delete trusted devices**, `token_version + 1`. Recovery codes untouched.
- `getActiveTotp(userId): Promise<{ secretEnc: string; failedAttempts: number; locked: boolean } | undefined>` — `locked` computed in SQL (`locked_until > now()`); undefined when no active secret.
- `acceptTotpStep(userId, step): Promise<boolean>` — `UPDATE user_mfa SET totp_last_step = $step, failed_attempts = 0, locked_until = NULL WHERE user_id = $1 AND (totp_last_step IS NULL OR totp_last_step < $step) AND (locked_until IS NULL OR locked_until <= now()) RETURNING`.
- `recordMfaFailure(userId): Promise<{ failedAttempts: number; tripped: boolean }>` — one statement (below).
- `consumeRecoveryCode(userId, codeHash, replacementHash): Promise<boolean>` — ONE transaction: `DELETE … WHERE user_id AND code_hash RETURNING`; if deleted, insert the replacement and reset `failed_attempts`/`locked_until`. Refuses (false, nothing written) while `locked_until > now()`.
- `replaceRecoveryCodes(userId, hashes): Promise<void>`.
- `disableMfa(userId): Promise<number | undefined>` — transaction: delete `user_mfa`, recovery codes, challenges, trusted devices; `mfa_enabled_at = NULL`; `token_version + 1`; returns the new tokenVersion.
- `createMfaChallenge({ tokenHash, userId, tokenVersion, purpose, linkTicketHash?, linkMarkEmailVerified?, notAfter? }): Promise<void>` — `expires_at = LEAST(now() + MFA_CHALLENGE_TTL_MINUTES, notAfter)` (`notAfter` = the pending link row's expiry); also deletes this user's expired challenges.
- `reserveMfaChallengeAttempt(tokenHash): Promise<MfaChallenge | undefined>` — `attempts + 1 WHERE token_hash AND expires_at > now() AND attempts < MFA_CHALLENGE_MAX_ATTEMPTS RETURNING *`.
- `consumeMfaChallenge(tokenHash): Promise<boolean>` — `DELETE … RETURNING`.
- `trustDevice(userId, keyHash): Promise<void>` — insert with `expires_at = now() + MFA_TRUST_DAYS days`; also deletes this user's expired trusted devices.
- `isTrustedDevice(userId, keyHash): Promise<boolean>` — row with this user AND this hash AND `expires_at > now()`.
- `forgetTrustedDevices(userId): Promise<void>`.
- In `identities.ts`: `completeLinkByTicketHash(ticketHash, opts)` with the body of today's `completeLinkFromTicket` (which hashes with `sha256Hex` and keeps its own pending-row expiry check); `completeLinkFromTicket(ticket, opts)` becomes `completeLinkByTicketHash(sha256Hex(ticket), opts)`.
- In `password-reset.ts`: `completePasswordReset` wraps its update and `DELETE FROM mfa_trusted_devices WHERE user_id = $1` in one `db.transaction`, deleting only when the update matched.

- [ ] **Step 1: Failing tests** (real DB, `users-password-reset.test.ts` harness). Helper `confirmEnrolled(userId, step, hashes = ["h1","h2"])` = `startTotpEnrollment(userId, "enc")` + `confirmTotpEnrollment(userId, { acceptedStep: step, recoveryHashes: hashes })`.

```ts
it("acceptTotpStep accepts a step once and refuses it (and older) after", async () => {
  await confirmEnrolled(testUser.id, 100);
  expect(await mfa.acceptTotpStep(testUser.id, 100)).toBe(false);
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

it("every 10th failure locks and trips exactly once; the count keeps going", async () => {
  await confirmEnrolled(testUser.id, 100);
  const trips: boolean[] = [];
  for (let i = 1; i <= 20; i++)
    trips.push((await mfa.recordMfaFailure(testUser.id)).tripped);
  expect(trips.map((t, i) => (t ? i + 1 : 0)).filter(Boolean)).toEqual([
    10, 20,
  ]);
  expect((await mfa.getActiveTotp(testUser.id))!.failedAttempts).toBe(20);
  expect((await mfa.getActiveTotp(testUser.id))!.locked).toBe(true);
  expect(await mfa.acceptTotpStep(testUser.id, 200)).toBe(false);
  await tx.execute(
    sql`UPDATE user_mfa SET locked_until = now() - interval '1 second' WHERE user_id = ${testUser.id}`,
  );
  expect(await mfa.acceptTotpStep(testUser.id, 200)).toBe(true);
  expect((await mfa.getActiveTotp(testUser.id))!.failedAttempts).toBe(0);
});

it("10 concurrent failures trip the lock exactly once", async () => {
  await confirmEnrolled(testUser.id, 100);
  const r = await Promise.all(
    Array.from({ length: 10 }, () => mfa.recordMfaFailure(testUser.id)),
  );
  expect(r.filter((x) => x.tripped)).toHaveLength(1);
});

it("a recovery code works once and is replaced; concurrent redemption: one wins", async () => {
  await confirmEnrolled(testUser.id, 100, ["h1", "h2"]);
  const r = await Promise.all([
    mfa.consumeRecoveryCode(testUser.id, "h1", "h3"),
    mfa.consumeRecoveryCode(testUser.id, "h1", "h4"),
  ]);
  expect(r.filter(Boolean)).toHaveLength(1);
  const rows = await tx
    .select()
    .from(mfaRecoveryCodes)
    .where(eq(mfaRecoveryCodes.userId, testUser.id));
  expect(rows).toHaveLength(2); // h2 + exactly one replacement
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
  await mfa.startTotpEnrollment(testUser.id, "enc2");
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
  await mfa.startTotpEnrollment(testUser.id, "enc");
  await tx.execute(
    sql`UPDATE user_mfa SET pending_expires_at = now() - interval '1 second' WHERE user_id = ${testUser.id}`,
  );
  expect(
    await mfa.confirmTotpEnrollment(testUser.id, {
      acceptedStep: 5,
      recoveryHashes: ["a"],
    }),
  ).toBeUndefined();
  expect(await mfa.getPendingTotpSecret(testUser.id)).toBeUndefined();
});

it("confirmNewPhone swaps the secret, keeps recovery codes, clears trusted devices, bumps version", async () => {
  await confirmEnrolled(testUser.id, 100, ["h1"]);
  await mfa.trustDevice(testUser.id, "k1");
  await mfa.startTotpEnrollment(testUser.id, "enc-new");
  const v = await mfa.confirmNewPhone(testUser.id, { acceptedStep: 300 });
  expect(v).toBe(testUser.tokenVersion + 2);
  expect((await mfa.getActiveTotp(testUser.id))!.secretEnc).toBe("enc-new");
  expect(await mfa.isTrustedDevice(testUser.id, "k1")).toBe(false);
  const codes = await tx
    .select()
    .from(mfaRecoveryCodes)
    .where(eq(mfaRecoveryCodes.userId, testUser.id));
  expect(codes).toHaveLength(1);
});

it("confirmNewPhone refuses when MFA is off", async () => {
  await mfa.startTotpEnrollment(testUser.id, "enc");
  expect(
    await mfa.confirmNewPhone(testUser.id, { acceptedStep: 1 }),
  ).toBeUndefined();
});

it("disableMfa clears every MFA row and bumps tokenVersion", async () => {
  await confirmEnrolled(testUser.id, 100);
  await mfa.trustDevice(testUser.id, "k1");
  await mfa.createMfaChallenge({
    tokenHash: "t",
    userId: testUser.id,
    tokenVersion: 0,
    purpose: "login",
  });
  const v = await mfa.disableMfa(testUser.id);
  expect(v).toBe(testUser.tokenVersion + 2);
  for (const table of [
    userMfa,
    mfaRecoveryCodes,
    mfaChallenges,
    mfaTrustedDevices,
  ]) {
    const rows = await tx
      .select()
      .from(table)
      .where(eq(table.userId, testUser.id));
    expect(rows).toHaveLength(0);
  }
  const [u] = await tx.select().from(users).where(eq(users.id, testUser.id));
  expect(u.mfaEnabledAt).toBeNull();
});

it("challenge: 5 reservations then refused; consume once; concurrent consume: one wins", async () => {
  await mfa.createMfaChallenge({
    tokenHash: "t",
    userId: testUser.id,
    tokenVersion: 0,
    purpose: "login",
  });
  for (let i = 0; i < 5; i++)
    expect(await mfa.reserveMfaChallengeAttempt("t")).toBeDefined();
  expect(await mfa.reserveMfaChallengeAttempt("t")).toBeUndefined();
  const r = await Promise.all([
    mfa.consumeMfaChallenge("t"),
    mfa.consumeMfaChallenge("t"),
  ]);
  expect(r.filter(Boolean)).toHaveLength(1);
});

it("a link challenge never outlives its notAfter", async () => {
  const notAfter = new Date(Date.now() + 60_000);
  await mfa.createMfaChallenge({
    tokenHash: "L",
    userId: testUser.id,
    tokenVersion: 0,
    purpose: "link",
    linkTicketHash: "th",
    notAfter,
  });
  const [row] = await tx
    .select()
    .from(mfaChallenges)
    .where(eq(mfaChallenges.tokenHash, "L"));
  expect(row.expiresAt.getTime()).toBeLessThanOrEqual(notAfter.getTime());
});

it("trusted devices: per user, expire, and forget", async () => {
  await mfa.trustDevice(testUser.id, "k1");
  expect(await mfa.isTrustedDevice(testUser.id, "k1")).toBe(true);
  expect(await mfa.isTrustedDevice(otherUser.id, "k1")).toBe(false); // Review Focus 3
  await tx.execute(
    sql`UPDATE mfa_trusted_devices SET expires_at = now() - interval '1 second' WHERE user_id = ${testUser.id}`,
  );
  expect(await mfa.isTrustedDevice(testUser.id, "k1")).toBe(false);
  await mfa.trustDevice(testUser.id, "k2"); // also purges the expired k1
  const rows = await tx
    .select()
    .from(mfaTrustedDevices)
    .where(eq(mfaTrustedDevices.userId, testUser.id));
  expect(rows.map((r) => r.keyHash)).toEqual(["k2"]);
  await mfa.forgetTrustedDevices(testUser.id);
  expect(await mfa.isTrustedDevice(testUser.id, "k2")).toBe(false);
});
```

(`otherUser` = a second user created in the same `beforeEach`.) In `users-password-reset.test.ts` add:

```ts
it("a completed reset deletes the user's trusted devices; a failed one does not", async () => {
  await storage.trustDevice(testUser.id, "k1");
  expect(
    await completePasswordReset(testUser.id, "wrong-hash", "newhash"),
  ).toBe(false);
  expect(await storage.isTrustedDevice(testUser.id, "k1")).toBe(true);
  // issue a real code first, exactly as the existing success test in this file does, then:
  expect(await completePasswordReset(testUser.id, matchedHash, "newhash")).toBe(
    true,
  );
  expect(await storage.isTrustedDevice(testUser.id, "k1")).toBe(false);
});
```

- [ ] **Step 2:** Run `npx vitest run server/storage/__tests__/mfa.test.ts server/storage/__tests__/users-password-reset.test.ts` → FAIL.
- [ ] **Step 3: Implement** `server/storage/mfa.ts` following `password-reset.ts`: `db.update(...).set(...).where(and(...)).returning(...)`; every time comparison is `sql\`… now()\``; multi-statement operations use `db.transaction(async (tx) => …)`. The lockout statement (deviation 1):

```ts
export async function recordMfaFailure(
  userId: string,
): Promise<{ failedAttempts: number; tripped: boolean }> {
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
  if (!row) return { failedAttempts: 0, tripped: false };
  return {
    failedAttempts: row.failedAttempts,
    tripped: row.failedAttempts % MFA_LOCK_EVERY_FAILURES === 0,
  };
}
```

(`RETURNING` yields the post-update value; Postgres row-locks the `UPDATE`, so ten concurrent calls see 1..10 and exactly one returns 10.)

- [ ] **Step 4:** Run → PASS. Also run `npx vitest run server/storage/__tests__/identities.test.ts` (the link refactor must not change behaviour).
- [ ] **Step 5:** Commit `feat(storage): atomic MFA enrollment, replay guard, lockout, recovery codes, challenges, trusted devices`.

---

### Task 5: `verifySecondFactor` (no HTTP) + notices

**Files:** Create `server/lib/mfa/verify-second-factor.ts`, `server/lib/mfa/__tests__/verify-second-factor.test.ts`; modify `server/services/email.ts` (+ its test)

**Interfaces — Consumes:** Task 1 `matchTotp`, `base32Decode`; Task 2 `decryptMfaSecret`, `MfaUnavailableError`, `normalizeRecoveryCode`, `hashRecoveryCode`, `generateRecoveryCodes`; Task 4 storage.
**Produces:**

```ts
export type SecondFactorProof = { code: string } | { recoveryCode: string };
export type SecondFactorResult =
  | { ok: true; replacementRecoveryCode?: string }
  | { ok: false; reason: "invalid" | "unavailable" };
export async function verifySecondFactor(
  user: { id: string; email: string; username: string },
  proof: SecondFactorProof,
  nowMs?: number,
): Promise<SecondFactorResult>;

// server/services/email.ts
export type TwoFactorNoticeKind =
  | "enabled"
  | "disabled"
  | "new_phone"
  | "recovery_code_used"
  | "recovery_codes_replaced"
  | "locked";
export async function sendTwoFactorNotice(
  to: string,
  username: string,
  kind: TwoFactorNoticeKind,
): Promise<void>;
```

Rules:

- No active TOTP (`getActiveTotp` undefined) → `invalid`.
- `locked` → `invalid` for BOTH proof kinds, **without** counting and without consulting `matchTotp` (generic; spec §3.2 step 2).
- TOTP proof: `failedAttempts >= MFA_TOTP_FAILURE_CAP` → `invalid` without matching (recovery code only). Decrypt the secret — **any** throw from `loadMfaKey`/`decryptMfaSecret` (missing key, wrong-length key, or a rotated key failing GCM auth) → `unavailable` (Review Focus 4, spec §9; nothing counted; log the error class only, never the blob). `matchTotp` hit → `acceptTotpStep(step)`; false (replay, or a lock that began in between) → failure. Miss → failure.
- Recovery proof: `normalizeRecoveryCode` null → failure; else `replacement = generateRecoveryCodes(1)[0]`, `consumeRecoveryCode(id, hashRecoveryCode(id, n), hashRecoveryCode(id, normalizeRecoveryCode(replacement)!))`; true → `{ ok: true, replacementRecoveryCode: replacement }` and `fireAndForget("mfa-notice", sendTwoFactorNotice(user.email, user.username, "recovery_code_used"))`; false → failure.
- "Failure" = `recordMfaFailure(id)` exactly once, then `invalid`; if it returns `tripped`, `fireAndForget("mfa-notice", sendTwoFactorNotice(user.email, user.username, "locked"))`.

`sendTwoFactorNotice` copies `sendPasswordChangedNotice`'s shape exactly (`client()`, `emailVerificationEnabled()`, `canSendTo(to, "account-security")`, `sendWithRetry`, `escapeHtml(username)`), with subject/body per kind:

| kind                    | subject                                    | first paragraph                                                                                                          |
| ----------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| enabled                 | Two-step verification is on                | Two-step verification was turned on for your OCRecipes account **{username}**, and other devices were signed out.        |
| disabled                | Two-step verification is off               | Two-step verification was turned off for **{username}**, and every device was signed out.                                |
| new_phone               | Two-step verification moved to a new phone | Your authenticator app for **{username}** was replaced, trusted phones were forgotten and other devices were signed out. |
| recovery_code_used      | A recovery code was used                   | One of your recovery codes for **{username}** was just used.                                                             |
| recovery_codes_replaced | New recovery codes                         | New recovery codes were created for **{username}**; the old ones no longer work.                                         |
| locked                  | Several wrong two-step codes               | Several wrong two-step verification codes were entered for **{username}**. If this wasn't you, change your password.     |

Every body ends with the same two lines as `sendPasswordChangedNotice` ("If this was you, there's nothing else to do." / contact support@ocrecipes.com).

- [ ] **Step 1: Failing tests** with `vi.mock("../../../storage")`, `vi.mock("../../../services/email")`, a fixed secret and `nowMs`:
  - correct code → ok, `acceptTotpStep` called with the matched step, `recordMfaFailure` not called;
  - correct code but `acceptTotpStep` false → invalid + exactly one `recordMfaFailure`;
  - wrong code → invalid + one failure; `recordMfaFailure` → `{ tripped: true }` sends the `locked` notice once;
  - locked → invalid, no failure recorded, `acceptTotpStep` not called, for both a code and a recovery code;
  - `failedAttempts = 100` + correct code → invalid; + good recovery code → ok;
  - decrypt throws `MfaUnavailableError` → `unavailable`; decrypt throws a plain `Error` (rotated key) → `unavailable`; nothing counted either way;
  - malformed recovery code → invalid + one failure;
  - good recovery code → ok, replacement matches `/^[A-Z2-7]{4}(-[A-Z2-7]{4}){3}$/`, its hash was the third argument to `consumeRecoveryCode`, `recovery_code_used` notice sent.
  - `email.test.ts`: each kind's subject; `escapeHtml` applied to the username (`<b>` renders escaped).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(server): verifySecondFactor with replay guard, lockout, cap and notices`.

---

### Task 6: Password-proof gate (D2) + sign-in-gates for D1

**Files:** Create `server/lib/mfa/password-proof-gate.ts` + `__tests__/password-proof-gate.test.ts`; modify `server/lib/social-identity/sign-in-gates.ts` (+ its test), `server/routes/_schemas.ts`, `shared/constants/error-codes.ts`, `server/routes/auth.ts` (change-email, DELETE account), `server/routes/auth-social.ts` (`POST /api/auth/identities`); tests in `server/routes/__tests__/auth.test.ts`, `auth-social.test.ts`

**Interfaces — Consumes:** `verifySecondFactor`, `SecondFactorProof` (Task 5).
**Produces:**

```ts
// server/routes/_schemas.ts
export const secondFactorSchema = z.union([
  z.object({ code: z.string().regex(/^\d{6}$/) }),
  z.object({ recoveryCode: z.string().min(1).max(40) }),
]);
// reauthProofSchema's password branch becomes:
//   z.object({ password: z.string().min(1, "Password is required"), secondFactor: secondFactorSchema.optional() })
// changeEmailSchema gains: secondFactor: secondFactorSchema.optional()

// shared/constants/error-codes.ts gains:
//   MFA_CHALLENGE_EXPIRED, INVALID_SECOND_FACTOR, MFA_UNAVAILABLE, MFA_ALREADY_ENABLED,
//   MFA_NOT_ENABLED, MFA_NEEDS_PASSWORD, MFA_SETUP_DISABLED   (SECOND_FACTOR_REQUIRED already exists)

// server/lib/mfa/password-proof-gate.ts
export type PasswordProofGate =
  | { ok: true; replacementRecoveryCode?: string }
  | { ok: false; status: 401 | 403 | 503; code: string; message: string };
export async function secondFactorForPasswordProof(
  user: {
    id: string;
    email: string;
    username: string;
    mfaEnabledAt: Date | null;
  },
  proofIsPassword: boolean,
  secondFactor: SecondFactorProof | undefined,
): Promise<PasswordProofGate>;

// server/lib/social-identity/sign-in-gates.ts
function requiresSecondFactor(user: { mfaEnabledAt: Date | null }): boolean; // user.mfaEnabledAt !== null
```

Gate rules: `!proofIsPassword` or `mfaEnabledAt === null` → `{ ok: true }`. No `secondFactor` → `{ ok: false, status: 403, code: SECOND_FACTOR_REQUIRED, message: "Enter your two-step verification code." }`. `verifySecondFactor` → `unavailable` → 503 `MFA_UNAVAILABLE`; `invalid` → 401 `INVALID_SECOND_FACTOR` (copy from Global Constraints); ok → `{ ok: true, replacementRecoveryCode }`.

Call sites — the gate runs **after** the existing password check succeeds (so `SECOND_FACTOR_REQUIRED` reveals nothing to someone without the password), **before** any write:

| Route                                                                  | proofIsPassword            | On gate failure                               | On success                                                            |
| ---------------------------------------------------------------------- | -------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `POST /api/auth/change-email` (`auth.ts`, after `passwordMatches`)     | `true`                     | `sendError(res, g.status, g.message, g.code)` | existing flow; add `replacementRecoveryCode` to the JSON when present |
| `DELETE /api/auth/account` (`auth.ts`, after `reauthenticate`)         | `"password" in validated`  | same                                          | existing flow (account gone — no replacement)                         |
| `POST /api/auth/identities` (`auth-social.ts`, after `reauthenticate`) | `"password" in body.proof` | same                                          | existing flow; add `replacementRecoveryCode` when present             |

`sign-in-gates.ts`: `requiresSecondFactor` returns `user.mfaEnabledAt !== null`; `signInGate` **drops** its second-factor branch (email verification only) and its doc comment becomes "D1: a Google/Apple proof never needs our second factor; password proofs are gated in server/lib/mfa/". `decideLink`'s `hasSecondFactor: secondFactor.requiresSecondFactor(emailUser)` call (`auth-social.ts:348`) is unchanged and now real.

- [ ] **Step 1: Failing tests.**
  - `password-proof-gate.test.ts` (mock `verifySecondFactor`): each rule above; provider proof on an MFA account → ok without calling verify.
  - `sign-in-gates.test.ts`: `signInGate` on an MFA user returns `{ ok: true }` (D1); `requiresSecondFactor({ mfaEnabledAt: new Date() })` is true.
  - Route tests, for each of the three routes, on an MFA user with a correct password: no `secondFactor` → 403 `SECOND_FACTOR_REQUIRED` and **no write** (assert the storage mutator — `stagePendingEmail`/`deleteUser`/`insertIdentity` — not called); wrong factor → 401 `INVALID_SECOND_FACTOR`; right factor → success; recovery code → response has `replacementRecoveryCode` (not for delete). Wrong password + no factor → the route's existing 401, never 403. Provider proof on `/identities` and DELETE → success with no factor.
  - `auth-social.test.ts`: already-linked Google sign-in on an MFA user → 200 `signed_in` with a token (D1).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run the five test files → PASS.
- [ ] **Step 5:** Commit `feat(auth): password proofs on an MFA account need the second factor; Google/Apple proofs never do`.

---

### Task 7: Login challenge, trust key, and the Connect-prompt challenge

**Files:** Create `server/lib/mfa/challenge.ts` + test; modify `server/routes/_schemas.ts` (`loginSchema`), `server/routes/auth.ts` (login), `server/routes/auth-social.ts` (`/social/link` password branch); tests in `auth.test.ts`, `auth-social.test.ts`

**Interfaces — Produces:**

```ts
// server/lib/mfa/challenge.ts
export type MfaRequired = { status: "mfa_required"; challenge: string };
export async function startMfaChallenge(input: {
  user: { id: string; tokenVersion: number };
  purpose: "login" | "link";
  link?: { ticket: string; markEmailVerified: boolean; notAfter: Date };
}): Promise<MfaRequired>;
// loginSchema gains: trustKey: z.string().min(20).max(100).optional()
```

`startMfaChallenge`: `t = newChallengeToken()`; `storage.createMfaChallenge({ tokenHash: hashChallengeToken(t), userId, tokenVersion, purpose, linkTicketHash: link && sha256Hex(link.ticket), linkMarkEmailVerified: link?.markEmailVerified ?? false, notAfter: link?.notAfter })`; return `{ status: "mfa_required", challenge: t }`. Nothing else is written.

Login (`auth.ts`, after the `EMAIL_NOT_VERIFIED` check, replacing the direct `generateToken` + `res.json`):

```ts
if (
  secondFactor.requiresSecondFactor(user) &&
  !(
    validated.trustKey &&
    (await storage.isTrustedDevice(user.id, hashTrustKey(validated.trustKey)))
  )
) {
  return res.json(await startMfaChallenge({ user, purpose: "login" }));
}
// existing token response, unchanged
```

`/social/link` (`auth-social.ts`): in the **password branch only**, after the password check and `signInGate`, before `completeLinkFromTicket`:

```ts
if ("password" in body && secondFactor.requiresSecondFactor(target)) {
  return res.json(
    await startMfaChallenge({
      user: target,
      purpose: "link",
      link: {
        ticket: body.ticket,
        markEmailVerified,
        notAfter: pending.expiresAt,
      },
    }),
  );
}
```

The provider branch is unchanged (D1; spec §3.3 table).

- [ ] **Step 1: Failing tests.**
  - `challenge.test.ts` (mock storage): stores the hash (not the raw token), the user's `tokenVersion`, `purpose`, and for `link` `linkTicketHash === sha256Hex(ticket)` and `notAfter`.
  - Login (route tests): no MFA → unchanged response (token present); MFA, no trust key → **200** `{ status: "mfa_required", challenge: expect.any(String) }` and `generateToken` NOT called; MFA + trusted key → token; MFA + key where `isTrustedDevice` is false (expired / other user's / forgotten) → challenge (Review Focus 3); wrong password on an MFA account → 401 (no challenge created).
  - `/social/link`: password branch on an MFA target → 200 `mfa_required`, `completeLinkFromTicket` and `issueSession` NOT called, challenge `notAfter` = the pending row's `expiresAt`; provider branch on an MFA target → links and signs in with no challenge; password branch on a non-MFA target → unchanged.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(auth): password sign-in and the Connect prompt stop at the 2FA challenge; trusted phones skip it`.

---

### Task 8: `POST /api/auth/mfa/verify`

**Files:** Create `server/routes/auth-mfa.ts`, `server/routes/__tests__/auth-mfa-verify.test.ts`; modify `server/routes.ts` (register beside `registerAuthSocial`), `server/routes/_schemas.ts`, `server/routes/_rate-limiters.ts`

**Interfaces — Produces:** `export function register(app: Express): void` (imported in `server/routes.ts` as `registerAuthMfa`); `mfaVerifySchema = z.object({ challenge: z.string().min(20).max(100), secondFactor: secondFactorSchema, trustDevice: z.boolean().optional() })`; `mfaVerifyLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 30, message: "Too many attempts, please try again later" })` (IP-keyed, same factory as `reauthLimiter`).

Handler order (`mfaVerifyLimiter`, no `requireAuth`):

1. Parse; 400 `VALIDATION_ERROR` on failure.
2. `row = reserveMfaChallengeAttempt(hashChallengeToken(challenge))`; none → 401 `MFA_CHALLENGE_EXPIRED` ("This sign-in expired. Please start again.").
3. `user = storage.getUserForAuth(row.userId)`; missing or `user.tokenVersion !== row.tokenVersion` → `consumeMfaChallenge`, 401 `MFA_CHALLENGE_EXPIRED` (Review Focus 5).
4. `r = verifySecondFactor(user, secondFactor)`; `unavailable` → 503 `MFA_UNAVAILABLE` ("Two-step verification is unavailable right now. Please try again later."); `invalid` → 401 `INVALID_SECOND_FACTOR`.
5. From here on, every response — success OR failure — includes `replacementRecoveryCode` when `r.replacementRecoveryCode` is set (Review Focus 2). Use a local `fail(status, code, message)` that writes `{ error, code, ...(r.replacementRecoveryCode && { replacementRecoveryCode }) }` with `res.status(status).json(...)` (`sendError` cannot carry extra fields).
6. `consumeMfaChallenge` false (a concurrent success won) → `fail(401, MFA_CHALLENGE_EXPIRED, …)`.
7. `purpose === "link"` → `completeLinkByTicketHash(row.linkTicketHash!, { markEmailVerified: row.linkMarkEmailVerified })`; undefined → `fail(401, INVALID_SIGN_IN_TICKET, "This sign-in has expired. Please start again.")`; unique violation (`isUniqueViolation` from `server/lib/db-errors.ts`) → `fail(409, IDENTITY_IN_USE, …)` with the message `/social/link` already uses.
8. `session = issueSession(user.id)`; `trustKey = purpose === "login" && trustDevice ? newTrustKey() : undefined`; if set, `storage.trustDevice(user.id, hashTrustKey(trustKey))`.
9. `res.json({ ...session, ...(trustKey && { trustKey }), ...(r.replacementRecoveryCode && { replacementRecoveryCode: r.replacementRecoveryCode }) })`.

Never log the code, recovery code, challenge or trust key (assert with the `mockLog` pattern from `auth-password-reset.test.ts`).

- [ ] **Step 1: Failing tests** for each numbered branch, plus: two concurrent verifies with the same valid code → exactly one 200 (mock `acceptTotpStep` true once, false after); a recovery code that succeeds in step 4 but loses step 6 → 401 **with** `replacementRecoveryCode`; same for a link whose ticket expired in step 7; `trustDevice: true` on `login` returns a `trustKey` and stores only its hash; `trustDevice: true` on `link` returns none; a challenge minted before a password reset (row `tokenVersion` 3, user now 4) → 401 `MFA_CHALLENGE_EXPIRED`; `unavailable` → 503; no secret value in any log call.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(auth): POST /api/auth/mfa/verify completes a challenged sign-in or link`.

---

### Task 9: Setup, confirm, new phone, turn off, new codes, forget phones, `/me`

**Files:** Modify `server/routes/auth-mfa.ts`, `server/routes/auth.ts` (`/me`), `server/routes/_schemas.ts`; test `server/routes/__tests__/auth-mfa-manage.test.ts`

All routes: `requireAuth`; `me = storage.getUserForAuth(req.userId)` (404 if missing). Password-proof routes also use `reauthLimiter` and check `passwordMatches(body.password, me.password)` → 401 `UNAUTHORIZED` "Invalid credentials" (a social-only account's NULL password never matches). Schemas: `mfaPasswordSchema = z.object({ password: z.string().min(1).max(200) })`; `mfaPasswordAndFactorSchema = mfaPasswordSchema.extend({ secondFactor: secondFactorSchema })`; `mfaConfirmSchema = z.object({ code: z.string().regex(/^\d{6}$/) })`.

| Route                                                                                                    | Body                         | Checks (in order)                                                                                                                                                                                                             | Effect                                                                                                                                                                                                                                                       | Response                                                                           |
| -------------------------------------------------------------------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `POST /api/auth/mfa/totp/setup`                                                                          | `mfaPasswordSchema`          | `process.env.MFA_SETUP_ENABLED !== "true"` → 403 `MFA_SETUP_DISABLED`; `me.password === null` → 409 `MFA_NEEDS_PASSWORD`; password; `me.mfaEnabledAt` → 409 `MFA_ALREADY_ENABLED`; `!mfaConfigured()` → 503 `MFA_UNAVAILABLE` | `secret = newTotpSecret()`; `startTotpEnrollment(me.id, encryptMfaSecret(secret))`                                                                                                                                                                           | `{ secret, otpauthUrl: otpauthUrl(secret, me.username) }`                          |
| `POST /api/auth/mfa/totp/reset` (new phone)                                                              | `mfaPasswordAndFactorSchema` | password; `!me.mfaEnabledAt` → 409 `MFA_NOT_ENABLED`; `verifySecondFactor` (`unavailable` → 503, `invalid` → 401 `INVALID_SECOND_FACTOR`)                                                                                     | same as setup                                                                                                                                                                                                                                                | same + `replacementRecoveryCode` when a recovery code was used                     |
| `POST /api/auth/mfa/totp/confirm` (+ `mfaVerifyLimiter` — its 6-digit guesses are not counted elsewhere) | `mfaConfirmSchema`           | pending secret else 400 `INVALID_SECOND_FACTOR`; `matchTotp` else 400 `INVALID_SECOND_FACTOR`                                                                                                                                 | MFA off: `codes = generateRecoveryCodes()`, `v = confirmTotpEnrollment(…)`, notice `enabled`. MFA on: `v = confirmNewPhone(…)`, notice `new_phone`. `v` undefined → 409 `MFA_ALREADY_ENABLED` / `MFA_NOT_ENABLED`. Then `invalidateTokenVersionCache(me.id)` | `{ ...issueSession(me.id), recoveryCodes? }` (`recoveryCodes` only on first setup) |
| `POST /api/auth/mfa/disable`                                                                             | `mfaPasswordAndFactorSchema` | password; `!me.mfaEnabledAt` → 409 `MFA_NOT_ENABLED`; `verifySecondFactor`                                                                                                                                                    | `disableMfa`; `invalidateTokenVersionCache`; notice `disabled`                                                                                                                                                                                               | `issueSession(me.id)`                                                              |
| `POST /api/auth/mfa/recovery-codes`                                                                      | `mfaPasswordAndFactorSchema` | password; enabled; `verifySecondFactor`                                                                                                                                                                                       | `codes = generateRecoveryCodes()`; `replaceRecoveryCodes(me.id, codes.map(hash))`; notice `recovery_codes_replaced`                                                                                                                                          | `{ recoveryCodes: codes }`                                                         |
| `DELETE /api/auth/mfa/trusted-devices` (+ `reauthLimiter`)                                               | —                            | —                                                                                                                                                                                                                             | `forgetTrustedDevices(me.id)`                                                                                                                                                                                                                                | `204`                                                                              |

`/api/auth/me` adds `mfaEnabled: user.mfaEnabledAt !== null` (only that — `signInMethods.password` already reports a password).

- [ ] **Step 1: Failing tests:** each row's happy path and each check's failure; setup never returns a secret without the password; setup with the flag unset → 403 even with a correct password; confirm's token was minted AFTER the version bump (mock `confirmTotpEnrollment` → 4, `getUser` → tokenVersion 4, assert `generateToken` called with 4); confirm on an MFA account calls `confirmNewPhone` (not enrollment) and returns no `recoveryCodes`; `/me` contains `mfaEnabled` and never `totpSecretEnc`, `pendingSecretEnc` or a code hash (serialize a fully-populated row and assert the key set).
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(auth): two-step setup, new phone, turn off, new recovery codes and forget trusted phones`.

---

### Task 10: Real-database end-to-end test

**Files:** Modify `test/integration/auth-routes.itest.ts`

Real server, real DB, **real `requireAuth`** (route tests mock it, so only this suite catches a token mint that skips the gate). In the suite setup set `process.env.MFA_SECRET_ENC_KEY` to a fixed base64 32-byte test key and `process.env.MFA_SETUP_ENABLED = "true"`. Compute codes with `hotp(base32Decode(secret), timeStep(Date.now()) + k)` from `server/lib/mfa/totp.ts`, using a fresh step (`+1`) whenever the previous step was already accepted.

- [ ] **Step 1: Write the tests, in order (each is the positive control for the next):**
  1. Register + verify a user; `POST /mfa/totp/setup` with the password; `POST /confirm` → 200, 10 recovery codes, a token (T1).
  2. `POST /api/auth/login` → **200** `{ status: "mfa_required", challenge }` and **no** `token` key.
  3. `GET /api/auth/me` with `Authorization: Bearer <challenge>` → **401**.
  4. `POST /mfa/verify` with the code and `trustDevice: true` → 200 with `token` and `trustKey`; `GET /me` with the token → 200 and `mfaEnabled === true`.
  5. `POST /api/auth/logout` with that token; then `POST /login` with the `trustKey` → 200 **with a token, no challenge** (Review Focus 1, D5).
  6. `POST /login` with no trust key → challenge; verify with the SAME code as step 4 → 401 `INVALID_SECOND_FACTOR` (replay); verify with a recovery code → 200 with `replacementRecoveryCode`; reuse that recovery code on a fresh challenge → 401.
  7. `POST /api/auth/change-email` with token + password and no `secondFactor` → 403 `SECOND_FACTOR_REQUIRED`.
  8. Password reset via `forgot-password` + `reset-password` (read the code the way the existing reset itest does); then `POST /login` with the step-4 `trustKey` → **challenge** (reset forgot the phone); an open challenge from before the reset → `MFA_CHALLENGE_EXPIRED`.
  9. A token minted BEFORE step 1's confirm → 401 `TOKEN_REVOKED`.
- [ ] **Step 2:** Run `npm run test:integration:http` against local Postgres → PASS. Check step 2 is a real control once: temporarily revert the login challenge call, confirm step 2 FAILS, restore.
- [ ] **Step 3:** Commit `test(integration): two-step verification end to end against a real database`.

---

### Task 11: Manual reset script + runbook

**Files:** Create `scripts/mfa-reset.ts`, `scripts/__tests__/mfa-reset.test.ts`, `docs/runbooks/mfa-manual-reset.md`

**Interfaces — Consumes:** `storage.disableMfa`, `sendTwoFactorNotice`.
**Produces:** `export async function resetMfaForUser(userId: string, opts: { dryRun: boolean }): Promise<"reset" | "not_enabled" | "no_user">`; CLI `npx tsx scripts/mfa-reset.ts --user <id> [--dry-run]`.

Model the CLI on an existing `scripts/*.ts` that refuses prod by default (e.g. the seed script's `--allow-prod-seed` guard): it refuses `NODE_ENV=production` unless `--allow-prod` is passed, prints the username and `mfa_enabled_at` before acting, and with `--dry-run` writes nothing. Real run: `disableMfa(userId)` then `sendTwoFactorNotice(email, username, "disabled")`. (The server's 60-second `tokenVersion` cache lets old sessions live up to a minute — say so in the runbook.)

Runbook sections: **When** (lost phone AND lost recovery codes); **Verify identity** (reply from the account's email address + one detail only the owner knows, e.g. account creation month and a recent logged meal; never act on a request from a different address); **Run** (dry run, then real, the owner runs prod commands via `!`); **After** (tell the user to sign in with the password and set up two-step again).

- [ ] **Step 1: Failing test** (mock storage + email): `no_user`, `not_enabled`, dry run writes nothing, real run calls `disableMfa` then the notice.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(scripts): manual two-step reset for a user with no phone and no codes`.

---

### Task 12: Client — shared code input, challenge screen, login and Connect routing, trust key

**Files:** Modify `shared/types/auth.ts`, `client/lib/token-storage.ts`, `client/hooks/useAuth.ts`, `client/context/AuthContext.tsx`, `client/screens/LoginScreen.tsx`, `client/screens/ConnectAccountScreen.tsx`, `client/screens/ConnectAccountScreen-utils.ts`, `client/lib/social-auth-utils.ts`, `client/navigation/RootStackNavigator.tsx`; create `client/lib/second-factor-utils.ts`, `client/components/SecondFactorField.tsx`, `client/screens/TwoStepCodeScreen.tsx`, `client/screens/TwoStepCodeScreen-utils.ts`, and tests for each

**Interfaces — Produces:**

```ts
// shared/types/auth.ts
export type SecondFactorInput = { code: string } | { recoveryCode: string };
export type MfaChallengeResult = { status: "mfa_required"; challenge: string };
export type SignedInResult = { status: "signed_in"; user: User; token: string };
export type SessionResult = SignedInResult | MfaChallengeResult;
export interface MfaVerifyResult extends SignedInResult {
  trustKey?: string;
  replacementRecoveryCode?: string;
}
// ApiError["code"] gains "MFA_CHALLENGE_EXPIRED" | "INVALID_SECOND_FACTOR" | "MFA_UNAVAILABLE" | "SECOND_FACTOR_REQUIRED".

// client/lib/token-storage.ts — separate SecureStore key, same SECURE_OPTIONS
export const trustKeyStorage: {
  get(): Promise<string | null>;
  set(key: string): Promise<void>;
  clear(): Promise<void>;
};

// client/lib/second-factor-utils.ts
export function normalizeCodeInput(raw: string): string; // digits only, max 6
export function isSecondFactorRequired(err: unknown): boolean; // ApiError code SECOND_FACTOR_REQUIRED
export function secondFactorErrorMessage(err: unknown): { message: string; restart: boolean };

// useAuth / AuthContext
login(username, password): Promise<SessionResult>;          // establishes only on signed_in; sends trustKeyStorage.get()
linkWithPassword(ticket, password): Promise<SessionResult>;
verifySecondFactor(challenge: string, proof: SecondFactorInput, trustDevice: boolean): Promise<MfaVerifyResult>; // stores trustKey if returned; does NOT establish
finishSignIn(user: User, token: string): Promise<void>;     // = establishSession

// RootStackParamList
TwoStepCode: { challenge: string; purpose: "login" | "link" };
```

- `TOKEN_KEY`'s sibling: `const TRUST_KEY = "ocrecipes_mfa_trust"`. **`logout`, `expireSession` and `tokenStorage.clear()` never touch it** (D5); only "Forget trusted phones" (Task 14) calls `trustKeyStorage.clear()`.
- `secondFactorErrorMessage`: `MFA_CHALLENGE_EXPIRED` → `{ "This sign-in expired. Please start again.", restart: true }`; `INVALID_SECOND_FACTOR` → the server message; `MFA_UNAVAILABLE` → "Two-step verification is unavailable right now. Please try again later."; `RATE_LIMITED`/429 → "Too many attempts. Please wait a few minutes and try again."; default "Couldn't check that code. Please try again.".
- `SecondFactorField` (controlled): `value`, `onChange(SecondFactorInput | null)`, `onSubmit`, `error?`. Code mode: one field, `textContentType="oneTimeCode"`, `keyboardType="number-pad"`, `autoComplete="one-time-code"`, autofocus, calls `onSubmit` at 6 digits. "Use a recovery code instead" toggles to a text field (`autoCapitalize="characters"`, `autoCorrect={false}`). Errors via `InlineError`. Follows the `interaction-feel` skill (load it before writing this component).
- `TwoStepCodeScreen`: `SecondFactorField` + "Trust this phone for 90 days" `Switch` (only when `purpose === "login"`). On success: no `replacementRecoveryCode` → `finishSignIn`; with one → a card "Your recovery code was used. Here's a new one — save it now." with Copy (`expo-clipboard`) and "I've saved it", which calls `finishSignIn`. On a FAILED response carrying `replacementRecoveryCode`, show the same card before the error (Review Focus 2). `restart` → `navigation.popToTop()`, message shown on Login.
- `LoginScreen`: `if (result.status === "mfa_required") navigation.navigate("TwoStepCode", { challenge: result.challenge, purpose: "login" })`.
- `ConnectAccountScreen`: the password handler gets `mfa_required` → `navigation.replace("TwoStepCode", { challenge, purpose: "link" })`. `ConnectAccountScreen-utils.ts` deletes its `SECOND_FACTOR_REQUIRED` branch (no longer emitted there). `social-auth-utils.ts` deletes its `SECOND_FACTOR_REQUIRED` case (D1: social sign-in never emits it).
- Register `TwoStepCode` in the `!isAuthenticated` group beside `ResetPassword`, title "Two-step verification".

- [ ] **Step 1: Failing tests:** utils tables; `useAuth`: `login` returns the challenge and does NOT write `tokenStorage`; `login` sends the stored trust key; `verifySecondFactor` stores a returned `trustKey`; **`logout` leaves `trustKeyStorage` intact** (Review Focus 1); `TwoStepCodeScreen` (component harness used by `ConnectAccountScreen`'s tests): 6 digits calls `verifySecondFactor` once; the switch is absent for `link`; a replacement code renders and `finishSignIn` waits for "I've saved it"; a failed response with a replacement still shows it; `MFA_CHALLENGE_EXPIRED` pops to top; `LoginScreen`: `mfa_required` navigates with the challenge.
- [ ] **Step 2:** Run the client tests → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(client): two-step code screen for password sign-in and the Connect prompt; trusted phones`.

---

### Task 13: Client — inline code on change email, delete account, connect a sign-in method

**Files:** Modify `client/hooks/useAuth.ts`, `client/context/AuthContext.tsx`, `client/components/ChangeEmailModal.tsx`, `client/components/DeleteAccountModal.tsx`, `client/screens/SignInMethodsScreen.tsx` (connect flow); tests beside each

**Interfaces — Consumes:** `SecondFactorField`, `isSecondFactorRequired`, `secondFactorErrorMessage` (Task 12).
**Produces:** `changeEmail(newEmail, password, secondFactor?)`, `deleteAccount(proof, secondFactor?)`, `connectProvider(provider, password, secondFactor?)` — `secondFactor` is sent only with a password proof; `changeEmail`/`connectProvider` results gain `replacementRecoveryCode?: string`.

Each flow: submit as today. On an error where `isSecondFactorRequired(err)`, keep the entered password, reveal `SecondFactorField` below it with "Enter the code from your authenticator app", and resubmit with `secondFactor`. `INVALID_SECOND_FACTOR` shows inline under the field. A returned `replacementRecoveryCode` shows the same save-it card as Task 12 before closing.

- [ ] **Step 1: Failing tests** per flow: a first 403 `SECOND_FACTOR_REQUIRED` reveals the field without clearing the password; resubmit sends `{ password, secondFactor }`; a provider proof never sends `secondFactor`; replacement code card shown.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(client): ask for the two-step code when a password confirms a sensitive change`.

---

### Task 14: Client — two-step setup and the Security rows

**Files:** Create `client/screens/TwoStepSetupScreen.tsx`, `client/screens/TwoStepSetupScreen-utils.ts` + tests; modify `client/hooks/useAuth.ts`, `client/context/AuthContext.tsx`, `client/navigation/ProfileStackNavigator.tsx`, `client/screens/SignInMethodsScreen.tsx`

**Produces (useAuth / AuthContext):** `startTwoStepSetup(password) → { secret, otpauthUrl }`; `startNewPhone(password, secondFactor) → { secret, otpauthUrl, replacementRecoveryCode? }`; `confirmTwoStep(code) → { recoveryCodes?: string[] }` (stores the returned token via `establishSession`); `disableTwoStep(password, secondFactor) → void` (stores the new token); `replaceRecoveryCodes(password, secondFactor) → string[]`; `forgetTrustedPhones() → void` (server DELETE, then `trustKeyStorage.clear()`); `ProfileStackParamList.TwoStepSetup: { mode: "setup" | "new_phone" | "disable" | "new_codes" }`.

- Utils: `formatSetupKey(b32) → "ABCD EFGH …"` (groups of 4); `recoveryCodesText(codes) → string` (header "OCRecipes recovery codes — each works once", one code per line); `canFinishSaveCodes(acknowledged: boolean) → boolean`.
- Screen states for `setup` / `new_phone`: `confirm` (password, plus `SecondFactorField` for `new_phone`) → `add-key` ("Add to authenticator app" = `Linking.openURL(otpauthUrl)` in try/catch; on rejection an `InlineError` "No authenticator app opened — copy the key instead"; the grouped key with Copy) → `enter-code` → (`setup` only) `save-codes` (list, Copy all, Share, an "I've saved these" checkbox; Done is disabled until ticked) → done. `disable` / `new_codes`: password + `SecondFactorField` → done (new codes → `save-codes`).
- `SignInMethodsScreen`, new "Security" section, from `/me`: `mfaEnabled === false && signInMethods.password` → "Turn on two-step verification"; `mfaEnabled === false && !signInMethods.password` → disabled row "Set a password to turn on two-step verification"; `mfaEnabled` → "Two-step verification: On", "Set up on a new phone", "New recovery codes", "Turn off", "Forget trusted phones" (confirm alert first). A `MFA_SETUP_DISABLED` error on setup shows "Two-step verification isn't available yet."
- Load the `interaction-feel` skill before writing the screen.

- [ ] **Step 1: Failing tests:** utils; `confirmTwoStep` stores the new token; `forgetTrustedPhones` clears `trustKeyStorage`; screen walks setup to the codes and Done stays disabled until the box is ticked; Copy all copies `recoveryCodesText`; `openURL` rejection shows the fallback; `disable` requires both password and code before calling; the Security section renders the right rows for the three states.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(client): turn two-step verification on, move it to a new phone, and manage it`.

---

### Task 15: Finish

- [ ] Simulator check (`verify-ui` skill; pass the UDID; local server with `MFA_SECRET_ENC_KEY` + `MFA_SETUP_ENABLED=true` in `.env`; first command `curl $EXPO_PUBLIC_DOMAIN/api/health`): turn on with demo/demo123 (compute codes with a one-line `npx tsx -e` calling `hotp(base32Decode(secret), timeStep(Date.now()))` — no authenticator app on the simulator), sign out, sign in → code → trust the phone; sign out, sign in → no code; recovery code shows a replacement; change email asks for the code; turn off.
- [ ] Push (preflight:fast), open the PR with label `security`, the "Owner actions" and "Plan-level deviations" sections copied into the body; dispatch the four reviewers with the `docs/AI_WORKFLOW.md` prompt verbatim; one review pass.
- [ ] After review: `/codify` the password-proof gate + challenge-row pattern; update the todo's Updates; **do not archive the todo** (parts 2 and 3 remain).
- [ ] Ask the owner to run the Owner actions, then ask before merging. After merge: preview OTA → owner device test (spec §8 list) → production OTA → `MFA_SETUP_ENABLED=true`.
