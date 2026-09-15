---
title: "When a gate refuses while showing you the right evidence, read the gate — it is comparing against something you have not looked at"
track: knowledge
category: conventions
tags: [harness, hooks, tooling, worktrees, bash, testing]
module: shared
applies_to: [".claude/hooks/*.sh", "scripts/**/*.sh", ".husky/**"]
symptoms: ["A gate's own error message names the correct value and it still refuses", "Three variations of the same workaround are tried and all fail identically", "A refusal is labelled a false positive without the gate's source being opened", "An 'emergency bypass' is reached for on the first refusal rather than the last", "Work is handed back to a human with 'I can't' when the blocking condition was never read"]
created: 2026-09-15
---

# A gate that refuses while showing you the right evidence is not broken

## Rule

**When a gate refuses and its message contains the value you expected it to accept, stop and
read the gate's source before concluding it is wrong.** A refusal that quotes correct evidence
is the gate telling you it is comparing that evidence against something else — something you
have not inspected. Diagnose that second operand before reaching for a bypass, a workaround, or
a handoff.

Corollary: **repeated failures of the same idea are not evidence that the goal is impossible.**
They are evidence the model behind the idea is wrong. Three variants of one workaround is one
data point, not three.

## Smell patterns

- The error text contains the sha, path, or token you expected, and you read past it to the
  word "Blocked".
- You are on your second or third spelling of the same workaround — an env var inline instead
  of exported, a different working directory, a different tool for the same call.
- The phrase forming in your head is "the guard is broken in <situation>" and you have not
  opened the guard.
- You are about to use something the guard's own message calls an *emergency* bypass, for a
  situation that is not an emergency.
- You are about to hand the task back to a human with "I can't", and the artifact that would
  explain why is a file you could read in ten seconds.

## Why

Measured, 2026-09-15. `pr-preflight-guard.sh` refused a PR creation with:

```
Blocked: no fresh preflight pass-stamp for HEAD ca06d0b (found: cc299b7)
```

`cc299b7` was the exact branch HEAD that the pre-push gate had just verified and stamped. The
diagnosis written down at the time was "the guard misreads HEAD in worktrees — a known false
positive, needing the documented bypass." Three attempts followed: an inline `SKIP_` prefix, a
different working directory, and a different tool for the same call. All refused identically.

Reading the hook — about thirty lines — showed the diagnosis was wrong twice over:

```sh
HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")      # the hook's OWN cwd
...
STAMP=$(cat "$(preflight_stamp_path)" 2>/dev/null)     # ONE file, holding the last verified sha
if [ -z "$HEAD" ] || [ "$STAMP" != "$HEAD" ]; then     # deny
```

The gate was asking a coherent question — *is the repository's HEAD the thing that was
verified?* — and the honest answer was **no**: the shared checkout sat on `ca06d0b` while the
verified commit was `cc299b7`. The remedy was to make them agree (check the branch out where
the hook reads HEAD), which satisfies the precondition **for the right reason**. Not a bypass —
the condition actually met.

Two distinct errors, and the second is the expensive one:

1. **A correct gate was labelled buggy.** "Known limitation" is a comfortable label precisely
   because it ends inquiry. It should raise the bar for evidence, not lower it.
2. **"I can't" was reported without reading the blocking condition.** The pattern of identical
   failures was treated as proof of impossibility, when it was proof that one wrong model was
   being re-expressed three ways.

The general shape: a gate has **two** operands. Its message usually shows you the one it
computed from your work, because that is the one you can act on. The one it is comparing
against is frequently implicit — a repo HEAD, a stamp file, a digest, a baseline ref, the
process cwd. **A refusal you find surprising is nearly always a claim about that second
operand**, and it is the one the message does not explain.

## Examples

**Do — read the comparison, then decide:**

```sh
# the message named cc299b7 and refused anyway -> find the other operand
grep -n 'rev-parse\|STAMP\|!=' .claude/hooks/pr-preflight-guard.sh
# -> HEAD comes from the hook's cwd; STAMP is a single file
# -> the operands genuinely disagree; align them, do not bypass
```

**Don't — escalate the workaround:**

```sh
SKIP_PR_PREFLIGHT=1 gh pr create ...   # refused (prefix not honoured, by design)
cd "$worktree" && gh pr create ...     # refused (hook reads its own cwd)
# a third tool for the same call       # refused
# ...and still no one has opened the hook
```

## Exceptions

- **A genuinely documented limitation with a cited source** is different from one you inferred
  from a refusal. If the repo says so in a memory, a solution doc, or the hook's own comments,
  that is evidence. Your surprise is not.
- **Real emergencies exist**, and bypass tokens exist for them. The test is whether you can say
  what the gate would have caught and why it does not apply — not whether the gate is
  inconvenient.
- **Some gates are genuinely shell-only by design** (`SKIP_MERGE_REVIEW`, `SKIP_PR_PREFLIGHT`),
  so that the agent cannot self-authorize. Discovering that an inline prefix is ignored is
  evidence of deliberate design, not of a bug.
- When the blocking condition truly cannot be met from here, handing back is right — but hand
  back the *condition*, not the conclusion: "HEAD must equal the stamped sha and I cannot move
  the shared checkout" is actionable; "I can't create the PR" is not.

## Related Files

- `.claude/hooks/pr-preflight-guard.sh` — the HEAD/stamp comparison above
- `scripts/lib/preflight-stamp-path.sh` — the single-file stamp the reader resolves
- `.claude/hooks/merge-review-guard.sh` — the sibling gate whose bypass is shell-only for the
  same self-authorization reason

## See Also

- [A positional reference decays — anchor instead](../code-quality/a-positional-reference-decays-anchor-instead-2026-09-13.md) — the same "read the thing rather than trust a coordinate" discipline, applied to citations
- [A guard and its mutation test can both be inert while green](../code-quality/a-guard-and-its-mutation-test-can-both-be-inert-while-green-2026-09-13.md) — the opposite failure: a gate that should refuse and cannot
- [An invented enumeration is not the space — ask the tool](../logic-errors/an-invented-enumeration-is-not-the-space-ask-the-tool-2026-09-13.md) — same root discipline: get the answer from the artifact, not from your model of it
