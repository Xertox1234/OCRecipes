/**
 * Thin client logger.
 *
 * In development: writes to console (visible in Metro / RN debugger).
 * In production: forwards errors to the off-device reporter; info/warn are
 * silent (avoid spamming Sentry breadcrumbs with routine messages).
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.error("lookup failed", err);
 *   logger.warn("unexpected state");
 *   logger.info("session started");
 */

import { reportError } from "@/lib/reporter";

export const logger = {
  info(message: string, ...args: unknown[]): void {
    if (__DEV__) {
      console.info(`[info] ${message}`, ...args);
    }
  },

  warn(message: string, ...args: unknown[]): void {
    if (__DEV__) {
      console.warn(`[warn] ${message}`, ...args);
    }
  },

  error(message: string, error?: unknown): void {
    if (__DEV__) {
      console.error(`[error] ${message}`, error);
    } else {
      reportError(error ?? new Error(message), message);
    }
  },
};
