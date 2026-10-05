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
  setMethods: vi.fn(),
  connectProvider: vi.fn(),
  disconnectProvider: vi.fn(),
  logout: vi.fn(),
  confirm: vi.fn<(o: ConfirmOptions) => void>(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  config: { apple: true, google: false },
}));

vi.mock("@/hooks/useSocialConfig", () => ({
  useSocialConfig: () => h.config,
}));

vi.mock("@/hooks/useSignInMethods", () => ({
  useSignInMethods: () => ({ methods: h.methods, setMethods: h.setMethods }),
}));
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({
    user: { id: "u1", username: "me", email: "me@example.com" },
    connectProvider: h.connectProvider,
    disconnectProvider: h.disconnectProvider,
    logout: h.logout,
  }),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: h.toastSuccess, error: h.toastError }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ setOptions: vi.fn() }),
}));
vi.mock("@/components/ConfirmationModal", () => ({
  useConfirmationModal: () => ({
    confirm: h.confirm,
    ConfirmationModal: () => null,
    behindContentA11yProps: {},
    isOpen: false,
  }),
}));

const relay = { email: "x@privaterelay.appleid.com", isPrivateRelay: true };

beforeEach(() => {
  vi.clearAllMocks();
  h.methods = undefined;
  h.config = { apple: true, google: false };
});

describe("SignInMethodsScreen", () => {
  it("shows a loading state until the methods arrive", () => {
    renderComponent(<SignInMethodsScreen />);
    expect(screen.getByLabelText("Loading sign-in methods")).toBeTruthy();
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
    h.connectProvider.mockResolvedValue(next);
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
    await act(async () => {
      await h.confirm.mock.calls[0][0].onConfirm();
    });
    expect(h.disconnectProvider).toHaveBeenCalledWith("apple");
    expect(h.setMethods).toHaveBeenCalledWith(next);
  });

  it("setting up a password signs out via the confirm sheet", async () => {
    h.methods = { password: false, google: null, apple: relay };
    renderComponent(<SignInMethodsScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Set up a password" }));
    const opts = h.confirm.mock.calls[0][0];
    expect(opts.message).toMatch(/Forgot password\?/);
    await act(async () => {
      await opts.onConfirm();
    });
    expect(h.logout).toHaveBeenCalled();
  });
});
