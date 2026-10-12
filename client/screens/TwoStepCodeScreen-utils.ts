import type { MfaVerifyResult, User } from "@shared/types/auth";
import {
  replacementFromError,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";

/** The trust switch's label: what it does, in plain words. On by default. */
export const TRUST_LABEL = "Don't ask again on this phone";

/** The line under the title: where the code comes from. */
export function codeScreenIntro(p: {
  method?: "totp" | "email";
  emailHint?: string;
  codeSent?: boolean;
}): string {
  if (p.method !== "email")
    return "Enter the 6-digit code from your authenticator app.";
  const to = p.emailHint ?? "your email";
  return p.codeSent === false
    ? `We've already emailed codes to ${to}. Use the newest one, or tap Email me a code.`
    : `We emailed a 6-digit code to ${to}. It can take a minute to arrive.`;
}

/** "Trust this phone" applies to password sign-in only, never to connecting. */
export function showTrustSwitch(purpose: "login" | "link"): boolean {
  return purpose === "login";
}

export type AfterVerify =
  | { kind: "finish"; user: User; token: string }
  | { kind: "save_code"; code: string; user: User; token: string };

/** A spent recovery code's replacement is shown (and saved) before signing in. */
export function afterVerify(result: MfaVerifyResult): AfterVerify {
  return result.replacementRecoveryCode
    ? {
        kind: "save_code",
        code: result.replacementRecoveryCode,
        user: result.user,
        token: result.token,
      }
    : { kind: "finish", user: result.user, token: result.token };
}

/** A failed answer: what to say, whether to start over, and any replacement code. */
export function afterVerifyFailure(err: unknown): {
  message: string;
  restart: boolean;
  replacement: string | undefined;
} {
  return {
    ...secondFactorErrorMessage(err),
    replacement: replacementFromError(err),
  };
}
