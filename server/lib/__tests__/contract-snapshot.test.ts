import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { installContractSnapshotMiddleware } from "../contract-snapshot";
import { markDynamicKeyFields } from "../dynamic-key-fields";
import { logger } from "../logger";

function createApp(
  options: Parameters<typeof installContractSnapshotMiddleware>[1],
) {
  const app = express();
  installContractSnapshotMiddleware(app, options);
  app.get("/test/:id", (_req, res) => {
    res.json({ id: 1, name: "a" });
  });
  return app;
}

describe("installContractSnapshotMiddleware", () => {
  it("does not install when CONTRACT_SNAPSHOT is not '1'", async () => {
    const getQuery = vi.fn();
    const app = createApp({
      env: { NODE_ENV: "development" },
      getBranch: () => "feature-branch",
      getQuery,
    });

    const res = await request(app).get("/test/123");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, name: "a" });
    expect(getQuery).not.toHaveBeenCalled();
  });

  it("refuses in NODE_ENV=production even when CONTRACT_SNAPSHOT=1", async () => {
    const getQuery = vi.fn();
    const app = createApp({
      env: { NODE_ENV: "production", CONTRACT_SNAPSHOT: "1" },
      getBranch: () => "feature-branch",
      getQuery,
    });

    const res = await request(app).get("/test/123");

    expect(res.status).toBe(200);
    expect(getQuery).not.toHaveBeenCalled();
  });

  it("does not install when the branch cannot be resolved", async () => {
    const getQuery = vi.fn();
    const app = createApp({
      env: { NODE_ENV: "development", CONTRACT_SNAPSHOT: "1" },
      getBranch: () => null,
      getQuery,
    });

    const res = await request(app).get("/test/123");

    expect(res.status).toBe(200);
    expect(getQuery).not.toHaveBeenCalled();
  });

  it("records a shape keyed by branch, route pattern, method, and status", async () => {
    const queryFn = vi.fn().mockResolvedValue(undefined);
    const getQuery = vi.fn().mockReturnValue(queryFn);
    const app = createApp({
      env: { NODE_ENV: "development", CONTRACT_SNAPSHOT: "1" },
      getBranch: () => "feature-branch",
      getQuery,
    });

    const res = await request(app).get("/test/123");

    expect(res.status).toBe(200);
    expect(queryFn).toHaveBeenCalledTimes(1);
    const [sql, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO dev.contract_snapshots");
    expect(sql).toContain(
      "ON CONFLICT (branch, route_pattern, method, status)",
    );
    expect(params[0]).toBe("feature-branch");
    expect(params[1]).toBe("/test/:id");
    expect(params[2]).toBe("GET");
    expect(params[3]).toBe(200);
    expect(JSON.parse(params[4] as string)).toEqual({
      type: "object",
      keys: { id: { type: "number" }, name: { type: "string" } },
    });
  });

  it("is fail-silent when the DB write rejects", async () => {
    const queryFn = vi.fn().mockRejectedValue(new Error("connection refused"));
    const getQuery = vi.fn().mockReturnValue(queryFn);
    const app = createApp({
      env: { NODE_ENV: "development", CONTRACT_SNAPSHOT: "1" },
      getBranch: () => "feature-branch",
      getQuery,
    });

    const res = await request(app).get("/test/123");

    // The response is unaffected by the background write failing.
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 1, name: "a" });
  });

  it("skips recording when no route matched (e.g. a 404)", async () => {
    const queryFn = vi.fn().mockResolvedValue(undefined);
    const getQuery = vi.fn().mockReturnValue(queryFn);
    const app = express();
    installContractSnapshotMiddleware(app, {
      env: { NODE_ENV: "development", CONTRACT_SNAPSHOT: "1" },
      getBranch: () => "feature-branch",
      getQuery,
    });
    app.use((_req, res) => {
      res.status(404).json({ error: "not found" });
    });

    const res = await request(app).get("/nope");

    expect(res.status).toBe(404);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("does not leak a literal user email from a dynamically-keyed response body", async () => {
    const queryFn = vi.fn().mockResolvedValue(undefined);
    const getQuery = vi.fn().mockReturnValue(queryFn);
    const app = express();
    installContractSnapshotMiddleware(app, {
      env: { NODE_ENV: "development", CONTRACT_SNAPSHOT: "1" },
      getBranch: () => "feature-branch",
      getQuery,
    });
    app.get("/nutrition-by-email", (_req, res) => {
      res.json({ "alice@example.com": { calories: 500, protein: 30 } });
    });

    const res = await request(app).get("/nutrition-by-email");

    expect(res.status).toBe(200);
    expect(queryFn).toHaveBeenCalledTimes(1);
    const [, params] = queryFn.mock.calls[0] as [string, unknown[]];
    const shapeJson = params[4] as string;
    expect(shapeJson).not.toContain("alice@example.com");
    expect(shapeJson).not.toContain("@");
    expect(shapeJson).toContain("<dynamic>");
    expect(JSON.parse(shapeJson)).toEqual({
      type: "object",
      keys: {
        "<dynamic>": {
          type: "object",
          keys: { calories: { type: "number" }, protein: { type: "number" } },
        },
      },
    });
  });

  it("force-redacts a single-entry dynamically-keyed field marked via markDynamicKeyFields, closing the gap neither heuristic alone catches (mechanism-level pin — see grocery.test.ts/menu.test.ts for the real-route pin)", async () => {
    const queryFn = vi.fn().mockResolvedValue(undefined);
    const getQuery = vi.fn().mockReturnValue(queryFn);
    const app = express();
    installContractSnapshotMiddleware(app, {
      env: { NODE_ENV: "development", CONTRACT_SNAPSHOT: "1" },
      getBranch: () => "feature-branch",
      getQuery,
    });
    app.get("/allergen-flags", (_req, res) => {
      // Exactly what a producer does: mark right before res.json, next to the
      // code that built the dynamic map.
      markDynamicKeyFields(res, ["allergenFlags"]);
      res.json({
        allergenFlags: {
          shrimp: { allergenId: "shellfish", severity: "high" },
        },
      });
    });

    const res = await request(app).get("/allergen-flags");

    expect(res.status).toBe(200);
    expect(queryFn).toHaveBeenCalledTimes(1);
    const [, params] = queryFn.mock.calls[0] as [string, unknown[]];
    const shapeJson = params[4] as string;
    // Without the marker, a single-entry map like this would NOT be redacted --
    // see contract-shape.test.ts's "does NOT redact that same single-entry map
    // without the marker" for the same fixture proving the negative.
    expect(shapeJson).not.toContain("shrimp");
    expect(JSON.parse(shapeJson)).toEqual({
      type: "object",
      keys: {
        allergenFlags: {
          type: "object",
          keys: {
            "<dynamic>": {
              type: "object",
              keys: {
                allergenId: { type: "string" },
                severity: { type: "string" },
              },
            },
          },
        },
      },
    });
  });

  it("logs a dev-mode debug breadcrumb when a uniform-primitive-valued object reaches the plain (non-redacted) path (observability only -- does not change the stored shape)", async () => {
    const queryFn = vi.fn().mockResolvedValue(undefined);
    const getQuery = vi.fn().mockReturnValue(queryFn);
    const app = express();
    installContractSnapshotMiddleware(app, {
      env: { NODE_ENV: "development", CONTRACT_SNAPSHOT: "1" },
      getBranch: () => "feature-branch",
      getQuery,
    });
    app.get("/dimensions", (_req, res) => {
      res.json({ width: 100, height: 50 });
    });

    const debugSpy = vi.spyOn(logger, "debug");
    const res = await request(app).get("/dimensions");

    expect(res.status).toBe(200);
    // Behavior is unchanged: the object is genuinely not redacted either way.
    const [, params] = queryFn.mock.calls[0] as [string, unknown[]];
    expect(JSON.parse(params[4] as string)).toEqual({
      type: "object",
      keys: { height: { type: "number" }, width: { type: "number" } },
    });

    const matchingCall = debugSpy.mock.calls.find(
      (call) =>
        typeof call[1] === "string" && call[1].includes("was NOT redacted"),
    );
    expect(matchingCall).toBeDefined();
    expect(matchingCall?.[0]).toMatchObject({ routePattern: "/dimensions" });

    debugSpy.mockRestore();
  });

  it("does NOT log the redaction-gap breadcrumb for an ordinary object that isn't a uniform-primitive candidate (no false trigger)", async () => {
    const queryFn = vi.fn().mockResolvedValue(undefined);
    const getQuery = vi.fn().mockReturnValue(queryFn);
    const app = createApp({
      env: { NODE_ENV: "development", CONTRACT_SNAPSHOT: "1" },
      getBranch: () => "feature-branch",
      getQuery,
    });

    const debugSpy = vi.spyOn(logger, "debug");
    const res = await request(app).get("/test/123");

    expect(res.status).toBe(200);
    const matchingCall = debugSpy.mock.calls.find(
      (call) =>
        typeof call[1] === "string" && call[1].includes("was NOT redacted"),
    );
    expect(matchingCall).toBeUndefined();

    debugSpy.mockRestore();
  });
});

describe("getLabPool (lab-DB denylist)", () => {
  // Each case only exercises the throw path, which returns before `labPool` is ever
  // assigned — so the module-level singleton never leaks a constructed Pool across
  // these tests. vi.resetModules() + dynamic import is still used per
  // docs/solutions/design-patterns/vi-resetmodules-for-env-dependent-testing-2026-05-13.md,
  // as defensive isolation for a module with mutable top-level state.
  it("throws when LAB_DATABASE_URL resolves to nutricam", async () => {
    vi.resetModules();
    const { getLabPool } = await import("../contract-snapshot");
    expect(() =>
      getLabPool({
        NODE_ENV: "test",
        LAB_DATABASE_URL: "postgresql://localhost/nutricam",
      }),
    ).toThrow(/nutricam/);
  });

  it("throws even when a query string masks the database name (regression)", async () => {
    // postgresql://localhost/nutricam?sslmode=require -- a naive `lastIndexOf("/")`
    // slice yields "nutricam?sslmode=require", which does NOT equality-match "nutricam"
    // and would silently bypass the denylist.
    vi.resetModules();
    const { getLabPool } = await import("../contract-snapshot");
    expect(() =>
      getLabPool({
        NODE_ENV: "test",
        LAB_DATABASE_URL: "postgresql://localhost/nutricam?sslmode=require",
      }),
    ).toThrow(/nutricam/);
  });

  it("throws when LAB_DATABASE_URL resolves to ocrecipes_solutions", async () => {
    vi.resetModules();
    const { getLabPool } = await import("../contract-snapshot");
    expect(() =>
      getLabPool({
        NODE_ENV: "test",
        LAB_DATABASE_URL: "postgresql://localhost/ocrecipes_solutions",
      }),
    ).toThrow(/ocrecipes_solutions/);
  });

  it("throws when the resolved database name isn't a safe identifier", async () => {
    vi.resetModules();
    const { getLabPool } = await import("../contract-snapshot");
    expect(() =>
      getLabPool({
        NODE_ENV: "test",
        LAB_DATABASE_URL: 'postgresql://localhost/foo"; DROP TABLE x; --',
      }),
    ).toThrow(/safe identifier/);
  });

  it("throws on a percent-encoded 'nutricam' path segment (regression)", async () => {
    // postgresql://localhost/nutr%69cam decodes to the literal database "nutricam" for
    // an actual Postgres connection, but parseDbName()'s raw (non-decoded) pathname
    // still contains "%", which SAFE_IDENTIFIER_RE rejects -- confirm that rejection
    // fires, so this bypass class stays closed even though it isn't caught by the
    // exact-string denylist itself.
    vi.resetModules();
    const { getLabPool } = await import("../contract-snapshot");
    expect(() =>
      getLabPool({
        NODE_ENV: "test",
        LAB_DATABASE_URL: "postgresql://localhost/nutr%69cam",
      }),
    ).toThrow(/safe identifier/);
  });
});
