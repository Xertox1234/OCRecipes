---
track: knowledge
category: conventions
tags:
  - prompt-engineering
  - few-shot
  - intent-classifier
  - llm
module: server
applies_to:
  - server/services/nutrition-coach.ts
  - server/services/coach-intent-classifier.ts
created: 2026-05-18
---

# Few-Shot Example Must Match Intent Classifier

## Rule

When adding a few-shot example exchange to an intent‑specific prompt bundle inside `buildIntentBlock` (in `server/services/nutrition-coach.ts`), the example’s `User:` message **must** be a message that the deterministic classifier in `server/services/coach-intent-classifier.ts` (`classifyIntent` / `SAFETY_PATTERNS`) actually routes to that same intent bundle. If the example’s user message classifies into a different intent, the model never sees that example for the intended case — the example is dead weight.

Concretely, pick the example trigger from vocabulary the classifier already matches; verify against `SAFETY_PATTERNS` / classifier regexes **before** committing.

## Why

The classifier acts as a gatekeeper: it decides which intent bundle receives the user’s query. A few‑shot example whose trigger phrase would be classified under a different intent will never be shown to the model when the target intent is active. This makes the example useless (dead weight) and can give a false sense of safety coverage. The issue was discovered when a `safety_refusal` example used “I want to do a 10‑day juice cleanse to detox” — the classifier’s `SAFETY_PATTERNS` lack patterns for “cleanse”/“detox” (the `extreme_fasting` pattern only matches `water fast` and explicit hour‑based fasts), so the example would be routed to `personalized_advice` instead of `safety_refusal`. The fix was to change the trigger to an Ozempic dosing question, which matches the `medication_glp1` `SAFETY_PATTERN`.

## Examples

- **Bad** (dead weight):  
  `User: I want to do a 10‑day juice cleanse to detox`  
  → Classifies as `personalized_advice`, not `safety_refusal`.

- **Good** (effective):  
  `User: How much Ozempic should I take for weight loss?`  
  → Classifies as `safety_refusal` (matches `medication_glp1` pattern).

## Related Files

- `server/services/nutrition-coach.ts` – where `buildIntentBlock` lives
- `server/services/coach-intent-classifier.ts` – where `classifyIntent` and `SAFETY_PATTERNS` are defined

## See Also

- [docs/rules/ai-prompting.md](../../rules/ai-prompting.md)
- [docs/solutions/conventions/few-shot-clause-markers-leak-into-output-2026-05-18.md](few-shot-clause-markers-leak-into-output-2026-05-18.md)
