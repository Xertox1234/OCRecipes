---
title: 'DRY duplicated external-API call scaffolds — extract the invariant, not the whole call'
track: knowledge
category: design-patterns
module: server
severity: high
tags: [refactoring, openai, ai-services, dry, zod, maintainability]
symptoms: [N near-identical OpenAI/vision call functions differing only in model/tokens/prompt/schema, Copy-pasted content-guard → JSON.parse → safeParse → throw blocks across several AI services, Tempted to write one generic callXModel(config) wrapper with 10+ config fields]
applies_to: [server/services/*.ts]
created: '2026-05-30'
---

# DRY duplicated external-API call scaffolds — extract the invariant, not the whole call

## When this applies

You have several functions that each call an external API (OpenAI vision, a
classifier, an LLM completion) and they share a near-identical skeleton:

```
let response;
try { response = await openai.chat.completions.create({ ...varies... }, { timeout }); }
catch (e) { log.error(...); throw new Error("Failed to X. Please try again."); }
const content = response.choices[0]?.message?.content;
if (!content) throw new Error("No response from X");
let rawJson;
try { rawJson = JSON.parse(content); } catch { throw new Error("X returned invalid data"); }
const parsed = SCHEMA.safeParse(rawJson);
if (!parsed.success) { log.warn(...); throw new Error("X returned invalid data"); }
return parsed.data;
```

The instinct is to extract the *whole call* into a generic
`callVisionModel(config)` taking `model`, `maxTokens`, `temperature`,
`systemPrompt`, `userText`, `detail`, `timeout`, `schema`, **and** ~5 message
strings. Don't. That wrapper relocates the variation into a 13-field config
literal — it is rearrangement, not deletion, and it hides the meaningful
per-call differences behind config keys.

## Why

**Extract the invariant; keep the variation visible.**

- The **invariant** — the `content?` guard → `JSON.parse`-in-try → `safeParse`
  → `log.warn` → throw flow — is byte-identical across every caller and is the
  real maintenance hazard. If you later need to change how malformed AI JSON is
  handled (strip markdown fences, log raw content on parse failure), today you
  edit it in N places. Centralizing it is the genuine win, independent of line
  count.
- The **variation** — `model: MODEL_FAST, max_completion_tokens: 150, timeout:
  FAST` vs `MODEL_HEAVY, 2000, HEAVY` — is *semantically meaningful*. Seeing it
  inline tells the reader "the classify step is the deliberate cheap/fast path."
  Burying it in config fields makes the code less legible about what each call
  does.
- A 13-field wrapper is exactly what the maintainability checklist's Standard 4
  warns against: "skeptical of generic mechanisms that hide simple data-shape
  assumptions." The next audit would flag *your* wrapper.

Two implementation keys that make the extraction clean:

1. **Take the content string, not the SDK response object.** A helper typed
   `(content: string | null | undefined, schema, msgs)` needs zero OpenAI SDK
   type imports and is trivially unit-testable. The caller passes
   `response.choices[0]?.message?.content`.
2. **Pass the caller's domain messages in** so the existing error/log strings
   are preserved byte-exact. They reach logs and propagate as user-facing
   errors — regularizing them while refactoring is a drive-by behavior change.

## Examples

The canonical helper (`server/services/photo-analysis.ts`):

```typescript
function parseVisionResponse<T extends z.ZodTypeAny>(
  content: string | null | undefined,
  schema: T,
  msgs: { noResponse: string; invalid: string; validationFailed: string },
): z.infer<T> {
  if (!content) throw new Error(msgs.noResponse);
  let rawJson;
  try { rawJson = JSON.parse(content); }
  catch { throw new Error(msgs.invalid); }
  const parsed = schema.safeParse(rawJson);
  if (!parsed.success) {
    log.warn({ zodErrors: parsed.error.flatten() }, msgs.validationFailed);
    throw new Error(msgs.invalid);
  }
  return parsed.data;
}
```

Each caller keeps its `create()` + `catch` inline, then:

```typescript
const data = parseVisionResponse(
  response.choices[0]?.message?.content,
  recipePhotoResultSchema,
  {
    noResponse: "No response from recipe photo analysis",
    invalid: "Recipe photo extraction returned invalid data",
    validationFailed: "recipe photo extraction validation failed",
  },
);
// ...unique tail (cuisine enrichment, barcode validation) stays here
```

This collapsed 4 copies in `photo-analysis.ts` while keeping the per-call
model/token/timeout differences inline and visible.

## Exceptions

- **A caller whose failure behavior differs is NOT a duplicate.** In
  `photo-analysis.ts`, `refineAnalysis` returns the *previous valid result* on
  failure instead of throwing — routing it through a throwing helper would
  change behavior. It was correctly left untouched. Match on the *failure
  contract*, not just the surface shape.
- **Preserve the four-guard anti-silent-failure shape** (`docs/rules/ai-prompting.md`):
  the SDK-call try/catch stays narrow and inline; the helper throws on empty
  content, on `JSON.parse` failure, and on Zod failure — it must never return
  an empty-but-valid fallback (that ships a misleading 200).

## Related Files

- `server/services/photo-analysis.ts` — `parseVisionResponse` + its 4 callers
- `server/services/receipt-analysis.ts`, `server/services/menu-analysis.ts` —
  the canonical four-guard shape this helper preserves
- `docs/rules/ai-prompting.md` — the four-guard / no-silent-fallback rule

## See Also

- `.claude/skills/audit/maintainability-checklist.md` — Standard 4 (skeptical
  of generic mechanisms) and rule 0 (extract to delete, not rearrange)
- `docs/solutions/runtime-errors/unsafe-type-cast-zod-validation.md` — why the
  validate step throws on `safeParse` failure rather than casting
