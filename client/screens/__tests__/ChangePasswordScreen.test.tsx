// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import { ApiError } from "@/lib/api-error";
import type { SocialProvider } from "@shared/types/auth";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { reactProps } from "../../../test/utils/react-props";
import ChangePasswordScreen from "../ChangePasswordScreen";

const { withSequenceSpy } = vi.hoisted(() => ({
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
}));

// The InlineError shake runs one withSequence per validation reject.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

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

  // #72: an empty submit went to the server, whose 400 surfaced as "Something
  // went wrong" with no field marked.
  it("an empty submit sends nothing and marks the current-password field", async () => {
    renderScreen({ hasPassword: true, providers: [] });
    await act(async () => tap("Save new password"));
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText("Enter your current password.")).toBeTruthy();
    expect(
      screen.getByLabelText("Current password").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it("a missing new password sends nothing and marks that field", async () => {
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "old-pass");
    await act(async () => tap("Save new password"));
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a new password.")).toBeTruthy();
    expect(
      screen.getByLabelText("New password").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("a missing emailed code sends nothing and marks the code field", async () => {
    auth.requestPasswordChangeCode.mockResolvedValue(undefined);
    renderScreen({ hasPassword: true, providers: [] });
    tap("I forgot it");
    await act(async () => tap("Email me a code"));
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText("Enter the code from the email.")).toBeTruthy();
    expect(
      screen.getByLabelText("Code from the email").getAttribute("aria-invalid"),
    ).toBe("true");
  });

  it("Confirm with Google without a new password opens no sheet", async () => {
    renderScreen({ hasPassword: false, providers: ["google"] });
    await act(async () => tap("Confirm with Google"));
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a new password.")).toBeTruthy();
  });

  // #72: placeholders were the only visible labels — gone once you type.
  it("shows visible labels, not just placeholders", () => {
    renderScreen({ hasPassword: true, providers: [] });
    expect(screen.getByText("Current password")).toBeTruthy();
    expect(screen.getByText("New password")).toBeTruthy();
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
    fireEvent.focus(screen.getByLabelText("New password"));
    expect(screen.getByText("At least 8 characters")).toBeTruthy();
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

// Form-fields spec §5.1: Save flags every empty field and moves focus to the
// first; a field's message clears on the keystroke that fills it.
describe("ChangePasswordScreen — validation timing", () => {
  it("Save with both fields empty flags both and focuses the current password", async () => {
    renderScreen({ hasPassword: true, providers: [] });
    await act(async () => tap("Save new password"));
    expect(screen.getByText("Enter your current password.")).toBeTruthy();
    expect(screen.getByText("Enter a new password.")).toBeTruthy();
    expect(
      screen.getByLabelText("New password").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByLabelText("Current password"),
    );
  });

  it("a flagged field's message clears as soon as it is filled", async () => {
    renderScreen({ hasPassword: true, providers: [] });
    await act(async () => tap("Save new password"));
    type("Current password", "old-pass");
    expect(screen.queryByText("Enter your current password.")).toBeNull();
    expect(
      screen.getByLabelText("Current password").getAttribute("aria-invalid"),
    ).not.toBe("true");
  });

  it("Confirm with Google with no new password focuses the new password", async () => {
    renderScreen({ hasPassword: false, providers: ["google"] });
    await act(async () => tap("Confirm with Google"));
    expect(document.activeElement).toBe(screen.getByLabelText("New password"));
  });
});

// A checklist line on show: mounted AND not hidden from screen readers (a
// closed checklist keeps its lines mounted under a zero height).
function shownRule(label: string): HTMLElement | null {
  const el = screen.queryByLabelText(label);
  return el && !el.closest('[aria-hidden="true"]') ? el : null;
}

// Form-fields spec §5.2: the new password's rule ticks as you type.
describe("ChangePasswordScreen — rule checklist", () => {
  it("shows the length rule on focus and ticks it at the minimum", () => {
    renderScreen({ hasPassword: true, providers: [] });
    const input = screen.getByLabelText("New password");
    expect(shownRule("At least 8 characters")).toBeNull();
    fireEvent.focus(input);
    expect(screen.getByLabelText("At least 8 characters")).toBeTruthy();
    fireEvent.change(input, { target: { value: NEW } });
    expect(screen.getByLabelText("At least 8 characters, done")).toBeTruthy();
  });

  // Follow-up from Task 9 review: leaving a short password showed only a
  // silent red checklist line until Save. Task 8 timing — leaving a non-empty
  // field checks it — gives it the same field error as the other password
  // screens, and the checklist hides the line the error now says.
  it("leaving a short password shows its field error and hides the unmet line", () => {
    renderScreen({ hasPassword: true, providers: [] });
    const input = screen.getByLabelText("New password");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "abc" } });
    expect(screen.queryByText("Use at least 8 characters.")).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(shownRule("At least 8 characters")).toBeNull();
  });

  it("a short password never goes to the server", async () => {
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "old-pass");
    type("New password", "abc");
    await act(async () => tap("Save new password"));
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(screen.getByText("Use at least 8 characters.")).toBeTruthy();
    expect(shownRule("At least 8 characters")).toBeNull();
  });
});

// Form-fields spec §5.7: nothing can be edited while the request runs.
describe("ChangePasswordScreen — fields lock while saving", () => {
  it("the fields cannot be edited while the save is pending", async () => {
    auth.changePassword.mockReturnValue(new Promise(() => {}));
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "old-pass");
    type("New password", NEW);
    expect(reactProps(screen.getByLabelText("New password")).editable).not.toBe(
      false,
    );
    await act(async () => tap("Save new password"));
    expect(reactProps(screen.getByLabelText("Current password")).editable).toBe(
      false,
    );
    expect(reactProps(screen.getByLabelText("New password")).editable).toBe(
      false,
    );
  });

  it("the emailed-code field locks too", async () => {
    auth.requestPasswordChangeCode.mockResolvedValue(undefined);
    auth.changePassword.mockReturnValue(new Promise(() => {}));
    renderScreen({ hasPassword: false, providers: [] });
    await act(async () => tap("Email me a code"));
    type("Code from the email", "123456");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(
      reactProps(screen.getByLabelText("Code from the email")).editable,
    ).toBe(false);
  });
});

// Form-fields spec §5.8: a validation reject shakes and buzzes, as on the
// other forms; a server error buzzes but never shakes.
describe("ChangePasswordScreen — shake on validation reject", () => {
  it("the same empty Save twice shakes twice and buzzes twice", async () => {
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "old-pass");
    await act(async () => tap("Save new password"));
    await act(async () => tap("Save new password"));
    expect(screen.getByText("Enter a new password.")).toBeTruthy();
    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it("a missing two-step code shakes and buzzes", async () => {
    renderScreen({ hasPassword: true, providers: [], mfaEnabled: true });
    type("Current password", "old-pass");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(
      screen.getByText("Enter the two-step code we email you."),
    ).toBeTruthy();
    expect(withSequenceSpy).toHaveBeenCalledTimes(1);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });

  it("a server error buzzes but does not shake", async () => {
    auth.changePassword.mockRejectedValueOnce(
      new ApiError('401: {"code":"UNAUTHORIZED"}', "UNAUTHORIZED", 401),
    );
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "wrong-pass");
    type("New password", NEW);
    await act(async () => tap("Save new password"));
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});

// Fix round 1 (spec §5.8): a field message is announced by its InlineError
// only — the field's hint must not repeat it, or VoiceOver reads it twice.
describe("ChangePasswordScreen — one announcement per field error", () => {
  it("a missing new password's message appears once in the a11y tree", async () => {
    renderScreen({ hasPassword: true, providers: [] });
    type("Current password", "old-pass");
    await act(async () => tap("Save new password"));

    const input = screen.getByLabelText("New password");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getAllByText("Enter a new password.")).toHaveLength(1);
    expect(input.getAttribute("aria-hint") ?? "").not.toContain(
      "Enter a new password.",
    );
  });
});
