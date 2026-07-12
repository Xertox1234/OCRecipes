import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Capture logger.warn so the optional-feature warnings can be asserted. env.ts is
// the only consumer of "./logger" in this import graph (image-store does not use it).
const { mockWarn } = vi.hoisted(() => ({ mockWarn: vi.fn() }));
vi.mock("../logger", () => {
  const l = {
    warn: mockWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
  };
  return {
    rootLogger: l,
    logger: l,
    createServiceLogger: () => l,
    toError: (e: unknown) => e,
  };
});

const BASE = {
  DATABASE_URL: "postgres://localhost/test",
  JWT_SECRET: "x".repeat(32),
};

async function load() {
  vi.resetModules();
  return await import("../env");
}

describe("validateEnv R2 production guard", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, ...BASE };
    // CI sets RECEIPT_VALIDATION_STUB=true globally. With NODE_ENV=production
    // that guard throws before the R2 check, masking these cases (passes
    // locally only because the dev shell doesn't set it). Clear it so each
    // test exercises the R2 production guard in isolation.
    delete process.env.RECEIPT_VALIDATION_STUB;
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

  it("accepts LOG_LEVEL=silent (a valid pino level)", async () => {
    process.env.NODE_ENV = "development";
    process.env.LOG_LEVEL = "silent";
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
  });
});

describe("validateEnv aggregated missing-vars report", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, ...BASE };
    process.env.NODE_ENV = "development";
    delete process.env.RECEIPT_VALIDATION_STUB;
  });
  afterEach(() => {
    process.env = saved;
  });

  it("lists ALL missing required vars in a single error", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.JWT_SECRET;
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow(
      /DATABASE_URL[\s\S]*JWT_SECRET|JWT_SECRET[\s\S]*DATABASE_URL/,
    );
  });
});

describe("validateEnv server error tracking (Sentry)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, ...BASE };
    process.env.NODE_ENV = "development";
    delete process.env.SENTRY_DSN;
    mockWarn.mockClear();
  });
  afterEach(() => {
    process.env = saved;
  });

  it("warns (does not throw) when SENTRY_DSN is unset — error tracking dark must not be silent", async () => {
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
    const warnedAboutSentry = mockWarn.mock.calls.some((c) =>
      String(c[1]).includes("SENTRY_DSN"),
    );
    expect(warnedAboutSentry).toBe(true);
  });

  it("does not warn about SENTRY_DSN when it is set", async () => {
    process.env.SENTRY_DSN = "https://public-key@o0.ingest.sentry.io/1";
    const { validateEnv } = await load();
    validateEnv();
    const warnedAboutSentry = mockWarn.mock.calls.some((c) =>
      String(c[1]).includes("SENTRY_DSN"),
    );
    expect(warnedAboutSentry).toBe(false);
  });
});

describe("validateEnv email verification (Resend)", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, ...BASE };
    process.env.NODE_ENV = "development";
    delete process.env.RECEIPT_VALIDATION_STUB;
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_VERIFY_BASE_URL;
    mockWarn.mockClear();
  });
  afterEach(() => {
    process.env = saved;
  });

  it("warns (does not throw) when RESEND_API_KEY is unset — the fail-open gate must not be silent (M8)", async () => {
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
    const warnedAboutResend = mockWarn.mock.calls.some((c) =>
      String(c[1]).includes("RESEND_API_KEY"),
    );
    expect(warnedAboutResend).toBe(true);
  });

  it("does not warn about RESEND_API_KEY when it is set", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    const { validateEnv } = await load();
    validateEnv();
    const warnedAboutResend = mockWarn.mock.calls.some((c) =>
      String(c[1]).includes("RESEND_API_KEY"),
    );
    expect(warnedAboutResend).toBe(false);
  });

  it("throws when EMAIL_VERIFY_BASE_URL has a trailing slash (L12 — would yield //verify-email)", async () => {
    process.env.EMAIL_VERIFY_BASE_URL = "https://ocrecipes.app/";
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow(
      /EMAIL_VERIFY_BASE_URL.*trailing slash/i,
    );
  });

  it("accepts EMAIL_VERIFY_BASE_URL without a trailing slash", async () => {
    process.env.EMAIL_VERIFY_BASE_URL = "https://ocrecipes.app";
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
  });
});
