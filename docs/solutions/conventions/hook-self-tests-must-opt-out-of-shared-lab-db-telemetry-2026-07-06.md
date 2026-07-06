---
title: A hook that gains shared-lab-DB telemetry must default its OWN and every OTHER hook self-test to opt out
track: knowledge
category: conventions
module: shared
tags: [pg-lab, testing, hooks, test-isolation, shared-db, ocrecipes_lab]
applies_to: [.claude/hooks/test-*.sh]
created: '2026-07-06'
---

# A hook that gains shared-lab-DB telemetry must default its OWN and every OTHER hook self-test to opt out

## Rule

When a Claude Code hook (`.claude/hooks/*.sh`) gains a tail call that writes to the shared,
persistent `ocrecipes_lab` PG Lab database (e.g. a fail-silent usage-telemetry logger), the
hook's **kill-switch environment variable** (the one that disables that logging path) must be
exported near the top of **every** existing `.claude/hooks/test-*.sh` file that invokes that
hook — not added ad hoc to a handful of call sites. Any **new** test that deliberately
exercises the logging-enabled path must point the hook at a **throwaway, per-PID database**
(created via `scripts/pg-lab/init.sh` under a unique name, dropped in the test's own cleanup),
never the developer's real shared `ocrecipes_lab`.

## When this applies

- A hook already covered by a `.claude/hooks/test-*.sh` self-test suite gains a NEW tail call
  that writes to `ocrecipes_lab` (or any other PG Lab database).
- Any hook self-test that wants to verify the logging-enabled ("on") behavior specifically,
  as opposed to the off/kill-switch or DB-unreachable behaviors.

## Why

`ocrecipes_lab` tables under PG Lab's design rail are **append-only event ledgers, never
pruned programmatically** (see `scripts/pg-lab/schema/*.sql` header comments) — by design,
nothing in the harness ever deletes old rows; a human prunes it if it ever needs pruning. A
hook self-test suite runs dozens of times per session (every `preflight`, every manual
`scripts/run-hook-tests.sh`, every ad hoc `bash .claude/hooks/test-*.sh` during development)
and typically fires the hook under test 20-50+ times with synthetic inputs. Without an
opt-out default, EVERY one of those runs also fires the real telemetry tail call — against
the SAME database a human developer's actual Claude Code sessions log into — permanently
mixing synthetic test noise into the corpus that `scripts/pg-lab/injection-report.sh` (or
any other PG Lab reporting script) analyzes. There is no test marker field to filter it back
out after the fact. Caught in code review: one hook's self-test suite (52 invocations, no
opt-out) inserted 114 rows of test noise (`session_id=''`, real-looking synthetic project
paths) into a developer's real local `ocrecipes_lab.harness.injection_log` in a single run,
while a SIBLING test file for a second hook touched by the same todo correctly had the
opt-out — the inconsistency itself is the failure mode: it is easy to remember for the file
you're actively editing and forget for a pre-existing sibling test file the same PR silently
starts exercising.

## Examples

```bash
# .claude/hooks/test-some-hook.sh — near the top, before any test cases:
export PATTERN_INJECT_NO_LOG=1   # (or whatever kill-switch env var the hook defines)

# ... 50 existing test cases below, unmodified, never touch the real ocrecipes_lab ...

# A NEW test case that specifically wants to verify the "logging on" path:
LOG_TEST_DB="pg_lab_sometest_$$"
LOG_TEST_URL="postgresql://localhost/$LOG_TEST_DB"
if command -v psql >/dev/null 2>&1 && psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
  LAB_DATABASE_URL="$LOG_TEST_URL" bash scripts/pg-lab/init.sh >/dev/null 2>&1
  # ... apply the relevant scripts/pg-lab/schema/*.sql, run the "on" case against
  #     LOG_TEST_URL (NOT PATTERN_INJECT_NO_LOG=1), assert, then:
  psql -X -q -d postgres -c "DROP DATABASE IF EXISTS \"$LOG_TEST_DB\"" >/dev/null 2>&1
fi
```

## Exceptions

- A **brand-new** hook self-test file written specifically to unit-test the logger script
  itself (e.g. `.claude/hooks/test-pg-lab-log-injection.sh`) already uses a throwaway per-PID
  DB for its entire suite by construction — there is no pre-existing "real usage" call site
  to retrofit, so there is nothing to opt out of.
- If a hook has NO kill-switch env var yet (this is the first telemetry tail call added to
  it), adding one is part of the same change that adds the logging — see the paired solution
  [bash `read` collapses tab-delimited empty fields and skips a final line with no trailing newline](../logic-errors/bash-read-tab-ifs-collapse-and-trailing-newline-strip-2026-07-06.md)
  for the accompanying line-format pitfalls in building that kind of logging tail call.

## Related Files

- `.claude/hooks/test-inject-patterns.sh` — `export PATTERN_INJECT_NO_LOG=1` added near the
  top; a dedicated on/off/DB-down test added using a throwaway per-PID DB for the "on" case
- `.claude/hooks/test-session-recent-issues.sh` — same throwaway-DB pattern for its own
  logging-on test case
- `scripts/pg-lab/init.sh` — creates the throwaway per-PID database used by the "on" case
- `scripts/pg-lab/schema/injection-log.sql` — the append-only, never-pruned table this
  convention protects from test noise

## See Also

- [bash `read` collapses tab-delimited empty fields and skips a final line with no trailing newline](../logic-errors/bash-read-tab-ifs-collapse-and-trailing-newline-strip-2026-07-06.md) — the line-format bugs found in the same telemetry tail call this convention protects the test suite around
- [Agent worktree isolation](../best-practices/agent-worktree-isolation-2026-05-16.md) — a related "don't let test/dev-tooling activity pollute shared state" concern, at the git-worktree layer instead of the DB layer
