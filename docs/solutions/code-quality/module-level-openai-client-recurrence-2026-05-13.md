---
title: "Module-level OpenAI client keeps reappearing — structural fix required"
track: bug
category: code-quality
tags: [openai, module-level-init, testing, anti-pattern, recurrence]
module: server
applies_to: ["server/services/*.ts"]
symptoms:
  - "Any test importing the service file crashes because AI_INTEGRATIONS_OPENAI_API_KEY is missing"
  - "Pure helper functions in service files can't be unit-tested in isolation"
  - "The same anti-pattern appears in 7 of 8 AI service files"
created: 2026-02-24
severity: medium
---

# Module-level OpenAI client keeps reappearing — structural fix required

## Problem

Every new AI service file in the codebase instantiates `new OpenAI({...})` at module scope. As of Phase 10 this had happened in seven of eight services (`food-nlp.ts`, `voice-transcription.ts`, `nutrition-coach.ts`, `menu-analysis.ts`, `photo-analysis.ts`, `recipe-generation.ts`, `routes/_helpers.ts`). The "document and hope" approach has failed five times. The recurring root cause needs a structural fix.

## Symptoms

- Tests that import the service for a pure helper crash with "Missing OPENAI_API_KEY"
- `meal-suggestions.ts` was fixed (lazy singleton) but the lesson did not propagate
- New services reintroduce the anti-pattern because the OpenAI SDK examples all show top-level init

## Root Cause

Four reinforcing factors:

1. The OpenAI SDK examples in docs show top-level init.
2. Module-scope init is the shortest code to write.
3. Developers don't think about testability when scaffolding a new service.
4. No automated check (lint rule, CI test) catches it.

## Solution

Structural fix — one of:

**Option A: Shared lazy singleton in a utility file** (preferred)

```typescript
// server/services/_openai-client.ts
let _client: OpenAI | null = null;
export function getOpenAI(): OpenAI {
  if (!_client) {
    _client = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _client;
}
```

All services import `getOpenAI()` and call it inside their public functions. Tests can import the module without triggering construction.

**Option B: ESLint rule** banning `new OpenAI(` at module scope.

## Prevention

- Add the lazy singleton (or lint rule) before writing the next AI service.
- Code review checklist: any module-level external-client constructor is a CRITICAL finding.

## Related Files

- `server/services/food-nlp.ts`
- `server/services/voice-transcription.ts`
- `server/services/nutrition-coach.ts`
- `server/services/menu-analysis.ts`
- `server/services/photo-analysis.ts`
- `server/services/recipe-generation.ts`
- `server/routes/_helpers.ts`
- `server/services/meal-suggestions.ts` — already uses the lazy pattern (template)

## See Also

- [Lazy singleton external clients for test importability](../conventions/lazy-singleton-external-clients-test-import-2026-05-13.md)
