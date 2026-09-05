#!/usr/bin/env tsx
/**
 * Fail-fast guard that runs before the client dev-loop entry points
 * (wired as the `preios` / `preandroid` / `preexpo:dev` npm hooks).
 *
 * `EXPO_PUBLIC_*` is inlined into the JS bundle at build time, so a `.env`
 * pinned to a LAN IP the machine no longer holds produces an app that cannot
 * reach the API at all — and it fails in ways that never look like networking.
 * Observed disguises: the splash screen staying up forever (it waits on the
 * session check), Profile hanging on skeletons while Home renders fine from
 * the TanStack offline cache, and taps appearing to be "swallowed".
 *
 * This has cost real debugging time SIX separate times, most recently
 * 2026-09-04, when it was misread as a clue about an unrelated CI failure. A
 * memory note describing the symptom did not prevent recurrences 2 through 6,
 * which is why the check now lives in the dev loop instead of in prose.
 *
 * Deliberately NOT a reachability probe. Whether the API answers depends on
 * whether the server happens to be running, and `npm run ios` before
 * `npm run server:dev` is a normal order to work in — gating on that would
 * cry wolf, and a guard people learn to ignore is worse than no guard. The
 * staleness comparison below needs no server and has no false positives.
 *
 * Bypass: SKIP_API_DOMAIN_CHECK=1
 */
import fs from "fs";
import os from "os";
import path from "path";

export type DomainVerdict =
  | { status: "ok"; host: string }
  | { status: "skip"; reason: string }
  | { status: "stale"; host: string; localIps: string[] };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/** Strip scheme, path, port and quoting to leave a bare host. */
function extractHost(raw: string): string {
  let s = raw.trim().replace(/^['"]|['"]$/g, "");
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
  s = s.split("/")[0];
  // Bracketed IPv6 literal, e.g. [::1]:3000
  const bracketed = s.match(/^\[([^\]]+)\]/);
  if (bracketed) return bracketed[1];
  return s.replace(/:\d+$/, "");
}

/**
 * Pure decision. Callers pass the machine's addresses so this never consults
 * ambient state — a check that reads the same network it is checking can only
 * ever agree with itself.
 */
export function evaluateApiDomain(
  domain: string | undefined,
  localIps: string[],
): DomainVerdict {
  if (!domain || !domain.trim()) {
    return { status: "skip", reason: "EXPO_PUBLIC_DOMAIN is not set" };
  }
  const host = extractHost(domain);
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host === "0.0.0.0"
  ) {
    return { status: "ok", host };
  }
  // A DNS name (api.ocrecipes.com) cannot be a stale LAN address.
  if (!IPV4.test(host)) return { status: "ok", host };
  // No IPv4 anywhere means we could not read the interfaces (en0 down and on
  // a tethered link, for one). Absence of evidence is not staleness — say so
  // rather than failing the dev loop for a reason we did not actually observe.
  if (localIps.length === 0) {
    return { status: "skip", reason: "no local IPv4 address could be read" };
  }
  if (localIps.includes(host)) return { status: "ok", host };
  return { status: "stale", host, localIps };
}

export function localIpv4s(): string[] {
  return Object.values(os.networkInterfaces())
    .flatMap((addrs) => addrs ?? [])
    .filter((a) => a.family === "IPv4" && !a.internal)
    .map((a) => a.address);
}

/** Shell export wins over .env, matching how Expo resolves EXPO_PUBLIC_*. */
export function readDomain(envPath: string): string | undefined {
  if (process.env.EXPO_PUBLIC_DOMAIN) return process.env.EXPO_PUBLIC_DOMAIN;
  if (!fs.existsSync(envPath)) return undefined;
  const line = fs
    .readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith("EXPO_PUBLIC_DOMAIN="));
  return line?.slice("EXPO_PUBLIC_DOMAIN=".length);
}

function main(): void {
  if (process.env.SKIP_API_DOMAIN_CHECK) return;
  const envPath = path.resolve(process.cwd(), ".env");
  const verdict = evaluateApiDomain(readDomain(envPath), localIpv4s());
  if (verdict.status !== "stale") return;

  const suggestion = verdict.localIps[0];
  console.error(
    `\n[api-domain guard] ABORTED — EXPO_PUBLIC_DOMAIN points at a LAN IP this machine does not have.\n\n` +
      `  .env says:      ${verdict.host}\n` +
      `  this machine:   ${verdict.localIps.join(", ")}\n\n` +
      `The bundle inlines this value, so the app would launch and then fail to reach the API —\n` +
      `typically as a splash screen that never clears, or screens stuck on loading skeletons.\n` +
      `It does not look like a network fault, which is why it keeps costing hours.\n\n` +
      `Fix, for simulator work (loopback is shared with the host and never goes stale — CI uses it):\n\n` +
      `  EXPO_PUBLIC_DOMAIN=http://localhost:3000\n\n` +
      `Fix, for a physical device (needs the LAN IP):\n\n` +
      `  EXPO_PUBLIC_DOMAIN=http://${suggestion}:3000\n\n` +
      `Then restart Metro with --clear; EXPO_PUBLIC_* is inlined at bundle time, so editing\n` +
      `.env without a restart changes nothing.\n` +
      `(Intentional bypass — e.g. deliberately targeting another host: SKIP_API_DOMAIN_CHECK=1)\n`,
  );
  process.exit(1);
}

// Only run when invoked as a script, so the test can import the pure helpers.
if (
  process.argv[1] &&
  import.meta.url.endsWith(path.basename(process.argv[1]))
) {
  main();
}
