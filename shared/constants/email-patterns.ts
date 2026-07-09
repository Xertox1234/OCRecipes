/**
 * Pragmatic, non-authoritative email-shape regex, factored out so more than
 * one consumer can reference the same literal without an inline copy
 * drifting. This is NOT a validation boundary anywhere it's used — the
 * server's actual email validation is `z.string().email()` in
 * server/routes/_schemas.ts, and client screens that pre-flight-check emails
 * for UX keep their own local mirrors intentionally decoupled from this
 * constant (see docs/solutions/logic-errors/client-mirror-server-validation-signup-email-trap-2026-06-18.md
 * for why those client copies are deliberately independent, hand-synced
 * mirrors of the server Zod schema rather than a shared literal).
 */
export const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
