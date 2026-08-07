---
title: A verification that scans ZERO inputs is green and meaningless — assert the count, not just the exit code
track: bug
category: code-quality
module: shared
severity: medium
tags: [testing, harness, verification, false-negative, vitest, path-resolution, macos, scripts]
applies_to: [scripts/__tests__/**/*.test.ts, scripts/**/*.js, client/**/__tests__/**/*.test.ts, server/**/__tests__/**/*.test.ts]
symptoms: [A guard test passes but the guard never saw the fixture, "OK in 0 file(s)" in a passing run, A path-scoped tool silently filters every input away, A test asserting only status === 0 stays green after the code under test is disabled]
created: '2026-08-07'
---

# A verification that scans ZERO inputs is green and meaningless — assert the count, not just the exit code

## Problem

A test asserts a tool's **exit code** but never that the tool actually processed anything. A
tool that filters all its inputs away exits 0 and reports success, so the test passes while
verifying nothing. Every "the tool accepts this input" test is vacuous unless it also pins that the
input survived to be examined.

## Symptoms

- `expect(status).toBe(0)` passes after you deliberately break the code under test.
- Output contains a suffix like `in 0 file(s)` / `0 matched` / `0 rows` on a green run.
- A negative assertion (`expect(out).not.toMatch(/warning/)`) passes trivially because there was no
  output at all.

## Root Cause

`scripts/check-rules-file-size.js` resolves its repo root from its own location
(`path.resolve(__dirname, "..")`) and only accepts paths under `docs/rules/`. Its test builds a fake
repo in a temp dir and copies the script into `<tmp>/scripts/` so `<tmp>/docs/rules/` lands in scope.

On macOS `os.tmpdir()` returns `/var/folders/...`, but the copied script resolves its own path
through the symlink to `/private/var/folders/...`. So `path.relative(repoRoot, target)` produced
`../../../var/folders/...`, which fails `startsWith("docs/rules/")` — **every fixture was filtered
out**. The run printed `✓ rules file sizes OK in 0 file(s)` and exited 0.

Three tests asserted only `status === 0` plus the *absence* of an advisory. All three passed over
an empty scan. They would not have caught the symlink bug at all, and would not catch a future
regression in scope resolution either.

```ts
// Vacuous — satisfied by a run that examined nothing.
const root = makeRepo({ "small.md": 3000 });
const { status, out } = run(root);
expect(status).toBe(0);
expect(out).not.toMatch(/approaching/i);
```

## Solution

Two parts. Fix the path resolution, **and** make the tests refuse to pass over an empty scan.

```ts
// 1. realpath the temp root so it matches how the tool resolves its own location.
const root = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "rules-size-")),
);

// 2. Assert the fixture was actually SCANNED, in every test — including the
//    ones whose point is that nothing happens.
expect(out).toContain("OK in 1 file(s)");
expect(out).not.toMatch(/approaching/i);
```

Where the tool prints a computed value, prefer asserting that value over a bare count — it proves
the scan *and* the arithmetic in one assertion:

```ts
// At exactly the cap: still a pass, and headroom must be exactly 0.
expect(out).toContain(", 0 B left");
```

Verify by mutation: break the scope filter (`rel.startsWith("docs/rules/")` → `false`) and confirm
the suite goes red. Before the fix it stayed green.

## Prevention

- Any tool that **filters** its inputs (path scope, glob, allowlist, `existsSync`) needs its filter
  treated as a failure mode, not plumbing — a silently-empty input set is its default failure.
- Have such tools print what they processed (`OK in N file(s)`), and assert `N` in tests. A count in
  the success message is what makes the vacuity detectable at all.
- On macOS, `realpathSync` any `os.tmpdir()` path a subject resolves against — `/var` is a symlink
  to `/private/var` and the mismatch defeats prefix-based path logic silently.
- Same rule outside tests: a glob-driven loop that finds nothing should fail, not succeed quietly.

## Related Files

- `scripts/__tests__/check-rules-file-size.test.ts` — `makeRepo`'s `realpathSync` and the scan-count assertions
- `scripts/check-rules-file-size.js` — `isInScope` / `relPath`, the filter that silently emptied the set

## See Also

- [A comparison over a lossy projection reports a false match](../logic-errors/comparison-over-a-lossy-projection-reports-a-false-match-2026-08-07.md) — same session, the other way a check passes without checking
- [Probes that signal absence by empty output must also check the exit code](../logic-errors/empty-probe-output-needs-exit-code-check-2026-07-02.md)
- [git diff can never show wholly untracked files](../logic-errors/git-diff-invisible-to-untracked-files-2026-07-15.md) — verification scoped off a source that cannot see the thing
