// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Linking } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import TwoFactorSetupScreen from "../TwoFactorSetupScreen";
import { recoveryCodesText } from "../TwoFactorSetupScreen-utils";

const h = vi.hoisted(() => ({
  startTwoFactorSetup: vi.fn(),
  confirmTwoFactor: vi.fn(),
  disableTwoFactor: vi.fn(),
  replaceRecoveryCodes: vi.fn(),
  setStringAsync: vi.fn(),
  goBack: vi.fn(),
  refetch: vi.fn(),
  toastSuccess: vi.fn(),
  twoFactor: { enabled: false, recoveryCodesRemaining: 0 },
}));
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    startTwoFactorSetup: h.startTwoFactorSetup,
    confirmTwoFactor: h.confirmTwoFactor,
    disableTwoFactor: h.disableTwoFactor,
    replaceRecoveryCodes: h.replaceRecoveryCodes,
  }),
}));
vi.mock("@/hooks/useSignInMethods", () => ({
  useSignInMethods: () => ({
    methods: { password: true, google: null, apple: null },
    twoFactor: h.twoFactor,
    isError: false,
    refetch: h.refetch,
    setMethods: vi.fn(),
  }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: h.goBack }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: h.toastSuccess, error: vi.fn() }),
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

const CODES = ["AAAA-BBBB-CCCC-DDDD", "EEEE-FFFF-GGGG-HHHH"];
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("TwoFactorSetupScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.twoFactor = { enabled: false, recoveryCodesRemaining: 0 };
    h.setStringAsync.mockResolvedValue(true);
  });

  describe("turning it on", () => {
    it("password → key and link → code → codes saved", async () => {
      h.startTwoFactorSetup.mockResolvedValue({
        secret: "ABCDEFGHIJKLMNOP",
        otpauthUrl: "otpauth://totp/x",
      });
      h.confirmTwoFactor.mockResolvedValue(CODES);
      const openURL = vi.spyOn(Linking, "openURL").mockResolvedValue(true);
      renderComponent(<TwoFactorSetupScreen />);

      type("Password", "pw-123456");
      fireEvent.click(screen.getByText("Continue"));
      await screen.findByText("ABCD EFGH IJKL MNOP");
      expect(h.startTwoFactorSetup).toHaveBeenCalledWith({
        password: "pw-123456",
      });

      fireEvent.click(screen.getByText("Open in authenticator app"));
      await waitFor(() =>
        expect(openURL).toHaveBeenCalledWith("otpauth://totp/x"),
      );
      fireEvent.click(screen.getByText("Copy key"));
      await waitFor(() =>
        expect(h.setStringAsync).toHaveBeenCalledWith("ABCDEFGHIJKLMNOP"),
      );

      type("6-digit code", "123456");
      fireEvent.click(screen.getByText("Turn on"));
      await screen.findByText("AAAA-BBBB-CCCC-DDDD");
      expect(h.confirmTwoFactor).toHaveBeenCalledWith("123456");

      fireEvent.click(screen.getByText("Copy all"));
      await waitFor(() =>
        expect(h.setStringAsync).toHaveBeenLastCalledWith(
          recoveryCodesText(CODES),
        ),
      );
      fireEvent.click(screen.getByText("I've saved them"));
      expect(h.goBack).toHaveBeenCalled();
    });

    it("no authenticator app for the link: says to copy the key instead", async () => {
      h.startTwoFactorSetup.mockResolvedValue({
        secret: "ABCDEFGHIJKLMNOP",
        otpauthUrl: "otpauth://totp/x",
      });
      vi.spyOn(Linking, "openURL").mockRejectedValue(new Error("no handler"));
      renderComponent(<TwoFactorSetupScreen />);
      type("Password", "pw-123456");
      fireEvent.click(screen.getByText("Continue"));
      await screen.findByText("ABCD EFGH IJKL MNOP");
      fireEvent.click(screen.getByText("Open in authenticator app"));
      await screen.findByText(
        "No authenticator app opened. Copy the key and add it in your app instead.",
      );
    });

    it("an empty password never calls the server", () => {
      renderComponent(<TwoFactorSetupScreen />);
      fireEvent.click(screen.getByText("Continue"));
      expect(h.startTwoFactorSetup).not.toHaveBeenCalled();
    });
  });

  describe("when it is on", () => {
    beforeEach(() => {
      h.twoFactor = { enabled: true, recoveryCodesRemaining: 7 };
    });

    it("shows how many recovery codes are left", () => {
      renderComponent(<TwoFactorSetupScreen />);
      expect(screen.getByText("On · 7 recovery codes left")).toBeTruthy();
    });

    it("turning it off needs the password AND a code", async () => {
      h.disableTwoFactor.mockResolvedValue(true);
      renderComponent(<TwoFactorSetupScreen />);
      type("6-digit code", "123456");
      fireEvent.click(screen.getByText("Turn off two-step verification"));
      expect(h.disableTwoFactor).not.toHaveBeenCalled();

      type("Password", "pw-123456");
      fireEvent.click(screen.getByText("Turn off two-step verification"));
      await waitFor(() =>
        expect(h.disableTwoFactor).toHaveBeenCalledWith(
          { password: "pw-123456" },
          { code: "123456" },
        ),
      );
      await waitFor(() => expect(h.goBack).toHaveBeenCalled());
      expect(h.toastSuccess).toHaveBeenCalledWith(
        "Two-step verification is off",
      );
    });

    it("new recovery codes: password + code, then the codes are shown", async () => {
      h.replaceRecoveryCodes.mockResolvedValue(CODES);
      renderComponent(<TwoFactorSetupScreen />);
      type("Password", "pw-123456");
      type("6-digit code", "123456");
      fireEvent.click(screen.getByText("Get new recovery codes"));
      await screen.findByText("EEEE-FFFF-GGGG-HHHH");
      expect(h.replaceRecoveryCodes).toHaveBeenCalledWith(
        { password: "pw-123456" },
        "123456",
      );
    });
  });
});
