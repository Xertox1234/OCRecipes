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
vi.mock("@/hooks/useSignInMethods", () => ({
  useSignedInEmailCode: () => ({ send: vi.fn() }),
}));

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
  // clearAllMocks keeps queued *Once replies; a test that never sends would
  // leak its reply into the next one.
  auth.changePassword.mockReset();
  auth.requestPasswordChangeCode.mockReset();
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

  it("SECOND_FACTOR_REQUIRED reveals the two-step code field, then sends it", async () => {
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

  // Review (code): a two-step account knows its rule (8) up front and is
  // asked for the two-step code with the first submit.
  it("two-step on: the 8-character hint and the code field from the start", () => {
    renderScreen({ hasPassword: true, providers: [], mfaEnabled: true });
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();
    expect(screen.getByLabelText("6-digit code")).toBeTruthy();
  });

  // Owner ruling 4: a two-step account never types two emailed codes.
  it("two-step on: the emailed change code alone saves — no second code field", async () => {
    auth.requestPasswordChangeCode.mockResolvedValue(undefined);
    auth.changePassword.mockResolvedValue({ done: true });
    renderScreen({ hasPassword: false, providers: [], mfaEnabled: true });
    await act(async () => tap("Email me a code"));
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
    type("Code from the email", "654321");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(auth.changePassword).toHaveBeenCalledWith(
      { emailCode: "654321" },
      NEW,
      undefined,
    );
  });

  it("two-step on + current password: the code field offers Email me a code", () => {
    renderScreen({ hasPassword: true, providers: [], mfaEnabled: true });
    expect(screen.getByLabelText("6-digit code")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Email me a code" }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Use a recovery code instead")).toBeNull();
  });

  it("two-step on: Google/Apple needs no two-step code field", () => {
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

  // Review (code, 2nd round): an empty two-step field never sends — that
  // would spend one of the code's 5 guesses.
  it("two-step on: Save with the two-step field empty sends nothing and says why", async () => {
    renderScreen({ hasPassword: true, providers: [], mfaEnabled: true });
    type("Current password", "old-pass");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(
      screen.getByText("Enter the two-step code we email you."),
    ).toBeTruthy();
  });

  it("SECOND_FACTOR_REQUIRED says to enter the emailed two-step code", async () => {
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
    expect(
      screen.getByText("Enter the two-step code we email you."),
    ).toBeTruthy();
  });

  // Review (mobile, 2nd round): a new code clears the old code's invalid mark.
  it("Send a new code clears the code field's invalid mark", async () => {
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
    await act(async () => tap("Send a new code"));
    expect(
      screen.getByLabelText("Code from the email").getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  // Review (confirmation pass): a code typed on the current-password view is
  // dropped when the person switches to the emailed code — the field they
  // see there is gone, so nothing hidden may be sent.
  it("two-step on: a code typed before 'I forgot it' is never sent with the emailed change code", async () => {
    auth.requestPasswordChangeCode.mockResolvedValue(undefined);
    auth.changePassword.mockResolvedValue({ done: true });
    renderScreen({ hasPassword: true, providers: [], mfaEnabled: true });
    type("6-digit code", "111111");
    tap("I forgot it");
    await act(async () => tap("Email me a code"));
    type("Code from the email", "123456");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(auth.changePassword).toHaveBeenCalledWith(
      { emailCode: "123456" },
      NEW,
      undefined,
    );
  });
});
