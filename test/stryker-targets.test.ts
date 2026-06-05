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

  const FORBIDDEN =
    /(^|\/)auth\.ts|api-key-auth|goal-calculator|adaptive-goals|receipt-validation|healthkit|(^|\/)health\.ts|jwt-|shared\/schema\.ts|(^|\/)migrations\//i;

  it("never registers a Hard-Exclusion module (policy guard)", () => {
    const paths = Object.values(MUTATION_TARGETS).flatMap((t) => [
      ...t.mutate,
      ...t.testInclude,
    ]);
    for (const p of paths) expect(p).not.toMatch(FORBIDDEN);
  });

  it("policy guard regex actually matches known Hard-Exclusion paths", () => {
    const forbiddenExamples = [
      "server/middleware/auth.ts",
      "server/routes/auth.ts",
      "server/middleware/api-key-auth.ts",
      "server/services/goal-calculator.ts",
      "server/services/adaptive-goals.ts",
      "server/services/receipt-validation.ts",
      "server/services/healthkit-sync.ts",
      "server/storage/health.ts",
      "server/lib/jwt-verify.ts",
      "shared/schema.ts",
      "migrations/0001_init.ts",
    ];
    for (const p of forbiddenExamples) expect(p).toMatch(FORBIDDEN);
  });
});
