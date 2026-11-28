---
title: "Coach output screen replaces ordinary snack-size advice ('Keep tonight's snack under 200 calories') with the safety message"
status: done
priority: medium
created: 2026-11-26
updated: 2026-11-28
assignee:
labels: [ai-prompting, safety, needs-owner-call]
github_issue:
---

# Screen blocks snack-size advice

## Summary

The unsafe-advice screen (`lowCalorieTargetSpan` in `server/lib/ai-safety.ts`) reads "Keep tonight's snack under 200 calories." as a daily target below 1,200 and replaces the whole reply with the safety message. A user near their calorie goal who asks "Can I still have a snack today?" can get the safety notice instead of an answer. The fixed coach eval found it on its first baseline run (2026-11-26, cases `accuracy-calorie-math-01` and `shape-fits-question-01`).

## What was tried (PR #2089, reverted out before merge)

An exemption for a named slot's size (snack, breakfast, lunch, dinner, dessert) before the figure was built, then narrowed over four review rounds. Each round found new whole-day phrasings that main blocks and the exemption let through:

- "Eat only dinner of 400 calories."
- "Keep dinner under 400 calories and eat nothing else."
- "... skip breakfast and lunch."
- "... then fast until tomorrow."
- "... that's it for the day."

The shape was a fail-open allowlist of whole-day cues inside a deny predicate (see `docs/solutions/` "an allowlist inside a deny predicate fails open"). It was removed so #2089 could land; `ai-safety.ts` on main is unchanged by it.

## Direction that fails closed (needs an owner call)

Grant the slot exemption only when the rest of the sentence after the figure is a short, known-benign tail: end of sentence, "tonight", "today", "each", "or so", "or less". Anything else after the figure keeps the sentence a target. This blocks a few ordinary phrasings ("Keep dinner under 400 calories and skip the dessert", "... so you stay on track"), so they still get the safety message. That over-block is the owner's call; an under-block is not acceptable.

## Acceptance Criteria

- [x] The owner has chosen the trade-off: fail closed, over-blocking accepted (owner ruling 2026-11-28).
- [x] "Keep tonight's snack under 200 calories." passes the screen when the reply states a remaining budget with its unit, at least as large as the figure, and restricts the day nowhere. With no budget stated it still blocks, by design.
- [x] Every whole-day phrasing listed above, plus "Keep it under 800 calories" and "Eat only one meal of 400 calories", still blocks.
- [x] Base-vs-head measured on generated corpora: 42,577,920 replies, plus 1,244,160 with neighbour sentences. Neither newly blocks any row.
- [x] Re-ran `EVAL_CASES=accuracy-calorie-math-01,shape-fits-question-01 npm run eval:coach` with 3 samples: 6/6 assertions passed and no canned safety reply. No sampled reply used the snack-size shape itself, so the run did not exercise the exemption.

## Resolution (2026-11-28)

Fixed by #2125 (c4e0e5a72): a closed snack-size shape, a reply-wide veto on anything that restricts the day, and a cap at the stated remaining budget. Known residuals:

- A budget the model writes in bold ("about **200 calories** left") is not read as a budget, so that reply still blocks (the fail-closed side).
- A restriction phrased in a way no rule lists still passes.

Follow-up filed: `todos/P2-2026-11-28-screen-intake-verb-window-misses-long-phrasings.md`.
