// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";
import React from "react";

import {
  OnboardingProvider,
  useOnboarding,
  type Allergy,
} from "../OnboardingContext";

// Exercise the REAL OnboardingProvider / useOnboarding rather than
// re-declaring the types/defaults and re-implementing updateData/nextStep/
// prevStep inline. Only the provider's collaborators are mocked.

const { mockUpdateUser, mockCheckAuth, mockApiRequest } = vi.hoisted(() => ({
  mockUpdateUser: vi.fn(),
  mockCheckAuth: vi.fn(),
  mockApiRequest: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    updateUser: mockUpdateUser,
    checkAuth: mockCheckAuth,
  }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn() },
}));

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(OnboardingProvider, null, children);
  };
}

function renderOnboarding() {
  return renderHook(() => useOnboarding(), { wrapper: createWrapper() });
}

describe("useOnboarding hook", () => {
  it("throws when used outside an OnboardingProvider", () => {
    expect(() => renderHook(() => useOnboarding())).toThrow(
      "useOnboarding must be used within an OnboardingProvider",
    );
  });
});

describe("OnboardingProvider default data", () => {
  it("has empty arrays for list fields", () => {
    const { result } = renderOnboarding();
    expect(result.current.data.allergies).toEqual([]);
    expect(result.current.data.healthConditions).toEqual([]);
    expect(result.current.data.foodDislikes).toEqual([]);
    expect(result.current.data.cuisinePreferences).toEqual([]);
  });

  it("has null for selection fields", () => {
    const { result } = renderOnboarding();
    expect(result.current.data.dietType).toBeNull();
    expect(result.current.data.primaryGoal).toBeNull();
    expect(result.current.data.activityLevel).toBeNull();
    expect(result.current.data.cookingSkillLevel).toBeNull();
    expect(result.current.data.cookingTimeAvailable).toBeNull();
  });

  it("defaults householdSize to 1", () => {
    const { result } = renderOnboarding();
    expect(result.current.data.householdSize).toBe(1);
  });

  it("defaults healthDataConsent to false", () => {
    const { result } = renderOnboarding();
    expect(result.current.data.healthDataConsent).toBe(false);
  });

  it("exposes exactly 11 onboarding-data fields", () => {
    const { result } = renderOnboarding();
    expect(Object.keys(result.current.data)).toHaveLength(11);
  });

  it("starts at step 0 with the provider's totalSteps", () => {
    const { result } = renderOnboarding();
    expect(result.current.currentStep).toBe(0);
    expect(result.current.totalSteps).toBe(9);
  });
});

describe("OnboardingProvider updateData (partial merge)", () => {
  it("merges partial updates into existing data, leaving other fields untouched", () => {
    const { result } = renderOnboarding();

    act(() => {
      result.current.updateData({ dietType: "vegan", householdSize: 3 });
    });

    expect(result.current.data.dietType).toBe("vegan");
    expect(result.current.data.householdSize).toBe(3);
    expect(result.current.data.allergies).toEqual([]);
    expect(result.current.data.primaryGoal).toBeNull();
  });

  it("overwrites arrays when updated", () => {
    const { result } = renderOnboarding();
    const allergies: Allergy[] = [
      { name: "Peanuts", severity: "severe" },
      { name: "Shellfish", severity: "moderate" },
    ];

    act(() => {
      result.current.updateData({ allergies });
    });

    expect(result.current.data.allergies).toHaveLength(2);
    expect(result.current.data.allergies[0]).toEqual({
      name: "Peanuts",
      severity: "severe",
    });
  });

  it("applies multiple successive updates", () => {
    const { result } = renderOnboarding();

    act(() => {
      result.current.updateData({
        primaryGoal: "lose_weight",
        activityLevel: "moderate",
      });
    });
    act(() => {
      result.current.updateData({
        cookingSkillLevel: "intermediate",
        cuisinePreferences: ["Italian", "Japanese"],
      });
    });

    expect(result.current.data.primaryGoal).toBe("lose_weight");
    expect(result.current.data.activityLevel).toBe("moderate");
    expect(result.current.data.cookingSkillLevel).toBe("intermediate");
    expect(result.current.data.cuisinePreferences).toEqual([
      "Italian",
      "Japanese",
    ]);
  });

  it("allows setting fields back to null", () => {
    const { result } = renderOnboarding();

    act(() => {
      result.current.updateData({
        dietType: "vegetarian",
        primaryGoal: "gain_muscle",
      });
    });
    act(() => {
      result.current.updateData({ dietType: null, primaryGoal: null });
    });

    expect(result.current.data.dietType).toBeNull();
    expect(result.current.data.primaryGoal).toBeNull();
  });
});

describe("OnboardingProvider step navigation", () => {
  it("nextStep increments within bounds and caps at totalSteps - 1", () => {
    const { result } = renderOnboarding();
    const last = result.current.totalSteps - 1;

    act(() => {
      result.current.nextStep();
    });
    expect(result.current.currentStep).toBe(1);

    // Walk to the final step.
    for (let i = result.current.currentStep; i < last; i++) {
      act(() => {
        result.current.nextStep();
      });
    }
    expect(result.current.currentStep).toBe(last);

    // Further calls are capped.
    act(() => {
      result.current.nextStep();
    });
    expect(result.current.currentStep).toBe(last);
  });

  it("prevStep decrements within bounds and does not go below 0", () => {
    const { result } = renderOnboarding();

    // With the health-data consent every screen is walked in order.
    act(() => {
      result.current.nextStep();
    });
    act(() => {
      result.current.answerConsent(true);
    });
    act(() => {
      result.current.nextStep();
    });
    expect(result.current.currentStep).toBe(3);

    act(() => {
      result.current.prevStep();
    });
    expect(result.current.currentStep).toBe(2);

    // Walk back past 0 — should clamp.
    for (let i = 0; i < 5; i++) {
      act(() => {
        result.current.prevStep();
      });
    }
    expect(result.current.currentStep).toBe(0);
  });
});

describe("OnboardingProvider completeOnboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiRequest.mockResolvedValue({ json: async () => ({}) });
    mockUpdateUser.mockResolvedValue({ onboardingCompleted: true });
  });

  it("saves the profile, then the taste picks, then marks the user onboarded", async () => {
    const { result } = renderOnboarding();

    await act(async () => {
      await result.current.completeOnboarding([3, 7]);
    });

    expect(mockApiRequest.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      ["POST", "/api/user/dietary-profile"],
      ["PUT", "/api/taste-picks"],
    ]);
    expect(mockApiRequest).toHaveBeenLastCalledWith("PUT", "/api/taste-picks", {
      recipeIds: [3, 7],
    });
    expect(mockUpdateUser).toHaveBeenCalledWith({ onboardingCompleted: true });
  });

  it("skips the taste-picks write when there are no picks", async () => {
    const { result } = renderOnboarding();

    await act(async () => {
      await result.current.completeOnboarding();
    });

    expect(mockApiRequest).toHaveBeenCalledTimes(1);
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/user/dietary-profile",
      expect.any(Object),
    );
  });

  it("rethrows a failed picks save without resyncing, so the user stays and can retry", async () => {
    mockApiRequest.mockImplementation(async (method: string) => {
      if (method === "PUT") throw new Error("500");
      return { json: async () => ({}) };
    });
    const { result } = renderOnboarding();

    await act(async () => {
      await expect(result.current.completeOnboarding([3])).rejects.toThrow();
    });

    expect(mockUpdateUser).not.toHaveBeenCalled();
    expect(mockCheckAuth).not.toHaveBeenCalled();
  });

  it("resyncs via checkAuth when the server saved but the local user update failed", async () => {
    mockUpdateUser.mockRejectedValue(new Error("local sync failed"));
    const { result } = renderOnboarding();

    await act(async () => {
      await expect(result.current.completeOnboarding([3])).rejects.toThrow(
        "local sync failed",
      );
    });

    expect(mockCheckAuth).toHaveBeenCalledOnce();
  });

  // Privacy audit H2 — "no consent, no health data".
  describe("answerConsent", () => {
    it("agreeing records the consent and moves on to the first health question", () => {
      const { result } = renderHook(() => useOnboarding(), {
        wrapper: createWrapper(),
      });
      act(() => result.current.nextStep()); // Welcome → AI question
      act(() => result.current.nextStep()); // AI question → consent

      act(() => result.current.answerConsent(true));

      expect(result.current.data.healthDataConsent).toBe(true);
      expect(result.current.currentStep).toBe(3); // Allergies
    });

    it("declining skips the health questions, in both directions", () => {
      const { result } = renderHook(() => useOnboarding(), {
        wrapper: createWrapper(),
      });
      act(() => result.current.nextStep());
      act(() => result.current.nextStep());

      act(() => result.current.answerConsent(false));
      expect(result.current.data.healthDataConsent).toBe(false);
      expect(result.current.currentStep).toBe(5); // DietType

      act(() => result.current.nextStep());
      expect(result.current.currentStep).toBe(7); // Preferences, not Goals

      act(() => result.current.prevStep());
      act(() => result.current.prevStep());
      expect(result.current.currentStep).toBe(2); // back on the consent screen
    });

    it("declining after answering drops the health answers already given", () => {
      const { result } = renderHook(() => useOnboarding(), {
        wrapper: createWrapper(),
      });
      act(() => result.current.nextStep());
      act(() => result.current.answerConsent(true));
      act(() =>
        result.current.updateData({
          allergies: [{ name: "peanuts", severity: "severe" }],
          healthConditions: ["type 2 diabetes"],
          primaryGoal: "lose_weight",
          activityLevel: "moderate",
          dietType: "vegan",
        }),
      );
      act(() => result.current.prevStep()); // Allergies → consent

      act(() => result.current.answerConsent(false));

      expect(result.current.data.allergies).toEqual([]);
      expect(result.current.data.healthConditions).toEqual([]);
      expect(result.current.data.primaryGoal).toBeNull();
      expect(result.current.data.activityLevel).toBeNull();
      expect(result.current.data.dietType).toBe("vegan");
    });
  });
});
