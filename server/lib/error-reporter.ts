/**
 * Server-side off-process error reporter (Sentry).
 *
 * This is the single point of contact with @sentry/node — never import
 * Sentry directly elsewhere (mirrors client/lib/reporter.ts, the client
 * twin of this module).
 *
 * Reporting is active only when SENTRY_DSN is set AND NODE_ENV=production,
 * mirroring the client's "DSN set AND !__DEV__" contract: the wiring ships
 * before a DSN exists (no-op), and a DSN in a local .env can never spam
 * Sentry from a dev box. Never calls Sentry.init with an empty DSN.
 *
 * Error tracking only — tracesSampleRate is deliberately never set, so no
 * performance tracing events are billed. Capture is fire-and-forget (the
 * SDK queues events to an async transport); nothing here blocks the
 * error-response path.
 *
 * PII posture (verified against the installed @sentry/node 10.65.0 source):
 * `sendDefaultPii: false` only withholds IP/user data. Request headers,
 * cookies, and query strings still attach raw to error events, and the
 * default httpIntegration buffers up to 10KB of every incoming request
 * body onto events regardless of that flag. The REAL controls here are
 * `maxIncomingRequestBodySize: "none"` (bodies are never even buffered)
 * and the `beforeSend` scrub below (headers/cookies/query stripped).
 */
import * as Sentry from "@sentry/node";
import type { Application } from "express";
import { getRequestContext } from "./request-context";
import { logger } from "./logger";

/**
 * In-process cap on reported events. A noisy error loop (e.g. a crashing
 * cron tick or a 500 on a hot route) must not turn into unbounded Sentry
 * ingestion spend: beyond this many events per minute, beforeSend drops
 * the rest client-side (with one stdout warning per window so on-call can
 * see the reporter went partially dark). Sentry's server-driven 429 rate
 * limits still apply on top of this.
 */
export const MAX_EVENTS_PER_MINUTE = 60;

let active = false;
let windowStart = 0;
let windowCount = 0;
let droppedInWindow = false;

function underRateCap(): boolean {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    windowCount = 0;
    droppedInWindow = false;
  }
  windowCount += 1;
  if (windowCount <= MAX_EVENTS_PER_MINUTE) return true;
  if (!droppedInWindow) {
    droppedInWindow = true;
    logger.warn(
      { cap: MAX_EVENTS_PER_MINUTE },
      "error reporter: per-minute event cap reached — dropping further events this window",
    );
  }
  return false;
}

/**
 * Header names are scrubbed when they CONTAIN any of these snippets
 * (case-insensitive) — an exact-name check is not enough because in
 * @sentry/node v10 ALL headers attach raw to error events (the SDK's own
 * sensitive-key filtering applies only to span attributes, which we never
 * emit). This must cover `authorization` (bearer JWTs), `x-api-key` (the
 * B2B partner credential read by server/middleware/api-key-auth.ts), and
 * `cookie`.
 *
 * The credential-oriented entries below (through `"cookie"`) are a verified
 * reconciliation with the installed SDK's own deny-list — read directly from
 * `node_modules/@sentry/node/node_modules/@sentry/core/.../filtering-snippets.js`
 * `SENSITIVE_KEY_SNIPPETS` (@sentry/core 10.65.0, 2026-07-12), not from docs.
 * Do NOT assume future parity — re-diff against the installed source on any
 * @sentry/node major/minor bump.
 *
 * The client-IP entries after that are an OCRecipes-specific addition and
 * are NOT part of Sentry's SENSITIVE_KEY_SNIPPETS (Sentry keeps IP-adjacent
 * header matching in a separate, narrower `PII_HEADER_SNIPPETS` list used
 * only for its own span-attribute scrubbing, which we never emit): IPs are
 * GDPR/CCPA PII, and `sendDefaultPii: false` only withholds the SDK-inferred
 * `user.ip_address`, not raw `x-forwarded-for` / `x-real-ip` /
 * `cf-connecting-ip` / `true-client-ip` header values.
 *
 * Referer/Origin header VALUES are deliberately NOT scrubbed today — see the
 * DECISION note below.
 */
const SENSITIVE_HEADER_SNIPPETS = [
  // Verified parity with @sentry/core's SENSITIVE_KEY_SNIPPETS (see above).
  "auth",
  "token",
  "secret",
  "session",
  "password",
  "passwd",
  "pwd",
  "key",
  "jwt",
  "bearer",
  "sso",
  "saml",
  "csrf",
  "xsrf",
  "credentials",
  "sid",
  "identity",
  "set-cookie",
  "cookie",
  // OCRecipes-specific: client-IP headers (GDPR/CCPA PII), not in Sentry's
  // own list.
  "forwarded",
  "real-ip",
  "connecting-ip",
  "client-ip",
];

/**
 * DECISION (2026-07-12): header-NAME matching above is sufficient for now;
 * header-VALUE scrubbing (e.g. stripping the query string out of a
 * `Referer` value) is deliberately NOT implemented, because `referer`
 * doesn't match any SENSITIVE_HEADER_SNIPPETS entry and passes through
 * `scrubEvent` unmodified. `Origin` is excluded from this concern entirely —
 * it is spec-defined as scheme+host+port only and structurally cannot carry
 * a path or query string, so it can never carry a token regardless.
 *
 * `Referer` is the real vector: `GET /verify-email?token=…`
 * (`server/lib/verify-email-page.ts`) already renders a live token in its
 * own URL and is opened in real browsers today (it works in ANY browser by
 * design — no app install required). It is safe ONLY because that page
 * emits zero external subresource requests (inline CSS only, its one CTA
 * link is a bare `ocrecipes://` scheme, not an `http(s)://` URL) — no
 * subsequent request ever carries that page's URL as `Referer`. REVISIT the
 * moment any page that renders a live token in its own URL gains an
 * `http(s)://` link, asset, redirect, or analytics beacon — not "the day a
 * web client ships" (that framing undersells the risk: the vector is any
 * browser-rendered, token-bearing page gaining an outbound same-origin or
 * cross-origin request, which could happen to `verify-email-page.ts` itself
 * before a formal web client exists). At that point, either add `referer`
 * to `SENSITIVE_HEADER_SNIPPETS` (blunt: drops the header entirely) or
 * strip just the query string from its value in `scrubEvent` (surgical: the
 * same treatment `request.url` already gets below).
 */

/**
 * PII scrubber for outbound events — the load-bearing control on this
 * external trust boundary (see the module doc: `sendDefaultPii: false`
 * does NOT withhold headers/cookies/query on the error-event path in v10).
 *
 * Strips sensitive headers, cookies, request bodies, and query strings
 * (token-bearing URLs like GET /verify-email?token=… must never reach an
 * off-box sink — requestId + path is enough for log correlation), both on
 * `event.request` and on http breadcrumbs (outbound calls to CNF/USDA/
 * Spoonacular carry API keys in their query strings).
 *
 * Exported so it can be unit-tested without initializing Sentry.
 */
export function scrubEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  const request = event.request;
  if (request) {
    const headers = request.headers;
    if (headers) {
      for (const name of Object.keys(headers)) {
        const lower = name.toLowerCase();
        if (SENSITIVE_HEADER_SNIPPETS.some((s) => lower.includes(s))) {
          delete headers[name];
        }
      }
    }
    delete request.data;
    delete request.cookies;
    delete request.query_string;
    if (typeof request.url === "string") {
      const queryStart = request.url.indexOf("?");
      if (queryStart !== -1) {
        request.url = request.url.slice(0, queryStart);
      }
    }
  }
  for (const crumb of event.breadcrumbs ?? []) {
    const data = crumb.data;
    if (!data) continue;
    if ("http.query" in data) delete data["http.query"];
    if ("http.fragment" in data) delete data["http.fragment"];
    if (typeof data.url === "string") {
      const queryStart = data.url.indexOf("?");
      if (queryStart !== -1) {
        data.url = data.url.slice(0, queryStart);
      }
    }
  }
  return event;
}

/**
 * beforeSend pipeline: rate-cap → requestId tag → PII scrub.
 *
 * beforeSend runs synchronously inside the capture call, which happens
 * inside the request's AsyncLocalStorage run — so `getRequestContext()`
 * yields the same requestId pino logs and the X-Request-Id header carries,
 * letting a server event be correlated with the client-side Sentry report
 * for the same request. Outside a request (startup, cron, process-level
 * handlers) the context is undefined and the event goes out untagged.
 */
export function beforeSendHandler(
  event: Sentry.ErrorEvent,
): Sentry.ErrorEvent | null {
  if (!underRateCap()) return null;
  const ctx = getRequestContext();
  if (ctx) {
    event.tags = { ...event.tags, requestId: ctx.requestId };
  }
  return scrubEvent(event);
}

/**
 * Initialize Sentry. Safe to call unconditionally — no-op unless SENTRY_DSN
 * is set and NODE_ENV=production (see module doc). Reads process.env at call
 * time, after env-boot has loaded dotenv. Called from error-reporter-boot.ts
 * so it runs before express/db/routes are imported.
 */
export function initErrorReporter(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || process.env.NODE_ENV !== "production") return;
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // Withholds IP/user data (its actual v10 scope — headers/bodies are
    // handled by the integration option + beforeSend scrub, see module doc).
    // Already the SDK default; set explicitly so it cannot silently flip.
    sendDefaultPii: false,
    beforeSend: beforeSendHandler,
    integrations: [
      // NEVER buffer incoming request bodies onto events — auth routes carry
      // plaintext passwords and coach/profile routes carry user health data.
      // Not gated by sendDefaultPii in v10; this option is the only off switch.
      Sentry.httpIntegration({ maxIncomingRequestBodySize: "none" }),
      // Sentry captures uncaught exceptions but must NOT exit the process —
      // the uncaughtException handler in server/index.ts owns the
      // log/flush/exit sequence.
      Sentry.onUncaughtExceptionIntegration({
        exitEvenIfOtherHandlersAreRegistered: false,
      }),
      // The default onUnhandledRejection integration (mode: "warn") stays:
      // it captures without exiting, matching the project convention that
      // unhandledRejection never exits.
    ],
  });
  active = true;
  // Positive signal that error tracking is live (never log the DSN itself) —
  // a malformed DSN makes Sentry.init fail silently, so absence of this line
  // in prod logs means the reporter is dark.
  logger.info("error reporter: Sentry active (server-side error tracking)");
}

/**
 * Report a handled server error. The route convention (handleRouteError →
 * sendError) responds directly and never calls next(err), so Sentry's
 * Express error handler never sees handled 5xx — this is the capture
 * chokepoint for them. Runs the same beforeSend pipeline (rate cap,
 * requestId tag, scrub). No-op when inactive.
 */
export function reportError(error: unknown, context?: string): void {
  if (!active) return;
  Sentry.captureException(error, context ? { extra: { context } } : undefined);
}

/**
 * Register Sentry's Express error handler. Must be called after all routes
 * and before the app's own JSON error handler; captures only 5xx by default
 * and always forwards to the next error handler. No-op when inactive.
 */
export function attachExpressErrorReporter(app: Application): void {
  if (!active) return;
  Sentry.setupExpressErrorHandler(app);
}

/**
 * Give the Sentry transport a bounded window to drain queued events before
 * process exit (uncaughtException and graceful-shutdown paths). Resolves
 * true when drained (or inactive), false on timeout/failure — never
 * rejects, never blocks longer than `timeoutMs`.
 */
export function flushErrorReporter(timeoutMs: number): Promise<boolean> {
  if (!active) return Promise.resolve(true);
  return Sentry.flush(timeoutMs).catch(() => false);
}
