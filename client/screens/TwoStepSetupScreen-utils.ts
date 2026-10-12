export type TwoStepSetupMode = "setup" | "new_phone" | "disable" | "new_codes";
export type TwoStepSetupStep =
  | "confirm"
  | "add-key"
  | "enter-code"
  | "save-codes";

/** "ABCDEFGH…" → "ABCD EFGH …" so the key can be typed into an app by hand. */
export function formatSetupKey(b32: string): string {
  return (b32.match(/.{1,4}/g) ?? []).join(" ");
}

/** What "Copy all" / "Share" hand over. */
export function recoveryCodesText(codes: string[]): string {
  return `OCRecipes recovery codes — each works once\n\n${codes.join("\n")}\n`;
}

/** Done stays disabled until the person confirms they saved the codes. */
export function canFinishSaveCodes(acknowledged: boolean): boolean {
  return acknowledged;
}

/**
 * Leaving while recovery codes are on screen and not yet saved loses them —
 * they are never shown again — so that one state asks first.
 */
export function shouldGuardLeave(
  step: TwoStepSetupStep,
  acknowledged: boolean,
): boolean {
  return step === "save-codes" && !acknowledged;
}

/** The toast once the setup steps finish; codes are issued on setup and new codes. */
export function finishMessage(
  mode: TwoStepSetupMode,
  codesIssued: boolean,
): string {
  if (!codesIssued) return "Two-step verification moved to this phone";
  return mode === "setup"
    ? "Two-step verification is on"
    : "New recovery codes saved";
}

export function setupTitle(mode: TwoStepSetupMode): string {
  switch (mode) {
    case "setup":
      return "Turn on two-step verification";
    case "new_phone":
      return "Set up on a new phone";
    case "disable":
      return "Turn off two-step verification";
    case "new_codes":
      return "New recovery codes";
  }
}

/**
 * The "add the key" step, worded for setting up on the same phone (owner
 * ruling 2026-10-12). On iOS 18+ an otpauth:// link opens the Passwords app,
 * which makes the codes itself, so the button says so. Nobody is asked to
 * scan a QR code: the code is on this phone's own screen.
 */
export function addKeyCopy(os: string): {
  intro: string;
  button: string;
  after: string | null;
  manual: string;
} {
  const manual =
    "Using another app? Tap Copy key, then in that app choose “Enter a setup key” — not “Scan a QR code” — and paste it.";
  if (os === "ios") {
    return {
      intro:
        "Your iPhone's Passwords app can make the 6-digit codes for OCRecipes.",
      button: "Add to Passwords",
      after:
        "Then open Passwords → Codes → OCRecipes, and come back with the 6-digit code.",
      manual,
    };
  }
  return {
    intro:
      "Add OCRecipes to an authenticator app such as Google Authenticator, Microsoft Authenticator or 1Password.",
    button: "Add to authenticator app",
    after: null,
    manual,
  };
}

/** A wrong code: usually an older OCRecipes entry, sometimes the clock. */
export const WRONG_CODE_MESSAGE =
  "That code didn't match. Use the newest OCRecipes entry (delete older ones), and check your phone's time is set automatically.";
