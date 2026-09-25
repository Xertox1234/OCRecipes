/**
 * RFC 4122 version 4 UUID that works on Hermes.
 *
 * Hermes (the app's JS engine) has no global `crypto`, so a bare
 * `crypto.randomUUID()` throws `ReferenceError: Property 'crypto' doesn't exist`
 * on device. Vitest runs in Node, where it exists, so such a call passes every
 * test and fails only in the app. That broke every coach stream and every
 * offline-queue enqueue from 2026-05-04 until this helper replaced both calls.
 *
 * Uses `crypto.getRandomValues` when a runtime provides it, otherwise
 * `Math.random`. That is fine for what the app needs: idempotency and dedupe
 * keys (coach `turnKey`, offline-queue ids). Never use it for secrets or tokens.
 */
export function randomUuidV4(): string {
  const bytes = new Uint8Array(16);
  const cryptoApi = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof cryptoApi?.getRandomValues === "function") {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
