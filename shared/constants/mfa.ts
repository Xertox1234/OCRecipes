// Second factor (authenticator-app TOTP + recovery codes). The numbers are the
// owner-approved decisions in docs/superpowers/plans/2026-10-05-totp-second-factor.md.

/** RFC 6238 defaults — what every authenticator app uses. */
export const TOTP_CODE_LENGTH = 6;
export const TOTP_PERIOD_SECONDS = 30;
/** Accept one 30 s step either side of now (clock drift). */
export const TOTP_WINDOW_STEPS = 1;
export const TOTP_SECRET_BYTES = 20;

/** A started-but-unconfirmed setup expires after this. */
export const MFA_ENROLL_TTL_MINUTES = 10;

/** A sign-in that passed the password/provider but not the code yet. */
export const MFA_CHALLENGE_TTL_MINUTES = 5;
export const MFA_CHALLENGE_MAX_ATTEMPTS = 5;

/** Every Nth consecutive wrong code locks the second factor for a while. */
export const MFA_LOCK_EVERY_FAILURES = 10;
export const MFA_LOCK_MINUTES = 15;
/**
 * SP 800-63B-4: at most 100 consecutive failures before the authenticator is
 * disabled. At this count the app code is refused; only a recovery code works.
 */
export const MFA_TOTP_FAILURE_CAP = 100;

export const MFA_RECOVERY_CODE_COUNT = 10;
/** 80 random bits → 16 base32 characters, shown as XXXX-XXXX-XXXX-XXXX. */
export const MFA_RECOVERY_CODE_BYTES = 10;
