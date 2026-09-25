---
title: "Coach Pro replies show raw markdown image links — MarkdownText renders no images or links"
status: backlog
priority: medium
created: 2026-09-25
updated: 2026-09-25
assignee:
labels: [deferred, ai-prompting, react-native]
github_issue:
human_led: true
blocked_reason: "Needs a product decision first: steer the model to recipe_card blocks via the prompt, strip or render image/link syntax in MarkdownText, or both."
---

# Coach Pro replies show raw markdown image links — MarkdownText renders no images or links

## Summary

When a Coach Pro reply draws on recipe-search tool results, the model writes markdown image syntax, for example `![Sauteed Italian Eggplant](https://img.spoonacular.com/recipes/648118-312x231.jpg)`. The chat bubble shows it as raw text. `client/components/MarkdownText.tsx` supports only `**bold**`, `*italic*`, bullet and numbered lists, and line breaks, per its doc comment. It has no image or link syntax.

## Background

Observed in the iOS simulator on 2026-09-25 (demo account, premium) while verifying the Hermes `crypto` fix. Ask Coach "What side dishes pair well?" returned a list in which each item was followed by a raw `![title](https://img.spoonacular.com/…)` line. Screenshot evidence from that session is not stored.

Medium: every Coach Pro answer that cites a recipe looks broken to the user. The structured alternative already exists: `recipe_card` coach blocks (`BLOCKS_SYSTEM_PROMPT` in `server/services/coach-blocks.ts`).

## Acceptance Criteria

- [ ] A Coach Pro reply that references recipes never shows raw `![…](…)` or `[…](…)` syntax in the bubble
- [ ] Decision recorded: steer the model to `recipe_card` blocks via the prompt, strip or render image/link syntax in `MarkdownText`, or both. Stripping in the client is the safety net regardless of the prompt.
- [ ] Test: a `MarkdownText` case with an image line and a link, asserting the chosen rendering (no raw syntax)

## Implementation Notes

- Client: `client/components/MarkdownText.tsx` (and its parser, imported at the top of the file). Rendering remote images inline in a chat bubble needs size limits and a decision on whether to allow arbitrary hosts. Stripping the image line, or showing just its alt text, is the simpler option.
- Prompt: the Coach Pro system prompt, plus `BLOCKS_SYSTEM_PROMPT` in `server/services/coach-blocks.ts`. Tell the model to present recipes as `recipe_card` blocks and never as markdown images. Prompt changes go through the `prompt-engineer` agent.
- Tool output: check whether the recipe-search tool result hands the model image URLs it doesn't need to repeat (`server/services/coach-tools.ts`).
