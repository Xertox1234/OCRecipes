// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ChooseUsernameScreen from "../ChooseUsernameScreen";
import { ApiError } from "@/lib/api-error";

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
    );
    expect(screen.queryByText(/username is taken/i)).toBeNull();
  });
});
