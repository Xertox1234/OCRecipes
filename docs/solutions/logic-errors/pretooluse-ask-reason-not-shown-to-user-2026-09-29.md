---
title: 'A PreToolUse "ask" does not show its permissionDecisionReason to the user — the prompt looks like an ordinary edit prompt, so the user approves blind; deny with the reason to the model instead'
track: bug
category: logic-errors
module: shared
severity: medium
tags: [harness, hooks, pretooluse, ask, deny, permission-prompt, verification]
symptoms: ['A PreToolUse hook returns permissionDecision "ask" with a permissionDecisionReason, and the user sees a plain edit permission prompt with no mention of the reason', 'The user approves the prompt without knowing why the hook stopped the edit, so the safeguard the ask was meant to provide never happens', 'Hook unit tests pass because they assert the JSON the hook prints, not what the permission prompt renders']
applies_to: [scripts/pg-lab/session-coord.sh, .claude/hooks/session-coord-hook.sh, .claude/hooks/*.sh]
created: '2026-09-29'
---

# A PreToolUse "ask" does not show its reason to the user

## Problem

Session coordination v2 (#1137) stopped the first edit of a file another live session was
working on with a PreToolUse **ask**:

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask",
  "permissionDecisionReason":"Session 1a2b3c4d (branch …) edited src/x.ts 3 min ago …"}}
```

The design assumed the permission prompt would show that reason, so the user could say no when
another session held the file. It does not.

## Symptoms

- Live two-session run, 2026-09-28 (default permission mode): the ask fired
  and held the edit, but the user saw the ordinary edit prompt with no mention of another
  session, and approved it. The user confirmed afterwards that the prompt carried no session
  information.
- The unit suite was green throughout. It asserted `permissionDecision == "ask"` and that the
  reason named the holder — both true of the JSON, neither about what the user sees.

## Root Cause

What reaches the user and what reaches the model are different channels, and the ask's reason
is on neither user-visible one. A probe hook (2026-09-28) returned two asks:
one with a `systemMessage` plus a reason, and a control with a reason only. The session
transcript recorded them as:

| Hook output field                        | Transcript entry                                       |
| ---------------------------------------- | ------------------------------------------------------ |
| `systemMessage`                          | its own `hook_system_message` attachment               |
| `permissionDecisionReason` (on an ask)   | only inside the raw `stdout` of the `hook_success` entry — no entry of its own |

So the reason is carried as part of the hook's output but is never surfaced as a message. The
probe did not establish whether `systemMessage` is visible **before** the user answers the
prompt, so it was not adopted as the fix.

## Solution

Use **deny**, whose reason goes to the model, and let the model do the explaining (#1155):

```json
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
  "permissionDecisionReason":"Blocked once: another Claude session is working on this file. Session … edited src/x.ts 3 min ago. Ask the user whether to go ahead, and tell them which session this is. Retry only if they say yes; the retry will go through. If they say no, leave the file alone."}}
```

- The model receives the reason as the tool result (the documented deny behaviour), tells the user in chat which session holds
  the file, and asks.
- A per-(file, agent, holder) "told" marker lets the retry through, so a "yes" costs one retry,
  not a loop.

This is a unit-testable contract: the suite asserts `deny`, the reason text, and that the
retry is allowed. The live end-to-end check (the two-session runbook) is still to be re-run on
the #1155 code.

## Prevention

- Never put information the **user** must read in `permissionDecisionReason` on an ask. If the
  decision needs the user's judgment, deny with the reason addressed to the model and tell it
  to ask.
- A hook's tests prove the JSON it prints, not what the UI renders. For anything a human must
  see, verify it once in a live session, and record in the design which channel carries it.
- When a probe can't be observed by the agent itself (a UI prompt), prefer a mechanism the
  agent can test over asking the user to run manual UI probes.

## Related Files

- `scripts/pg-lab/session-coord.sh` (`emit_block`, `block_mark_told`, `block_told`)
- `.claude/hooks/test-session-coord-v2.sh` (block, retry and told-marker tests)
- `docs/verification/session-coordination-two-session.md` (live runbook)

## See Also

- [pending approval marker promoted into a silent approval](./pending-approval-marker-promoted-into-a-silent-approval-2026-09-28.md): the ask-once marker this replaced
