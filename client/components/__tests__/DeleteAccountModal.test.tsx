// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import type { SignInMethods } from "@shared/types/auth";
import { ApiError } from "@/lib/api-error";
import { renderComponent } from "../../../test/utils/render-component";
import { DeleteAccountModal } from "../DeleteAccountModal";
import * as Haptics from "expo-haptics";

const { withSequenceSpy } = vi.hoisted(() => ({
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
}));

// The InlineError shake runs one withSequence per validation reject.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

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

// A validation reject shakes the error and buzzes; a server error buzzes
// but does not shake.
describe("DeleteAccountModal — shake on validation reject", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an empty password twice shakes twice and buzzes twice", () => {
    renderModal({ password: true, google: null, apple: null });
    const btn = screen.getByRole("button", { name: "Delete account" });

    fireEvent.click(btn);
    fireEvent.click(btn);

    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("a wrong password buzzes once but does not shake", async () => {
    onConfirm.mockRejectedValue(new Error("Invalid credentials"));
    renderModal({ password: true, google: null, apple: null });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete account" }));

    expect(await screen.findByText(/Incorrect password/)).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });

  it("an Apple confirmation the server rejects buzzes once", async () => {
    onConfirm.mockRejectedValue(new ApiError("x", "UNAUTHORIZED", 401));
    renderModal({ password: false, google: null, apple: relay });
    fireEvent.click(screen.getByRole("button", { name: "Confirm with Apple" }));

    expect(await screen.findByText(/couldn't confirm/i)).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});

describe("DeleteAccountModal — two-step verification", () => {
  const pwMethods = { password: true, google: null, apple: null };
  const deleteBtn = () =>
    screen.getByRole("button", { name: "Delete account" });

  it("asks for the code up front with a password proof and sends it", async () => {
    onConfirm.mockResolvedValue(true);
    renderComponent(
      <DeleteAccountModal
        visible
        askCode
        onClose={vi.fn()}
        onConfirm={onConfirm}
        signInMethods={pwMethods}
      />,
    );
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-1" },
    });
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(deleteBtn());
    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith(
        { password: "pw-1" },
        { code: "123456" },
      ),
    );
  });

  it("a SECOND_FACTOR_REQUIRED answer reveals the code field and keeps the password", async () => {
    onConfirm
      .mockRejectedValueOnce(
        new ApiError(
          `403: ${JSON.stringify({ code: "SECOND_FACTOR_REQUIRED", error: "x" })}`,
          "SECOND_FACTOR_REQUIRED",
          403,
        ),
      )
      .mockResolvedValueOnce(true);
    renderModal(pwMethods);
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-1" },
    });
    fireEvent.click(deleteBtn());
    await screen.findByLabelText("6-digit code");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "pw-1",
    );
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fireEvent.click(deleteBtn());
    await waitFor(() =>
      expect(onConfirm).toHaveBeenLastCalledWith(
        { password: "pw-1" },
        { code: "123456" },
      ),
    );
  });

  it("a wrong code shows the generic two-step message, not the raw response", async () => {
    onConfirm.mockRejectedValue(
      new ApiError(
        `401: ${JSON.stringify({ code: "INVALID_SECOND_FACTOR", error: "That code didn't work. After several wrong codes, codes pause for 15 minutes." })}`,
        "INVALID_SECOND_FACTOR",
        401,
      ),
    );
    renderComponent(
      <DeleteAccountModal
        visible
        askCode
        onClose={vi.fn()}
        onConfirm={onConfirm}
        signInMethods={pwMethods}
      />,
    );
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "pw-1" },
    });
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "000000" },
    });
    fireEvent.click(deleteBtn());
    await screen.findByText(
      "That code didn't work. After several wrong codes, codes pause for 15 minutes.",
    );
  });

  it("a Google/Apple proof never shows the code field", () => {
    renderComponent(
      <DeleteAccountModal
        visible
        askCode
        onClose={vi.fn()}
        onConfirm={onConfirm}
        signInMethods={{ password: false, google: null, apple: relay }}
      />,
    );
    expect(screen.queryByLabelText("6-digit code")).toBeNull();
  });
});
