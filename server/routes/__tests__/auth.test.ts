import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// Mock storage before importing routes
vi.mock("../../storage", () => ({
  storage: {
    getUserByUsername: vi.fn(),
    createUser: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
  },
}));

// Mock auth middleware — let most requests through, but keep generateToken functional
vi.mock("../../middleware/auth", () => ({
  requireAuth: (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ) => {
    req.userId = "1";
    next();
  },
  generateToken: vi.fn().mockReturnValue("mock-jwt-token"),
  invalidateTokenVersionCache: vi.fn(),
}));

// Disable rate limiting in tests
vi.mock("express-rate-limit", () => ({
  rateLimit: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
  default: () =>
    (_req: express.Request, _res: express.Response, next: express.NextFunction) =>
      next(),
}));

import { storage } from "../../storage";
import { register } from "../auth";

function createApp() {
  const app = express();
  app.use(express.json());
  register(app);
  return app;
}

const mockUser = {
  id: 1,
  username: "testuser",
  password: "$2b$10$hashedpassword", // bcrypt hash
  displayName: null,
  avatarUrl: null,
  dailyCalorieGoal: 2000,
  onboardingCompleted: false,
  subscriptionTier: "free",
  tokenVersion: 0,
};

describe("Auth Routes", () => {
  let app: express.Express;

  beforeEach(() => {
    app = createApp();
  });

  describe("POST /api/auth/register", () => {
    it("creates a new user and returns token", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(null);
      vi.mocked(storage.createUser).mockResolvedValue(mockUser as never);

      const res = await request(app).post("/api/auth/register").send({
        username: "newuser",
        password: "password123",
      });

      expect(res.status).toBe(201);
      expect(res.body.token).toBe("mock-jwt-token");
      expect(res.body.user.username).toBe("testuser");
      expect(res.body.user.id).toBe(1);
      expect(res.body.user).not.toHaveProperty("password");
    });

    it("returns 409 if username already exists", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(mockUser as never);

      const res = await request(app).post("/api/auth/register").send({
        username: "testuser",
        password: "password123",
      });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe("Username already exists");
    });

    it("returns 400 for short username", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "ab",
        password: "password123",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("at least 3 characters");
    });

    it("returns 400 for short password", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "testuser",
        password: "short",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("at least 8 characters");
    });

    it("returns 400 for invalid username characters", async () => {
      const res = await request(app).post("/api/auth/register").send({
        username: "bad user!",
        password: "password123",
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain("letters, numbers, and underscores");
    });

    it("returns 400 for missing fields", async () => {
      const res = await request(app).post("/api/auth/register").send({});

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/login", () => {
    it("returns user and token on valid credentials", async () => {
      // Create a real bcrypt hash for "password123"
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("password123", 10);
      const userWithHash = { ...mockUser, password: hash };

      vi.mocked(storage.getUserByUsername).mockResolvedValue(
        userWithHash as never,
      );

      const res = await request(app).post("/api/auth/login").send({
        username: "testuser",
        password: "password123",
      });

      expect(res.status).toBe(200);
      expect(res.body.token).toBe("mock-jwt-token");
      expect(res.body.user.username).toBe("testuser");
      expect(res.body.user).not.toHaveProperty("password");
    });

    it("returns 401 for non-existent user", async () => {
      vi.mocked(storage.getUserByUsername).mockResolvedValue(null);

      const res = await request(app).post("/api/auth/login").send({
        username: "noone",
        password: "password123",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
    });

    it("returns 401 for wrong password", async () => {
      const bcrypt = await import("bcrypt");
      const hash = await bcrypt.hash("correctpassword", 10);
      const userWithHash = { ...mockUser, password: hash };

      vi.mocked(storage.getUserByUsername).mockResolvedValue(
        userWithHash as never,
      );

      const res = await request(app).post("/api/auth/login").send({
        username: "testuser",
        password: "wrongpassword",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid credentials");
    });

    it("returns 400 for missing credentials", async () => {
      const res = await request(app).post("/api/auth/login").send({});

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/auth/logout", () => {
    it("increments token version and returns success", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(mockUser as never);
      vi.mocked(storage.updateUser).mockResolvedValue({
        ...mockUser,
        tokenVersion: 1,
      } as never);

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(storage.updateUser).toHaveBeenCalledWith("1", {
        tokenVersion: 1,
      });
    });

    it("returns 404 if user not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(null as never);

      const res = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/auth/me", () => {
    it("returns current user data", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(mockUser as never);

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(200);
      expect(res.body.username).toBe("testuser");
      expect(res.body.id).toBe(1);
      expect(res.body).not.toHaveProperty("password");
      expect(res.body.subscriptionTier).toBe("free");
    });

    it("returns 401 if user not found", async () => {
      vi.mocked(storage.getUser).mockResolvedValue(null as never);

      const res = await request(app)
        .get("/api/auth/me")
        .set("Authorization", "Bearer mock-token");

      expect(res.status).toBe(401);
    });
  });

  describe("PUT /api/auth/profile", () => {
    it("updates display name", async () => {
      const updated = { ...mockUser, displayName: "Test User" };
      vi.mocked(storage.updateUser).mockResolvedValue(updated as never);

      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ displayName: "Test User" });

      expect(res.status).toBe(200);
      expect(res.body.displayName).toBe("Test User");
    });

    it("updates calorie goal", async () => {
      const updated = { ...mockUser, dailyCalorieGoal: 2500 };
      vi.mocked(storage.updateUser).mockResolvedValue(updated as never);

      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ dailyCalorieGoal: 2500 });

      expect(res.status).toBe(200);
      expect(res.body.dailyCalorieGoal).toBe(2500);
    });

    it("returns 400 for empty update", async () => {
      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("No valid fields to update");
    });

    it("returns 400 for invalid calorie goal", async () => {
      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ dailyCalorieGoal: 100 });

      expect(res.status).toBe(400);
    });

    it("returns 404 if user not found on update", async () => {
      vi.mocked(storage.updateUser).mockResolvedValue(null as never);

      const res = await request(app)
        .put("/api/auth/profile")
        .set("Authorization", "Bearer mock-token")
        .send({ displayName: "Ghost" });

      expect(res.status).toBe(404);
    });
  });
});
