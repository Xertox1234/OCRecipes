---
title: 'A failed CI test shard may be a Docker Hub service-container pull timeout, not a test failure'
track: knowledge
category: best-practices
module: server
tags: [ci, github-actions, docker, postgres, test-flake, rerun, diagnosis]
applies_to: [.github/workflows/ci.yml]
created: '2026-06-25'
---

# A failed CI test shard may be a Docker Hub service-container pull timeout, not a test failure

## When this applies

A required `Tests (shard N/3)` check goes red in CI while:

- the same suite passes locally under `npm run preflight` (full CI parity), and
- the other shards and every other required check are green, and
- the diff is unrelated or trivial (e.g. a behavior-neutral dead-code deletion).

Before assuming a code regression or a flaky test, confirm whether the job actually
reached the test runner — or died provisioning its database.

## Smell patterns

- Exactly one shard red, the other shards green, on a change that could not plausibly
  break only that shard.
- "Passed locally + pre-commit staged gate green, fails in CI" with no obvious cause.
- An armed auto-merge stuck `BLOCKED` on a single failing check.

## Why

GitHub Actions provisions the `postgres:16` **service container** by pulling it from
Docker Hub (`registry-1.docker.io`) **before any test runs**. Docker Hub throttles /
times out intermittently. When the pull fails its retries, the job errors at the
*"Starting postgres service container"* step and is marked **failed** — but zero test
code executed. In the checks UI this is indistinguishable from a test failure (just
`fail`), so it is easily misdiagnosed as a flaky test or a regression from your diff,
sending you to "fix" code that was never broken.

This is a **different failure mode** from the repo's CPU-contention test flake (handled
globally by Vitest `retry:2`): that one is a real test that flakes and passes on rerun;
this one never reaches the runner at all, so `retry:2` cannot help it — only re-pulling
the image (a job rerun) can.

## Examples

Diagnose — inspect ONLY the failed step log (never dump the whole workflow):

```bash
npm run ci:failed-logs -- <run-id>
```

The tell is in the `Starting postgres service container` group:

```
/usr/bin/docker pull postgres:16
Error response from daemon: Get "https://registry-1.docker.io/v2/": context deadline exceeded
##[warning]Docker pull failed with exit code 1, back off 5.811 seconds before retry.
... (3 attempts) ...
##[error]Docker pull failed with exit code 1
```

Fix — re-run ONLY the failed job. Do **not** touch code, do **not** chase test/mock
lifecycle:

```bash
gh run rerun <run-id> --failed
```

If auto-merge is armed (`gh pr merge --auto --squash`), it re-evaluates and squash-merges
automatically once the rerun is green — no re-push, no re-review.

## Exceptions

- If the failed-step log shows actual **test assertions** failing (not the `docker pull`
  step), it is a real failure — debug the test, do not blind-rerun.
- If the pull keeps failing across multiple reruns, it may be a genuine Docker Hub outage
  or a sustained rate-limit (check status) rather than a transient blip.

## Related Files

- `.github/workflows/ci.yml` — the `Tests` job and its `postgres` service container.
- `scripts/ci-failed-logs.sh` — backs `npm run ci:failed-logs` (scoped failed-step log
  extraction).
