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

  it("renders only Continue with Google on Android when Google is configured", () => {
    setOS("android");
    mockConfig.google = true;
    renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={vi.fn()} />,
    );
    expect(screen.getByLabelText("Continue with Google")).toBeDefined();
    expect(screen.queryByLabelText("Continue with Apple")).toBeNull();
  });

  it("renders nothing on Android when Google is not configured", () => {
    setOS("android");
    mockConfig.google = false;
    const { container } = renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders Apple then Google on iOS when both are configured", () => {
    mockConfig.google = true;
    renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={vi.fn()} />,
    );
    const apple = screen.getByLabelText("Continue with Apple");
    const google = screen.getByLabelText("Continue with Google");
    expect(
      apple.compareDocumentPosition(google) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("signs in with google when the Google button is pressed", async () => {
    mockConfig.google = true;
    mockSignInWithProvider.mockResolvedValue(null);
    renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={vi.fn()} />,
    );
    fireEvent.click(screen.getByLabelText("Continue with Google"));
    await waitFor(() =>
      expect(mockSignInWithProvider).toHaveBeenCalledWith("google"),
    );
  });

  it("ignores a second tap while Google sign-in is in flight", () => {
    mockConfig.google = true;
    let resolve: (v: null) => void = () => {};
    mockSignInWithProvider.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={vi.fn()} />,
    );
    const btn = screen.getByLabelText("Continue with Google");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(mockSignInWithProvider).toHaveBeenCalledTimes(1);
    resolve(null);
  });

  it("shows the generic message when Google fails", async () => {
    mockConfig.google = true;
    const onError = vi.fn();
    mockSignInWithProvider.mockRejectedValueOnce(
      Object.assign(new Error("x"), { code: "NO_ACCOUNT" }),
    );
    renderComponent(
      <SocialSignInButtons onResult={vi.fn()} onError={onError} />,
    );
    fireEvent.click(screen.getByLabelText("Continue with Google"));
    await waitFor(() =>
      expect(onError).toHaveBeenCalledWith(
        "Sign-in didn't work. Please try again.",
      ),
    );
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
