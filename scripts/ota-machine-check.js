#!/usr/bin/env node
/**
 * OTA machine check — run by `npm run update:preview` / `update:production`
 * before `eas update`.
 *
 * Publishing bundles iOS and Android with Metro, which adds 3–4 GB at its
 * peak (measured 2026-11-23 on the 16 GB laptop, cold exports: 2.8–3.6 GB with
 * 2 workers, 3.6–4.0 GB uncapped; system-wide free memory fell by up to 20
 * points). The owner reports that OTAs crash the laptop when left unattended.
 * The crash logs that week show three watchdog panics and eight
 * memory-pressure reports, each with several multi-gigabyte node processes.
 * They do not tie a panic to an OTA; the likely story is the bundle starting
 * on top of a push gate, a test run or a second session.
 *
 * So this refuses to start when less than MIN_FREE_PERCENT of memory is free.
 * The signal is the system-wide figure from `memory_pressure`, not a sum of
 * process sizes: under pressure macOS compresses memory, and process sizes
 * look smallest exactly when the machine is worst off.
 *
 * It fails closed: a probe that errors or prints nothing readable refuses.
 * The one exception is a machine that has no `memory_pressure` command and
 * is not macOS, where there is nothing to read.
 *
 * Limit: this is one reading taken before the bundle starts. A heavy job that
 * starts a few seconds later is not seen.
 *
 * Override for one run: OTA_ALLOW_BUSY=1 npm run update:preview -- --message "…"
 */
const { execFileSync } = require("child_process");

const MIN_FREE_PERCENT = 40;

/** @returns {{ percent: number | null, missing: boolean }} */
function readFreePercent() {
  let text;
  try {
    text = execFileSync("memory_pressure", [], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (err) {
    return { percent: null, missing: err && err.code === "ENOENT" };
  }
  const match = /free percentage:\s*(\d+)%/.exec(text);
  return { percent: match ? Number(match[1]) : null, missing: false };
}

/** The five largest processes, to show what is using the memory. */
function largestProcesses() {
  try {
    const out = execFileSync("ps", ["-axo", "rss=,comm="], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((line) => /^\s*(\d+)\s+(.+)$/.exec(line))
      .filter(Boolean)
      .map((m) => ({ mb: Math.round(Number(m[1]) / 1024), name: m[2] }))
      .sort((a, b) => b.mb - a.mb)
      .slice(0, 5)
      .map((p) => `  ${String(p.mb).padStart(6)} MB  ${p.name}`);
  } catch {
    return [];
  }
}

function refuse(reason) {
  const lines = [
    `error: not publishing — ${reason}`,
    "The OTA bundle needs 3–4 GB; on a busy machine it has crashed the laptop.",
    ...largestProcesses(),
    "Wait for other jobs (push gate, tests, builds) to finish, or override for one run:",
    '  OTA_ALLOW_BUSY=1 npm run update:<branch> -- --message "…"',
  ];
  process.stderr.write(lines.join("\n") + "\n");
  process.exit(1);
}

function main() {
  if (process.env.OTA_ALLOW_BUSY === "1") {
    process.stderr.write(
      "warning: OTA_ALLOW_BUSY=1 — skipping the free-memory check\n",
    );
    return;
  }
  const { percent, missing } = readFreePercent();
  if (percent === null) {
    if (missing && process.platform !== "darwin") {
      process.stderr.write(
        "note: free-memory check skipped (no memory_pressure command on this system)\n",
      );
      return;
    }
    refuse("could not read free memory from memory_pressure.");
  }
  if (percent < MIN_FREE_PERCENT) {
    refuse(
      `only ${percent}% of memory is free (needs ${MIN_FREE_PERCENT}% or more).`,
    );
  }
}

main();
