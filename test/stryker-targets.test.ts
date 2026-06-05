import { describe, it, expect } from "vitest";
import {
  MUTATION_TARGETS,
  DEFAULT_TARGET,
  resolveTarget,
} from "../stryker.targets.mjs";

describe("mutation target registry", () => {
  it("resolves both axes for a known target", () => {
    const t = resolveTarget("verification-consensus");
    expect(t.mutate).toEqual(["server/lib/verification-consensus.ts"]);
    expect(t.testInclude).toEqual([
      "server/lib/__tests__/verification-consensus.test.ts",
    ]);
  });

  it("defaults to macro-gap-context when no name is given", () => {
    expect(resolveTarget()).toBe(MUTATION_TARGETS[DEFAULT_TARGET]);
    expect(DEFAULT_TARGET).toBe("macro-gap-context");
  });

  it("throws a listing error on an unknown target", () => {
    expect(() => resolveTarget("nope")).toThrow(
      /Unknown MUTATION_TARGET "nope"/,
    );
    expect(() => resolveTarget("nope")).toThrow(/macro-gap-context/);
  });

  it("never registers a Hard-Exclusion module (policy guard)", () => {
    const paths = Object.values(MUTATION_TARGETS).flatMap((t) => [
      ...t.mutate,
      ...t.testInclude,
    ]);
    const forbidden =
      /(^|\/)auth\.ts|api-key-auth|goal-calculator|adaptive-goals|receipt-validation|healthkit|(^|\/)health\.ts|jwt-/i;
    for (const p of paths) expect(p).not.toMatch(forbidden);
  });
});
