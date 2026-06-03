// @vitest-environment jsdom
/**
 * H6 (2026-06-03 full audit): on an auth failure LoginScreen must show static,
 * mode-specific copy — never the raw `err.message` from the thrown error
 * (the `no-error-message-in-ui` rule's behavioral counterpart: avoids leaking
 * backend internals and username enumeration). See docs/rules/client-state.md.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import LoginScreen from "../LoginScreen";

const { mockLogin, mockRegister } = vi.hoisted(() => ({
  mockLogin: vi.fn(),
  mockRegister: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ login: mockLogin, register: mockRegister }),
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
