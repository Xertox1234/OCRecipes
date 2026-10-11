/**
 * The restricted pass a short password earns at sign-in (spec
 * docs/superpowers/specs/2026-10-10-password-policy-design.md §6).
 */
export const UPGRADE_PASS_TTL_MINUTES = 30;
/** Wrong two-step codes one pass absorbs before it is dead. */
export const UPGRADE_PASS_MAX_ATTEMPTS = 10;
