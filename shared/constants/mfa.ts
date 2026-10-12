// Two-step verification by emailed code (owner ruling 4, 2026-10-12), plus
// trusted phones. Spec: docs/superpowers/specs/2026-10-10-totp-second-factor-design.md
// (authenticator apps and recovery codes since removed).
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
/** Every Nth consecutive failure locks the second factor for MFA_LOCK_MINUTES. */
export const MFA_LOCK_EVERY_FAILURES = 10;
export const MFA_LOCK_MINUTES = 15;
export const MFA_TRUST_DAYS = 90;
/** An emailed code, and the sign-in challenge waiting for it, last this long. */
export const MFA_EMAIL_CODE_TTL_MINUTES = 10;
/** Guesses allowed against one emailed code (every guess counts, right or wrong). */
export const MFA_EMAIL_CODE_MAX_ATTEMPTS = 5;
/** Codes per account per fixed 24 h window, starting at the first code. */
export const MFA_EMAIL_CODE_DAILY_ISSUE_CAP = 10;
/** Minimum gap between two emailed codes. */
export const MFA_EMAIL_RESEND_COOLDOWN_SECONDS = 30;
