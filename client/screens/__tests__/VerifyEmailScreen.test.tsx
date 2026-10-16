// @vitest-environment jsdom
/**
 * Render test for VerifyEmailScreen's internal state machine (P3 deferred from
 * the PR #403 review). The login → VerifyEmail navigation is already covered by
 * LoginScreen.test.tsx; this file covers the screen's own branch logic:
 * confirm-on-mount, the confirmed/failed transitions, the linkSent copy switch,
 * and onResend validation. AccessibilityInfo announces are asserted on the
 * confirmed/failed/successful-resend transitions.
 *
 * Mock style mirrors LoginScreen.test.tsx (vi.hoisted spies) and the announce
 * spy pattern from UpgradeModal.a11y.test.tsx (vi.spyOn on the shared RN mock,
 * which exposes announceForAccessibility as a plain fn, not a vi.fn).
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import VerifyEmailScreen from "../VerifyEmailScreen";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import * as Haptics from "expo-haptics";

const { withSequenceSpy } = vi.hoisted(() => ({
  withSequenceSpy: vi.fn((...vals: number[]) => vals[vals.length - 1]),
}));

// The InlineError shake runs one withSequence per validation reject.
vi.mock("react-native-reanimated", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, default: actual.default, withSequence: withSequenceSpy };
});

type Props = NativeStackScreenProps<RootStackParamList, "VerifyEmail">;

const { mockVerifyEmailRequest, mockResendVerificationRequest } = vi.hoisted(
  () => ({
    mockVerifyEmailRequest: vi.fn(),
    mockResendVerificationRequest: vi.fn(),
  }),
);

// Intercept the two network helpers but keep the genuine isValidEmailShape — the
// screen calls it to decide the invalid/valid resend branch, so it must run for
// real. The test-relative path resolves to the same absolute module as the
// screen's "./VerifyEmailScreen-utils" import.
vi.mock("../VerifyEmailScreen-utils", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../VerifyEmailScreen-utils")>();
  return {
    ...actual,
    verifyEmailRequest: mockVerifyEmailRequest,
    resendVerificationRequest: mockResendVerificationRequest,
  };
});

// Signed-out by default — the screen's original audience. The signed-in tests
// flip `isAuthenticated` (a verify link tapped after changing email, #55).
const auth = vi.hoisted(() => ({
  isAuthenticated: false,
  checkAuth: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/context/AuthContext", () => ({ useAuthContext: () => auth }));

/**
 * Build the route/navigation props the screen receives directly (it does NOT
 * use useNavigation). The localized `as unknown as` casts construct the minimal
 * props the screen actually reads; the project's "never cast navigation types"
 * rule targets production usage, not test prop construction.
 */
function renderScreen(
  params?: RootStackParamList["VerifyEmail"],
  { canGoBack = true }: { canGoBack?: boolean } = {},
) {
  const navigate = vi.fn();
  const goBack = vi.fn();
  const reset = vi.fn();
  const route = { params } as unknown as Props["route"];
  const navigation = {
    navigate,
    goBack,
    reset,
    canGoBack: () => canGoBack,
  } as unknown as Props["navigation"];
  const utils = renderComponent(
    <VerifyEmailScreen route={route} navigation={navigation} />,
  );
  return { ...utils, navigate, goBack, reset };
}

beforeEach(() => {
  auth.isAuthenticated = false;
});

describe("VerifyEmailScreen — confirm-on-mount transitions", () => {
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    announceSpy.mockRestore();
  });

  it("verifies the token on mount and renders the confirmed state", async () => {
    mockVerifyEmailRequest.mockResolvedValue(undefined);
    renderScreen({ token: "tok-123" });

    await waitFor(() =>
      expect(mockVerifyEmailRequest).toHaveBeenCalledWith("tok-123"),
    );

    expect(await screen.findByText("Email verified ✓")).toBeTruthy();
    expect(announceSpy).toHaveBeenCalledWith(
      "Your email is verified. You can now sign in.",
    );
  });

  it("renders the failed state when verification rejects", async () => {
    mockVerifyEmailRequest.mockRejectedValue(new Error("expired"));
    renderScreen({ token: "tok-expired" });

    expect(await screen.findByText("Link expired or invalid")).toBeTruthy();
    expect(announceSpy).toHaveBeenCalledWith(
      "That verification link is invalid or expired.",
    );
  });

  it("renders the transient 'confirming' UI before verification settles", () => {
    // A never-resolving request pins the initial-mount branch so the transient
    // node of the state machine is observable.
    mockVerifyEmailRequest.mockReturnValue(new Promise(() => {}));
    renderScreen({ token: "tok-pending" });

    expect(screen.getByText("Verifying your email…")).toBeTruthy();
  });

  it("does not call verifyEmailRequest when no token param is present", () => {
    renderScreen({ email: "user@example.com" });
    expect(mockVerifyEmailRequest).not.toHaveBeenCalled();
  });
});

describe("VerifyEmailScreen — confirmed navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates to Login when 'Back to sign in' is pressed", async () => {
    mockVerifyEmailRequest.mockResolvedValue(undefined);
    const { navigate } = renderScreen({ token: "tok-123" });

    // Wait for the settled state: the confirming state has its own same-named
    // exit, which unmounts when the confirm resolves.
    await screen.findByText("Email verified ✓");
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));

    expect(navigate).toHaveBeenCalledWith("Login");
  });
});

// #74: a signed-out user on an expired link (or a slow confirm) had no way out
// — headerShown is false and edge-swipe does nothing, so force-quit was it.
describe("VerifyEmailScreen — every signed-out state has a way back", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("navigates to Login from the failed state", async () => {
    mockVerifyEmailRequest.mockRejectedValue(new Error("expired"));
    const { navigate } = renderScreen({ token: "tok-expired" });

    await screen.findByText("Link expired or invalid");
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));

    expect(navigate).toHaveBeenCalledWith("Login");
  });

  it("offers Back to sign in while the link is still confirming", () => {
    mockVerifyEmailRequest.mockReturnValue(new Promise(() => {}));
    const { navigate } = renderScreen({ token: "tok-pending" });

    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));

    expect(navigate).toHaveBeenCalledWith("Login");
  });

  it("labels the resend email field for screen readers", async () => {
    mockVerifyEmailRequest.mockRejectedValue(new Error("expired"));
    renderScreen({ token: "tok-expired" });

    await screen.findByText("Link expired or invalid");
    expect(screen.getByLabelText("Email address")).toBeTruthy();
  });

  it("labels the pending-state email field for screen readers", () => {
    renderScreen(undefined);

    expect(screen.getByLabelText("Email address")).toBeTruthy();
  });
});

// #55: a signed-in user taps a verify link — the change-email flow mails one to
// the new address while the user stays signed in. There is no Login route in
// the signed-in stack, so every exit is Done back into the app.
describe("VerifyEmailScreen — signed in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.isAuthenticated = true;
  });

  it("confirms, refreshes the account, and Done goes back", async () => {
    mockVerifyEmailRequest.mockResolvedValue(undefined);
    const { goBack, navigate } = renderScreen({ token: "tok-123" });

    expect(await screen.findByText("Email verified ✓")).toBeTruthy();
    // The token names its own user, so the copy never claims "your".
    expect(screen.getByText("That email address is confirmed.")).toBeTruthy();
    expect(screen.queryByText("You can now sign in.")).toBeNull();
    expect(auth.checkAuth).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(goBack).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalledWith("Login");
  });

  it("Done resets to Main when the link cold-started the app", async () => {
    mockVerifyEmailRequest.mockResolvedValue(undefined);
    const { goBack, reset } = renderScreen(
      { token: "tok-123" },
      { canGoBack: false },
    );

    await screen.findByText("Email verified ✓");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(goBack).not.toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: "Main" }],
    });
  });

  it("failed: points to Settings instead of a resend that cannot work", async () => {
    // Resend looks up the verified email only, so it can never re-send a
    // pending change-email link — offering it would silently do nothing.
    mockVerifyEmailRequest.mockRejectedValue(new Error("expired"));
    const { goBack } = renderScreen({ token: "tok-expired" });

    expect(await screen.findByText("Link expired or invalid")).toBeTruthy();
    expect(screen.getByText(/Settings/)).toBeTruthy();
    expect(screen.queryByTestId("input-resend-email")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Resend verification email" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(goBack).toHaveBeenCalled();
    expect(auth.checkAuth).not.toHaveBeenCalled();
  });

  it("offers Done while the link is still confirming", () => {
    mockVerifyEmailRequest.mockReturnValue(new Promise(() => {}));
    const { goBack } = renderScreen({ token: "tok-pending" });

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(goBack).toHaveBeenCalled();
  });
});

describe("VerifyEmailScreen — linkSent copy switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Check your inbox' copy when arriving with an explicit sent flag", () => {
    renderScreen({ email: "chef@example.com", sent: true });

    expect(screen.getByText("Check your inbox")).toBeTruthy();
    expect(
      screen.getByText(/We've sent a verification link to chef@example.com/),
    ).toBeTruthy();
  });

  // Regression guard: the sent copy is driven by the explicit `sent` flag, NOT
  // by the presence of `email`. A future caller routing here with an email but
  // no send must not re-introduce the misleading "we've sent a link" copy.
  it("shows 'Verify your email' copy when an email is present but sent is not set", () => {
    renderScreen({ email: "chef@example.com" });

    expect(screen.getByText("Verify your email")).toBeTruthy();
    expect(screen.getByText(/isn't verified yet/)).toBeTruthy();
  });

  it("shows 'Verify your email' copy when arriving with no params", () => {
    renderScreen(undefined);

    expect(screen.getByText("Verify your email")).toBeTruthy();
    expect(screen.getByText(/isn't verified yet/)).toBeTruthy();
  });
});

describe("VerifyEmailScreen — pending-state sign-in handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The dead-end this fixes: after signup the screen sits on the "Check your
  // inbox" (linkSent) pending state. A user who verified in the *browser* and
  // returns to the app needs an obvious path to Login — there was none.
  it("navigates to Login from the 'Check your inbox' pending state", () => {
    const { navigate } = renderScreen({
      email: "chef@example.com",
      sent: true,
    });

    expect(screen.getByText("Check your inbox")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));

    expect(navigate).toHaveBeenCalledWith("Login");
  });

  // Also reachable on the login → EMAIL_NOT_VERIFIED → verify-elsewhere path
  // (AC3: "works either way") — the neutral "Back to sign in" label reads fine
  // in the not-sent sub-state too, so the escape hatch is never hidden.
  it("navigates to Login from the not-yet-sent pending state", () => {
    const { navigate } = renderScreen(undefined);

    expect(screen.getByText("Verify your email")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to sign in" }));

    expect(navigate).toHaveBeenCalledWith("Login");
  });
});

describe("VerifyEmailScreen — onResend validation", () => {
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    announceSpy.mockRestore();
  });

  it("shows an inline error and does not resend for an invalid email", () => {
    renderScreen(undefined);

    // No email param → input starts empty, which is an invalid shape.
    fireEvent.click(screen.getByRole("button", { name: "Resend email" }));

    // InlineError renders role="alert"; TextInput's errorMessage is a11y-only
    // (aria-hint), so this is the sole visible occurrence of the copy.
    expect(screen.getByRole("alert").textContent).toContain(
      "Please enter a valid email address.",
    );
    expect(mockResendVerificationRequest).not.toHaveBeenCalled();
  });

  it("resends and flips copy to 'Check your inbox' for a valid email", async () => {
    mockResendVerificationRequest.mockResolvedValue(undefined);
    renderScreen(undefined);

    // Starts on the "Verify your email" (not-yet-sent) copy.
    expect(screen.getByText("Verify your email")).toBeTruthy();

    fireEvent.change(screen.getByTestId("input-resend-email"), {
      target: { value: "valid@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resend email" }));

    await waitFor(() =>
      expect(mockResendVerificationRequest).toHaveBeenCalledWith(
        "valid@example.com",
      ),
    );

    // Copy flips to the sent state and the transition is announced.
    expect(await screen.findByText("Check your inbox")).toBeTruthy();
    expect(announceSpy).toHaveBeenCalledWith(
      "A new verification link has been sent.",
    );
  });

  it("surfaces a neutral error and does not announce when resend rejects", async () => {
    mockResendVerificationRequest.mockRejectedValue(new Error("network"));
    renderScreen(undefined);

    fireEvent.change(screen.getByTestId("input-resend-email"), {
      target: { value: "valid@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resend email" }));

    expect(
      await screen.findByText(
        "Couldn't resend right now. Please try again shortly.",
      ),
    ).toBeTruthy();
    // The screen stays on the not-sent copy and never announces a send.
    expect(screen.getByText("Verify your email")).toBeTruthy();
    expect(announceSpy).not.toHaveBeenCalledWith(
      "A new verification link has been sent.",
    );
  });
});

describe("VerifyEmailScreen — resend from the failed state", () => {
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    announceSpy.mockRestore();
  });

  it("resends from the failed branch and flips to the sent copy", async () => {
    // Arrive via an expired deep link, prefilling the email so the failed
    // branch's own "Resend verification email" button is exercised.
    mockVerifyEmailRequest.mockRejectedValue(new Error("expired"));
    mockResendVerificationRequest.mockResolvedValue(undefined);
    renderScreen({ token: "tok-expired", email: "valid@example.com" });

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Resend verification email",
      }),
    );

    await waitFor(() =>
      expect(mockResendVerificationRequest).toHaveBeenCalledWith(
        "valid@example.com",
      ),
    );

    expect(await screen.findByText("Check your inbox")).toBeTruthy();
    expect(announceSpy).toHaveBeenCalledWith(
      "A new verification link has been sent.",
    );
  });
});

// A validation reject shakes the error and buzzes; a failed resend buzzes
// but does not shake.
describe("VerifyEmailScreen — shake on validation reject", () => {
  beforeEach(() => vi.clearAllMocks());

  it("the same bad email twice shakes twice and buzzes twice", () => {
    renderScreen({ email: "" });
    fireEvent.change(screen.getByTestId("input-resend-email"), {
      target: { value: "nope" },
    });

    fireEvent.click(screen.getByText("Resend email"));
    fireEvent.click(screen.getByText("Resend email"));

    expect(withSequenceSpy).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
    expect(Haptics.notificationAsync).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
    expect(mockResendVerificationRequest).not.toHaveBeenCalled();
  });

  it("a failed resend buzzes once but does not shake", async () => {
    mockResendVerificationRequest.mockRejectedValue(new Error("offline"));
    renderScreen({ email: "" });
    fireEvent.change(screen.getByTestId("input-resend-email"), {
      target: { value: "a@b.com" },
    });
    fireEvent.click(screen.getByText("Resend email"));

    expect(await screen.findByText(/Couldn't resend/)).toBeTruthy();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    expect(withSequenceSpy).not.toHaveBeenCalled();
  });
});
