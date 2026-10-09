// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import ResetPasswordScreen from "../ResetPasswordScreen";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
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

type Props = NativeStackScreenProps<RootStackParamList, "ResetPassword">;

const { mockReset, mockResend } = vi.hoisted(() => ({
  mockReset: vi.fn(),
  mockResend: vi.fn(),
}));
vi.mock("../ResetPasswordScreen-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../ResetPasswordScreen-utils")>();
  return { ...actual, resetPasswordRequest: mockReset };
});
vi.mock("../ForgotPasswordScreen-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../ForgotPasswordScreen-utils")>();
  return { ...actual, requestResetCode: mockResend };
});

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

function renderScreen() {
  const navigate = vi.fn();
  const reset = vi.fn();
  const route = { params: { email: "a@b.com" } } as unknown as Props["route"];
  const navigation = { navigate, reset } as unknown as Props["navigation"];
  renderComponent(
    <ResetPasswordScreen route={route} navigation={navigation} />,
  );
  return { navigate, reset };
}

function fill(code: string, pw = "newpass99", confirm = pw) {
  fireEvent.change(screen.getByLabelText("6-digit code"), {
    target: { value: code },
  });
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: pw },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: confirm },
  });
}

describe("ResetPasswordScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("names the address in neutral copy", () => {
    renderScreen();
    expect(
      screen.getByText(
        "If an account uses a@b.com, we've sent a 6-digit code. It expires in 15 minutes.",
      ),
    ).toBeTruthy();
  });

  it("normalizes a pasted code and submits; success resets to Login with params", async () => {
    mockReset.mockResolvedValue(undefined);
    const { reset } = renderScreen();
    fill("123 456");
    fireEvent.click(screen.getByText("Reset password"));
    await waitFor(() =>
      expect(mockReset).toHaveBeenCalledWith("a@b.com", "123456", "newpass99"),
    );
    expect(reset).toHaveBeenCalledWith({
      index: 0,
      routes: [
        { name: "Login", params: { email: "a@b.com", passwordReset: true } },
      ],
    });
  });

  it("shows the uniform message on INVALID_RESET_CODE", async () => {
    mockReset.mockRejectedValue(new ApiError("x", "INVALID_RESET_CODE", 400));
    renderScreen();
    fill("000000");
    fireEvent.click(screen.getByText("Reset password"));
    await screen.findByText(
      "That code is incorrect or expired. After 5 wrong tries, request a new code.",
    );
    expect(
      screen.getByLabelText("6-digit code").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      screen.getByLabelText("New password").getAttribute("aria-invalid"),
    ).toBeNull();
  });

  it("blocks submit on mismatched passwords without calling the API", () => {
    renderScreen();
    fill("123456", "newpass99", "newpass98");
    fireEvent.click(screen.getByText("Reset password"));
    expect(mockReset).not.toHaveBeenCalled();
    expect(screen.getByText("Passwords do not match")).toBeTruthy();
    expect(
      screen
        .getByLabelText("Confirm new password")
        .getAttribute("aria-invalid"),
    ).toBe("true");
    expect(
      screen.getByLabelText("6-digit code").getAttribute("aria-invalid"),
    ).toBeNull();
  });

  it("marks the code field when the code is too short", () => {
    renderScreen();
    fill("123");
    fireEvent.click(screen.getByText("Reset password"));
    expect(mockReset).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("6-digit code").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("resend is disabled for 60 s, counts down, then sends", async () => {
    mockResend.mockResolvedValue(undefined);
    renderScreen();
    expect(screen.getByText("Resend code in 60s")).toBeTruthy();
    fireEvent.click(screen.getByText("Resend code in 60s"));
    expect(mockResend).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    fireEvent.click(screen.getByText("Resend code"));
    await waitFor(() => expect(mockResend).toHaveBeenCalledWith("a@b.com"));
    expect(await screen.findByText("Resend code in 60s")).toBeTruthy();
  });

  it("shows the spam/most-recent hint", () => {
    renderScreen();
    expect(
      screen.getByText(
        "Didn't get it? Check your spam folder, and use the most recent email.",
      ),
    ).toBeTruthy();
  });

  it("Back to sign in navigates to Login", () => {
    const { navigate } = renderScreen();
    fireEvent.click(screen.getByText("Back to sign in"));
    expect(navigate).toHaveBeenCalledWith("Login");
  });
});

// A validation reject shakes the error (paired with the Error haptic it
// already fires); a server error shows copy and buzzes but does not shake.
describe("ResetPasswordScreen — shake on validation reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => vi.useRealTimers());

  it("the same validation reject twice shakes twice", () => {
    renderScreen();
    fill("123456", "newpass99", "newpass98");

    fireEvent.click(screen.getByText("Reset password"));
    fireEvent.click(screen.getByText("Reset password"));

    expect(screen.getByText("Passwords do not match")).toBeTruthy();
    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(mockReset).not.toHaveBeenCalled();
  });

  it("a server error buzzes but does not shake", async () => {
    mockReset.mockRejectedValue(new ApiError("x", "INVALID_RESET_CODE", 400));
    renderScreen();
    fill("000000");
    fireEvent.click(screen.getByText("Reset password"));

    await screen.findByText(
      "That code is incorrect or expired. After 5 wrong tries, request a new code.",
    );
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});
