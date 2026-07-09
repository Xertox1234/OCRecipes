/**
 * Server-only identifier-shape regex constants, factored out so more than one
 * module can reference the same pattern without an inline copy drifting.
 *
 * Kept as a standalone module (not colocated in server/index.ts, where the
 * canonical UUID check originally lived) to avoid a circular import: index.ts
 * -> lib/contract-snapshot.ts -> lib/contract-shape.ts, so contract-shape.ts
 * importing back from index.ts (which also runs app-boot side effects at
 * module scope) would cycle. This module has no dependents of its own, so
 * both index.ts and contract-shape.ts can import it safely.
 */

/** Matches a canonical (RFC 4122-shaped) UUID string, case-insensitively. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
