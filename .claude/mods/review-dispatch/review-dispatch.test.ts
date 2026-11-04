import { expect, test, type TestBody } from "claude-code/testing";

// A small stand-in for docs/AI_WORKFLOW.md's dispatch block, in the same shape: the
// heading, a fence, and an Agent({...}) whose prompt is a JSON string.
const TEMPLATE =
  'Use `git -C "<WORKTREE>"`; read <WORKTREE>/<path>.\n' +
  "The tree must be <expected branch>/<short HEAD> — if not, STOP.\n" +
  "Review through your <domain> lens:\n<changed-file list>\n\n" +
  'Run `git -C "<WORKTREE>" diff <base>...HEAD -- <those files>`.\n' +
  'Probe in `mktemp -d "<your scratchpad directory>/probe-XXXXXX"`.\n' +
  "REVIEWED-SHA: <the full sha>\nNo findings.";
const DOC =
  "# AI workflow\n\n#### Dispatch prompt (per selected reviewer)\n\n```\nAgent({\n" +
  '  description: "Review (<domain>): <context label>",\n' +
  '  subagent_type: "<selected agent>",\n' +
  `  prompt: ${JSON.stringify(TEMPLATE)}\n})\n\`\`\`\n\nMore text.\n`;

const WT = "/w/tree";
const GIT: Record<string, string> = {
  "rev-parse --abbrev-ref HEAD": "chore/x",
  "rev-parse --short HEAD": "abc1234",
  "diff --name-only origin/main...HEAD": "a.ts\nb.ts\n",
  "diff --name-only HEAD": "u.ts\n",
  "diff --name-only HEAD^...HEAD": "a.ts\n",
  "fetch -q origin refs/heads/main:refs/remotes/origin/main": "",
  // what origin/main changed since the branch forked: nothing, unless a test says so
  "diff --name-only HEAD...origin/main": "",
};

type On = Parameters<TestBody>[1];

// Stands in for the engine: git/gh answers, the doc, and the Agent tool itself, which
// records the prompt it was finally given.
function world(
  on: On,
  opts: {
    files?: string;
    gitThrows?: boolean;
    missed?: string;
    fetchFails?: boolean;
    log?: string[];
  } = {},
) {
  const seen: string[] = [];
  on("process.run", (_, e) => {
    if (opts.gitThrows) throw new Error("spawn failed");
    const argv = e.argv.join(" ");
    opts.log?.push(argv);
    if (argv === "gh pr diff 42 --name-only")
      return {
        value: {
          exitCode: 0,
          stdout: "p.ts\n",
          stderr: "",
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      };
    const key = e.argv.slice(3).join(" ");
    const out =
      key === "diff --name-only HEAD...origin/main" && opts.missed !== undefined
        ? opts.missed
        : key.startsWith("fetch") && opts.fetchFails
          ? undefined
          : key.startsWith("diff") &&
              !key.includes("HEAD...") &&
              opts.files !== undefined
            ? opts.files
            : GIT[key];
    return out === undefined
      ? {
          value: {
            exitCode: 128,
            stdout: "",
            stderr: `unknown: ${argv}`,
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        }
      : {
          value: {
            exitCode: 0,
            stdout: out,
            stderr: "",
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        };
  });
  on("fs.read", (_, e) =>
    e.path === `${WT}/docs/AI_WORKFLOW.md` ? { value: DOC } : { value: "" },
  );
  on("tool.call", (_, e) => {
    seen.push((e as { prompt: string }).prompt);
    return { result: {} };
  });
  return seen;
}

const agent = (subagent_type: string, prompt: string) =>
  ({ tool: "Agent", description: "Review", subagent_type, prompt }) as const;

const DIRECTIVE =
  `REVIEW-DISPATCH worktree=${WT} base=origin/main\n` +
  'If you can read this line, the review-dispatch mod is not loaded: reply only "review-dispatch mod not loaded".';

const FULL = TEMPLATE.split("<WORKTREE>")
  .join(WT)
  .split("<expected branch>")
  .join("chore/x")
  .split("<short HEAD>")
  .join("abc1234")
  .split("<domain>")
  .join("baseline")
  .split("<changed-file list>")
  .join("a.ts\nb.ts")
  .split("<base>")
  .join("origin/main")
  .split("<those files>")
  .join("a.ts b.ts");

// A plugin's refusal reaches the caller as `{ deny: text }`.
const refused = (r: unknown) =>
  typeof (r as { deny?: unknown }).deny === "string";
const text = (r: unknown) => String((r as { deny?: unknown }).deny ?? "");

test("a REVIEW-DISPATCH line becomes the filled contract", async ($, on) => {
  const seen = world(on);
  const r = await $.tool.call(
    agent("code-reviewer", `${DIRECTIVE}\nFix: tighten the parser.`),
  );
  expect(refused(r)).toBe(false);
  const p = seen[0];
  expect(p).toContain(`git -C "${WT}"`);
  expect(p).toContain("must be chore/x/abc1234 —");
  expect(p).toContain("lens:\na.ts\nb.ts\n");
  expect(p).toContain("diff origin/main...HEAD -- a.ts b.ts");
  expect(p).toContain("cross-cutting baseline");
  // left for the reviewer to fill
  expect(p).toContain("<your scratchpad directory>");
  expect(p).toContain("REVIEWED-SHA: <the full sha>");
  expect(p).toContain(`${WT}/<path>`);
  expect(p).not.toContain("If you can read this line");
  expect(
    p.endsWith("Context from the dispatcher:\nFix: tighten the parser."),
  ).toBe(true);
});

test("pr= takes the file list from gh pr diff; mode=uncommitted from git diff HEAD", async ($, on) => {
  const seen = world(on);
  await $.tool.call(
    agent(
      "code-reviewer",
      `REVIEW-DISPATCH worktree=${WT} base=origin/main pr=42`,
    ),
  );
  expect(seen[0]).toContain("lens:\np.ts\n");
  await $.tool.call(
    agent("code-reviewer", `REVIEW-DISPATCH worktree=${WT} mode=uncommitted`),
  );
  expect(seen[1]).toContain("lens:\nu.ts\n");
  expect(seen[1]).toContain("The changes are uncommitted");
});

test("a domain reviewer waits for code-reviewer on the same HEAD", async ($, on) => {
  const seen = world(on);
  const early = await $.tool.call(agent("server-reviewer", DIRECTIVE));
  expect(refused(early)).toBe(true);
  expect(text(early)).toMatch(/code-reviewer is the baseline/);
  expect(seen).toHaveLength(0);

  await $.tool.call(agent("code-reviewer", DIRECTIVE));
  const later = await $.tool.call(agent("server-reviewer", DIRECTIVE));
  expect(refused(later)).toBe(false);
  expect(seen).toHaveLength(2);
  expect(seen[1]).toContain("server (routes");
});

test("a full hand-written contract passes unchanged; a cut one is refused", async ($, on) => {
  const seen = world(on);
  const ok = await $.tool.call(agent("code-reviewer", FULL));
  expect(refused(ok)).toBe(false);
  expect(seen[0]).toBe(FULL);

  const cut = await $.tool.call(
    agent("code-reviewer", FULL.replace("REVIEWED-SHA: <the full sha>\n", "")),
  );
  expect(refused(cut)).toBe(true);
  expect(text(cut)).toMatch(
    /missing this contract text: "REVIEWED-SHA: <the full sha>…"/,
  );
  expect(seen).toHaveLength(1);
});

test("only roster review prompts are checked", async ($, on) => {
  const seen = world(on);
  const bare = await $.tool.call(
    agent("security-auditor", "Look at server/auth.ts"),
  );
  expect(refused(bare)).toBe(true);
  expect(text(bare)).toMatch(/REVIEW-DISPATCH line, or the full/);

  const optOut = "NOT-A-REVIEW: list IDOR risks in server/storage";
  expect(refused(await $.tool.call(agent("security-auditor", optOut)))).toBe(
    false,
  );
  expect(
    refused(await $.tool.call(agent("Explore", "find the auth routes"))),
  ).toBe(false);
  expect(seen).toEqual([optOut, "find the auth routes"]);
});

test("bad directives and empty diffs are refused", async ($, on) => {
  world(on, { files: "" });
  const empty = await $.tool.call(agent("code-reviewer", DIRECTIVE));
  expect(text(empty)).toMatch(/no changed files/);
  expect(
    text(
      await $.tool.call(
        agent("code-reviewer", "REVIEW-DISPATCH worktree=rel base=x"),
      ),
    ),
  ).toMatch(/absolute path/);
  expect(
    text(
      await $.tool.call(
        agent("code-reviewer", `REVIEW-DISPATCH worktree=${WT}`),
      ),
    ),
  ).toMatch(/base=<ref> is required/);
  expect(
    text(
      await $.tool.call(
        agent("code-reviewer", `REVIEW-DISPATCH worktree=${WT} base=x lens=y`),
      ),
    ),
  ).toMatch(/unknown REVIEW-DISPATCH word/);
});

test("an unexpected error refuses the dispatch (fails closed)", async ($, on) => {
  const seen = world(on, { gitThrows: true });
  const r = await $.tool.call(agent("code-reviewer", DIRECTIVE));
  expect(refused(r)).toBe(true);
  expect(text(r)).toMatch(/its check failed/);
  expect(seen).toHaveLength(0);
});

test("files= narrows an audit fix review; uncommitted reviews skip the baseline", async ($, on) => {
  const seen = world(on, { files: "a.ts\nb.ts\n" });
  const r = await $.tool.call(
    agent(
      "security-auditor",
      `REVIEW-DISPATCH worktree=${WT} mode=uncommitted files=b.ts`,
    ),
  );
  expect(refused(r)).toBe(false);
  expect(seen[0]).toContain("lens:\nb.ts\n");
  expect(seen[0]).toContain("-- b.ts`");

  const stray = await $.tool.call(
    agent(
      "security-auditor",
      `REVIEW-DISPATCH worktree=${WT} mode=uncommitted files=c.ts`,
    ),
  );
  expect(text(stray)).toMatch(/files= names paths with no change: c\.ts/);
});

test("code-reviewer in the same message counts, whichever call is checked first", async ($, on) => {
  const seen = world(on);
  // Fired together, as a session runs one message's calls; the domain reviewer is listed first.
  const [domain, base] = await Promise.all([
    $.tool.call(agent("mobile-reviewer", DIRECTIVE)),
    $.tool.call(agent("code-reviewer", DIRECTIVE)),
  ]);
  expect(refused(base)).toBe(false);
  expect(refused(domain)).toBe(false);
  expect(seen).toHaveLength(2);
});

test("code-reviewer is refused while origin/main changed a file the branch also changes", async ($, on) => {
  const log: string[] = [];
  const seen = world(on, { missed: "z.ts\nb.ts\n", log });
  const r = await $.tool.call(agent("code-reviewer", DIRECTIVE));
  expect(refused(r)).toBe(true);
  expect(text(r)).toMatch(
    /b\.ts changed on origin\/main since this branch forked/,
  );
  expect(text(r)).toContain(`git -C ${WT} merge origin/main`);
  expect(seen).toHaveLength(0);
  // it compared against a freshly fetched main
  expect(log).toContain(
    `git -C ${WT} fetch -q origin refs/heads/main:refs/remotes/origin/main`,
  );
});

test("no overlap, or no fresh main, lets the review through", async ($, on) => {
  const seen = world(on, { missed: "z.ts\n" });
  expect(refused(await $.tool.call(agent("code-reviewer", DIRECTIVE)))).toBe(
    false,
  );
  expect(seen).toHaveLength(1);
});

test("a failed fetch skips the overlap check (hygiene, not safety)", async ($, on) => {
  const seen = world(on, { missed: "b.ts\n", fetchFails: true });
  expect(refused(await $.tool.call(agent("code-reviewer", DIRECTIVE)))).toBe(
    false,
  );
  expect(seen).toHaveLength(1);
});

test("pr=, uncommitted and non-origin bases skip the overlap check", async ($, on) => {
  const log: string[] = [];
  const seen = world(on, { missed: "a.ts\np.ts\nu.ts\n", log });
  for (const d of [
    `REVIEW-DISPATCH worktree=${WT} base=origin/main pr=42`,
    `REVIEW-DISPATCH worktree=${WT} mode=uncommitted`,
    `REVIEW-DISPATCH worktree=${WT} base=HEAD^`,
  ])
    expect(refused(await $.tool.call(agent("code-reviewer", d)))).toBe(false);
  expect(seen).toHaveLength(3);
  expect(log.some((a) => a.includes(" fetch "))).toBe(false);
});
