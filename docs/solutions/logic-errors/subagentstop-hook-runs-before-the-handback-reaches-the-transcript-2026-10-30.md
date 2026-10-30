---
title: "SubagentStop can fire before the subagent's last tool call reaches its transcript — a hook that reads agent_transcript_path must poll, and a replay of the finished transcript cannot show the race"
track: bug
category: logic-errors
tags: [harness, agents, tooling, review-stamp, merge-gate]
module: shared
applies_to: [".claude/hooks/**", ".claude/agents/*.md"]
symptoms: ["A background reviewer hands back a clean, well-formed report but no review record is written", "merge-review-guard.sh denies the merge with \"no record\"", "Replaying the same transcript through review-stamp-writer.sh writes a correct clean record"]
created: 2026-10-30
severity: high
---

# SubagentStop can fire before the subagent's last tool call reaches its transcript — a hook that reads agent_transcript_path must poll, and a replay of the finished transcript cannot show the race

## Problem

Background reviewers deliver their report in a `SubagentHandback` tool call and often stop with no closing text. `review-stamp-writer.sh` (SubagentStop) then has to read the report from `agent_transcript_path`. On Claude Code 2.1.312 the hook ran **before** that hand-back entry was written:

- the transcript was readable;
- it held 0 hand-backs;
- `last_assistant_message` was `null`;
- the hand-back appeared within 3 s.

The writer found no report and exited without a record, so every clean review was denied at the merge (#1612, #1616, #1547, #1614, 2026-10-29/30). On 2.1.311 it happened only occasionally (1 of 8 in one session).

## Symptoms

- No record under `/tmp/ocrecipes-review-stamps-<key>/<sha>/`, for any reviewer type.
- Across three sessions, the investigations ruled out the writer's parsing, because replays of the real transcripts stamped correctly every time. That was the trap.

## Root Cause

The hook event and the transcript write race each other. A replay reads the transcript **after** it is complete, so it always wins the race. It proves the parsing is fine and says nothing about what the hook saw.

## Solution

`review-stamp-writer.sh` now polls when the async path finds no hand-back. It checks every 0.25 s for up to `REVIEW_STAMP_HANDBACK_WAIT_SECS` (default 5, capped at 8 to stay inside the hook's 10 s timeout). Whatever arrives still goes through the exactly-one-hand-back rule and every objection guard. Tests 78–80 in `test-review-stamp-writer.sh` cover it:

- 78: the hand-back is appended 1 s late, and the hook writes a clean record.
- 79: the hand-back never arrives, so no record is written, and the wait is bounded.
- 80: 78's fixture with the wait off writes no record. This is the control showing that the wait is what 78 measures.

## Prevention

- **Live hook fails but replay passes → capture the live input.** Add one temporary line that appends `$INPUT` plus the state it depends on (here: `[ -r "$TP" ]`, the hand-back count now, and again 3 s later in a background subshell) to a scratchpad log. Then trigger the event once and remove the line. Get the owner's OK first if another session shares the checkout, because the line could be swept into their commit.
- Any hook that reads a file another process is still writing (transcripts, logs) needs a bounded wait, not a single read.
- Until the fix is in the checkout the hooks run from (`$CLAUDE_PROJECT_DIR`), a missed record can be written by hand from the real transcript. Only do this on the owner's say-so, and check the digest against `gh pr diff <n> --name-only | sort -u | shasum | cut -c1-16`.

## Related Files

- `.claude/hooks/review-stamp-writer.sh` (`count_handbacks`, the `REVIEW_STAMP_HANDBACK_WAIT_SECS` loop)
- `.claude/hooks/test-review-stamp-writer.sh` (cases 78–80)
- `docs/harness-residuals.md` (the 10-23, 10-28 and 10-29 entries and the fix note)

## See Also

- [resumed reviewer never stamps](../conventions/resumed-reviewer-never-stamps-re-adjudicate-by-fresh-dispatch-2026-09-22.md) — a different no-record cause: a second hand-back
