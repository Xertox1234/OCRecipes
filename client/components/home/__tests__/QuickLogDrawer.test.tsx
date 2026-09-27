// @vitest-environment jsdom
import React, { useState } from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { QuickLogDrawer } from "../QuickLogDrawer";
import { HomeInlineDrawer } from "../HomeInlineDrawer";
import * as useQuickLogSessionModule from "@/hooks/useQuickLogSession";

// Spy on the REAL HomeInlineDrawer (not a stub) so every existing behavioral
// assertion below still exercises the actual header/chevron/measure shell —
// this only lets the composition test confirm QuickLogDrawer renders it.
vi.mock("../HomeInlineDrawer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../HomeInlineDrawer")>();
  return {
    ...actual,
    HomeInlineDrawer: vi.fn(actual.HomeInlineDrawer),
  };
});

const { mockToastError, mockToastInfo, mockNavigate, mockKeyboardDismiss } =
  vi.hoisted(() => ({
    mockToastError: vi.fn(),
    mockToastInfo: vi.fn(),
    mockNavigate: vi.fn(),
    mockKeyboardDismiss: vi.fn(),
  }));

// The shared react-native mock has no Keyboard; the submit button dismisses it.
vi.mock("react-native", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Keyboard: { dismiss: mockKeyboardDismiss },
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
  parseEmpty: false,
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

// The real module pulls in Expo native setup, so its exported message is
// re-declared here; the tests assert the drawer shows it on parseEmpty.
vi.mock("@/hooks/useQuickLogSession", () => ({
  useQuickLogSession: vi.fn(() => mockSession),
  EMPTY_PARSE_MESSAGE: "Couldn't find any food in that.",
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
  useToast: () => ({
    success: vi.fn(),
    error: mockToastError,
    info: mockToastInfo,
  }),
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

// HomeScreen owns isOpen (so it can lock the row and glide it into view).
// This harness stands in for Home's toggle so the behavioral tests below
// exercise a real open/close cycle.
function Harness(props: { onResultsShown?: () => void; isLocked?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <QuickLogDrawer
      action={testAction}
      isOpen={isOpen}
      onToggle={() => setIsOpen((open) => !open)}
      onClose={() => setIsOpen(false)}
      {...props}
    />
  );
}

const openDrawer = () =>
  fireEvent.click(screen.getByRole("button", { name: /^quick log$/i }));

const eggItem = {
  name: "egg",
  quantity: 1,
  unit: "large",
  calories: 72,
  protein: 6,
  carbs: 0,
  fat: 5,
  servingSize: null,
};

describe("QuickLogDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue(
      mockSession,
    );
  });

  it("renders collapsed by default — drawer body not visible", () => {
    renderComponent(<Harness />);
    expect(screen.getByRole("button", { name: /^quick log$/i })).toBeTruthy();
    // Input is always mounted but hidden via aria-hidden when collapsed
    const input = screen.queryByPlaceholderText(/what did you eat/i);
    if (input) {
      // If the element exists, it must be inside an aria-hidden container
      expect(input.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it("shows input and chips after tapping header", () => {
    renderComponent(<Harness />);
    openDrawer();
    expect(screen.getByPlaceholderText(/what did you eat/i)).toBeTruthy();
    expect(screen.getByText("Coffee")).toBeTruthy();
    expect(screen.getByText("Eggs")).toBeTruthy();
  });

  it("calls session.reset when collapsing after open", () => {
    renderComponent(<Harness />);
    const header = screen.getByRole("button", { name: /^quick log$/i });
    fireEvent.click(header); // open
    fireEvent.click(header); // close
    expect(mockSession.reset).toHaveBeenCalledTimes(1);
  });

  it("is controlled: the header calls onToggle and does not open itself", () => {
    const onToggle = vi.fn();
    renderComponent(
      <QuickLogDrawer
        action={testAction}
        isOpen={false}
        onToggle={onToggle}
        onClose={vi.fn()}
      />,
    );
    openDrawer();
    expect(onToggle).toHaveBeenCalledTimes(1);
    const input = screen.getByPlaceholderText(/what did you eat/i);
    expect(input.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it("resets the session when the parent closes it (e.g. another drawer opened)", () => {
    const props = { action: testAction, onToggle: vi.fn(), onClose: vi.fn() };
    const { rerender } = renderComponent(
      <QuickLogDrawer {...props} isOpen={true} />,
    );
    expect(mockSession.reset).not.toHaveBeenCalled();
    rerender(<QuickLogDrawer {...props} isOpen={false} />);
    expect(mockSession.reset).toHaveBeenCalledTimes(1);
  });

  it("passes isLocked through to the shell", () => {
    renderComponent(<Harness isLocked />);
    const props = vi.mocked(HomeInlineDrawer).mock.calls.at(-1)![0];
    expect(props.isLocked).toBe(true);
  });

  // The lock icon is accessible={false}, so without this VoiceOver reads a
  // plain "Quick Log" that opens an upgrade prompt. Wording matches
  // PhotoIntentScreen's locked options.
  it("announces a locked row as a premium feature", () => {
    renderComponent(<Harness isLocked />);
    expect(
      screen.getByRole("button", { name: "Quick Log, premium feature" }),
    ).toBeTruthy();
  });

  it("announces an unlocked row by its label alone", () => {
    renderComponent(<Harness />);
    expect(screen.getByRole("button", { name: "Quick Log" })).toBeTruthy();
  });

  it("uses a return key that reads as submitting, not search", () => {
    renderComponent(<Harness />);
    openDrawer();
    const input = screen.getByPlaceholderText(/what did you eat/i);
    expect(input.getAttribute("returnKeyType")).toBe("done");
  });

  describe("submit button", () => {
    const submitButton = () =>
      screen.getByRole("button", { name: /^find food$/i });

    it("is disabled while the input is empty", () => {
      renderComponent(<Harness />);
      openDrawer();
      expect(submitButton().hasAttribute("disabled")).toBe(true);
    });

    it("is disabled for whitespace-only input", () => {
      vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
        ...mockSession,
        inputText: "   ",
      });
      renderComponent(<Harness />);
      openDrawer();
      expect(submitButton().hasAttribute("disabled")).toBe(true);
    });

    it("submits and dismisses the keyboard when there is text", () => {
      vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
        ...mockSession,
        inputText: "2 eggs and toast",
      });
      renderComponent(<Harness />);
      openDrawer();
      expect(submitButton().hasAttribute("disabled")).toBe(false);
      fireEvent.click(submitButton());
      expect(mockSession.handleTextSubmit).toHaveBeenCalledTimes(1);
      expect(mockKeyboardDismiss).toHaveBeenCalledTimes(1);
    });

    it("is disabled and shows a busy indicator while parsing", () => {
      vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
        ...mockSession,
        inputText: "2 eggs and toast",
        isParsing: true,
      });
      renderComponent(<Harness />);
      openDrawer();
      expect(submitButton().hasAttribute("disabled")).toBe(true);
      expect(submitButton().getAttribute("aria-busy")).toBe("true");
      expect(screen.getByRole("progressbar")).toBeTruthy();
    });

    it("shows no busy indicator when idle", () => {
      vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
        ...mockSession,
        inputText: "2 eggs and toast",
      });
      renderComponent(<Harness />);
      openDrawer();
      expect(submitButton().getAttribute("aria-busy")).toBe("false");
      expect(screen.queryByRole("progressbar")).toBeNull();
    });
  });

  it("shows a no-food message after an empty parse", () => {
    vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
      ...mockSession,
      parseEmpty: true,
    });
    renderComponent(<Harness />);
    openDrawer();
    expect(screen.getByText(/couldn.t find any food in that/i)).toBeTruthy();
  });

  it("shows no no-food message otherwise", () => {
    renderComponent(<Harness />);
    openDrawer();
    expect(screen.queryByText(/couldn.t find any food in that/i)).toBeNull();
  });

  describe("onResultsShown", () => {
    it("fires once when parsed items first appear, not on re-render", () => {
      const onResultsShown = vi.fn();
      const props = {
        action: testAction,
        isOpen: true,
        onToggle: vi.fn(),
        onClose: vi.fn(),
        onResultsShown,
      };
      const { rerender } = renderComponent(<QuickLogDrawer {...props} />);
      expect(onResultsShown).not.toHaveBeenCalled();

      vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
        ...mockSession,
        parsedItems: [eggItem],
      });
      rerender(<QuickLogDrawer {...props} />);
      expect(onResultsShown).toHaveBeenCalledTimes(1);

      rerender(<QuickLogDrawer {...props} />);
      expect(onResultsShown).toHaveBeenCalledTimes(1);
    });

    it("fires again for the next parse after the list was cleared", () => {
      const onResultsShown = vi.fn();
      const props = {
        action: testAction,
        isOpen: true,
        onToggle: vi.fn(),
        onClose: vi.fn(),
        onResultsShown,
      };
      const session = vi.mocked(useQuickLogSessionModule.useQuickLogSession);
      session.mockReturnValue({ ...mockSession, parsedItems: [eggItem] });
      const { rerender } = renderComponent(<QuickLogDrawer {...props} />);
      expect(onResultsShown).toHaveBeenCalledTimes(1);

      session.mockReturnValue(mockSession);
      rerender(<QuickLogDrawer {...props} />);
      session.mockReturnValue({ ...mockSession, parsedItems: [eggItem] });
      rerender(<QuickLogDrawer {...props} />);
      expect(onResultsShown).toHaveBeenCalledTimes(2);
    });
  });

  it("closes through the parent after a successful log", () => {
    const onClose = vi.fn();
    renderComponent(
      <QuickLogDrawer
        action={testAction}
        isOpen={true}
        onToggle={vi.fn()}
        onClose={onClose}
      />,
    );
    const { onLogSuccess } = vi
      .mocked(useQuickLogSessionModule.useQuickLogSession)
      .mock.calls.at(-1)![0]!;
    onLogSuccess!({ itemCount: 1, totalCalories: 72, firstName: "egg" });
    expect(onClose).toHaveBeenCalledTimes(1);
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

    renderComponent(<Harness />);
    openDrawer();

    expect(screen.getByText(/chicken/i)).toBeTruthy();
    expect(screen.getByText("320 cal")).toBeTruthy();
    expect(screen.getByRole("button", { name: /log all/i })).toBeTruthy();
  });

  it("calls toast.error when speechError is set", () => {
    vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
      ...mockSession,
      speechError: "Microphone permission denied",
    });

    renderComponent(<Harness />);

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

    renderComponent(<Harness />);
    openDrawer();

    expect(
      screen.getByText("Failed to log some items. Please try again."),
    ).toBeTruthy();
  });

  it("camera button press navigates to Scan with returnAfterLog: true", () => {
    renderComponent(<Harness />);
    openDrawer();
    fireEvent.click(
      screen.getByRole("button", { name: /open camera to scan food/i }),
    );

    expect(mockNavigate).toHaveBeenCalledWith("Scan", { returnAfterLog: true });
  });

  it("calls toast.info when capWarning is set", () => {
    vi.mocked(useQuickLogSessionModule.useQuickLogSession).mockReturnValue({
      ...mockSession,
      capWarning:
        "Only the first 10 items were logged. Please log the rest separately.",
    });

    renderComponent(<Harness />);

    expect(mockToastInfo).toHaveBeenCalledWith(
      "Only the first 10 items were logged. Please log the rest separately.",
    );
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

    renderComponent(<Harness />);
    openDrawer();

    // "Log All" text should not be visible
    expect(screen.queryByText("Log All")).toBeNull();
    // ActivityIndicator renders as a View in the test environment — verify
    // the button itself is still present (busy state) and Log All text is gone
    expect(screen.getByRole("button", { name: /log all items/i })).toBeTruthy();
  });

  it("composes HomeInlineDrawer for its header/chevron shell instead of reimplementing it", () => {
    renderComponent(<Harness />);

    expect(HomeInlineDrawer).toHaveBeenCalled();
    const props = vi.mocked(HomeInlineDrawer).mock.calls[0][0];
    expect(props.icon).toBe(testAction.icon);
    expect(props.label).toBe(testAction.label);
    // QuickLogDrawer must NOT clamp its own height — its parsed-items list is
    // unbounded before submit (MAX_LOG_ITEMS only caps at submit time), unlike
    // its siblings' structurally-bounded content. Passing a maxHeight here
    // would silently clip the list and the Log All button on small devices.
    expect(props.maxHeight).toBeUndefined();
    expect(typeof props.onToggle).toBe("function");
  });
});
