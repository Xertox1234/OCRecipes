import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";

import { registerRoutes } from "../../routes";

vi.mock("../../middleware/auth");
vi.mock("express-rate-limit");

describe("catalog content routes are gone", () => {
  it.each([
    ["get", "/api/meal-plan/catalog/search?query=x"],
    ["get", "/api/meal-plan/catalog/config"],
    ["get", "/api/meal-plan/catalog/123"],
    ["post", "/api/meal-plan/catalog/123/save"],
  ] as const)("%s %s -> 404", async (method, path) => {
    const app = express();
    app.use(express.json());
    registerRoutes(app);
    const res = await request(app)
      [method](path)
      .set("Authorization", "Bearer t");
    expect(res.status).toBe(404);
  });
});
