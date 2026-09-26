---
title: "Recipe chat shows and speaks raw markdown: assistant replies bypass MarkdownText"
status: backlog
priority: medium
created: 2026-09-25
updated: 2026-09-25
assignee:
labels: [deferred, react-native, accessibility, ai-prompting]
github_issue:
---

# Recipe chat shows and speaks raw markdown: assistant replies bypass MarkdownText

## Summary

`client/screens/RecipeChatScreen.tsx` renders assistant text raw: `RecipeStreamingFooter` uses `<ThemedText>{content}</ThemedText>` and the message list's `renderMessage` builds `accessibilityLabel` from raw `item.content`. Any `**bold**`, list markers, `![alt](url)` or `[text](url)` the recipe model emits is shown and read aloud verbatim. `server/services/recipe-chat.ts`'s `buildSystemPrompt` has no formatting guidance, so nothing stops the model emitting them.

## Background

Found by the mobile review of #1087 (2026-09-25), which fixed the same defect for Coach replies (`MarkdownText` drops images and shows links as text; `spokenMarkdown()` in `client/components/markdown-text-utils.ts` produces the matching spoken label). Recipe chat is a separate screen and prompt, so it was left out of that PR.

## Acceptance Criteria

- [ ] Recipe-chat assistant text (streaming footer and persisted messages) renders through `MarkdownText`, and its `accessibilityLabel` uses `spokenMarkdown()`, so no raw `![`, `](`, URL, `**` or list marker is shown or spoken.
- [ ] Decide with the product owner whether `recipe-chat.ts`'s system prompt should also forbid markdown images/links (as `nutrition-coach.ts` now does); record the decision.
- [ ] Tests first: a recipe-chat reply containing an image, a link, bold and a list renders and speaks cleanly.

## Implementation Notes

- Rendering sites: `client/screens/RecipeChatScreen.tsx` (`RecipeStreamingFooter`, `renderMessage`); the streaming text is already stripped of the recipe JSON fence by `stripStreamingRecipeJson`.
- Reuse `MarkdownText` and `spokenMarkdown` from `client/components/`; don't add a third markdown path.
- Check the recipe card area isn't affected (it renders from the parsed recipe, not the prose).

## Scope Contract

- **Mechanisms to use:** existing `MarkdownText` / `spokenMarkdown`; nothing new.
- **Files in scope:**
  - `client/screens/RecipeChatScreen.tsx`
  - `client/screens/__tests__/RecipeChatScreen.test.tsx`
  - `server/services/recipe-chat.ts` (only if the prompt decision says so)

## Dependencies

- None

## Risks

- Recipe replies may rely on line breaks for ingredient lists; confirm MarkdownText's list rendering reads well there.

## Updates

### 2026-09-25

- Filed by the /todo orchestrator from #1087's mobile review.
