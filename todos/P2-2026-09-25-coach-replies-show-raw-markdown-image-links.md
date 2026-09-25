---
title: "Coach Pro replies show raw markdown image links — MarkdownText renders no images or links"
status: in-progress
priority: medium
created: 2026-09-25
updated: 2026-09-25
assignee:
labels: [deferred, ai-prompting, react-native]
github_issue:
---

# Coach Pro replies show raw markdown image links — MarkdownText renders no images or links

## Summary

When a Coach Pro reply draws on recipe-search tool results, the model writes markdown image syntax, for example `![Sauteed Italian Eggplant](https://img.spoonacular.com/recipes/648118-312x231.jpg)`. The chat bubble shows it as raw text. `client/components/MarkdownText.tsx` supports only `**bold**`, `*italic*`, bullet and numbered lists, and line breaks, per its doc comment. It has no image or link syntax.

## Background

Observed in the iOS simulator on 2026-09-25 (demo account, premium) while verifying the Hermes `crypto` fix. Ask Coach "What side dishes pair well?" returned a list in which each item was followed by a raw `![title](https://img.spoonacular.com/…)` line. Screenshot evidence from that session is not stored.

Medium: every Coach Pro answer that cites a recipe looks broken to the user. The structured alternative already exists: `recipe_card` coach blocks (`BLOCKS_SYSTEM_PROMPT` in `server/services/coach-blocks.ts`).

## Acceptance Criteria

- [ ] A Coach Pro reply that references recipes never shows raw `![…](…)` or `[…](…)` syntax in the bubble
- [x] Decision recorded (user, 2026-09-25): **both.** The prompt steers recipes to `recipe_card` blocks, and `MarkdownText` strips any leftover syntax as a safety net. No inline images.
- [ ] Prompt: the Coach Pro prompt tells the model to present recipes as `recipe_card` blocks and never as markdown images or links. The wording goes through the `prompt-engineer` agent.
- [ ] Client: `MarkdownText` drops an image `![alt](url)` entirely (the line disappears if nothing else is on it) and renders a link `[text](url)` as its plain `text`. It is not tappable, and no URL is shown.
- [ ] Test: a `MarkdownText` case with an image line and a link, asserting no raw `![`, `](` or URL text is rendered and the link text survives

## Implementation Notes

- Client: `client/components/MarkdownText.tsx` (and its parser, imported at the top of the file). Rendering remote images inline in a chat bubble needs size limits and a decision on whether to allow arbitrary hosts. Stripping the image line, or showing just its alt text, is the simpler option.
- Prompt: the Coach Pro system prompt, plus `BLOCKS_SYSTEM_PROMPT` in `server/services/coach-blocks.ts`. Tell the model to present recipes as `recipe_card` blocks and never as markdown images. Prompt changes go through the `prompt-engineer` agent.
- Tool output: check whether the recipe-search tool result hands the model image URLs it doesn't need to repeat (`server/services/coach-tools.ts`).

## Updates

### 2026-09-25

- **Product decision (user):** both. The prompt steers recipes to `recipe_card` blocks, and the client quietly strips any leftover image/link syntax (image line removed, link shown as its plain text). No inline images, so no host allowlist or size-limit work. Gate removed; ready for `/todo`.
