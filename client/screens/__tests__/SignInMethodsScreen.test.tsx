// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { SignInMethods } from "@shared/types/auth";
import type { ConfirmOptions } from "@/components/ConfirmationModal";
import { ApiError } from "@/lib/api-error";
import { renderComponent } from "../../../test/utils/render-component";
import SignInMethodsScreen from "../SignInMethodsScreen";

const h = vi.hoisted(() => ({
  methods: undefined as SignInMethods | undefined,
  mfaEnabled: false,
  isError: false,
  refetch: vi.fn(),
  setMethods: vi.fn(),
  connectProvider: vi.fn(),
  disconnectProvider: vi.fn(),
  logout: vi.fn(),
  confirm: vi.fn<(o: ConfirmOptions) => void>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  navigate: vi.fn(),
  forgetTrustedPhones: vi.fn(),
  config: { apple: true, google: false },
}));

vi.mock("@/hooks/useSocialConfig", () => ({
  useSocialConfig: () => h.config,
}));

vi.mock("@/hooks/useSignInMethods", () => ({
  useSignInMethods: () => ({
    methods: h.methods,
    mfaEnabled: h.mfaEnabled,
    isError: h.isError,
    refetch: h.refetch,
    setMethods: h.setMethods,
  }),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    user: { id: "u1", username: "me", email: "me@example.com" },
    connectProvider: h.connectProvider,
    disconnectProvider: h.disconnectProvider,
    logout: h.logout,
    forgetTrustedPhones: h.forgetTrustedPhones,
  }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: h.toastSuccess, error: h.toastError }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ setOptions: vi.fn(), navigate: h.navigate }),
}));
vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: h.confirm,
    ConfirmationModal: () => null,
    behindContentA11yProps: {},
    isOpen: false,
  }),
}));

// The replacement-code card copies with expo-clipboard (native module).
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

const relay = { email: "x@privaterelay.appleid.com", isPrivateRelay: true };

beforeEach(() => {
  vi.clearAllMocks();
  h.methods = undefined;
  h.mfaEnabled = false;
  h.isError = false;
  h.config = { apple: true, google: false };
});

describe("SignInMethodsScreen", () => {
  it("shows a loading state until the methods arrive", () => {
    renderComponent(<SignInMethodsScreen />);
    expect(screen.getByLabelText("Loading sign-in methods")).toBeTruthy();
  });

  it("a failed load offers a retry instead of spinning forever", () => {
    h.isError = true;
    renderComponent(<SignInMethodsScreen />);
    expect(screen.getByText(/Couldn't load your sign-in methods/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(h.refetch).toHaveBeenCalled();
  });

  it("lists the password and Apple rows; Apple relay email is hidden", () => {
    h.methods = { password: true, google: null, apple: relay };
    renderComponent(<SignInMethodsScreen />);
    expect(screen.getByText("Password")).toBeTruthy();
    expect(screen.getByText("Apple")).toBeTruthy();
    expect(screen.getByText("Hidden by Apple")).toBeTruthy();
    expect(screen.queryByText(/privaterelay/)).toBeNull();
    expect(screen.queryByText("Google")).toBeNull();
  });

  it("connect asks for the password, then saves the new methods", async () => {
    h.methods = { password: true, google: null, apple: null };
    const next = { password: true, google: null, apple: relay };
    h.connectProvider.mockResolvedValue({ signInMethods: next });
    renderComponent(<SignInMethodsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Apple" }));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(h.setMethods).toHaveBeenCalledWith(next));
    expect(h.connectProvider).toHaveBeenCalledWith("apple", "pw-1");
    expect(h.toastSuccess).toHaveBeenCalled();
  });

  it("cancelling the Apple sheet keeps the password prompt open", async () => {
    h.methods = { password: true, google: null, apple: null };
    h.connectProvider.mockResolvedValue(null);
    renderComponent(<SignInMethodsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Apple" }));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(h.connectProvider).toHaveBeenCalled());
    // Let the resolved null settle before checking the prompt survived it.
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Continue" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(h.setMethods).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
  });

  it("a failed connect shows static copy in the prompt", async () => {
    h.methods = { password: true, google: null, apple: null };
    h.connectProvider.mockRejectedValue(
      new ApiError("Invalid credentials", "UNAUTHORIZED", 401),
    );
    renderComponent(<SignInMethodsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Connect Apple" }));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "nope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/Incorrect password/)).toBeTruthy();
    expect(h.setMethods).not.toHaveBeenCalled();
  });

  it("Apple can't be connected while the server has no Apple key", () => {
    h.methods = { password: true, google: null, apple: null };
    h.config = { apple: false, google: false };
    renderComponent(<SignInMethodsScreen />);
    expect(screen.queryByRole("button", { name: "Connect Apple" })).toBeNull();
  });

  it("no password: connect is not offered and the row says why", () => {
    h.methods = {
      password: false,
      google: { email: "a@gmail.com" },
      apple: null,
    };
    renderComponent(<SignInMethodsScreen />);
    expect(screen.queryByRole("button", { name: "Connect Apple" })).toBeNull();
    expect(screen.getByText(/Set up a password first/)).toBeTruthy();
  });

  it("the only method cannot be disconnected", () => {
    h.methods = { password: false, google: null, apple: relay };
    renderComponent(<SignInMethodsScreen />);
    const btn = screen.getByRole("button", { name: "Disconnect Apple" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    expect(
      screen.getByText(/Add a password or another sign-in method/),
    ).toBeTruthy();
  });

  it("disconnect confirms in the in-app sheet, then saves", async () => {
    h.methods = { password: true, google: null, apple: relay };
    const next = { password: true, google: null, apple: null };
    h.disconnectProvider.mockResolvedValue(next);
    renderComponent(<SignInMethodsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect Apple" }));
    expect(h.confirm).toHaveBeenCalledTimes(1);
    act(() => h.confirm.mock.calls[0][0].onConfirm());
    await waitFor(() => expect(h.setMethods).toHaveBeenCalledWith(next));
    expect(h.disconnectProvider).toHaveBeenCalledWith("apple");
  });

  it("setting up a password opens Set a password — no sign-out", () => {
    h.methods = { password: false, google: null, apple: relay };
    renderComponent(<SignInMethodsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Set up a password" }));
    // The test runtime is iOS with both SDKs; device filtering is pinned in
    // SignInMethodsScreen-utils (reauthProviders).
    expect(h.navigate).toHaveBeenCalledWith("ChangePassword", {
      hasPassword: false,
      providers: ["apple"],
      mfaEnabled: false,
    });
    expect(h.confirm).not.toHaveBeenCalled();
    expect(h.logout).not.toHaveBeenCalled();
  });

  it("passes two-step on to Change password (8-character rule, code up front)", () => {
    h.methods = { password: true, google: null, apple: null };
    h.mfaEnabled = true;
    renderComponent(<SignInMethodsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(h.navigate).toHaveBeenCalledWith(
      "ChangePassword",
      expect.objectContaining({ mfaEnabled: true }),
    );
  });

  it("the password row's Change opens Change password with the account's shape", () => {
    h.methods = { password: true, google: null, apple: relay };
    renderComponent(<SignInMethodsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    // The test runtime is iOS with both SDKs; device filtering is pinned in
    // SignInMethodsScreen-utils (reauthProviders).
    expect(h.navigate).toHaveBeenCalledWith("ChangePassword", {
      hasPassword: true,
      providers: ["apple"],
      mfaEnabled: false,
    });
    expect(h.logout).not.toHaveBeenCalled();
  });
});

describe("SignInMethodsScreen — connecting on a 2FA account", () => {
  const openPrompt = () => {
    fireEvent.click(screen.getByRole("button", { name: "Connect Apple" }));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-1" },
    });
  };

  it("asks for the code with the password and sends both", async () => {
    h.methods = { password: true, google: null, apple: null };
    h.mfaEnabled = true;
    const next = { password: true, google: null, apple: relay };
    h.connectProvider.mockResolvedValue({ signInMethods: next });
    renderComponent(<SignInMethodsScreen />);
    openPrompt();
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(h.setMethods).toHaveBeenCalledWith(next));
    expect(h.connectProvider).toHaveBeenCalledWith("apple", "pw-1", {
      code: "123456",
    });
  });

  it("a SECOND_FACTOR_REQUIRED answer reveals the code field", async () => {
    h.methods = { password: true, google: null, apple: null };
    h.connectProvider.mockRejectedValue(
      new ApiError(
        `403: ${JSON.stringify({ code: "SECOND_FACTOR_REQUIRED", error: "x" })}`,
        "SECOND_FACTOR_REQUIRED",
        403,
      ),
    );
    renderComponent(<SignInMethodsScreen />);
    openPrompt();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByLabelText("6-digit code")).toBeTruthy();
  });

  it("a spent recovery code's replacement is shown before the prompt closes", async () => {
    h.methods = { password: true, google: null, apple: null };
    h.mfaEnabled = true;
    const next = { password: true, google: null, apple: relay };
    h.connectProvider.mockResolvedValue({
      signInMethods: next,
      replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD",
    });
    renderComponent(<SignInMethodsScreen />);
    openPrompt();
    fireEvent.click(screen.getByText("Use a recovery code instead"));
    fireEvent.change(screen.getByLabelText("Recovery code"), {
      target: { value: "WXYZ-WXYZ-WXYZ-WXYZ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("AAAA-BBBB-CCCC-DDDD");
    expect(h.setMethods).toHaveBeenCalledWith(next);
    expect(h.toastSuccess).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("I've saved it"));
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
  });

  it("a failed connect that spent a recovery code still shows its replacement", async () => {
    h.methods = { password: true, google: null, apple: null };
    h.mfaEnabled = true;
    h.connectProvider.mockRejectedValue(
      new ApiError(
        `409: ${JSON.stringify({ code: "IDENTITY_IN_USE", error: "x", replacementRecoveryCode: "AAAA-BBBB-CCCC-DDDD" })}`,
        "IDENTITY_IN_USE",
        409,
      ),
    );
    renderComponent(<SignInMethodsScreen />);
    openPrompt();
    fireEvent.click(screen.getByText("Use a recovery code instead"));
    fireEvent.change(screen.getByLabelText("Recovery code"), {
      target: { value: "WXYZ-WXYZ-WXYZ-WXYZ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("AAAA-BBBB-CCCC-DDDD");
  });
});

describe("SignInMethodsScreen — Security (two-step verification)", () => {
  it("off, with a password: offers to turn it on", () => {
    h.methods = { password: true, google: null, apple: null };
    renderComponent(<SignInMethodsScreen />);
    fireEvent.click(
      screen.getByRole("button", { name: "Turn on two-step verification" }),
    );
    expect(h.navigate).toHaveBeenCalledWith("TwoStepSetup", { mode: "setup" });
  });

  it("no password: explains why it can't be turned on", () => {
    h.methods = { password: false, google: null, apple: relay };
    renderComponent(<SignInMethodsScreen />);
    expect(
      screen.getByText("Set a password to turn on two-step verification"),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Turn on two-step verification" }),
    ).toBeNull();
  });

  it("on: new phone, new codes, turn off and forget trusted phones", () => {
    h.methods = { password: true, google: null, apple: null };
    h.mfaEnabled = true;
    renderComponent(<SignInMethodsScreen />);
    expect(screen.getByText("On")).toBeTruthy();
    for (const [name, mode] of [
      ["Set up on a new phone", "new_phone"],
      ["New recovery codes", "new_codes"],
      ["Turn off two-step verification", "disable"],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(h.navigate).toHaveBeenLastCalledWith("TwoStepSetup", { mode });
    }
    expect(
      screen.getByRole("button", { name: "Forget trusted phones" }),
    ).toBeTruthy();
  });

  it("forgetting trusted phones confirms first, then forgets them", async () => {
    h.methods = { password: true, google: null, apple: null };
    h.mfaEnabled = true;
    h.forgetTrustedPhones.mockResolvedValue(undefined);
    renderComponent(<SignInMethodsScreen />);
    fireEvent.click(
      screen.getByRole("button", { name: "Forget trusted phones" }),
    );
    expect(h.forgetTrustedPhones).not.toHaveBeenCalled();
    const opts = h.confirm.mock.calls.at(-1)?.[0];
    act(() => {
      opts?.onConfirm();
    });
    expect(h.forgetTrustedPhones).toHaveBeenCalled();
    await waitFor(() => expect(h.toastSuccess).toHaveBeenCalled());
  });
});
