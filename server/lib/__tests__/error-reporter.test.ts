import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Type-only import — erased at compile time, so it bypasses the vi.mock below.
import type { ErrorEvent } from "@sentry/node";

// Mock @sentry/node before the module under test loads it. This factory takes
// precedence over the test/mocks/sentry-node.ts alias in vitest.config.mts
// (the alias exists to keep the ~500ms real import out of route tests).
//
// DECISION (2026-07-12): no integration test runs this suite against the
// REAL @sentry/node SDK (only vi.mock, as below). This was considered as
// extra hardening — a future SDK upgrade that restructures where PII lands
// on the outgoing event (the exact bug class scrubEvent/beforeSendHandler
// exist to fix) wouldn't be caught by a mocked test. It was not pursued
// because the obstacle is structural, not a missing test: vitest.config.mts's
// `resolve.alias` for "@sentry/node" (line ~137) rewrites the specifier to
// test/mocks/sentry-node.ts at the bundler level, before Vitest's mock layer
// runs — `vi.unmock`/`vi.importActual` intercept `vi.mock()` factories, not
// resolve.alias, so neither can recover the real package from inside this
// file. Defeating it would require a per-file resolver override (e.g. a
// second Vitest project/config, or a conditional alias keyed on the test
// path) that touches shared config and risks the ~500ms cost this alias was
// added to avoid for every route test. Left as a follow-up if the project
// adopts per-file Vitest projects for another reason; not worth a
// standalone config change for this alone.
const sentryMocks = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(() => Promise.resolve(true)),
  setupExpressErrorHandler: vi.fn(),
  httpIntegration: vi.fn(() => ({ name: "Http" })),
  onUncaughtExceptionIntegration: vi.fn(() => ({
    name: "OnUncaughtException",
  })),
  pinoIntegration: vi.fn(() => ({ name: "Pino" })),
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

    it("turns logger.error into Sentry events via pinoIntegration (handled background/cron/stream failures)", async () => {
      // fireAndForget, cron catches, and the SSE stream catch all log with
      // logger.error and never throw — without this integration none of them
      // reach Sentry (onUnhandledRejection only sees UNhandled rejections).
      await importActiveReporter();
      expect(sentryMocks.pinoIntegration).toHaveBeenCalledWith({
        error: { levels: ["error"] },
      });
      const options = sentryMocks.init.mock.calls[0][0];
      expect(options.integrations).toContainEqual({ name: "Pino" });
      // Error tracking only — never ship the log stream to Sentry Logs.
      expect(options.enableLogs).toBeUndefined();
    });
  });

  describe("scrubEvent", () => {
    it("reduces the pino log context to an allowlist (arbitrary log fields may carry PII)", async () => {
      const { scrubEvent } = await importReporter();
      const event = {
        type: undefined,
        contexts: {
          pino: {
            msg: "background operation failed",
            operation: "recipe-image",
            requestId: "req-1",
            service: "ai-client",
            kind: "enabled",
            userId: "user-42",
            to: "victim@example.com",
            resendError: { message: "x", name: "y", statusCode: 422 },
            barcode: "0123",
          },
          os: { name: "linux" },
        },
      };
      const scrubbed = scrubEvent(event as unknown as ErrorEvent);
      expect(scrubbed.contexts?.pino).toEqual({
        msg: "background operation failed",
        operation: "recipe-image",
        requestId: "req-1",
        service: "ai-client",
        kind: "enabled",
      });
      expect(scrubbed.contexts?.os).toEqual({ name: "linux" });
    });

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

    // Security audit 2026-11-12, L12 (review): two routes carry the scanned
    // barcode in the path, and a 5xx on either sent it to Sentry.
    it.each([
      [
        "https://api.ocrecipes.com/api/nutrition/barcode/0123456789012?x=1",
        "https://api.ocrecipes.com/api/nutrition/barcode/:code",
      ],
      [
        "https://api.ocrecipes.com/api/verification/0123456789012",
        "https://api.ocrecipes.com/api/verification/:barcode",
      ],
      ["/api/nutrition/barcode/0123456789012", "/api/nutrition/barcode/:code"],
      [
        "https://api.ocrecipes.com/api/verification/submit#top",
        "https://api.ocrecipes.com/api/verification/submit",
      ],
    ])(
      "replaces a scanned barcode in the request URL: %s",
      async (url, kept) => {
        const { scrubEvent } = await importReporter();
        const event = { type: undefined, request: { url } };
        expect(scrubEvent(event as ErrorEvent).request?.url).toBe(kept);
      },
    );

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

    // A failed Drizzle query's message ends with every bound value
    // ("\nparams: ..."), e.g. a password-hash rehash or a coach reply write
    // (audit 2026-10-29 Phase 6 security review).
    it("drops bound query parameters from exception messages", async () => {
      const { scrubEvent } = await importReporter();
      const event = {
        exception: {
          values: [
            {
              type: "DrizzleQueryError",
              value:
                'Failed query: update "users" set "password" = $1 where "id" = $2\nparams: pv2$NEWHASH,user-uuid',
            },
            { type: "Error", value: "connection reset" },
            { type: "Error" },
          ],
        },
      };

      const scrubbed = scrubEvent(event as ErrorEvent);

      const values = scrubbed.exception?.values ?? [];
      expect(values[0].value).toBe(
        'Failed query: update "users" set "password" = $1 where "id" = $2',
      );
      expect(JSON.stringify(scrubbed)).not.toContain("NEWHASH");
      expect(values[1].value).toBe("connection reset");
      expect(values[2].value).toBeUndefined();
    });

    // linkedErrorsIntegration (an SDK default) ships the Drizzle error's
    // `cause` — the pg error — as its own exception value, and pg puts the
    // offending input in the MESSAGE for type/enum/date errors (22P02, 22007).
    it("drops the quoted input value from linked pg error messages", async () => {
      const { scrubEvent } = await importReporter();
      const event = {
        exception: {
          values: [
            {
              type: "error",
              value: 'invalid input syntax for type uuid: "victim@example.com"',
            },
            {
              type: "error",
              value: 'invalid input value for enum diet_type: "my secret diet"',
            },
            {
              type: "error",
              value: 'date/time field value out of range: "2026-13-45"',
            },
            { type: "error", value: 'relation "users" does not exist' },
            {
              type: "DrizzleQueryError",
              value: 'Failed query: select * from "users" where "id" = $1',
            },
          ],
        },
      };

      const scrubbed = scrubEvent(event as ErrorEvent);

      const values = scrubbed.exception?.values ?? [];
      expect(values[0].value).toBe(
        'invalid input syntax for type uuid: "[redacted]"',
      );
      expect(values[1].value).toBe(
        'invalid input value for enum diet_type: "[redacted]"',
      );
      expect(values[2].value).toBe(
        'date/time field value out of range: "[redacted]"',
      );
      expect(JSON.stringify(scrubbed)).not.toMatch(/victim|secret diet|13-45/);
      // Identifiers in quotes (no ': "' before them) are kept for debugging.
      expect(values[3].value).toBe('relation "users" does not exist');
      expect(values[4].value).toBe(
        'Failed query: select * from "users" where "id" = $1',
      );
    });

    // pg shapes that quote the input with no ': "' before it (security
    // re-check of #1627, 2026-11-03). Inputs carry their own quote marks so
    // a redaction that stops at the first closing quote would leak the rest.
    it("drops the quoted input from pg shapes without a ': \"' prefix", async () => {
      const { scrubEvent } = await importReporter();
      const event = {
        exception: {
          values: [
            {
              type: "error",
              value: 'value "99"9@x.com" is out of range for type integer',
            },
            { type: "error", value: 'time zone "Ann"e/Home" not recognized' },
            { type: "error", value: 'invalid value "sec"ret" for "YYYY"' },
          ],
        },
      };

      const scrubbed = scrubEvent(event as ErrorEvent);

      const values = scrubbed.exception?.values ?? [];
      expect(values[0].value).toBe(
        'value "[redacted]" is out of range for type integer',
      );
      expect(values[1].value).toBe('time zone "[redacted]" not recognized');
      expect(values[2].value).toBe('invalid value "[redacted]" for "YYYY"');
      expect(JSON.stringify(scrubbed)).not.toMatch(/9@x|Ann|Home|sec|ret"/);
    });

    // An input that itself contains ': "' must not let the generic tail cut
    // eat the fixed suffix the mid-message rules match on (#1725 review).
    it("redacts mid-message shapes whose input contains ': \"'", async () => {
      const { scrubEvent } = await importReporter();
      const event = {
        exception: {
          values: [
            { type: "error", value: 'time zone "Ann: "x" not recognized' },
            { type: "error", value: 'invalid value "sec: "ret" for "YYYY"' },
            {
              type: "error",
              value: 'value "12: "34" is out of range for type integer',
            },
          ],
        },
      };

      const scrubbed = scrubEvent(event as ErrorEvent);

      const values = scrubbed.exception?.values ?? [];
      expect(values[0].value).toBe('time zone "[redacted]" not recognized');
      expect(values[1].value).toBe('invalid value "[redacted]" for "YYYY"');
      expect(values[2].value).toBe(
        'value "[redacted]" is out of range for type integer',
      );
      expect(JSON.stringify(scrubbed)).not.toMatch(/Ann|sec|12/);
    });
  });

  describe("SENSITIVE_HEADER_SNIPPETS drift guard", () => {
    it("strips a header for every credential snippet in the INSTALLED @sentry/core SENSITIVE_KEY_SNIPPETS", async () => {
      // Reads the installed SDK's real deny-list off disk (same static-read
      // technique as the boot-ordering tests below) instead of importing
      // "@sentry/node" — that specifier is aliased to test/mocks/sentry-node.ts
      // in vitest.config.mts, so a live import here would resolve to the stub,
      // not the real SDK. The file is the one cited in error-reporter.ts's
      // own doc comment: the @sentry/core copy that @sentry/node itself
      // resolves (found below through module resolution, never a fixed
      // path — other packages can install a different @sentry/core).
      //
      // Still loud: if the SDK moves the file, readFile throws and forces a
      // re-verification, rather than silently
      // drifting the way SENSITIVE_HEADER_SNIPPETS itself already did once
      // (PR #589 shipped only 6 of the SDK's 19 real entries despite a
      // docstring already claiming parity — see the docs/solutions writeup).
      const { readFile } = await import("node:fs/promises");
      const { createRequire } = await import("node:module");
      const { dirname, join } = await import("node:path");
      // Resolve through Node module resolution (not a path relative to this
      // file) so it works from an agent worktree whose node_modules is a
      // symlink/near-empty. Resolving @sentry/core FROM @sentry/node's
      // package.json picks the copy @sentry/node actually uses (the nested
      // one when present), so the drift guard keeps its meaning.
      const nodePkgPath = createRequire(import.meta.url).resolve(
        "@sentry/node/package.json",
      );
      const corePkgPath = createRequire(nodePkgPath).resolve(
        "@sentry/core/package.json",
      );
      const snippetsPath = join(
        dirname(corePkgPath),
        "build/cjs/utils/data-collection/filtering-snippets.js",
      );
      const source = await readFile(snippetsPath, "utf8");
      const match = source.match(
        /const SENSITIVE_KEY_SNIPPETS = \[([\s\S]*?)\];/,
      );
      expect(match).not.toBeNull();
      const sdkSnippets = [...match![1].matchAll(/"([^"]+)"/g)].map(
        (m) => m[1],
      );
      // Sanity floor: if the regex above ever silently stops matching (e.g.
      // the SDK reformats the file), fail loudly here instead of the loop
      // below vacuously passing over zero snippets.
      expect(sdkSnippets.length).toBeGreaterThan(10);

      const { scrubEvent } = await importReporter();
      for (const snippet of sdkSnippets) {
        const headerName = `x-probe-${snippet}-header`;
        const event = {
          type: undefined,
          request: { headers: { [headerName]: "sensitive-value" } },
        };
        const scrubbed = scrubEvent(event as ErrorEvent);
        expect(scrubbed.request?.headers).not.toHaveProperty(headerName);
      }
    });

    // Privacy audit 2026-11-10, L8: error-reporter.ts says our list is a
    // superset of the SDK's own client-IP header names, but nothing checked
    // it — an SDK bump that adds a name would leave that header on events
    // the day the SDK's own (undocumented) strip stops applying.
    it("strips every client-IP header name in the INSTALLED @sentry/core ipHeaderNames", async () => {
      const { readFile } = await import("node:fs/promises");
      const { createRequire } = await import("node:module");
      const { dirname, join } = await import("node:path");
      const nodePkgPath = createRequire(import.meta.url).resolve(
        "@sentry/node/package.json",
      );
      const corePkgPath = createRequire(nodePkgPath).resolve(
        "@sentry/core/package.json",
      );
      const source = await readFile(
        join(dirname(corePkgPath), "build/cjs/vendor/getIpAddress.js"),
        "utf8",
      );
      const match = source.match(/const ipHeaderNames = \[([\s\S]*?)\];/);
      expect(match).not.toBeNull();
      const sdkIpHeaders = [...match![1].matchAll(/"([^"]+)"/g)].map(
        (m) => m[1],
      );
      // Sanity floor, as above: never pass vacuously over zero names.
      expect(sdkIpHeaders.length).toBeGreaterThan(10);

      const { scrubEvent } = await importReporter();
      for (const headerName of sdkIpHeaders) {
        const event = {
          type: undefined,
          request: { headers: { [headerName]: "203.0.113.7" } },
        };
        const scrubbed = scrubEvent(event as ErrorEvent);
        expect(scrubbed.request?.headers).not.toHaveProperty(headerName);
      }
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

  it("keeps registerRoutes -> attachExpressErrorReporter -> setupErrorHandler call ordering in startServer", async () => {
    // Static source-order guard (same technique as the import-order test
    // above): Sentry's Express error handler must be registered after all
    // routes (so it can see their errors) and before the app's own JSON
    // error handler (so it always forwards via next(err)) — this is
    // currently correct only by inspection/comment, not enforced.
    //
    // Caveat: this is a textual tripwire, not a runtime guarantee — it
    // verifies today's declaration order but can't catch a refactor that
    // preserves that order while changing runtime semantics (e.g. wrapping
    // one call in a conditional, or moving it into a helper invoked from a
    // different branch). Cheap regression net, not proof the ordering holds
    // at runtime.
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const indexPath = fileURLToPath(
      new URL("../../index.ts", import.meta.url).href,
    );
    const source = await readFile(indexPath, "utf8");

    const registerIdx = source.indexOf("registerRoutes(app)");
    const attachIdx = source.indexOf("attachExpressErrorReporter(app)");
    const setupIdx = source.indexOf("setupErrorHandler(app)");

    expect(registerIdx).toBeGreaterThan(-1);
    expect(attachIdx).toBeGreaterThan(-1);
    expect(setupIdx).toBeGreaterThan(-1);
    expect(registerIdx).toBeLessThan(attachIdx);
    expect(attachIdx).toBeLessThan(setupIdx);
  });
});
