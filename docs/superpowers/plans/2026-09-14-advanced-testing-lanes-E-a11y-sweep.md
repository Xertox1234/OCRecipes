# Lane E — Accessibility Hierarchy Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After each visual screenshot, dump the device accessibility hierarchy and enforce two rules — every interactive element has a label (fails), no two sibling interactive elements share a label (warns) — with the platform attribute vocabulary measured first, not assumed.

**Architecture:** `scripts/ci/visual-run.sh` (Lane D) already leaves the app on each captured screen; Lane E appends `maestro hierarchy > e2e/a11y-out/<platform>/<screen>.json` after each flow. `scripts/ci/a11y-sweep.ts` parses Maestro's `{ attributes, children }` tree, classifies interactive nodes via a per-platform predicate table (confirmed by the E0 spike), applies R1/R2, and prints a summary. A workflow step per platform runs the sweep and uploads the dumps.

**Tech Stack:** Maestro `hierarchy` subcommand (present in 2.6.0 local / 2.9.0 CI), `tsx`, Vitest, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-advanced-testing-lanes-design.md` §Lane E. Shared constraints: `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-00-index.md` §Global Constraints.

## Global Constraints

- **D before E, always.** Lane E edits `scripts/ci/visual-run.sh` and `e2e-regression.yml` that D0 created; it merges only after D0 has.
- **E0 is a spike whose output decides R1's implementation.** The predicate table in Task 2 is a documented default; Task 1 confirms or edits it against real dumps before Task 2 enforces anything.
- Advisory: a red sweep lands on the existing `e2e-regression-failure` issue; never a required check.
- No `axe-core` under jsdom (spec non-goal).
- Commit messages: no backticks in `-m`; end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. In a `/todo` worktree use `/usr/bin/git`.
- **STOP after each completed task** (green + committed + reviewed): report and end the turn so the user can compact. See index §Execution protocol. Task 1 (E0) needs a workflow dispatch — human-gated.

## File structure

| File                                                                             | Responsibility                                                                           |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `scripts/ci/visual-run.sh`                                                       | (+2 lines) hierarchy dump after each visual flow                                         |
| `scripts/ci/a11y-sweep.ts`                                                       | `isInteractive`, `labelOf`, `sweepHierarchy`, `renderSummary`, CLI                       |
| `scripts/__tests__/a11y-sweep.test.ts`                                           | floor rule: unlabelled interactive → R1; duplicate sibling labels → R2; labelled → clean |
| `docs/solutions/best-practices/maestro-hierarchy-attribute-vocabulary-<date>.md` | the spike's record of what each platform actually emits                                  |
| `.github/workflows/e2e-regression.yml`                                           | sweep step + `a11y-<platform>` artefact per job                                          |
| `package.json`                                                                   | `a11y:sweep` script                                                                      |

---

### Task 1 (E0 — spike): Dump the hierarchy on both platforms and record the vocabulary

**Files:**

- Modify: `scripts/ci/visual-run.sh` (append the dump after each flow)
- Modify: `.github/workflows/e2e-regression.yml` (upload `e2e/a11y-out/<platform>/` as `a11y-<platform>` in both jobs)
- Modify: `.gitignore` (add `e2e/a11y-out/`)
- Create: `docs/solutions/best-practices/maestro-hierarchy-attribute-vocabulary-2026-09-XX.md` (date of the spike)

**Interfaces:**

- Produces: `e2e/a11y-out/<platform>/<screen>.json` per captured screen — Maestro's hierarchy JSON: a root node `{ "attributes": { … }, "children": [ … ] }` recursively. The spike records the exact attribute keys present on (a) a known button on the Login screen (the `Sign In` control), (b) a known text input (`input-username`), (c) a static text (`Welcome!`), on **both** platforms.

- [ ] **Step 1: Append the dump to the runner script** (inside the `for flow` loop, replacing the `# Lane E … appends the hierarchy dump here` comment):

```bash
  # Lane E: the app is on the captured screen right now — dump its
  # accessibility hierarchy for scripts/ci/a11y-sweep.ts (and for debugging
  # selector failures in the regression suite).
  mkdir -p "e2e/a11y-out/$PLATFORM"
  maestro hierarchy > "e2e/a11y-out/$PLATFORM/$name.json" 2>/dev/null \
    || echo "::warning::hierarchy dump failed for $name on $PLATFORM"
```

Append to `.gitignore`: `e2e/a11y-out/`.

- [ ] **Step 2: Upload the dumps in both jobs** (after each job's `Upload visual artefacts (…)` step):

```yaml
- name: Upload accessibility hierarchy dumps (iOS)
  if: always()
  uses: actions/upload-artifact@v7
  with:
    name: a11y-ios
    path: e2e/a11y-out/ios/
    if-no-files-found: warn
```

(and the `android` twin with `name: a11y-android`, `path: e2e/a11y-out/android/`).

- [ ] **Step 3: Commit, dispatch, download**

```bash
git add scripts/ci/visual-run.sh .github/workflows/e2e-regression.yml .gitignore
git commit -m "e2e(a11y): dump the accessibility hierarchy after each visual flow

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Dispatch `E2E Regression` (`rebaseline=false`) on the branch; download `a11y-ios` and `a11y-android`; open `login.json` from each.

- [ ] **Step 4: Record the vocabulary — verbatim, not paraphrased**

Write the solution doc with single-line inline-flow frontmatter (`scripts/check-solution-frontmatter.js` enforces it; `tags:` must include a routed tag — use `[testing, e2e, accessibility]`, and `applies_to: ["scripts/ci/**", "e2e/**"]`). Body — a table per platform with the exact attribute JSON for the three probe elements:

```markdown
| Platform | Element        | attributes (verbatim)                                             |
| -------- | -------------- | ----------------------------------------------------------------- |
| ios      | Sign In button | `{ "accessibilityText": "…", "text": "…", "enabled": "true", … }` |
| ios      | input-username | …                                                                 |
| ios      | Welcome!       | …                                                                 |
| android  | Sign In button | `{ "clickable": "true", "resource-id": "…", … }`                  |
| android  | input-username | …                                                                 |
| android  | Welcome!       | …                                                                 |
```

plus one sentence per platform answering: _which attribute(s) distinguish an interactive element from a static one?_ If iOS exposes nothing that separates the button from the text (no `clickable`, no `type`/trait), say so explicitly — that sentence is what decides R1's iOS form in Task 2.

- [ ] **Step 5: Write the "Predicate" section of the solution doc** — for each platform, the exact attribute test Task 2 will implement in `INTERACTIVE_PREDICATES` (e.g. `clickable === "true" || checkable === "true"`) and the label key order for `labelOf`, derived from the table above. Task 2 (E1) copies these expressions verbatim; if a platform cannot distinguish interactive elements, the section says so and Task 2's predicate for that platform returns `false` for every node (R1 effectively skipped there, by evidence).

_(E0 ends here — Task 1. Nothing is enforced yet.)_

---

### Task 2 (E1): `a11y-sweep.ts` with its floor-rule test

**Files:**

- Create: `scripts/ci/a11y-sweep.ts`
- Test: `scripts/__tests__/a11y-sweep.test.ts`
- Modify: `package.json` (script `"a11y:sweep": "npx tsx scripts/ci/a11y-sweep.ts"`)

**Interfaces:**

- Produces:
  - `type Platform = "ios" | "android"`; `type HierarchyNode = { attributes?: Record<string, string>; children?: HierarchyNode[] }`.
  - `INTERACTIVE_PREDICATES: Record<Platform, (attrs: Record<string, string>) => boolean>` — **default, to be confirmed by E0**: android: `attrs.clickable === "true" || attrs.checkable === "true"`; ios: `/^(Button|Link|Switch|TextField|SecureTextField|Toggle|Cell)$/.test(attrs.type ?? "") || attrs.clickable === "true"`.
  - `labelOf(attrs): string` — first non-blank of `accessibilityText`, `text`, `hintText`, trimmed.
  - `type Violation = { rule: "R1" | "R2"; screen: string; label: string; bounds: string; path: string }`.
  - `sweepHierarchy(tree: HierarchyNode, platform: Platform, screen: string): { r1: Violation[]; r2: Violation[]; interactiveCount: number }`.
  - `renderSummary(platform, results: Array<ReturnType<typeof sweepHierarchy>>): string`.
  - CLI: `npx tsx scripts/ci/a11y-sweep.ts --platform ios|android [--dir e2e/a11y-out/<p>]`. Exit 0 clean (R2 warnings allowed) / 1 any R1 violation / 2 usage or no dumps found.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/__tests__/a11y-sweep.test.ts
/**
 * Floor rule for the a11y sweep: an unlabelled interactive element must
 * produce an R1 violation, duplicate sibling labels an R2 warning, and a
 * fully labelled screen nothing — on both platforms' vocabularies.
 */
import { describe, it, expect } from "vitest";
import { labelOf, sweepHierarchy, type HierarchyNode } from "../ci/a11y-sweep";

const node = (
  attributes: Record<string, string>,
  children: HierarchyNode[] = [],
): HierarchyNode => ({ attributes, children });

describe("labelOf", () => {
  it("prefers accessibilityText, then text, then hintText", () => {
    expect(labelOf({ accessibilityText: "Save", text: "x" })).toBe("Save");
    expect(labelOf({ text: " Save " })).toBe("Save");
    expect(labelOf({ hintText: "Search" })).toBe("Search");
    expect(labelOf({})).toBe("");
  });
});

describe("sweepHierarchy — android vocabulary", () => {
  it("R1: an unlabelled clickable element is a violation", () => {
    const tree = node({}, [
      node({
        clickable: "true",
        bounds: "[0,0][100,40]",
        "resource-id": "btn-save",
      }),
      node({ text: "Welcome!" }),
    ]);
    const r = sweepHierarchy(tree, "android", "login");
    expect(r.interactiveCount).toBe(1);
    expect(r.r1).toEqual([
      expect.objectContaining({
        rule: "R1",
        screen: "login",
        bounds: "[0,0][100,40]",
      }),
    ]);
  });

  it("a labelled clickable element is clean", () => {
    const tree = node({}, [
      node({ clickable: "true", text: "Save", bounds: "[0,0][100,40]" }),
    ]);
    expect(sweepHierarchy(tree, "android", "login").r1).toEqual([]);
  });

  it("R2: two sibling interactive elements with the same label warn", () => {
    const tree = node({}, [
      node({ clickable: "true", text: "More", bounds: "[0,0][10,10]" }),
      node({ clickable: "true", text: "More", bounds: "[0,20][10,30]" }),
    ]);
    const r = sweepHierarchy(tree, "android", "home");
    expect(r.r1).toEqual([]);
    expect(r.r2.map((v) => v.label)).toEqual(["More"]);
  });

  it("R2 ignores equal labels that are not siblings", () => {
    const tree = node({}, [
      node({ clickable: "true", text: "More" }),
      node({}, [node({ clickable: "true", text: "More" })]),
    ]);
    expect(sweepHierarchy(tree, "android", "home").r2).toEqual([]);
  });
});

describe("sweepHierarchy — ios vocabulary", () => {
  it("R1: an unlabelled Button is a violation; a labelled one is clean", () => {
    const bad = node({}, [node({ type: "Button", bounds: "[0,0][50,50]" })]);
    const good = node({}, [
      node({ type: "Button", accessibilityText: "Sign In" }),
    ]);
    expect(sweepHierarchy(bad, "ios", "login").r1).toHaveLength(1);
    expect(sweepHierarchy(good, "ios", "login").r1).toEqual([]);
  });

  it("static text is never interactive", () => {
    const tree = node({}, [node({ type: "StaticText", text: "Welcome!" })]);
    const r = sweepHierarchy(tree, "ios", "login");
    expect(r.interactiveCount).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run scripts/__tests__/a11y-sweep.test.ts`
Expected: FAIL — `Cannot find module '../ci/a11y-sweep'`

- [ ] **Step 3: Write the module**

```ts
// scripts/ci/a11y-sweep.ts
/**
 * Lane E accessibility sweep over `maestro hierarchy` dumps.
 *
 * R1 (fails):  every interactive element has a non-empty label.
 * R2 (warns):  no two SIBLING interactive elements share a label.
 *
 * INTERACTIVE_PREDICATES is the per-platform vocabulary. The values below are
 * the E0 spike's confirmed set — see
 * docs/solutions/best-practices/maestro-hierarchy-attribute-vocabulary-*.md.
 * If a platform's dump does not distinguish interactive elements at all, the
 * predicate for that platform returns false for everything and R1 is
 * effectively skipped there; the spike doc must say so.
 */
import * as fs from "node:fs";
import * as path from "node:path";

export type Platform = "ios" | "android";
export interface HierarchyNode {
  attributes?: Record<string, string>;
  children?: HierarchyNode[];
}

export const INTERACTIVE_PREDICATES: Record<
  Platform,
  (attrs: Record<string, string>) => boolean
> = {
  android: (a) => a.clickable === "true" || a.checkable === "true",
  ios: (a) =>
    /^(Button|Link|Switch|TextField|SecureTextField|Toggle|Cell)$/.test(
      a.type ?? "",
    ) || a.clickable === "true",
};

export function labelOf(attrs: Record<string, string>): string {
  for (const key of ["accessibilityText", "text", "hintText"] as const) {
    const v = attrs[key]?.trim();
    if (v) return v;
  }
  return "";
}

export interface Violation {
  rule: "R1" | "R2";
  screen: string;
  label: string;
  bounds: string;
  path: string;
}

export function sweepHierarchy(
  tree: HierarchyNode,
  platform: Platform,
  screen: string,
) {
  const isInteractive = INTERACTIVE_PREDICATES[platform];
  const r1: Violation[] = [];
  const r2: Violation[] = [];
  let interactiveCount = 0;

  const visit = (n: HierarchyNode, p: string): void => {
    const attrs = n.attributes ?? {};
    if (isInteractive(attrs)) {
      interactiveCount += 1;
      if (labelOf(attrs) === "") {
        r1.push({
          rule: "R1",
          screen,
          label: "",
          bounds: attrs.bounds ?? "?",
          path: p,
        });
      }
    }
    const kids = n.children ?? [];
    const seen = new Map<string, number>();
    kids.forEach((k, i) => {
      const ka = k.attributes ?? {};
      if (!isInteractive(ka)) return;
      const label = labelOf(ka);
      if (!label) return;
      if (seen.has(label)) {
        r2.push({
          rule: "R2",
          screen,
          label,
          bounds: ka.bounds ?? "?",
          path: `${p}/${i}`,
        });
      } else {
        seen.set(label, i);
      }
    });
    kids.forEach((k, i) => visit(k, `${p}/${i}`));
  };
  visit(tree, "");
  return { r1, r2, interactiveCount };
}

export function renderSummary(
  platform: Platform,
  results: Array<ReturnType<typeof sweepHierarchy> & { screen: string }>,
): string {
  const r1Total = results.reduce((n, r) => n + r.r1.length, 0);
  const lines = [
    `### Accessibility sweep (${platform}) — ${r1Total === 0 ? "✅ R1 clean" : `❌ ${r1Total} unlabelled interactive element(s)`}`,
    "",
    "| Screen | Interactive | R1 unlabelled | R2 duplicate siblings |",
    "|---|---|---|---|",
    ...results.map(
      (r) =>
        `| ${r.screen} | ${r.interactiveCount} | ${r.r1.length} | ${r.r2.length} |`,
    ),
  ];
  for (const r of results) {
    for (const v of r.r1)
      lines.push(
        "",
        `- ❌ R1 ${r.screen}: unlabelled interactive at ${v.bounds} (node ${v.path})`,
      );
    for (const v of r.r2)
      lines.push(
        "",
        `- ⚠️ R2 ${r.screen}: siblings share label "${v.label}" at ${v.bounds}`,
      );
  }
  return lines.join("\n") + "\n";
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const platform = arg("--platform") as Platform | undefined;
  if (!platform || !["ios", "android"].includes(platform)) {
    console.error(
      "usage: a11y-sweep --platform ios|android [--dir e2e/a11y-out/<platform>]",
    );
    process.exit(2);
  }
  const dir = arg("--dir") ?? `e2e/a11y-out/${platform}`;
  const files = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  if (files.length === 0) {
    console.error(`no hierarchy dumps under ${dir}`);
    process.exit(2);
  }
  const results = files.map((f) => {
    const screen = f.replace(/\.json$/, "");
    const tree = JSON.parse(
      fs.readFileSync(path.join(dir, f), "utf8"),
    ) as HierarchyNode;
    return { screen, ...sweepHierarchy(tree, platform, screen) };
  });
  const summary = renderSummary(platform, results);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.exit(results.some((r) => r.r1.length > 0) ? 1 : 0);
}

if (process.argv[1] && /a11y-sweep\.(ts|js)$/.test(process.argv[1])) {
  main();
}
```

Now apply the E0 spike's confirmed vocabulary to `INTERACTIVE_PREDICATES` and `labelOf` (if iOS labels live under a different key, add it to the `labelOf` key list — and add a test case with that key). If `maestro hierarchy` wraps the tree (e.g. under a top-level key), unwrap it in `main()` before `sweepHierarchy` — the spike doc records the root shape.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/__tests__/a11y-sweep.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/ci/a11y-sweep.ts scripts/__tests__/a11y-sweep.test.ts package.json
git commit -m "ci(a11y): hierarchy sweep with labelled-interactive (R1) and duplicate-sibling (R2) rules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3 (E1): Run the sweep in both jobs

**Files:**

- Modify: `.github/workflows/e2e-regression.yml` (a step after each `Visual diff (…)` step)

- [ ] **Step 1: Add the steps**

iOS (after `Visual diff (iOS)`):

```yaml
- name: Accessibility sweep (iOS)
  if: ${{ always() && !inputs.rebaseline }}
  run: npm run --silent a11y:sweep -- --platform ios
```

Android (after `Visual diff (Android)`):

```yaml
- name: Accessibility sweep (Android)
  if: ${{ always() && !inputs.rebaseline }}
  run: npm run --silent a11y:sweep -- --platform android
```

- [ ] **Step 2: Validate, commit, dispatch**

```bash
npx --yes yaml-lint .github/workflows/e2e-regression.yml
git add .github/workflows/e2e-regression.yml
git commit -m "ci(e2e): run the accessibility sweep after the visual diff on both platforms

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

Dispatch on the branch. Expected: the step summary shows one table per platform with the five screens (Login only until D1 merges).

---

### Task 4 (E1): Act on what the sweep finds

- [ ] **Step 1: For every R1 violation** on the five screens: locate the component (the dump's `resource-id`/`bounds` plus the screen name), add the missing `accessibilityLabel` per `docs/rules/accessibility.md`, and re-dispatch. In scope when the fix is a label on an existing element; anything larger (a redesign, a native-module change) is filed per the severity policy (`P2`/medium if it blocks screen-reader use of a primary action; `P3`/low otherwise) and listed in the PR body.

- [ ] **Step 2: For every R2 warning:** list them in the PR body with a one-line judgement each (real ambiguity → fix or file; intentional repetition such as list-row "More" buttons → leave, noting why). R2 stays a warning in this effort.

- [ ] **Step 3: Positive control in the workflow** (once): on a throwaway branch, remove an `accessibilityLabel` from the Login screen's Sign In control, dispatch, and confirm the sweep step goes red with an R1 line naming that control's bounds. Record the run URL; delete the branch.

## Verification (E1 PR)

```bash
npx vitest run scripts/__tests__/a11y-sweep.test.ts scripts/__tests__/visual-diff.test.ts
grep -n "maestro hierarchy" scripts/ci/visual-run.sh
grep -n "a11y:sweep" .github/workflows/e2e-regression.yml package.json
```

## Considered and rejected

- Per-element `assertVisible` on labels inside the visual flows — that is E2E, not a sweep; it only checks elements someone already thought of.
- The TalkBack `logcat` technique from `docs/solutions/best-practices/verify-talkback-behavior-via-emulator-logcat-2026-06-23.md` in CI — Android-only, semi-manual, explicitly "provisional"; stays a manual verification tool.
