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

let mockCanSetMacros = true;
vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => mockCanSetMacros,
}));

const { mockPlanCheck } = vi.hoisted(() => ({
  mockPlanCheck: { planUnknown: false, recheckPlan: vi.fn() },
}));
vi.mock("@/hooks/usePlanCheck", () => ({
  usePlanCheck: () => mockPlanCheck,
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

// The consent hook and the confirm sheet are collaborators with their own
// suites; `consent.given` flips the "no consent, no health data" path.
const { consent, mockGrant, mockConfirm } = vi.hoisted(() => ({
  consent: { given: true },
  mockGrant: vi.fn(),
  mockConfirm: vi.fn(),
}));

vi.mock("@/hooks/useHealthConsent", () => ({
  useHealthConsent: () => ({
    consented: consent.given,
    grant: mockGrant,
    withdraw: vi.fn(),
  }),
}));

vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: mockConfirm,
    ConfirmationModal: () => null,
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

async function fillAndCalculate() {
  renderComponent(<GoalSetupScreen />);

  fireEvent.change(screen.getByLabelText("Age, years"), {
    target: { value: "30" },
  });
  fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
    target: { value: "70" },
  });
  fireEvent.change(screen.getByLabelText("Height, centimetres"), {
    target: { value: "170" },
  });
  fireEvent.click(screen.getByLabelText("Male"));
  fireEvent.click(screen.getByLabelText("Sedentary"));
  fireEvent.click(screen.getByLabelText("Lose Weight"));

  fireEvent.click(screen.getByLabelText("Calculate my goals"));
  return screen.findByLabelText("Save my goals");
}

async function fillCalculateAndSave() {
  const saveButton = await fillAndCalculate();
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

    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Height, centimetres"), {
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

    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Height, centimetres"), {
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
    const age = screen.getByLabelText("Age, years");

    fireEvent.change(age, { target: { value: "5" } });
    expect(screen.queryByText("Age must be 13–120")).toBeNull();

    fireEvent.blur(age);
    expect(screen.getByText("Age must be 13–120")).toBeTruthy();
    expect(mockNotification).toHaveBeenCalledExactlyOnceWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(screen.getByText(/^Still needed: /)).toBeTruthy();
  });

  // Spec §5.1: while a field shows an error it is re-checked every keystroke —
  // the error clears only once the value is valid.
  it("a shown age error stays (re-checked) while another invalid value is typed, and clears once valid", () => {
    renderComponent(<GoalSetupScreen />);
    const age = screen.getByLabelText("Age, years");
    fireEvent.change(age, { target: { value: "5" } });
    fireEvent.blur(age);
    expect(screen.getByText("Age must be 13–120")).toBeTruthy();
    mockNotification.mockClear();

    fireEvent.change(age, { target: { value: "500" } });
    expect(screen.getByText("Age must be 13–120")).toBeTruthy();
    // Keystrokes never buzz.
    expect(mockNotification).not.toHaveBeenCalled();

    fireEvent.change(age, { target: { value: "30" } });
    expect(screen.queryByText("Age must be 13–120")).toBeNull();
  });

  it("an age with no error shown stays quiet while an invalid value is typed", () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "5" },
    });
    expect(screen.queryByText("Age must be 13–120")).toBeNull();
  });

  // Spec §5.8 guard: the field's InlineError is the one announcement — the
  // input's hint never repeats the message.
  it("a refused field's message appears once in the a11y tree", () => {
    renderComponent(<GoalSetupScreen />);
    const age = screen.getByLabelText("Age, years");
    fireEvent.change(age, { target: { value: "5" } });
    fireEvent.blur(age);
    expect(screen.getAllByText("Age must be 13–120")).toHaveLength(1);
    expect(age.getAttribute("aria-hint") ?? "").not.toContain(
      "Age must be 13–120",
    );
  });

  it("refuses to calculate with an out-of-range field and says why", () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText("Height, centimetres"), {
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

  // Privacy audit H2: body measurements are health data.
  describe("without the health-data consent", () => {
    beforeEach(() => {
      consent.given = false;
      mockGrant.mockReset().mockResolvedValue(undefined);
      mockConfirm.mockReset();
      mockApiRequest.mockClear();
    });
    afterEach(() => {
      consent.given = true;
    });

    function fillAndPressCalculate() {
      renderComponent(<GoalSetupScreen />);
      fireEvent.change(screen.getByLabelText("Age, years"), {
        target: { value: "30" },
      });
      fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
        target: { value: "70" },
      });
      fireEvent.change(screen.getByLabelText("Height, centimetres"), {
        target: { value: "170" },
      });
      fireEvent.click(screen.getByLabelText("Male"));
      fireEvent.click(screen.getByLabelText("Sedentary"));
      fireEvent.click(screen.getByLabelText("Lose Weight"));
      fireEvent.click(screen.getByLabelText("Calculate my goals"));
    }

    it("Calculate asks for the consent and sends nothing until it is given", () => {
      fillAndPressCalculate();

      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockConfirm.mock.calls[0][0]).toEqual(
        expect.objectContaining({ confirmLabel: "Agree" }),
      );
      expect(mockGrant).not.toHaveBeenCalled();
      expect(mockApiRequest).not.toHaveBeenCalledWith(
        "POST",
        "/api/goals/calculate",
        expect.anything(),
      );
    });

    it("agreeing records the consent, then calculates", async () => {
      fillAndPressCalculate();

      mockConfirm.mock.calls[0][0].onConfirm();

      await waitFor(() => {
        expect(mockApiRequest).toHaveBeenCalledWith(
          "POST",
          "/api/goals/calculate",
          expect.objectContaining({ age: 30 }),
        );
      });
      expect(mockGrant).toHaveBeenCalledTimes(1);
    });

    it("does not calculate when recording the consent fails", async () => {
      mockGrant.mockRejectedValue(new Error("offline"));
      fillAndPressCalculate();

      mockConfirm.mock.calls[0][0].onConfirm();

      await waitFor(() => expect(mockGrant).toHaveBeenCalledTimes(1));
      expect(mockApiRequest).not.toHaveBeenCalledWith(
        "POST",
        "/api/goals/calculate",
        expect.anything(),
      );
    });
  });

  it("sends a comma-decimal weight as the number typed", async () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
      target: { value: "70,5" },
    });
    fireEvent.change(screen.getByLabelText("Height, centimetres"), {
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
    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Height, centimetres"), {
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

    expect(screen.getByText("Calories must be 800–10000")).toBeTruthy();
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

    expect(document.activeElement).toBe(screen.getByLabelText("Age, years"));
    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(screen.getByText(/^Still needed: /)).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("focuses the first missing number field, skipping filled ones", () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "30" },
    });
    fireEvent.click(screen.getByLabelText("Calculate my goals"));
    expect(document.activeElement).toBe(
      screen.getByLabelText("Weight, kilograms"),
    );
  });

  it("with only a choice missing, refuses with the error haptic", () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Height, centimetres"), {
      target: { value: "170" },
    });
    fireEvent.click(screen.getByLabelText("Male"));
    fireEvent.click(screen.getByLabelText("Sedentary"));

    fireEvent.click(screen.getByLabelText("Calculate my goals"));

    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(screen.getByText("Still needed: primary goal")).toBeTruthy();
    expect(mockApiRequest).not.toHaveBeenCalled();
  });

  it("an out-of-range weight on Calculate moves focus to Weight", () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText("Height, centimetres"), {
      target: { value: "170" },
    });
    fireEvent.click(screen.getByLabelText("Male"));
    fireEvent.click(screen.getByLabelText("Sedentary"));
    fireEvent.click(screen.getByLabelText("Lose Weight"));
    fireEvent.click(screen.getByLabelText("Calculate my goals"));
    expect(document.activeElement).toBe(
      screen.getByLabelText("Weight, kilograms"),
    );
  });

  it("Save with a cleared calorie target names it and focuses it", async () => {
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Height, centimetres"), {
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

// Controller ruling (fix round 1): with only a choice missing, nothing on
// screen changes on Calculate, so a screen-reader user hears the "Still
// needed" line — once per press.
describe("GoalSetupScreen — Calculate with only a choice missing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("announces what's still needed once per press", async () => {
    const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    renderComponent(<GoalSetupScreen />);
    fireEvent.change(screen.getByLabelText("Age, years"), {
      target: { value: "30" },
    });
    fireEvent.change(screen.getByLabelText("Weight, kilograms"), {
      target: { value: "70" },
    });
    fireEvent.change(screen.getByLabelText("Height, centimetres"), {
      target: { value: "170" },
    });
    fireEvent.click(screen.getByLabelText("Male"));
    fireEvent.click(screen.getByLabelText("Sedentary"));
    announce.mockClear();

    fireEvent.click(screen.getByLabelText("Calculate my goals"));
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(1));
    expect(announce).toHaveBeenCalledWith("Still needed: primary goal");

    fireEvent.click(screen.getByLabelText("Calculate my goals"));
    await waitFor(() => expect(announce).toHaveBeenCalledTimes(2));
    expect(mockApiRequest).not.toHaveBeenCalled();
    announce.mockRestore();
  });

  it("does not announce when a number field takes focus instead", async () => {
    const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    renderComponent(<GoalSetupScreen />);
    announce.mockClear();
    fireEvent.click(screen.getByLabelText("Calculate my goals"));
    await new Promise((r) => setTimeout(r, 5));
    expect(announce).not.toHaveBeenCalledWith(
      expect.stringMatching(/^Still needed/),
    );
    announce.mockRestore();
  });
});

describe("GoalSetupScreen — macro targets while the plan is unknown", () => {
  const PREMIUM_NOTE =
    "Editing protein, carb and fat targets requires Premium.";

  afterEach(() => {
    mockCanSetMacros = true;
    mockPlanCheck.planUnknown = false;
  });

  it("a known free user sees the premium note and the Premium-required labels", async () => {
    mockCanSetMacros = false;
    await fillAndCalculate();
    expect(screen.getByText(PREMIUM_NOTE)).toBeTruthy();
    expect(
      screen.getByLabelText("Daily protein target (Premium required)"),
    ).toBeTruthy();
  });

  it("an unknown plan shows no premium note and no Premium-required labels", async () => {
    // Unknown status falls back to free-tier features (owner ruling 2026-11-02).
    mockCanSetMacros = false;
    mockPlanCheck.planUnknown = true;
    await fillAndCalculate();
    expect(screen.queryByText(PREMIUM_NOTE)).toBeNull();
    expect(screen.getByLabelText("Daily protein target")).toBeTruthy();
    expect(
      screen.queryByLabelText("Daily protein target (Premium required)"),
    ).toBeNull();
  });
});

// Android TalkBack device check 2026-11-07: the unit ("years", "kg", "cm")
// was its own focus stop after an input labelled only "Age", and the visible
// title above it a third stop repeating the label. Same convention as the
// receipt quantity box: the unit is named in the input's label, and the unit
// and title text are hidden so nothing is read twice.
describe("GoalSetupScreen — number fields name their unit", () => {
  it.each([
    ["Age", "years", "years"],
    ["Weight", "kg", "kilograms"],
    ["Height", "cm", "centimetres"],
  ])(
    "%s field is labelled with its unit (%s); unit and title text hidden",
    (label, unit, spoken) => {
      renderComponent(<GoalSetupScreen />);
      const input = screen.getByLabelText(`${label}, ${spoken}`);
      expect(input.tagName).toBe("INPUT");
      const unitText = screen.getByText(unit, { exact: true });
      expect(unitText.closest('[aria-hidden="true"]')).not.toBeNull();
      const title = screen.getByText(label, { exact: true });
      expect(title.closest('[aria-hidden="true"]')).not.toBeNull();
    },
  );
});
