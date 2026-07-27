---
title: A branding phrase in an image prompt gets rendered AS lettering — a negative prompt is a weight, not a veto
track: bug
category: logic-errors
module: server
severity: medium
tags: [image-generation, runware, dalle, prompt-engineering, ai, cookbooks, negative-prompt, llm-prepass]
symptoms: [generated cover art has the entity's name set across it in display type, generated image contains garbled invented words along an edge, the app-drawn title collides with text baked into the generated image, negative prompt listing "text, letters, words" does not prevent lettering]
applies_to: [server/services/cookbook-cover.ts, server/services/image-art-direction.ts, server/lib/runware.ts]
created: '2026-07-26'
---

# A branding phrase in an image prompt gets rendered AS lettering — a negative prompt is a weight, not a veto

## Problem

`POST /api/cookbooks/:id/cover/generate` produced cover art with the cookbook's
name rendered into the image in large display type. A retry added invented
lettering (`CALIDDOBOOK`) along the bottom edge. The client draws the cookbook
title in real type over the image, so the result was the title twice — once
correct, once as pixels that could never be restyled, localized, or corrected.

The provider's default negative prompt already listed `text, watermark, logo,
label, letters, words`. It did not help.

## Root cause

Two independent causes, and fixing only the first is not enough.

**1. The positive prompt asked for a title.** It opened with
`"Editorial food photography for a cookbook cover."` and requested
`"generous empty space in the upper third for a title"`. Modern diffusion
models render text well, and a negative-prompt term is a **weight in the
sampler, not a hard constraint** — two explicit positive instructions to
produce a titled cover outvoted a generic `letters, words` negative.

**2. The entity name itself is the trigger.** This is the part that survives
prompt rewording, and it is a property of *what kind of noun* is being
interpolated:

| Interpolated phrase | What it denotes | What the model does |
| --- | --- | --- |
| `"Chicken Parmesan"` (recipe title) | a dish | renders the **food** |
| `"Sunday Bakes"` (cookbook name) | a brand | renders the **words** |

A recipe title has a depictable referent, so `subjectFor()` in
`image-art-direction.ts` can safely quote it. A cookbook name, playlist name,
collection name, or product line is a *branding phrase* — it names no object,
so the model's best interpretation of "make an image of this phrase" is to
write the phrase down.

## Solution

**Never interpolate a branding phrase into an image prompt.** Map it to
concrete nouns first, in a separate LLM pre-pass, and pass only the derived
subject to the image model.

```ts
// server/services/cookbook-cover.ts
export async function deriveCoverSubject(
  name: string,
  description?: string | null,
): Promise<string> {
  if (!isArtDirectorLLMEnabled()) return FALLBACK_COVER_SUBJECT;
  // …chat completion whose system prompt says: reply with dishes and
  // ingredients only, never a proper noun — "the description is fed to an
  // image model that will render any name it sees as written text".
  // Any error / bad JSON / schema failure → FALLBACK_COVER_SUBJECT.
}

// The name never reaches the image model.
const prompt = buildCoverPrompt(await deriveCoverSubject(name, description));
```

Three supporting details, all load-bearing:

1. **Strip every titling cue from the positive prompt.** No "cover", "title",
   "text", "book", or "space for a title". The layout intent survives as
   *"uncluttered negative space in the upper third of the frame"*, which asks
   for the composition without naming what goes there.
2. **Add a domain-specific negative prompt** naming the surfaces the scene
   actually carries writing on (`packaging`, `signage`, `chalkboard`,
   `recipe card`, `book cover`) — the generic default is too shallow.
3. **Guard against the pre-pass echoing the name back.** The LLM is told not
   to, but the whole failure mode is the name reaching the image model, so a
   returned subject containing the name (case-insensitively) is rejected in
   favor of the deterministic fallback. Skip the check for 1–2 character
   names, which would match incidentally inside almost any subject.

Mirror the existing `resolveArtDirection` pre-pass contract: fail-soft to a
deterministic value on every error path, and honour the same
`IMAGE_ART_DIRECTOR_LLM=off` kill switch.

## Prevention

- **Test the cause, not the symptom.** Asserting "the output image has no
  text" needs a real generation and a vision check. Asserting "the prompt
  contains no titling cue and no proper noun" is a fast unit test that pins
  the actual defect. `cookbook-cover.test.ts` uses an `it.each` over
  `cover|title|text|lettering|typography|headline|book`.
- **A dev server without `--watch` will lie to you.** `server:dev` is plain
  `tsx server/index.ts`. Two rounds of "the fix didn't work" here were the
  *original* code still running in a process started before the edit. Restart
  the server — or confirm a reload — before concluding a server-side fix
  failed.
- When adding image generation for a new entity, ask first: **does this
  entity's name denote a thing you could photograph?** If not, it needs a
  derivation step, not a better negative prompt.
