import type { Register } from "claude-code";

// Review dispatch helper (harness diagnosis 2026-10-30, N4). Every Agent call to a
// roster reviewer passes through here:
//   - a one-line `REVIEW-DISPATCH worktree=… base=… [pr=N] [mode=uncommitted]` prompt is
//     expanded into the verbatim contract prompt from docs/AI_WORKFLOW.md, so no skill
//     hand-copies 8 KB of text (a miscopied contract writes no review record);
//   - a hand-written prompt must carry every fixed piece of that template, in order;
//   - a domain reviewer is refused until code-reviewer was dispatched for the same HEAD
//     (the #1622 baseline skip);
//   - a prompt starting `NOT-A-REVIEW:` (audit discovery, a question) passes untouched.
// It fails closed: any error refuses the dispatch rather than sending a review that can
// never stamp.

// The reviewer roster. Two other copies change with it: the ROSTER ALLOW-LIST in
// .claude/hooks/review-stamp-writer.sh and the table in docs/AI_WORKFLOW.md → Review Policy.
const DOMAINS: Record<string, string> = {
  "code-reviewer":
    "cross-cutting baseline (strict TypeScript, Zod, tests, code quality, project conventions)",
  "server-reviewer":
    "server (routes, API contracts, services, storage, Drizzle/PostgreSQL)",
  "mobile-reviewer":
    "mobile client (React Native UI, theming, accessibility, camera, performance)",
  "security-auditor":
    "security (IDOR, JWT, SSRF, prompt injection, rate limiting)",
  "ai-reviewer": "AI/LLM integration and nutrition data",
};
const BASELINE = "code-reviewer";
const DIRECTIVE = "REVIEW-DISPATCH";
const OPT_OUT = "NOT-A-REVIEW:";
// The skills add this sentence under the directive so a reviewer that receives the
// unexpanded line stops; the expansion drops it.
const UNLOADED = "If you can read this line";
const HEADING = "#### Dispatch prompt (per selected reviewer)";
// The placeholders this mod fills. Every other <…> in the template stays literal for the
// reviewer to fill (its scratchpad, the sha it observes).
const FILLED = [
  "<WORKTREE>",
  "<expected branch>",
  "<short HEAD>",
  "<domain>",
  "<changed-file list>",
  "<base>",
  "<those files>",
];
const KEYS = new Set(["worktree", "base", "pr", "mode", "files"]);

type Directive = {
  worktree: string;
  base: string;
  pr?: string;
  files?: string[];
  uncommitted: boolean;
  extra: string;
};

class Refusal extends Error {}

export function extractTemplate(doc: string): string {
  const at = doc.indexOf(HEADING);
  const fence = at < 0 ? -1 : doc.indexOf("```\n", at);
  const end = fence < 0 ? -1 : doc.indexOf("\n```", fence + 4);
  const m =
    end < 0
      ? null
      : /\n {2}prompt: (".*")\n\}\)$/s.exec(doc.slice(fence + 4, end));
  if (!m)
    throw new Refusal(
      `docs/AI_WORKFLOW.md has no "${HEADING}" block with a prompt string`,
    );
  return JSON.parse(m[1]) as string;
}

function parseDirective(prompt: string): Directive | null {
  const [first, ...rest] = prompt.trim().split("\n");
  const words = first.trim().split(/\s+/);
  if (words[0] !== DIRECTIVE) return null;
  const kv: Record<string, string> = {};
  for (const w of words.slice(1)) {
    const eq = w.indexOf("=");
    const key = eq < 0 ? w : w.slice(0, eq);
    if (eq < 0 || !KEYS.has(key))
      throw new Refusal(`unknown ${DIRECTIVE} word "${w}"`);
    kv[key] = w.slice(eq + 1);
  }
  if (!kv.worktree?.startsWith("/"))
    throw new Refusal("worktree=<absolute path> is required");
  if (kv.mode !== undefined && kv.mode !== "uncommitted")
    throw new Refusal(`mode=${kv.mode}: the only mode is uncommitted`);
  if (kv.pr !== undefined && !/^\d+$/.test(kv.pr))
    throw new Refusal(`pr=${kv.pr} is not a number`);
  const uncommitted = kv.mode === "uncommitted";
  if (!kv.base && !uncommitted)
    throw new Refusal("base=<ref> is required (e.g. base=origin/main)");
  const extra = rest
    .filter((l) => !l.trim().startsWith(UNLOADED))
    .join("\n")
    .trim();
  return {
    worktree: kv.worktree,
    base: kv.base ?? "origin/main",
    pr: kv.pr,
    files: kv.files?.split(",").filter(Boolean),
    uncommitted,
    extra,
  };
}

function fill(template: string, values: Record<string, string>): string {
  return FILLED.reduce((t, p) => t.split(p).join(values[p]), template);
}

// The template's fixed text, split at the placeholders this mod fills.
function fixedPieces(template: string): string[] {
  const re = new RegExp(
    FILLED.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  );
  return template.split(re).filter((p) => p.length > 0);
}

function firstMissing(template: string, prompt: string): string | null {
  let pos = 0;
  for (const piece of fixedPieces(template)) {
    const at = prompt.indexOf(piece, pos);
    // Name the first line of the piece that is absent, not the whole piece.
    if (at < 0)
      return (
        piece.split("\n").find((l) => l.trim() && !prompt.includes(l, pos)) ??
        piece
      );
    pos = at + piece.length;
  }
  return null;
}

export const register: Register = (on) => {
  // short HEAD → roster agents dispatched for it, this session.
  const dispatched = new Map<string, Set<string>>();
  // worktree → a code-reviewer dispatch still being checked. Calls in one message run
  // these hooks concurrently, so a domain reviewer listed after code-reviewer can reach
  // its baseline check first; it waits for this instead of refusing.
  const pending = new Map<string, Promise<void>>();

  on("tool.call", { tool: "Agent" }, async ($, e, next) => {
    const agent = e.subagent_type ?? "";
    if (!(agent in DOMAINS) || e.prompt.trimStart().startsWith(OPT_OUT))
      return next(e);

    const run = async (argv: string[], cwd: string): Promise<string> => {
      const r = await $.process.run(argv, { cwd });
      if (r.exitCode !== 0)
        throw new Refusal(
          `\`${argv.join(" ")}\` failed (${r.exitCode}): ${r.stderr.trim().slice(0, 300)}`,
        );
      return r.stdout.trim();
    };
    const template = async (wt: string) =>
      extractTemplate(await $.fs.read(`${wt}/docs/AI_WORKFLOW.md`));

    // Read before any await, so the pending entry exists before a sibling call checks.
    const wtEarly =
      /^\s*REVIEW-DISPATCH\b[^\n]*?\bworktree=(\S+)/.exec(e.prompt)?.[1] ??
      /git -C "(\/[^"]+)"/.exec(e.prompt)?.[1];
    let settle = () => {};
    if (agent === BASELINE && wtEarly) {
      const p = new Promise<void>((resolve) => (settle = resolve));
      pending.set(wtEarly, p);
    }

    const decide = async (): Promise<{ deny: string } | { prompt: string }> => {
      let prompt = e.prompt;
      let head: string;
      // Audit reviews of uncommitted fixes (Phase 3 per fix, Phase 6) skip the baseline
      // rule: they share one HEAD, and Phase 6 always carries code-reviewer over the whole diff.
      let exempt = false;
      try {
        const d = parseDirective(e.prompt);
        if (d) {
          const wt = d.worktree;
          const branch = await run(
            ["git", "-C", wt, "rev-parse", "--abbrev-ref", "HEAD"],
            wt,
          );
          head = await run(
            ["git", "-C", wt, "rev-parse", "--short", "HEAD"],
            wt,
          );
          const listing = d.pr
            ? await run(["gh", "pr", "diff", d.pr, "--name-only"], wt)
            : d.uncommitted
              ? await run(["git", "-C", wt, "diff", "--name-only", "HEAD"], wt)
              : await run(
                  ["git", "-C", wt, "diff", "--name-only", `${d.base}...HEAD`],
                  wt,
                );
          const changed = listing.split("\n").filter(Boolean);
          // files= narrows the review to part of the change (audit Phase 3: one fix's files).
          const stray = d.files?.filter((f) => !changed.includes(f)) ?? [];
          if (stray.length > 0)
            throw new Refusal(
              `files= names paths with no change: ${stray.join(", ")}`,
            );
          const files = d.files ?? changed;
          if (files.length === 0)
            throw new Refusal(`no changed files in ${wt} — wrong base or tree`);
          exempt = d.uncommitted;
          prompt = fill(await template(wt), {
            "<WORKTREE>": wt,
            "<expected branch>": branch,
            "<short HEAD>": head,
            "<domain>": DOMAINS[agent],
            "<changed-file list>": files.join("\n"),
            "<base>": d.base,
            "<those files>": files.join(" "),
          });
          if (d.uncommitted)
            prompt +=
              "\n\nThe changes are uncommitted: use the `git diff HEAD` form above.";
          if (d.extra) prompt += `\n\nContext from the dispatcher:\n${d.extra}`;
        } else {
          const wt = /git -C "(\/[^"]+)"/.exec(e.prompt)?.[1];
          const tree = /must be (\S+)\/([0-9a-f]{7,40}) —/.exec(e.prompt);
          if (!wt || !tree)
            throw new Refusal(
              `a ${agent} prompt must be a ${DIRECTIVE} line, or the full docs/AI_WORKFLOW.md contract`,
            );
          const missing = firstMissing(await template(wt), e.prompt);
          if (missing !== null)
            throw new Refusal(
              `the prompt is missing this contract text: "${missing.slice(0, 160)}…" — send a ${DIRECTIVE} line instead`,
            );
          head = tree[2];
        }
      } catch (err) {
        if (!(err instanceof Refusal)) throw err;
        return {
          deny: `${$.plugin.name}: ${err.message}. See docs/AI_WORKFLOW.md → Dispatch prompt.`,
        };
      }

      const key = head.slice(0, 7);
      const hasBaseline = () => dispatched.get(key)?.has(BASELINE) === true;
      if (!exempt && agent !== BASELINE && !hasBaseline()) {
        if (wtEarly) await pending.get(wtEarly);
        if (!hasBaseline())
          return {
            deny: `${$.plugin.name}: ${BASELINE} is the baseline for every review — dispatch it for ${key} first (or list it first in the same message), then ${agent}.`,
          };
      }
      dispatched.set(key, (dispatched.get(key) ?? new Set()).add(agent));
      return { prompt };
    };

    let decision: { deny: string } | { prompt: string };
    try {
      decision = await decide();
    } finally {
      // Released before next(): a waiting sibling must not wait for the whole review.
      settle();
    }
    if ("deny" in decision) return decision;
    return next(
      decision.prompt === e.prompt ? e : { ...e, prompt: decision.prompt },
    );
  }).catch(($, e, next) =>
    next.called
      ? next(e)
      : {
          deny: `${$.plugin.name}: its check failed, so this review dispatch is refused.`,
        },
  );
};
