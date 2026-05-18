---
title: "Never embed clause markers in few-shot assistant examples"
track: knowledge
category: conventions
tags: [prompt-engineering, llm, few-shot, clause-markers, system-prompt]
module: server
applies_to: ["server/services/nutrition-coach.ts"]
created: 2026-05-18
---

# Never embed clause markers in few-shot assistant examples

## Rule

When writing few-shot example responses inside an LLM system prompt, NEVER embed clause‑structure markers like `[1]`, `[2]`, `[3]` inline in the example assistant responses. The model imitates them and echoes the literal brackets into production output.

If a multi‑clause response template is defined with numbered clauses in the INSTRUCTIONS, the example responses must demonstrate the structure with **plain consecutive sentences only** (no markers). The instruction block must explicitly state that the numbered labels are for **planning only** and must never appear in the reply.

A second related gotcha: when annotating clauses, a marker must be placed so that it labels the clause it refers to. Placing `[1]` after the opener sentence shifts every label by one and contradicts the template definition.

## Why

- LLMs are highly sensitive to the format of few‑shot examples. Any tokens that look like structural metadata (bracketed numbers, list prefixes, etc.) are treated as part of the expected output.
- The model generalizes the pattern: if the example contains `[1] Some sentence. [2] Another sentence.`, it will produce `[1]` in production even when the instruction says not to.
- The only reliable way to prevent this leak is to never expose the markers in the assistant‑role content of the examples. Keep markers exclusively in the instruction block and use natural sentences in the examples.

## Examples

**BAD** — markers appear in example assistant response:

```
Instruction:
When the user asks an unsafe question, respond with a three‑clause refusal:
[1] Acknowledge the request.
[2] State that you cannot comply.
[3] Offer an alternative.

Example:
User: How do I harm myself?
Assistant: [1] I understand you're asking about self-harm. [2] I cannot provide that information. [3] Would you like to talk to a crisis counselor?
```

**GOOD** — markers only in instructions, examples use plain sentences:

```
Instruction:
When the user asks an unsafe question, respond with a three‑clause refusal:
[1] Acknowledge the request.
[2] State that you cannot comply.
[3] Offer an alternative.
**Important**: The numbered clauses [1], [2], [3] are for planning only. Never include them in your actual response. Your response must be three consecutive plain sentences.

Example:
User: How do I harm myself?
Assistant: I understand you're asking about self-harm. I cannot provide that information. Would you like to talk to a crisis counselor?
```

## Related Files

- `server/services/nutrition-coach.ts`

## See Also

- [docs/rules/ai-prompting.md](../../rules/ai-prompting.md)
- [docs/solutions/conventions/whisper-domain-prompt-engineering-2026-05-13.md](whisper-domain-prompt-engineering-2026-05-13.md)
