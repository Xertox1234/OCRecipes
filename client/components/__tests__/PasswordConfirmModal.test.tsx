// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { PasswordConfirmModal } from "../PasswordConfirmModal";

// The replacement-code card copies with expo-clipboard (native module).
vi.mock("expo-clipboard", () => ({ setStringAsync: vi.fn() }));

function renderModal(replacementCode: string | null) {
  const onCancel = vi.fn();
  const onReplacementSaved = vi.fn();
  renderComponent(
    <PasswordConfirmModal
      visible
      title="Connect Apple"
      message="Enter your password to confirm it's you."
      busy={false}
      error={null}
      onCancel={onCancel}
      onSubmit={vi.fn()}
      replacementCode={replacementCode}
      onReplacementSaved={onReplacementSaved}
    />,
  );
  return { onCancel, onReplacementSaved };
}

describe("PasswordConfirmModal — a replacement recovery code on screen", () => {
  it("tapping outside does not close it; only 'I've saved it' moves on", () => {
    const { onCancel, onReplacementSaved } = renderModal("AAAA-BBBB-CCCC-DDDD");
    fireEvent.click(screen.getByTestId("password-confirm-backdrop"));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("I've saved it"));
    expect(onReplacementSaved).toHaveBeenCalled();
  });

  it("without a replacement code, tapping outside cancels as before", () => {
    const { onCancel } = renderModal(null);
    fireEvent.click(screen.getByTestId("password-confirm-backdrop"));
    expect(onCancel).toHaveBeenCalled();
  });
});
