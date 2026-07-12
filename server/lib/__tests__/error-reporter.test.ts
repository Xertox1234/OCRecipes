import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Type-only import — erased at compile time, so it bypasses the vi.mock below.
import type { ErrorEvent } from "@sentry/node";

// Mock @sentry/node before the module under test loads it. This factory takes
// precedence over the test/mocks/sentry-node.ts alias in vitest.config.ts
// (the alias exists to keep the ~500ms real import out of route tests).
const sentryMocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
  setupExpressErrorHandler: vi.fn(),
  httpIntegration: vi.fn(() => ({ name: "Http" })),
  onUncaughtExceptionIntegration: vi.fn(() => ({
    name: "OnUncaughtException",
  })),
}));

vi.mock("@sentry/node", () => sentryMocks);

// error-reporter logs a positive signal on init and a warning on rate-cap
// drops; stub the logger so tests can assert on it without real pino output.
const loggerMocks = vi.hoisted(() => ({
  mockWarn: vi.fn(),
  mockInfo: vi.fn(),
}));

vi.mock("../logger", () => ({
  logger: { warn: loggerMocks.mockWarn, info: loggerMocks.mockInfo },
}));

const PROD_DSN = "https://public-key@o0.ingest.sentry.io/1";

async function importReporter() {
  return await import("../error-reporter");
}

/** Import the reporter with DSN + production env and initialize it. */
async function importActiveReporter() {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SENTRY_DSN", PROD_DSN);
  const reporter = await importReporter();
  reporter.initErrorReporter();
  return reporter;
}

describe("error-reporter", () => {
  beforeEach(() => {
    // Fresh module state (active flag, rate-cap window) per test.
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  describe("initErrorReporter gating", () => {
    it("no-ops without SENTRY_DSN even in production", async () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("SENTRY_DSN", "");
      const { initErrorReporter } = await importReporter();
      initErrorReporter();
      expect(sentryMocks.init).not.toHaveBeenCalled();
    });

    it("no-ops outside production even with a DSN (dev/test contract)", async () => {
      vi.stubEnv("NODE_ENV", "test");
      vi.stubEnv("SENTRY_DSN", PROD_DSN);
      const { initErrorReporter } = await importReporter();
      initErrorReporter();
      expect(sentryMocks.init).not.toHaveBeenCalled();
    });

    it("initializes with sendDefaultPii: false and no tracing when DSN + production", async () => {
      await importActiveReporter();

      expect(sentryMocks.init).toHaveBeenCalledTimes(1);
      const options = sentryMocks.init.mock.calls[0][0];
      expect(options.dsn).toBe(PROD_DSN);
      expect(options.sendDefaultPii).toBe(false);
      expect(options.beforeSend).toBeTypeOf("function");
      // Error tracking only — never enable performance tracing (cost).
      expect(options.tracesSampleRate).toBeUndefined();
      // Logs a positive signal (a malformed DSN makes init fail silently).
      expect(loggerMocks.mockInfo).toHaveBeenCalledTimes(1);
    });

    it("disables incoming request-body capture (not gated by sendDefaultPii in v10)", async () => {
      await importActiveReporter();
      expect(sentryMocks.httpIntegration).toHaveBeenCalledWith({
        maxIncomingRequestBodySize: "none",
      });
      const options = sentryMocks.init.mock.calls[0][0];
      expect(options.integrations).toContainEqual({ name: "Http" });
    });

    it("keeps process-exit ownership in the app's uncaughtException handler", async () => {
      await importActiveReporter();
      expect(sentryMocks.onUncaughtExceptionIntegration).toHaveBeenCalledWith({
        exitEvenIfOtherHandlersAreRegistered: false,
      });
      const options = sentryMocks.init.mock.calls[0][0];
      expect(options.integrations).toContainEqual({
        name: "OnUncaughtException",
      });
    });
  });

  describe("scrubEvent", () => {
    it("removes credential-bearing headers by snippet match, keeps benign headers", async () => {
      const { scrubEvent } = await importReporter();
      const event = {
        type: undefined,
        request: {
          headers: {
            Authorization: "Bearer secret-jwt",
            authorization: "Bearer secret-jwt",
            "x-api-key": "b2b-partner-credential",
            "x-auth-token": "legacy-token",
            cookie: "session=abc",
            "x-forwarded-for": "203.0.113.7",
            "x-real-ip": "203.0.113.7",
            "cf-connecting-ip": "203.0.113.7",
            "true-client-ip": "203.0.113.7",
            "content-type": "application/json",
            "user-agent": "OCRecipes/1.0",
          },
        },
      };
      const scrubbed = scrubEvent(event as ErrorEvent);
      expect(scrubbed.request?.headers).toEqual({
        "content-type": "application/json",
        "user-agent": "OCRecipes/1.0",
      });
    });

    it("drops request body, cookies, and query string; strips query from the URL", async () => {
      const { scrubEvent } = await importReporter();
      const event = {
        type: undefined,
        request: {
          url: "https://api.ocrecipes.com/verify-email?token=live-24h-token",
          query_string: "token=live-24h-token",
          cookies: { session: "abc" },
          data: '{"password":"hunter2","allergies":["peanut"]}',
          headers: { "content-type": "application/json" },
        },
      };
      const scrubbed = scrubEvent(event as ErrorEvent);
      expect(scrubbed.request?.url).toBe(
        "https://api.ocrecipes.com/verify-email",
      );
      expect(scrubbed.request?.query_string).toBeUndefined();
      expect(scrubbed.request?.cookies).toBeUndefined();
      expect(scrubbed.request?.data).toBeUndefined();
    });

    it("strips query strings from http breadcrumbs (outbound API keys)", async () => {
      const { scrubEvent } = await importReporter();
      const event = {
        type: undefined,
        breadcrumbs: [
          {
            category: "http",
            data: {
              url: "https://api.nal.usda.gov/fdc/v1/search?api_key=USDA-KEY",
              "http.query": "api_key=USDA-KEY",
              "http.fragment": "section",
              "http.method": "GET",
            },
          },
          { category: "console", message: "no data crumb" },
        ],
      };
      const scrubbed = scrubEvent(event as ErrorEvent);
      expect(scrubbed.breadcrumbs?.[0]?.data).toEqual({
        url: "https://api.nal.usda.gov/fdc/v1/search",
        "http.method": "GET",
      });
      expect(scrubbed.breadcrumbs?.[1]).toEqual({
        category: "console",
        message: "no data crumb",
      });
    });

    it("returns events without request or breadcrumbs unchanged", async () => {
      const { scrubEvent } = await importReporter();
      const event = { message: "boom" };
      expect(scrubEvent(event as ErrorEvent)).toBe(event);
    });
  });

  describe("beforeSendHandler", () => {
    it("tags events with the ALS requestId inside a request context", async () => {
      const { beforeSendHandler } = await importReporter();
      const { requestContextMiddleware } = await import("../request-context");

      // Same fake req/res style as logger.test.ts.
      const req = { id: "req-uuid-1234" } as any;
      const res = { setHeader: vi.fn() } as any;

      let result: ReturnType<typeof beforeSendHandler> = null;
      requestContextMiddleware(req, res, () => {
        result = beforeSendHandler({} as ErrorEvent);
      });

      expect(result).not.toBeNull();
      expect(result!.tags).toEqual({ requestId: "req-uuid-1234" });
    });

    it("leaves events untagged outside a request context (startup, cron)", async () => {
      const { beforeSendHandler } = await importReporter();
      const result = beforeSendHandler({} as ErrorEvent);
      expect(result).not.toBeNull();
      expect(result!.tags).toBeUndefined();
    });

    it("runs the scrub on every event", async () => {
      const { beforeSendHandler } = await importReporter();
      const event = {
        type: undefined,
        request: { headers: { authorization: "Bearer secret" } },
      };
      const result = beforeSendHandler(event as ErrorEvent);
      expect(result!.request?.headers).toEqual({});
    });

    it("drops events beyond the per-minute cap, warns once, and recovers next window", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-11T00:00:00Z"));
      const { beforeSendHandler, MAX_EVENTS_PER_MINUTE } =
        await importReporter();

      for (let i = 0; i < MAX_EVENTS_PER_MINUTE; i++) {
        expect(beforeSendHandler({} as ErrorEvent)).not.toBeNull();
      }
      expect(loggerMocks.mockWarn).not.toHaveBeenCalled();

      // Over the cap within the same window — dropped, one warning only.
      expect(beforeSendHandler({} as ErrorEvent)).toBeNull();
      expect(beforeSendHandler({} as ErrorEvent)).toBeNull();
      expect(loggerMocks.mockWarn).toHaveBeenCalledTimes(1);

      // Next window — reporting resumes.
      vi.setSystemTime(new Date("2026-07-11T00:01:01Z"));
      expect(beforeSendHandler({} as ErrorEvent)).not.toBeNull();
    });
  });

  describe("reportError", () => {
    it("no-ops when the reporter is inactive", async () => {
      const { reportError } = await importReporter();
      reportError(new Error("boom"), "fetch recipes");
      expect(sentryMocks.captureException).not.toHaveBeenCalled();
    });

    it("captures with the route context as extra when active", async () => {
      const { reportError } = await importActiveReporter();
      const error = new Error("db down");
      reportError(error, "fetch recipes");
      expect(sentryMocks.captureException).toHaveBeenCalledWith(error, {
        extra: { context: "fetch recipes" },
      });
    });

    it("captures without extra context when none is given", async () => {
      const { reportError } = await importActiveReporter();
      const error = new Error("db down");
      reportError(error);
      expect(sentryMocks.captureException).toHaveBeenCalledWith(
        error,
        undefined,
      );
    });
  });

  describe("attachExpressErrorReporter", () => {
    it("no-ops when the reporter is inactive", async () => {
      const { attachExpressErrorReporter } = await importReporter();
      attachExpressErrorReporter({} as any);
      expect(sentryMocks.setupExpressErrorHandler).not.toHaveBeenCalled();
    });

    it("registers Sentry's express error handler when active", async () => {
      const { attachExpressErrorReporter } = await importActiveReporter();
      const app = {} as any;
      attachExpressErrorReporter(app);
      expect(sentryMocks.setupExpressErrorHandler).toHaveBeenCalledWith(app);
    });
  });

  describe("flushErrorReporter", () => {
    it("resolves without touching Sentry when inactive", async () => {
      const { flushErrorReporter } = await importReporter();
      await expect(flushErrorReporter(100)).resolves.toBe(true);
      expect(sentryMocks.flush).not.toHaveBeenCalled();
    });

    it("delegates to Sentry.flush when active", async () => {
      const { flushErrorReporter } = await importActiveReporter();
      await expect(flushErrorReporter(250)).resolves.toBe(true);
      expect(sentryMocks.flush).toHaveBeenCalledWith(250);
    });

    it("never rejects even when Sentry.flush fails", async () => {
      sentryMocks.flush.mockImplementationOnce(() =>
        Promise.reject(new Error("transport down")),
      );
      const { flushErrorReporter } = await importActiveReporter();
      await expect(flushErrorReporter(250)).resolves.toBe(false);
    });
  });
});

describe("server/index.ts boot ordering invariant", () => {
  it("keeps ./lib/error-reporter-boot as the second import declaration", async () => {
    // Mirrors env-boot.test.ts's first-import guard: comment-only invariants
    // don't survive import-sorting autofixes. Sentry must initialize after
    // dotenv is loaded (env-boot, import #1) but before express/./db/./routes
    // evaluate, so its http instrumentation is in place.
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const indexPath = fileURLToPath(
      new URL("../../index.ts", import.meta.url).href,
    );
    const source = await readFile(indexPath, "utf8");
    const imports = source.match(/^import\s+.*$/gm) ?? [];
    expect(imports[1]).toBe('import "./lib/error-reporter-boot";');
  });
});
