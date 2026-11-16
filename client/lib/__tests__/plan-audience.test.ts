import {
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
});
