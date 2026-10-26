// @vitest-environment jsdom
/**
 * H6 (2026-06-03 full audit): on an auth failure LoginScreen must show static,
 * mode-specific copy — never the raw `err.message` from the thrown error
 * (the `no-error-message-in-ui` rule's behavioral counterpart: avoids leaking
 * backend internals and username enumeration). See docs/rules/client-state.md.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { reactProps } from "../../../test/utils/react-props";
import LoginScreen from "../LoginScreen";
import * as Haptics from "expo-haptics";
import { ApiError } from "@/lib/api-error";
import { FocusField } from "@/components/FocusField";
import { shouldFloatLabel } from "@/components/text-input-utils";

// Spy on FocusField so the floating-label tests can read each field's state.
vi.mock("@/components/FocusField", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/components/FocusField")>();
  return { FocusField: vi.fn(actual.FocusField) };
});

const { withSequenceSpy } = vi.hoisted(() => ({
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
}));

// The InlineError shake runs one withSequence per validation reject.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

const {
  mockLogin,
  mockRegister,
  mockNavigate,
  mockSetParams,
  mockToastSuccess,
  mockRoute,
} = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockRegister: vi.fn(),
  mockNavigate: vi.fn(),
  mockSetParams: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockRoute: {
    params: undefined as
      | { email?: string; passwordReset?: boolean }
      | undefined,
  },
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ login: mockLogin, register: mockRegister }),
}));

// render-component provides no NavigationContainer; LoginScreen now calls
// useNavigation, so stub it with a spy we can assert against.
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    setParams: mockSetParams,
  }),
  useRoute: () => ({ params: mockRoute.params }),
  useIsFocused: () => mockFocus.isFocused,
}));

const mockFocus = vi.hoisted(() => ({ isFocused: true }));

// Render the requested status-bar style as a marker so the test can read it.
vi.mock("expo-status-bar", () => ({
  StatusBar: ({ style }: { style: string }) => (
    <div data-testid="status-bar" data-style={style} />
  ),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: mockToastSuccess }),
}));

// react-native-keyboard-controller ships untransformed native source — passthrough.
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("div", props, children),
}));

describe("LoginScreen — auth-failure error copy (H6)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows static login copy (not err.message) when login rejects", async () => {
    mockLogin.mockRejectedValue(
      new Error("401: invalid_credentials from server"),
    );
    renderComponent(<LoginScreen />);

    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "demo" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrongpass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    expect(
      await screen.findByText(
        "Incorrect username or password. Please try again.",
      ),
    ).toBeTruthy();
    // The raw thrown message must never reach the UI.
    expect(screen.queryByText(/invalid_credentials/)).toBeNull();
    expect(screen.queryByText(/401/)).toBeNull();
  });

  it("shows static registration copy (not err.message) when register rejects", async () => {
    mockRegister.mockRejectedValue(
      new Error("409: username_taken from server"),
    );
    renderComponent(<LoginScreen />);

    // Switch to register mode.
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "demo" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "secret-passphrase-1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "secret-passphrase-1" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "demo@example.com" },
    });
    fireEvent.click(
      screen.getByLabelText("I confirm I am 13 years of age or older"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    expect(
      await screen.findByText("Registration failed. Please try again."),
    ).toBeTruthy();
    expect(screen.queryByText(/username_taken/)).toBeNull();
  });
});

describe("LoginScreen — client-side validation pre-flight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression: a user typing their email into the "Username" field used to send
  // a request the server rejected (400), surfaced only as a generic
  // "Registration failed." Now it is caught client-side with actionable copy and
  // never hits the network (so it can't burn the 5/hour register rate limit).
  it("blocks an email-address username before any network call", async () => {
    renderComponent(<LoginScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "william.tower@gmail.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "recipe-passphrase-1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "recipe-passphrase-1" },
    });
    fireEvent.click(
      screen.getByLabelText("I confirm I am 13 years of age or older"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    expect(
      await screen.findByText(/letters, numbers, and underscores/i),
    ).toBeTruthy();
    expect(mockRegister).not.toHaveBeenCalled();
  });
});

describe("LoginScreen — email field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the email field only in register mode", () => {
    renderComponent(<LoginScreen />);
    // Login mode: no email field.
    expect(screen.queryByLabelText("Email")).toBeNull();
    // Switch to register mode.
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    expect(screen.getByLabelText("Email")).toBeTruthy();
  });

  it("threads the entered email and live ageConfirmed into register", async () => {
    // Fail-open auto-login shape (register returns a token → authenticated).
    mockRegister.mockResolvedValue({
      status: "authenticated",
      user: { id: "1", username: "chef_tony" },
    });
    renderComponent(<LoginScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "chef_tony" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "chef@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "recipe-passphrase-1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "recipe-passphrase-1" },
    });
    fireEvent.click(
      screen.getByLabelText("I confirm I am 13 years of age or older"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    // Verifies email threading AND that ageConfirmed is the live checkbox
    // value (true), never a hardcoded literal.
    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith(
        "chef_tony",
        "recipe-passphrase-1",
        "chef@example.com",
        true,
      ),
    );
  });

  it("sign-up takes 8+ characters with no two-step switch (owner ruling 2026-10-12)", async () => {
    mockRegister.mockResolvedValue({ status: "verification_pending" });
    renderComponent(<LoginScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    fireEvent.focus(screen.getByLabelText("Password"));
    expect(screen.getByText("At least 8 characters")).toBeTruthy();
    expect(screen.queryByTestId("switch-two-step")).toBeNull();
    expect(screen.queryByText(/two-step/i)).toBeNull();

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "newchef" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "ten-chars!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "ten-chars!" },
    });
    fireEvent.click(
      screen.getByLabelText("I confirm I am 13 years of age or older"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
    await waitFor(() =>
      expect(mockRegister).toHaveBeenCalledWith(
        "newchef",
        "ten-chars!",
        "new@example.com",
        true,
      ),
    );
  });

  it("navigates to VerifyEmail after a verification-pending registration", async () => {
    mockRegister.mockResolvedValue({ status: "verification_pending" });
    renderComponent(<LoginScreen />);

    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "newchef" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "recipe-passphrase-1" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "recipe-passphrase-1" },
    });
    fireEvent.click(
      screen.getByLabelText("I confirm I am 13 years of age or older"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("VerifyEmail", {
        email: "new@example.com",
        // Register triggers a server-side send, so the explicit sent flag is set.
        sent: true,
      }),
    );
  });

  // AC: the email input is marked invalid ONLY when the email field itself is
  // the failure — not when a different field (e.g. mismatched passwords) fails.
  // The field carries aria-invalid; its message is the InlineError's alone
  // (the hint stays plain), so we assert on both.
  it("marks the email input invalid only when the email itself is invalid", async () => {
    renderComponent(<LoginScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));

    const fillExcept = (email: string, confirm: string) => {
      fireEvent.change(screen.getByLabelText("Username"), {
        target: { value: "chef_tony" },
      });
      fireEvent.change(screen.getByLabelText("Email"), {
        target: { value: email },
      });
      fireEvent.change(screen.getByLabelText("Password"), {
        target: { value: "recipe-passphrase-1" },
      });
      fireEvent.change(screen.getByLabelText("Confirm password"), {
        target: { value: confirm },
      });
      fireEvent.click(
        screen.getByLabelText("I confirm I am 13 years of age or older"),
      );
    };

    // A non-email failure (mismatched passwords) must NOT mark email invalid.
    fillExcept("chef@example.com", "recipe-passphrase-2");
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
    await screen.findByText("Passwords do not match");
    expect(
      screen.getByLabelText("Email").getAttribute("aria-invalid"),
    ).toBeNull();
    expect(screen.getByLabelText("Email").getAttribute("aria-hint")).toBe(
      "Enter your email address",
    );

    // A bad email DOES mark the email input invalid. Its message is read by
    // the InlineError, not merged into the hint (spec §5.8: once, not twice).
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "recipe-passphrase-1" },
    });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));
    await waitFor(() =>
      expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe(
        "true",
      ),
    );
    expect(screen.getByLabelText("Email").getAttribute("aria-hint")).toBe(
      "Enter your email address",
    );
    expect(
      screen.getAllByText("Please enter a valid email address"),
    ).toHaveLength(1);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("navigates to VerifyEmail when login returns EMAIL_NOT_VERIFIED", async () => {
    mockLogin.mockRejectedValue(
      new ApiError("403: email not verified", "EMAIL_NOT_VERIFIED"),
    );
    renderComponent(<LoginScreen />);

    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "demo" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "recipe-passphrase-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("VerifyEmail", {}),
    );
  });
});

describe("LoginScreen — sign in by email and password reset entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.params = undefined;
  });

  it("labels the identifier 'Username or email' in login mode and 'Username' in sign-up mode", () => {
    renderComponent(<LoginScreen />);
    expect(screen.getByLabelText("Username or email")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    expect(screen.getByLabelText("Username")).toBeTruthy();
    expect(screen.queryByLabelText("Username or email")).toBeNull();
  });

  it("shows Forgot password? in login mode only and navigates with an email-shaped identifier", () => {
    renderComponent(<LoginScreen />);
    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: " a@b.com " },
    });
    fireEvent.click(screen.getByText("Forgot password?"));
    expect(mockNavigate).toHaveBeenCalledWith("ForgotPassword", {
      email: "a@b.com",
    });
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    expect(screen.queryByText("Forgot password?")).toBeNull();
  });

  it("does not forward a plain username as the reset email", () => {
    renderComponent(<LoginScreen />);
    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "alice" },
    });
    fireEvent.click(screen.getByText("Forgot password?"));
    expect(mockNavigate).toHaveBeenCalledWith("ForgotPassword", undefined);
  });

  it("after a reset: prefills the email, toasts once, and consumes the flag", () => {
    mockRoute.params = { email: "a@b.com", passwordReset: true };
    renderComponent(<LoginScreen />);
    expect(
      (screen.getByLabelText("Username or email") as HTMLInputElement).value,
    ).toBe("a@b.com");
    expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).toHaveBeenCalledWith(
      "Password updated. Sign in with your new password.",
    );
    expect(mockSetParams).toHaveBeenCalledWith({ passwordReset: undefined });
  });
});

// A validation reject shakes the error (paired with the Error haptic it
// already fires); a server error shows copy and buzzes but does not shake.
describe("LoginScreen — shake on validation reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("the same validation reject twice shakes twice", () => {
    renderComponent(<LoginScreen />);
    // One invalid field, so one message shakes per press.
    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "demo" },
    });
    const signIn = screen.getByRole("button", { name: "Sign In" });

    fireEvent.click(signIn);
    fireEvent.click(signIn);

    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("a server error buzzes but does not shake", async () => {
    mockLogin.mockRejectedValue(new Error("401: invalid_credentials"));
    renderComponent(<LoginScreen />);
    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "demo" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrongpass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    expect(
      await screen.findByText(
        "Incorrect username or password. Please try again.",
      ),
    ).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});

describe("LoginScreen — two-step verification", () => {
  beforeEach(() => vi.clearAllMocks());

  it("a password sign-in that needs a code opens the code screen with the challenge", async () => {
    mockLogin.mockResolvedValue({ status: "mfa_required", challenge: "c-9" });
    renderComponent(<LoginScreen />);
    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "demo" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "demo123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("TwoStepCode", {
        challenge: "c-9",
        purpose: "login",
      }),
    );
  });
});

// #45: a failed sign-in left the wrong password in the field, so leaving the
// screen made iOS offer to save it. (The prompt itself needs iCloud Keychain,
// which the simulator lacks — this pins the clear that prevents it.)
describe("LoginScreen — failed sign-in clears the password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("empties the password field after wrong credentials", async () => {
    mockLogin.mockRejectedValue(new Error("401: invalid_credentials"));
    renderComponent(<LoginScreen />);

    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "demo" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrongpass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await screen.findByText(
      "Incorrect username or password. Please try again.",
    );
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "",
    );
    // The identifier stays — only the secret was wrong.
    expect(
      (screen.getByLabelText("Username or email") as HTMLInputElement).value,
    ).toBe("demo");
  });
});

// #43: the hero photo is dark, so dark status-bar content vanished over it.
describe("LoginScreen — status bar over the hero photo", () => {
  beforeEach(() => {
    mockFocus.isFocused = true;
  });

  it("asks for light status-bar content while focused", () => {
    renderComponent(<LoginScreen />);

    expect(screen.getByTestId("status-bar").getAttribute("data-style")).toBe(
      "light",
    );
  });

  // Login stays mounted under VerifyEmail / ForgotPassword; the last-mounted
  // StatusBar wins, so an always-on one would leak light content onto them.
  it("drops its status-bar override when another screen is on top", () => {
    mockFocus.isFocused = false;
    renderComponent(<LoginScreen />);

    expect(screen.queryByTestId("status-bar")).toBeNull();
  });
});

const fieldLabels = () =>
  screen.getAllByTestId("focus-field-label").map((n) => n.textContent);

describe("LoginScreen — floating labels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRoute.params = undefined;
  });

  it("labels sign-in and sign-up fields verbatim", () => {
    renderComponent(<LoginScreen />);
    expect(fieldLabels()).toEqual(["Username or email", "Password"]);
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    expect(fieldLabels()).toEqual([
      "Username",
      "Email",
      "Password",
      "Confirm password",
    ]);
  });

  it("drops placeholders that repeat their label", () => {
    renderComponent(<LoginScreen />);
    fireEvent.focus(screen.getByLabelText("Password"));
    expect(screen.queryByPlaceholderText("Password")).toBeNull();
  });

  // Review Focus 5: focusing Password with Username empty must leave the
  // Username label resting and float Password.
  it("floats only the focused field when the other is empty", () => {
    renderComponent(<LoginScreen />);
    const username = screen.getByLabelText("Username or email");
    const password = screen.getByLabelText("Password");
    const floatedOf = (label: string) => {
      const props = vi
        .mocked(FocusField)
        .mock.calls.map(([p]) => p)
        .filter((p) => p.label === label)
        .at(-1)!;
      return shouldFloatLabel(props.focus.focused, props.hasValue ? "x" : "");
    };
    fireEvent.focus(username);
    expect(floatedOf("Username or email")).toBe(true);
    fireEvent.blur(username);
    fireEvent.focus(password);
    expect(floatedOf("Username or email")).toBe(false);
    expect(floatedOf("Password")).toBe(true);
  });
});

// Form-fields spec §5.1: no error while typing; check on leaving a field
// with text; empty fields are flagged by the main button, focus on the
// first. Sign-up's age checkbox keeps gating Create Account.
describe("LoginScreen — validation timing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Sign In with empty fields names each field and focuses the first", () => {
    renderComponent(<LoginScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    const username = screen.getByLabelText("Username or email");
    expect(screen.getByText("Enter your username or email.")).toBeTruthy();
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    // No form-level copy repeating the field messages.
    expect(screen.queryByText("Please fill in all fields")).toBeNull();
    expect(username.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(document.activeElement).toBe(username);
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it("sign-up: a bad username shows nothing while typed, and its message on leaving", () => {
    renderComponent(<LoginScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    const input = screen.getByLabelText("Username");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "me@x.com" } });
    expect(screen.queryByText(/letters, numbers, and underscores/i)).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText(/letters, numbers, and underscores/i)).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("sign-up: a short password clears on the keystroke that makes it valid", () => {
    renderComponent(<LoginScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    const input = screen.getByLabelText("Password");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "abcdefgh" } });
    expect(screen.queryByText("Use at least 8 characters.")).toBeNull();
  });

  it("sign-up: Create Account stays disabled until the age box is ticked", () => {
    renderComponent(<LoginScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    expect(
      screen
        .getByRole("button", { name: "Create Account" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("a cleared wrong password does not show its own error over the server message", async () => {
    mockLogin.mockRejectedValue(new Error("401: invalid_credentials"));
    renderComponent(<LoginScreen />);
    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "demo" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "wrongpass" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));
    await screen.findByText(
      "Incorrect username or password. Please try again.",
    );
    expect(screen.queryByText("Enter your password.")).toBeNull();
  });
});

// A checklist line on show: mounted AND not hidden from screen readers (a
// closed checklist keeps its lines mounted under a zero height).
function shownRule(label: string): HTMLElement | null {
  const el = screen.queryByLabelText(label);
  return el && !el.closest('[aria-hidden="true"]') ? el : null;
}

// Form-fields spec §5.2: sign-up fields with rules show a checklist that
// ticks as you type; the field's own error (§5.1) carries the unmet news.
describe("LoginScreen — rule checklist", () => {
  const signUp = () => {
    renderComponent(<LoginScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
  };

  it("shows the password rule on focus and ticks it at the minimum", () => {
    signUp();
    const input = screen.getByLabelText("Password");
    expect(shownRule("At least 8 characters")).toBeNull();
    fireEvent.focus(input);
    expect(screen.getByLabelText("At least 8 characters")).toBeTruthy();
    fireEvent.change(input, { target: { value: "abcdefgh" } });
    expect(screen.getByLabelText("At least 8 characters, done")).toBeTruthy();
  });

  it("shows the username rules on focus in sign-up only", () => {
    renderComponent(<LoginScreen />);
    fireEvent.focus(screen.getByLabelText("Username or email"));
    expect(shownRule("3–30 characters")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Switch to sign up" }));
    const input = screen.getByLabelText("Username");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "chef_1" } });
    expect(screen.getByLabelText("3–30 characters, done")).toBeTruthy();
    expect(screen.getByLabelText("Letters, numbers or _, done")).toBeTruthy();
  });

  it("ticks Matches on the confirm field when it equals the password", () => {
    signUp();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "abcdefgh" },
    });
    const confirm = screen.getByLabelText("Confirm password");
    fireEvent.focus(confirm);
    fireEvent.change(confirm, { target: { value: "abcdefg" } });
    expect(screen.getByLabelText("Matches")).toBeTruthy();
    fireEvent.change(confirm, { target: { value: "abcdefgh" } });
    expect(screen.getByLabelText("Matches, done")).toBeTruthy();
  });

  it("drops the unmet line while the field's own error says it", () => {
    signUp();
    const input = screen.getByLabelText("Password");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();
    expect(shownRule("At least 8 characters")).toBeNull();
    fireEvent.focus(input);
    expect(shownRule("At least 8 characters")).toBeNull();
    fireEvent.change(input, { target: { value: "abcdefgh" } });
    expect(screen.queryByText("Use at least 8 characters.")).toBeNull();
    expect(screen.getByLabelText("At least 8 characters, done")).toBeTruthy();
  });

  it("hides the checklist after leaving with every rule met", () => {
    signUp();
    const input = screen.getByLabelText("Password");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abcdefgh" } });
    fireEvent.blur(input);
    expect(shownRule("At least 8 characters")).toBeNull();
  });
});

// Form-fields spec §5.7: nothing can be edited while the request runs.
describe("LoginScreen — fields lock while signing in", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the fields cannot be edited while sign-in is pending, and unlock after", async () => {
    let fail: (e: Error) => void = () => {};
    mockLogin.mockReturnValue(
      new Promise((_, reject) => {
        fail = reject;
      }),
    );
    renderComponent(<LoginScreen />);
    const username = screen.getByLabelText("Username or email");
    const password = screen.getByLabelText("Password");
    expect(reactProps(username).editable).not.toBe(false);
    fireEvent.change(username, { target: { value: "demo" } });
    fireEvent.change(password, { target: { value: "wrongpass" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    expect(
      reactProps(screen.getByLabelText("Username or email")).editable,
    ).toBe(false);
    expect(reactProps(screen.getByLabelText("Password")).editable).toBe(false);

    fail(new Error("401: invalid_credentials"));
    await screen.findByText(
      "Incorrect username or password. Please try again.",
    );
    expect(reactProps(screen.getByLabelText("Password")).editable).toBe(true);
  });
});

// Fix round 1 (spec §5.8): a field message is announced by its InlineError
// only — the field's hint must not repeat it, or VoiceOver reads it twice.
describe("LoginScreen — one announcement per field error", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an empty password's message appears once in the a11y tree", () => {
    renderComponent(<LoginScreen />);
    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    const password = screen.getByLabelText("Password");
    expect(password.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByText("Enter your password.")).toHaveLength(1);
    expect(password.getAttribute("aria-hint") ?? "").not.toContain(
      "Enter your password.",
    );
  });
});
