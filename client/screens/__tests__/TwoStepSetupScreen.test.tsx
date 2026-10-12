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
});

describe("TwoStepSetupScreen — turning it on", () => {
  it("walks password → key → code → codes, and Done waits for 'I've saved these'", async () => {
    h.startTwoStepSetup.mockResolvedValue({
      secret: "ABCDEFGHIJKLMNOP",
      otpauthUrl: "otpauth://totp/x",
    });
    h.confirmTwoStep.mockResolvedValue({ recoveryCodes: CODES });
    const navigation = renderScreen("setup");

    type("Password", "pw-1");
    press("Continue");
    await screen.findByText("ABCD EFGH IJKL MNOP");
    expect(h.startTwoStepSetup).toHaveBeenCalledWith("pw-1");

    press("Next");
    type("6-digit code", "123456");
    press("Confirm");
    await screen.findByText(CODES[0]);
    expect(h.confirmTwoStep).toHaveBeenCalledWith("123456");

    const done = screen.getByRole("button", { name: "Done" });
    expect(done.hasAttribute("disabled")).toBe(true);
    press("Copy all");
    await waitFor(() =>
      expect(h.copy).toHaveBeenCalledWith(recoveryCodesText(CODES)),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "I've saved these" }));
    expect(
      screen.getByRole("button", { name: "Done" }).hasAttribute("disabled"),
    ).toBe(false);
    press("Done");
    expect(navigation.goBack).toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("no authenticator app opening shows the copy-the-key fallback", async () => {
    h.startTwoStepSetup.mockResolvedValue({
      secret: "ABCDEFGHIJKLMNOP",
      otpauthUrl: "otpauth://totp/x",
    });
    vi.spyOn(Linking, "openURL").mockRejectedValue(new Error("no handler"));
    renderScreen("setup");
    type("Password", "pw-1");
    press("Continue");
    await screen.findByText("ABCD EFGH IJKL MNOP");
    press("Add to authenticator app");
    expect(
      await screen.findByText(
        "No authenticator app opened — copy the key instead.",
      ),
    ).toBeTruthy();
  });

  it("while the feature is off on the server it says so", async () => {
    h.startTwoStepSetup.mockRejectedValue(
      new ApiError(
        `403: ${JSON.stringify({ code: "MFA_SETUP_DISABLED", error: "x" })}`,
        "MFA_SETUP_DISABLED",
        403,
      ),
    );
    renderScreen("setup");
    type("Password", "pw-1");
    press("Continue");
    expect(
      await screen.findByText("Two-step verification isn't available yet."),
    ).toBeTruthy();
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
