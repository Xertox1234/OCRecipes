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

/**
 * Returns the violated unique constraint's name (e.g. "users_email_unique") for a
 * 23505 error, checking both the top-level error and its drizzle-wrapped `.cause`.
 * Returns undefined when it is not a unique violation or the driver did not
 * surface a constraint name. Callers use this to map a single 23505 to the right
 * per-field message when a table has more than one unique column.
 */
export function uniqueViolationConstraint(err: unknown): string | undefined {
  const e = err as {
    code?: string;
    constraint?: string;
    cause?: { code?: string; constraint?: string };
  } | null;
  if (e?.code === "23505") return e.constraint;
  if (e?.cause?.code === "23505") return e.cause.constraint;
  return undefined;
}
