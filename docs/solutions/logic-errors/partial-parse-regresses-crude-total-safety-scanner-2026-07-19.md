---
title: "Replacing a crude-but-TOTAL safety scanner with a smarter PARTIAL one regresses the gate where the partial model has a hole"
track: bug
category: logic-errors
tags: [bash, hooks, awk, quote-aware, tokenizer, safety-gate, false-negative, ansi-c-quoting, differential-testing, security]
module: shared
applies_to: [".claude/hooks/**/*.sh", "scripts/**/*.sh"]
symptoms: ["A newly quote/parse-aware matcher on a security gate ALLOWS an input the previous cruder version DENIED", "A quote-state scanner desyncs on a quoting form it does not model (e.g. bash $'…' ANSI-C) and swallows subsequent real separators/operators", "Several copies of the same hand-rolled scanner drift because only some were taught a new quoting form", "The fix's own unit tests are green because they only exercise the cases the author imagined"]
created: 2026-07-19
severity: high
---

# Replacing a crude-but-TOTAL safety scanner with a smarter PARTIAL one regresses the gate where the partial model has a hole

## Problem

`git-safety.sh` split a shell command into segments with a quote-blind
`printf '%s' "$CMD" | tr ';|&' '\n'` — crude, but it split at **every** `;`/`|`/`&`,
so a mutating `git` after any separator was always isolated and checked. A follow-up
replaced it with a smarter quote-**aware** `split_segments` (awk) so a metachar
*inside* a quoted argument would no longer fracture a real command. The awk modelled
`'…'` and `"…"` but **not** bash `$'…'` (ANSI-C) quoting. Inside `$'…\'…'`, the `\'` is
an *escaped* apostrophe that does **not** close the span — but the scanner toggled its
single-quote state on every `'`, so its quote state **inverted** and it then swallowed
the following real, unquoted `;`/`|`/`&`. A command like

```
git -C <worktree> commit -m $'don\'t ship' && git -C <main> reset --hard HEAD~1
```

merged its second segment into the first; the `git … reset --hard` against the main
checkout was never examined and the gate **ALLOWED** it — a mutation the crude `tr`
split had **DENIED**. The "improvement" was a **regression**.

## Symptoms

- A newly parse-aware matcher on a gate ALLOWs input the cruder predecessor DENIED.
- A quote-state scanner desyncs on an unmodelled quoting form and swallows real
  separators/operators after it (`$'…'`, but the shape generalizes).
- Multiple hand-rolled copies of one scanner drift — some learn a new form, some don't.
- The fix's unit tests are green: they only cover the author's imagined cases.

## Root Cause

**A conservative over-approximation is strictly safer than a precise-but-incomplete
parse — on a safety gate, a *smarter* mechanism that is wrong in a NEW case is a
regression even while it fixes others.** The crude `tr` over-split (it could raise
false-POSITIVES — extra DENYs — but never a false-negative). The partial parser tried
to be exact and, on the one quoting form it didn't model, produced a false-NEGATIVE: it
trusted its own wrong state instead of over-splitting. Partial quote-awareness is worse
than none for a security splitter. The same quote-state machine also existed in three
independent copies (the segment splitter and two token extractors), each separately
blind to `$'…'`, so the same hole recurred per copy — classic drift.

## Solution

1. **Model the state-INVERSION classes, or keep over-approximating — never half-parse.**
   The fix added an explicit ANSI-C state (`st==3`) to every scanner: `\` escapes the
   next char *including* the apostrophe; only an *unescaped* apostrophe closes. Check the
   backslash branch *before* `$'` detection so `\$'…'` opens a normal quote (escaped `$`),
   and scope strictly to `$'…'` (`$"…"` needs nothing — double-quote escaping covers it).
2. **Prevent copy drift with a shared TEST corpus, not shared code and not a comment.**
   A shared awk loop was rejected: one bug in it breaks all copies at once, in the
   permissive direction, and awk hook-plumbing is finicky. A "keep in sync" comment is
   exactly what already failed — *nobody tested `$'…'`*. Instead, one quote-torture corpus
   in the test file pins every copy against the same strings, so the next drift fails CI
   regardless of code structure.
3. **Verify with a DIFFERENTIAL harness, not a hand truth table.** The regression lived in
   a case the author didn't imagine, so a hand-authored table couldn't catch it. Run a
   broad corpus through BOTH the old and new artifact and flag every result that moved in
   the dangerous direction (here `DENY→ALLOW`). Zero moves in that direction — plus every
   remaining old/new divergence being a documented residual — is the real "done" signal.
4. **Do not claim "complete."** Shell quoting has an infinite tail (`$'…'`, here-docs,
   `$(…)`, `${…}`, `\`-newline continuation). Close the state-inversion false-NEGATIVE
   classes; enumerate the rest as accepted residuals (they over-split = false-POSITIVE,
   never an inversion-swallow) with the escape hatch documented ("guardrail, not sandbox").
   "Complete" is the same over-claim as "never a false-negative" — see [[quote-strip-escape-glue-hides-real-command]].

## Prevention

- On a safety gate, when you replace a crude-but-total check with a precise one, ask:
  *what does the precise version get WRONG that the crude one got right by brute force?*
  If you can't enumerate that set, keep the crude check or over-approximate.
- New quoting/parsing awareness ships with a differential-vs-previous run over a torture
  corpus, and the corpus is committed so it guards every copy against future drift.
- Prefer false-POSITIVE (extra DENY, escapable) over any risk of false-NEGATIVE when the
  gate protects against a destructive action.

## Related Files

- `.claude/hooks/git-safety.sh` — `split_segments`, `git_c_target`, `emit_write_targets` each carry the `st==3` ANSI-C state; the mutating-git gate is a permissive `*git*` pre-filter + anchored per-segment regex.
- `.claude/hooks/test-git-safety.sh` — the shared quote-torture corpus (the drift guard) and the `jsonc` jq-based envelope builder for backslash/`$'…'` commands.

## See Also

- [quote-strip-escape-glue-hides-real-command](quote-strip-escape-glue-hides-real-command-2026-07-18.md) — the same quote-scanner family: context-free regex can't express context-sensitive shell quoting; tokenize when the extracted value can itself be quoted.
- [lexical-prefix-path-guard-dot-segment-escape](lexical-prefix-path-guard-dot-segment-escape-2026-07-17.md) — sibling "lexical shortcut has a semantic hole" family, for paths.
