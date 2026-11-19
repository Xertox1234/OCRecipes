import { describe, it, expect, vi, afterEach } from "vitest";
import { format } from "util";

/**
 * What a script prints with console.error is outside pino, so the logger's
 * `err` serializer never sees it. These drive the retention script's real CLI
 * entry point with a failed statement and read everything it printed.
 *
 * The logger is NOT mocked here: the redaction under test is the real
 * `toError` from server/lib/logger.ts.
 */
const MARKER = "ZZMARKER-allergy";

const { execute, poolEnd } = vi.hoisted(() => ({
  execute: vi.fn(),
  poolEnd: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../db", () => ({
  db: { execute },
  pool: { end: poolEnd },
}));

vi.mock("../purge-inspired-suggestions", () => ({
  purgeExpiredInspiredSuggestions: vi
    .fn()
    .mockResolvedValue({ rows: 0, images: 0 }),
}));

/** A failed Drizzle statement: bound values in the message tail, pg error as cause. */
async function failedQuery() {
  const { DrizzleQueryError } = await import("drizzle-orm");
  const pgError = Object.assign(
    new Error(`invalid input syntax for type json: "${MARKER}"`),
    { code: "22P02" },
  );
  return new DrizzleQueryError(
    'delete from "daily_logs" where "user_id" <> all($1)',
    [MARKER],
    pgError,
  );
}

/** Everything console.error received, formatted the way the console prints it. */
function printed(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((args) => format(...args)).join("\n");
}

describe("cleanup-retention CLI: what a failed statement prints", () => {
  const argv1 = process.argv[1];
  const exitCode = process.exitCode;

  afterEach(() => {
    process.argv[1] = argv1;
    process.exitCode = exitCode;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("control: the failed statement's own message carries the marker", async () => {
    const err = await failedQuery();
    expect(err.message).toContain("\nparams:");
    expect(err.message).toContain(MARKER);
  });

  it("prints the failure without the statement's bound values", async () => {
    execute.mockRejectedValue(await failedQuery());
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    // The script runs main() only when started directly; this is its own test.
    process.argv[1] = "/app/server/scripts/cleanup-retention.ts";

    await import("../cleanup-retention");
    await vi.waitFor(() => expect(poolEnd).toHaveBeenCalled());

    const out = printed(errorSpy);
    expect(out).toContain("Retention cleanup failed:");
    expect(out).toContain('delete from "daily_logs"');
    expect(out).not.toContain(MARKER);
    expect(process.exitCode).toBe(1);
  });
});

/**
 * The other scripts print the caught error whole (`console.error(label, err)`).
 * The console formats an Error with util.inspect: stack, own fields (`query`,
 * `params`) and the cause chain. This pins that `toError(err)` is safe to hand
 * to it as-is, which is the shape those scripts use.
 */
describe("a failed statement printed whole", () => {
  it("control: printing the raw error exposes the marker", async () => {
    expect(format("Backfill failed:", await failedQuery())).toContain(MARKER);
  });

  it("toError(err) prints the statement and pg code, not the values", async () => {
    const { toError } = await import("../../lib/logger");
    const out = format("Backfill failed:", toError(await failedQuery()));
    expect(out).toContain('delete from "daily_logs"');
    expect(out).toContain("22P02");
    expect(out).not.toContain(MARKER);
  });

  it("an ordinary error is printed unchanged", async () => {
    const { toError } = await import("../../lib/logger");
    const err = new Error("R2 upload failed: 503");
    expect(toError(err)).toBe(err);
  });
});
