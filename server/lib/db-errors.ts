/**
 * Postgres unique-constraint (23505) violation detection.
 *
 * drizzle-orm 0.44+ wraps driver errors in a DrizzleQueryError and moves the
 * original pg error (which carries `.code === "23505"`) onto `.cause`. Checking
 * both the top-level error and its cause keeps detection correct pre- and
 * post-wrap, and avoids the fragile `error.message.includes("unique")` matching
 * that broke once the wrapper changed the message to "Failed query: ...".
 */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}
