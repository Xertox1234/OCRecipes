// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import * as RN from "react-native";
import * as Haptics from "expo-haptics";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { renderComponent } from "../../../test/utils/render-component";
import { reactProps } from "../../../test/utils/react-props";
import TwoStepSetupScreen from "../TwoStepSetupScreen";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import { ApiError } from "@/lib/api-error";

type Props = NativeStackScreenProps<ProfileStackParamList, "TwoStepSetup">;

const { withSequenceSpy } = vi.hoisted(() => ({
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
}));

// The InlineError shake runs one withSequence per validation reject.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

const h = vi.hoisted(() => ({
  startEmailTwoStep: vi.fn(),
  confirmEmailTwoStep: vi.fn(),
  emailSource: { send: vi.fn() } as unknown,
  disableTwoStep: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    startEmailTwoStep: h.startEmailTwoStep,
    confirmEmailTwoStep: h.confirmEmailTwoStep,
    disableTwoStep: h.disableTwoStep,
  }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: h.toastSuccess, error: vi.fn() }),
}));
vi.mock("@/hooks/useSignInMethods", () => ({
  useSignedInEmailCode: () => h.emailSource,
}));

function renderScreen(mode: Props["route"]["params"]["mode"]) {
  const route = { params: { mode } } as unknown as Props["route"];
  const navigation = {
    goBack: vi.fn(),
    dispatch: vi.fn(),
    setOptions: vi.fn(),
  } as unknown as Props["navigation"];
  renderComponent(<TwoStepSetupScreen route={route} navigation={navigation} />);
  return navigation;
}

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.clearAllMocks();
});

// Owner ruling 4 (2026-10-12): turning it on means codes by email.
describe("TwoStepSetupScreen — turning it on (email)", () => {
  const sent = { status: "code_sent", emailHint: "w•••@gmail.com" };

  it("password → emailed code → on: no keys, no recovery codes", async () => {
    h.startEmailTwoStep.mockResolvedValue(sent);
    h.confirmEmailTwoStep.mockResolvedValue(undefined);
    const navigation = renderScreen("setup");
    expect(
      screen.getByText(
        "When you sign in on a new phone, we'll email you a 6-digit code. Enter your password to start.",
      ),
    ).toBeTruthy();
    type("Password", "pw-1");
    press("Continue");
    expect(
      await screen.findByText(
        "We emailed a 6-digit code to w•••@gmail.com. Enter it below.",
      ),
    ).toBeTruthy();
    expect(h.startEmailTwoStep).toHaveBeenCalledWith("pw-1");
    expect(screen.queryByLabelText("Use a recovery code instead")).toBeNull();
    type("6-digit code", "123456");
    await waitFor(() =>
      expect(h.confirmEmailTwoStep).toHaveBeenCalledWith("123456"),
    );
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
    expect(h.toastSuccess).toHaveBeenCalledWith("Two-step verification is on");
  });

  // #79: the success toast already buzzes and (iOS) announces itself — the
  // screen doing both too gave a double buzz and a doubled VoiceOver line.
  it("leaves the success buzz and announcement to the toast", async () => {
    const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    const Haptics = await import("expo-haptics");
    h.startEmailTwoStep.mockResolvedValue(sent);
    h.confirmEmailTwoStep.mockResolvedValue(undefined);
    const navigation = renderScreen("setup");
    type("Password", "pw-1");
    press("Continue");
    await screen.findByText(
      "We emailed a 6-digit code to w•••@gmail.com. Enter it below.",
    );
    type("6-digit code", "123456");
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());

    expect(h.toastSuccess).toHaveBeenCalledWith("Two-step verification is on");
    expect(announce).not.toHaveBeenCalledWith("Two-step verification is on");
    expect(Haptics.notificationAsync).not.toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
    announce.mockRestore();
  });

  it("tells screen readers the first code went out, once", async () => {
    const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    h.startEmailTwoStep.mockResolvedValue(sent);
    renderScreen("setup");
    type("Password", "pw-1");
    press("Continue");
    await screen.findByLabelText("6-digit code");
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith("Code sent to w•••@gmail.com.");
  });

  it("a failed send announces nothing", async () => {
    const announce = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
    h.startEmailTwoStep.mockRejectedValue(
      new ApiError(
        `409: ${JSON.stringify({ code: "EMAIL_NOT_VERIFIED", error: "x" })}`,
        "EMAIL_NOT_VERIFIED",
        409,
      ),
    );
    renderScreen("setup");
    type("Password", "pw-1");
    press("Continue");
    await screen.findByText(
      "Confirm your email address first, so the codes reach you.",
    );
    expect(announce).not.toHaveBeenCalled();
  });

  it("a wrong code stays on the code step and says so", async () => {
    h.startEmailTwoStep.mockResolvedValue(sent);
    h.confirmEmailTwoStep.mockRejectedValue(
      new ApiError(
        `400: ${JSON.stringify({ code: "INVALID_SECOND_FACTOR", error: "That code didn't work. Check the newest email, or ask for a new code." })}`,
        "INVALID_SECOND_FACTOR",
        400,
      ),
    );
    const navigation = renderScreen("setup");
    type("Password", "pw-1");
    press("Continue");
    await screen.findByLabelText("6-digit code");
    type("6-digit code", "000000");
    expect(
      await screen.findByText(
        "That code didn't work. Check the newest email, or ask for a new code.",
      ),
    ).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it.each([
    [
      "EMAIL_NOT_VERIFIED",
      409,
      "Confirm your email address first, so the codes reach you.",
    ],
    [
      "MFA_UNAVAILABLE",
      503,
      "Two-step verification is unavailable right now. Please try again later.",
    ],
  ])("%s → plain words", async (code, status, words) => {
    h.startEmailTwoStep.mockRejectedValue(
      new ApiError(
        `${status}: ${JSON.stringify({ code, error: "x" })}`,
        code,
        status,
      ),
    );
    renderScreen("setup");
    type("Password", "pw-1");
    press("Continue");
    expect(await screen.findByText(words)).toBeTruthy();
  });
});

describe("TwoStepSetupScreen — managing it", () => {
  it("turning it off needs both the password and a code", async () => {
    h.disableTwoStep.mockResolvedValue(undefined);
    const navigation = renderScreen("disable");
    type("Password", "pw-1");
    // Without the code, Turn off says what's missing and sends nothing.
    press("Turn off");
    expect(
      screen.getByText("Enter the two-step code we email you."),
    ).toBeTruthy();
    expect(h.disableTwoStep).not.toHaveBeenCalled();
    type("6-digit code", "123456");
    press("Turn off");
    await waitFor(() =>
      expect(h.disableTwoStep).toHaveBeenCalledWith("pw-1", { code: "123456" }),
    );
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  });

  it("turning it off: the code field offers Email me a code", () => {
    renderScreen("disable");
    expect(
      screen.getByText("Enter your password and the code we email you."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Email me a code" }),
    ).toBeTruthy();
  });
});

const fieldLabels = () =>
  screen.getAllByTestId("focus-field-label").map((n) => n.textContent);

describe("TwoStepSetupScreen — floating labels", () => {
  it("floats Password with no repeated placeholder", () => {
    renderScreen("setup");
    expect(fieldLabels()).toEqual(["Password"]);
    fireEvent.focus(screen.getByLabelText("Password"));
    expect(screen.queryByPlaceholderText("Password")).toBeNull();
  });
});

// Form-fields spec §5.8: a validation reject shakes and buzzes, as on the
// other forms (ConnectAccount's password step); a server error never shakes.
describe("TwoStepSetupScreen — shake on validation reject", () => {
  it("Continue with no password twice: says why, shakes and buzzes twice", () => {
    renderScreen("setup");
    press("Continue");
    press("Continue");
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(h.startEmailTwoStep).not.toHaveBeenCalled();
  });

  it("Return on the password field continues", async () => {
    h.startEmailTwoStep.mockReturnValue(new Promise(() => {}));
    renderScreen("setup");
    type("Password", "pw-1");
    const props = reactProps(screen.getByLabelText("Password"));
    expect(props.returnKeyType).toBe("go");
    await act(async () => {
      (props.onSubmitEditing as () => void)();
    });
    expect(h.startEmailTwoStep).toHaveBeenCalledWith("pw-1");
  });

  it("a wrong password buzzes but does not shake", async () => {
    h.startEmailTwoStep.mockRejectedValue(
      new ApiError("401", "UNAUTHORIZED", 401),
    );
    renderScreen("setup");
    type("Password", "pw-1");
    press("Continue");
    await screen.findByText("Incorrect password. Please try again.");
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});
