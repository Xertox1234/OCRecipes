// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { SecondFactorField } from "../SecondFactorField";
import { ApiError } from "@/lib/api-error";

const send = vi.fn();
let announceSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ status: "code_sent", emailHint: "w•••@gmail.com" });
  announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
});
afterEach(() => {
  vi.useRealTimers();
  announceSpy.mockRestore();
});

describe("SecondFactorField", () => {
  it("no recovery-code link; Email me a code sends one and says where", async () => {
    renderComponent(
      <SecondFactorField onChange={vi.fn()} emailCode={{ send }} />,
    );
    expect(screen.queryByLabelText("Use a recovery code instead")).toBeNull();
    fireEvent.click(screen.getByLabelText("Email me a code"));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("Code sent to w•••@gmail.com."),
    ).toBeTruthy();
    expect(screen.getByLabelText("Resend code in 30s")).toBeTruthy();
  });

  it("the button waits 30 seconds, then offers Resend code", async () => {
    vi.useFakeTimers();
    renderComponent(
      <SecondFactorField
        onChange={vi.fn()}
        emailCode={{ send, alreadySent: true }}
      />,
    );
    expect(screen.getByLabelText("Resend code in 30s")).toBeTruthy();
    for (let i = 0; i < 30; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(screen.getByLabelText("Resend code")).toBeTruthy();
  });

  it("a refused send shows plain copy, not the server's text", async () => {
    send.mockRejectedValue(
      new ApiError(
        '429: {"code":"MFA_EMAIL_DAILY_LIMIT"}',
        "MFA_EMAIL_DAILY_LIMIT",
        429,
      ),
    );
    renderComponent(
      <SecondFactorField onChange={vi.fn()} emailCode={{ send }} />,
    );
    fireEvent.click(screen.getByLabelText("Email me a code"));
    expect(
      await screen.findByText(
        "Too many codes today. Use the newest one in your email, or try again tomorrow.",
      ),
    ).toBeTruthy();
    // InlineError announces on a 0 ms timer (announceTogether). Wait for it
    // here, or it fires inside the next test and lands in that test's spy.
    await waitFor(() =>
      expect(announceSpy).toHaveBeenCalledWith(
        "Too many codes today. Use the newest one in your email, or try again tomorrow.",
      ),
    );
    expect(screen.getByLabelText("Email me a code")).toBeTruthy();
  });

  // Screen readers hear that the code went out (mobile review, 2026-10-12).
  it("announces the send once, and not again on each countdown tick", async () => {
    vi.useFakeTimers();
    renderComponent(
      <SecondFactorField onChange={vi.fn()} emailCode={{ send }} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Email me a code"));
    });
    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy).toHaveBeenCalledWith("Code sent to w•••@gmail.com.");
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });

  it("announces nothing on mount when the first code already went out", () => {
    renderComponent(
      <SecondFactorField
        onChange={vi.fn()}
        emailCode={{ send, alreadySent: true }}
      />,
    );
    expect(announceSpy).not.toHaveBeenCalled();
  });

  // The error itself is announced (InlineError, after a 0 ms timer); the
  // "Code sent" line must not be. Asserting "nothing" before that timer fired
  // passed only because it looked too early.
  it("a refused send announces the error, never 'Code sent'", async () => {
    send.mockRejectedValue(new ApiError("500: {}", undefined, 500));
    renderComponent(
      <SecondFactorField onChange={vi.fn()} emailCode={{ send }} />,
    );
    fireEvent.click(screen.getByLabelText("Email me a code"));
    expect(
      await screen.findByText("Couldn't send a code. Please try again."),
    ).toBeTruthy();
    await waitFor(() =>
      expect(announceSpy).toHaveBeenCalledWith(
        "Couldn't send a code. Please try again.",
      ),
    );
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });
});

const fieldLabels = () =>
  screen.getAllByTestId("focus-field-label").map((n) => n.textContent);

describe("SecondFactorField — floating label", () => {
  it("floats 6-digit code with no repeated placeholder", () => {
    renderComponent(
      <SecondFactorField onChange={vi.fn()} emailCode={{ send }} />,
    );
    expect(fieldLabels()).toEqual(["6-digit code"]);
    fireEvent.focus(screen.getByLabelText("6-digit code"));
    expect(screen.queryByPlaceholderText("6-digit code")).toBeNull();
  });
});
