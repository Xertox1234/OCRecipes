const { poolConfigs } = vi.hoisted(() => ({
  poolConfigs: [] as Record<string, unknown>[],
}));

vi.mock("pg", () => ({
  default: {
    Pool: vi.fn(function (config: Record<string, unknown>) {
      poolConfigs.push(config);
      return { on: vi.fn() };
    }),
  },
}));

vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: vi.fn(() => ({})) }));

async function loadDb() {
  vi.resetModules();
  poolConfigs.length = 0;
  await import("../db");
  return poolConfigs[0];
}

// Without these the pool waits forever for a free connection and never caps
// a query, so a few slow requests hang every request — health check included
// (pre-launch audit 2026-10-29).
describe("database pool", () => {
  const originalStatementTimeout = process.env.DB_STATEMENT_TIMEOUT_MS;

  beforeEach(() => {
    process.env.DATABASE_URL ??= "postgres://localhost/test";
    delete process.env.DB_STATEMENT_TIMEOUT_MS;
  });

  afterAll(() => {
    if (originalStatementTimeout === undefined) {
      delete process.env.DB_STATEMENT_TIMEOUT_MS;
    } else {
      process.env.DB_STATEMENT_TIMEOUT_MS = originalStatementTimeout;
    }
  });

  it("gives up waiting for a connection and caps each statement", async () => {
    const config = await loadDb();

    expect(config.connectionTimeoutMillis).toBe(5_000);
    expect(config.statement_timeout).toBe(30_000);
    // A leaked open transaction must not hold row locks forever.
    expect(config.idle_in_transaction_session_timeout).toBe(60_000);
    expect(config.options).toBe("-c timezone=UTC");
  });

  it("lets a one-off script raise or disable the statement cap", async () => {
    process.env.DB_STATEMENT_TIMEOUT_MS = "0";
    expect((await loadDb()).statement_timeout).toBe(0);

    process.env.DB_STATEMENT_TIMEOUT_MS = "600000";
    expect((await loadDb()).statement_timeout).toBe(600_000);
  });

  // A blank value (an empty Railway variable) parses as 0 with Number() and
  // would silently turn the cap off.
  it.each(["abc", "", " ", "-5", "1.5", "1e3"])(
    "ignores the malformed override %j",
    async (value) => {
      process.env.DB_STATEMENT_TIMEOUT_MS = value;
      expect((await loadDb()).statement_timeout).toBe(30_000);
    },
  );

  // The iOS E2E runner is so starved that opening a new connection can take
  // longer than connectionTimeoutMillis (Postgres took 6-8 s to start a
  // backend in run 43120554293). The CI job keeps idle connections open with
  // DB_POOL_IDLE_TIMEOUT_MS=0; everywhere else pg's default stays.
  describe("idle connection timeout", () => {
    const originalIdle = process.env.DB_POOL_IDLE_TIMEOUT_MS;

    beforeEach(() => {
      delete process.env.DB_POOL_IDLE_TIMEOUT_MS;
    });

    afterAll(() => {
      if (originalIdle === undefined) {
        delete process.env.DB_POOL_IDLE_TIMEOUT_MS;
      } else {
        process.env.DB_POOL_IDLE_TIMEOUT_MS = originalIdle;
      }
    });

    it("leaves pg's default in place when unset", async () => {
      expect(await loadDb()).not.toHaveProperty("idleTimeoutMillis");
    });

    it("keeps idle connections open when set to 0, or uses the given value", async () => {
      process.env.DB_POOL_IDLE_TIMEOUT_MS = "0";
      expect((await loadDb()).idleTimeoutMillis).toBe(0);

      process.env.DB_POOL_IDLE_TIMEOUT_MS = "60000";
      expect((await loadDb()).idleTimeoutMillis).toBe(60_000);
    });

    it.each(["abc", "", " ", "-5", "1.5", "1e3"])(
      "ignores the malformed value %j",
      async (value) => {
        process.env.DB_POOL_IDLE_TIMEOUT_MS = value;
        expect(await loadDb()).not.toHaveProperty("idleTimeoutMillis");
      },
    );
  });
});
