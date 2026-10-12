/**
 * The one password rule, imported by server and client. Owner ruling
 * 2026-10-12 (supersedes the 15-character rule of spec
 * docs/superpowers/specs/2026-10-10-password-policy-design.md §2): 8
 * characters for everyone, whether or not two-step is on. No composition
 * rules; length is counted in code points after NFC; breached passwords are
 * still refused (server/lib/pwned-password.ts).
 */
export const PASSWORD_MIN_SINGLE_FACTOR = 8;
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
  // Kept so callers don't change in this PR; every context now has the same
  // minimum, so it no longer affects the sentence.
  _context: PasswordContext,
): string {
  if (problem === "too_long") return `Use at most ${PASSWORD_MAX} characters.`;
  return `Use at least ${PASSWORD_MIN_SINGLE_FACTOR} characters.`;
}
