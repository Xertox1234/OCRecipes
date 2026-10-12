// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { SecondFactorField } from "../SecondFactorField";
import { ApiError } from "@/lib/api-error";

const send = vi.fn();

beforeEach(() => {
  send.mockReset();
  send.mockResolvedValue({ status: "code_sent", emailHint: "w•••@gmail.com" });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("SecondFactorField — authenticator account", () => {
  it("offers a recovery code and no email button", () => {
    renderComponent(<SecondFactorField onChange={vi.fn()} />);
    expect(screen.getByLabelText("Use a recovery code instead")).toBeTruthy();
    expect(screen.queryByLabelText("Email me a code")).toBeNull();
  });
});

describe("SecondFactorField — email account", () => {
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
    expect(screen.getByLabelText("Email me a code")).toBeTruthy();
  });
});
