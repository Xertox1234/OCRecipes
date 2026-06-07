import { describe, it, expect, vi, afterEach } from "vitest";

import { scrubEvent } from "../reporter";
import type { ErrorEvent } from "@sentry/react-native";

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
