---
title: "getByLabelText with a multi-line expected string never matches under the default normalizer — it collapses the node's label but not your string; pass `normalizer: (t) => t`"
track: knowledge
category: conventions
tags: [testing, accessibility, react-native]
module: client
applies_to: ["client/**/__tests__/**/*.tsx"]
symptoms: ["getByLabelText throws Unable to find a label although the rendered multi-line accessibilityLabel equals the expected string", "a spoken-label assertion passes only after the expected text is flattened to one line"]
created: 2026-09-28
---

# getByLabelText with a multi-line expected string never matches under the default normalizer

## Rule

When an `accessibilityLabel` is genuinely multi-line (e.g. built by `spokenMarkdown()`, which joins lines with `\n`) and a test asserts it with an exact **string** matcher, pass an identity normalizer:

```tsx
screen.getByLabelText(`RecipeChef: ${EXPECTED_SPOKEN}`, {
  normalizer: (text) => text,
});
```

## Why

`@testing-library/dom`'s `matches()` (`node_modules/@testing-library/dom/dist/matches.js`) normalizes only the **node's** text, then compares it with `===` against `String(matcher)`:

```js
const normalizedText = normalizer(textToMatch); // default: trim + collapse all whitespace runs to " "
...
return normalizedText === String(matcher);       // the matcher string is NOT normalized
```

So the node's `"a\nb"` becomes `"a b"` while the expected `"a\nb"` stays as written, and they can never be equal. The failure is a false RED ("Unable to find a label"), not a masked mismatch. The easy wrong fix is to flatten the expected string to one line. That passes, but it stops pinning the line structure the screen reader actually receives.

Measured in `client/screens/__tests__/RecipeChatScreen.test.tsx` (recipe-chat raw-markdown todo, 2026-09-28): removing the identity normalizer from the two label assertions made both fail; restoring it made both pass.

## Exceptions

- A label needs no override only when it is unchanged by `text.trim().replace(/\s+/g, " ")`: no leading/trailing whitespace, and no whitespace between tokens other than a single ASCII space. `\s` matches more than newline/tab/repeated-space — it also collapses NBSP (`\u00A0`, the realistic UI case: a label like `"250\u00A0kcal"` pasted or generated with a non-breaking space), CR, FF, VT, and Unicode space separators (em space `\u2003`, thin space, narrow NBSP, ideographic space, etc.), plus the BOM (`\uFEFF`). Measured with `getDefaultNormalizer()` from `@testing-library/dom`: `"a b"` (plain ASCII space) is unchanged, while `"a\u00A0b"` (NBSP), `"a\rb"`, `"a\fb"`, `"a\vb"`, `"a\tb"`, `"a\nb"`, `"a\u2003b"`, `"a  b"` and `" a b "` all become `"a b"` (`changed=true`). A zero-width space (`\u200B`) is *not* matched by `\s` and is left unchanged — it isn't whitespace, so it does not trigger this false RED.
- A RegExp or function matcher receives the already-normalized node text, so write the pattern against collapsed whitespace, or use the identity normalizer there too.

## Related Files

- `client/screens/__tests__/RecipeChatScreen.test.tsx` — the two assistant-markdown label assertions
- `client/components/markdown-text-utils.ts` — `spokenMarkdown()` produces the multi-line label
- `client/components/ChatBubble.tsx` — the Coach precedent for the same label shape

## See Also

- [stripping-a-token-from-a-list-item-leaves-a-bare-marker](../logic-errors/stripping-a-token-from-a-list-item-leaves-a-bare-marker-2026-09-25.md) — the #1087 spoken-markdown work this label comes from
