import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const BASE = {
  DATABASE_URL: "postgres://localhost/test",
  JWT_SECRET: "x".repeat(32),
  // test/setup.ts sets LOG_LEVEL="silent", which the env schema's pino-level
  // enum rejects. Override it to a valid level so these cases exercise the R2
  // guard rather than failing on an unrelated LOG_LEVEL validation error.
  LOG_LEVEL: "info",
};

async function load() {
  vi.resetModules();
  return await import("../env");
}

describe("validateEnv R2 production guard", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, ...BASE };
  });
  afterEach(() => {
    process.env = saved;
  });

  it("throws in production when R2 is not configured", async () => {
    process.env.NODE_ENV = "production";
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow(/R2.*production/i);
  });

  it("passes in production when all R2 vars are set", async () => {
    process.env.NODE_ENV = "production";
    Object.assign(process.env, {
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
      R2_BUCKET: "d",
      R2_PUBLIC_BASE_URL: "https://img.example.com",
    });
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
  });

  it("does not require R2 outside production", async () => {
    process.env.NODE_ENV = "development";
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
  });

  it("throws in production when only some R2 vars are set", async () => {
    process.env.NODE_ENV = "production";
    Object.assign(process.env, {
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      // R2_SECRET_ACCESS_KEY intentionally omitted
      R2_BUCKET: "d",
      R2_PUBLIC_BASE_URL: "https://img.example.com",
    });
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow(/R2.*production/i);
  });

  it("throws in production when an R2 var is set but blank", async () => {
    process.env.NODE_ENV = "production";
    Object.assign(process.env, {
      R2_ACCOUNT_ID: "",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
      R2_BUCKET: "d",
      R2_PUBLIC_BASE_URL: "https://img.example.com",
    });
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow(/R2.*production/i);
  });
});
