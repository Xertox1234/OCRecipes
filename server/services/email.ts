import { Resend } from "resend";
import type { CreateEmailOptions, ErrorResponse } from "resend";
import { emailVerificationEnabled } from "../lib/email-config";
import { createServiceLogger } from "../lib/logger";
import { escapeHtml } from "../lib/html-escape";
import { RESET_CODE_TTL_MINUTES } from "@shared/constants/password-reset";

const logger = createServiceLogger("email");

// Per-attempt cap on a single `resend.emails.send()`. The Resend SDK exposes no
// AbortSignal/timeout, so a slow send would otherwise linger as a multi-minute
// background promise; Promise.race against this timeout bounds the *orchestration
// promise* (the underlying HTTP socket can't be aborted and keeps draining, but
// our awaited promise resolves on schedule).
const SEND_TIMEOUT_MS = 8_000;
// Bounded retry on transient failures. MAX_RETRIES extra attempts after the
// first, so up to MAX_RETRIES + 1 sends total. Worst-case orchestration lifetime
// stays well under a minute: (MAX_RETRIES + 1) * SEND_TIMEOUT_MS + the backoff
// sum below ≈ 24s + 3s = 27s (the 3s is the 429 backoff sum, 1000 + 2000).
const MAX_RETRIES = 2;
// Backoff base before a transient (network / 5xx) retry, doubled per attempt
// (500ms, 1000ms). A 429 (rate_limit_exceeded) backs off distinctly with a
// longer base so we don't immediately re-hit the limit (1000ms, 2000ms).
const TRANSIENT_BACKOFF_BASE_MS = 500;
const RATE_LIMIT_BACKOFF_BASE_MS = 1_000;

// Resend error names that are worth retrying. A 429 backs off distinctly; 5xx /
// generic application errors are transient. Validation / auth / quota errors are
// terminal — retrying can't fix them, so they fall through and are logged once.
const RETRYABLE_ERROR_NAMES = new Set<ErrorResponse["name"]>([
  "rate_limit_exceeded",
  "internal_server_error",
  "application_error",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Send one email via Resend with a per-attempt timeout and a bounded, 429-aware
 * retry/backoff. The SDK returns `{ data, error }` (it does not throw on API
 * errors) and accepts no AbortSignal, so we Promise.race each attempt against a
 * timeout and inspect `error.name`.
 *
 * Returns the final `ErrorResponse | null` so callers preserve their existing
 * `logger.error({ err: toError(error) }, ...)` line: `null` on success, the last
 * error (real or synthesized for a timeout/network failure) on exhaustion.
 */
async function sendWithRetry(
  resend: Resend,
  payload: CreateEmailOptions,
): Promise<ErrorResponse | null> {
  let lastError: ErrorResponse | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Promise.race attaches a rejection handler to `send` synchronously, so a
      // send that rejects after the timeout already won is still considered
      // handled — no separate .catch() is needed to avoid an unhandledRejection.
      const { error } = await Promise.race([
        resend.emails.send(payload),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("resend send timed out")),
            SEND_TIMEOUT_MS,
          );
        }),
      ]);

      if (!error) return null; // success
      lastError = error;
      if (!RETRYABLE_ERROR_NAMES.has(error.name)) return error; // terminal
      if (attempt < MAX_RETRIES) {
        const base =
          error.name === "rate_limit_exceeded"
            ? RATE_LIMIT_BACKOFF_BASE_MS
            : TRANSIENT_BACKOFF_BASE_MS;
        await sleep(base * 2 ** attempt);
      }
    } catch (err) {
      // A rejected promise (network failure or the race timeout) — synthesize a
      // terminal-shaped error so the caller can log it, and retry transiently.
      lastError = {
        message: err instanceof Error ? err.message : String(err),
        name: "application_error",
        statusCode: null,
      };
      if (attempt < MAX_RETRIES) {
        await sleep(TRANSIENT_BACKOFF_BASE_MS * 2 ** attempt);
      }
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return lastError;
}

const APP_URL = process.env.EMAIL_VERIFY_BASE_URL ?? "https://ocrecipes.com";
const EMAIL_FROM =
  process.env.EMAIL_FROM ?? "OCRecipes <noreply@ocrecipes.com>";

// In-service per-recipient throttle. The signup-attempt notice has no endpoint
// of its own, so the per-IP register limiter cannot cap how many emails a
// victim's inbox receives. This sliding window is THE per-recipient cap for
// outbound mail, regardless of entry point, in two buckets. "general" (signup
// notice + verification) is the original shared 5/hour cap. "account-security"
// (reset code + password-changed notice) is separate: register is limited per
// IP only, so anyone who knows an address could otherwise drain the shared
// bucket with signup notices and silently swallow a reset code or the security
// notice. The route + DB issuance caps keep this bucket well under 10.
const RECIPIENT_WINDOW_MS = 60 * 60 * 1000;
type SendBucket = "general" | "account-security";
const BUCKET_CAPS: Record<SendBucket, number> = {
  general: 5,
  "account-security": 10,
};
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

// The "general" key stays the bare lowercased email (unchanged from before the
// buckets existed); other buckets are prefixed so they never share a window.
function bucketKey(email: string, bucket: SendBucket): string {
  const lower = email.toLowerCase();
  return bucket === "general" ? lower : `${bucket}:${lower}`;
}

function canSendTo(email: string, bucket: SendBucket = "general"): boolean {
  const now = Date.now();
  if (recipientSends.size > RECIPIENT_SWEEP_THRESHOLD) sweepExpired(now);
  const key = bucketKey(email, bucket);
  const times = (recipientSends.get(key) ?? []).filter(
    (t) => now - t < RECIPIENT_WINDOW_MS,
  );
  if (times.length === 0) {
    // Window fully expired (or no prior sends) — drop the stale key rather than
    // leaving an empty array behind, then re-add below only if we send.
    recipientSends.delete(key);
  }
  if (times.length >= BUCKET_CAPS[bucket]) {
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
  const error = await sendWithRetry(resend, {
    from: EMAIL_FROM,
    to,
    subject: "Verify your email for OCRecipes",
    html: `<p>Welcome to OCRecipes! Confirm your email to finish setting up your account.</p>
<p><a href="${url}">Verify my email</a></p>
<p>This link expires in 24 hours. If you didn't create an account, you can ignore this email.</p>`,
  });
  // Log the Resend ErrorResponse fields directly ({name, message, statusCode}).
  // It is NOT a JS Error, so `toError(error)` would flatten it to the useless
  // string "[object Object]" and eat the real reason.
  if (error) logger.error({ resendError: error }, "verification email failed");
}

export async function sendSignupAttemptNotice(
  to: string,
  username: string,
): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to)) {
    logger.warn({ to }, "signup-attempt notice throttled (per-recipient cap)");
    return;
  }
  const error = await sendWithRetry(resend, {
    from: EMAIL_FROM,
    to,
    subject: "Someone tried to sign up with your email",
    html: `<p>Someone just tried to create an OCRecipes account with this email address, but you already have one.</p>
<p>Your username is <strong>${escapeHtml(username)}</strong>. You can also sign in with this email address.</p>
<p>If this was you, simply <a href="${APP_URL}">log in</a> instead. Forgot your password? Use "Forgot password?" on the sign-in screen. If it wasn't you, no action is needed — no account was created.</p>`,
  });
  if (error)
    logger.error({ resendError: error }, "signup-attempt notice failed");
}

export async function sendPasswordResetCode(
  to: string,
  code: string,
): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to, "account-security")) {
    // Never log the code — only the recipient.
    logger.warn({ to }, "reset code throttled (account-security cap)");
    return;
  }
  const error = await sendWithRetry(resend, {
    from: EMAIL_FROM,
    to,
    subject: "Your OCRecipes password reset code",
    html: `<p>Use this code to reset your OCRecipes password:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:6px">${escapeHtml(code)}</p>
<p>It expires in ${RESET_CODE_TTL_MINUTES} minutes. If you requested more than one code, use the one in the most recent email.</p>
<p>If you didn't ask to reset your password, you can ignore this email — your password hasn't changed.</p>`,
  });
  // Log only the Resend error — the payload (which holds the code) never.
  if (error) logger.error({ resendError: error }, "reset code email failed");
}

export async function sendPasswordChangedNotice(
  to: string,
  username: string,
): Promise<void> {
  const resend = client();
  if (!resend || !emailVerificationEnabled()) return;
  if (!canSendTo(to, "account-security")) {
    logger.warn(
      { to },
      "password-changed notice throttled (account-security cap)",
    );
    return;
  }
  const error = await sendWithRetry(resend, {
    from: EMAIL_FROM,
    to,
    subject: "Your OCRecipes password was changed",
    html: `<p>The password for your OCRecipes account <strong>${escapeHtml(username)}</strong> was just changed, and every device was signed out.</p>
<p>If this was you, there's nothing else to do.</p>
<p>If this wasn't you, contact <a href="mailto:support@ocrecipes.com">support@ocrecipes.com</a> right away.</p>`,
  });
  if (error)
    logger.error({ resendError: error }, "password-changed notice failed");
}

/** Test-only internals — never import from production code. */
export const _testInternals = {
  recipientSends,
  RECIPIENT_WINDOW_MS,
  RECIPIENT_SWEEP_THRESHOLD,
};
