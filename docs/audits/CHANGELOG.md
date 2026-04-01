# Audit Changelog

Append-only history of all code audits performed on this project. Each entry links to the full audit manifest with detailed findings and resolutions.

## Format

```
### YYYY-MM-DD — Audit Title
- **Trigger:** Why the audit was run
- **Manifest:** [link to manifest file]
- **Findings:** X critical, Y high, Z medium, W low
- **Resolved:** N fixed, M deferred, P false-positive
- **Commit(s):** git SHA(s) of fix commits
```

---

## 2026-03-31 — Performance & Data-Integrity Audit

- **Trigger:** Found generated images stored in DB; targeted audit for similar performance/data-integrity issues
- **Manifest:** [docs/audits/2026-03-31-performance.md](2026-03-31-performance.md)
- **Findings:** 0 critical, 2 high, 4 medium, 3 low (9 actionable, 7 dropped as below-threshold)
- **Resolved:** 9 verified, 0 deferred
- **Commit:** (pending)
- **Note:** Key fix: `transactions.receipt` was storing full IAP receipts (50-200KB+) — same class as images-in-DB. Also fixed unbounded cache growth, N+1 inserts, missing unique constraints, and orphaned data.

## 2026-03-30 — Full Audit (Round 3)

- **Trigger:** Periodic full codebase audit
- **Manifest:** [docs/audits/2026-03-30-full.md](2026-03-30-full.md)
- **Findings:** 0 critical, 1 high, 8 medium (9 actionable out of 33 raw agent findings — 24 dropped as below-threshold)
- **Resolved:** 9 verified, 0 deferred
- **Commit:** `893fcd5`
- **Note:** Fourth consecutive audit. Agents trending toward diminishing-return findings. Recommending shift to targeted audits.

## 2026-03-29 — Full Audit (Round 2)

- **Trigger:** Periodic full codebase audit (first with all 5 domains reporting)
- **Manifest:** [docs/audits/2026-03-29-full-2.md](2026-03-29-full-2.md)
- **Findings:** 0 critical, 3 high, 7 medium, 12 low (22 total)
- **Resolved:** 17 verified, 5 deferred (L1/L3/L4/L6/L7 — structural refactors)
- **Commit:** `2c18392`

## 2026-03-29 — Full Audit

- **Trigger:** Periodic full codebase audit
- **Manifest:** [docs/audits/2026-03-29-full.md](2026-03-29-full.md)
- **Findings:** 0 critical, 4 high, 10 medium, 8 low (22 total)
- **Resolved:** 20 verified, 1 deferred (M7 — JSONB validation), 1 false-positive (L4 — sequential loop)
- **Commit:** `4a50a06` fix: resolve full audit findings (20 verified, 1 deferred)
- **Note:** Architecture and code-quality agents hit rate limits (3/5 domains reported)

## 2026-03-27 — Full Audit

- **Trigger:** Full codebase audit across all domains
- **Manifest:** [docs/audits/2026-03-27-full.md](2026-03-27-full.md)
- **Findings:** 0 critical, 6 high, 14 medium, 10 low (30 total)
- **Resolved:** 0 fixed, 30 deferred (all tracked in `todos/001-030`)
- **Note:** Code quality agent hit rate limit; findings from 4/5 domains (security, performance, data-integrity, architecture)

## 2026-03-27 — Launch Readiness Audit (Round 2)

- **Trigger:** Second-pass audit after first round left unfixed items
- **Manifest:** No structured manifest (pre-workflow). Findings tracked in conversation only.
- **Findings:** 3 critical, 9 high, 7 medium, 1 low (net-new after dedup)
- **Resolved:** 11 fixed, 0 deferred, 0 false-positive
- **Commit:** `0a6c43c` fix: resolve verified audit findings with per-fix test verification

## 2026-03-27 — Launch Readiness Audit (Round 1)

- **Trigger:** Pre-launch readiness check
- **Manifest:** No structured manifest (pre-workflow). Findings were in agent output.
- **Findings:** ~30+ across 5 domains (security, performance, data, architecture, quality)
- **Resolved:** ~15 fixed, 3 deferred to todos, ~12 silently dropped (root cause of round 2)
- **Commits:** `cb1fc6a`..`16f8d6f` (6 commits)
- **Lesson:** Bulk fix without per-item verification led to incomplete resolution. This triggered creation of the structured audit workflow.
