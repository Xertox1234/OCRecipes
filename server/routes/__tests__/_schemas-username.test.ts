import { describe, it, expect } from "vitest";

import { registerSchema } from "../_schemas";
import { USERNAME_MAX, USERNAME_MIN } from "@shared/constants/username";

// The client's live checklist reads the same constants; this pins the server
// to them at both edges and on the character rule.
describe("registerSchema.username", () => {
  const ok = (u: string) => registerSchema.shape.username.safeParse(u).success;

  it("takes the shared length limits, inclusive", () => {
    expect(ok("a".repeat(USERNAME_MIN - 1))).toBe(false);
    expect(ok("a".repeat(USERNAME_MIN))).toBe(true);
    expect(ok("a".repeat(USERNAME_MAX))).toBe(true);
    expect(ok("a".repeat(USERNAME_MAX + 1))).toBe(false);
  });

  it("takes letters, numbers and _ only", () => {
    expect(ok("chef_1")).toBe(true);
    expect(ok("ab-c")).toBe(false);
    expect(ok("me@x.com")).toBe(false);
  });
});
