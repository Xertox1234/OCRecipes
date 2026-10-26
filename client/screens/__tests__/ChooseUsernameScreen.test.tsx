// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ChooseUsernameScreen from "../ChooseUsernameScreen";
import { ApiError } from "@/lib/api-error";
import * as Haptics from "expo-haptics";

const { withSequenceSpy } = vi.hoisted(() => ({
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
}));

// The InlineError shake runs one withSequence per validation reject.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

const { mockComplete, mockNavigate, mockToastError } = vi.hoisted(() => ({
  mockComplete: vi.fn(),
  mockNavigate: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ completeSocialSignUp: mockComplete }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError, success: vi.fn() }),
}));
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("div", props, children),
}));

function renderScreen() {
  const props = {
    route: {
      key: "k",
      name: "ChooseUsername",
      params: { ticket: "t", suggestedUsername: "apple_fan" },
    },
    navigation: { navigate: mockNavigate },
  } as unknown as React.ComponentProps<typeof ChooseUsernameScreen>;
  return renderComponent(<ChooseUsernameScreen {...props} />);
}

describe("ChooseUsernameScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the Terms and Privacy agreement before the account is created", () => {
    renderScreen();
    expect(screen.getByText(/By continuing, you agree to our/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Terms of Service" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeTruthy();
  });

  it("tells someone who already has an account to sign in and connect instead", () => {
    renderScreen();
    expect(
      screen.getByText(
        /Already have an OCRecipes account\? Sign in with your password instead, then add this sign-in under Settings → Sign-in methods\./,
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));
    expect(mockNavigate).toHaveBeenCalledWith("Login");
  });

  it("an email taken meanwhile sends them back to sign in, not 'username taken'", async () => {
    mockComplete.mockRejectedValue(new ApiError("raw", "EMAIL_IN_USE", 409));
    renderScreen();
    fireEvent.click(screen.getByRole("checkbox", { name: /13 years of age/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("Login"));
    expect(mockToastError).toHaveBeenCalledWith(
      expect.stringMatching(/already exists/),
      { haptic: false },
    );
    expect(screen.queryByText(/username is taken/i)).toBeNull();
  });
});

// A validation reject shakes the error (paired with the Error haptic it
// already fires); a server error shows copy and buzzes but does not shake.
describe("ChooseUsernameScreen — shake on validation reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("the same validation reject twice shakes twice", () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /13 years of age/ }));
    const cont = screen.getByRole("button", { name: "Continue" });

    fireEvent.click(cont);
    fireEvent.click(cont);

    expect(screen.getByText(/Username must be between/)).toBeTruthy();
    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("a server error buzzes but does not shake", async () => {
    mockComplete.mockRejectedValue(new ApiError("raw", "USERNAME_TAKEN", 409));
    renderScreen();
    fireEvent.click(screen.getByRole("checkbox", { name: /13 years of age/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(
      await screen.findByText("That username is taken — try another."),
    ).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});

const fieldLabels = () =>
  screen.getAllByTestId("focus-field-label").map((n) => n.textContent);

describe("ChooseUsernameScreen — floating labels", () => {
  it("floats Username with no repeated placeholder", () => {
    renderScreen();
    expect(fieldLabels()).toEqual(["Username"]);
    fireEvent.focus(screen.getByLabelText("Username"));
    expect(screen.queryByPlaceholderText("Username")).toBeNull();
  });
});

// Form-fields spec §5.1: no error while typing; check on leaving a field
// with text; an empty field is flagged (and focused) by Continue. The age
// checkbox keeps gating Continue — it's a legal confirmation, not a field.
describe("ChooseUsernameScreen — validation timing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows no error while a bad username is typed, and shows it on leaving", () => {
    renderScreen();
    const input = screen.getByLabelText("Username");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "me@x.com" } });
    expect(screen.queryByText(/can only contain letters/)).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText(/can only contain letters/)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("Continue with an empty username flags and focuses the field", () => {
    renderScreen();
    const input = screen.getByLabelText("Username");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /13 years of age/ }));
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(mockComplete).not.toHaveBeenCalled();
  });

  it("Continue stays disabled until the age box is ticked", () => {
    renderScreen();
    const cont = screen.getByRole("button", { name: "Continue" });
    expect(cont.getAttribute("aria-disabled")).toBe("true");
  });
});

// A checklist line on show: mounted AND not hidden from screen readers (a
// closed checklist keeps its lines mounted under a zero height).
function shownRule(label: string): HTMLElement | null {
  const el = screen.queryByLabelText(label);
  return el && !el.closest('[aria-hidden="true"]') ? el : null;
}

// Form-fields spec §5.2: the username rules tick as you type.
describe("ChooseUsernameScreen — rule checklist", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the rules on focus and ticks each as it is met", () => {
    renderScreen();
    const input = screen.getByLabelText("Username");
    expect(shownRule("3–30 characters")).toBeNull();
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "ab" } });
    expect(screen.getByLabelText("3–30 characters")).toBeTruthy();
    expect(screen.getByLabelText("Letters, numbers or _, done")).toBeTruthy();
    fireEvent.change(input, { target: { value: "ab-c" } });
    expect(screen.getByLabelText("3–30 characters, done")).toBeTruthy();
    expect(screen.getByLabelText("Letters, numbers or _")).toBeTruthy();
  });
});
