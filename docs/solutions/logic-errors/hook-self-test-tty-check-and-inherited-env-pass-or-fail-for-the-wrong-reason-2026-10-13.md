---
title: 'A hook self-test''s `[ -t 0 ]` check always passes on a runner without a terminal, and an inherited env var fails a "default only when unset" check'
track: bug
category: logic-errors
module: shared
severity: low
tags: [hooks, testing, hermetic-tests, tooling, harness]
symptoms: ['A "the hook cannot prompt" assertion stays green after the `</dev/null` redirect is deleted from the hook', 'A "hook exports X" assertion fails locally but would pass in CI, because the developer''s shell already exports X and the hook rightly leaves a set variable alone']
applies_to: [.claude/hooks/test-*.sh]
created: '2026-10-13'
---

# A hook self-test's `[ -t 0 ]` check always passes on a runner without a terminal, and an inherited env var fails a "default only when unset" check

## Problem

Two defects in the first draft of `test-session-start.sh` (#1431). Both made the result depend on the environment the test ran in, not on the hook:

1. **Vacuous stdin assertion.** The `npm` shim logged `stdin=tty` or `notty` from `[ -t 0 ]`, and the test asserted `notty` to prove `db:push` couldn't prompt. Claude Code's Bash tool and CI never give a test a terminal, so `notty` held whether or not the hook redirected stdin.
2. **Inherited environment.** The hook exports seven variables *only when unset*. The test unset two of them, so `AI_INTEGRATIONS_OPENAI_API_KEY`, exported by the developer's shell, reached the hook. The hook correctly skipped it and the "exports the stub" assertion failed locally, though it would pass in CI.

## Symptoms

- Mutating the hook (deleting `</dev/null` from `step()`) leaves the suite green.
- One assertion fails on one machine and passes on another with identical code.

## Root Cause

1. `[ -t 0 ]` asks "is stdin a terminal?", not "can the child read the parent's stdin?". With no terminal anywhere, the answer is always no.
2. `env -u` cleared only some of the variables the hook keys on, so the test wasn't hermetic for the dimension under test.

## Solution

1. Give the hook a stdin that carries data, and have the shim report whether it could read it:

   ```bash
   bash "$HOOK" > "$dir/out" 2>&1 <<<"y"                                  # live stdin
   if IFS= read -r _line; then stdin=live; else stdin=closed; fi          # in the shim
   ```

   Assert `stdin=closed`. A mutant without the redirect now fails: it reads `y`.
2. Unset **every** variable the hook defaults (`env -u A -u B …`), not just the ones you're thinking about.

## Prevention

- For any "cannot do X" assertion, make the bad state reachable in the test first, then assert it doesn't happen. Prove it with a mutation run: remove the protection and watch the assertion fail (`docs/rules/harness.md`: a gate test needs a two-sided control).
- For a "set only when unset" hook, derive the `env -u` list from the hook's `default_env` calls.

## Related Files

- `.claude/hooks/test-session-start.sh`
- `.claude/hooks/session-start.sh`

## See Also

- [inherited GIT_DIR overrides git -C in hook self-tests](inherited-git-dir-overrides-git-c-in-hook-self-tests-2026-06-26.md) — the same leak class: a developer's inherited environment reaching a hook test
- [cloud SessionStart hook: quiet, re-runnable, fail-open](../conventions/cloud-session-start-hook-quiet-rerunnable-fail-open-2026-10-13.md) — the hook this test covers
