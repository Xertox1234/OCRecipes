---
title: "A canned safety reply chosen by a predicate wider than its wording reaches the wrong person — route and pick the reply from one pattern"
track: bug
category: logic-errors
tags: [ai-prompting, ai-safety, testing, intent-classification, regex, coach]
module: server
applies_to: ["server/services/coach-intent-classifier.ts", "server/services/coach-pro-chat.ts", "server/lib/ai-safety.ts"]
symptoms: ["a user who writes about suicide or self-harm is shown a canned reply worded for distress about eating", "a predicate named for one topic (disordered eating) also matches another (self-harm, suicide) and a caller picks user-facing text from it", "the router and the reply picker each hold their own copy of 'the same' regex, and a widening lands in only one", "a message routes to the safety turn but is not recognised by the predicate that selects the crisis text"]
created: 2026-11-14
severity: high
---

# A canned safety reply chosen by a predicate wider than its wording reaches the wrong person

## Problem

The coach replaces a bare model refusal on a safety turn with a canned supportive message. The
first version (#1859) chose that message with `matchesDisorderedEating`, the router's own
pattern. The pattern's name says eating, but it also matches "self-harm" and "suicide". So a user
who wrote about suicide could be shown text about food, with a referral to a dietitian.

The fix added a second predicate, `matchesSelfHarm`, with its own regex, to pick a crisis message.
That left two copies of the self-harm wording: the router's and the picker's. Widening the router
alone ("kill myself") would have routed the message to the safety turn and then shown the
eating-focused text again, because the picker did not know the phrase.

## Symptoms

- A canned reply's wording covers one topic and the predicate that selects it covers two.
- A predicate's name is narrower than what its regex matches.
- Two regexes that must agree on "is this self-harm" live in two places.

## Root Cause

The pattern was written for routing, where one bucket for "eating distress or self-harm" is fine:
both go to the same safety prompt. Reusing it to choose words shown to the user gave it a second
job with a finer requirement, and nothing checked the wording against everything the pattern
matches.

## Solution

- Each canned safety reply is chosen by a predicate that matches only what the reply's wording
  fits. The most serious class is tested first and wins when a message carries both signals
  (`server/services/coach-pro-chat.ts`, the `replacement` chain).
- The router entry and the picker read one constant. `SELF_HARM_RE` is built once;
  the `disordered_eating` router entry is composed from its `.source`, and `matchesSelfHarm`
  tests it directly (#1864). A phrase cannot route without also selecting the crisis message.

## Prevention

- One test table asserts all three for every self-harm phrase: it routes to the safety turn, it
  selects the crisis message, and the router predicate matches. A phrase added to one side only
  fails the table.
- Before reusing a routing predicate to choose user-facing text, list what the predicate matches
  and read the text against each class.

## Related Files

- `server/services/coach-intent-classifier.ts` — `SELF_HARM_RE`, `SAFETY_PATTERNS`, `matchesSelfHarm`
- `server/services/coach-pro-chat.ts` — the replacement chain
- `server/lib/ai-safety.ts` — `SAFETY_CRISIS_FALLBACK_MESSAGE`, `SAFETY_REFUSAL_FALLBACK_MESSAGE`
- `server/services/__tests__/coach-intent-classifier.test.ts` — the shared phrase table

## See Also

- [a detector that replaces a reply must match the whole bare reply](reply-replacing-detector-with-an-open-tail-deletes-a-referral-2026-11-14.md) — the other half of #1859
- [an allowlist inside a deny predicate fails open](an-allowlist-inside-a-deny-predicate-fails-open-2026-09-19.md) — exclusions in the same pattern
- [safety flag must veto, not alias](safety-flag-must-veto-not-alias-2026-08-16.md)
