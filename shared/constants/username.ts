/**
 * The username rule, imported by the server's `registerSchema` and the
 * client's sign-up check and live checklist, so the two never drift.
 * Length is counted in UTF-16 units, as zod's `.min`/`.max` do; the pattern
 * is ASCII-only, so that equals characters for any name it accepts.
 */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;
export const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/;
