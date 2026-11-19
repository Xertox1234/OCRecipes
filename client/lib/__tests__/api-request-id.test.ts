// @vitest-environment node
import { describe, it, expect, vi, afterAll } from "vitest";

import { apiRequest } from "../query-client";
import { ApiError } from "../api-error";

// Reliability audit 2026-11-19 L-obs-3: the server stamps every response with
// X-Request-Id (server/lib/request-context.ts) and logs under that id, but a
// failed call reached Sentry without it, so an app report could not be matched
// to the server log line. The failed call's ApiError must carry it.
const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

vi.mock("../token-storage", () => ({
  tokenStorage: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn(),
    clear: vi.fn(),
    invalidateCache: vi.fn(),
  },
}));

const originalFetch = globalThis.fetch;
globalThis.fetch = mockFetch as unknown as typeof fetch;
afterAll(() => {
  globalThis.fetch = originalFetch;
});

const REQUEST_ID = "3f2b9c1e-8a4d-4e7f-9b6a-1c2d3e4f5a6b";

async function failure(headers?: Record<string, string>) {
  mockFetch.mockResolvedValueOnce(
    new Response('{"error":"boom"}', { status: 500, headers }),
  );
  return apiRequest("GET", "/api/x").catch((e: unknown) => e);
}

describe("a failed API call carries the server's request id (L-obs-3)", () => {
  it("copies X-Request-Id onto the ApiError", async () => {
    const err = await failure({ "X-Request-Id": REQUEST_ID });
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).requestId).toBe(REQUEST_ID);
  });

  it("leaves it unset when the response has no request id", async () => {
    const err = await failure();
    expect((err as ApiError).requestId).toBeUndefined();
  });

  it("ignores a header value that is not a request id", async () => {
    const err = await failure({ "X-Request-Id": "not an id <script>" });
    expect((err as ApiError).requestId).toBeUndefined();
  });
});
