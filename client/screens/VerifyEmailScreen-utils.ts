import { apiRequest } from "@/lib/query-client";

// Pragmatic client mirror; the server re-validates with zero trust.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailShape(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export async function verifyEmailRequest(token: string): Promise<void> {
  await apiRequest("POST", "/api/auth/verify-email", { token });
}

export async function resendVerificationRequest(email: string): Promise<void> {
  await apiRequest("POST", "/api/auth/resend-verification", {
    email: email.trim(),
  });
}
