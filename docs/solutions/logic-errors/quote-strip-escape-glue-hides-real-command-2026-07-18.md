---
title: "Quoted-span stripping without an escape pre-pass glues spans together and hides a real command from a matcher hook"
track: bug
category: logic-errors
tags: [bash, hooks, sed, quote-stripping, command-matcher, pr-gate, fail-closed, regex]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh"]
symptoms: [A command-matching hook that strips quoted spans before matching silently allows or ignores a REAL invocation when an earlier argument contains a backslash-escaped quote, The naive sed pair s/'[^']*'//g plus s/"[^"]*"//g pairs an escaped quote inside one argument with the quote opening a LATER argument and deletes the separator and the command between them, A deny gate falls through its final match-or-exit-0 line on input that visibly contains the gated command]
created: 2026-07-18
severity: high
---

# Quoted-span stripping without an escape pre-pass glues spans together and hides a real command from a matcher hook

## Problem

Command-matching hooks (`pr-preflight-guard.sh`, `commit-verify.sh`,
`pr-verify.sh`) strip quoted spans before matching, so a command merely
*mentioned* inside a quoted argument never false-matches:

```bash
CMD_BARE=$(printf '%s' "$CMD" | sed "s/'[^']*'//g; s/\"[^\"]*\"//g")
```

That sed is not backslash-escape-aware. In

```bash
echo "escaped \" quote" && gh pr create --title "x"
```

the `\"` inside the first argument pairs with the quote *opening* `--title`'s
argument, and the strip deletes everything between — including the `&&`
separator and the literal `gh pr create`. `CMD_BARE` collapses to
`echo  quotex"`, the matcher misses, and the hook falls through `|| exit 0`:
a **silent allow on the PR gate** (and a silently skipped verification in the
two advisory hooks). Found by the 2026-07-18 harness audit's Phase 6 review;
the bug pre-dated the audit in the gate and was propagated into the two
advisory hooks by that same audit's M7/L10 fixes before review caught it.

## Symptoms

- A deny gate lets through an input that visibly contains the gated command.
- A PostToolUse verifier stays silent on a real, matching command.
- Repro shape: any command with a `\"` (or `\'`) inside one quoted argument
  and the gated command *after* it, before another quoted argument.

## Root Cause

Non-nested span regexes treat every quote character as a delimiter. A
backslash-escaped quote is *content*, not a delimiter — pairing it with a
later real delimiter merges two spans and swallows the unquoted text between
them (separators, commands, everything).

## Solution

Neutralize backslash-escaped quotes **before** the span strip — one extra sed
expression, applied identically in all three hooks:

```bash
CMD_BARE=$(printf '%s' "$CMD" | sed "s/\\\\[\"']//g; s/'[^']*'//g; s/\"[^\"]*\"//g")
```

Residual mis-strips (e.g. `\\"` — escaped backslash before a real delimiter)
fail in the safe direction: leftover text can only make the match MORE likely
— deny-side for a gate, noise-side for an advisory hook. A fully correct
treatment needs a tokenizer, not another regex layer; the pre-pass closes the
demonstrated silent-allow class at one-line cost.

## Prevention

Command-matcher hooks share a **canonical matcher recipe** — every leg has a
demonstrated bypass when missing, so port all of it, not the half a sibling
happened to have (the 2026-07-18 audit found `pr-preflight-guard` had
separators but not env-prefixes while `commit-verify` had env-prefixes but not
separators — each missing exactly the other's leg):

1. Escape pre-pass `s/\\\\[\"']//g`, THEN span strip (this file's bug);
2. Command-position anchor with separator class `(^|[;&|(])` (compound-form
   bypass: `git add -A && git commit`);
3. Env-assignment prefix `([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*`
   with value class `*` not `+` — quote-stripping can leave `FOO= `
   (env-prefix bypass: `FOO=1 gh pr create`);
4. Trailing anchor `([[:space:]]|[)]|$)` so a closing paren doesn't unmatch.

Add a red test per leg in the hook's `test-*.sh` (see tests 12b–12f in
`test-pr-preflight-guard.sh`).

## Related Files

- `.claude/hooks/pr-preflight-guard.sh` — the gate (deny-side)
- `.claude/hooks/commit-verify.sh`, `.claude/hooks/pr-verify.sh` — advisory
- `.claude/hooks/test-pr-preflight-guard.sh` (12e/12f), `test-commit-verify.sh` (7), `test-pr-verify.sh` (11) — glue regression tests

## See Also

- `docs/solutions/logic-errors/guard-lexer-content-predicate-needs-same-redaction-2026-07-12.md` — the sibling trap: a lexer's downstream predicate skipping the redaction
- `docs/solutions/logic-errors/lexical-prefix-path-guard-dot-segment-escape-2026-07-17.md` — same "lexical shortcut has a semantic hole" family, for paths
