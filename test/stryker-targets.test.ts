import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  MUTATION_TARGETS,
  DEFAULT_TARGET,
  resolveTarget,
  isHardExclusion,
  isApprovedExclusion,
  assertAllowedTarget,
  HUMAN_APPROVED_EXCLUSIONS,
} from "../stryker.targets.mjs";

describe("mutation target registry", () => {
  it("resolves both axes for a known target", () => {
    const t = resolveTarget("verification-consensus");
    expect(t.mutate).toEqual(["server/lib/verification-consensus.ts"]);
    expect(t.testInclude).toEqual([
      "server/lib/__tests__/verification-consensus.test.ts",
    ]);
  });

  it("defaults to macro-gap-context when no name is given", () => {
    expect(resolveTarget()).toBe(MUTATION_TARGETS[DEFAULT_TARGET]);
    expect(DEFAULT_TARGET).toBe("macro-gap-context");
  });

  it("throws a listing error on an unknown target", () => {
    expect(() => resolveTarget("nope")).toThrow(
      /Unknown MUTATION_TARGET "nope"/,
    );
    expect(() => resolveTarget("nope")).toThrow(/macro-gap-context/);
  });

  it("isHardExclusion matches known Hard-Exclusion paths", () => {
    const forbiddenExamples = [
      "server/middleware/auth.ts",
      "server/routes/auth.ts",
      "server/middleware/api-key-auth.ts",
      "server/services/goal-calculator.ts",
      "server/services/adaptive-goals.ts",
      "server/services/receipt-validation.ts",
      "server/services/healthkit-sync.ts",
      "server/storage/health.ts",
      "server/lib/jwt-verify.ts",
      "shared/schema.ts",
      "migrations/0001_init.ts",
    ];
    for (const p of forbiddenExamples) expect(isHardExclusion(p)).toBe(true);
  });

  it("isHardExclusion clears non-excluded targets", () => {
    expect(isHardExclusion("server/lib/verification-consensus.ts")).toBe(false);
    expect(isHardExclusion("server/lib/macro-gap-context.ts")).toBe(false);
  });

  it("every registered target passes the approval gate", () => {
    for (const [name, target] of Object.entries(MUTATION_TARGETS)) {
      expect(() => assertAllowedTarget(name, target)).not.toThrow();
    }
  });

  it("assertAllowedTarget throws for an unapproved Hard-Exclusion target", () => {
    expect(() =>
      assertAllowedTarget("fake-auth", {
        mutate: ["server/middleware/auth.ts"],
        testInclude: ["server/__tests__/auth.test.ts"],
      }),
    ).toThrow(/HUMAN_APPROVED_EXCLUSIONS/);
  });

  it("fail-closed: a Hard-Exclusion target with an empty mutate is rejected", () => {
    // Flagged via the testInclude path but with no `mutate` source to key an approval
    // to — must be rejected, not vacuously allowed by the empty for-loop.
    expect(() =>
      assertAllowedTarget("fake-empty", {
        mutate: [],
        testInclude: ["server/services/__tests__/goal-calculator.test.ts"],
      }),
    ).toThrow(/fail-closed/i);
  });

  it("fail-closed: an approval entry with an empty note does NOT count", () => {
    const approvals = {
      "server/middleware/auth.ts": {
        approvedOn: "x",
        planPath: "p",
        note: "   ",
      },
    };
    expect(() =>
      assertAllowedTarget(
        "fake-auth",
        {
          mutate: ["server/middleware/auth.ts"],
          testInclude: ["server/__tests__/auth.test.ts"],
        },
        approvals,
      ),
    ).toThrow();
  });

  it("passes for an approval entry with non-empty note + planPath", () => {
    const approvals = {
      "server/middleware/auth.ts": {
        approvedOn: "2026-06-05",
        planPath: "docs/mutation-testing/README.md",
        note: "approved for a test",
      },
    };
    expect(() =>
      assertAllowedTarget(
        "fake-auth",
        {
          mutate: ["server/middleware/auth.ts"],
          testInclude: ["server/__tests__/auth.test.ts"],
        },
        approvals,
      ),
    ).not.toThrow();
  });

  it("the goal-safety module is approved with provenance", () => {
    for (const src of ["server/services/goal-calculator.ts"]) {
      expect(isApprovedExclusion(src)).toBe(true);
      expect(HUMAN_APPROVED_EXCLUSIONS[src].planPath.trim()).not.toBe("");
      expect(HUMAN_APPROVED_EXCLUSIONS[src].note.trim()).not.toBe("");
    }
  });
});

// --- Drift guard: registry <-> required mutation gates -----------------------
// A registered target must be matched by exactly one required gate's Detect ERE
// and have its `MUTATION_TARGET=<name>` step there. Models Detect with grep
// itself (not a JS RegExp); exit 2 (broken ERE) fails the test.
const REPO_ROOT = path.resolve(__dirname, "..");
const GATES = ["mutation-non-excluded.yml", "mutation-goal-safety.yml"];

function readGate(file: string) {
  const yml = readFileSync(
    path.join(REPO_ROOT, ".github", "workflows", file),
    "utf8",
  );
  const detect = [...yml.matchAll(/grep -qE '([^']+)' <<< "\$CHANGED"/g)];
  expect(detect, `${file}: Detect grep lines`).toHaveLength(1);
  const steps = [
    ...yml.matchAll(/run: MUTATION_TARGET=([\w-]+) npm run test:mutation/g),
  ].map((m) => m[1]);
  return { file, ere: detect[0][1], steps };
}

/** Detect's own decision for one path. Exit 2 = broken ERE. */
function matches(ere: string, p: string): boolean {
  const r = spawnSync("grep", ["-qE", ere], { input: `${p}\n` });
  expect([0, 1], `grep exit for ${p}`).toContain(r.status);
  return r.status === 0;
}

describe("required mutation gates cover every registered target", () => {
  const gates = GATES.map(readGate);

  it("oracle controls: harness config matches both gates, a stranger matches neither", () => {
    for (const g of gates) {
      expect(matches(g.ere, "stryker.targets.mjs"), g.file).toBe(true);
      expect(
        matches(
          g.ere,
          "client/components/nutrition/not-a-registered-target.ts",
        ),
        g.file,
      ).toBe(false);
    }
  });

  it("every target is wired into exactly one gate, with its step", () => {
    const names = Object.keys(MUTATION_TARGETS);
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const t = MUTATION_TARGETS[name];
      const paths: string[] = [...t.mutate, ...t.testInclude];
      const hard = paths.some((p) => isHardExclusion(p));
      const expected = hard
        ? "mutation-goal-safety.yml"
        : "mutation-non-excluded.yml";
      const hit = gates.filter((g) => paths.some((p) => matches(g.ere, p)));
      expect(
        hit.map((g) => g.file),
        `${name}: gates whose Detect matches its paths`,
      ).toEqual([expected]);
      for (const p of paths) {
        expect(matches(hit[0].ere, p), `${name}: ${p}`).toBe(true);
      }
      for (const g of gates) {
        expect(g.steps.includes(name), `${name} step in ${g.file}`).toBe(
          g.file === expected,
        );
      }
    }
  });

  it("every gate step names a registered target", () => {
    for (const g of gates) {
      for (const s of g.steps) {
        expect(Object.keys(MUTATION_TARGETS), `${g.file} step ${s}`).toContain(
          s,
        );
      }
    }
  });
});
