import { describe, it, expect } from "vitest";
import { formatErrorDetails } from "../error-fallback-utils";

describe("formatErrorDetails", () => {
  it("formats error message", () => {
    const result = formatErrorDetails({ message: "Something broke" });
    expect(result).toBe("Error: Something broke\n\n");
  });

  it("includes stack trace when present", () => {
    const result = formatErrorDetails({
      message: "Something broke",
      stack: "at foo (bar.ts:1)\nat baz (qux.ts:2)",
    });
    expect(result).toContain("Error: Something broke");
    expect(result).toContain("Stack Trace:");
    expect(result).toContain("at foo (bar.ts:1)");
  });

  it("omits stack trace section when no stack", () => {
    const result = formatErrorDetails({ message: "No stack" });
    expect(result).not.toContain("Stack Trace:");
  });

  it("handles empty message", () => {
    const result = formatErrorDetails({ message: "" });
    expect(result).toBe("Error: \n\n");
  });

  it("handles undefined stack", () => {
    const result = formatErrorDetails({
      message: "Test",
      stack: undefined,
    });
    expect(result).toBe("Error: Test\n\n");
  });
});
