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
    expect(config.options).toBe("-c timezone=UTC");
  });

  it("lets a one-off script raise or disable the statement cap", async () => {
    process.env.DB_STATEMENT_TIMEOUT_MS = "0";
    expect((await loadDb()).statement_timeout).toBe(0);

    process.env.DB_STATEMENT_TIMEOUT_MS = "600000";
    expect((await loadDb()).statement_timeout).toBe(600_000);
  });

  it("ignores a malformed override", async () => {
    process.env.DB_STATEMENT_TIMEOUT_MS = "abc";
    expect((await loadDb()).statement_timeout).toBe(30_000);
  });
});
