import "dotenv/config";
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
import { validateEnv } from "./lib/env";
import { logger, rootLogger, toError } from "./lib/logger";
import { requestContextMiddleware } from "./lib/request-context";
import {
  runRetentionCleanup,
  assertExecutionAllowed as assertRetentionAllowed,
} from "./scripts/cleanup-retention";
import crypto from "node:crypto";

// Validate all environment variables before anything else
validateEnv();

process.on("uncaughtException", (error) => {
  logger.fatal({ err: toError(error) }, "uncaught exception");
  rootLogger.flush();
  // Give async transport time to drain before exiting
  setTimeout(() => process.exit(1), 500);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: toError(reason) }, "unhandled rejection");
});

const app = express();

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  const ALLOWED_ORIGIN_PATTERNS = [
    /^https?:\/\/localhost(:\d+)?$/,
    /^exp:\/\/.+$/,
    // Dev tunnels — only allowed outside production
    ...(process.env.NODE_ENV !== "production"
      ? [/^https:\/\/.+\.loca\.lt$/, /^https:\/\/.+\.ngrok\.io$/]
      : []),
  ];

  const publicDomain = process.env.EXPO_PUBLIC_DOMAIN;

  function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return true; // Allow requests with no origin (mobile apps, curl)
    if (publicDomain && origin === publicDomain) return true;
    return ALLOWED_ORIGIN_PATTERNS.some((pattern) => pattern.test(origin));
  }

  app.use((req, res, next) => {
    const origin = req.header("origin");

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

(() => {
  setupCors(app);
  app.use(helmet());
  setupBodyParsing(app);
  setupRequestLogging(app);
  app.use(requestContextMiddleware);

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

  // Health check endpoint (registered before routes for fast response)
  app.get("/api/health", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ status: "ok" });
    } catch {
      res
        .status(503)
        .json({ status: "unhealthy", error: "Database unreachable" });
    }
  });

  const server = registerRoutes(app);

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
        void pool.end().then(() => {
          process.exit(0);
        });
      });
    });
    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => process.exit(1), 10_000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
