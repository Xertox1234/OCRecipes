// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";

import GoalSetupScreen from "../GoalSetupScreen";

const {
  mockGoBack,
  mockApiRequest,
  mockUpdateUser,
  mockNotification,
  mockToastSuccess,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockApiRequest: vi.fn(),
  mockUpdateUser: vi.fn().mockResolvedValue(undefined),
  mockNotification: vi.fn(),
  mockToastSuccess: vi.fn(),
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
    notification: mockNotification,
    selection: vi.fn(),
    disabled: false,
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

async function fillCalculateAndSave() {
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

  const saveButton = await screen.findByLabelText("Save my goals");
  // Calculate fires its own Success haptic (results appear on screen); the
  // save assertions below are about the save alone.
  mockNotification.mockClear();
  fireEvent.click(saveButton);
}

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

  // The screen closes on save, so the confirmation is a toast (it survives the
  // navigation and fires its own Success haptic — no second buzz).
  it("a successful save toasts once and fires no extra Success haptic", async () => {
    await fillCalculateAndSave();

    await waitFor(() => {
      expect(mockGoBack).toHaveBeenCalledOnce();
    });
    expect(mockToastSuccess).toHaveBeenCalledExactlyOnceWith("Goals saved");
    expect(mockNotification).not.toHaveBeenCalled();
  });

  it("no success toast when the local user update fails after the PUT", async () => {
    mockUpdateUser.mockRejectedValue(new Error("storage"));

    await fillCalculateAndSave();

    await waitFor(() => {
      expect(mockNotification).toHaveBeenCalledWith(
        Haptics.NotificationFeedbackType.Error,
      );
    });
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });
});
