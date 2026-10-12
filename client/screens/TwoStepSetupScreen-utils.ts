export type TwoStepSetupMode = "setup" | "disable";

export function setupTitle(mode: TwoStepSetupMode): string {
  return mode === "setup"
    ? "Turn on two-step verification"
    : "Turn off two-step verification";
}

/** The first step's line: what is about to happen, in plain words. */
export function identityIntro(mode: TwoStepSetupMode): string {
  return mode === "setup"
    ? "When you sign in on a new phone, we'll email you a 6-digit code. Enter your password to start."
    : "Enter your password and the code we email you.";
}
