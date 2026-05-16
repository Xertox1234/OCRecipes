import type { Express, Response } from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { storage } from "../storage";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth";
import { handleRouteError } from "./_helpers";
import { exportRateLimit } from "./_rate-limiters";

// Resolve the app version once at module load. We avoid `resolveJsonModule` in
// tsconfig and `process.env.npm_package_version` (only populated when started
// via npm). Resolve from `__dirname` rather than `process.cwd()` so the lookup
// works regardless of where the server is launched from (e.g., a sub-directory
// or a packaged build). Falls back to a sentinel so the envelope field is
// always defined.
const APP_VERSION: string = (() => {
  try {
    // server/routes/export.ts → ../../package.json
    const pkgPath = resolve(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : "unknown";
  } catch {
    return "unknown";
  }
})();

/** YYYY-MM-DD in UTC — the filename must be stable regardless of server TZ. */
function utcDateStamp(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function register(app: Express): void {
  app.get(
    "/api/users/me/export",
    requireAuth,
    exportRateLimit,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const data = await storage.getUserDataExport(req.userId);
        const now = new Date();

        res.setHeader(
          "Content-Disposition",
          `attachment; filename="ocrecipes-export-${utcDateStamp(now)}.json"`,
        );
        // Disable any intermediate caches — this is per-user PII.
        res.setHeader("Cache-Control", "private, no-store");
        // Spread `...data` first so the server-controlled envelope fields
        // always win if the export payload ever gains a colliding key.
        res.json({
          ...data,
          exportedAt: now.toISOString(),
          appVersion: APP_VERSION,
        });
      } catch (error) {
        handleRouteError(res, error, "export user data");
      }
    },
  );
}
