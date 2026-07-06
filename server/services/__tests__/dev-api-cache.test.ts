import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// dev-api-cache.ts constructs its own pg.Pool against LAB_DATABASE_URL (never
// the app's server/db.ts pool). Mock the "pg" package itself so no real
// connection is ever attempted. vi.hoisted is required because the vi.mock
// factory below is hoisted above these const declarations.
const { mockQuery, mockPoolCtor } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockPoolCtor: vi.fn(),
}));

vi.mock("pg", () => ({
  default: {
    // A real class, not vi.fn().mockImplementation(() => ({...})) — arrow
    // functions aren't constructible, so `new Pool()` would throw "is not a
    // constructor" (docs/solutions/design-patterns/mocking-class-constructors-vi-mock-2026-05-13.md).
    Pool: class MockPool {
      query = mockQuery;
      on = vi.fn();
      constructor(...args: unknown[]) {
        mockPoolCtor(...args);
      }
    },
  },
}));

// Every test below re-imports dev-api-cache.ts via vi.resetModules(), which
// also forces a fresh import of ../lib/logger — without this mock, each
// reset spins up a real pino-pretty transport (MaxListenersExceededWarning
// across ~9 resets). Mock it the same way server/lib/__tests__/env.test.ts
// does for the same reason.
vi.mock("../../lib/logger", () => {
  const noopLogger = {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  return {
    rootLogger: noopLogger,
    logger: noopLogger,
    createServiceLogger: () => noopLogger,
    toError: (e: unknown) => e,
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ORIGINAL_ENV = { ...process.env };

/** Fresh module + fresh env for every test — the module reads process.env
 * at both import time (the prod guard) and call time (resolveMode()). */
async function loadModule() {
  vi.resetModules();
  return import("../dev-api-cache");
}

describe("dev-api-cache", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockPoolCtor.mockClear();
    mockFetch.mockReset();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  describe("prod guard", () => {
    it("throws at import time when NODE_ENV=production and API_CACHE is set", async () => {
      process.env.NODE_ENV = "production";
      process.env.API_CACHE = "1";

      vi.resetModules();
      await expect(import("../dev-api-cache")).rejects.toThrow(/API_CACHE/i);
    });

    it("does not throw when NODE_ENV=production and API_CACHE is unset", async () => {
      process.env.NODE_ENV = "production";
      delete process.env.API_CACHE;

      await expect(loadModule()).resolves.toBeDefined();
    });

    it("does not throw when NODE_ENV=production and API_CACHE is an unrecognized value (e.g. a leftover/garbage env var)", async () => {
      process.env.NODE_ENV = "production";
      process.env.API_CACHE = "true";

      await expect(loadModule()).resolves.toBeDefined();
    });
  });

  describe("passthrough (API_CACHE unset or wrong NODE_ENV)", () => {
    it("calls fetch directly and never constructs the lab DB pool when API_CACHE is unset", async () => {
      process.env.NODE_ENV = "development";
      delete process.env.API_CACHE;
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

      const { cachedFetch } = await loadModule();
      const res = await cachedFetch(
        "usda",
        "https://api.example.com/x?api_key=secret",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockPoolCtor).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
    });

    it("is a passthrough outside NODE_ENV=development even when API_CACHE=1", async () => {
      process.env.NODE_ENV = "test";
      process.env.API_CACHE = "1";
      mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));

      const { cachedFetch } = await loadModule();
      await cachedFetch("usda", "https://api.example.com/x");

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockPoolCtor).not.toHaveBeenCalled();
    });
  });

  describe("replay mode (API_CACHE=1)", () => {
    beforeEach(() => {
      process.env.NODE_ENV = "development";
      process.env.API_CACHE = "1";
    });

    it("replays a cache hit without calling fetch", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ response: { hit: true }, status: 200 }],
      });

      const { cachedFetch } = await loadModule();
      const res = await cachedFetch(
        "usda",
        "https://api.example.com/search?query=apple&api_key=SECRET",
      );

      expect(mockFetch).not.toHaveBeenCalled();
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/json");
      await expect(res.json()).resolves.toEqual({ hit: true });
    });

    it("calls fetch and records the fresh response to the cache on a miss", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // lookup: miss
        .mockResolvedValueOnce({ rows: [] }) // insert into dev.api_cache
        .mockResolvedValueOnce({ rows: [] }); // value-probe log insert
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ fresh: true }), { status: 200 }),
      );

      const { cachedFetch } = await loadModule();
      const res = await cachedFetch(
        "usda",
        "https://api.example.com/search?query=apple",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockQuery).toHaveBeenCalledTimes(3);
      const [insertSql, insertParams] = mockQuery.mock.calls[1] as [
        string,
        unknown[],
      ];
      expect(insertSql).toMatch(/INSERT INTO dev\.api_cache/i);
      expect(insertParams[0]).toBe("usda");
      await expect(res.json()).resolves.toEqual({ fresh: true });
    });

    it("excludes API-key-like params from the request hash so key rotation doesn't invalidate the cache", async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ response: { a: 1 }, status: 200 }],
      });
      const { cachedFetch } = await loadModule();
      await cachedFetch(
        "usda",
        "https://api.example.com/search?query=apple&api_key=KEY_A",
      );
      const [, firstParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      const hashWithKeyA = firstParams[1];

      mockQuery.mockReset();
      mockQuery.mockResolvedValueOnce({
        rows: [{ response: { a: 1 }, status: 200 }],
      });
      await cachedFetch(
        "usda",
        "https://api.example.com/search?query=apple&api_key=KEY_B",
      );
      const [, secondParams] = mockQuery.mock.calls[0] as [string, unknown[]];
      const hashWithKeyB = secondParams[1];

      expect(hashWithKeyA).toBe(hashWithKeyB);
    });

    it("does not cache a non-2xx response, so a transient failure can be retried on the next run", async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // lookup: miss
        .mockResolvedValueOnce({ rows: [] }); // value-probe log insert only
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ error: "rate limited" }), {
          status: 429,
        }),
      );

      const { cachedFetch } = await loadModule();
      const res = await cachedFetch(
        "usda",
        "https://api.example.com/search?query=apple",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(429);
      const insertCalls = mockQuery.mock.calls.filter(([sql]) =>
        /INSERT INTO dev\.api_cache\b/i.test(sql as string),
      );
      expect(insertCalls.length).toBe(0);
    });

    it("falls back to a real fetch when the lab DB is unreachable (fail-silent)", async () => {
      mockQuery.mockRejectedValue(new Error("connection refused"));
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ real: true }), { status: 200 }),
      );

      const { cachedFetch } = await loadModule();
      const res = await cachedFetch(
        "usda",
        "https://api.example.com/search?query=apple",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      await expect(res.json()).resolves.toEqual({ real: true });
    });
  });

  describe("refresh mode (API_CACHE=refresh)", () => {
    it("always calls fetch and re-records, never replaying an existing row", async () => {
      process.env.NODE_ENV = "development";
      process.env.API_CACHE = "refresh";
      mockFetch.mockResolvedValue(
        new Response(JSON.stringify({ refreshed: true }), { status: 200 }),
      );
      mockQuery.mockResolvedValue({ rows: [] });

      const { cachedFetch } = await loadModule();
      const res = await cachedFetch(
        "usda",
        "https://api.example.com/search?query=apple",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const selectCalls = mockQuery.mock.calls.filter(([sql]) =>
        /SELECT/i.test(sql as string),
      );
      expect(selectCalls.length).toBe(0);
      const insertCalls = mockQuery.mock.calls.filter(([sql]) =>
        /INSERT INTO dev\.api_cache\b/i.test(sql as string),
      );
      expect(insertCalls.length).toBe(1);
      await expect(res.json()).resolves.toEqual({ refreshed: true });
    });
  });
});
