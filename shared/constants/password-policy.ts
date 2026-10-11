/**
 * The one password rule (spec docs/superpowers/specs/2026-10-10-password-policy-design.md §2),
 * imported by server and client. SP 800-63B-4: 15 characters for a password
 * used alone, 8 when it is one of two factors; no composition rules; length
 * is counted in code points after NFC.
 */
export const PASSWORD_MIN_SINGLE_FACTOR = 15;
export const PASSWORD_MIN_WITH_MFA = 8;
export const PASSWORD_MAX = 128;

export type PasswordProblem = "too_short" | "too_long";
/**
 * signup = sign-up with the two-step switch off (names the switch);
 * mfa = two-step on, or the sign-up switch on; single_factor = two-step off.
 */
export type PasswordContext = "signup" | "mfa" | "single_factor";

export function passwordLength(pw: string): number {
  return [...pw.normalize("NFC")].length;
}

export function newPasswordProblem(
  pw: string,
  opts: { min: number },
): PasswordProblem | null {
  const n = passwordLength(pw);
  if (n < opts.min) return "too_short";
  if (n > PASSWORD_MAX) return "too_long";
  return null;
}

export function passwordMessage(
  problem: PasswordProblem,
  context: PasswordContext,
): string {
  if (problem === "too_long") return `Use at most ${PASSWORD_MAX} characters.`;
  if (context === "mfa")
    return `Use at least ${PASSWORD_MIN_WITH_MFA} characters.`;
  if (context === "signup") {
    return `Use at least ${PASSWORD_MIN_SINGLE_FACTOR} characters, or turn on two-step verification to use ${PASSWORD_MIN_WITH_MFA}.`;
  }
  return `Use at least ${PASSWORD_MIN_SINGLE_FACTOR} characters.`;
}
