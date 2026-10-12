// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { renderComponent } from "../../../test/utils/render-component";
import TwoStepCodeScreen from "../TwoStepCodeScreen";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { ApiError } from "@/lib/api-error";

type Props = NativeStackScreenProps<RootStackParamList, "TwoStepCode">;

const { mockVerify, mockFinish, mockToastError, mockCopy, mockResend } =
  vi.hoisted(() => ({
    mockResend: vi.fn(),
    mockVerify: vi.fn(),
    mockFinish: vi.fn(),
    mockToastError: vi.fn(),
    mockCopy: vi.fn(),
  }));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    verifySecondFactor: mockVerify,
    finishSignIn: mockFinish,
    resendSignInCode: mockResend,
  }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ error: mockToastError, success: vi.fn() }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: mockCopy }));
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("div", props, children),
}));

const user = { id: "u1", username: "chef" };

function renderScreen(
  purpose: "login" | "link" = "login",
  extra: Record<string, unknown> = {},
) {
  const route = {
    params: { challenge: "c-1", purpose, ...extra },
  } as unknown as Props["route"];
  const navigation = {
    navigate: vi.fn(),
    popToTop: vi.fn(),
  } as unknown as Props["navigation"];
  renderComponent(<TwoStepCodeScreen route={route} navigation={navigation} />);
  return navigation;
}

const typeCode = (code: string) =>
  fireEvent.change(screen.getByLabelText("6-digit code"), {
    target: { value: code },
  });

beforeEach(() => {
  vi.clearAllMocks();
  mockFinish.mockResolvedValue(undefined);
  mockCopy.mockResolvedValue(true);
});

describe("TwoStepCodeScreen", () => {
  it("six digits check the code once and then sign in", async () => {
    mockVerify.mockResolvedValue({ status: "signed_in", user, token: "t" });
    renderScreen();
    typeCode("123456");
    await waitFor(() => expect(mockFinish).toHaveBeenCalledWith(user, "t"));
    expect(mockVerify).toHaveBeenCalledTimes(1);
    // "Don't ask again on this phone" is on by default.
    expect(mockVerify).toHaveBeenCalledWith("c-1", { code: "123456" }, true);
  });

  it("turning 'Don't ask again' off sends trust false", async () => {
    mockVerify.mockResolvedValue({ status: "signed_in", user, token: "t" });
    renderScreen("login");
    fireEvent.click(screen.getByLabelText("Don't ask again on this phone"));
    typeCode("123456");
    await waitFor(() =>
      expect(mockVerify).toHaveBeenCalledWith("c-1", { code: "123456" }, false),
    );
  });

  it("connecting a sign-in method never offers to trust the phone", async () => {
    mockVerify.mockResolvedValue({ status: "signed_in", user, token: "t" });
    renderScreen("link");
    expect(screen.queryByLabelText("Don't ask again on this phone")).toBeNull();
    typeCode("123456");
    await waitFor(() =>
      expect(mockVerify).toHaveBeenCalledWith("c-1", { code: "123456" }, false),
    );
  });

  it("email account: says where the code went and can resend it", async () => {
    mockResend.mockResolvedValue({
      status: "code_sent",
      emailHint: "w•••@gmail.com",
    });
    renderScreen("login", {
      method: "email",
      emailHint: "w•••@gmail.com",
      codeSent: true,
    });
    expect(
      screen.getByText(
        "We emailed a 6-digit code to w•••@gmail.com. It can take a minute to arrive.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Use a recovery code instead")).toBeNull();
    // The first code just went out: the resend button starts waiting.
    expect(screen.getByLabelText("Resend code in 30s")).toBeTruthy();
  });

  it("email account whose code was held back: Resend works straight away", async () => {
    mockResend.mockResolvedValue({
      status: "code_sent",
      emailHint: "w•••@gmail.com",
    });
    renderScreen("login", {
      method: "email",
      emailHint: "w•••@gmail.com",
      codeSent: false,
    });
    fireEvent.click(screen.getByLabelText("Email me a code"));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith("c-1"));
  });

  it("a recovery code's replacement is shown, and sign-in waits for 'I've saved it'", async () => {
    mockVerify.mockResolvedValue({
      status: "signed_in",
      user,
      token: "t",
      replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    renderScreen();
    fireEvent.click(screen.getByText("Use a recovery code instead"));
    fireEvent.change(screen.getByLabelText("Recovery code"), {
      target: { value: "wxyz-wxyz-wxyz-wxyz" },
    });
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByText("AAAA-BBBB-CCCC-DDDD");
    expect(mockVerify).toHaveBeenCalledWith(
      "c-1",
      { recoveryCode: "wxyz-wxyz-wxyz-wxyz" },
      true, // "Don't ask again" is on by default
    );
    expect(mockFinish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Copy"));
    expect(mockCopy).toHaveBeenCalledWith("AAAA-BBBB-CCCC-DDDD");
    fireEvent.click(screen.getByText("I've saved it"));
    await waitFor(() => expect(mockFinish).toHaveBeenCalledWith(user, "t"));
  });

  it("a failed answer that spent a recovery code still shows its replacement", async () => {
    mockVerify.mockRejectedValue(
      new ApiError(
        `401: ${JSON.stringify({ code: "INVALID_SIGN_IN_TICKET", error: "This sign-in has expired. Please start again.", replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD" })}`,
        "INVALID_SIGN_IN_TICKET",
        401,
      ),
    );
    renderScreen("link");
    fireEvent.click(screen.getByText("Use a recovery code instead"));
    fireEvent.change(screen.getByLabelText("Recovery code"), {
      target: { value: "wxyz-wxyz-wxyz-wxyz" },
    });
    fireEvent.click(screen.getByText("Continue"));
    await screen.findByText("AAAA-BBBB-CCCC-DDDD");
    expect(mockFinish).not.toHaveBeenCalled();
  });

  it("a wrong code shows the server's message and stays", async () => {
    mockVerify.mockRejectedValue(
      new ApiError(
        `401: ${JSON.stringify({ code: "INVALID_SECOND_FACTOR", error: "That code didn't work. After several wrong codes, codes pause for 15 minutes." })}`,
        "INVALID_SECOND_FACTOR",
        401,
      ),
    );
    const navigation = renderScreen();
    typeCode("000000");
    await screen.findByText(
      "That code didn't work. After several wrong codes, codes pause for 15 minutes.",
    );
    expect(navigation.popToTop).not.toHaveBeenCalled();
  });

  it("an expired sign-in goes back to the start", async () => {
    mockVerify.mockRejectedValue(
      new ApiError(
        `401: ${JSON.stringify({ code: "MFA_CHALLENGE_EXPIRED", error: "x" })}`,
        "MFA_CHALLENGE_EXPIRED",
        401,
      ),
    );
    const navigation = renderScreen();
    typeCode("123456");
    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
    expect(mockToastError).toHaveBeenCalledWith(
      "This sign-in expired. Please start again.",
      expect.anything(),
    );
  });
});
