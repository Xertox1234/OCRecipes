// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { ApiError } from "@/lib/api-error";
import type { SocialProvider } from "@shared/types/auth";
import { renderComponent } from "../../../test/utils/render-component";
import ChangePasswordScreen from "../ChangePasswordScreen";

const auth = vi.hoisted(() => ({
  changePassword: vi.fn(),
  requestPasswordChangeCode: vi.fn(),
}));
vi.mock("@/context/AuthContext", () => ({ useAuthContext: () => auth }));
// The replacement-code card copies with expo-clipboard (native module).
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

const navigation = { goBack: vi.fn() };
const NEW = "a-long-new-passphrase-1";

function renderScreen(p: {
  hasPassword: boolean;
  providers: SocialProvider[];
  mfaEnabled?: boolean;
}) {
  const params = { mfaEnabled: false, ...p };
  // The screen only reads route.params and navigation.goBack.
  const props = {
    route: { key: "ChangePassword", name: "ChangePassword", params },
    navigation,
  } as unknown as React.ComponentProps<typeof ChangePasswordScreen>;
  return renderComponent(<ChangePasswordScreen {...props} />);
}
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const tap = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ChangePasswordScreen", () => {
  it("shows the current-password field and 'I forgot it' when the account has a password", () => {
    renderScreen({ hasPassword: true, providers: [] });
    expect(screen.getByLabelText("Current password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "I forgot it" })).toBeTruthy();
  });

  it("a password-less account starts at the forgot options", () => {
    renderScreen({ hasPassword: false, providers: ["google"] });
    expect(screen.queryByLabelText("Current password")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Confirm with Google" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Email me a code" }),
    ).toBeTruthy();
  });

  it("saves with the current password and goes back", async () => {
    auth.changePassword.mockResolvedValue({ done: true });
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "old-pass");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(auth.changePassword).toHaveBeenCalledWith(
      { password: "old-pass" },
      NEW,
      undefined,
    );
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it("Confirm with Google saves with the provider proof", async () => {
    auth.changePassword.mockResolvedValue({ done: true });
    renderScreen({ hasPassword: false, providers: ["google"] });
    type("New password", NEW);
    await act(async () => tap("Confirm with Google"));
    expect(auth.changePassword).toHaveBeenCalledWith(
      { provider: "google" },
      NEW,
      undefined,
    );
  });

  it("a cancelled Google sheet stays on the screen", async () => {
    auth.changePassword.mockResolvedValue({ done: false });
    renderScreen({ hasPassword: false, providers: ["google"] });
    type("New password", NEW);
    await act(async () => tap("Confirm with Google"));
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  it("Email me a code → sends, then shows the code field and saves with { emailCode }", async () => {
    auth.requestPasswordChangeCode.mockResolvedValue(undefined);
    auth.changePassword.mockResolvedValue({ done: true });
    renderScreen({ hasPassword: true, providers: [] });
    tap("I forgot it");
    await act(async () => tap("Email me a code"));
    expect(auth.requestPasswordChangeCode).toHaveBeenCalledTimes(1);
    type("Code from the email", "123456");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(auth.changePassword).toHaveBeenCalledWith(
      { emailCode: "123456" },
      NEW,
      undefined,
    );
  });

  it("the daily code limit shows the plain message and stays on the options", async () => {
    auth.requestPasswordChangeCode.mockRejectedValueOnce(
      new ApiError(
        `429: ${JSON.stringify({
          error:
            "You've requested too many codes today. Try again tomorrow, or use Google/Apple.",
          code: "RATE_LIMITED",
        })}`,
        "RATE_LIMITED",
        429,
      ),
    );
    renderScreen({ hasPassword: false, providers: [] });
    await act(async () => tap("Email me a code"));
    expect(
      screen.getByText(
        "You've requested too many codes today. Try again tomorrow, or use Google/Apple.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Code from the email")).toBeNull();
  });

  it("SECOND_FACTOR_REQUIRED reveals the authenticator field, then sends it", async () => {
    auth.changePassword.mockRejectedValueOnce(
      new ApiError(
        '403: {"code":"SECOND_FACTOR_REQUIRED"}',
        "SECOND_FACTOR_REQUIRED",
        403,
      ),
    );
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "old-pass");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(screen.getByLabelText("6-digit code")).toBeTruthy();
    auth.changePassword.mockResolvedValueOnce({ done: true });
    type("6-digit code", "123456");
    await act(async () => tap("Save new password"));
    expect(auth.changePassword).toHaveBeenLastCalledWith(
      { password: "old-pass" },
      NEW,
      { code: "123456" },
    );
  });

  it("a wrong current password shows the plain message and stays", async () => {
    auth.changePassword.mockRejectedValueOnce(
      new ApiError('401: {"code":"UNAUTHORIZED"}', "UNAUTHORIZED", 401),
    );
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "nope");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(screen.getByText("That didn't match. Try again.")).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  // Review Focus 5.
  it("a second tap while saving sends nothing more", async () => {
    let resolve!: () => void;
    auth.changePassword.mockReturnValue(
      new Promise((r) => {
        resolve = () => r({ done: true });
      }),
    );
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "old-pass");
    type("New password", NEW);
    // Both taps inside one act: no re-render between them, so the disabled
    // prop can't stop the second — only the busy ref can (two taps in a frame).
    const save = screen.getByRole("button", { name: "Save new password" });
    act(() => {
      fireEvent.click(save);
      fireEvent.click(save);
    });
    await act(async () => resolve());
    expect(auth.changePassword).toHaveBeenCalledTimes(1);
  });

  it("a spent recovery code's replacement is shown before going back", async () => {
    auth.changePassword.mockResolvedValue({
      done: true,
      replacementRecoveryCode: "r-1",
    });
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "old-pass");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(screen.getByText("r-1")).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  // Review (security): a spent recovery code then a refused change must not
  // look like success — the new code shows, AND the error and form stay.
  it("a refused change after a spent recovery code keeps the error and the form", async () => {
    auth.changePassword.mockRejectedValueOnce(
      new ApiError(
        '400: {"error":"Too short for this account.","code":"PASSWORD_TOO_SHORT","replacementRecoveryCode":"r-9"}',
        "PASSWORD_TOO_SHORT",
        400,
      ),
    );
    renderScreen({ hasPassword: true, providers: [], mfaEnabled: true });
    type("Current password", "old-pass");
    type("New password", "short");
    await act(async () => tap("Save new password"));
    expect(screen.getByText("r-9")).toBeTruthy();
    expect(screen.getByText("Too short for this account.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Save new password" }),
    ).toBeTruthy();
    expect(navigation.goBack).not.toHaveBeenCalled();
  });

  // Review (code): a two-step account knows its rule (8) up front and is
  // asked for the authenticator code with the first submit.
  it("two-step on: the 8-character hint and the code field from the start", () => {
    renderScreen({ hasPassword: true, providers: [], mfaEnabled: true });
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();
    expect(screen.getByLabelText("6-digit code")).toBeTruthy();
  });

  it("two-step on: Google/Apple needs no authenticator code field", () => {
    renderScreen({
      hasPassword: false,
      providers: ["google"],
      mfaEnabled: true,
    });
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
  });

  // Review (mobile): the field an error belongs to is marked invalid.
  it.each([
    ["UNAUTHORIZED", 401, "Current password"],
    ["PASSWORD_TOO_SHORT", 400, "New password"],
  ])("%s marks %s invalid", async (code, status, label) => {
    auth.changePassword.mockRejectedValueOnce(
      new ApiError(`${status}: {"error":"x","code":"${code}"}`, code, status),
    );
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "old-pass");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(screen.getByLabelText(label).getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("a wrong emailed code marks the code field invalid", async () => {
    auth.requestPasswordChangeCode.mockResolvedValue(undefined);
    auth.changePassword.mockRejectedValueOnce(
      new ApiError(
        '400: {"error":"x","code":"INVALID_RESET_CODE"}',
        "INVALID_RESET_CODE",
        400,
      ),
    );
    renderScreen({ hasPassword: false, providers: [] });
    await act(async () => tap("Email me a code"));
    type("Code from the email", "000000");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(
      screen.getByLabelText("Code from the email").getAttribute("aria-invalid"),
    ).toBe("true");
  });
});
