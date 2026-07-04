<!-- Filename: P3-2026-07-03-drift-family-hook-consolidation.md -->

---

title: "Consolidate the drift-family hooks (3 warn-only hooks defending one scenario)"
status: done
priority: low
created: 2026-07-03
updated: 2026-07-03
assignee:
labels: [deferred, harness]
github_issue:

---

# Consolidate the drift-family hooks (3 warn-only hooks defending one scenario)

## Summary

Three hooks — `drift-detect.sh`, `drift-detect-update.sh`, `guard-concurrent-session.sh` —
all fire on every `Bash` call, are all warn-only, and all defend a single scenario: the user
editing in a parallel terminal against the same checkout. Consolidate them down to fewer.
From the 2026-07-02 harness audit (`docs/research/2026-07-02-harness-audit.md`, CONSOLIDATE #4).

## Background

Current wiring (verified in `.claude/settings.json` 2026-07-03):

- `drift-detect.sh` — **PreToolUse / Bash** — warns (never blocks) if HEAD advanced externally
  since Claude's last recorded git op.
- `drift-detect-update.sh` — **PostToolUse / Bash** — records HEAD after each git op; this is
  the state-writer that `drift-detect` reads.
- `guard-concurrent-session.sh` — **PreToolUse / Bash** — warns about a concurrent Claude
  session operating in the same checkout.

The audit measured ~208 hook lines + ~414 test lines (`test-drift-detect.sh` 6.3KB +
`test-guard-concurrent-session.sh` 6.9KB) sustaining this one warn-only scenario, and each
hook's own message already says the durable fix is worktree isolation
(`superpowers:using-git-worktrees`). Three hooks running file IO on **every** Bash call to
emit a warning the user usually already knows is a poor effort/leverage ratio.

## Acceptance Criteria

- [ ] Decide the target shape and record it in this file: (a) fold `guard-concurrent-session`
      into the drift pair (one detector + one state-writer that also covers the
      concurrent-session case), or (b) delete the lowest-signal of the three if its warning is
      subsumed by the others — keeping the detector + updater pair intact.
- [ ] Net reduction from 3 hooks toward 1–2, with the parallel-terminal / external-HEAD warn
      behavior preserved (it must still WARN, never block).
- [ ] `.claude/settings.json` PreToolUse/PostToolUse `Bash` wiring updated to match — no dead
      hook entries left pointing at deleted scripts.
- [ ] The corresponding `test-*.sh` files merged or removed; the survivors pass under the
      full-preflight hook-test loop (`scripts/preflight.sh:98`).
- [ ] The remaining hook's warn message points to `superpowers:using-git-worktrees` as the
      durable fix.
- [ ] `npm run preflight` green.

## Implementation Notes

- Files in scope: `.claude/hooks/drift-detect.sh`, `.claude/hooks/drift-detect-update.sh`,
  `.claude/hooks/guard-concurrent-session.sh`, their `test-*.sh`, and `.claude/settings.json`.
- `drift-detect` (Pre) + `drift-detect-update` (Post) are a matched detector/state-writer pair;
  merging _those two_ is awkward across the Pre/Post boundary. The cleaner consolidation target
  is folding or dropping `guard-concurrent-session`, whose signal overlaps the drift detector.
- Executor note: touches `.claude/hooks/` → `todo-automerge-guard.sh` will correctly HOLD it
  for individual review (never batch-merge).

## Dependencies

- None. Independent of the other harness todos (does not share files with them).

## Risks

- These are low-value warn-only hooks to begin with — don't spend more effort than the
  consolidation saves.
- Don't regress `drift-detect`'s false-positive tuning: it keys on Claude's _last-recorded_
  HEAD, so the merged hook must preserve the same state-file contract.

## Updates

### 2026-07-03

- Initial creation. Filed from the 2026-07-02 harness audit (CONSOLIDATE #4), which was
  executed only partially by PRs #487–#490 (the CUT list + roster consolidation); this
  consolidation item was not picked up.

### 2026-07-03 — Decision & implementation

- **Target shape chosen: option (b)** — delete the lowest-signal hook
  `guard-concurrent-session.sh` (and its `test-guard-concurrent-session.sh`), keeping the
  matched `drift-detect.sh` (Pre) + `drift-detect-update.sh` (Post) detector/state-writer
  pair intact. Net reduction **3 → 2 hooks**.
- Rationale: `guard-concurrent-session` is warn-only / fail-open and only fires when a
  **second live Claude session** is active in the **same** un-isolated checkout — a case
  already **enforced** against by `guard-worktree-isolation.sh` (Edit/Write) and caught
  reactively (once HEAD actually moves) by `drift-detect.sh`. Its provenance todo
  (`P2-2026-06-26-parallel-agent-git-churn-shared-worktree`) confirms it was the softest of
  that work's deliverables. Folding its heartbeat-lease mechanism into the Pre-only,
  SHA-baseline `drift-detect` (option a) would mix two mechanisms for a low-value warn — the
  Risk note warns against that effort.
- `drift-detect.sh`'s warn message now carries the durable-fix nudge to
  `superpowers:using-git-worktrees` (it previously lived only in the deleted hook), asserted
  by a new case in `test-drift-detect.sh`.
- `.claude/settings.json` PreToolUse/Bash wiring updated — the `guard-concurrent-session`
  entry removed, no dead hook pointers remain.
- Collateral: `docs/solutions/code-quality/cksum-hash-key-differs-gnu-bsd-use-field-1-2026-06-26.md`
  referenced the deleted hook pair as its only `## Related Files` example; repointed to note
  the example was consolidated away (the `cksum` field-1 snippet stays inline in `## Solution`).
