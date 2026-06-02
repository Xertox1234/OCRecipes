import { describe, it, expect, vi } from "vitest";

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
