import { describe, it, expect, vi } from "vitest";
import express from "express";

import { registerRoutes } from "../../routes";

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

/** Route paths in the order the production app registers them. */
function registeredPaths(): string[] {
  const app = express();
  registerRoutes(app);
  const stack = (
    app as unknown as { router: { stack: { route?: { path: string } }[] } }
  ).router.stack;
  return stack.flatMap((layer) => (layer.route ? [layer.route.path] : []));
}

// Express 5 cannot constrain `:id` inside a path string (`:id(\d+)` is
// rejected), so `/api/recipes/:id` captures any literal sibling registered
// after it. The fix is registration order, and this pins it.
describe("route registration order", () => {
  it.each([
    "/api/recipes/search",
    "/api/recipes/browse",
    "/api/recipes/trending",
  ])("registers %s before /api/recipes/:id", (literal) => {
    const paths = registeredPaths();
    const literalAt = paths.indexOf(literal);
    const paramAt = paths.indexOf("/api/recipes/:id");
    expect(literalAt).toBeGreaterThanOrEqual(0);
    expect(paramAt).toBeGreaterThanOrEqual(0);
    expect(literalAt).toBeLessThan(paramAt);
  });
});
