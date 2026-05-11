/**
 * Legal document URLs surfaced from in-app Settings.
 *
 * Required by CCPA, PIPEDA, Apple App Store (5.1.1), and Google Play data-safety
 * policies. Keep all legal URLs in this single file so they can be rotated
 * without touching screen code.
 *
 * Each URL falls back to the canonical hosted page on ocrecipes.app when the
 * corresponding `EXPO_PUBLIC_*` env var is not set.
 */

export const PRIVACY_POLICY_URL: string =
  process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL ?? "https://ocrecipes.app/privacy";

export const TERMS_URL: string =
  process.env.EXPO_PUBLIC_TERMS_URL ?? "https://ocrecipes.app/terms";
