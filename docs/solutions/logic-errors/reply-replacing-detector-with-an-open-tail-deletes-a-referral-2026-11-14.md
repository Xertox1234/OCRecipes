---
title: "A detector that replaces a model reply must match the whole bare reply — an open tail deletes a reply that already carries a referral"
track: bug
category: logic-errors
tags: [ai-prompting, ai-safety, testing, regex, coach]
module: server
applies_to: ["server/lib/ai-safety.ts", "server/services/coach-pro-chat.ts"]
symptoms: ["a model reply such as \"I can't help with that, but please call 988.\" is replaced by a canned message", "a refusal regex ends in a bounded wildcard such as [^.!?\\n]{0,60} to tolerate wording differences", "tests cover bare refusals that must be replaced but no refusal that goes on to say something useful"]
created: 2026-11-14
severity: high
---

# A detector that replaces a model reply must match the whole bare reply

## Problem

On a safety turn the coach's model sometimes answers only "I'm sorry, but I cannot assist with
that request". #1859 detects that and swaps in a supportive message. The first detector allowed
any 60 characters after "I can't help", to tolerate wording differences. That tail also matched
"I can't help with that, but please call 988." The reply already carried a crisis-line referral,
and the code replaced it with text that had none.

## Symptoms

- The detector's regex is anchored at both ends but has a wildcard between them.
- The must-replace tests are all short refusals; there is no must-keep row.

## Root Cause

The two errors are not equal. A missed bare refusal leaves the reply as the model wrote it, which
is the behaviour before the feature existed. A wrong match deletes content, and on a safety turn
that content can be the referral. The wildcard was tuned against the cheap error only.

## Solution

`FLAT_REFUSAL_RE` in `server/lib/ai-safety.ts` ends in a closed list: an optional verb object
("you", "with", "that / this / it", "request") and optional final punctuation, then `$`. A refusal
that continues into anything else does not match and is kept. `isFlatModelRefusal` also caps the
length at 120 characters.

## Prevention

- For any detector whose match causes a replacement or deletion, write the must-keep rows first:
  the same opening followed by a referral, by a reason, and by a question.
- Prefer a closed list of endings over a bounded wildcard. If a new bare-refusal wording appears,
  add it to the list.

## Related Files

- `server/lib/ai-safety.ts` — `FLAT_REFUSAL_RE`, `isFlatModelRefusal`
- `server/lib/__tests__/ai-safety.test.ts`
- `server/services/__tests__/coach-pro-chat.test.ts` — "keeps a reply that already carries a referral"

## See Also

- [a canned safety reply chosen by a predicate wider than its wording](safety-reply-chosen-by-a-predicate-wider-than-its-wording-2026-11-14.md) — the other half of #1859
- [output screen on the raw reply misses what the reader decodes](output-screen-on-raw-reply-misses-what-the-reader-decodes-2026-11-12.md)
