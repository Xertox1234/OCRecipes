import { z } from "zod";
import { isValidCalendarDate } from "../utils/date-validation";

// Test the validation schemas used in routes
const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30, "Username must be at most 30 characters")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "Username can only contain letters, numbers, and underscores",
    ),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const profileUpdateSchema = z.object({
  displayName: z.string().max(100).optional(),
  dailyCalorieGoal: z.number().int().min(500).max(10000).optional(),
  onboardingCompleted: z.boolean().optional(),
});

describe("Route Validation Schemas", () => {
  describe("registerSchema", () => {
    it("validates valid registration data", () => {
      const data = { username: "testuser", password: "password123" };
      const result = registerSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("validates username with underscores", () => {
      const data = { username: "test_user_123", password: "password123" };
      const result = registerSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects username shorter than 3 characters", () => {
      const data = { username: "ab", password: "password123" };
      const result = registerSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe(
          "Username must be at least 3 characters",
        );
      }
    });

    it("rejects username longer than 30 characters", () => {
      const data = {
        username: "a".repeat(31),
        password: "password123",
      };
      const result = registerSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe(
          "Username must be at most 30 characters",
        );
      }
    });

    it("rejects username with special characters", () => {
      const data = { username: "test@user", password: "password123" };
      const result = registerSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe(
          "Username can only contain letters, numbers, and underscores",
        );
      }
    });

    it("rejects username with spaces", () => {
      const data = { username: "test user", password: "password123" };
      const result = registerSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("rejects password shorter than 8 characters", () => {
      const data = { username: "testuser", password: "short" };
      const result = registerSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.errors[0].message).toBe(
          "Password must be at least 8 characters",
        );
      }
    });

    it("accepts password exactly 8 characters", () => {
      const data = { username: "testuser", password: "12345678" };
      const result = registerSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("rejects missing username", () => {
      const data = { password: "password123" };
      const result = registerSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it("rejects missing password", () => {
      const data = { username: "testuser" };
      const result = registerSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe("profileUpdateSchema", () => {
    it("validates empty object (all fields optional)", () => {
      const result = profileUpdateSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("validates displayName within limit", () => {
      const result = profileUpdateSchema.safeParse({
        displayName: "John Doe",
      });
      expect(result.success).toBe(true);
    });

    it("rejects displayName exceeding 100 characters", () => {
      const result = profileUpdateSchema.safeParse({
        displayName: "a".repeat(101),
      });
      expect(result.success).toBe(false);
    });

    it("validates dailyCalorieGoal at minimum (500)", () => {
      const result = profileUpdateSchema.safeParse({
        dailyCalorieGoal: 500,
      });
      expect(result.success).toBe(true);
    });

    it("validates dailyCalorieGoal at maximum (10000)", () => {
      const result = profileUpdateSchema.safeParse({
        dailyCalorieGoal: 10000,
      });
      expect(result.success).toBe(true);
    });

    it("rejects dailyCalorieGoal below minimum", () => {
      const result = profileUpdateSchema.safeParse({
        dailyCalorieGoal: 499,
      });
      expect(result.success).toBe(false);
    });

    it("rejects dailyCalorieGoal above maximum", () => {
      const result = profileUpdateSchema.safeParse({
        dailyCalorieGoal: 10001,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer dailyCalorieGoal", () => {
      const result = profileUpdateSchema.safeParse({
        dailyCalorieGoal: 2000.5,
      });
      expect(result.success).toBe(false);
    });

    it("validates onboardingCompleted boolean", () => {
      const result = profileUpdateSchema.safeParse({
        onboardingCompleted: true,
      });
      expect(result.success).toBe(true);
    });

    it("validates all fields together", () => {
      const result = profileUpdateSchema.safeParse({
        displayName: "Jane Smith",
        dailyCalorieGoal: 1800,
        onboardingCompleted: true,
      });
      expect(result.success).toBe(true);
    });
  });
});

describe("formatZodError", () => {
  // Recreate the function from routes for testing
  function formatZodError(error: z.ZodError): string {
    return error.errors
      .map((e) =>
        e.path.length ? `${e.path.join(".")}: ${e.message}` : e.message,
      )
      .join("; ");
  }

  it("formats single error with path", () => {
    const schema = z.object({ name: z.string() });
    const result = schema.safeParse({ name: 123 });

    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain("name:");
    }
  });

  it("formats multiple errors", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
    });
    const result = schema.safeParse({ name: 123, age: "twenty" });

    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain(";");
    }
  });

  it("formats nested path errors", () => {
    const schema = z.object({
      user: z.object({
        profile: z.object({
          age: z.number(),
        }),
      }),
    });
    const result = schema.safeParse({
      user: { profile: { age: "invalid" } },
    });

    if (!result.success) {
      const formatted = formatZodError(result.error);
      expect(formatted).toContain("user.profile.age:");
    }
  });
});

describe("Pagination Validation", () => {
  // Tests for limit/offset clamping logic in routes
  // Note: The actual routes.ts uses: Math.min(Math.max(parseInt(input) || 50, 1), 100)
  // This means parseInt("0") returns 0, which is falsy, so || 50 kicks in
  function clampLimit(input: string | undefined): number {
    return Math.min(Math.max(parseInt(input as string) || 50, 1), 100);
  }

  function clampOffset(input: string | undefined): number {
    return Math.max(parseInt(input as string) || 0, 0);
  }

  describe("limit clamping", () => {
    it("defaults to 50 when no input", () => {
      expect(clampLimit(undefined)).toBe(50);
    });

    it("defaults to 50 for non-numeric input", () => {
      expect(clampLimit("abc")).toBe(50);
    });

    it("uses default 50 for zero input (0 is falsy)", () => {
      // parseInt("0") returns 0, which is falsy, so || 50 kicks in
      expect(clampLimit("0")).toBe(50);
    });

    it("uses default 50 for negative input (falsy after || check)", () => {
      // parseInt("-5") returns -5, which is truthy, so max(-5, 1) = 1
      expect(clampLimit("-5")).toBe(1);
    });

    it("clamps maximum to 100", () => {
      expect(clampLimit("150")).toBe(100);
      expect(clampLimit("999")).toBe(100);
    });

    it("accepts valid values in range", () => {
      expect(clampLimit("25")).toBe(25);
      expect(clampLimit("1")).toBe(1);
      expect(clampLimit("100")).toBe(100);
    });
  });

  describe("offset clamping", () => {
    it("defaults to 0 when no input", () => {
      expect(clampOffset(undefined)).toBe(0);
    });

    it("defaults to 0 for non-numeric input", () => {
      expect(clampOffset("abc")).toBe(0);
    });

    it("clamps minimum to 0", () => {
      expect(clampOffset("-10")).toBe(0);
    });

    it("accepts valid positive values", () => {
      expect(clampOffset("50")).toBe(50);
      expect(clampOffset("0")).toBe(0);
      expect(clampOffset("1000")).toBe(1000);
    });
  });
});

describe("Item ID Validation", () => {
  // Tests for ID parsing logic in routes
  function parseItemId(input: string): number | null {
    const id = parseInt(input, 10);
    if (isNaN(id) || id <= 0) {
      return null;
    }
    return id;
  }

  it("returns null for non-numeric input", () => {
    expect(parseItemId("abc")).toBe(null);
    expect(parseItemId("")).toBe(null);
    expect(parseItemId("one")).toBe(null);
  });

  it("returns null for zero", () => {
    expect(parseItemId("0")).toBe(null);
  });

  it("returns null for negative numbers", () => {
    expect(parseItemId("-1")).toBe(null);
    expect(parseItemId("-100")).toBe(null);
  });

  it("returns parsed ID for valid positive integers", () => {
    expect(parseItemId("1")).toBe(1);
    expect(parseItemId("42")).toBe(42);
    expect(parseItemId("999")).toBe(999);
  });

  it("handles string with leading zeros", () => {
    expect(parseItemId("007")).toBe(7);
  });

  it("handles decimal strings (truncates)", () => {
    expect(parseItemId("5.7")).toBe(5);
  });
});

describe("isValidCalendarDate", () => {
  it("accepts valid dates", () => {
    expect(isValidCalendarDate("2024-01-01")).toBe(true);
    expect(isValidCalendarDate("2024-12-31")).toBe(true);
    expect(isValidCalendarDate("2024-02-29")).toBe(true); // leap year
    expect(isValidCalendarDate("2025-06-15")).toBe(true);
  });

  it("rejects invalid month", () => {
    expect(isValidCalendarDate("2024-13-01")).toBe(false);
    expect(isValidCalendarDate("2024-00-01")).toBe(false);
  });

  it("rejects invalid day", () => {
    expect(isValidCalendarDate("2024-01-32")).toBe(false);
    expect(isValidCalendarDate("2024-13-45")).toBe(false);
    expect(isValidCalendarDate("2024-04-31")).toBe(false); // April has 30 days
    expect(isValidCalendarDate("2024-02-30")).toBe(false); // Feb never has 30
  });

  it("rejects Feb 29 on non-leap year", () => {
    expect(isValidCalendarDate("2023-02-29")).toBe(false);
    expect(isValidCalendarDate("2025-02-29")).toBe(false);
  });

  it("accepts Feb 28 on non-leap year", () => {
    expect(isValidCalendarDate("2023-02-28")).toBe(true);
  });

  it("rejects day zero", () => {
    expect(isValidCalendarDate("2024-01-00")).toBe(false);
  });
});

describe("Meal Plan Date Range Validation", () => {
  // Replicate the validation logic from the route handler for unit testing
  const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_RANGE_DAYS = 90;

  function validateDateRange(
    start: string | undefined,
    end: string | undefined,
  ): { valid: true } | { valid: false; error: string } {
    if (!start || !end || !DATE_FORMAT.test(start) || !DATE_FORMAT.test(end)) {
      return {
        valid: false,
        error: "start and end query parameters required (YYYY-MM-DD)",
      };
    }

    if (!isValidCalendarDate(start) || !isValidCalendarDate(end)) {
      return { valid: false, error: "Invalid calendar date" };
    }

    if (start > end) {
      return { valid: false, error: "start must be on or before end" };
    }

    const startMs = new Date(start + "T00:00:00Z").getTime();
    const endMs = new Date(end + "T00:00:00Z").getTime();
    const diffDays = (endMs - startMs) / (1000 * 60 * 60 * 24);
    if (diffDays > MAX_RANGE_DAYS) {
      return { valid: false, error: "Date range must not exceed 90 days" };
    }

    return { valid: true };
  }

  it("accepts a valid single-day range", () => {
    expect(validateDateRange("2024-06-01", "2024-06-01")).toEqual({
      valid: true,
    });
  });

  it("accepts a valid multi-day range", () => {
    expect(validateDateRange("2024-06-01", "2024-06-30")).toEqual({
      valid: true,
    });
  });

  it("accepts exactly 90-day range", () => {
    expect(validateDateRange("2024-01-01", "2024-03-31")).toEqual({
      valid: true,
    });
  });

  it("rejects missing start", () => {
    const result = validateDateRange(undefined, "2024-06-30");
    expect(result.valid).toBe(false);
  });

  it("rejects missing end", () => {
    const result = validateDateRange("2024-06-01", undefined);
    expect(result.valid).toBe(false);
  });

  it("rejects bad format", () => {
    const result = validateDateRange("06/01/2024", "06/30/2024");
    expect(result.valid).toBe(false);
  });

  it("rejects invalid calendar dates", () => {
    const result = validateDateRange("2024-13-45", "2024-14-50");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid calendar date");
    }
  });

  it("rejects start after end", () => {
    const result = validateDateRange("2024-06-30", "2024-06-01");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("start must be on or before end");
    }
  });

  it("rejects range exceeding 90 days", () => {
    const result = validateDateRange("2024-01-01", "2024-07-01");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Date range must not exceed 90 days");
    }
  });

  it("rejects Feb 30 as invalid calendar date", () => {
    const result = validateDateRange("2024-02-30", "2024-03-01");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toBe("Invalid calendar date");
    }
  });
});
