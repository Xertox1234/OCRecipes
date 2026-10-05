// scripts/__tests__/mutation-on-diff-select-only.test.ts
/**
 * `--select-only` is the workflow's first look at a PR: it decides whether the
 * job installs dependencies and runs mutation at all. Wrongly saying "skip"
 * silently drops the advisory signal, so every "skip" case below has an
 * "eligible" counterpart that must say "run".
 *
 * The workflow runs it BEFORE `npm ci`, so the CLI cases run the real script in
 * a tree that holds only a copy of the script, the registry and fixtures, with
 * no node_modules above it. An import of an installed package, in the script or
 * in stryker.targets.mjs, fails here first.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isApprovedExclusion,
  isHardExclusion,
  MUTATION_TARGETS,
} from "../../stryker.targets.mjs";
import {
  parseArgs,
  renderSummary,
  selectEligible,
  selectOnlyOutcome,
} from "../ci/mutation-on-diff.mjs";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT = path.join(REPO_ROOT, "scripts", "ci", "mutation-on-diff.mjs");
const REGISTRY = path.join(REPO_ROOT, "stryker.targets.mjs");
const WORKFLOW = path.join(
  REPO_ROOT,
  ".github",
  "workflows",
  "mutation-on-diff.yml",
);

const NO_ELIGIBLE = "_No eligible changed modules in this PR._";

describe("parseArgs", () => {
  it("takes the list file, with or without --select-only, in either order", () => {
    expect(parseArgs(["list.txt"])).toEqual({
      selectOnly: false,
      listFile: "list.txt",
    });
    expect(parseArgs(["--select-only", "list.txt"])).toEqual({
      selectOnly: true,
      listFile: "list.txt",
    });
    expect(parseArgs(["list.txt", "--select-only"])).toEqual({
      selectOnly: true,
      listFile: "list.txt",
    });
  });

  it("rejects a missing list file, an unknown flag and extra arguments", () => {
    expect(parseArgs([])).toBeNull();
    expect(parseArgs([""])).toBeNull();
    expect(parseArgs(["--select-only"])).toBeNull();
    // A lone unknown flag leaves exactly one argument, so only the "--" check
    // rejects it; with a list file beside it the count rejects it first.
    expect(parseArgs(["--select-onyl"])).toBeNull();
    expect(parseArgs(["--select-onyl", "list.txt"])).toBeNull();
    expect(parseArgs(["a.txt", "b.txt"])).toBeNull();
  });
});

describe("selectOnlyOutcome", () => {
  const registered = new Set(
    Object.values(MUTATION_TARGETS).flatMap((t) => t.mutate),
  );
  // Every listed file exists; nothing else does.
  const select = (files: string[]) =>
    selectEligible(
      files.filter((f) => !f.includes("/__tests__/")),
      {
        isHardExclusion,
        isApprovedExclusion,
        registeredMutatePaths: registered,
        exists: (p: string) => files.includes(p),
      },
    );

  it("asks for the install and run when a module is eligible, with no summary", () => {
    const sel = select([
      "server/lib/foo.ts",
      "server/lib/__tests__/foo.test.ts",
    ]);
    // Guards the fixture: it must reach the eligible bucket for this to mean anything.
    expect(sel.eligible).toHaveLength(1);
    expect(selectOnlyOutcome(sel)).toEqual({ run: true, summary: null });
  });

  it("skips them when nothing is eligible, leaving the summary a full run would write", () => {
    const sel = select(["server/lib/untested.ts"]);
    expect(sel.untested).toEqual(["server/lib/untested.ts"]);
    const outcome = selectOnlyOutcome(sel);
    expect(outcome.run).toBe(false);
    expect(outcome.summary).toBe(renderSummary([], sel));
    expect(outcome.summary).toContain(NO_ELIGIBLE);
  });
});

describe("mutation-on-diff.mjs on a tree with no node_modules", () => {
  type Tree = { root: string; list: string; output: string; summary: string };
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const read = (file: string) =>
    existsSync(file) ? readFileSync(file, "utf8") : "";

  /**
   * `fixtures` are created empty under the tree (cwd for the run, which is how
   * the script resolves "does this file exist"); `changed` is the PR's list.
   * realpath: on macOS os.tmpdir() is /var/... (a symlink to /private/var), so
   * the tree is made real to keep path prefixes comparable and to leave the
   * explicit link in the symlink test as the only symlink layer.
   */
  function makeTree(fixtures: string[], changed: string[]): Tree {
    const root = realpathSync(
      mkdtempSync(path.join(tmpdir(), "mutation-select-")),
    );
    dirs.push(root);
    for (let dir = root; dir !== path.dirname(dir); dir = path.dirname(dir)) {
      // The point of this tree: nothing in or above it can supply a package.
      expect(existsSync(path.join(dir, "node_modules"))).toBe(false);
    }
    mkdirSync(path.join(root, "scripts", "ci"), { recursive: true });
    copyFileSync(
      SCRIPT,
      path.join(root, "scripts", "ci", "mutation-on-diff.mjs"),
    );
    copyFileSync(REGISTRY, path.join(root, "stryker.targets.mjs"));
    for (const file of fixtures) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), "");
    }
    const list = path.join(root, "changed-files.txt");
    writeFileSync(list, changed.join("\n") + "\n");
    return {
      root,
      list,
      output: path.join(root, "github-output"),
      summary: path.join(root, "step-summary"),
    };
  }

  /** Actions sets both files for every step; `actions: false` drops them. */
  function run(tree: Tree, args: string[], { actions = true } = {}) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    if (actions) {
      env.GITHUB_OUTPUT = tree.output;
      env.GITHUB_STEP_SUMMARY = tree.summary;
    } else {
      delete env.GITHUB_OUTPUT;
      delete env.GITHUB_STEP_SUMMARY;
    }
    const res = spawnSync(
      process.execPath,
      [path.join(tree.root, "scripts", "ci", "mutation-on-diff.mjs"), ...args],
      { cwd: tree.root, env, encoding: "utf8", timeout: 30_000 },
    );
    return {
      status: res.status,
      stdout: res.stdout,
      stderr: res.stderr,
      output: read(tree.output),
      summary: read(tree.summary),
      ranHarness: existsSync(path.join(tree.root, "reports")),
    };
  }

  it("tells the workflow to skip, and leaves the summary, when nothing is eligible", () => {
    // A doc, a module with no test, and one the PR deleted. The untested note
    // proves the list was read and the files were looked up under the cwd; a
    // script that never read the list could not print it.
    const tree = makeTree(
      ["server/lib/untested.ts"],
      ["docs/notes.md", "server/lib/untested.ts", "server/lib/gone.ts"],
    );
    const r = run(tree, ["--select-only", tree.list]);
    expect(r.status).toBe(0);
    expect(r.output).toBe("run=false\n");
    // Once: the summary is this step's, and the full run is skipped after it.
    expect(r.summary.split(NO_ELIGIBLE)).toHaveLength(2);
    expect(r.summary).toContain(
      "- Untested changed modules (no co-located test): server/lib/untested.ts",
    );
    // The same text reached stdout and the step summary.
    expect(r.stdout).toContain(r.summary);
    expect(r.ranHarness).toBe(false);
  });

  it("asks for the install and run when a module is eligible, and writes no summary", () => {
    const tree = makeTree(
      [
        "server/lib/fixture-pure.ts",
        "server/lib/__tests__/fixture-pure.test.ts",
      ],
      ["server/lib/fixture-pure.ts"],
    );
    const r = run(tree, ["--select-only", tree.list]);
    // Exit 0 also shows it did not start the harness: there is no package.json
    // here, so `npm run mutation:explore` would have failed the run.
    expect(r.status).toBe(0);
    expect(r.output).toBe("run=true\n");
    // The full run renders the summary later; a second one here would repeat it.
    expect(r.summary).toBe("");
    expect(r.stdout).not.toContain(NO_ELIGIBLE);
    expect(r.ranHarness).toBe(false);
  });

  it("still runs when launched through a symlinked path", () => {
    const tree = makeTree(
      [
        "server/lib/fixture-pure.ts",
        "server/lib/__tests__/fixture-pure.test.ts",
      ],
      ["server/lib/fixture-pure.ts"],
    );
    // An explicit link, so the regime holds on Linux CI too (os.tmpdir() has no
    // symlink there): the loader realpaths the script, argv[1] keeps the link.
    const linkDir = mkdtempSync(path.join(tmpdir(), "mutation-link-"));
    dirs.push(linkDir);
    const link = path.join(linkDir, "repo");
    symlinkSync(tree.root, link);
    expect(realpathSync(link)).not.toBe(link);
    const res = spawnSync(
      process.execPath,
      [
        path.join(link, "scripts", "ci", "mutation-on-diff.mjs"),
        "--select-only",
        tree.list,
      ],
      {
        cwd: tree.root,
        env: {
          ...process.env,
          GITHUB_OUTPUT: tree.output,
          GITHUB_STEP_SUMMARY: tree.summary,
        },
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    expect(res.status).toBe(0);
    // Positive output: a script that never ran would leave this empty.
    expect(read(tree.output)).toBe("run=true\n");
    expect(read(tree.summary)).toBe("");
    expect(existsSync(path.join(tree.root, "reports"))).toBe(false);
  });

  it("applies the registry's rules: registered and Hard-Exclusion modules do not count", () => {
    const registeredModule = "server/lib/macro-gap-context.ts";
    const hardExcluded = "server/services/iap-receipt-validation.ts";
    // Guards the fixtures: if the registry stops treating them this way, say so here.
    expect(
      Object.values(MUTATION_TARGETS).some((t) =>
        t.mutate.includes(registeredModule),
      ),
    ).toBe(true);
    expect(isHardExclusion(hardExcluded)).toBe(true);
    expect(isApprovedExclusion(hardExcluded)).toBe(false);
    // Both have co-located tests, so only the registry keeps them out.
    const tree = makeTree(
      [
        registeredModule,
        "server/lib/__tests__/macro-gap-context.test.ts",
        hardExcluded,
        "server/services/__tests__/iap-receipt-validation.test.ts",
      ],
      [registeredModule, hardExcluded],
    );
    const r = run(tree, ["--select-only", tree.list]);
    expect(r.status).toBe(0);
    expect(r.output).toBe("run=false\n");
    expect(r.summary).toContain(
      `- Skipped (already a registered mutation target): ${registeredModule}`,
    );
    expect(r.summary).toContain(
      `- Excluded (Hard-Exclusion, not human-approved): ${hardExcluded}`,
    );
  });

  it("outside Actions, prints the decision and writes no files", () => {
    const tree = makeTree([], ["docs/notes.md"]);
    const r = run(tree, ["--select-only", tree.list], { actions: false });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("run=false");
    expect(r.output).toBe("");
    expect(r.summary).toBe("");
  });

  it("without the flag, still writes the summary and sets no step output", () => {
    const tree = makeTree([], ["docs/notes.md"]);
    const r = run(tree, [tree.list]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(NO_ELIGIBLE);
    expect(r.summary).toContain(NO_ELIGIBLE);
    expect(r.output).toBe("");
  });

  it("exits 2 with a usage line for a missing list file or an unknown flag", () => {
    const tree = makeTree([], []);
    for (const args of [
      [],
      [""],
      ["--select-only"],
      ["--select-onyl"],
      ["--select-onyl", tree.list],
    ]) {
      const r = run(tree, args);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain(
        "Usage: node scripts/ci/mutation-on-diff.mjs [--select-only] <changed-files.txt>",
      );
      expect(r.output).toBe("");
    }
  });

  it("fails loudly, with no run= line, when the list file cannot be read", () => {
    // A missing list means the Detect step failed; saying run=false here would
    // skip the job green over a PR nobody looked at.
    const tree = makeTree([], []);
    const r = run(tree, [
      "--select-only",
      path.join(tree.root, "no-such-list.txt"),
    ]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("ENOENT");
    expect(r.output).toBe("");
    expect(r.summary).toBe("");
  });
});

describe("mutation-on-diff.yml", () => {
  it("gates the install steps on the select step and skips only on an explicit false", () => {
    const workflow = readFileSync(WORKFLOW, "utf8");
    // Skip on an explicit false, never on a missing output: a typo'd step id
    // then installs and runs as before instead of skipping every PR.
    expect(workflow).toMatch(
      /- name: Install dependencies\n\s+if: steps\.select\.outputs\.run != 'false'\n\s+run: npm ci\n/,
    );
    // One gate per step that needs the install: setup-node, install, run and
    // upload. A step gated the other way would install and then skip its work
    // on a missing output, which is the silent skip the polarity prevents.
    expect(
      workflow.match(/if: steps\.select\.outputs\.run != 'false'/g),
    ).toHaveLength(4);
    expect(workflow).not.toContain("outputs.run == 'true'");
  });

  it("keeps the select step the gates read: its name, id and the --select-only flag", () => {
    const workflow = readFileSync(WORKFLOW, "utf8");
    // Without the flag the script does the full run before npm ci and sets
    // no output; under another id the gates read none. Either way nothing
    // skips, silently, on every PR with no eligible module.
    expect(workflow).toMatch(
      /- name: Select eligible modules\n\s+id: select\n\s+run: node scripts\/ci\/mutation-on-diff\.mjs --select-only "\$RUNNER_TEMP\/changed-files\.txt"\n/,
    );
  });
});
