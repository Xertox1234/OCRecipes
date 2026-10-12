// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Alert, Linking } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { renderComponent } from "../../../test/utils/render-component";
import TwoStepSetupScreen from "../TwoStepSetupScreen";
import type { ProfileStackParamList } from "@/navigation/ProfileStackNavigator";
import { ApiError } from "@/lib/api-error";
import { recoveryCodesText } from "../TwoStepSetupScreen-utils";

type Props = NativeStackScreenProps<ProfileStackParamList, "TwoStepSetup">;

const h = vi.hoisted(() => ({
  startEmailTwoStep: vi.fn(),
  confirmEmailTwoStep: vi.fn(),
  emailSource: undefined as unknown,
  startTwoStepSetup: vi.fn(),
  startNewPhone: vi.fn(),
  confirmTwoStep: vi.fn(),
  disableTwoStep: vi.fn(),
  replaceRecoveryCodes: vi.fn(),
  copy: vi.fn(),
  toastSuccess: vi.fn(),
  usePreventRemove: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    startEmailTwoStep: h.startEmailTwoStep,
    confirmEmailTwoStep: h.confirmEmailTwoStep,
    startTwoStepSetup: h.startTwoStepSetup,
    startNewPhone: h.startNewPhone,
    confirmTwoStep: h.confirmTwoStep,
    disableTwoStep: h.disableTwoStep,
    replaceRecoveryCodes: h.replaceRecoveryCodes,
  }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: h.toastSuccess, error: vi.fn() }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: h.copy }));
vi.mock("@/hooks/useSignInMethods", () => ({
  useSignedInEmailCode: () => h.emailSource,
}));
vi.mock("@react-navigation/native", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePreventRemove: h.usePreventRemove,
}));

const CODES = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-DD${i}D`);

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
  h.copy.mockResolvedValue(true);
  h.emailSource = undefined;
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
    expect(h.startTwoStepSetup).not.toHaveBeenCalled();
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
    expect(
      screen.getByRole("button", { name: "Turn off" }).hasAttribute("disabled"),
    ).toBe(true);
    type("6-digit code", "123456");
    press("Turn off");
    await waitFor(() =>
      expect(h.disableTwoStep).toHaveBeenCalledWith("pw-1", { code: "123456" }),
    );
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  });

  it("turning off an email account: the code field offers Email me a code", () => {
    h.emailSource = { send: vi.fn() };
    renderScreen("disable");
    expect(
      screen.getByText("Enter your password and the code we email you."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Email me a code" }),
    ).toBeTruthy();
  });

  it("new recovery codes go straight to the save step", async () => {
    h.replaceRecoveryCodes.mockResolvedValue(CODES);
    renderScreen("new_codes");
    type("Password", "pw-1");
    type("6-digit code", "123456");
    press("Continue");
    await screen.findByText(CODES[0]);
    expect(h.replaceRecoveryCodes).toHaveBeenCalledWith("pw-1", {
      code: "123456",
    });
  });

  it("a new phone confirms without new codes", async () => {
    h.startNewPhone.mockResolvedValue({
      secret: "ABCDEFGHIJKLMNOP",
      otpauthUrl: "otpauth://totp/x",
    });
    h.confirmTwoStep.mockResolvedValue({});
    const navigation = renderScreen("new_phone");
    type("Password", "pw-1");
    type("6-digit code", "111111");
    press("Continue");
    await screen.findByText("ABCD EFGH IJKL MNOP");
    expect(h.startNewPhone).toHaveBeenCalledWith("pw-1", { code: "111111" });
    press("Next");
    type("6-digit code", "123456");
    press("Confirm");
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalled());
  });
});

describe("TwoStepSetupScreen — a spent recovery code is never lost", () => {
  it("a new-phone request that fails after spending a recovery code still shows its replacement", async () => {
    h.startNewPhone.mockRejectedValue(
      new ApiError(
        `500: ${JSON.stringify({ error: "x", code: "INTERNAL_ERROR", replacementRecoveryCode: "NEW2-AAAA-BBBB-CCCC" })}`,
        "INTERNAL_ERROR",
        500,
      ),
    );
    renderScreen("new_phone");
    type("Password", "pw-1");
    fireEvent.click(screen.getByText("Use a recovery code instead"));
    type("Recovery code", "WXYZ-WXYZ-WXYZ-WXYZ");
    press("Continue");
    expect(await screen.findByText("NEW2-AAAA-BBBB-CCCC")).toBeTruthy();
  });
});

describe("TwoStepSetupScreen — leaving before the codes are saved", () => {
  /** The latest `usePreventRemove(prevent, onLeave)` the screen rendered with. */
  const lastGuard = () =>
    h.usePreventRemove.mock.calls.at(-1) as [
      boolean,
      (e: { data: { action: { type: string } } }) => void,
    ];

  async function reachSaveCodes() {
    h.replaceRecoveryCodes.mockResolvedValue(CODES);
    const navigation = renderScreen("new_codes");
    expect(lastGuard()[0]).toBe(false);
    type("Password", "pw-1");
    type("6-digit code", "123456");
    press("Continue");
    await screen.findByText(CODES[0]);
    return navigation;
  }

  it("asks before leaving while the codes are unsaved, and Leave goes back", async () => {
    const alert = vi.spyOn(Alert, "alert").mockImplementation(() => {});
    const navigation = await reachSaveCodes();
    const [prevent, onLeave] = lastGuard();
    expect(prevent).toBe(true);

    const action = { type: "GO_BACK" };
    onLeave({ data: { action } });
    expect(alert).toHaveBeenCalledTimes(1);
    const buttons = alert.mock.calls[0][2] ?? [];
    buttons.find((b) => b.text === "Stay")?.onPress?.();
    expect(navigation.dispatch).not.toHaveBeenCalled();
    buttons.find((b) => b.text === "Leave")?.onPress?.();
    expect(navigation.dispatch).toHaveBeenCalledWith(action);
  });

  it("stops guarding once 'I've saved these' is ticked", async () => {
    await reachSaveCodes();
    fireEvent.click(screen.getByRole("checkbox", { name: "I've saved these" }));
    expect(lastGuard()[0]).toBe(false);
  });
});
