import type { MfaVerifyResult, User } from "@shared/types/auth";
import {
  replacementFromError,
  secondFactorErrorMessage,
} from "@/lib/second-factor-utils";

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
