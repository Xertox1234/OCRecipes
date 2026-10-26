// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { ChangeEmailModal } from "../ChangeEmailModal";
import { ApiError } from "@/lib/api-error";

const { withSequenceSpy } = vi.hoisted(() => ({
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
}));

// The InlineError shake runs one withSequence per validation reject.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

function renderModal(onConfirm = vi.fn()) {
  renderComponent(
    <ChangeEmailModal visible onClose={vi.fn()} onConfirm={onConfirm} />,
  );
  return onConfirm;
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: "Update email" }));
}

// Each validation reject gets the Error haptic and a shake; a server error
// gets the Error haptic only. One buzz per reject.
describe("ChangeEmailModal — reject feedback", () => {
  it.each([
    ["an invalid email", "nope", "nope", "pw", "Enter a valid email address"],
    [
      "mismatched emails",
      "a@b.com",
      "a@c.com",
      "pw",
      "Email addresses do not match",
    ],
    ["a missing password", "a@b.com", "a@b.com", "", "Password is required"],
  ])(
    "%s: buzzes once and shakes on each submit",
    (_name, email, confirm, password, message) => {
      const onConfirm = renderModal();
      type("New email address", email);
      type("Confirm new email address", confirm);
      type("Current password", password);

      submit();
      expect(screen.getByText(message)).toBeTruthy();
      expect(Haptics.notificationAsync).toHaveBeenCalledExactlyOnceWith(
        Haptics.NotificationFeedbackType.Error,
      );
      expect(withSequenceSpy).toHaveBeenCalledTimes(1);

      submit();
      expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
      expect(withSequenceSpy).toHaveBeenCalledTimes(2);
      expect(onConfirm).not.toHaveBeenCalled();
    },
  );

  it("a server error buzzes once but does not shake", async () => {
    renderModal(
      vi.fn().mockRejectedValue(new Error("401: Invalid credentials")),
    );
    type("New email address", "a@b.com");
    type("Confirm new email address", "a@b.com");
    type("Current password", "wrongpass");
    submit();

    expect(
      await screen.findByText("Incorrect password. Please try again."),
    ).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledExactlyOnceWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});

describe("ChangeEmailModal — two-step verification", () => {
  const fill = () => {
    type("New email address", "new@x.com");
    type("Confirm new email address", "new@x.com");
    type("Current password", "pw-1");
  };
  const codeError = (code: string, extra: object = {}) =>
    new ApiError(
      `403: ${JSON.stringify({ code, error: "x", ...extra })}`,
      code,
      403,
    );

  it("asks for the code up front when two-step is on, and sends it", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    renderComponent(
      <ChangeEmailModal
        visible
        askCode
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fill();
    type("6-digit code", "123456");
    submit();
    await vi.waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith("new@x.com", "pw-1", {
        code: "123456",
      }),
    );
  });

  it("a SECOND_FACTOR_REQUIRED answer reveals the code field and keeps the password", async () => {
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(codeError("SECOND_FACTOR_REQUIRED"))
      .mockResolvedValueOnce(undefined);
    renderModal(onConfirm);
    fill();
    submit();
    await screen.findByLabelText("6-digit code");
    expect(
      (screen.getByLabelText("Current password") as HTMLInputElement).value,
    ).toBe("pw-1");
    type("6-digit code", "123456");
    submit();
    await vi.waitFor(() =>
      expect(onConfirm).toHaveBeenLastCalledWith("new@x.com", "pw-1", {
        code: "123456",
      }),
    );
  });

  it("a wrong code shows the server's message", async () => {
    const onConfirm = vi.fn().mockRejectedValue(
      codeError("INVALID_SECOND_FACTOR", {
        error:
          "That code didn't work. After several wrong codes, codes pause for 15 minutes.",
      }),
    );
    renderComponent(
      <ChangeEmailModal
        visible
        askCode
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fill();
    type("6-digit code", "000000");
    submit();
    await screen.findByText(
      "That code didn't work. After several wrong codes, codes pause for 15 minutes.",
    );
  });
});

const fieldLabels = () =>
  screen.getAllByTestId("focus-field-label").map((n) => n.textContent);

describe("ChangeEmailModal — floating labels", () => {
  it("labels the fields in place of the static captions", () => {
    renderModal();
    expect(fieldLabels()).toEqual([
      "New email",
      "Confirm new email",
      "Password",
    ]);
    // The captions above each field are gone: the label text is the only
    // visible copy.
    expect(screen.queryByText("New email address")).toBeNull();
    expect(screen.queryByText("Confirm new email address")).toBeNull();
    expect(screen.queryByText("Current password")).toBeNull();
  });

  it("shows the email example once the label floats", () => {
    renderModal();
    expect(screen.queryByPlaceholderText("you@example.com")).toBeNull();
    fireEvent.focus(screen.getByLabelText("New email address"));
    expect(screen.getAllByPlaceholderText("you@example.com")).toHaveLength(1);
  });
});

// Form-fields spec §5.1: no error while typing; check on leaving a field
// with text; empty fields are flagged by Update email, focus on the first.
describe("ChangeEmailModal — validation timing", () => {
  it("shows no error while a bad email is typed, and shows it on leaving", () => {
    renderModal();
    const input = screen.getByLabelText("New email address");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "nope" } });
    expect(screen.queryByText("Enter a valid email address")).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText("Enter a valid email address")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    // Only the field at fault is marked.
    expect(
      screen.getByLabelText("Current password").getAttribute("aria-invalid"),
    ).toBeNull();
  });

  it("Update email with empty fields flags them and focuses the new email", () => {
    const onConfirm = renderModal();
    submit();
    const input = screen.getByLabelText("New email address");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByLabelText("Current password").getAttribute("aria-invalid"),
    ).toBe("true");
    expect(document.activeElement).toBe(input);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("the mismatch clears on the keystroke that makes the emails match", () => {
    renderModal();
    type("New email address", "a@b.com");
    type("Confirm new email address", "a@c.com");
    type("Current password", "pw");
    submit();
    expect(screen.getByText("Email addresses do not match")).toBeTruthy();
    type("Confirm new email address", "a@b.com");
    expect(screen.queryByText("Email addresses do not match")).toBeNull();
  });
});
