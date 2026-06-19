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
import LoginScreen from "../LoginScreen";
import { ApiError } from "@/lib/api-error";

const { mockLogin, mockRegister, mockNavigate } = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockRegister: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ login: mockLogin, register: mockRegister }),
}));

// render-component provides no NavigationContainer; LoginScreen now calls
// useNavigation, so stub it with a spy we can assert against.
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
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

    fireEvent.change(screen.getByLabelText("Username"), {
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
      target: { value: "secret123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "secret123" },
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
      target: { value: "Recipe123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "Recipe123" },
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
      target: { value: "Recipe123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "Recipe123" },
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
        "Recipe123",
        "chef@example.com",
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
      target: { value: "Recipe123" },
    });
    fireEvent.change(screen.getByLabelText("Confirm password"), {
      target: { value: "Recipe123" },
    });
    fireEvent.click(
      screen.getByLabelText("I confirm I am 13 years of age or older"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create Account" }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("VerifyEmail", {
        email: "new@example.com",
      }),
    );
  });

  it("navigates to VerifyEmail when login returns EMAIL_NOT_VERIFIED", async () => {
    mockLogin.mockRejectedValue(
      new ApiError("403: email not verified", "EMAIL_NOT_VERIFIED"),
    );
    renderComponent(<LoginScreen />);

    fireEvent.change(screen.getByLabelText("Username"), {
      target: { value: "demo" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Recipe123" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign In" }));

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("VerifyEmail", {}),
    );
  });
});
