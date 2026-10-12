/** The trust switch's label: what it does, in plain words. On by default. */
export const TRUST_LABEL = "Don't ask again on this phone";

/** The line under the title: where the code went. */
export function codeScreenIntro(p: {
  emailHint?: string;
  codeSent?: boolean;
}): string {
  const to = p.emailHint ?? "your email";
  return p.codeSent === false
    ? `We've already emailed codes to ${to}. Use the newest one, or tap Email me a code.`
    : `We emailed a 6-digit code to ${to}. It can take a minute to arrive.`;
}

/** "Trust this phone" applies to password sign-in only, never to connecting. */
export function showTrustSwitch(purpose: "login" | "link"): boolean {
  return purpose === "login";
}
