---
title: "XML close-tag escaping in LLM prompts"
track: knowledge
category: design-patterns
tags: [security, ai-safety, prompt-injection, xml, escaping]
module: server
applies_to: ["evals/**/*.ts", "server/services/**/*.ts"]
created: 2026-05-13
---

# XML close-tag escaping in LLM prompts

## When this applies

Any prompt that uses XML-style tag pairs (`<tag>…</tag>`) to frame untrusted content — user messages, AI responses being re-evaluated, notebook entries, etc.

## When NOT to use

Prompts that do not use XML delimiter tags (plain-text framing, numbered lists, JSON input format). Over-escaping HTML entities in non-tag contexts adds noise without benefit.

## Examples

```typescript
/**
 * Escape a literal close-tag so it cannot break out of its XML-style delimiter.
 * e.g. "</coach_response>" → "&lt;/coach_response&gt;"
 *
 * Defense-in-depth — even if the LLM only outputs a score or a fixed-schema
 * JSON response, escaping prevents a crafted input from injecting content
 * outside the tag boundary (e.g., a fake second <user_context> block).
 */
function escapeXmlCloseTag(text: string, tagName: string): string {
  return text.replace(new RegExp(`</${tagName}>`, "gi"), `&lt;/${tagName}&gt;`);
}

// Apply before interpolation:
const safeResponse = escapeXmlCloseTag(coachResponse, "coach_response");
const prompt = `<coach_response>\n${safeResponse}\n</coach_response>`;
```

## Scope of protection

This defends against close-tag injection only. It complements — but does not replace — `sanitizeUserInput()` (which strips injection patterns and control characters) and `SYSTEM_PROMPT_BOUNDARY` (which instructs the model to ignore role-change directives).

## Why tag + close-tag, not open-tag

Open tags (`<coach_response>`) inside the body are benign — they are already inside the delimited block. Only close-tags can prematurely end the block.

## Related Files

- `evals/judge.ts` — `escapeXmlCloseTag()`, applied to `userMessage`, `contextSummary`, `coachResponse` before `buildJudgePrompt()` interpolation
- Origin: 2026-04-18 audit L2

## See Also

- [AI input sanitization boundary](ai-input-sanitization-boundary-2026-05-13.md)
- [Sanitize ALL user profile fields in AI prompts](../conventions/sanitize-all-user-profile-fields-ai-prompts-2026-05-13.md)
