/**
 * Password-reset limits shared by the server (storage predicates, routes) and
 * the client (code input length, resend cooldown). Pure constants — no env
 * access — so storage and the client can import them freely.
 * Spec: docs/superpowers/specs/2026-10-03-password-reset-design.md
 */
export const RESET_CODE_LENGTH = 6;
export const RESET_CODE_TTL_MINUTES = 15;
/** Guesses allowed against one issued code before it stops working. */
export const RESET_CODE_MAX_ATTEMPTS = 5;
/** Codes one account can be issued per rolling 24 h (durable, in the DB). */
export const RESET_CODE_DAILY_ISSUE_CAP = 6;
export const RESET_RESEND_COOLDOWN_SECONDS = 60;
