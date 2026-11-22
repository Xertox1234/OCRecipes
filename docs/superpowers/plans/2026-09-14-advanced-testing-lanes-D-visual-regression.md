# Lane D — Visual Regression on the Maestro Nightly Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Screenshot five stable screens on both platforms every night, diff them against committed baselines with an explicit tolerance, upload diff images, fail advisory on drift, and refresh baselines only through a CI-opened PR.

**Architecture:** `visual`-tagged Maestro flows end in `takeScreenshot`. A per-flow runner script (`scripts/ci/visual-run.sh`) executes them one file at a time (so Lane E can dump the hierarchy after each). `scripts/ci/visual-diff.ts` (pixelmatch + pngjs) compares `e2e/visual-out/<platform>/` to `e2e/baselines/<platform>/`, honouring `e2e/baselines/manifest.json` (per-screen tolerance, pinned runtime per platform). Both platform jobs in `e2e-regression.yml` gain status-bar freezing, runtime recording, the visual run, the diff, and artefact upload; a `rebaseline-visual` job turns `rebaseline=true` into a PR.

**Tech Stack:** Maestro 2.9.0 (CI; `takeScreenshot` path is relative to the workspace = repo root), `pixelmatch` ^7, `pngjs` ^7, `tsx`, `xcrun simctl status_bar`, Android SystemUI demo mode, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-14-advanced-testing-lanes-design.md` §Lane D, §Shared mechanism. Shared constraints: `docs/superpowers/plans/2026-09-14-advanced-testing-lanes-00-index.md` §Global Constraints.

## Global Constraints

- Advisory: rides `e2e-regression.yml`, which is not a required check. A red visual diff lands on the existing `e2e-regression-failure` issue.
- Tolerance 0.5 % (`0.005` mismatched-pixel ratio) by default; per-screen override only in `e2e/baselines/manifest.json` with a `reason`.
- **Baselines are produced only by the `rebaseline=true` dispatch** (the `rebaseline-visual` job, using `BASELINE_PR_TOKEN`). Never commit a local screenshot under `e2e/baselines/`.
- The runtime is pinned by data: `manifest.runtime.<platform>` is written at rebaseline time and the diff step fails loudly when the current runtime differs.
- Android animations are already disabled by `reactivecircus/android-emulator-runner` (`disable-animations: true`); every visual flow still ends with `waitForAnimationToEnd` before the screenshot.
- The Android emulator action runs each `script:` line in its own `sh -c` — every Android step below is a single line; no multi-line shell constructs.
- Serialize the `package.json` edit (Task 1) with Lane A Task 7.
- Commit messages: no backticks in `-m`; end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. In a `/todo` worktree use `/usr/bin/git`.
- **STOP after each completed task** (green + committed + reviewed): report and end the turn so the user can compact. See index §Execution protocol. Task 5 is human-gated (dispatches, baseline PR merge) — stop and ask at each step.

## File structure

| File                                                            | Responsibility                                                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `scripts/ci/visual-diff.ts`                                     | `diffPng`, `loadManifest`, `compareDir`, `writeBaselines`, CLI                                                             |
| `scripts/__tests__/visual-diff.test.ts`                         | floor rule: identical → 0; shifted → above tolerance; size mismatch; missing baseline; manifest override; runtime mismatch |
| `scripts/ci/visual-run.sh`                                      | runs each `e2e/flows/visual/*.yaml` individually with `-e PLATFORM=…`; Lane E appends a hierarchy dump per flow            |
| `e2e/flows/visual/login.yaml` (D0), four more (D1)              | `visual`-tagged screenshot flows                                                                                           |
| `e2e/baselines/manifest.json`, `e2e/baselines/<platform>/*.png` | committed references (via rebaseline PR only)                                                                              |
| `.github/workflows/e2e-regression.yml`                          | `rebaseline` input; per-platform freeze/record/run/diff/upload steps; `rebaseline-visual` job                              |
| `package.json`, `.gitignore`                                    | `visual:diff` script, deps; ignore `e2e/visual-out/`, `e2e/visual-diff/`                                                   |

---

### Task 1: `visual-diff.ts` with its floor-rule test

**Files:**

- Create: `scripts/ci/visual-diff.ts`
- Test: `scripts/__tests__/visual-diff.test.ts`
- Modify: `package.json` (devDependencies `pixelmatch`, `pngjs`, `@types/pixelmatch`, `@types/pngjs`; script `visual:diff`)
- Modify: `.gitignore` (add `e2e/visual-out/` and `e2e/visual-diff/`)

**Interfaces:**

- Produces (exports of `scripts/ci/visual-diff.ts`):
  - `type Platform = "ios" | "android"`.
  - `type DiffResult = { width: number; height: number; totalPixels: number; mismatchedPixels: number; mismatchRatio: number; sizeMismatch: boolean; diff: Buffer | null }`.
  - `diffPng(actual: Buffer, expected: Buffer, opts?: { threshold?: number }): DiffResult` — `threshold` is pixelmatch's per-pixel colour threshold (default 0.1); a size mismatch returns `mismatchRatio: 1`, `sizeMismatch: true`, `diff: null`.
  - `type Manifest = { defaultTolerance: number; runtime: Partial<Record<Platform, string>>; screens: Record<string, { tolerance?: number; reason?: string }> }`.
  - `loadManifest(path: string): Manifest` — returns `{ defaultTolerance: 0.005, runtime: {}, screens: {} }` when the file is absent.
  - `compareDir(opts: { platform: Platform; actualDir: string; baselineDir: string; outDir: string; manifest: Manifest; runtimeId: string }): { rows: Array<{ screen: string; ratio: number; tolerance: number; status: "pass" | "fail" | "missing-baseline" | "size-mismatch" }>; failures: string[] }` — writes `<outDir>/<screen>.diff.png` for every compared screen; a runtime mismatch is a single failure and no screens are compared.
  - `writeBaselines(opts: { platform: Platform; actualDir: string; baselineDir: string; manifestPath: string; runtimeId: string }): string[]` — copies every `*.png` from `actualDir` into `baselineDir`, sets `manifest.runtime[platform] = runtimeId`, writes the manifest, returns the copied paths.
  - `renderSummary(platform: Platform, result: ReturnType<typeof compareDir>): string` (markdown).
  - CLI: `npx tsx scripts/ci/visual-diff.ts --platform ios|android --runtime <id> [--actual-dir e2e/visual-out/<p>] [--baseline-dir e2e/baselines/<p>] [--out-dir e2e/visual-diff/<p>] [--manifest e2e/baselines/manifest.json] [--write-baseline]`. Exit 0 pass / 1 any failure / 2 usage.

- [ ] **Step 1: Install the dependencies and add the script**

```bash
npm install --save-dev pixelmatch@^7.1.0 pngjs@^7.0.0 @types/pixelmatch @types/pngjs
```

Add to `package.json` scripts: `"visual:diff": "npx tsx scripts/ci/visual-diff.ts"`. Append to `.gitignore`:

```
# Lane D visual regression — per-run screenshots and diff images (baselines are tracked)
e2e/visual-out/
e2e/visual-diff/
```

- [ ] **Step 2: Write the failing test (PNGs are generated in memory — no binary fixtures)**

```ts
// scripts/__tests__/visual-diff.test.ts
/**
 * Floor rule for the visual lane: the diff step must be observed red on a
 * genuinely different image and green on an identical one, with the size,
 * missing-baseline, manifest-override, and runtime-pin paths each proven.
 * Images are synthesised with pngjs so no binary fixture is committed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import {
  compareDir,
  diffPng,
  loadManifest,
  writeBaselines,
} from "../ci/visual-diff";

/** A w×h white PNG with a black square whose top-left corner is (x, y). */
function squarePng(
  w: number,
  h: number,
  x: number,
  y: number,
  size = 10,
): Buffer {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h * 4; i += 4) {
    png.data[i] = png.data[i + 1] = png.data[i + 2] = 255;
    png.data[i + 3] = 255;
  }
  for (let yy = y; yy < y + size; yy++) {
    for (let xx = x; xx < x + size; xx++) {
      const i = (yy * w + xx) * 4;
      png.data[i] = png.data[i + 1] = png.data[i + 2] = 0;
    }
  }
  return PNG.sync.write(png);
}

const base = squarePng(100, 100, 10, 10);
const shifted = squarePng(100, 100, 40, 40); // ~200 changed px of 10 000 = 2 %
const nudged = squarePng(100, 100, 11, 10); // ~20 changed px = 0.2 %

describe("diffPng", () => {
  it("reports zero mismatch for an identical pair", () => {
    const r = diffPng(base, Buffer.from(base));
    expect(r.mismatchedPixels).toBe(0);
    expect(r.mismatchRatio).toBe(0);
    expect(r.sizeMismatch).toBe(false);
  });

  it("reports a ratio above 0.005 for a moved element", () => {
    const r = diffPng(shifted, base);
    expect(r.mismatchRatio).toBeGreaterThan(0.005);
    expect(r.diff).not.toBeNull();
  });

  it("reports a ratio below 0.005 for a one-pixel nudge", () => {
    expect(diffPng(nudged, base).mismatchRatio).toBeLessThan(0.005);
  });

  it("treats a size mismatch as total mismatch", () => {
    const r = diffPng(squarePng(90, 100, 10, 10), base);
    expect(r).toMatchObject({
      sizeMismatch: true,
      mismatchRatio: 1,
      diff: null,
    });
  });
});

describe("compareDir / writeBaselines", () => {
  let root: string;
  const platform = "ios" as const;
  const dirs = () => ({
    actualDir: join(root, "actual"),
    baselineDir: join(root, "baselines", platform),
    outDir: join(root, "out"),
    manifestPath: join(root, "baselines", "manifest.json"),
  });

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "visual-diff-"));
    mkdirSync(dirs().actualDir, { recursive: true });
    mkdirSync(dirs().baselineDir, { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("fails with missing-baseline when no reference exists", () => {
    writeFileSync(join(dirs().actualDir, "login.png"), base);
    const r = compareDir({
      platform,
      ...dirs(),
      manifest: loadManifest(dirs().manifestPath),
      runtimeId: "rt-1",
    });
    expect(r.rows).toEqual([
      {
        screen: "login",
        ratio: 1,
        tolerance: 0.005,
        status: "missing-baseline",
      },
    ]);
    expect(r.failures[0]).toMatch(/login: no baseline/);
  });

  it("writes baselines and pins the runtime, then passes an identical rerun", () => {
    writeFileSync(join(dirs().actualDir, "login.png"), base);
    const copied = writeBaselines({ platform, ...dirs(), runtimeId: "rt-1" });
    expect(copied).toEqual([join(dirs().baselineDir, "login.png")]);
    const manifest = loadManifest(dirs().manifestPath);
    expect(manifest.runtime.ios).toBe("rt-1");

    const r = compareDir({ platform, ...dirs(), manifest, runtimeId: "rt-1" });
    expect(r.failures).toEqual([]);
    expect(r.rows[0]).toMatchObject({
      screen: "login",
      ratio: 0,
      status: "pass",
    });
    expect(existsSync(join(dirs().outDir, "login.diff.png"))).toBe(true);
  });

  it("fails a shifted screenshot above tolerance and passes it under a manifest override", () => {
    writeFileSync(join(dirs().actualDir, "login.png"), base);
    writeBaselines({ platform, ...dirs(), runtimeId: "rt-1" });
    writeFileSync(join(dirs().actualDir, "login.png"), shifted);

    const strict = compareDir({
      platform,
      ...dirs(),
      manifest: loadManifest(dirs().manifestPath),
      runtimeId: "rt-1",
    });
    expect(strict.rows[0].status).toBe("fail");
    expect(strict.failures[0]).toMatch(
      /login: [0-9.]+% mismatched > 0.50% tolerance/,
    );

    const manifest = loadManifest(dirs().manifestPath);
    manifest.screens.login = { tolerance: 0.05, reason: "test override" };
    const loose = compareDir({
      platform,
      ...dirs(),
      manifest,
      runtimeId: "rt-1",
    });
    expect(loose.rows[0]).toMatchObject({ status: "pass", tolerance: 0.05 });
  });

  it("fails loudly on a runtime mismatch without comparing any screen", () => {
    writeFileSync(join(dirs().actualDir, "login.png"), base);
    writeBaselines({ platform, ...dirs(), runtimeId: "rt-1" });
    const r = compareDir({
      platform,
      ...dirs(),
      manifest: loadManifest(dirs().manifestPath),
      runtimeId: "rt-2",
    });
    expect(r.rows).toEqual([]);
    expect(r.failures).toEqual([
      expect.stringMatching(/runtime mismatch: baseline rt-1, current rt-2/),
    ]);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run scripts/__tests__/visual-diff.test.ts`
Expected: FAIL — `Cannot find module '../ci/visual-diff'`

- [ ] **Step 4: Write the module**

```ts
// scripts/ci/visual-diff.ts
/**
 * Lane D visual regression: compare per-run screenshots (e2e/visual-out/<p>/)
 * against committed baselines (e2e/baselines/<p>/) with an explicit
 * mismatched-pixel tolerance, honouring e2e/baselines/manifest.json for
 * per-screen overrides and the pinned runtime per platform.
 *
 * `--write-baseline` is used ONLY by the workflow's rebaseline path, which
 * opens a PR — never run it against a local simulator.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";

export type Platform = "ios" | "android";

export interface DiffResult {
  width: number;
  height: number;
  totalPixels: number;
  mismatchedPixels: number;
  mismatchRatio: number;
  sizeMismatch: boolean;
  diff: Buffer | null;
}

export function diffPng(
  actual: Buffer,
  expected: Buffer,
  opts: { threshold?: number } = {},
): DiffResult {
  const a = PNG.sync.read(actual);
  const e = PNG.sync.read(expected);
  if (a.width !== e.width || a.height !== e.height) {
    return {
      width: a.width,
      height: a.height,
      totalPixels: a.width * a.height,
      mismatchedPixels: a.width * a.height,
      mismatchRatio: 1,
      sizeMismatch: true,
      diff: null,
    };
  }
  const diff = new PNG({ width: a.width, height: a.height });
  const mismatchedPixels = pixelmatch(
    a.data,
    e.data,
    diff.data,
    a.width,
    a.height,
    {
      threshold: opts.threshold ?? 0.1,
    },
  );
  const totalPixels = a.width * a.height;
  return {
    width: a.width,
    height: a.height,
    totalPixels,
    mismatchedPixels,
    mismatchRatio: totalPixels === 0 ? 0 : mismatchedPixels / totalPixels,
    sizeMismatch: false,
    diff: PNG.sync.write(diff),
  };
}

export interface Manifest {
  defaultTolerance: number;
  runtime: Partial<Record<Platform, string>>;
  screens: Record<string, { tolerance?: number; reason?: string }>;
}

export function loadManifest(manifestPath: string): Manifest {
  if (!fs.existsSync(manifestPath)) {
    return { defaultTolerance: 0.005, runtime: {}, screens: {} };
  }
  const raw = JSON.parse(
    fs.readFileSync(manifestPath, "utf8"),
  ) as Partial<Manifest>;
  return {
    defaultTolerance: raw.defaultTolerance ?? 0.005,
    runtime: raw.runtime ?? {},
    screens: raw.screens ?? {},
  };
}

function pngNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort();
}

const pct = (r: number) => `${(r * 100).toFixed(2)}%`;

export function compareDir(opts: {
  platform: Platform;
  actualDir: string;
  baselineDir: string;
  outDir: string;
  manifest: Manifest;
  runtimeId: string;
}) {
  const rows: Array<{
    screen: string;
    ratio: number;
    tolerance: number;
    status: "pass" | "fail" | "missing-baseline" | "size-mismatch";
  }> = [];
  const failures: string[] = [];

  const pinned = opts.manifest.runtime[opts.platform];
  if (pinned && pinned !== opts.runtimeId) {
    failures.push(
      `runtime mismatch: baseline ${pinned}, current ${opts.runtimeId} — the runner image changed; dispatch with rebaseline=true and review the PR`,
    );
    return { rows, failures };
  }

  fs.mkdirSync(opts.outDir, { recursive: true });
  const actuals = pngNames(opts.actualDir);
  if (actuals.length === 0)
    failures.push(`no screenshots found under ${opts.actualDir}`);

  for (const file of actuals) {
    const screen = file.replace(/\.png$/, "");
    const tolerance =
      opts.manifest.screens[screen]?.tolerance ??
      opts.manifest.defaultTolerance;
    const baselinePath = path.join(opts.baselineDir, file);
    if (!fs.existsSync(baselinePath)) {
      rows.push({ screen, ratio: 1, tolerance, status: "missing-baseline" });
      failures.push(
        `${screen}: no baseline at ${baselinePath} — dispatch with rebaseline=true`,
      );
      continue;
    }
    const r = diffPng(
      fs.readFileSync(path.join(opts.actualDir, file)),
      fs.readFileSync(baselinePath),
    );
    if (r.diff)
      fs.writeFileSync(path.join(opts.outDir, `${screen}.diff.png`), r.diff);
    if (r.sizeMismatch) {
      rows.push({ screen, ratio: 1, tolerance, status: "size-mismatch" });
      failures.push(
        `${screen}: size mismatch (${r.width}x${r.height} vs baseline) — a different device or orientation`,
      );
      continue;
    }
    const status = r.mismatchRatio > tolerance ? "fail" : "pass";
    rows.push({ screen, ratio: r.mismatchRatio, tolerance, status });
    if (status === "fail") {
      failures.push(
        `${screen}: ${pct(r.mismatchRatio)} mismatched > ${pct(tolerance)} tolerance`,
      );
    }
  }
  return { rows, failures };
}

export function writeBaselines(opts: {
  platform: Platform;
  actualDir: string;
  baselineDir: string;
  manifestPath: string;
  runtimeId: string;
}): string[] {
  fs.mkdirSync(opts.baselineDir, { recursive: true });
  const copied: string[] = [];
  for (const file of pngNames(opts.actualDir)) {
    const dest = path.join(opts.baselineDir, file);
    fs.copyFileSync(path.join(opts.actualDir, file), dest);
    copied.push(dest);
  }
  const manifest = loadManifest(opts.manifestPath);
  manifest.runtime[opts.platform] = opts.runtimeId;
  fs.mkdirSync(path.dirname(opts.manifestPath), { recursive: true });
  fs.writeFileSync(opts.manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  return copied;
}

export function renderSummary(
  platform: Platform,
  result: ReturnType<typeof compareDir>,
): string {
  const ok = result.failures.length === 0;
  const lines = [
    `### Visual regression (${platform}) — ${ok ? "✅ within tolerance" : "❌ DRIFT"}`,
    "",
    "| Screen | Mismatch | Tolerance | Status |",
    "|---|---|---|---|",
    ...result.rows.map(
      (r) =>
        `| ${r.screen} | ${pct(r.ratio)} | ${pct(r.tolerance)} | ${r.status} |`,
    ),
  ];
  for (const f of result.failures) lines.push("", `- ❌ ${f}`);
  return lines.join("\n") + "\n";
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main(): void {
  const platform = arg("--platform") as Platform | undefined;
  const runtimeId = arg("--runtime");
  if (!platform || !["ios", "android"].includes(platform) || !runtimeId) {
    console.error(
      "usage: visual-diff --platform ios|android --runtime <id> [--actual-dir] [--baseline-dir] [--out-dir] [--manifest] [--write-baseline]",
    );
    process.exit(2);
  }
  const actualDir = arg("--actual-dir") ?? `e2e/visual-out/${platform}`;
  const baselineDir = arg("--baseline-dir") ?? `e2e/baselines/${platform}`;
  const outDir = arg("--out-dir") ?? `e2e/visual-diff/${platform}`;
  const manifestPath = arg("--manifest") ?? "e2e/baselines/manifest.json";

  if (process.argv.includes("--write-baseline")) {
    const copied = writeBaselines({
      platform,
      actualDir,
      baselineDir,
      manifestPath,
      runtimeId,
    });
    console.log(
      `wrote ${copied.length} baseline(s) for ${platform}; runtime pinned to ${runtimeId}`,
    );
    process.exit(copied.length > 0 ? 0 : 1);
  }

  const result = compareDir({
    platform,
    actualDir,
    baselineDir,
    outDir,
    manifest: loadManifest(manifestPath),
    runtimeId,
  });
  const summary = renderSummary(platform, result);
  process.stdout.write(summary);
  if (process.env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  process.exit(result.failures.length === 0 ? 0 : 1);
}

if (process.argv[1] && /visual-diff\.(ts|js)$/.test(process.argv[1])) {
  main();
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run scripts/__tests__/visual-diff.test.ts`
Expected: PASS (8 tests). If `import pixelmatch from "pixelmatch"` fails type-checking, `@types/pixelmatch` is redundant with the package's own types — remove `@types/pixelmatch` and re-run.

- [ ] **Step 6: Commit**

```bash
git add scripts/ci/visual-diff.ts scripts/__tests__/visual-diff.test.ts package.json package-lock.json .gitignore
git commit -m "ci(visual): pixelmatch diff step with manifest tolerances, runtime pin, and baseline writer

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The Login visual flow and the per-flow runner script

**Files:**

- Create: `e2e/flows/visual/login.yaml`
- Create: `scripts/ci/visual-run.sh`

**Interfaces:**

- Consumes: `e2e/helpers/launch-app.yaml`, `e2e/helpers/ensure-logged-out.yaml` (existing; the Login screen's own furniture is `"Welcome!"`, `id: input-username`, `id: input-password` per `e2e/flows/auth/login.yaml`).
- Produces: `e2e/visual-out/<PLATFORM>/login.png`. `scripts/ci/visual-run.sh <ios|android>` runs every `e2e/flows/visual/*.yaml` one file at a time (Lane E appends a `maestro hierarchy` dump after each), exits non-zero if any flow fails, and always leaves whatever screenshots were taken in place.

- [ ] **Step 1: Write the flow**

```yaml
# e2e/flows/visual/login.yaml
appId: com.ocrecipes.app
name: "Visual - Login"
# `visual`, NOT `regression`: these run via scripts/ci/visual-run.sh after the
# retry-wrapped regression pass, so the regression tag set is unchanged.
tags:
  - visual
env:
  PLATFORM: ${PLATFORM}
---
- runFlow: ../../helpers/launch-app.yaml
- runFlow: ../../helpers/ensure-logged-out.yaml
- assertVisible: "Welcome!"
- assertVisible:
    id: "input-username"
# Settle before capture: the mode-switch splash flash and keyboard animations
# are the two sources of frame-to-frame noise on this screen.
- waitForAnimationToEnd:
    timeout: 5000
# Path is relative to the workspace (the repo root, where maestro test runs).
- takeScreenshot: e2e/visual-out/${PLATFORM}/login.png
```

- [ ] **Step 2: Write the runner script**

```bash
#!/usr/bin/env bash
# scripts/ci/visual-run.sh <ios|android>
# Runs each visual flow INDIVIDUALLY (not `--include-tags visual` over the
# directory) so the app is left on the captured screen after each flow —
# Lane E dumps the accessibility hierarchy at exactly that moment.
# Exits non-zero if any flow failed, after running all of them.
set -uo pipefail
PLATFORM="${1:?usage: visual-run.sh <ios|android>}"
: "${USERNAME:?USERNAME env required (seeded E2E user)}"
: "${PASSWORD:?PASSWORD env required}"
OUT="e2e/visual-out/$PLATFORM"
DEBUG_OUT="e2e/maestro-output"
mkdir -p "$OUT" "$DEBUG_OUT"
failed=0
for flow in e2e/flows/visual/*.yaml; do
  name="$(basename "$flow" .yaml)"
  echo "::group::visual flow $name ($PLATFORM)"
  if maestro test -e "USERNAME=$USERNAME" -e "PASSWORD=$PASSWORD" -e "PLATFORM=$PLATFORM" \
      --debug-output "$DEBUG_OUT" --flatten-debug-output "$flow"; then
    echo "captured $OUT/$name.png"
  else
    echo "::error::visual flow $name failed on $PLATFORM"
    failed=1
  fi
  # Lane E (a11y sweep) appends the hierarchy dump here — see plan E Task 1.
  echo "::endgroup::"
done
ls -la "$OUT" || true
exit "$failed"
```

```bash
chmod +x scripts/ci/visual-run.sh
```

- [ ] **Step 3: Local smoke (iOS simulator on the developer machine — evidence only, never a baseline)**

With the backend and Metro running as for any E2E session (`npm run server:dev`, `npx expo run:ios`), and the seed user present:

```bash
USERNAME=demo PASSWORD=demo123 bash scripts/ci/visual-run.sh ios && ls -la e2e/visual-out/ios/
```

Expected: `login.png` exists. Do not copy it anywhere under `e2e/baselines/`.

- [ ] **Step 4: Commit**

```bash
git add e2e/flows/visual/login.yaml scripts/ci/visual-run.sh
git commit -m "e2e(visual): Login screenshot flow and per-flow visual runner

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Workflow — `rebaseline` input, iOS and Android steps

**Files:**

- Modify: `.github/workflows/e2e-regression.yml` — `workflow_dispatch` (line 61); iOS job after `Run Maestro regression flows` (line ~518) and its `Upload logs` step; Android job's emulator `script:` block (lines ~656–663) and its `Upload logs` step.

**Interfaces:**

- Consumes: `IOS_SIMULATOR_UDID` (already exported by the `Boot iOS simulator` step, line 355); `scripts/ci/visual-run.sh`; `npm run visual:diff`.
- Produces: env `IOS_RUNTIME_ID`; files `e2e/visual-out/android/runtime.txt`; artefacts `visual-ios`, `visual-android` (screenshots + diffs), and in rebaseline mode `visual-baseline-ios`, `visual-baseline-android` (screenshots + `runtime.txt`) for Task 4's job.

- [ ] **Step 1: Add the dispatch input**

```yaml
workflow_dispatch:
  inputs:
    rebaseline:
      description: "Visual: capture fresh baselines on both platforms and open a PR (no diff)"
      required: false
      default: false
      type: boolean
```

- [ ] **Step 2: iOS job — insert after `Run Maestro regression flows`**

```yaml
# ── Lane D: visual regression ────────────────────────────────────────
# Freeze the status bar so the clock/battery/signal never diff. Uses the
# UDID the boot step exported (a name lookup is ambiguous across runtimes).
- name: Freeze iOS status bar
  if: always()
  run: |
    xcrun simctl status_bar "$IOS_SIMULATOR_UDID" override \
      --time "9:41" --dataNetwork wifi --wifiMode active --wifiBars 3 \
      --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100

# The runtime is the pin: e2e/baselines/manifest.json records it at
# rebaseline time and visual-diff fails loudly when it changes, so an
# Xcode/runtime bump on the runner image cannot masquerade as UI drift.
- name: Record iOS runtime
  if: always()
  run: |
    set -euo pipefail
    IOS_RUNTIME_ID="$(xcrun simctl list devices -j | node -e '
      const data = JSON.parse(require("fs").readFileSync(0, "utf8"));
      const udid = process.env.IOS_SIMULATOR_UDID;
      for (const [runtime, devices] of Object.entries(data.devices)) {
        if (devices.some((d) => d.udid === udid)) { console.log(runtime); process.exit(0); }
      }
      process.exit(1);
    ')"
    echo "IOS_RUNTIME_ID=$IOS_RUNTIME_ID" >> "$GITHUB_ENV"
    echo "iOS runtime: $IOS_RUNTIME_ID"

- name: Run visual flows (iOS)
  if: always()
  run: bash scripts/ci/visual-run.sh ios

- name: Visual diff (iOS)
  if: ${{ always() && !inputs.rebaseline }}
  run: npm run --silent visual:diff -- --platform ios --runtime "$IOS_RUNTIME_ID"

- name: Stage iOS baselines for the rebaseline PR
  if: ${{ always() && inputs.rebaseline }}
  run: echo "$IOS_RUNTIME_ID" > e2e/visual-out/ios/runtime.txt

- name: Upload visual artefacts (iOS)
  if: always()
  uses: actions/upload-artifact@v7
  with:
    name: visual-ios
    path: |
      e2e/visual-out/ios/
      e2e/visual-diff/ios/
    if-no-files-found: warn

- name: Upload iOS baseline candidates
  if: ${{ always() && inputs.rebaseline }}
  uses: actions/upload-artifact@v7
  with:
    name: visual-baseline-ios
    path: e2e/visual-out/ios/
    if-no-files-found: error
```

- [ ] **Step 3: Android job — append single lines to the emulator `script:` block, then add steps after it**

Inside the existing `reactivecircus/android-emulator-runner@v2` `script:` (each line is its own `sh -c`; keep them single-line):

```yaml
adb shell settings put global sysui_demo_allowed 1
adb shell am broadcast -a com.android.systemui.demo -e command enter
adb shell am broadcast -a com.android.systemui.demo -e command clock -e hhmm 0941
adb shell am broadcast -a com.android.systemui.demo -e command battery -e plugged false -e level 100
adb shell am broadcast -a com.android.systemui.demo -e command network -e wifi show -e level 4 -e mobile show -e datatype none -e level 4
adb shell am broadcast -a com.android.systemui.demo -e command notifications -e visible false
mkdir -p e2e/visual-out/android
adb shell getprop ro.build.fingerprint > e2e/visual-out/android/runtime.txt
bash scripts/ci/visual-run.sh android
```

(These lines go AFTER `bash scripts/ci/e2e-with-flow-retry.sh`. Because the action stops at the first failing line, put `bash scripts/ci/e2e-with-flow-retry.sh || echo REGRESSION_FAILED > e2e/regression-failed.txt` in place of the bare call so the visual lines still run, and add a final line `test ! -f e2e/regression-failed.txt` so the step's exit status is unchanged.)

After the emulator step:

```yaml
- name: Visual diff (Android)
  if: ${{ always() && !inputs.rebaseline }}
  run: npm run --silent visual:diff -- --platform android --runtime "$(cat e2e/visual-out/android/runtime.txt)"

- name: Upload visual artefacts (Android)
  if: always()
  uses: actions/upload-artifact@v7
  with:
    name: visual-android
    path: |
      e2e/visual-out/android/
      e2e/visual-diff/android/
    if-no-files-found: warn

- name: Upload Android baseline candidates
  if: ${{ always() && inputs.rebaseline }}
  uses: actions/upload-artifact@v7
  with:
    name: visual-baseline-android
    path: e2e/visual-out/android/
    if-no-files-found: error
```

- [ ] **Step 4: Validate the YAML and commit**

```bash
npx --yes yaml-lint .github/workflows/e2e-regression.yml
git add .github/workflows/e2e-regression.yml
git commit -m "ci(e2e): visual regression steps on both platforms with status-bar freeze and runtime pin

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `rebaseline-visual` job (PR from the two platforms' candidates)

**Files:**

- Modify: `.github/workflows/e2e-regression.yml` (new job after `e2e-android`, before `notify-on-failure`)

**Interfaces:**

- Consumes: artefacts `visual-baseline-ios`, `visual-baseline-android` (Task 3); `npm run visual:diff -- --write-baseline`; secret `BASELINE_PR_TOKEN`.
- Produces: a PR from `baselines/visual-<run_id>` containing only `e2e/baselines/**`.

- [ ] **Step 1: Add the job**

```yaml
# Turns rebaseline=true into a reviewable PR. Baselines are produced ONLY
# here — from the same runner image that diffs against them — never from a
# local simulator (Apple-only hardware cannot produce the Android reference
# anyway). PAT, not GITHUB_TOKEN: a GITHUB_TOKEN push/PR triggers no CI, so
# the PR would be unmergeable under branch protection.
rebaseline-visual:
  name: Open visual rebaseline PR
  needs: [e2e-ios, e2e-android]
  if: ${{ always() && inputs.rebaseline }}
  runs-on: ubuntu-latest
  permissions:
    contents: read
  steps:
    - uses: actions/checkout@v5
      with:
        ref: main
    - uses: actions/setup-node@v5
      with:
        node-version: 24
        cache: npm
    - run: npm ci
    - uses: actions/download-artifact@v5
      with:
        name: visual-baseline-ios
        path: e2e/visual-out/ios
    - uses: actions/download-artifact@v5
      with:
        name: visual-baseline-android
        path: e2e/visual-out/android
    - name: Write baselines from both platforms
      run: |
        set -euo pipefail
        rm -f e2e/visual-out/*/*.diff.png
        npm run --silent visual:diff -- --platform ios --runtime "$(cat e2e/visual-out/ios/runtime.txt)" --write-baseline
        npm run --silent visual:diff -- --platform android --runtime "$(cat e2e/visual-out/android/runtime.txt)" --write-baseline
        git status --short e2e/baselines/
    - name: Open PR
      env:
        GH_TOKEN: ${{ secrets.BASELINE_PR_TOKEN }}
      run: |
        set -euo pipefail
        branch="baselines/visual-${{ github.run_id }}"
        git config user.name "ocrecipes-baselines"
        git config user.email "baselines@users.noreply.github.com"
        git switch -c "$branch"
        git add e2e/baselines/
        git commit -m "chore(baselines): refresh visual baselines $(date -u +%F) (run ${{ github.run_id }})" \
          -m "Both platforms captured on this run's runner images; manifest.runtime pinned. Review every changed PNG before merging."
        git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/${{ github.repository }}.git"
        git push -u origin "$branch"
        gh pr create --base main --head "$branch" \
          --title "chore(baselines): refresh visual baselines $(date -u +%F)" \
          --body "Automated by e2e-regression rebaseline=true, run ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}. Only e2e/baselines/** changes. Open each PNG in the Files tab and confirm the change is intentional."
```

Also extend `notify-on-failure`'s `if:` so a rebaseline run never files an issue: `if: always() && !inputs.rebaseline && (needs.e2e-ios.result == 'failure' || needs.e2e-android.result == 'failure')`.

- [ ] **Step 2: Validate and commit**

```bash
npx --yes yaml-lint .github/workflows/e2e-regression.yml
git add .github/workflows/e2e-regression.yml
git commit -m "ci(e2e): rebaseline-visual job opens a PR with both platforms' baselines

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: D0 verification — first baselines, PR checks, stability, positive control

- [ ] **Step 1: Dispatch `E2E Regression` with `rebaseline=true`.** Expected: both platform jobs upload `visual-baseline-*`; `rebaseline-visual` opens a PR containing `e2e/baselines/ios/login.png`, `e2e/baselines/android/login.png`, `e2e/baselines/manifest.json` (with both `runtime` entries). The PR's Checks tab shows the required checks (proves the PAT). Review the two PNGs; merge.

- [ ] **Step 2: Dispatch twice more with `rebaseline=false`** (after the baseline PR merged). Expected: both runs show `Visual regression (ios|android) — ✅ within tolerance` with `login` at 0.00 %–0.50 %. Record both run URLs in the D0 PR body. If either run shows drift with no code change, the screen is not stable: the diff PNG artefact shows where; typical causes are the status bar (freeze step not applied), a keyboard, or a timing overlay — fix the flow, not the tolerance.

- [ ] **Step 3: Positive control.** On a throwaway branch, replace `e2e/baselines/ios/login.png` with a copy whose content is shifted (e.g. re-encode with a 20-px crop and pad using `node -e` and pngjs), dispatch `rebaseline=false` on that branch. Expected: `login: N% mismatched > 0.50% tolerance` and a red iOS job with `login.diff.png` in the `visual-ios` artefact. Delete the branch; record the run URL.

- [ ] **Step 4: Confirm the required-check list is unchanged** (Global Constraints): compare the branch-protection required checks before/after via the repository settings page; they must be identical.

_(D0 ends here — Tasks 1–5.)_

---

### Task 6 (D1): The remaining four screens

**Files:**

- Create: `e2e/flows/visual/onboarding-step1.yaml`, `e2e/flows/visual/home.yaml`, `e2e/flows/visual/profile-hub.yaml`, `e2e/flows/visual/plan-tab.yaml`
- Modify: `e2e/baselines/manifest.json` (per-screen overrides only if needed, with a `reason`) — via the rebaseline PR

**Interfaces:**

- Consumes: `e2e/helpers/login.yaml` (exits on Home: `"Hello.*"`); tab/screen selectors already used by the regression flows under `e2e/flows/home/`, `e2e/flows/profile/`, `e2e/flows/plan/`, `e2e/flows/onboarding/` — copy the navigation steps from those files rather than inventing selectors.

- [ ] **Step 1: Write the four flows** (same skeleton as `login.yaml`; each ends with `waitForAnimationToEnd` + `takeScreenshot: e2e/visual-out/${PLATFORM}/<screen>.png`)

```yaml
# e2e/flows/visual/home.yaml
appId: com.ocrecipes.app
name: "Visual - Home"
tags:
  - visual
env:
  USERNAME: ${USERNAME}
  PASSWORD: ${PASSWORD}
  PLATFORM: ${PLATFORM}
---
- runFlow: ../../helpers/launch-app.yaml
- runFlow:
    file: ../../helpers/login.yaml
    env:
      USERNAME: ${USERNAME}
      PASSWORD: ${PASSWORD}
- assertVisible: "Hello.*"
- waitForAnimationToEnd:
    timeout: 5000
- takeScreenshot: e2e/visual-out/${PLATFORM}/home.png
```

`profile-hub.yaml` and `plan-tab.yaml`: after the login helper, use the exact `tapOn` used by `e2e/flows/home/navigate-tabs.yaml` (or the profile/plan flows) to reach the tab, assert the tab's own furniture as those flows do, then settle and capture. `onboarding-step1.yaml`: `launch-app` → `ensure-logged-out` → the register path from `e2e/flows/onboarding/*.yaml` up to the first wizard screen (`"Get Started"` marker per `e2e/helpers/login.yaml`'s wizard-strand comment) → settle → capture. Each PR body states, per screen, why it has no AI text, relative timestamp, or live data (the exclusion rule) — if a chosen screen shows any of those, pick a different one rather than raising tolerance.

- [ ] **Step 2: Dispatch `rebaseline=true`; review and merge the PR** (eight new PNGs + manifest).

- [ ] **Step 3: Five consecutive nightly runs pixel-stable on both platforms** before closing the todo; run URLs in the PR body. Any per-screen tolerance override added to `manifest.json` carries a one-line `reason` (e.g. `"avatar gradient dithers ±0.7%"`) and never exceeds `0.02`.

- [ ] **Step 4: Commit the flows**

```bash
git add e2e/flows/visual/
git commit -m "e2e(visual): onboarding, home, profile hub, and plan tab screenshot flows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

## Considered and rejected

- **Maestro's native `assertScreenshot`** (2.2.0+; `thresholdPercentage`, `cropOn`) — zero new code, but it produces no diff image for a red night and cannot be unit-tested with a shifted fixture; the spec requires both. Revisit if Maestro adds diff artefacts.
- Baselines from the previous night's artefact — silent drift.
- Local-simulator baselines — different renderer than the diff runs against, and no Android source on Apple-only hardware.
