// Metro config wrapped with Sentry's Expo integration.
//
// getSentryExpoConfig is a drop-in replacement for expo/metro-config's
// getDefaultConfig: it returns the same default config PLUS a serializer that
// stamps a stable "debug ID" into the JS bundle and its source map. That debug
// ID is what lets Sentry match an uploaded source map back to a runtime stack
// frame — turning minified bytecode positions into real file:line frames
// (symbolication). Without it, uploaded maps can't be tied to captured events.
//
// There was no metro.config.js before this — Expo used its built-in default —
// so there is no prior custom config to preserve here.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

const config = getSentryExpoConfig(__dirname);

// Worker cap for the OTA publish. `npm run update:*` sets METRO_MAX_WORKERS=2
// and `eas update` passes its environment to `expo export`, which has no
// worker flag of its own there. Measured 2026-11-23 on cold exports of both
// platforms (peak memory of the process tree): 3.2 GB on average with 2
// workers (4 runs, 2.8–3.6) against 3.75 GB uncapped (3 runs, 3.6–4.0), and
// about 12 s slower (61 s against 49 s). A modest saving, and a noisy one.
// Unset (dev server, E2E, native builds) or not a whole number above zero:
// Metro keeps its default.
const maxWorkers = process.env.METRO_MAX_WORKERS ?? "";
if (/^[1-9]\d*$/.test(maxWorkers)) {
  config.maxWorkers = Number(maxWorkers);
}

module.exports = config;
