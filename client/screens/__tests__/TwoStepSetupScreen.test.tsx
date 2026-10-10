// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Linking } from "react-native";
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

const CODES = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-DD${i}D`);

function renderScreen(mode: Props["route"]["params"]["mode"]) {
  const route = { params: { mode } } as unknown as Props["route"];
  const navigation = {
    goBack: vi.fn(),
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
      expect(h.disableTwoStep).toHaveBeenCalledWith("pw-1", {
        code: "123456",
      }),
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
