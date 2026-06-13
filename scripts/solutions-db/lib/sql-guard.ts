// Heuristic guard for the `sql` MCP tool. The HARD guarantee is the
// solutions_ro SELECT-only role; this is defense-in-depth on top of it.
// Known limitation: a forbidden keyword inside a quoted string literal
// (e.g. WHERE title = 'how to delete files') is over-rejected, because this
// guard is not quote-aware. Acceptable — the hard guarantee is the
// solutions_ro SELECT-only role; this is defense-in-depth only.
const FORBIDDEN =
  /\b(insert|update|delete|drop|alter|truncate|grant|revoke|create|replace|merge|copy)\b/i;

export function isReadOnlyQuery(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, "");
  if (trimmed.includes(";")) return false; // no multiple statements
  if (!/^\s*(select|with)\b/i.test(trimmed)) return false;
  if (FORBIDDEN.test(trimmed)) return false;
  return true;
}

export function assertReadOnly(sql: string): void {
  if (!isReadOnlyQuery(sql)) {
    throw new Error("Only a single read-only SELECT/WITH query is allowed.");
  }
}
