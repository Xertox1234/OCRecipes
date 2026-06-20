import { Resend } from "resend";
import { emailVerificationEnabled } from "../lib/email-config";
import { createServiceLogger, toError } from "../lib/logger";

const logger = createServiceLogger("email");

const APP_URL = process.env.EMAIL_VERIFY_BASE_URL ?? "https://ocrecipes.app";
const EMAIL_FROM =
  process.env.EMAIL_FROM ?? "OCRecipes <noreply@ocrecipes.app>";

// In-service per-recipient throttle. The signup-attempt notice has no endpoint
// of its own, so the per-IP register limiter cannot cap how many emails a
// victim's inbox receives. This sliding window is THE per-recipient cap for all
// outbound mail (notice + verification), regardless of entry point.
const RECIPIENT_WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_RECIPIENT = 5;
// Sweep fully-expired keys once the map grows past this many recipients. A
// recipient touched once and never again (the enumeration case) is otherwise
// never revisited, so delete-on-empty alone cannot bound the key set — the sweep
// is what evicts those stale keys. Expiry-based only: an active key is never
// evicted, so the per-recipient cap is unchanged.
const RECIPIENT_SWEEP_THRESHOLD = 1000;
const recipientSends = new Map<string, number[]>();

function sweepExpired(now: number): void {
  for (const [key, times] of recipientSends) {
    if (times.every((t) => now - t >= RECIPIENT_WINDOW_MS)) {
      recipientSends.delete(key);
    }
  }
}

function canSendTo(email: string): boolean {
  const now = Date.now();
  if (recipientSends.size > RECIPIENT_SWEEP_THRESHOLD) sweepExpired(now);
  const key = email.toLowerCase();
  const times = (recipientSends.get(key) ?? []).filter(
    (t) => now - t < RECIPIENT_WINDOW_MS,
  );
  if (times.length === 0) {
    // Window fully expired (or no prior sends) — drop the stale key rather than
    // leaving an empty array behind, then re-add below only if we send.
    recipientSends.delete(key);
  }
  if (times.length >= MAX_PER_RECIPIENT) {
    recipientSends.set(key, times);
    return false;
  }
  times.push(now);
  recipientSends.set(key, times);
  return true;
}

// Lazy singleton: the SDK client (and its internal HTTP client) is built once on
// first use and reused for all subsequent sends. The key is captured at first
// construction, so rotating RESEND_API_KEY requires a process restart to take
// effect — fine under the deploy-restarts-the-process model. emailVerificationEnabled()
// still live-reads the env on every send, so the on/off gate stays current.
let _resend: Resend | null = null;
function client(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return (_resend ??= new Resend(key));
}

export async function sendVerificationEmail(
  to: string,
  token: string,
): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to)) {
    logger.warn({ to }, "verification email throttled (per-recipient cap)");
    return;
  }
  const url = `${APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Verify your email for OCRecipes",
    html: `<p>Welcome to OCRecipes! Confirm your email to finish setting up your account.</p>
<p><a href="${url}">Verify my email</a></p>
<p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`,
  });
  if (error) logger.error({ err: toError(error) }, "verification email failed");
}

export async function sendSignupAttemptNotice(to: string): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to)) {
    logger.warn({ to }, "signup-attempt notice throttled (per-recipient cap)");
    return;
  }
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Someone tried to sign up with your email",
    html: `<p>Someone just tried to create an OCRecipes account with this email address, but you already have one.</p>
<p>If this was you, simply <a href="${APP_URL}">log in</a> instead. If it wasn't, no action is needed — no account was created.</p>`,
  });
  if (error)
    logger.error({ err: toError(error) }, "signup-attempt notice failed");
}

/** Test-only internals — never import from production code. */
export const _testInternals = {
  recipientSends,
  RECIPIENT_WINDOW_MS,
  RECIPIENT_SWEEP_THRESHOLD,
};
