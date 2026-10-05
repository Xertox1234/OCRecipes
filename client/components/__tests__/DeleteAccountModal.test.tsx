// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { SignInMethods } from "@shared/types/auth";
import { ApiError } from "@/lib/api-error";
import { renderComponent } from "../../../test/utils/render-component";
import { DeleteAccountModal } from "../DeleteAccountModal";

const relay = { email: null, isPrivateRelay: true };
const onConfirm = vi.fn();

function renderModal(
  signInMethods: SignInMethods | undefined,
  loadError = false,
) {
  return renderComponent(
    <DeleteAccountModal
      visible
      onClose={vi.fn()}
      onConfirm={onConfirm}
      signInMethods={signInMethods}
      loadError={loadError}
    />,
  );
}

beforeEach(() => {
  onConfirm.mockReset();
});

describe("DeleteAccountModal", () => {
  it("password account: asks for the password (unchanged)", async () => {
    onConfirm.mockResolvedValue(true);
    renderModal({ password: true, google: null, apple: relay });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({ password: "pw-1" }),
    );
  });

  it("Apple-only account: confirms with Apple, no password field", async () => {
    onConfirm.mockResolvedValue(true);
    renderModal({ password: false, google: null, apple: relay });
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirm with Apple" }));
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({ provider: "apple" }),
    );
  });

  it("a cancelled Apple sheet leaves the modal usable", async () => {
    onConfirm.mockResolvedValue(false);
    renderModal({ password: false, google: null, apple: relay });
    const btn = screen.getByRole("button", { name: "Confirm with Apple" });
    fireEvent.click(btn);
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: "Confirm with Apple" })
          .getAttribute("aria-disabled"),
      ).not.toBe("true"),
    );
  });

  it("an Apple confirmation the server rejects shows static copy", async () => {
    onConfirm.mockRejectedValue(new ApiError("secret", "UNAUTHORIZED", 401));
    renderModal({ password: false, google: null, apple: relay });
    fireEvent.click(screen.getByRole("button", { name: "Confirm with Apple" }));
    expect(await screen.findByText(/couldn't confirm/i)).toBeTruthy();
    expect(screen.queryByText(/secret/)).toBeNull();
  });

  it("while the methods load, nothing can be confirmed", () => {
    renderModal(undefined);
    expect(screen.queryByLabelText("Password")).toBeNull();
    const btn = screen.getByRole("button", { name: "Delete account" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("a failed load says so instead of loading forever", () => {
    renderModal(undefined, true);
    expect(screen.getByText(/couldn't load/i)).toBeTruthy();
    expect(screen.queryByText("Loading…")).toBeNull();
    const btn = screen.getByRole("button", { name: "Delete account" });
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });
});
