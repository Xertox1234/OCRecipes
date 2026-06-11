/**
 * Boot-time environment validation as a side-effect import.
 *
 * This module MUST be the first import declaration in server/index.ts.
 *
 * Why a side-effect module: static imports are hoisted and evaluated before
 * any module body code, so a `validateEnv()` call in index.ts's body can
 * never run before `./db` — which throws its own single-var error on a
 * missing DATABASE_URL, and is reached transitively via
 * `./routes` → storage. Import declarations DO evaluate in declaration
 * order relative to each other (in both the tsx/CJS dev mode and the
 * esbuild ESM production bundle), so placing this module first guarantees
 * the aggregated all-missing-vars report from validateEnv() wins.
 *
 * dotenv must load before validation; importing it here (before ./env)
 * preserves that ordering for any entry point that uses this module.
 *
 * Note: server/db.ts keeps its own DATABASE_URL throw as defense-in-depth
 * for entry points that import db directly without this bootstrap
 * (server/scripts/*, seed scripts).
 */
import "dotenv/config";
import { validateEnv } from "./env";

// Return value intentionally discarded — callers needing the validated env
// object use getEnv() from ./env.
validateEnv();
