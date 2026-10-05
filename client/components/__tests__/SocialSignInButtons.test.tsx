// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { Platform } from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import { SocialSignInButtons } from "../SocialSignInButtons";
import { ApiError } from "@/lib/api-error";

const { mockConfig, mockSignInWithProvider } = vi.hoisted(() => ({
  mockConfig: { google: false, apple: true },
  mockSignInWithProvider: vi.fn(),
}));

vi.mock("@/hooks/useSocialConfig", () => ({
  useSocialConfig: () => mockConfig,
}));
vi.mock("@/context/AuthContext", () => ({
  useAuthContext: () => ({ signInWithProvider: mockSignInWithProvider }),
}));

const originalOS = Platform.OS;
function setOS(os: "ios" | "android") {
  Object.defineProperty(Platform, "OS", { value: os, configurable: true });
}

beforeEach(() => {
  mockSignInWithProvider.mockReset();
  mockConfig.google = false;
  mockConfig.apple = true;
  setOS("ios");
});
afterAll(() => {
  Object.defineProperty(Platform, "OS", { value: originalOS });
});

describe("SocialSignInButtons", () => {
  it("renders Continue with Apple on iOS when Apple is configured", () => {
    renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={vi.fn()} />,
    );
    expect(screen.getByLabelText("Continue with Apple")).toBeDefined();
  });

  it("renders nothing on iOS when Apple is not configured", () => {
    mockConfig.apple = false;
    mockConfig.google = true;
    const { container } = renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={vi.fn()} />,
    );
    expect(screen.queryByLabelText("Continue with Apple")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders nothing on Android (no Apple there; Google not in this build)", () => {
    setOS("android");
    mockConfig.google = true;
    const { container } = renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("hands a non-signed-in result to onResult", async () => {
    const result = {
      status: "choose_username",
      ticket: "t1",
      suggestedUsername: "ann",
    };
    mockSignInWithProvider.mockResolvedValue(result);
    const onResult = vi.fn();
    renderComponent(
      <SocialSignInButtons onResult={onResult} onError={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Continue with Apple"));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(result));
    expect(mockSignInWithProvider).toHaveBeenCalledWith("apple");
  });

  it("shows nothing when the person cancels", async () => {
    mockSignInWithProvider.mockResolvedValue(null);
    const onResult = vi.fn();
    const onError = vi.fn();
    renderComponent(
      <SocialSignInButtons onResult={onResult} onError={onError} />,
    );
    fireEvent.click(screen.getByLabelText("Continue with Apple"));
    await waitFor(() => expect(mockSignInWithProvider).toHaveBeenCalled());
    expect(onResult).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("maps a failure to static copy (never the raw server message)", async () => {
    mockSignInWithProvider.mockRejectedValue(
      new ApiError("raw server text", "PROVIDER_EXCHANGE_FAILED", 502),
    );
    const onError = vi.fn();
    renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={onError} />,
    );
    fireEvent.click(screen.getByLabelText("Continue with Apple"));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0][0]).not.toContain("raw server text");
  });

  it("an unverified account goes to verify-email, not an error line", async () => {
    mockSignInWithProvider.mockRejectedValue(
      new ApiError("Email not verified", "EMAIL_NOT_VERIFIED", 403),
    );
    const onError = vi.fn();
    const onUnverifiedEmail = vi.fn();
    renderComponent(
      <SocialSignInButtons
        onResult={vi.fn()}
        onError={onError}
        onUnverifiedEmail={onUnverifiedEmail}
      />,
    );
    fireEvent.click(screen.getByLabelText("Continue with Apple"));
    await waitFor(() => expect(onUnverifiedEmail).toHaveBeenCalledTimes(1));
    expect(onError).not.toHaveBeenCalled();
  });

  it("ignores a second press while a sign-in is in flight", async () => {
    let resolve: (v: null) => void = () => {};
    mockSignInWithProvider.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Continue with Apple"));
    fireEvent.click(screen.getByLabelText("Continue with Apple"));
    expect(mockSignInWithProvider).toHaveBeenCalledTimes(1);
    resolve(null);
  });
});
