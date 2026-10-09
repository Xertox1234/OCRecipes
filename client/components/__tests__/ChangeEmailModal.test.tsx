// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { ChangeEmailModal } from "../ChangeEmailModal";

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
