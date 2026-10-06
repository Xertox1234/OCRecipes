// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import MfaChallengeScreen from "../MfaChallengeScreen";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { ApiError } from "@/lib/api-error";

type Props = NativeStackScreenProps<RootStackParamList, "MfaChallenge">;

const h = vi.hoisted(() => ({
  verifySecondFactor: vi.fn(),
  finishSignIn: vi.fn(),
  setStringAsync: vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    verifySecondFactor: h.verifySecondFactor,
    finishSignIn: h.finishSignIn,
  }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: h.setStringAsync }));
vi.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("div", props, children),
}));

const CHALLENGE = "c".repeat(43);
const user = { id: "u1", username: "chef" };

function renderScreen() {
  const navigate = vi.fn();
  const route = {
    params: { challenge: CHALLENGE },
  } as unknown as Props["route"];
  const navigation = { navigate } as unknown as Props["navigation"];
  renderComponent(<MfaChallengeScreen route={route} navigation={navigation} />);
  return { navigate };
}

const typeCode = (value: string) =>
  fireEvent.change(screen.getByLabelText("6-digit code"), {
    target: { value },
  });

describe("MfaChallengeScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.finishSignIn.mockResolvedValue(undefined);
    h.setStringAsync.mockResolvedValue(true);
  });

  it("submits by itself once 6 digits are in, and only once", async () => {
    h.verifySecondFactor.mockResolvedValue({
      status: "signed_in",
      user,
      token: "t",
    });
    renderScreen();
    typeCode("12345");
    expect(h.verifySecondFactor).not.toHaveBeenCalled();
    typeCode("123456");
    typeCode("123456");
    await waitFor(() => expect(h.finishSignIn).toHaveBeenCalledWith(user, "t"));
    expect(h.verifySecondFactor).toHaveBeenCalledTimes(1);
    expect(h.verifySecondFactor).toHaveBeenCalledWith(CHALLENGE, {
      code: "123456",
    });
  });

  it("a used recovery code: shows the replacement and signs in only after 'I've saved it'", async () => {
    h.verifySecondFactor.mockResolvedValue({
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
    fireEvent.click(screen.getByText("Verify"));
    await screen.findByText("AAAA-BBBB-CCCC-DDDD");
    expect(h.verifySecondFactor).toHaveBeenCalledWith(CHALLENGE, {
      recoveryCode: "wxyz-wxyz-wxyz-wxyz",
    });
    expect(h.finishSignIn).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Copy code"));
    await waitFor(() =>
      expect(h.setStringAsync).toHaveBeenCalledWith("AAAA-BBBB-CCCC-DDDD"),
    );
    fireEvent.click(screen.getByText("I've saved it"));
    await waitFor(() => expect(h.finishSignIn).toHaveBeenCalledWith(user, "t"));
  });

  it("a wrong code shows the message, clears the field and keeps you here", async () => {
    h.verifySecondFactor.mockRejectedValue(
      new ApiError("x", "MFA_CODE_INVALID", 401),
    );
    renderScreen();
    typeCode("123456");
    await screen.findByText(
      "That code didn't work. Check your authenticator app and try again.",
    );
    expect(
      (screen.getByLabelText("6-digit code") as HTMLInputElement).value,
    ).toBe("");
    expect(h.finishSignIn).not.toHaveBeenCalled();
  });

  it("an expired sign-in says so and offers the way back", async () => {
    h.verifySecondFactor.mockRejectedValue(
      new ApiError("x", "MFA_CHALLENGE_INVALID", 401),
    );
    const { navigate } = renderScreen();
    typeCode("123456");
    await screen.findByText("This sign-in expired. Please sign in again.");
    fireEvent.click(screen.getByText("Back to sign in"));
    expect(navigate).toHaveBeenCalledWith("Login");
  });
});
