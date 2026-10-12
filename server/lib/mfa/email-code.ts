import { storage } from "../../storage";
import { sendSignInCode } from "../../services/email";
import { fireAndForget } from "../fire-and-forget";
import { generateResetCode, hashSignInCode } from "../password-reset-code";
import type { IssueResult } from "../../storage/mfa-email";

/**
 * Make, store (HMAC only) and email a two-step code. Emails only when the
 * store accepted it, so a cooldown or the daily limit never reads as "sent".
 */
export async function sendMfaEmailCode(user: {
  id: string;
  email: string;
}): Promise<IssueResult> {
  const code = generateResetCode();
  const result = await storage.issueMfaEmailCode(
    user.id,
    hashSignInCode(user.id, code),
  );
  if (result === "issued") {
    fireAndForget("mfa-email-code", sendSignInCode(user.email, code));
  }
  return result;
}

/** "william@gmail.com" → "w•••@gmail.com": enough to recognise, not to harvest. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "your email";
  return `${email[0]}•••${email.slice(at)}`;
}
