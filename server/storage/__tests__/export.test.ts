import { describe, it, expect } from "vitest";
import { exportUserColumns } from "../export";

// The CCPA/PIPEDA export's load-bearing safety property is that the user-account
// projection is an explicit allowlist. The route layer never re-filters — if a
// sensitive column slips into the allowlist, it will appear in every export.
// This test guards the allowlist directly so a regression fails fast in CI,
// independent of any database, mocks, or HTTP setup.
describe("exportUserColumns", () => {
  const forbiddenKeys = ["password", "tokenVersion"] as const;

  for (const key of forbiddenKeys) {
    it(`does not include sensitive column "${key}"`, () => {
      expect(Object.keys(exportUserColumns)).not.toContain(key);
    });
  }
});
