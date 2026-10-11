// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { renderComponent } from "../../../test/utils/render-component";
import PasswordUpgradeScreen from "../PasswordUpgradeScreen";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import { ApiError } from "@/lib/api-error";

type Props = NativeStackScreenProps<RootStackParamList, "PasswordUpgrade">;

const h = vi.hoisted(() => ({
  upgradeStartTwoStep: vi.fn(),
  upgradeConfirmTwoStep: vi.fn(),
  upgradeSetPassword: vi.fn(),
  finishSignIn: vi.fn(),
  copy: vi.fn(),
  usePreventRemove: vi.fn(),
}));

vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    upgradeStartTwoStep: h.upgradeStartTwoStep,
    upgradeConfirmTwoStep: h.upgradeConfirmTwoStep,
    upgradeSetPassword: h.upgradeSetPassword,
    finishSignIn: h.finishSignIn,
  }),
}));
vi.mock("expo-clipboard", () => ({ setStringAsync: h.copy }));
vi.mock("@react-navigation/native", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  usePreventRemove: h.usePreventRemove,
}));

const SECRET = { secret: "ABCDEFGHIJKLMNOP", otpauthUrl: "otpauth://totp/x" };
const CODES = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-DD${i}D`);
const SESSION = {
  status: "signed_in" as const,
  user: { id: "u1", username: "me" },
  token: "t-new",
};

function renderScreen(
  params: Partial<Props["route"]["params"]> = {},
): Props["navigation"] {
  const route = {
    params: {
      pass: "pass-1",
      canUseTwoStep: true,
      purpose: "login",
      ...params,
    },
  } as unknown as Props["route"];
  const navigation = {
    goBack: vi.fn(),
    dispatch: vi.fn(),
    setOptions: vi.fn(),
  } as unknown as Props["navigation"];
  renderComponent(
    <PasswordUpgradeScreen route={route} navigation={navigation} />,
  );
  return navigation;
}

const TWO_STEP = "Turn on two-step verification";
const LONGER = "Choose a longer password";
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));
const lastGuard = () => h.usePreventRemove.mock.calls.at(-1)?.[0] as boolean;

beforeEach(() => {
  vi.clearAllMocks();
  h.copy.mockResolvedValue(true);
});

describe("PasswordUpgradeScreen — the choice", () => {
  it("offers two-step first, then a longer password", () => {
    renderScreen();
    const names = screen
      .getAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t === TWO_STEP || t === LONGER);
    expect(names).toEqual([TWO_STEP, LONGER]);
  });

  it("a pass that can't use two-step offers only the longer password", () => {
    renderScreen({ canUseTwoStep: false });
    expect(screen.queryByRole("button", { name: TWO_STEP })).toBeNull();
    expect(screen.getByRole("button", { name: LONGER })).toBeTruthy();
  });

  it("from the Connect prompt it says to tap Google or Apple again after", () => {
    renderScreen({ purpose: "link" });
    expect(
      screen.getByText("After this, tap Google or Apple again to connect it."),
    ).toBeTruthy();
  });
});

describe("PasswordUpgradeScreen — turning on two-step", () => {
  it("does NOT sign in until the recovery codes are saved, then signs in once", async () => {
    h.upgradeStartTwoStep.mockResolvedValue(SECRET);
    h.upgradeConfirmTwoStep.mockResolvedValue({
      session: SESSION,
      recoveryCodes: CODES,
    });
    renderScreen();

    press(TWO_STEP);
    await screen.findByText("ABCD EFGH IJKL MNOP");
    expect(h.upgradeStartTwoStep).toHaveBeenCalledWith("pass-1");
    press("Next");
    type("6-digit code", "123456");
    press("Confirm");
    await screen.findByText(CODES[0]);
    expect(h.upgradeConfirmTwoStep).toHaveBeenCalledWith("pass-1", "123456");

    // Codes on screen, session held: not signed in, and leaving is guarded.
    expect(h.finishSignIn).not.toHaveBeenCalled();
    expect(lastGuard()).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "I've saved these" }));
    expect(lastGuard()).toBe(false);
    press("Done");
    expect(h.finishSignIn).toHaveBeenCalledTimes(1);
    expect(h.finishSignIn).toHaveBeenCalledWith(SESSION.user, SESSION.token);
  });

  it("setup closed on the server → back to the choice with only the longer password", async () => {
    h.upgradeStartTwoStep.mockRejectedValue(
      new ApiError("403: x", "MFA_SETUP_DISABLED", 403),
    );
    renderScreen();
    press(TWO_STEP);
    expect(
      await screen.findByText(
        "Two-step verification isn't available right now. Choose a longer password instead.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: TWO_STEP })).toBeNull();
    expect(screen.getByRole("button", { name: LONGER })).toBeTruthy();
  });
});

describe("PasswordUpgradeScreen — a longer password", () => {
  it("14 characters is caught before sending", async () => {
    renderScreen();
    press(LONGER);
    type("New password", "a".repeat(14));
    type("Confirm new password", "a".repeat(14));
    press("Save and sign in");
    expect(await screen.findByText("Use at least 15 characters.")).toBeTruthy();
    expect(h.upgradeSetPassword).not.toHaveBeenCalled();
  });

  it("15+ characters that match → saved on the pass (which signs in)", async () => {
    h.upgradeSetPassword.mockResolvedValue(undefined);
    renderScreen();
    press(LONGER);
    type("New password", "a much longer password");
    type("Confirm new password", "a much longer password");
    press("Save and sign in");
    await waitFor(() =>
      expect(h.upgradeSetPassword).toHaveBeenCalledWith(
        "pass-1",
        "a much longer password",
      ),
    );
  });

  it("a breached password gets the breach sentence", async () => {
    h.upgradeSetPassword.mockRejectedValue(
      new ApiError("400: x", "PASSWORD_BREACHED", 400),
    );
    renderScreen();
    press(LONGER);
    type("New password", "a much longer password");
    type("Confirm new password", "a much longer password");
    press("Save and sign in");
    expect(
      await screen.findByText(
        "That password has appeared in a data breach. Choose a different one.",
      ),
    ).toBeTruthy();
  });
});

describe("PasswordUpgradeScreen — an expired pass", () => {
  it("says so and offers the way back to sign-in", async () => {
    h.upgradeSetPassword.mockRejectedValue(
      new ApiError("401: x", "UPGRADE_PASS_EXPIRED", 401),
    );
    const navigation = renderScreen();
    press(LONGER);
    type("New password", "a much longer password");
    type("Confirm new password", "a much longer password");
    press("Save and sign in");
    expect(
      await screen.findByText("This sign-in expired. Please sign in again."),
    ).toBeTruthy();
    press("Back to sign in");
    expect(navigation.goBack).toHaveBeenCalled();
  });
});
