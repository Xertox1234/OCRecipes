---
title: Unsanitized AI Prompt Parameter That Looked Server-Generated
track: bug
category: logic-errors
module: server
severity: critical
tags: [security, ai-prompting, prompt-injection, sanitization, audit-blind-spot]
symptoms: [A parameter destructured alongside server-generated values is actually user-controlled, Variable name like `question` does not look like 'user message' so it bypasses sanitization conventions, Prompt template interpolates raw user input]
applies_to: [server/services/photo-analysis.ts]
created: '2026-04-02'
---

# Unsanitized AI Prompt Parameter That Looked Server-Generated

## Problem

`refineAnalysis()` in `photo-analysis.ts` accepted a `question` parameter that was interpolated directly into the OpenAI prompt without `sanitizeUserInput()`. The parameter name and call-site context made it look like a server-generated string — it's called "question," it's destructured next to `analysisId` and `previousResult`, and the route handler passes it through cleanly. In reality it originates from the client's POST body: the user types a follow-up question about a photo analysis.

## Symptoms

- Prompt-injection vector present despite the service "looking sanitized"
- Audit checklist for AI inputs missed it because the name did not match `user_*` or `*_message` patterns
- Code review focuses on the route handler; the route handler passes the value through unchanged

## Root Cause

The existing AI sanitization convention documents sanitizing "user profile fields" and "user messages." `question` did not fit either mental category. It looked like an internal parameter because it was destructured alongside server-side values like `analysisId` and `previousResult`. The audit checklist says "trace every variable back to its source" — but in practice the indirection through route handler destructuring obscured the origin.

## Solution

Wrap the prompt interpolation with `sanitizeUserInput`:

```typescript
const safeQuestion = sanitizeUserInput(question);
const prompt = buildRefinementPrompt({
  previousResult,
  question: safeQuestion,
});
```

## Prevention

- When auditing AI services, do not rely on parameter names or call-site context to determine whether a value is user-controlled. Trace every string variable in the prompt template back to its ultimate origin (request body, query param, DB column populated by user input).
- If the chain touches user input at any point, sanitize it. Param names that look "internal" (`question`, `context`, `description`, `note`) are the riskiest because they bypass mental pattern-matching.
- Maintain an explicit list of sanitized boundaries: every function that takes a string and feeds it to an LLM should either sanitize or have an explicit comment "value is server-generated, not user input — verified at line X."

## Related Files

- `server/services/photo-analysis.ts` — `refineAnalysis()` now sanitizes `question`
- Audit: 2026-04-02-full M1
- `docs/legacy-patterns/security.md` — sanitize-all-user-fields-in-AI-prompts pattern

## See Also

- [Sanitize all user profile fields in AI prompts](../conventions/sanitize-all-user-profile-fields-ai-prompts-2026-05-13.md)
- [AI input sanitization boundary](../design-patterns/ai-input-sanitization-boundary-2026-05-13.md)
- [Sanitize DB-sourced content in AI prompts](../conventions/sanitize-db-sourced-content-ai-prompts-2026-05-13.md)
