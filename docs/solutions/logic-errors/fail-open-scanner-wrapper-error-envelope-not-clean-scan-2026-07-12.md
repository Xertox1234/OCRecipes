---
title: 'Fail-open tool wrappers must not render tool failure as a clean scan (npm audit error envelope)'
track: bug
category: logic-errors
module: shared
severity: medium
tags: [audit, scanners, fail-open, npm-audit, jscpd, tooling, scripts]
symptoms: [a security/maintainability scanner summary reports 0 findings while offline or after a registry failure, a clean tool run is reported as skipped because its report file was never written, findings counts drop to zero after a tool version change with no skip note]
applies_to: [scripts/audit-scanners.ts, scripts/**/*.ts]
created: '2026-07-12'
---

## Problem

scripts/audit-scanners.ts wraps deterministic audit tools (npm audit, gitleaks, knip, jscpd, madge) with a fail-open contract: a tool that cannot run is reported 'skipped' and never blocks the audit. The first implementation parsed npm audit --json with 'report.vulnerabilities ?? {}' — but npm audit emits VALID JSON {"error": {...}} with NO vulnerabilities key on offline/registry/auth failures, so the wrapper printed 'npm-audit: 0 finding(s)': a fabricated clean security scan. The inverse confusion existed for jscpd: it may write no report file when zero duplicates are found, and an unconditional readFileSync turned a genuinely clean scan into 'skipped'.

## Symptoms

- A security/maintainability scanner summary reports 0 findings while offline or after a registry failure.
- A clean tool run is reported as skipped because its report file was never written.
- Findings counts drop to zero after a tool version change with no skip note.

## Root Cause

Nullish-coalescing defaults ('?? {}', '?? []') at the parse boundary collapse three distinct outcomes — (1) tool ran and found nothing, (2) tool ran and found issues, (3) tool never ran / errored — into indistinguishable empties.

## Solution

The parser throws on an error envelope or a missing success marker (if report.error !== undefined || report.vulnerabilities === undefined then throw 'npm audit returned an error envelope'); the runner catches and reports status 'skipped' with the reason and a stderr snippet; a clean exit code with a missing report file maps to ok-with-zero-findings only when exit status is 0.

## Prevention

Keep the three outcomes as distinct statuses in the wrapper's result type; treat '?? {}' defaults on external-tool JSON as a review smell; test at the RUNNER level with a mocked spawnSync (error envelope asserts status skipped, clean-exit-no-report asserts ok with zero findings, unparseable output asserts the skip note contains the tool's stderr) — parser-level tests alone do not prove the wrapper degrades correctly.

## Related Files

- `scripts/audit-scanners.ts` (deterministic /audit scanner CLI; runners + parsers)
- `scripts/__tests__/audit-scanners.test.ts` (runner-level fail-open tests with mocked spawnSync)

## See Also

[glob runner loops pass green on zero matches](glob-runner-loop-fails-open-count-and-fail-on-zero-2026-07-03.md)