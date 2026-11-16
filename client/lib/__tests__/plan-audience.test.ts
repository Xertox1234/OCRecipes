import {
  PENDING_AUDIENCE_TTL_MS,
  clearPendingAudience,
  setPendingAudience,
  takePendingAudience,
} from "../plan-audience";

const slot = { plannedDate: "2026-11-17", mealType: "dinner" };
const ivy = { audience: "profile" as const, familyProfileId: 7 };

beforeEach(() => {
  clearPendingAudience();
});

describe("plan-audience", () => {
  it("returns the choice once for the matching slot, then null", () => {
    setPendingAudience(slot, ivy);
    expect(takePendingAudience(slot)).toEqual(ivy);
    expect(takePendingAudience(slot)).toBeNull();
  });

  it("returns null for another date and does not clear", () => {
    setPendingAudience(slot, ivy);
    expect(
      takePendingAudience({ plannedDate: "2026-11-18", mealType: "dinner" }),
    ).toBeNull();
    expect(takePendingAudience(slot)).toEqual(ivy);
  });

  it("returns null for another meal and does not clear", () => {
    setPendingAudience(slot, ivy);
    expect(
      takePendingAudience({ plannedDate: "2026-11-17", mealType: "lunch" }),
    ).toBeNull();
    expect(takePendingAudience(slot)).toEqual(ivy);
  });

  it("keeps only the latest choice", () => {
    setPendingAudience(slot, ivy);
    setPendingAudience(slot, { audience: "shared", familyProfileId: null });
    expect(takePendingAudience(slot)).toEqual({
      audience: "shared",
      familyProfileId: null,
    });
  });

  it("clearPendingAudience forgets the choice", () => {
    setPendingAudience(slot, ivy);
    clearPendingAudience();
    expect(takePendingAudience(slot)).toBeNull();
  });
  // The menu closes when it hands off to Quick Add or Import, so a choice
  // cannot be cleared on dismiss. Left forever, an abandoned "for Ivy" would
  // be applied to a meal added to that slot much later by another route.
  it("forgets a choice that was never used after ten minutes", () => {
    vi.useFakeTimers();
    try {
      setPendingAudience(slot, ivy);
      vi.advanceTimersByTime(PENDING_AUDIENCE_TTL_MS + 1);
      expect(takePendingAudience(slot)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still applies a choice used within ten minutes", () => {
    vi.useFakeTimers();
    try {
      setPendingAudience(slot, ivy);
      vi.advanceTimersByTime(PENDING_AUDIENCE_TTL_MS - 1);
      expect(takePendingAudience(slot)).toEqual(ivy);
    } finally {
      vi.useRealTimers();
    }
  });
});
