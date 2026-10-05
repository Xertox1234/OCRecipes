// Mock expo-apple-authentication for Vitest. The real package resolves a
// native module at import, which throws under Node. Reached via
// @/lib/social-sign-in <- useAuth <- AuthContext.
import React from "react";
import { vi } from "vitest";

export const AppleAuthenticationScope = { FULL_NAME: 0, EMAIL: 1 } as const;
export const AppleAuthenticationButtonType = {
  SIGN_IN: 0,
  CONTINUE: 1,
  SIGN_UP: 2,
} as const;
export const AppleAuthenticationButtonStyle = {
  WHITE: 0,
  WHITE_OUTLINE: 1,
  BLACK: 2,
} as const;

export const signInAsync = vi.fn();
export const isAvailableAsync = vi.fn().mockResolvedValue(true);

/** Renders as a plain DOM button so tests can find and press it. */
export function AppleAuthenticationButton(props: {
  onPress: () => void;
  buttonType?: number;
}) {
  return React.createElement(
    "button",
    {
      type: "button",
      "aria-label":
        props.buttonType === AppleAuthenticationButtonType.SIGN_IN
          ? "Sign in with Apple"
          : "Continue with Apple",
      onClick: props.onPress,
    },
    "Apple",
  );
}
