// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { PasswordConfirmModal } from "../PasswordConfirmModal";

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
