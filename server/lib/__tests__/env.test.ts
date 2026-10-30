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
    process.env.EMAIL_VERIFY_BASE_URL = "https://ocrecipes.com/";
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow(
      /EMAIL_VERIFY_BASE_URL.*trailing slash/i,
    );
  });

  it("throws when IDENTITY_TOKEN_ENC_KEY is not 32 bytes", async () => {
    process.env.IDENTITY_TOKEN_ENC_KEY = Buffer.alloc(16).toString("base64");
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow(/IDENTITY_TOKEN_ENC_KEY.*32 bytes/);
  });

  // Authenticator apps were removed: a leftover key in the host is ignored.
  it("ignores a leftover MFA_SECRET_ENC_KEY", async () => {
    process.env.MFA_SECRET_ENC_KEY = Buffer.alloc(16).toString("base64");
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
  });

  it("throws when APPLE_SIGN_IN_PRIVATE_KEY is not a PEM", async () => {
    process.env.APPLE_SIGN_IN_PRIVATE_KEY = "not-a-key";
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow(/APPLE_SIGN_IN_PRIVATE_KEY/);
  });

  it("accepts EMAIL_VERIFY_BASE_URL without a trailing slash", async () => {
    process.env.EMAIL_VERIFY_BASE_URL = "https://ocrecipes.com";
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
  });
});

describe("validateEnv OPENROUTER_API_KEY", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env = { ...saved, ...BASE };
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.RECEIPT_VALIDATION_STUB;
    process.env.NODE_ENV = "development";
  });
  afterEach(() => {
    process.env = saved;
  });

  it("accepts an optional OPENROUTER_API_KEY and passes it through", async () => {
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    const { validateEnv } = await load();
    expect(validateEnv().OPENROUTER_API_KEY).toBe("sk-or-test");
  });

  it("OPENROUTER_API_KEY is optional", async () => {
    const { validateEnv } = await load();
    expect(validateEnv().OPENROUTER_API_KEY).toBeUndefined();
  });
});

describe("validateEnv IAP / RTDN configuration", () => {
  const saved = { ...process.env };
  const IAP_KEYS = [
    "APPLE_ISSUER_ID",
    "APPLE_KEY_ID",
    "APPLE_PRIVATE_KEY",
    "APPLE_BUNDLE_ID",
    "APPLE_ENVIRONMENT",
    "APPLE_APP_ID",
    "GOOGLE_PACKAGE_NAME",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_KEY",
    "GOOGLE_PUBSUB_AUDIENCE",
    "GOOGLE_PUBSUB_SA_EMAIL",
    "RECEIPT_VALIDATION_STUB",
  ];
  const APPLE_CREDS = {
    APPLE_ISSUER_ID: "issuer",
    APPLE_KEY_ID: "key",
    APPLE_PRIVATE_KEY: "pem",
  };
  const APPLE_FULL = {
    ...APPLE_CREDS,
    APPLE_BUNDLE_ID: "com.ocrecipes.app",
    APPLE_ENVIRONMENT: "production",
    APPLE_APP_ID: "123456",
  };
  const GOOGLE_CREDS = {
    GOOGLE_SERVICE_ACCOUNT_EMAIL: "iap@example.iam.gserviceaccount.com",
    GOOGLE_SERVICE_ACCOUNT_KEY: "pem",
  };
  const GOOGLE_FULL = {
    ...GOOGLE_CREDS,
    GOOGLE_PACKAGE_NAME: "com.ocrecipes.app",
    GOOGLE_PUBSUB_AUDIENCE: "https://api.example.com/webhooks/google/rtdn",
    GOOGLE_PUBSUB_SA_EMAIL: "pubsub@example.iam.gserviceaccount.com",
  };
  const R2 = {
    R2_ACCOUNT_ID: "a",
    R2_ACCESS_KEY_ID: "b",
    R2_SECRET_ACCESS_KEY: "c",
    R2_BUCKET: "d",
    R2_PUBLIC_BASE_URL: "https://img.example.com",
  };

  beforeEach(() => {
    process.env = { ...saved, ...BASE, ...R2 };
    for (const k of IAP_KEYS) delete process.env[k];
    process.env.NODE_ENV = "production";
    mockWarn.mockClear();
  });
  afterEach(() => {
    process.env = saved;
  });

  async function warningsFor(env: Record<string, string>): Promise<string[]> {
    Object.assign(process.env, env);
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
    return mockWarn.mock.calls.map((c) => String(c[1]));
  }
  const mentions = (ws: string[], text: string) =>
    ws.some((w) => w.includes(text));

  it("warns nothing IAP-related when Apple and Google are fully configured", async () => {
    const ws = await warningsFor({ ...APPLE_FULL, ...GOOGLE_FULL });
    expect(ws.filter((w) => /APPLE_|GOOGLE_/.test(w))).toEqual([]);
  });

  it("warns when Apple credentials are set without APPLE_BUNDLE_ID", async () => {
    const { APPLE_BUNDLE_ID: _omit, ...rest } = APPLE_FULL;
    expect(mentions(await warningsFor(rest), "APPLE_BUNDLE_ID")).toBe(true);
  });

  it("warns when production runs Apple against the SANDBOX default", async () => {
    const { APPLE_ENVIRONMENT: _omit, ...rest } = APPLE_FULL;
    expect(mentions(await warningsFor(rest), "APPLE_ENVIRONMENT")).toBe(true);
  });

  it("warns on an APPLE_ENVIRONMENT that is neither sandbox nor production", async () => {
    process.env.NODE_ENV = "development";
    const ws = await warningsFor({
      ...APPLE_FULL,
      APPLE_ENVIRONMENT: "prodution",
    });
    expect(mentions(ws, "APPLE_ENVIRONMENT")).toBe(true);
  });

  it("does not warn about a sandbox Apple environment outside production", async () => {
    process.env.NODE_ENV = "development";
    const ws = await warningsFor({
      ...APPLE_FULL,
      APPLE_ENVIRONMENT: "sandbox",
    });
    expect(mentions(ws, "APPLE_ENVIRONMENT")).toBe(false);
  });

  it("warns when APPLE_ENVIRONMENT=production has no APPLE_APP_ID", async () => {
    const { APPLE_APP_ID: _omit, ...rest } = APPLE_FULL;
    expect(mentions(await warningsFor(rest), "APPLE_APP_ID")).toBe(true);
  });

  it("warns when only some Apple credentials are set", async () => {
    const ws = await warningsFor({ APPLE_ISSUER_ID: "issuer" });
    expect(mentions(ws, "APPLE_PRIVATE_KEY")).toBe(true);
  });

  it("warns when Google credentials are set without GOOGLE_PACKAGE_NAME", async () => {
    const { GOOGLE_PACKAGE_NAME: _omit, ...rest } = GOOGLE_FULL;
    expect(mentions(await warningsFor(rest), "GOOGLE_PACKAGE_NAME")).toBe(true);
  });

  it("warns when Google IAP is configured but RTDN push verification is not", async () => {
    const ws = await warningsFor({
      ...GOOGLE_CREDS,
      GOOGLE_PACKAGE_NAME: "com.ocrecipes.app",
    });
    expect(mentions(ws, "GOOGLE_PUBSUB_AUDIENCE")).toBe(true);
  });

  it("says nothing about IAP when no IAP credential is set", async () => {
    const ws = await warningsFor({});
    expect(ws.filter((w) => /APPLE_|GOOGLE_/.test(w))).toEqual([]);
  });
});
