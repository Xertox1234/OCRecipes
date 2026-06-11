import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// env-boot imports "dotenv/config" as a side effect, which would repopulate
// the vars this test deletes from the repo's .env file. Stub it out so the
// test controls process.env exclusively. Note: vi.mock() persists across
// vi.resetModules() — only the module cache is cleared, not the mock registry.
vi.mock("dotenv/config", () => ({}));

const BASE = {
  DATABASE_URL: "postgres://localhost/test",
  JWT_SECRET: "x".repeat(32),
};

describe("env-boot side-effect module", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...saved, ...BASE };
    process.env.NODE_ENV = "development";
    delete process.env.RECEIPT_VALIDATION_STUB;
  });
  afterEach(() => {
    process.env = saved;
  });

  it("throws at import with an aggregated report when required vars are missing", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    await expect(import("../env-boot")).rejects.toThrow(
      /DATABASE_URL[\s\S]*JWT_SECRET|JWT_SECRET[\s\S]*DATABASE_URL/,
    );
  });

  it("imports cleanly when required vars are present", async () => {
    await expect(import("../env-boot")).resolves.toBeDefined();
  });
});

describe("server/index.ts boot ordering invariant", () => {
  it("keeps ./lib/env-boot as the first import declaration", async () => {
    // Comment-only invariants don't survive import-sorting autofixes. If
    // env-boot stops being the first import, ./db (reached transitively via
    // ./routes) throws its single-var DATABASE_URL error before validateEnv()
    // can produce the aggregated all-missing-vars report.
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const indexPath = fileURLToPath(
      new URL("../../index.ts", import.meta.url).href,
    );
    const source = await readFile(indexPath, "utf8");
    const firstImport = source.match(/^import\s+.*$/m)?.[0];
    expect(firstImport).toBe('import "./lib/env-boot";');
  });
});
