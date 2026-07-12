/**
 * Side-effect initialization for the server error reporter (Sentry).
 *
 * MUST be the second import in server/index.ts — after ./lib/env-boot
 * (which loads dotenv, so SENTRY_DSN is readable) and before express /
 * ./db / ./routes, so Sentry initializes before the modules it instruments
 * are imported (its http instrumentation can then attach outbound-request
 * breadcrumbs to events). Import declarations evaluate in order, so a
 * module-body init call in index.ts would only run after ALL imports
 * (express, ./db, ./routes) had already evaluated — too late.
 *
 * No-op without SENTRY_DSN / outside production — see ./error-reporter.
 */
import { initErrorReporter } from "./error-reporter";

initErrorReporter();
