// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";

import GoalSetupScreen from "../GoalSetupScreen";

const {
  mockGoBack,
  mockApiRequest,
  mockUpdateUser,
  mockNotification,
  mockToastSuccess,
  mockSelection,
  mockImpact,
} = vi.hoisted(() => ({
  mockGoBack: vi.fn(),
  mockApiRequest: vi.fn(),
  mockUpdateUser: vi.fn().mockResolvedValue(undefined),
  mockNotification: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockSelection: vi.fn(),
  mockImpact: vi.fn(),
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
    impact: mockImpact,
    notification: mockNotification,
    selection: mockSelection,
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

// react-native-web's ScrollView ref has no scrollToEnd under jsdom; the screen
// scrolls the results into view after Calculate (QA #70).
const mockScrollToEnd = vi.fn();
(
  HTMLElement.prototype as unknown as { scrollToEnd: typeof mockScrollToEnd }
).scrollToEnd = mockScrollToEnd;

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

// Gender, activity level and goal options are SelectableTiles: each pick
// ticks `selection()` once and never the impact buzz.
describe("GoalSetupScreen — one selection tick per pick", () => {
  it("every gender, activity and goal option ticks once", () => {
    renderComponent(<GoalSetupScreen />);
    const options = screen.getAllByRole("radio");
    // Denominator: gender + activity + goal options all rendered.
    expect(options.length).toBeGreaterThan(8);

    for (const [i, option] of options.entries()) {
      mockSelection.mockClear();
      fireEvent.click(option);
      expect(mockSelection, `option ${i}`).toHaveBeenCalledTimes(1);
    }
    expect(mockImpact).not.toHaveBeenCalled();
  });
});

// The line under Calculate must keep its place when the last field is
// filled: removing it shortened the page, and at the bottom of the scroll
// that moved the button out from under the finger.
describe("GoalSetupScreen — calculate hint keeps its space", () => {
  it("swaps 'Still needed' for a ready line instead of removing it", () => {
    renderComponent(<GoalSetupScreen />);
    expect(screen.getByText(/^Still needed: /)).toBeTruthy();

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

    expect(screen.queryByText(/^Still needed: /)).toBeNull();
    expect(screen.getByText("Ready to calculate")).toBeTruthy();
  });
});

// Number fields say why they refuse a value — on leaving the field or on
// Calculate/Save, never per keystroke. "Still needed" keeps owning empties.
describe("GoalSetupScreen — number fields say why they refuse a value", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      return { json: async () => ({}) };
    });
  });

  it("shows the age message on leaving the field, not while typing", () => {
    renderComponent(<GoalSetupScreen />);
    const age = screen.getByLabelText("Age");

    fireEvent.change(age, { target: { value: "5" } });
    expect(screen.queryByText("Age must be 13–120")).toBeNull();

    fireEvent.blur(age);
    expect(screen.getByText("Age must be 13–120")).toBeTruthy();
    expect(mockNotification).toHaveBeenCalledExactlyOnceWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(screen.getByText(/^Still needed: /)).toBeTruthy();
  });

  it("refuses to calculate with an out-of-range field and says why", () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText("Height"), {
      target: { value: "170" },
    });
    fireEvent.click(screen.getByLabelText("Male"));
    fireEvent.click(screen.getByLabelText("Sedentary"));
    fireEvent.click(screen.getByLabelText("Lose Weight"));

    fireEvent.click(screen.getByLabelText("Calculate my goals"));

    expect(screen.getByText("Weight must be 25–350 kg")).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalled();
    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });

  it("sends a comma-decimal weight as the number typed", async () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "70,5" },
    });
    fireEvent.change(screen.getByLabelText("Height"), {
      target: { value: "170" },
    });
    fireEvent.click(screen.getByLabelText("Male"));
    fireEvent.click(screen.getByLabelText("Sedentary"));
    fireEvent.click(screen.getByLabelText("Lose Weight"));

    fireEvent.click(screen.getByLabelText("Calculate my goals"));

    await waitFor(() => {
      expect(mockApiRequest).toHaveBeenCalledWith(
        "POST",
        "/api/goals/calculate",
        expect.objectContaining({ age: 30, weight: 70.5, height: 170 }),
      );
    });
  });

  it("refuses to save an out-of-range calorie target and says why", async () => {
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

    const calories = await screen.findByLabelText("Daily calorie target");
    fireEvent.change(calories, { target: { value: "100" } });
    mockNotification.mockClear();
    fireEvent.click(screen.getByLabelText("Save my goals"));

    expect(screen.getByText("Calories must be 800–6000")).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalledWith(
      "PUT",
      "/api/goals",
      expect.anything(),
    );
    expect(mockNotification).toHaveBeenCalledExactlyOnceWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });
});

// Form-fields spec §5.1: Calculate is pressable before the form is complete;
// pressing it points at what's missing. Save flags an emptied field.
describe("GoalSetupScreen — Calculate and Save point at what's missing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      return { json: async () => ({}) };
    });
  });

  it("Calculate is pressable on an empty form; pressing focuses Age and keeps Still needed", () => {
    renderComponent(<GoalSetupScreen />);
    const calculate = screen.getByLabelText("Calculate my goals");
    expect(calculate.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(calculate);

    expect(document.activeElement).toBe(screen.getByLabelText("Age"));
    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(screen.getByText(/^Still needed: /)).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("focuses the first missing number field, skipping filled ones", () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age"), { target: { value: "30" } });
    fireEvent.click(screen.getByLabelText("Calculate my goals"));
    expect(document.activeElement).toBe(screen.getByLabelText("Weight"));
  });

  it("with only a choice missing, says what's still needed", () => {
    const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Height"), {
      target: { value: "170" },
    });
    fireEvent.click(screen.getByLabelText("Male"));
    fireEvent.click(screen.getByLabelText("Sedentary"));

    fireEvent.click(screen.getByLabelText("Calculate my goals"));

    expect(announce).toHaveBeenCalledWith("Still needed: primary goal");
    expect(mockApiRequest).not.toHaveBeenCalled();
    announce.mockRestore();
  });

  it("an out-of-range weight on Calculate moves focus to Weight", () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age"), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText("Weight"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText("Height"), {
      target: { value: "170" },
    });
    fireEvent.click(screen.getByLabelText("Male"));
    fireEvent.click(screen.getByLabelText("Sedentary"));
    fireEvent.click(screen.getByLabelText("Lose Weight"));
    fireEvent.click(screen.getByLabelText("Calculate my goals"));
    expect(document.activeElement).toBe(screen.getByLabelText("Weight"));
  });

  it("Save with a cleared calorie target names it and focuses it", async () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age"), { target: { value: "30" } });
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

    const calories = await screen.findByLabelText("Daily calorie target");
    fireEvent.change(calories, { target: { value: "" } });
    mockNotification.mockClear();
    fireEvent.click(screen.getByLabelText("Save my goals"));

    expect(screen.getByText("Enter calories")).toBeTruthy();
    expect(document.activeElement).toBe(calories);
    expect(mockApiRequest).not.toHaveBeenCalledWith(
      "PUT",
      "/api/goals",
      expect.anything(),
    );
    expect(mockNotification).toHaveBeenCalledExactlyOnceWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });
});
