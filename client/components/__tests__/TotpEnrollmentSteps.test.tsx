// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as RN from "react-native";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { TotpEnrollmentSteps } from "../TotpEnrollmentSteps";
import { ApiError } from "@/lib/api-error";

const h = vi.hoisted(() => ({ copy: vi.fn() }));
vi.mock("expo-clipboard", () => ({ setStringAsync: h.copy }));

const SECRET = { secret: "ABCDEFGHIJKLMNOP", otpauthUrl: "otpauth://totp/x" };
const CODES = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-DD${i}D`);

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const press = (name: string) =>
  fireEvent.click(screen.getByRole("button", { name }));

function setup(
  over: Partial<React.ComponentProps<typeof TotpEnrollmentSteps>> = {},
) {
  const props = {
    start: { kind: "secret" as const, secret: SECRET },
    confirm: vi.fn(),
    messageFor: vi.fn(() => "Static failure copy."),
    onDone: vi.fn(),
    onGuardChange: vi.fn(),
    ...over,
  };
  renderComponent(<TotpEnrollmentSteps {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.copy.mockResolvedValue(true);
});

describe("TotpEnrollmentSteps", () => {
  it("shows the key, then takes a 6-digit code and confirms it", async () => {
    const p = setup({ confirm: vi.fn().mockResolvedValue(CODES) });
    expect(screen.getByText("ABCD EFGH IJKL MNOP")).toBeTruthy();
    press("Next");
    type("6-digit code", "123456");
    press("Confirm");
    await screen.findByText(CODES[0]);
    expect(p.confirm).toHaveBeenCalledWith("123456");
  });

  it("a wrong code names the stale-entry trap and the clock, and stays on the code step", async () => {
    setup({
      confirm: vi
        .fn()
        .mockRejectedValue(
          new ApiError("400: wrong", "INVALID_SECOND_FACTOR", 400),
        ),
    });
    press("Next");
    type("6-digit code", "123456");
    press("Confirm");
    expect(
      await screen.findByText(
        "That code didn't match. Use the newest OCRecipes entry (delete older ones), and check your phone's time is set automatically.",
      ),
    ).toBeTruthy();
  });

  it("any other failure shows the host's static copy, never the raw message", async () => {
    const p = setup({
      confirm: vi
        .fn()
        .mockRejectedValue(
          new ApiError("500: raw body", "INTERNAL_ERROR", 500),
        ),
    });
    press("Next");
    type("6-digit code", "123456");
    press("Confirm");
    expect(await screen.findByText("Static failure copy.")).toBeTruthy();
    expect(p.messageFor).toHaveBeenCalled();
    expect(screen.queryByText(/raw body/)).toBeNull();
  });

  it("codes issued: guard on, Done waits for 'I've saved these', then onDone(true)", async () => {
    const p = setup({ confirm: vi.fn().mockResolvedValue(CODES) });
    press("Next");
    type("6-digit code", "123456");
    press("Confirm");
    await screen.findByText(CODES[0]);
    expect(p.onGuardChange).toHaveBeenLastCalledWith(true);
    expect(
      screen.getByRole("button", { name: "Done" }).hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: "I've saved these" }));
    expect(p.onGuardChange).toHaveBeenLastCalledWith(false);
    press("Done");
    expect(p.onDone).toHaveBeenCalledWith(true);
  });

  it("unticking 'I've saved these' turns the guard back on", async () => {
    const p = setup({ start: { kind: "codes", codes: CODES } });
    const box = () =>
      screen.getByRole("checkbox", { name: "I've saved these" });
    fireEvent.click(box());
    expect(p.onGuardChange).toHaveBeenLastCalledWith(false);
    fireEvent.click(box());
    expect(p.onGuardChange).toHaveBeenLastCalledWith(true);
  });

  it("no codes issued (a new phone): onDone(false) straight away", async () => {
    const p = setup({ confirm: vi.fn().mockResolvedValue(undefined) });
    press("Next");
    type("6-digit code", "123456");
    press("Confirm");
    await waitFor(() => expect(p.onDone).toHaveBeenCalledWith(false));
    expect(p.onGuardChange).not.toHaveBeenCalledWith(true);
  });

  it("the save step suggests where to keep the codes", () => {
    setup({ start: { kind: "codes", codes: CODES } });
    expect(
      screen.getByText(
        "Save these recovery codes somewhere you can reach without this phone — for example, paste them into a note in the Passwords app. Each works once. They won't be shown again.",
      ),
    ).toBeTruthy();
  });

  it("starting from codes opens on the save step", () => {
    setup({ start: { kind: "codes", codes: CODES } });
    expect(screen.getByText(CODES[0])).toBeTruthy();
    expect(screen.queryByText("ABCD EFGH IJKL MNOP")).toBeNull();
  });
});

describe("TotpEnrollmentSteps — one iPhone (owner ruling 2026-10-12)", () => {
  const originalOS = RN.Platform.OS;
  afterEach(() => {
    RN.Platform.OS = originalOS;
  });

  it("on iOS the button says Passwords and the next step says where the code is", () => {
    RN.Platform.OS = "ios";
    setup();
    expect(
      screen.getByRole("button", { name: "Add to Passwords" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Then open Passwords → Codes → OCRecipes, and come back with the 6-digit code.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Using another app? Tap Copy key, then in that app choose “Enter a setup key” — not “Scan a QR code” — and paste it.",
      ),
    ).toBeTruthy();
  });

  it("on Android the button stays generic", () => {
    RN.Platform.OS = "android";
    setup();
    expect(
      screen.getByRole("button", { name: "Add to authenticator app" }),
    ).toBeTruthy();
    expect(screen.queryByText(/Passwords → Codes/)).toBeNull();
  });
});
