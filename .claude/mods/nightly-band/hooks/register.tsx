import { atom, read, update } from "claude-code";
import type { EngineInterface, Register } from "claude-code";

import type { Nightly } from "../types";

// Nightly E2E visibility (harness diagnosis 2026-10-30, N5). The workflow already posts
// each failure to one GitHub issue (#1041: open since 09-24, 36 automatic comments), and
// 9 red nights in a row (10-19 → 10-27) still went unseen: the signal landed where nobody
// looks. This puts it in the session instead:
//   - a band above the prompt while the newest scheduled run on main is red, saying for
//     how many nights and which job failed; a dim line when the check itself failed, so a
//     failed check never reads as green; nothing while green;
//   - the agent is told once per conversation (first request, again after a compaction)
//     while red, so it can raise it with the owner.
// Visibility only: it refuses nothing, and a failure here costs the band, not the session.
// Loaded for every project through CLAUDE_CODE_PLUGIN_DIRS, so it acts only in OCRecipes.

const REPO = "Xertox1234/OCRecipes";
const OURS = /[:/]xertox1234\/ocrecipes(\.git)?$/i;
const WORKFLOW = "e2e-regression.yml";
// Enough history to say "N+ nights" without paging.
const LIMIT = 14;
const EVERY_MS = 30 * 60 * 1000;
// Awaited before the first prompt (session.start), so it is kept short.
const TIMEOUT_MS = 10_000;
// A run that ended this way is a red night; success ends the streak; anything else
// (cancelled, skipped) says nothing about main and is stepped over.
const RED = new Set(["failure", "timed_out", "startup_failure"]);
// The job that files the issue is not a failure of the suite.
const NOT_A_SUITE_JOB = /^Notify/;

const nightly = atom({ plugin: "nightly-band", key: "nightly" } as const, null);

type Run = { databaseId: number; conclusion: string };
type Job = { name: string; conclusion: string };
type Dollar = EngineInterface;

const firstLine = (s: string) => s.trim().split("\n")[0] ?? "";

async function check($: Dollar): Promise<Nightly> {
  try {
    const list = await $.process.run(
      [
        "gh",
        "run",
        "list",
        "-R",
        REPO,
        "--workflow",
        WORKFLOW,
        "--branch",
        "main",
        "--event",
        "schedule",
        "--status",
        "completed",
        "--limit",
        String(LIMIT),
        "--json",
        "databaseId,conclusion",
      ],
      { timeoutMs: TIMEOUT_MS },
    );
    if (list.exitCode !== 0)
      return {
        kind: "unknown",
        why: firstLine(list.stderr) || `gh exited ${list.exitCode}`,
      };
    const runs = JSON.parse(list.stdout) as Run[];
    if (runs.length === 0)
      return { kind: "unknown", why: "no completed scheduled run on main" };
    let nights = 0;
    let newestRed: number | null = null;
    let ended = false;
    for (const run of runs) {
      if (run.conclusion === "success") {
        ended = true;
        break;
      }
      if (RED.has(run.conclusion)) {
        nights += 1;
        newestRed ??= run.databaseId;
      }
    }
    if (newestRed === null) return { kind: "green" };
    let failedJobs: string[] = [];
    try {
      const view = await $.process.run(
        ["gh", "run", "view", String(newestRed), "-R", REPO, "--json", "jobs"],
        { timeoutMs: TIMEOUT_MS },
      );
      if (view.exitCode === 0)
        failedJobs = ((JSON.parse(view.stdout) as { jobs: Job[] }).jobs ?? [])
          .filter((j) => RED.has(j.conclusion) && !NOT_A_SUITE_JOB.test(j.name))
          .map((j) => j.name);
    } catch {
      // the band still says red; it just cannot name the job
    }
    // "+" only when the list was cut at LIMIT before a green night could end the streak
    const capped = !ended && runs.length >= LIMIT;
    return { kind: "red", nights, capped, runId: newestRed, failedJobs };
  } catch (err) {
    return {
      kind: "unknown",
      why: firstLine(String((err as Error)?.message ?? err)),
    };
  }
}

function describe(n: Nightly & { kind: "red" }): string {
  const nights = `${n.nights}${n.capped ? "+" : ""} night${n.nights === 1 && !n.capped ? "" : "s"}`;
  const jobs = n.failedJobs.length ? `: ${n.failedJobs.join(", ")} failed` : "";
  return `Nightly E2E red for ${nights}${jobs} · gh run view ${n.runId}`;
}

async function refresh($: Dollar): Promise<void> {
  const result = await check($);
  await update($, nightly, () => result);
}

// Whether this session is in OCRecipes. A reload runs session.start again, which resets it.
let active = false;

export const register: Register = (on) => {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    try {
      const repo = await $.session.repo();
      active = !!repo?.remote && OURS.test(repo.remote);
      if (active) {
        await refresh($);
        $.clock.every(EVERY_MS, () => refresh($));
      }
    } catch {
      active = false;
    }
    return r;
  });

  on("prompt.context", async ($, e, next) => {
    const r = await next(e);
    if (!active) return r;
    const n = await read($, nightly);
    if (n?.kind !== "red") return r;
    return {
      ...r,
      blocks: [
        ...r.blocks,
        {
          name: "nightlyE2E",
          text:
            `${describe(n)}. The nightly E2E suite on main is failing. ` +
            "At a natural point early in this session, tell the owner and offer to look into it " +
            "(diagnose from the run's debug-output artifacts first); don't start on it unasked.",
        },
      ],
    };
  });

  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    if (!active || e.props.hasSurvey) return next(e);
    const n = await read($, nightly);
    if (n === null || n.kind === "green") return next(e);
    const { Text } = $.ui.resolve(e);
    return n.kind === "red" ? (
      <Text color="red">{describe(n)}</Text>
    ) : (
      <Text dimColor>Nightly E2E status unknown: {n.why}</Text>
    );
  });
};
