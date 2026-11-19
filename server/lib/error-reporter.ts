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
 * PII posture (@sentry/node 11.14.0, read in the installed source and
 * measured with an egress probe on 2026-11-18; first written for 10.65.0,
 * privacy audit L8): two layers, and neither relies on an SDK default.
 * `buildSentryOptions` turns every `dataCollection` field off except request
 * headers, never buffers a request body, and sends no Sentry Logs. Then the
 * `beforeSend` scrub below strips sensitive headers, cookies, bodies, query
 * strings and the `user` block from whatever still reaches an event, so
 * those stay off even if a later SDK release renames or re-defaults a
 * collection control. It cannot cover a key the SDK renames (v11 renamed the
 * breadcrumb query keys; both names are stripped now), and it never sees
 * Sentry Logs, which is why logs have two switches of their own.
 */
/* eslint-disable import/namespace -- eslint-plugin-import cannot read the
   exports of @sentry/node 11's bundled CJS entry ("No exported names found"),
   so it flags every `Sentry.x`. TypeScript checks these members. */
import * as Sentry from "@sentry/node";
import type { Application } from "express";
import { getRequestContext } from "./request-context";
import { logger } from "./logger";
import { loggedPath } from "./log-url";

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
 * (case-insensitive). This must cover `authorization` (bearer JWTs),
 * `x-api-key` (the B2B partner credential read by
 * server/middleware/api-key-auth.ts), and `cookie`.
 *
 * The credential-oriented entries below (through `"cookie"`) mirror the
 * installed SDK's own deny-list, `SENSITIVE_KEY_SNIPPETS` in @sentry/core
 * (19 entries; read at 10.65.0 on 2026-07-12, unchanged at 11.14.0 on
 * 2026-11-18). Do NOT assume future parity: the drift-guard tests in
 * `__tests__/error-reporter.test.ts` re-read that list, and the client-IP
 * names below, from the installed SDK on every run.
 *
 * The client-IP entries after that are an OCRecipes-specific addition and
 * are NOT part of Sentry's SENSITIVE_KEY_SNIPPETS. They are a
 * case-insensitive substring superset of the SDK's 12-entry `ipHeaderNames`
 * list (`x-forwarded-for`, `cf-connecting-ip`, `x-real-ip`,
 * `true-client-ip`, etc.). With SDK defaults those headers DO attach to
 * events in v11 (the 2026-11-18 probe's control run showed
 * `x-forwarded-for` on the event), so this list, not an SDK side effect, is
 * what keeps them off. IPs are GDPR/CCPA PII.
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
 * Keys kept from the `contexts.pino` block pinoIntegration attaches to every
 * logger.error-derived event. That block is the WHOLE log line minus `err`
 * (mixin requestId/userId, child bindings, and every ad-hoc field a call
 * site logs — `to` email addresses, provider error bodies, food/barcode
 * fields), so it is allowlisted rather than denylisted: anything not named
 * here never leaves the box. The requestId alone correlates an event back to
 * the full pino line in the log stream. `userId` is dropped on purpose,
 * matching `dataCollection.userInfo: false`.
 */
const PINO_CONTEXT_ALLOWLIST = new Set([
  "msg",
  "requestId",
  "service",
  "operation",
  "kind",
]);

/**
 * The request URL as Sentry keeps it: the origin, then the path the request
 * log keeps (no query string or fragment, a scanned barcode replaced by its
 * route parameter name).
 */
function scrubbedRequestUrl(url: string): string {
  const origin = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i.exec(url)?.[0] ?? "";
  return origin + loggedPath(url.slice(origin.length));
}

/**
 * PII scrubber for outbound events — the load-bearing control on this
 * external trust boundary (see the module doc: it holds even if an SDK
 * collection default changes).
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
  // The SDK fills `user` with the inferred client IP (and any id set on the
  // scope) when `dataCollection.userInfo` is on. It is off, and nothing here
  // sets a user, so anything present is unwanted.
  delete event.user;
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
      request.url = scrubbedRequestUrl(request.url);
    }
  }
  // A failed Drizzle query's message ends with "\nparams: <every bound
  // value>" — password hashes, coach health text, ids. Keep the query, drop
  // the values, for handled route errors and background failures alike.
  // Its `cause` (the pg error) arrives as a separate value through the SDK's
  // default linkedErrorsIntegration, and pg puts the rejected input in that
  // message for type/enum/date errors (`... for type uuid: "<input>"`), so
  // redact any quoted tail after ': "'. Three more pg shapes quote the input
  // mid-message; each is redacted greedily up to its fixed suffix, so a quote
  // inside the input cannot end the redaction early. Quoted identifiers in
  // other messages (`relation "users" does not exist`) are kept.
  for (const exception of event.exception?.values ?? []) {
    if (typeof exception.value !== "string") continue;
    const paramsStart = exception.value.indexOf("\nparams:");
    if (paramsStart !== -1) {
      exception.value = exception.value.slice(0, paramsStart);
    }
    // The mid-message rules run FIRST: an input containing ': "' would
    // otherwise let the tail cut eat the fixed suffix they match on.
    exception.value = exception.value
      // 22003: value "<input>" is out of range for type integer
      .replace(
        /\bvalue "[\s\S]*" is out of range for type\b/,
        'value "[redacted]" is out of range for type',
      )
      // 22023: time zone "<input>" not recognized
      .replace(
        /\btime zone "[\s\S]*" not recognized/,
        'time zone "[redacted]" not recognized',
      )
      // 22007 (to_date / to_timestamp): invalid value "<input>" for "<fmt>"
      .replace(
        /\binvalid value "[\s\S]*" for "/,
        'invalid value "[redacted]" for "',
      )
      .replace(/: "[\s\S]*$/, ': "[redacted]"');
  }
  const pinoContext = event.contexts?.pino;
  if (pinoContext) {
    for (const key of Object.keys(pinoContext)) {
      if (!PINO_CONTEXT_ALLOWLIST.has(key)) delete pinoContext[key];
    }
  }
  for (const crumb of event.breadcrumbs ?? []) {
    const data = crumb.data;
    if (!data) continue;
    // v10 key names, then the names v11 renamed them to.
    if ("http.query" in data) delete data["http.query"];
    if ("http.fragment" in data) delete data["http.fragment"];
    if ("url.query" in data) delete data["url.query"];
    if ("url.fragment" in data) delete data["url.fragment"];
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
 * Everything Sentry is told at init, in one exported place so
 * `__tests__/error-reporter.test.ts` can pin each privacy control and an
 * egress probe can run the real SDK on the real options.
 *
 * @sentry/node 11 changed three things that matter here (each read in the
 * installed 11.14.0 source on 2026-11-18, not taken from the docs):
 *
 * 1. `sendDefaultPii` is gone. `dataCollection` replaces it, and every field
 *    left unset defaults to COLLECT (`DEFAULTS` in @sentry/core: cookies, all
 *    four HTTP body directions, query params, DB query data, stack-frame
 *    local variables, gen-AI inputs and outputs). So every field is set here.
 * 2. `pinoIntegration` sends every pino line, at every level and with all its
 *    fields, as a Sentry LOG unless `log.levels` is emptied. v10 gated that
 *    behind `enableLogs`, but 10.78.0 defaulted that option to TRUE
 *    (@sentry/core client.js: `enableLogs ?? ... ?? true`), so the config
 *    this replaced was already shipping log lines; v11 has no gate at all.
 *    Logs never pass through `beforeSend`, so `beforeSendLog` also drops
 *    them as a second lock.
 * 3. The body-buffer switch was renamed `maxRequestBodySize`. The v10 name
 *    is ignored and the default falls back to `dataCollection.httpBodies`.
 */
export function buildSentryOptions(dsn: string): Sentry.NodeOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV,
    dataCollection: {
      // No user id, email, username or inferred IP.
      userInfo: false,
      cookies: false,
      // Request headers still attach (as in v10) and go through the
      // `beforeSend` scrub. Response headers are not needed for debugging.
      httpHeaders: { request: true, response: false },
      // NEVER collect bodies, in any direction: auth routes carry plaintext
      // passwords, coach/profile routes carry health data, and outgoing AI
      // calls carry both plus API keys.
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      mcp: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      // Local variables of a throwing frame hold passwords and health text.
      stackFrameVariables: false,
      // Source context lines only (code, not data); 7 was the v10 value.
      frameContextLines: 7,
    },
    beforeSend: beforeSendHandler,
    // Sentry Logs are not used. See point 2 above.
    beforeSendLog: () => null,
    integrations: [
      // NEVER buffer incoming request bodies onto events. See point 3 above.
      Sentry.httpIntegration({ maxRequestBodySize: "none" }),
      // Sentry captures uncaught exceptions but must NOT exit the process —
      // the uncaughtException handler in server/index.ts owns the
      // log/flush/exit sequence.
      Sentry.onUncaughtExceptionIntegration({
        exitEvenIfOtherHandlersAreRegistered: false,
      }),
      // Every logger.error becomes a handled Sentry event. Handled failures
      // never reach Sentry otherwise: the cron/interval catches and the SSE
      // chat-turn catch log and swallow, and onUnhandledRejection only sees
      // UNhandled rejections. (fireAndForget also calls reportError with the
      // same Error it logs, so that capture is deduped, not doubled.) Error
      // level only (warn stays log-only). `log.levels: []` turns off the
      // log-line capture described in point 2. Events still pass through
      // beforeSend (rate cap + scrub — scrubEvent allowlists the attached
      // pino context). An Error object logged here AND passed to reportError
      // (handleRouteError) is captured once: the SDK marks a captured Error
      // and skips repeats.
      Sentry.pinoIntegration({
        error: { levels: ["error"] },
        log: { levels: [] },
      }),
      // The default onUnhandledRejection integration (mode: "warn") stays:
      // it captures without exiting, matching the project convention that
      // unhandledRejection never exits.
    ],
  };
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
  Sentry.init(buildSentryOptions(dsn));
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
 *
 * v11 marks `setupExpressErrorHandler` deprecated in favour of automatic
 * capture by its Express integration. It is kept: the 2026-11-18 probe (a
 * server bundled like production, no `--import` preload) got exactly one
 * event for an error passed to `next()` with this call in place. Removing it
 * needs the same probe to show the automatic path fires on its own.
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
