/**
 * Off-device error reporter.
 *
 * This is the single point of contact with @sentry/react-native.
 * In development / test: no-op (no Sentry init, no network calls).
 * In production: forwards to Sentry when EXPO_PUBLIC_SENTRY_DSN is set.
 *
 * Call `initReporter()` once at app startup (App.tsx) before rendering.
 * Use `reportError(err)` everywhere else — never import Sentry directly.
 */

import * as Sentry from "@sentry/react-native";

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Initialize Sentry. Safe to call unconditionally — no-op when the DSN is
 * absent (dev / pre-deploy) so no traffic is sent before a DSN is configured.
 */
export function initReporter(): void {
  if (!dsn) return;
  Sentry.init({ dsn });
}

/**
 * Report an error to the off-device reporter. No-op when the DSN is absent.
 *
 * @param error  The caught error value (any type — Sentry handles non-Error).
 * @param context  Optional string label for breadcrumb context.
 */
export function reportError(error: unknown, context?: string): void {
  if (!dsn) return;
  if (context) {
    Sentry.addBreadcrumb({ message: context, level: "error" });
  }
  Sentry.captureException(error);
}
