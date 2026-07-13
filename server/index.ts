// MUST stay the first import: validates all env vars (aggregated report)
// before ./routes / ./db evaluate — see server/lib/env-boot.ts.
import "./lib/env-boot";
// MUST stay the second import: initializes Sentry (no-op without SENTRY_DSN /
// outside production) before express/./db/./routes evaluate, so its http
// instrumentation is in place — see server/lib/error-reporter-boot.ts.
import "./lib/error-reporter-boot";
import express from "express";
import helmet from "helmet";
import type { Request, Response, NextFunction } from "express";
import pinoHttp from "pino-http";
import cron from "node-cron";
import { registerRoutes } from "./routes";
import * as path from "path";
import { pool } from "./db";
import { startCacheCleanupJob } from "./storage/cache";
import { startPromotionJob } from "./services/canonical-promotion";
import { logger, rootLogger, toError } from "./lib/logger";
import {
  attachExpressErrorReporter,
  flushErrorReporter,
} from "./lib/error-reporter";
import { requestContextMiddleware } from "./lib/request-context";
import { installContractSnapshotMiddleware } from "./lib/contract-snapshot";
import { UUID_RE } from "./lib/identifier-patterns";
import {
  runRetentionCleanup,
  assertExecutionAllowed as assertRetentionAllowed,
} from "./scripts/cleanup-retention";
import { rateLimit } from "express-rate-limit";
import { ipKeyGenerator } from "./routes/_rate-limiters";
import crypto from "node:crypto";

process.on("uncaughtException", (error) => {
  logger.fatal({ err: toError(error) }, "uncaught exception");
  rootLogger.flush();
  // Sentry's OnUncaughtException integration has already captured the error
  // (with exitEvenIfOtherHandlersAreRegistered: false, so this handler owns
  // the exit); explicitly chain the bounded drain into the exit call itself
  // (.finally()-style, matching the graceful-shutdown path below) instead of
  // relying on the implicit 400ms-flush < 500ms-exit-delay timing coupling.
  //
  // flushErrorReporter resolves INSTANTLY when the reporter is inactive
  // (dev — NODE_ENV !== "production" — or prod without SENTRY_DSN; see its
  // docstring). A bare `.finally(() => process.exit(1))` on an
  // already-resolved promise would fire on the very next microtask, i.e.
  // near-immediately — collapsing the drain window the old unconditional
  // 500ms setTimeout gave rootLogger.flush() above. That matters in dev,
  // where rootLogger uses pino-pretty's worker-thread transport (genuinely
  // async unlike production's synchronous stdout write): an instant exit
  // could truncate this very "uncaught exception" fatal log before the
  // worker thread processes the flush. `minDelay` restores that floor by
  // requiring BOTH the flush and a 500ms timer to settle before exiting.
  //
  // Timing note: `flushErrorReporter(400)`'s "400" is a per-step timeout
  // passed to @sentry/core's `client.flush()`, which sequentially awaits
  // _isClientDoneProcessing(timeout) THEN transport.flush(timeout) — each
  // independently bounded — so the real worst case is ~2x that (~800ms),
  // not 400ms. The independent backstop below is set above that worst case
  // so it only fires if the SDK's own internal bound is ever violated.
  const minDelay = new Promise<void>((resolve) => setTimeout(resolve, 500));
  void Promise.all([flushErrorReporter(400), minDelay]).finally(() =>
    process.exit(1),
  );
  // Independent hard backstop (mirrors the graceful-shutdown path's own
  // force-exit timer): guarantees exit even if flushErrorReporter's promise
  // somehow never settles — Sentry.flush()'s bound is a third-party SDK
  // implementation detail, not a contract this codebase controls. Set above
  // the ~800ms realistic worst case above so it never fires under normal
  // conditions. process.exit() only takes effect on its first call, so this
  // is a no-op once the chain above has already exited.
  setTimeout(() => process.exit(1), 1000);
});

process.on("unhandledRejection", (reason) => {
  // Sentry's default OnUnhandledRejection integration (mode: "warn")
  // captures these; this handler only logs — it must never exit.
  logger.error({ err: toError(reason) }, "unhandled rejection");
});

const app = express();

// Deployed behind Railway's edge proxy: trust exactly one hop so req.ip is
// read from X-Forwarded-For instead of resolving to the proxy address (which
// collapses every IP-keyed rate limiter into one global bucket). Never set
// this to `true` — that trusts the leftmost, client-spoofable XFF entry and
// lets attackers choose their own rate-limit bucket.
app.set("trust proxy", 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  const ALLOWED_ORIGIN_PATTERNS = [
    /^exp:\/\/.+$/,
    // Dev origins — only allowed outside production. localhost included: a
    // hostile page served on a victim's machine must not be able to make
    // credentialed CORS requests against the prod API.
    ...(process.env.NODE_ENV !== "production"
      ? [
          /^https?:\/\/localhost(:\d+)?$/,
          /^https:\/\/.+\.loca\.lt$/,
          /^https:\/\/.+\.ngrok\.io$/,
        ]
      : []),
  ];

  const publicDomain = process.env.EXPO_PUBLIC_DOMAIN;
  // Web frontend origin (e.g. https://ocrecipes.app). Set at web launch.
  // Use Bearer auth on the web client — Access-Control-Allow-Credentials can
  // be dropped once the web client is confirmed Bearer-only (no cookies). If
  // cookie/session auth is ever adopted, a fresh CORS + CSRF security pass is
  // required (see Risks in todos/P3-2026-06-10-web-frontend-cors-origin.md).
  // Set the bare origin with no trailing slash, e.g. https://ocrecipes.app
  const webOrigin = process.env.WEB_ORIGIN;

  function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true; // Allow requests with no origin (mobile apps, curl)
    if (publicDomain && origin === publicDomain) return true;
    if (webOrigin && origin === webOrigin) return true;
    return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
  }

  app.use((req, res, next) => {
    const origin = req.header("origin");

    // Vary unconditionally so shared caches (Railway edge / CDN) never serve
    // one origin's ACAO grant to a different origin, even for no-origin
    // responses (mobile/curl) that carry no ACAO header.
    res.vary("Origin");

    if (isAllowedOrigin(origin)) {
      // Only reflect a specific origin when credentials are enabled.
      // Browsers reject Access-Control-Allow-Origin: * with credentials.
      // For no-origin requests (mobile apps, curl), omit the header entirely
      // rather than sending "*" which is incompatible with credentials.
      if (origin) {
        res.header("Access-Control-Allow-Origin", origin);
        res.header("Access-Control-Allow-Credentials", "true");
      }
      res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      );
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }

    next();
  });
}

function setupBodyParsing(app: express.Application) {
  app.use(
    express.json({
      limit: "2mb",
      verify: (req, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  app.use(express.urlencoded({ extended: false, limit: "2mb" }));
}

function setupRequestLogging(app: express.Application) {
  app.use(
    pinoHttp({
      logger: rootLogger,
      genReqId: (req) => {
        const incoming = req.headers["x-request-id"] as string | undefined;
        return incoming && UUID_RE.test(incoming)
          ? incoming
          : crypto.randomUUID();
      },
      autoLogging: {
        ignore: (req) =>
          !req.url?.startsWith("/api") || req.url === "/api/health",
      },
      serializers: {
        req(req) {
          return {
            method: req.method,
            url: req.url,
            headers: {
              "content-type": req.headers["content-type"],
              "user-agent": req.headers["user-agent"],
              "x-request-id": req.headers["x-request-id"],
            },
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
      customSuccessMessage: (req) => `${req.method} ${req.url}`,
      customErrorMessage: (req) => `${req.method} ${req.url}`,
    }),
  );
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;

    logger.error({ err: toError(err) }, "internal server error");

    if (res.headersSent) {
      return next(err);
    }

    // Only expose error messages for client errors (4xx).
    // For server errors (5xx), return a generic message to avoid leaking internals.
    const message =
      status < 500 ? error.message || "Bad Request" : "Internal Server Error";

    return res.status(status).json({ error: message });
  });
}

function startServer() {
  setupCors(app);
  app.use(helmet());
  setupBodyParsing(app);
  setupRequestLogging(app);
  app.use(requestContextMiddleware);
  // Dev-only, opt-in (CONTRACT_SNAPSHOT=1) — see server/lib/contract-snapshot.ts and
  // docs/research/2026-07-05-pg-lab-roadmap.md (PG Lab Batch C).
  installContractSnapshotMiddleware(app);

  // Serve static assets
  app.use(
    "/assets",
    express.static(path.resolve(process.cwd(), "assets"), { dotfiles: "deny" }),
  );

  // Serve uploaded avatar images (intentionally public — no auth required)
  app.use(
    "/api/avatars",
    express.static(path.resolve(process.cwd(), "uploads/avatars"), {
      maxAge: "1d",
      etag: true,
      lastModified: true,
      dotfiles: "deny",
    }),
  );

  // Serve uploaded recipe images (public — no auth required)
  app.use(
    "/api/recipe-images",
    express.static(path.resolve(process.cwd(), "uploads/recipe-images"), {
      maxAge: "7d",
      etag: true,
      lastModified: true,
      dotfiles: "deny",
    }),
  );

  // Health check endpoint (registered before routes for fast response).
  // Unauthenticated and runs a DB query (SELECT 1) per hit, so an unbounded flood
  // could pressure the connection pool. The limiter bounds the per-IP request
  // rate. The cap is deliberately high (600/min ≈ 10/s) to stay well clear of
  // legitimate bursts: Railway's deploy healthcheck polls this path repeatedly
  // within its 30s timeout (railway.json healthcheckPath) and those probes
  // collapse into one IP bucket, so a high ceiling guarantees a deploy can never
  // 429-fail here — while a flood is still capped to a bounded rate. Defined
  // inline (not via the _rate-limiters.ts createRateLimiter factory) so CodeQL's
  // js/missing-rate-limiting query can trace it — the re-exported factory consts
  // are untraceable (the dismissed #146–#215 cluster). Reuses the shared
  // ipKeyGenerator for X-Real-IP/Railway keying.
  app.get(
    "/api/health",
    rateLimit({
      windowMs: 60 * 1000,
      max: 600,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: ipKeyGenerator,
      message: {
        error: "Too many health check requests. Please wait.",
        code: "RATE_LIMITED",
      },
    }),
    async (_req, res) => {
      try {
        await pool.query("SELECT 1");
        res.json({ status: "ok" });
      } catch {
        res
          .status(503)
          .json({ status: "unhealthy", error: "Database unreachable" });
      }
    },
  );

  const server = registerRoutes(app);

  // Sentry's Express error handler must sit after all routes and before our
  // JSON error handler. It captures only 5xx by default, tags events with
  // the ALS requestId (via beforeSend), and always forwards to the next
  // error handler. No-op when the reporter is inactive.
  attachExpressErrorReporter(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      logger.info({ port }, "express server started");
    },
  );

  // Start periodic cache cleanup (every 6 hours)
  const cacheCleanupInterval = startCacheCleanupJob();

  // Start canonical recipe promotion job (every 6 hours)
  const promotionInterval = startPromotionJob();

  // Daily retention cleanup at 03:00 UTC. Opt-in only — refuses to start in
  // NODE_ENV=production without RETENTION_CLEANUP_ENABLED=true so the
  // destructive job can never run by accident. The flag is also required to
  // enable scheduling outside production so dev/test boots stay
  // side-effect-free; explicit flips on a dev box are still possible.
  let retentionCleanupTask: ReturnType<typeof cron.schedule> | null = null;
  // Track the most recent in-flight cleanup so graceful shutdown can wait
  // for it. The cron handler resets this to `null` when the run resolves,
  // so the shutdown path only awaits an actually-running purge.
  let retentionInFlight: Promise<unknown> | null = null;
  if (process.env.RETENTION_CLEANUP_ENABLED === "true") {
    try {
      assertRetentionAllowed();
      retentionCleanupTask = cron.schedule(
        "0 3 * * *",
        () => {
          const run = runRetentionCleanup().catch((err) => {
            logger.error(
              { err: toError(err) },
              "retention cleanup: unhandled error",
            );
          });
          retentionInFlight = run;
          void run.finally(() => {
            if (retentionInFlight === run) {
              retentionInFlight = null;
            }
          });
        },
        { timezone: "UTC" },
      );
      logger.info(
        { schedule: "0 3 * * * UTC" },
        "retention cleanup: scheduled daily run",
      );
    } catch (err) {
      logger.error(
        { err: toError(err) },
        "retention cleanup: refusing to schedule",
      );
    }
  } else {
    logger.info(
      "retention cleanup: disabled (RETENTION_CLEANUP_ENABLED!=true)",
    );
  }

  // Graceful shutdown
  function shutdown(signal: string) {
    logger.info({ signal }, "graceful shutdown initiated");
    rootLogger.flush();
    clearInterval(cacheCleanupInterval);
    clearInterval(promotionInterval);
    if (retentionCleanupTask) {
      void retentionCleanupTask.stop();
    }
    // Wait up to the shutdown deadline for an in-flight retention cleanup
    // to finish its current batch before draining the pool. A truncation
    // mid-batch can leave a partial DELETE uncommitted, so we'd rather
    // hold the connection a few extra seconds than race the pool close.
    const finishRetention = retentionInFlight
      ? Promise.race([
          retentionInFlight,
          new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
        ])
      : Promise.resolve();
    void finishRetention.finally(() => {
      server.close(() => {
        // Drain queued Sentry events (bounded) before the pool teardown — a
        // 5xx captured from an in-flight request during a deploy cutover
        // would otherwise be dropped with the process. No-op when inactive;
        // fits well inside the 10s force-exit deadline below.
        void flushErrorReporter(2_000).finally(() => {
          void pool.end().then(() => {
            process.exit(0);
          });
        });
      });
    });
    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => process.exit(1), 10_000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

try {
  startServer();
} catch (err) {
  logger.error({ err: toError(err) }, "fatal startup error");
  process.exit(1);
}
