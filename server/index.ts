import "dotenv/config";
import express from "express";
import helmet from "helmet";
import type { Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import * as path from "path";
import { pool } from "./db";
import { startCacheCleanupJob } from "./storage/cache";
import { validateEnv } from "./lib/env";

// Validate all environment variables before anything else
validateEnv();

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});

const app = express();
const log = console.warn;

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

function setupCors(app: express.Application) {
  const ALLOWED_ORIGIN_PATTERNS = [
    /^https?:\/\/localhost(:\d+)?$/,
    /^exp:\/\/.+$/,
    /^https:\/\/.+\.loca\.lt$/, // localtunnel
    /^https:\/\/.+\.ngrok\.io$/, // ngrok
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
      res.header("Access-Control-Allow-Origin", origin || "*");
      res.header("Access-Control-Allow-Credentials", "true");
    }

    res.header(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, DELETE, OPTIONS",
    );
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");

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

// Endpoints whose response bodies should never be logged (tokens, medical data)
const SENSITIVE_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/account",
  "/api/medication",
];

function isSensitivePath(reqPath: string): boolean {
  return SENSITIVE_PATHS.some(
    (p) => reqPath === p || reqPath.startsWith(p + "/"),
  );
}

function setupRequestLogging(app: express.Application) {
  app.use((req, res, next) => {
    const start = Date.now();
    const reqPath = req.path;
    let capturedJsonResponse: Record<string, unknown> | undefined = undefined;

    const originalResJson = res.json;
    res.json = function (bodyJson, ...args) {
      capturedJsonResponse = bodyJson;
      return originalResJson.apply(res, [bodyJson, ...args]);
    };

    res.on("finish", () => {
      if (!reqPath.startsWith("/api")) return;

      const duration = Date.now() - start;

      let logLine = `${req.method} ${reqPath} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && !isSensitivePath(reqPath)) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    });

    next();
  });
}

function setupErrorHandler(app: express.Application) {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const error = err as {
      status?: number;
      statusCode?: number;
      message?: string;
    };

    const status = error.status || error.statusCode || 500;

    console.error("Internal Server Error:", err);

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

(async () => {
  setupCors(app);
  app.use(helmet());
  setupBodyParsing(app);
  setupRequestLogging(app);

  // Serve static assets
  app.use("/assets", express.static(path.resolve(process.cwd(), "assets")));

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

  const server = await registerRoutes(app);

  setupErrorHandler(app);

  const port = parseInt(process.env.PORT || "3000", 10);
  server.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`express server serving on port ${port}`);
    },
  );

  // Start periodic cache cleanup (every 6 hours)
  const cacheCleanupInterval = startCacheCleanupJob();

  // Graceful shutdown
  function shutdown(signal: string) {
    log(`${signal} received, shutting down gracefully`);
    clearInterval(cacheCleanupInterval);
    server.close(() => {
      pool.end().then(() => {
        process.exit(0);
      });
    });
    // Force exit after 10 seconds if graceful shutdown hangs
    setTimeout(() => process.exit(1), 10_000);
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
})();
