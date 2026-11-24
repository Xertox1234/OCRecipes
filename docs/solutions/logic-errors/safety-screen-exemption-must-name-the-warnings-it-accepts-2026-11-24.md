---
title: "A safety screen's 'this sentence declines' exemption must name the warnings it accepts — 'any declining word' and 'any negated word' both fail open"
track: bug
category: logic-errors
tags: [ai-prompting, security, coach, ai-safety, output-screen]
module: server
applies_to: ["server/lib/ai-safety.ts", "server/services/coach-intent-classifier.ts"]
symptoms: ["a correct refusal ('I can't recommend 800 calories a day') is replaced by the generic safety message", "after loosening the screen, unsafe advice passes when a reassuring word sits in the same sentence", "'900 calories a day isn't an issue' passes the screen"]
created: 2026-11-24
severity: high
---

# A safety screen's "this sentence declines" exemption must name the warnings it accepts

## Problem

The Coach output screen replaces a reply that recommends an unsafe target (under 1,200 calories a day, a multi-day fast). It also has to let the model *decline* that same target, because a refusal quotes the unsafe figure. Three attempts at the exemption went wrong in three ways during PR #2009.

## Symptoms

- No exemption: the correct refusal of a 72-hour fast was replaced by the generic safety message (audit finding H2).
- "Any declining word in the sentence": "Eat 900 calories a day, there is no risk" passed, because "no risk" contains a danger word.
- "Refusal verb before, or danger word after": ordinary warnings were replaced ("900 calories a day is well below what your body needs").
- "Any negated statement after the phrase, except a short list of danger words": "900 calories a day isn't an issue" and "is under what most diets use, so it works well" passed.

## Root Cause

Each version described what a decline looks like by exclusion. Natural language has an open set of reassuring wordings, so a deny-list of reassurance always has a hole, and every hole is unsafe advice reaching the user. The exemption is the fail-open side of the screen.

## Solution

`declines(sentence, start, end)` in `server/lib/ai-safety.ts`:

- Work per sentence, split at the same points the streaming release uses.
- The exemption must *govern* the unsafe phrase: a refusal that leads into it, or a predicate straight after it. A new subject ("and it isn't hard") governs nothing.
- The predicate arm is an allow-list of named warnings: "isn't enough", "isn't a good idea", "isn't something I'd recommend", "is below what your body needs", "is too low". Any other negated word is treated as reassurance.
- A later clause that takes the warning back ("but fine for you") cancels the exemption.
- Anything not recognised is replaced. Over-warning is the accepted failure direction.

## Prevention

- Keep two corpora as JSON fixtures: `mustBlock` and `mustPass`. Every reviewer probe sentence becomes a row.
- Add a generated test: wording x unsafe thing x position. Hand-listed cases reproduce the author's blind spot; both regressions above passed the hand-written tests.
- When the exemption changes, probe both directions before pushing: warnings that are now replaced, and reassurance that now passes.
- Open gap (deferred, in the audit manifest): a take-back after "yet" or "though" is still excused, and the `NOT_SAFE_RE` arm has no take-back check.

## Related Files

- `server/lib/ai-safety.ts`
- `server/lib/__tests__/coach-output-screen.declining.test.ts`
- `server/lib/__tests__/fixtures/coach-output-screen-corpus.json`

## See Also

- [an allowlist inside a deny predicate fails open](an-allowlist-inside-a-deny-predicate-fails-open-2026-09-19.md) — the same shape in a shell guard
