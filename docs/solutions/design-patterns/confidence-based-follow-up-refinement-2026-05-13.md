---
title: "Confidence-based follow-up refinement for AI analysis"
track: knowledge
category: design-patterns
tags: [api, ai, openai, confidence, refinement]
module: server
applies_to:
  [
    "server/services/**/*.ts",
    "server/routes/**/*.ts",
    "client/screens/**/*.tsx",
  ]
created: 2026-05-13
---

# Confidence-based follow-up refinement for AI analysis

## When this applies

When AI analysis produces low-confidence results, prompt the user for clarification and re-analyze with the additional context.

## Why

Low-confidence results displayed without refinement erode user trust. The follow-up is text-only (no image re-send), so it's cheap and fast. The threshold (0.7) is tunable — lower values reduce prompts but risk showing inaccurate data.

## Examples

```typescript
// Server: check if follow-up is needed
const CONFIDENCE_THRESHOLD = 0.7;

export function needsFollowUp(result: AnalysisResult): boolean {
  return (
    result.overallConfidence < CONFIDENCE_THRESHOLD ||
    result.followUpQuestions.length > 0 ||
    result.foods.some((f) => f.needsClarification)
  );
}

// Server: refine with user's answer (text-only, no image re-send)
export async function refineAnalysis(
  previousResult: AnalysisResult,
  question: string,
  answer: string,
): Promise<AnalysisResult> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `Previous analysis: ${JSON.stringify(previousResult)}\nRefine based on user answer.`,
      },
      { role: "user", content: `Q: ${question}\nA: ${answer}` },
    ],
    response_format: { type: "json_object" },
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.choices[0]?.message?.content || "{}");
  } catch (err) {
    throw new Error("LLM returned malformed JSON during refinement", {
      cause: err,
    });
  }
  return analysisResultSchema.parse(parsed);
}

// Client: show follow-up UI conditionally
if (analysisResult.needsFollowUp) {
  setShowFollowUp(true); // Renders question + answer input
}
```

## Exceptions

Deterministic lookups (barcode scans, database queries) where results are either correct or not found.

## See Also

- [Always guard JSON.parse on LLM output](../conventions/always-guard-json-parse-llm-output-2026-05-13.md)
- [Zod union + transform for LLM output flexibility](zod-union-transform-llm-output-2026-05-13.md)
