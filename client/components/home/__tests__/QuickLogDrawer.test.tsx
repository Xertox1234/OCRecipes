// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { QuickLogDrawer } from "../QuickLogDrawer";
import * as useQuickLogSessionModule from "@/hooks/useQuickLogSession";

const { mockToastError, mockNavigate } = vi.hoisted(() => ({
  mockToastError: vi.fn(),
  mockNavigate: vi.fn(),
}));

const mockSession = {
  inputText: "",
  setInputText: vi.fn(),
  isListening: false,
  volume: -2,
  isParsing: false,
  parsedItems: [],
  frequentItems: [{ productName: "Coffee" }, { productName: "Eggs" }],
  parseError: null,
  submitError: null,
  capWarning: null,
  isSubmitting: false,
  speechError: null,
  handleTextSubmit: vi.fn(),
  handleVoicePress: vi.fn(),
  removeItem: vi.fn(),
  handleChipPress: vi.fn(),
  submitLog: vi.fn(),
  reset: vi.fn(),
};

vi.mock("@/hooks/useQuickLogSession", () => ({
  useQuickLogSession: vi.fn(() => mockSession),
}));

vi.mock("@/hooks/useTheme", () => ({
  useTheme: () => ({
    theme: {
      text: "#000",
      textSecondary: "#666",
      backgroundRoot: "#fff",
      backgroundSecondary: "#f5f5f5",
      border: "#e0e0e0",
      link: "#007AFF",
      buttonText: "#fff",
      error: "#ff3b30",
    },
  }),
}));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => ({ reducedMotion: false }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ impact: vi.fn(), notification: vi.fn() }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: mockToastError, info: vi.fn() }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const testAction = {
  id: "quick-log",
  group: "nutrition" as const,
  icon: "edit-3",
  label: "Quick Log",
  renderInline: true,
};

describe("QuickLogDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue(
      mockSession,
    );
  });

  it("renders collapsed by default — drawer body not visible", () => {
    renderComponent(<QuickLogDrawer action={testAction} />);
    expect(screen.getByRole("button", { name: /quick log/i })).toBeTruthy();
    // Input is always mounted but hidden via aria-hidden when collapsed
    const input = screen.queryByPlaceholderText(/what did you eat/i);
    if (input) {
      // If the element exists, it must be inside an aria-hidden container
      expect(input.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("shows input and chips after tapping header", () => {
    renderComponent(<QuickLogDrawer action={testAction} />);
    fireEvent.click(screen.getByRole("button", { name: /quick log/i }));
    expect(screen.getByPlaceholderText(/what did you eat/i)).toBeTruthy();
    expect(screen.getByText("Coffee")).toBeTruthy();
    expect(screen.getByText("Eggs")).toBeTruthy();
  });

  it("calls session.reset when collapsing after open", () => {
    renderComponent(<QuickLogDrawer action={testAction} />);
    const header = screen.getByRole("button", { name: /quick log/i });
    fireEvent.click(header); // open
    fireEvent.click(header); // close
    expect(mockSession.reset).toHaveBeenCalledTimes(1);
  });

  it("shows parsed items and Log All when parsedItems is non-empty", () => {
    vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
      ...mockSession,
      parsedItems: [
        {
          name: "chicken",
          quantity: 1,
          unit: "breast",
          calories: 320,
          protein: 58,
          carbs: 0,
          fat: 7,
          servingSize: null,
        },
      ],
    });

    renderComponent(<QuickLogDrawer action={testAction} />);
    fireEvent.click(screen.getByRole("button", { name: /quick log/i }));

    expect(screen.getByText(/chicken/i)).toBeTruthy();
    expect(screen.getByText("320 cal")).toBeTruthy();
    expect(screen.getByRole("button", { name: /log all/i })).toBeTruthy();
  });

  it("calls toast.error when speechError is set", () => {
    vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
      ...mockSession,
      speechError: "Microphone permission denied",
    });

    renderComponent(<QuickLogDrawer action={testAction} />);

    expect(mockToastError).toHaveBeenCalledWith("Microphone permission denied");
  });

  it("renders submitError text when submitError is set", () => {
    vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
      ...mockSession,
      parsedItems: [
        {
          name: "egg",
          quantity: 1,
          unit: "large",
          calories: 72,
          protein: 6,
          carbs: 0,
          fat: 5,
          servingSize: null,
        },
      ],
      submitError: "Failed to log some items. Please try again.",
    });

    renderComponent(<QuickLogDrawer action={testAction} />);
    fireEvent.click(screen.getByRole("button", { name: /quick log/i }));

    expect(
      screen.getByText("Failed to log some items. Please try again."),
    ).toBeTruthy();
  });

  it("camera button press navigates to Scan with returnAfterLog: true", () => {
    renderComponent(<QuickLogDrawer action={testAction} />);
    fireEvent.click(screen.getByRole("button", { name: /quick log/i }));
    fireEvent.click(
      screen.getByRole("button", { name: /open camera to scan food/i }),
    );

    expect(mockNavigate).toHaveBeenCalledWith("Scan", { returnAfterLog: true });
  });

  it("renders ActivityIndicator instead of Log All text when isSubmitting", () => {
    vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
      ...mockSession,
      parsedItems: [
        {
          name: "banana",
          quantity: 1,
          unit: "medium",
          calories: 105,
          protein: 1,
          carbs: 27,
          fat: 0,
          servingSize: null,
        },
      ],
      isSubmitting: true,
    });

    renderComponent(<QuickLogDrawer action={testAction} />);
    fireEvent.click(screen.getByRole("button", { name: /quick log/i }));

    // "Log All" text should not be visible
    expect(screen.queryByText("Log All")).toBeNull();
    // ActivityIndicator renders as a View in the test environment — verify
    // the button itself is still present (busy state) and Log All text is gone
    expect(screen.getByRole("button", { name: /log all items/i })).toBeTruthy();
  });
});
