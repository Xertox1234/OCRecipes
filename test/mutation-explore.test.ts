import { describe, it, expect } from "vitest";
import { classifyExploreTarget } from "../scripts/mutation-explore.mjs";

describe("mutation:explore gate", () => {
  it("runs a non-excluded module", () => {
    expect(
      classifyExploreTarget("server/lib/macro-gap-context.ts").action,
    ).toBe("run");
  });

  it("runs an approved Hard-Exclusion target without --spike", () => {
    // goal-calculator is in HUMAN_APPROVED_EXCLUSIONS
    expect(
      classifyExploreTarget("server/services/goal-calculator.ts").action,
    ).toBe("run");
  });

  it("refuses an unapproved Hard-Exclusion module without --spike", () => {
    expect(classifyExploreTarget("server/middleware/auth.ts").action).toBe(
      "refuse",
    );
  });

  it("allows a read-only spike on an unapproved Hard-Exclusion module", () => {
    expect(
      classifyExploreTarget("server/middleware/auth.ts", { spike: true })
        .action,
    ).toBe("spike");
  });
});
