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

module.exports = config;
