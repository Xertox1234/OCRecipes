---
title: "Revisit Gemini for recipe images: replace the retired dall-e-3 fallback and benchmark against Runware"
status: backlog
priority: medium
created: 2026-10-17
updated: 2026-10-17
assignee:
labels: [deferred, ai, images]
github_issue:
---

# Revisit Gemini for recipe images

## Summary

OpenAI removed `dall-e-3` from the API on 2026-05-12, so the three image fallbacks have been dead since May. The owner wants Gemini's image models (the "Nano Banana" line, `google/gemini-3.1-flash-image` on OpenRouter, newer `gemini-nano-banana-2.1` on Google) evaluated as the replacement fallback, and compared against the Runware primary on food-photo quality. OpenAI products may be dropped entirely (owner 2026-10-17).

## Background

Found 2026-10-17 while checking gpt-4o retirement dates against OpenAI's deprecations page ("Past deprecations → 2025-11-14: DALL·E model snapshots": `dall-e-2`/`dall-e-3` shut down 2026-05-12). Runware (`runware:400@6`, FLUX.2 klein) is primary at about $0.0006/image; DALL-E 3 was $0.04/image. Gemini image pricing found 2026-10-17 (secondary sources, confirm on Google's pricing page): Nano Banana 2.1 ≈ $0.034/image at 1K, Nano Banana 2 (3.1 Flash Image) ≈ $0.067 at 1K, Nano Banana Pro ≈ $0.134. So Gemini is a fallback / HQ-tier candidate, not a replacement for the cheap primary, unless the quality gap justifies ~50× the cost.

Google Vertex is already a pinned OpenRouter host (`PINNED_HOSTS.google`), so no privacy-policy change is needed for Gemini. Zero-retention routing applies the same way as for the Gemini text models.

## Acceptance Criteria

- [ ] No remaining `model: "dall-e-3"` in `server/` (grep is clean) and `dalleClient` is removed from `server/lib/openai.ts` if nothing else uses it.
- [ ] Image fallback goes through the Gemini image model via OpenRouter (pinned to google-vertex), using the same image-store save path (`saveRecipeImage`) and the same `buildImagePrompt` output.
- [ ] A side-by-side of ≥10 recipe hero prompts (use `evals/datasets/recipe-generation-cases.json` titles): Runware standard vs Runware HQ vs Gemini image, judged on food realism, "no text/logos" compliance, and cost per image. Record the result in the todo's Updates section.
- [ ] Decision recorded: Gemini as fallback only, or Gemini as the HQ tier (`RUNWARE_MODEL_HQ` replacement), or Gemini as primary. Primary only if the owner accepts the per-image cost.
- [ ] Each of the three call sites has a test asserting the fallback is invoked with the new model when Runware returns no image; existing mocked tests pass.
- [ ] `docs/solutions/` or the image memory updated with the chosen provider ladder.

## Implementation Notes

Call sites (all import `dalleClient` from `server/lib/openai.ts`):

- `server/services/recipe-generation.ts` — `generateRecipeImage` (~line 338; note the "DALL-E negative-prompt suffix" comment — Gemini image accepts natural-language exclusions, so keep the suffix but retitle the comment)
- `server/services/cookbook-cover.ts` — ~line 331
- `server/services/canonical-enrichment.ts` — ~line 157

Gemini image generation on OpenRouter is a chat-completions call with `modalities: ["image","text"]`; the image comes back as a base64 data URL in the message. Add a small `generateImageViaGemini(prompt, {width,height})` helper next to `server/lib/runware.ts` rather than threading it through `aiChat` (which is typed for text completions). Pin the host via the existing `hostForModel`. Lift the image model id into one constant so the next retirement is a one-line change.

Vertex retirement dates for the 3.x Gemini line are not yet published; Google sets them once the next stable ships and gives at least six months. Prefer the newest GA image model at implementation time.

## Scope Contract

- **Mechanisms to use:** the existing OpenRouter client config, `hostForModel`, `saveRecipeImage`, `buildImagePrompt`, and the existing per-service tests — nothing new beyond one image helper module.
- **Files in scope:** the three services above, `server/lib/openai.ts`, `server/lib/runware.ts` (read-only, for the helper's shape), one new `server/lib/gemini-image.ts`, and their co-located `__tests__/`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Independent of the gpt-4o / gpt-4o-mini text-model migration (OpenAI direct 2027-01-14, Azure 2027-04-14). Can land first.
- `OPENROUTER_API_KEY` set in prod (already is, per the 2026-10-06 routing work).

## Risks

- Gemini image output carries a SynthID watermark (invisible). Harmless for hero images; note it in the solution doc.
- Per-image cost is ~50× Runware; a bug that makes Gemini the hot path would be a real bill. Keep it behind the Runware-failed branch unless the decision says otherwise.
- `gemini-3.1-flash-image` on OpenRouter may lag the newest Google model (2.1 at time of writing); check the model list at implementation time.

## Updates

### 2026-10-17

- Initial creation. Supersedes the same-day `P2-2026-10-17-dall-e-3-image-fallback-retired.md` (folded in; owner asked for the Gemini angle).
