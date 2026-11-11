import { describe, it, expect } from "vitest";

import {
  AGE_ATTESTATION_ERROR,
  AGE_ATTESTATION_LABEL,
  MINIMUM_AGE,
} from "../minimum-age";

describe("minimum age", () => {
  // Quebec Law 25: consent for a person under 14 comes from a parent, so the
  // app's floor is 14 (privacy audit G5, owner ruling 2026-11-10).
  it("is 14", () => {
    expect(MINIMUM_AGE).toBe(14);
  });

  it("is the age the sign-up attestation and its error name", () => {
    expect(AGE_ATTESTATION_LABEL).toBe(
      "I confirm I am 14 years of age or older",
    );
    expect(AGE_ATTESTATION_ERROR).toBe(
      "You must confirm you are 14 years of age or older",
    );
  });
});
