import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMockCommunityRecipe } from "../../__tests__/factories";

import { runPromotionJob } from "../canonical-promotion";
import { storage } from "../../storage";
import { enrichRecipe } from "../canonical-enrichment";

vi.mock("../../storage", () => ({
  storage: {
    getEligibleForPromotion: vi.fn().mockResolvedValue([]),
    markCanonical: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../canonical-enrichment", () => ({
  enrichRecipe: vi.fn().mockResolvedValue(undefined),
}));

describe("runPromotionJob", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when no eligible recipes", async () => {
    vi.mocked(storage.getEligibleForPromotion).mockResolvedValue([]);
    await runPromotionJob();
    expect(storage.markCanonical).not.toHaveBeenCalled();
  });

  it("marks eligible recipes canonical and enqueues enrichment", async () => {
    vi.mocked(storage.getEligibleForPromotion).mockResolvedValue([
      createMockCommunityRecipe({ id: 1 }),
      createMockCommunityRecipe({ id: 2 }),
    ]);
    await runPromotionJob();
    expect(storage.markCanonical).toHaveBeenCalledTimes(2);
    expect(storage.markCanonical).toHaveBeenCalledWith(1);
    expect(storage.markCanonical).toHaveBeenCalledWith(2);
    expect(enrichRecipe).toHaveBeenCalledTimes(2);
    expect(enrichRecipe).toHaveBeenCalledWith(1);
    expect(enrichRecipe).toHaveBeenCalledWith(2);
  });
});
