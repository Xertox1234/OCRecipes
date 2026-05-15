/**
 * Test helpers for constructing minimal, well-typed Express Request/Response
 * mocks. Use these instead of `partial as unknown as express.Request` /
 * `... as unknown as express.Response` when unit-testing helpers that only
 * read a handful of fields on the request/response (e.g. `req.ip`,
 * `req.userId`, `res.status().json()`).
 *
 * If a test needs a field these helpers do not surface, add it to the
 * partial input — the helpers spread caller-supplied properties through.
 */

import type express from "express";
import { vi } from "vitest";

/**
 * Build a minimal `express.Request` for tests of pure helpers that only
 * touch a few fields. Caller supplies any fields it asserts on; the result
 * is typed as `express.Request` so callers do not need to cast.
 */
export function mockExpressReq(
  overrides: Partial<express.Request> = {},
): express.Request {
  return overrides as express.Request;
}

/**
 * Build a minimal chainable `express.Response` whose `status()` and `json()`
 * are `vi.fn()` spies. `status` returns `this` so the common
 * `res.status(N).json(...)` pattern works.
 *
 * Caller may override individual methods or pass extra fields via
 * `overrides`. The return value is typed as `express.Response` so callers
 * do not need to cast.
 */
export function mockExpressRes(
  overrides: Partial<express.Response> = {},
): express.Response {
  const res: Partial<express.Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
    ...overrides,
  };
  return res as express.Response;
}
