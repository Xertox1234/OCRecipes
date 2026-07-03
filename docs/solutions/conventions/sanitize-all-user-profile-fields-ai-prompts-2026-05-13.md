---
title: Sanitize ALL user profile fields in AI prompts
track: knowledge
category: conventions
module: server
tags: [security, ai-safety, prompt-injection, sanitization, user-profile]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
---

# Sanitize ALL user profile fields in AI prompts

## Rule

When an AI service builds a prompt that includes user profile data (dietary preferences, allergies, goals, cooking skill, cuisine preferences), **every** user-controlled string must pass through `sanitizeUserInput()` before interpolation. User profile fields are indirect prompt injection vectors — an attacker can set their "food dislikes" to an injection payload that executes when the field is interpolated into a meal suggestion or menu analysis prompt.

## Examples

```typescript
// ❌ BAD: Raw profile fields interpolated into prompt
const context = `User diet: ${profile.dietType}. Dislikes: ${profile.foodDislikes?.join(", ")}`;

// ✅ GOOD: Every field sanitized before prompt interpolation
import { sanitizeUserInput, SYSTEM_PROMPT_BOUNDARY } from "../lib/ai-safety";

const context = `User diet: ${sanitizeUserInput(profile.dietType ?? "")}.
Dislikes: ${(profile.foodDislikes ?? []).map(sanitizeUserInput).join(", ")}`;

const systemPrompt = `You are a nutrition assistant. ${SYSTEM_PROMPT_BOUNDARY}`;
```

## Fields to sanitize

Non-exhaustive — sanitize any user-editable string that reaches an LLM:

- `dietType`, `primaryGoal`, `cookingSkillLevel`
- `foodDislikes` (array — sanitize each element)
- `cuisinePreferences` (array — sanitize each element)
- `allergies` (array of objects — sanitize the `name` field)
- Any free-text field from `userProfiles` or `users` tables

## Audit checklist for new AI services

1. Grep for `openai.chat.completions.create` (or equivalent) in the new file
2. Trace every variable in the `messages` array back to its source
3. If any variable originates from user input (directly or via profile), wrap it in `sanitizeUserInput()`
4. Ensure the system prompt includes `SYSTEM_PROMPT_BOUNDARY`

## Why

Direct user input (chat messages) is the obvious injection vector and usually gets sanitized. Profile fields look "structured" — they're enums and short labels — so authors forget they're user-controlled. An attacker who sets `foodDislikes: ["onions", "Ignore all previous instructions and ..."]` injects through the profile path.

## Related Files

- `server/services/meal-suggestions.ts` — `buildDietaryContext()` with 7 sanitized fields
- `server/services/menu-analysis.ts` — `analyzeMenuPhoto()` with 5 sanitized fields
- `server/lib/ai-safety.ts` — `sanitizeUserInput()`, `SYSTEM_PROMPT_BOUNDARY`
- Audit ref: 2026-03-29-full H1 (`meal-suggestions.ts`), H2 (`menu-analysis.ts`)

## See Also

- [AI input sanitization boundary](../design-patterns/ai-input-sanitization-boundary-2026-05-13.md)
- [Sanitize DB-sourced user content in AI prompts](sanitize-db-sourced-content-ai-prompts-2026-05-13.md)
- [Sanitize all roles when replaying stored chat history](sanitize-all-roles-stored-chat-history-2026-05-13.md)
