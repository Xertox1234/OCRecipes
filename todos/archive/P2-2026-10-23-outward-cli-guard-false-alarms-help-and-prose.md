---
title: "Outward-CLI guard: stop blocking --help calls and commands that only mention a guarded command"
status: done
priority: medium
created: 2026-10-23
updated: 2026-10-23
assignee:
labels: [harness, deferred]
github_issue:
human_led: true
---

# Outward-CLI guard: stop blocking --help calls and commands that only mention a guarded command

## Summary

About half of `guard-outward-cli.sh`'s real-world blocks are false alarms. Allow `--help`
calls and commands that only contain a guarded command's name as text, without letting
through any real publish, deploy or merge.

## Background

A 2026-10-23 harness review counted the outward-CLI blocks in the session transcripts since 2026-10-12
(796 transcript files, subagents included, each blocked tool call counted once): **23 blocks in 10
sessions**. Sorted by hand from the first 160 characters of each command:

- **11 deliberate actions, rightly gated:** production OTAs (`npm run update:production`), `gh pr merge`,
  `gh pr create`, `railway run` against production Postgres.
- **12 false alarms:**
  - 2 help calls: `railway --help … ; railway restart --help`, `railway variable delete --help`.
  - 10 commands that only mention a guarded command in their text: `python3 - <<'EOF'` heredocs editing
    memory files and `.claude/hooks/test-pr-preflight-guard.sh`, `cat >> memory.md <<'EOF'`, a
    `grep -n 'ALLOW_OUTWARD_CLI' …`, a shell variable assigned prose (`R="…"`), and scratchpad probe scripts.
- **0 accidental publishes.**

The freeze ruling's reopen criterion ("hit in real use", `docs/harness-residuals.md`) is met. The
2026-10-16 clarification limits the freeze to changes that significantly increase CI time. The hook
corpus job only runs on PRs that touch hooks, so this adds nothing to normal PRs.

Related archived todos (already analysed, frozen 2026-09-22):
`todos/archive/P2-2026-09-10-outward-cli-guard-denies-prose-naming-two-pr-verbs.md`,
`todos/archive/P3-2026-08-16-command-guards-fire-on-heredoc-prose.md`,
`todos/archive/P2-2026-09-17-out-flag-run-value-slot-swallows-the-command-word.md`.
Read them first. They record the shapes that earlier attempts got wrong.

## Acceptance Criteria

- [x] Re-run the transcript join (denied `tool_result` → its `tool_use` command) and save the 23 commands
      as a fixture corpus. Each one is labelled `deliberate` or `false-alarm`.
- [x] A help-only invocation (`<cli> … --help` / `-h`, with no other mutating clause) is allowed for the
      gated CLIs (`railway`, `eas`, `gh`).
- [x] Text that only names a guarded command is allowed: heredoc bodies fed to an interpreter, quoted
      grep patterns, and variable assignments.
- [x] All 11 deliberate commands from the corpus are still DENIED (regression rows in
      `.claude/hooks/test-guard-outward-cli.sh`).
- [x] Old-vs-new differential over the existing guard test corpus shows **zero DENY→ALLOW** outside the
      intended help/prose rows (`docs/solutions` → partial-parse / differential lessons).
- [x] Re-count after shipping: false alarms on the fixture corpus go from 12 to ≤ 2, with any residual
      recorded in `docs/harness-residuals.md`.

## Implementation Notes

- The guard is crude but total by design (`partial-parse-regresses-crude-total-safety-scanner`). Prefer
  narrow, positive allow-rules (an exact help shape, or a heredoc body after a known interpreter) over
  making the scanner smarter in general.
- `--help` allow must be clause-scoped: `railway --help; railway up` must still deny. Use
  `cmd-detect.sh`'s existing clause splitter.
- Editing this guard is refused in auto mode as self-modification. The owner turns auto mode off.

## Scope Contract

- **Mechanisms to use:** the existing clause splitter and predicates in `.claude/hooks/lib/cmd-detect.sh`;
  nothing new.
- **Files in scope:** `.claude/hooks/guard-outward-cli.sh`, `.claude/hooks/lib/cmd-detect.sh`,
  `.claude/hooks/test-guard-outward-cli.sh`, `.claude/hooks/test-cmd-detect.sh`, `docs/harness-residuals.md`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Auto mode OFF (guard self-modification).

## Risks

- A widened allow that opens a real publish path. The differential and the 11 deliberate regression rows
  are the controls.

## Updates

### 2026-10-23

- Created from the harness-effectiveness review (owner asked for todos; doing this one next session).

### 2026-10-23 (done)

- **Baseline corrected.** Joining each block to its full command (not a 160-char prefix) gave **22 real
  blocks, 12 deliberate + 10 false alarms**, not 23 = 11 + 12: one "block" was a `grep` exiting 1 on the
  guard's own source text, and the `R="…"` row was a real `gh api -X PATCH` alert dismissal (deliberate).
- **Owner ruling** narrowed the 2026-09-22 heredoc ruling to two shapes: help-only clauses and quoted
  heredocs fed to python/node. A guard-local pre-pass in `guard-outward-cli.sh` removes them before any
  check; `lib/cmd-detect.sh` is untouched (no other guard changes).
- **Result on the real corpus:** 6 of 10 false alarms now allow; all 12 deliberate actions still deny on
  their own reason; the other 4 (heredoc text written with `cat` or used as data) stay denied by ruling.
  The "≤ 2" target is replaced by this ruling's 4.
- **Evidence:** suite 1302/1302 (62 new rows incl. the 22 real commands verbatim, RED first: exactly
  the 20 allow rows failed). Old-vs-new corpus differential: 2160 rows × 4 paths, **0 verdict changes**
  (1921 deny / 239 allow), aggregate pin passes. `scripts/run-hook-tests.sh` exit 0.
- **Found on the way (pre-existing, not caused here):** a quote inside one heredoc's body desyncs the
  quote scan and hides a later command. Recorded in `docs/harness-residuals.md`, pinned KNOWN-WRONG.
- Note: the python shape is strict — `python3 -I - <<'EOF'` (an extra flag) is not it and stays visible.
