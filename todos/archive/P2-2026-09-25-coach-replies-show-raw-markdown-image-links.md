---
title: "Coach Pro replies show raw markdown image links — MarkdownText renders no images or links"
status: done
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

- [x] A Coach Pro reply that references recipes never shows raw `![…](…)` or `[…](…)` syntax in the bubble
- [x] Decision recorded (user, 2026-09-25): **both.** The prompt steers recipes to `recipe_card` blocks, and `MarkdownText` strips any leftover syntax as a safety net. No inline images.
- [x] Prompt: the Coach Pro prompt tells the model to present recipes as `recipe_card` blocks and never as markdown images or links. The wording goes through the `prompt-engineer` agent.
- [x] Client: `MarkdownText` drops an image `![alt](url)` entirely (the line disappears if nothing else is on it) and renders a link `[text](url)` as its plain `text`. It is not tappable, and no URL is shown.
- [x] Test: a `MarkdownText` case with an image line and a link, asserting no raw `![`, `](` or URL text is rendered and the link text survives

## Implementation Notes

- Client: `client/components/MarkdownText.tsx` (and its parser, imported at the top of the file). Rendering remote images inline in a chat bubble needs size limits and a decision on whether to allow arbitrary hosts. Stripping the image line, or showing just its alt text, is the simpler option.
- Prompt: the Coach Pro system prompt, plus `BLOCKS_SYSTEM_PROMPT` in `server/services/coach-blocks.ts`. Tell the model to present recipes as `recipe_card` blocks and never as markdown images. Prompt changes go through the `prompt-engineer` agent.
- Tool output: check whether the recipe-search tool result hands the model image URLs it doesn't need to repeat (`server/services/coach-tools.ts`).

## Updates

### 2026-09-25

- **Product decision (user):** both. The prompt steers recipes to `recipe_card` blocks, and the client quietly strips any leftover image/link syntax (image line removed, link shown as its plain text). No inline images, so no host allowlist or size-limit work. Gate removed; ready for `/todo`.

- **Implemented:** `server/services/nutrition-coach.ts`'s universal persona block (both tiers) now tells the model to never write markdown images or links; `server/services/coach-blocks.ts`'s `BLOCKS_SYSTEM_PROMPT` now tells the model to present recipes as `recipe_card` blocks (image URL goes in the card's `imageUrl` field) instead of a markdown image/link — wording drafted by the `prompt-engineer` agent. `client/components/markdown-text-utils.ts`'s `parseInline` now renders `[text](url)` as plain `text`; `client/components/MarkdownText.tsx` drops a standalone `![alt](url)` line entirely, including when the line is a bullet/numbered list item whose only content was the image (a stray `-`/`1.` marker bug found independently by all three review passes and fixed). Reviewed by `code-reviewer`, `ai-reviewer`, and `mobile-reviewer` — no CRITICAL findings; one WARNING (the stray-marker bug) fixed on the branch, two narrow SUGGESTIONs (nested-bracket markdown syntax not stripped; theoretical quadratic regex cost on unterminated input, not reachable given the 1500-token response cap) left as-is per reviewer judgment that they are non-live/out of scope.

### 2026-09-25 (review repair)

- The mobile reviewer noted that `ChatBubble`'s assistant `accessibilityLabel` was built from the raw `content`, so after this fix VoiceOver/TalkBack still read `![alt](url)` and URLs while sighted users saw clean text. Added `spokenMarkdown()` to `markdown-text-utils.ts` (drops images, keeps link text without the URL, collapses the leftover gap) and the bubble's label uses it. Tests: the helper, and the bubble's label for a message containing an image and a link.
- AI review: the new blocks-prompt line told the model to present every search_recipes result as a recipe_card, but recipe_card requires calories, protein and prep time and search_recipes returns none of them, so the model would invent nutrition numbers in an authoritative-looking card. Rewritten: never put images or links in prose and refer to recipes by name; use a recipe_card only with real calories/protein/prep time from a tool, never estimated. Tests updated.
- Mobile review: `spokenMarkdown()` did not match the screen after all: it kept `**`, `*` and list markers, so VoiceOver read "star star"/"dash" on most replies. It is now built from the same pieces MarkdownText uses: the image-line filter moved into a shared `stripImageLines()` (used by both), then the list regexes and `parseInline`. Read-aloud (`useTTS`) now strips images before its link rule (it spoke an image as "!alt"). An assistant bubble whose content strips to nothing no longer renders. Recipe chat renders raw markdown too but is a different screen and prompt: filed as `todos/P2-2026-09-25-recipe-chat-renders-raw-markdown.md`.
