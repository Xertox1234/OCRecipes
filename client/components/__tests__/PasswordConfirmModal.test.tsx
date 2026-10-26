// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { reactProps } from "../../../test/utils/react-props";
import { PasswordConfirmModal } from "../PasswordConfirmModal";

const { withSequenceSpy } = vi.hoisted(() => ({
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
}));

// The InlineError shake runs one withSequence per validation reject.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

function renderModal(askCode = false) {
  const onCancel = vi.fn();
  const onSubmit = vi.fn();
  renderComponent(
    <PasswordConfirmModal
      visible
      title="Connect Apple"
      message="Enter your password to confirm it's you."
      busy={false}
      error={null}
      onCancel={onCancel}
      onSubmit={onSubmit}
      askCode={askCode}
    />,
  );
  return { onCancel, onSubmit };
}

describe("PasswordConfirmModal", () => {
  it("tapping outside cancels", () => {
    const { onCancel } = renderModal();
    fireEvent.click(screen.getByTestId("password-confirm-backdrop"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("with two-step on, the code field offers Email me a code and no recovery code", () => {
    renderModal(true);
    expect(screen.getByLabelText("Email me a code")).toBeTruthy();
    expect(screen.queryByLabelText("Use a recovery code instead")).toBeNull();
  });
});

const fieldLabels = () =>
  screen.getAllByTestId("focus-field-label").map((n) => n.textContent);

describe("PasswordConfirmModal — floating labels", () => {
  it("floats Password and 6-digit code, naming the inputs", () => {
    renderModal(true);
    expect(fieldLabels()).toEqual(["Password", "6-digit code"]);
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.getByLabelText("6-digit code")).toBeTruthy();
  });
});

// Form-fields spec §5.8: a validation reject shakes and buzzes, as on the
// other forms; the caller's server error never shakes.
describe("PasswordConfirmModal — shake on validation reject", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Continue with no password twice: says why, shakes and buzzes twice", () => {
    const { onSubmit } = renderModal();
    const cont = screen.getByRole("button", { name: "Continue" });
    fireEvent.click(cont);
    fireEvent.click(cont);
    expect(screen.getByText("Enter your password.")).toBeTruthy();
    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("with two-step on, a missing code says why and sends nothing", () => {
    const { onSubmit } = renderModal(true);
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      screen.getByText("Enter the two-step code we email you."),
    ).toBeTruthy();
    expect(withSequenceSpy).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("typing clears the reject message", () => {
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "p" },
    });
    expect(screen.queryByText("Enter your password.")).toBeNull();
  });

  it("Return on the password submits it", () => {
    const { onSubmit } = renderModal();
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-1" },
    });
    const props = reactProps(screen.getByLabelText("Password"));
    expect(props.returnKeyType).toBe("go");
    act(() => {
      (props.onSubmitEditing as () => void)();
    });
    expect(onSubmit).toHaveBeenCalledWith("pw-1");
  });
});
