import { describe, it, expect, vi, afterEach } from "vitest";

import { queryKeyLabel, scrubBreadcrumb, scrubEvent } from "../reporter";
import type { Breadcrumb, ErrorEvent } from "@sentry/react-native";

// reporter.ts imports @sentry/react-native (a native module that does not
// resolve under vitest/node) at module load — stub it. scrubEvent touches no
// Sentry API, so an empty stub is enough to import the module under test.
vi.mock("@sentry/react-native", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

function eventWithHeaders(headers: Record<string, string>): ErrorEvent {
  return { type: undefined, request: { headers } } as ErrorEvent;
}

describe("scrubEvent", () => {
  it("strips a capitalized Authorization header", () => {
    const event = eventWithHeaders({
      Authorization: "Bearer super-secret-jwt",
      "Content-Type": "application/json",
    });
    expect(scrubEvent(event).request?.headers).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("strips a lowercase authorization header (case-insensitive)", () => {
    const event = eventWithHeaders({
      authorization: "Bearer super-secret-jwt",
    });
    expect(scrubEvent(event).request?.headers).toEqual({});
  });

  it("preserves non-auth headers untouched", () => {
    const event = eventWithHeaders({
      "User-Agent": "ocrecipes/1.0",
      "X-Request-Id": "abc-123",
    });
    expect(scrubEvent(event).request?.headers).toEqual({
      "User-Agent": "ocrecipes/1.0",
      "X-Request-Id": "abc-123",
    });
  });

  it("no-ops on an event with no request", () => {
    const event = { type: undefined } as ErrorEvent;
    expect(scrubEvent(event)).toBe(event);
  });

  it("no-ops on a request with no headers", () => {
    const event = { type: undefined, request: {} } as ErrorEvent;
    expect(() => scrubEvent(event)).not.toThrow();
    expect(scrubEvent(event).request?.headers).toBeUndefined();
  });

  it("returns the same event reference (mutates in place)", () => {
    const event = eventWithHeaders({ Authorization: "Bearer x" });
    expect(scrubEvent(event)).toBe(event);
  });
});

describe("scrubBreadcrumb (privacy audit M9)", () => {
  const http = (url: string, category = "fetch"): Breadcrumb => ({
    type: "http",
    category,
    data: { method: "GET", url, status_code: 200 },
  });

  it("drops the query string (search text, food names)", () => {
    const out = scrubBreadcrumb(
      http("https://api.ocrecipes.com/api/nutrition/lookup?name=whole%20milk"),
    );
    expect(out?.data?.url).toBe(
      "https://api.ocrecipes.com/api/nutrition/lookup",
    );
  });

  it("replaces barcodes and ids in the path", () => {
    const out = scrubBreadcrumb(
      http("https://api.ocrecipes.com/api/nutrition/barcode/0123456789012"),
    );
    expect(out?.data?.url).toBe(
      "https://api.ocrecipes.com/api/nutrition/barcode/:id",
    );
    const nested = scrubBreadcrumb(
      http(
        "https://api.ocrecipes.com/api/cookbooks/42/recipes/9f1c2e3a-0b1d-4c5e-8f9a-1b2c3d4e5f60?recipeType=community",
        "xhr",
      ),
    );
    expect(nested?.data?.url).toBe(
      "https://api.ocrecipes.com/api/cookbooks/:id/recipes/:id",
    );
  });

  it("replaces encoded or mixed-case path text", () => {
    const out = scrubBreadcrumb(http("/api/things/Whole%20Milk/x"));
    expect(out?.data?.url).toBe("/api/things/:id/x");
  });

  it("keeps plain route words and version segments", () => {
    const out = scrubBreadcrumb(
      http("https://api.ocrecipes.com/api/v1/meal-plan/grocery-lists"),
    );
    expect(out?.data?.url).toBe(
      "https://api.ocrecipes.com/api/v1/meal-plan/grocery-lists",
    );
  });

  it("keeps method and status code", () => {
    const out = scrubBreadcrumb(http("/api/pantry/7"));
    expect(out?.data).toEqual({
      method: "GET",
      url: "/api/pantry/:id",
      status_code: 200,
    });
  });

  it("scrubs navigation from/to the same way", () => {
    const out = scrubBreadcrumb({
      category: "navigation",
      data: { from: "/recipe/123?q=salt", to: "/scan/0123456789012" },
    });
    expect(out?.data).toEqual({ from: "/recipe/:id", to: "/scan/:id" });
  });

  it("drops console breadcrumbs (their arguments can hold anything)", () => {
    expect(
      scrubBreadcrumb({
        category: "console",
        message: "user typed whole milk",
      }),
    ).toBeNull();
  });

  it("keeps the app's own context breadcrumbs", () => {
    const crumb: Breadcrumb = { message: "lookup failed", level: "error" };
    expect(scrubBreadcrumb(crumb)).toEqual(crumb);
  });
});

describe("scrubEvent: server error text (privacy audit M9 follow-up)", () => {
  // apiRequest and the hand-rolled hooks throw `"<status>: <response body>"`.
  // A validation error can echo what the user typed, so the body never leaves
  // the device; only the status and a machine-readable code survive.
  const eventWithError = (...values: string[]): ErrorEvent =>
    ({
      type: undefined,
      exception: { values: values.map((value) => ({ type: "Error", value })) },
    }) as ErrorEvent;

  it("keeps the status and code, drops the rest of a JSON body", () => {
    const event = eventWithError(
      '422: {"error":"calories: 2400 for Whole Milk is invalid","code":"VALIDATION_ERROR"}',
    );
    expect(scrubEvent(event).exception?.values?.[0].value).toBe(
      "422: [body removed] code=VALIDATION_ERROR",
    );
  });

  it("drops a JSON body that has no code", () => {
    const event = eventWithError('500: {"error":"host db-1 refused"}');
    expect(scrubEvent(event).exception?.values?.[0].value).toBe(
      "500: [body removed]",
    );
  });

  it("drops a non-JSON body", () => {
    const event = eventWithError("502: <html>Bad Gateway for user 42</html>");
    expect(scrubEvent(event).exception?.values?.[0].value).toBe(
      "502: [body removed]",
    );
  });

  it("drops a code that is not a plain constant", () => {
    const event = eventWithError('400: {"code":"whole milk"}');
    expect(scrubEvent(event).exception?.values?.[0].value).toBe(
      "400: [body removed]",
    );
  });

  it("scrubs every value in a cause chain", () => {
    const event = eventWithError("TypeError: x is undefined", "503: down");
    const values = scrubEvent(event).exception?.values;
    expect(values?.[0].value).toBe("TypeError: x is undefined");
    expect(values?.[1].value).toBe("503: [body removed]");
  });

  it("leaves messages without a status prefix unchanged", () => {
    const event = eventWithError("Network request failed");
    expect(scrubEvent(event).exception?.values?.[0].value).toBe(
      "Network request failed",
    );
  });

  it("scrubs a captured message too", () => {
    const event = {
      type: undefined,
      message: "404: no recipe 7",
    } as ErrorEvent;
    expect(scrubEvent(event).message).toBe("404: [body removed]");
  });
});

describe("queryKeyLabel (privacy audit M9 follow-up)", () => {
  it("keeps only the scrubbed route from the first key element", () => {
    expect(queryKeyLabel(["/api/allergen-check", ["eggs", "whole milk"]])).toBe(
      "/api/allergen-check",
    );
    expect(queryKeyLabel(["/api/cookbooks", 42])).toBe("/api/cookbooks");
    expect(queryKeyLabel(["/api/chat/conversations/9/messages"])).toBe(
      "/api/chat/conversations/:id/messages",
    );
    expect(queryKeyLabel(["/api/meal-plan", "2026-11-10", "2026-11-16"])).toBe(
      "/api/meal-plan",
    );
  });

  it("keeps a plain mutation key word", () => {
    expect(queryKeyLabel(["pin-conversation"])).toBe("pin-conversation");
  });

  it("labels a key with no string head", () => {
    expect(queryKeyLabel(undefined)).toBe("unkeyed");
    expect(queryKeyLabel([{ id: 3 }])).toBe("unkeyed");
  });
});

/**
 * `dsn` is read from process.env at module load, so each case re-imports the
 * module after setting the env + `__DEV__`. `test/setup.ts` defaults `__DEV__`
 * to true, so the afterEach restores it for unrelated suites.
 */
async function loadReporter(opts: { dsn?: string; dev: boolean }) {
  vi.resetModules();
  if (opts.dsn === undefined) {
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
  } else {
    process.env.EXPO_PUBLIC_SENTRY_DSN = opts.dsn;
  }
  (globalThis as Record<string, unknown>).__DEV__ = opts.dev;
  const reporter = await import("../reporter");
  const Sentry = await import("@sentry/react-native");
  return { reporter, Sentry };
}

describe("dev/test no-op contract", () => {
  afterEach(() => {
    vi.resetModules();
    delete process.env.EXPO_PUBLIC_SENTRY_DSN;
    (globalThis as Record<string, unknown>).__DEV__ = true;
  });

  it("does not init Sentry in dev even when a DSN is set", async () => {
    const { reporter, Sentry } = await loadReporter({
      dsn: "https://key@example.ingest.sentry.io/1",
      dev: true,
    });
    reporter.initReporter();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("does not report in dev even when a DSN is set", async () => {
    const { reporter, Sentry } = await loadReporter({
      dsn: "https://key@example.ingest.sentry.io/1",
      dev: true,
    });
    reporter.reportError(new Error("boom"));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("does not init when no DSN is configured", async () => {
    const { reporter, Sentry } = await loadReporter({
      dsn: undefined,
      dev: false,
    });
    reporter.initReporter();
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("initializes Sentry in production when a DSN is set", async () => {
    const { reporter, Sentry } = await loadReporter({
      dsn: "https://key@example.ingest.sentry.io/1",
      dev: false,
    });
    reporter.initReporter();
    expect(Sentry.init).toHaveBeenCalledOnce();
    expect(vi.mocked(Sentry.init).mock.calls[0][0]).toMatchObject({
      beforeBreadcrumb: reporter.scrubBreadcrumb,
    });
  });

  it("reports to Sentry in production when a DSN is set", async () => {
    const { reporter, Sentry } = await loadReporter({
      dsn: "https://key@example.ingest.sentry.io/1",
      dev: false,
    });
    reporter.reportError(new Error("boom"));
    expect(Sentry.captureException).toHaveBeenCalledOnce();
  });
});
