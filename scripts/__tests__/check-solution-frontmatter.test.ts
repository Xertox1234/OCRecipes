import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import { RULES_DOMAINS } from "../lib/path-domains";

const realScript = path.resolve(
  __dirname,
  "..",
  "check-solution-frontmatter.js",
);

/**
 * The script derives its repo root from `__dirname/..` and only accepts paths
 * under `docs/solutions/`. So we copy it into `<tmp>/scripts/` and write
 * fixtures to `<tmp>/docs/solutions/<category>/` — the copy's own location makes
 * the temp tree the repo root, and the fixtures land in scope. Writing fixtures
 * into the REAL docs/solutions/ would pollute the corpus the inject hook greps.
 */
const tmpDirs: string[] = [];

/** A frontmatter block that satisfies every OTHER rule the checker enforces, so
 *  a failure can only come from the routing check under test. */
function doc(tags: string): string {
  return [
    "---",
    "title: Example solution",
    "track: knowledge",
    "category: conventions",
    `tags: ${tags}`,
    "module: server",
    "created: '2026-08-11'",
    "---",
    "",
    "# Example solution",
    "",
    "## Rule",
    "",
    "Body.",
    "",
  ].join("\n");
}

function makeRepo(files: Record<string, string>): string {
  // realpath: on macOS os.tmpdir() is /var/... but the script resolves its own
  // location to /private/var/..., so an unresolved path fails the
  // docs/solutions/ scope check and the file is silently skipped — a green run
  // over 0 files.
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "solution-fm-")),
  );
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, "docs", "solutions", "conventions"), {
    recursive: true,
  });
  fs.copyFileSync(
    realScript,
    path.join(root, "scripts", "check-solution-frontmatter.js"),
  );
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(
      path.join(root, "docs", "solutions", "conventions", name),
      content,
    );
  }
  return root;
}

function run(root: string, files: string[]) {
  const result = spawnSync(
    "node",
    [
      path.join(root, "scripts", "check-solution-frontmatter.js"),
      ...files.map((f) =>
        path.join(root, "docs", "solutions", "conventions", f),
      ),
    ],
    { encoding: "utf8" },
  );
  return {
    status: result.status ?? -1,
    out: (result.stdout ?? "") + (result.stderr ?? ""),
  };
}

describe("check-solution-frontmatter.js — routing reachability", () => {
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a doc whose tags match no routed domain", () => {
    // `solutions_from_markdown()` builds its candidate pool with
    // `grep -rlE "^tags:.*<domain-pattern>"` BEFORE partitioning by applies_to,
    // so a doc with no domain tag is excluded from every pool — it can never be
    // injected for any file. This is the exact shape that shipped twice on
    // 2026-08-10.
    const root = makeRepo({
      "inert-2026-08-11.md": doc("[parsing, validation, units, fallback]"),
    });
    const { status, out } = run(root, ["inert-2026-08-11.md"]);
    expect(status).toBe(1);
    expect(out).toMatch(/never injects|no routed domain|unreachable/i);
  });

  it("accepts a doc carrying a literal domain tag", () => {
    const root = makeRepo({
      "routed-2026-08-11.md": doc("[architecture, parsing, validation]"),
    });
    const { status } = run(root, ["routed-2026-08-11.md"]);
    expect(status).toBe(0);
  });

  it("accepts the `harness` alternation tags the inject hook honours", () => {
    // domain_tag_pattern() maps harness -> \b(harness|tooling|pg-lab|worktree|agents)\b,
    // so a doc tagged only `tooling` IS reachable and must not be flagged.
    const root = makeRepo({
      "tooling-2026-08-11.md": doc("[tooling, frontmatter]"),
    });
    const { status, out } = run(root, ["tooling-2026-08-11.md"]);
    expect(status, out).toBe(0);
  });

  it("accepts the `ai-prompting` alternation (any ai-* tag)", () => {
    // domain_tag_pattern() maps ai-prompting -> \bai(-[a-z]+)?\b.
    const root = makeRepo({
      "ai-2026-08-11.md": doc("[ai-safety, prompts]"),
    });
    const { status, out } = run(root, ["ai-2026-08-11.md"]);
    expect(status, out).toBe(0);
  });

  // Behavioural drift guard: if a domain is added to RULES_DOMAINS but not to
  // the checker's table, a doc legitimately tagged with it would be rejected.
  // Asserting acceptance per-domain catches that without the script needing to
  // export its internals.
  it.each([...RULES_DOMAINS])(
    "accepts a doc tagged with the '%s' domain",
    (domain) => {
      const root = makeRepo({
        "domain-2026-08-11.md": doc(`[${domain}]`),
      });
      const { status, out } = run(root, ["domain-2026-08-11.md"]);
      expect(status, `domain '${domain}' was rejected:\n${out}`).toBe(0);
    },
  );

  it("flags a WRAPPED (multi-line) applies_to array", () => {
    // The inline-flow rule exists because `^applies_to:.*` grep cannot see a
    // wrapped array — but the parser stores the key with an EMPTY value and the
    // inline-flow check skips empties, so the wrapped form slipped through the
    // very guard written to catch it.
    const root = makeRepo({
      "wrapped-2026-08-11.md": doc("[architecture]").replace(
        "module: server",
        "module: server\napplies_to:\n  - server/**/*.ts",
      ),
    });
    const { status, out } = run(root, ["wrapped-2026-08-11.md"]);
    expect(status).toBe(1);
    expect(out).toMatch(/SINGLE-LINE inline-flow/);
  });

  it("still reports the pre-existing frontmatter violations", () => {
    // Two-sided control: the new checks must not mask the old ones.
    const root = makeRepo({
      "baddate-2026-08-11.md": doc("[architecture]").replace(
        "created: '2026-08-11'",
        "created: Aug 11 2026",
      ),
    });
    const { status, out } = run(root, ["baddate-2026-08-11.md"]);
    expect(status).toBe(1);
    expect(out).toMatch(/created must be an ISO date/);
  });
});
