import type { RecentFilters } from "./query-builder";

/**
 * Parse `recent` CLI argv into `{ filters, k }`. PURE — throws `Error` on invalid
 * input (the CLI catches it, prints the message, and exits 1). Kept side-effect-free
 * (no `process.exit`) so it is unit-testable, mirroring the query-builder split.
 *
 * Rules: `--days`/`--limit` must be POSITIVE INTEGERS; `--track` must be `bug`|`knowledge`.
 * `--limit` defaults to 20 when absent.
 */
export function parseRecentArgs(argv: string[]): {
  filters: RecentFilters;
  k: number;
} {
  const args = argv.filter((a) => a !== "--");
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };
  const posInt = (flag: string, raw: string): number => {
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0)
      throw new Error(`${flag} must be a positive integer (got "${raw}")`);
    return n;
  };

  const filters: RecentFilters = {};
  const days = get("--days");
  if (days !== undefined) filters.days = posInt("--days", days);
  const track = get("--track");
  if (track !== undefined) {
    if (track !== "bug" && track !== "knowledge")
      throw new Error(`--track must be "bug" or "knowledge" (got "${track}")`);
    filters.track = track;
  }
  const category = get("--category");
  if (category) filters.category = category;
  const limit = get("--limit");
  const k = limit !== undefined ? posInt("--limit", limit) : 20;

  return { filters, k };
}
