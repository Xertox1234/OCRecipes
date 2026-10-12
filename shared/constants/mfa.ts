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
// Two-step by emailed code (owner ruling 4, 2026-10-12).
export const MFA_EMAIL_CODE_TTL_MINUTES = 10;
/** Guesses allowed against one emailed code (every guess counts, right or wrong). */
export const MFA_EMAIL_CODE_MAX_ATTEMPTS = 5;
/** Codes per account per fixed 24 h window, starting at the first code. */
export const MFA_EMAIL_CODE_DAILY_ISSUE_CAP = 10;
/** Minimum gap between two emailed codes. */
export const MFA_EMAIL_RESEND_COOLDOWN_SECONDS = 30;
