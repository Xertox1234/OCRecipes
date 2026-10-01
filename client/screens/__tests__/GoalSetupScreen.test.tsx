// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { renderComponent } from "../../../test/utils/render-component";

import GoalSetupScreen from "../GoalSetupScreen";

const { mockGoBack, mockApiRequest, mockUpdateUser } = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockApiRequest: vi.fn(),
  mockUpdateUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    user: { measurementUnit: "metric" },
    updateUser: mockUpdateUser,
  }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => true,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

describe("GoalSetupScreen — save invalidates the daily-budget cache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateUser.mockResolvedValue(undefined);
    mockApiRequest.mockImplementation(async (method: string, url: string) => {
      if (method === "POST" && url === "/api/goals/calculate") {
        return {
          json: async () => ({
            dailyCalories: 2200,
            dailyProtein: 150,
            dailyCarbs: 220,
            dailyFat: 70,
          }),
        };
      }
      if (method === "PUT" && url === "/api/goals") {
        return { json: async () => ({}) };
      }
      throw new Error(`unexpected request ${method} ${url}`);
    });
  });

  // P1-2026-09-23: saveMutation's onSuccess used to invalidate only
  // /api/goals and /api/daily-summary, leaving Home's "X / Y cal" header
  // (useDailyBudget) showing the pre-change calorie goal.
  it("invalidates /api/daily-budget after Save My Goals succeeds", async () => {
    const invalidateSpy = vi.spyOn(QueryClient.prototype, "invalidateQueries");

    renderComponent(<GoalSetupScreen />);

    fireEvent.change(screen.getByLabelText("Age"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Height"), {
      target: { value: "170" },
    });
    fireEvent.click(screen.getByLabelText("Male"));
    fireEvent.click(screen.getByLabelText("Sedentary"));
    fireEvent.click(screen.getByLabelText("Lose Weight"));

    fireEvent.click(screen.getByLabelText("Calculate my goals"));

    fireEvent.click(await screen.findByLabelText("Save my goals"));

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalledOnce();
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/daily-budget"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["/api/goals"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["/api/daily-summary"],
    });

    invalidateSpy.mockRestore();
  });
});
