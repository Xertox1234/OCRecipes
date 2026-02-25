import { ZodError, z } from "zod";
import {
  parsePositiveIntParam,
  parseQueryInt,
  formatZodError,
  loginSchema,
  registerSchema,
  profileUpdateSchema,
} from "../_helpers";

describe("Route Helpers", () => {
  describe("parsePositiveIntParam", () => {
    it("parses a valid positive integer string", () => {
      expect(parsePositiveIntParam("42")).toBe(42);
    });

    it("parses '1'", () => {
      expect(parsePositiveIntParam("1")).toBe(1);
    });

    it("returns null for '0'", () => {
      expect(parsePositiveIntParam("0")).toBeNull();
    });

    it("returns null for negative numbers", () => {
      expect(parsePositiveIntParam("-5")).toBeNull();
    });

    it("returns null for non-numeric strings", () => {
      expect(parsePositiveIntParam("abc")).toBeNull();
    });

    it("returns null for empty string", () => {
      expect(parsePositiveIntParam("")).toBeNull();
    });

    it("parses float strings as integers (truncates)", () => {
      expect(parsePositiveIntParam("3.7")).toBe(3);
    });

    it("handles string array (Express 5 compat)", () => {
      expect(parsePositiveIntParam(["42", "99"])).toBe(42);
    });

    it("returns null for empty array", () => {
      expect(parsePositiveIntParam([])).toBeNull();
    });
  });

  describe("parseQueryInt", () => {
    it("parses a valid integer string", () => {
      expect(parseQueryInt("10", { default: 5 })).toBe(10);
    });

    it("returns default for undefined", () => {
      expect(parseQueryInt(undefined, { default: 25 })).toBe(25);
    });

    it("returns default for non-string types", () => {
      expect(parseQueryInt(42, { default: 25 })).toBe(25);
    });

    it("returns default for NaN string", () => {
      expect(parseQueryInt("abc", { default: 25 })).toBe(25);
    });

    it("clamps to min", () => {
      expect(parseQueryInt("0", { default: 5, min: 1 })).toBe(1);
    });

    it("clamps to max", () => {
      expect(parseQueryInt("1000", { default: 5, max: 100 })).toBe(100);
    });

    it("clamps between min and max", () => {
      expect(parseQueryInt("50", { default: 5, min: 1, max: 100 })).toBe(50);
    });

    it("clamps default to min when default is below min", () => {
      expect(parseQueryInt(undefined, { default: 0, min: 1 })).toBe(1);
    });

    it("returns negative numbers when allowed", () => {
      expect(parseQueryInt("-5", { default: 0 })).toBe(-5);
    });
  });

  describe("formatZodError", () => {
    it("formats a single field error", () => {
      const schema = z.object({ name: z.string() });
      const result = schema.safeParse({ name: 123 });
      if (!result.success) {
        const formatted = formatZodError(result.error);
        expect(formatted).toContain("name");
      }
    });

    it("formats multiple field errors separated by semicolons", () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      });
      const result = schema.safeParse({ name: 123, age: "not a number" });
      if (!result.success) {
        const formatted = formatZodError(result.error);
        expect(formatted).toContain(";");
        expect(formatted).toContain("name");
        expect(formatted).toContain("age");
      }
    });

    it("handles root-level errors (no path)", () => {
      const schema = z.string().min(5);
      const result = schema.safeParse("ab");
      if (!result.success) {
        const formatted = formatZodError(result.error);
        expect(formatted.length).toBeGreaterThan(0);
      }
    });
  });

  describe("loginSchema", () => {
    it("accepts valid login credentials", () => {
      const result = loginSchema.safeParse({
        username: "testuser",
        password: "password123",
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty username", () => {
      const result = loginSchema.safeParse({
        username: "",
        password: "password123",
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty password", () => {
      const result = loginSchema.safeParse({
        username: "testuser",
        password: "",
      });
      expect(result.success).toBe(false);
    });

    it("rejects username longer than 30 chars", () => {
      const result = loginSchema.safeParse({
        username: "a".repeat(31),
        password: "password",
      });
      expect(result.success).toBe(false);
    });

    it("rejects password longer than 200 chars", () => {
      const result = loginSchema.safeParse({
        username: "testuser",
        password: "a".repeat(201),
      });
      expect(result.success).toBe(false);
    });

    it("allows single character username (login is lenient)", () => {
      const result = loginSchema.safeParse({
        username: "a",
        password: "p",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("registerSchema", () => {
    it("accepts valid registration data", () => {
      const result = registerSchema.safeParse({
        username: "testuser",
        password: "securepass123",
      });
      expect(result.success).toBe(true);
    });

    it("rejects username shorter than 3 chars", () => {
      const result = registerSchema.safeParse({
        username: "ab",
        password: "securepass123",
      });
      expect(result.success).toBe(false);
    });

    it("rejects username with special characters", () => {
      const result = registerSchema.safeParse({
        username: "user@name!",
        password: "securepass123",
      });
      expect(result.success).toBe(false);
    });

    it("accepts username with underscores", () => {
      const result = registerSchema.safeParse({
        username: "test_user_1",
        password: "securepass123",
      });
      expect(result.success).toBe(true);
    });

    it("rejects password shorter than 8 chars", () => {
      const result = registerSchema.safeParse({
        username: "testuser",
        password: "short",
      });
      expect(result.success).toBe(false);
    });

    it("rejects username longer than 30 chars", () => {
      const result = registerSchema.safeParse({
        username: "a".repeat(31),
        password: "securepass123",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("profileUpdateSchema", () => {
    it("accepts valid profile update", () => {
      const result = profileUpdateSchema.safeParse({
        displayName: "John Doe",
        dailyCalorieGoal: 2000,
      });
      expect(result.success).toBe(true);
    });

    it("accepts empty object (all fields optional)", () => {
      const result = profileUpdateSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("rejects calorie goal below 500", () => {
      const result = profileUpdateSchema.safeParse({
        dailyCalorieGoal: 200,
      });
      expect(result.success).toBe(false);
    });

    it("rejects calorie goal above 10000", () => {
      const result = profileUpdateSchema.safeParse({
        dailyCalorieGoal: 15000,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer calorie goal", () => {
      const result = profileUpdateSchema.safeParse({
        dailyCalorieGoal: 2000.5,
      });
      expect(result.success).toBe(false);
    });

    it("accepts boolean onboardingCompleted", () => {
      const result = profileUpdateSchema.safeParse({
        onboardingCompleted: true,
      });
      expect(result.success).toBe(true);
    });

    it("rejects display name longer than 100 chars", () => {
      const result = profileUpdateSchema.safeParse({
        displayName: "a".repeat(101),
      });
      expect(result.success).toBe(false);
    });
  });
});
