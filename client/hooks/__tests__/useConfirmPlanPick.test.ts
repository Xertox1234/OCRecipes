// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import type { FamilyProfile } from "@shared/schema";
import { createQueryWrapper } from "../../../test/utils/query-wrapper";
import { useConfirmPlanBatch, useConfirmPlanPick } from "../useConfirmPlanPick";
import { clearPendingAudience, setPendingAudience } from "@/lib/plan-audience";

const { mockAlert, mockApi, family, haptics } = vi.hoisted(() => ({
  mockAlert: vi.fn(),
  mockApi: vi.fn(),
  family: { value: null as unknown },
  haptics: { notification: vi.fn(), impact: vi.fn(), selection: vi.fn() },
}));

vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Alert: { alert: mockAlert },
}));
vi.mock("@/hooks/useFamily", () => ({ usePlanFamily: () => family.value }));
vi.mock("@/hooks/useHaptics", () => ({ useHaptics: () => haptics }));
vi.mock("@/lib/query-client", () => ({ apiRequest: mockApi }));

const ivy = {
  id: 1,
  name: "Ivy",
  allergies: [{ name: "peanuts", severity: "severe" }],
} as FamilyProfile;
const slot = { plannedDate: "2026-11-28", mealType: "dinner" };
const peanutRecipe = {
  id: 7,
  allergens: [{ id: "peanuts", viaDerived: false }],
  ingredients: [{ name: "peanut butter" }],
};

/** The user answers the alert by pressing the button with this text. */
function answerAlert(text: string | "dismiss") {
  mockAlert.mockImplementation((_t, _m, buttons, options) => {
    if (text === "dismiss") options.onDismiss();
    else buttons.find((b: { text: string }) => b.text === text).onPress();
  });
}

function setup() {
  const { wrapper } = createQueryWrapper();
  return renderHook(() => useConfirmPlanPick(), { wrapper }).result.current;
}

describe("useConfirmPlanPick (allergen check before a meal is added)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingAudience();
    family.value = { profiles: [ivy], userAllergies: [] };
    mockApi.mockResolvedValue({ json: async () => peanutRecipe });
  });

  it("asks before adding a recipe that clashes with who it is for, and adds on Add anyway", async () => {
    answerAlert("Add anyway");
    const confirm = setup();
    const out = await confirm({
      slot,
      meal: { recipeId: 7 },
      audience: { audience: "profile", familyProfileId: 1 },
    });
    expect(out).toEqual({ proceed: true, note: null });
    expect(mockApi).toHaveBeenCalledWith("GET", "/api/meal-plan/recipes/7");
    const [title, message] = mockAlert.mock.calls[0];
    expect(title).toBe("Allergy check");
    expect(message).toContain("Contains peanuts — Ivy");
    expect(haptics.notification).toHaveBeenCalled();
  });

  it("Cancel stops the add, and so does dismissing the alert", async () => {
    const confirm = setup();
    const req = {
      slot,
      meal: { recipeId: 7 },
      audience: { audience: "profile" as const, familyProfileId: 1 },
    };
    answerAlert("Cancel");
    expect((await confirm(req)).proceed).toBe(false);
    answerAlert("dismiss");
    expect((await confirm(req)).proceed).toBe(false);
  });

  it("uses the add menu's choice for the slot, and leaves it for the add to take", async () => {
    answerAlert("Cancel");
    setPendingAudience(slot, { audience: "profile", familyProfileId: 1 });
    const confirm = setup();
    expect((await confirm({ slot, meal: { recipeId: 7 } })).proceed).toBe(
      false,
    );
    // Still there: the add itself takes it.
    expect((await confirm({ slot, meal: { recipeId: 7 } })).proceed).toBe(
      false,
    );
  });

  it("with no choice the meal is the user's own, checked against the user's allergies", async () => {
    const confirm = setup();
    expect(await confirm({ slot, meal: { recipeId: 7 } })).toEqual({
      proceed: true,
      note: null,
    });
    // Nobody the meal is for has an allergy: no read, no alert.
    expect(mockApi).not.toHaveBeenCalledWith("GET", "/api/meal-plan/recipes/7");
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("no clash: adds with no alert", async () => {
    mockApi.mockResolvedValue({
      json: async () => ({ ...peanutRecipe, allergens: [] }),
    });
    const confirm = setup();
    const out = await confirm({
      slot,
      meal: { recipeId: 7 },
      audience: { audience: "profile", familyProfileId: 1 },
    });
    expect(out).toEqual({ proceed: true, note: null });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  it("a recipe that cannot be read is not checked, never safe: adds with the note", async () => {
    mockApi.mockRejectedValue(new Error("offline"));
    const confirm = setup();
    const out = await confirm({
      slot,
      meal: { recipeId: 7 },
      audience: { audience: "profile", familyProfileId: 1 },
    });
    expect(out).toEqual({ proceed: true, note: "Allergens not checked" });
    expect(mockAlert).not.toHaveBeenCalled();
  });

  describe("with family planning off", () => {
    beforeEach(() => {
      family.value = null;
    });

    function setupWithProfile(profile: unknown) {
      const { wrapper, queryClient } = createQueryWrapper();
      if (profile !== undefined) {
        queryClient.setQueryData(["/api/user/dietary-profile"], profile);
      }
      return renderHook(() => useConfirmPlanPick(), { wrapper }).result.current;
    }

    it("still checks the user's own allergies", async () => {
      answerAlert("Cancel");
      const confirm = setupWithProfile({
        allergies: [{ name: "peanuts", severity: "mild" }],
      });
      const out = await confirm({ slot, meal: { recipeId: 7 } });
      expect(out.proceed).toBe(false);
      expect(mockAlert.mock.calls[0][1]).toContain(
        "Contains peanuts \u2014 You",
      );
    });

    it("ignores a stale family choice: the meal is the user's own", async () => {
      setPendingAudience(slot, { audience: "profile", familyProfileId: 1 });
      const confirm = setupWithProfile({ allergies: [] });
      expect(await confirm({ slot, meal: { recipeId: 7 } })).toEqual({
        proceed: true,
        note: null,
      });
      expect(mockAlert).not.toHaveBeenCalled();
    });

    it("no allergies and no profile: nothing to check", async () => {
      const confirm = setupWithProfile(null);
      expect(await confirm({ slot, meal: { allergens: null } })).toEqual({
        proceed: true,
        note: null,
      });
    });

    it("allergies not loaded yet: not checked, never safe", async () => {
      const confirm = setupWithProfile(undefined);
      expect(await confirm({ slot, meal: { recipeId: 7 } })).toEqual({
        proceed: true,
        note: "Allergens not checked",
      });
    });
  });
});

describe("useConfirmPlanBatch (allergen check before a generated plan is saved)", () => {
  const satay = {
    title: "Satay noodles",
    meal: { allergens: [{ id: "peanuts" as const, viaDerived: false }] },
  };
  const rice = { title: "Rice bowl", meal: { allergens: [] } };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupBatch(familyValue: unknown, profile?: unknown) {
    family.value = familyValue;
    const { wrapper, queryClient } = createQueryWrapper();
    if (profile !== undefined) {
      queryClient.setQueryData(["/api/user/dietary-profile"], profile);
    }
    return renderHook(() => useConfirmPlanBatch(), { wrapper }).result.current;
  }

  it("one alert lists the clashing meals; Save anyway saves", async () => {
    answerAlert("Save anyway");
    const confirm = setupBatch(null, {
      allergies: [{ name: "peanuts", severity: "mild" }],
    });
    expect(await confirm([satay, rice])).toEqual({ proceed: true, note: null });
    expect(mockAlert).toHaveBeenCalledTimes(1);
    const [title, message] = mockAlert.mock.calls[0];
    expect(title).toBe("Allergy check");
    expect(message).toContain("Satay noodles: Contains peanuts \u2014 You");
    expect(message).not.toContain("Rice bowl");
    expect(haptics.notification).toHaveBeenCalled();
  });

  it("Cancel and dismiss stop the save", async () => {
    const confirm = setupBatch(null, {
      allergies: [{ name: "peanuts", severity: "mild" }],
    });
    answerAlert("Cancel");
    expect((await confirm([satay])).proceed).toBe(false);
    answerAlert("dismiss");
    expect((await confirm([satay])).proceed).toBe(false);
  });

  it("with family planning on, checks the user's own allergies", async () => {
    answerAlert("Cancel");
    const confirm = setupBatch({
      profiles: [ivy],
      userAllergies: [{ name: "peanuts", severity: "mild" }],
    });
    expect((await confirm([satay])).proceed).toBe(false);
  });

  it("allergies not loaded yet: saves with the not-checked note", async () => {
    const confirm = setupBatch(null);
    expect(await confirm([satay])).toEqual({
      proceed: true,
      note: "Allergens not checked",
    });
    expect(mockAlert).not.toHaveBeenCalled();
  });
});
