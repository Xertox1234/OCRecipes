---
title: "Stripping an embedded token from a line must also drop a now-empty list-item marker, not just a now-empty whole line"
track: bug
category: logic-errors
tags: [markdown, react-native, parsing, regex, chat]
module: client
applies_to: [client/components/MarkdownText.tsx]
symptoms: ["A bulleted or numbered list item whose only content was an embedded token (e.g. a markdown image) renders as a bare \"-\" or \"1.\" line after the token is stripped, instead of disappearing", "A doc comment or spec claims a token-only line disappears entirely, but the claim silently excludes the list-item variant of that line", "The whole-line drop check compares `strippedLine.trim() === \"\"`, which is false for a residual list marker (\"- \".trim() is \"-\", not empty)"]
created: 2026-09-25
severity: medium
---

# Stripping an embedded token from a line must also drop a now-empty list-item marker, not just a now-empty whole line

## Problem

`MarkdownText.tsx` strips markdown image syntax (`![alt](url)`) from each line before
classifying it as a bullet, a numbered item, or plain text, and drops a line entirely when
nothing but the image was on it. The drop check was `withoutImages.trim() === ""` — correct for
a plain standalone image line, but wrong for a list item: `"- ![alt](url)"` strips to `"- "`,
whose `.trim()` is `"-"`, not empty, so the line survived. It then failed `BULLET_REGEX` (which
requires at least one non-whitespace character after the marker) and fell through to the
plain-text branch, rendering a stray `"- "` (or `"1. "` for a numbered item) with no content.

## Symptoms

- A bulleted or numbered list item whose only content was an embedded image renders as a bare
  `"-"` or `"1."` line instead of disappearing.
- The component's own doc comment ("a line containing only an image disappears entirely — no
  line, no spacer") is contradicted for this one case.
- The bug is invisible to a test that only exercises a plain (non-list) standalone image line —
  the whole-line case passes while the list-item case silently fails.
- All three independently-dispatched review passes for the same diff (`code-reviewer`,
  `ai-reviewer`, `mobile-reviewer`) found this exact defect via the same input shape
  (`"- ![alt](url)"`), each constructing and running the literal regex/loop to confirm it —
  strong signal this is the natural next input a reviewer tries once a "drop the whole line"
  claim is on the table.

## Root Cause

The "was this line only the token?" check operated on the WHOLE line's residue, but a list item's
residue after stripping is `<marker><whitespace>`, not empty — the marker itself is real,
non-whitespace content that the naive emptiness check counts as "something else is on this line."
The fix must recognize a marker-only residue as equivalent to empty, not add a second unrelated
check.

## Solution

Broaden the "drop this line" predicate to match a residue that is either genuinely empty OR
nothing but a bullet/numbered marker with optional surrounding whitespace:

```typescript
const withoutImages = rawLine.replace(IMAGE_REGEX, "");
if (
  withoutImages !== rawLine &&
  /^\s*(?:[-*]|\d+\.)?\s*$/.test(withoutImages)
) {
  continue; // token-only line (bare or list-item) — drop entirely
}
```

The `withoutImages !== rawLine` guard keeps this scoped to lines where a token was actually
removed — a genuinely bare `"-"` line with no image on it is untouched by this branch, so normal
markdown authoring (a lone hyphen as content) is unaffected.

## Prevention

When a "strip token X from a line, then drop the line if nothing else is left" check sits
upstream of separate line-type classification (bullet/numbered/plain), test the token in
combination with EVERY line-type variant the classifier recognizes, not just the plain-text case.
A regex-based classifier that requires non-empty content after a prefix (like `BULLET_REGEX`'s
`(.+)`) will silently reclassify a marker-only residue as plain text rather than raising an error
— the residue doesn't error, it just renders wrong, so add a fixture per marker type
(`"- ![alt](url)"`, `"1. ![alt](url)"`) alongside the plain-line fixture whenever this pattern is
introduced or copied elsewhere.

## Related Files

- `client/components/MarkdownText.tsx` — the strip/drop loop (list of raw lines → classified
  elements) and `BULLET_REGEX`/`NUMBERED_REGEX` (imported from `markdown-text-utils.ts`)
- `client/components/__tests__/MarkdownText.test.tsx` — regression tests for the bulleted and
  numbered image-only-item cases

## See Also

- [../conventions/tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md](../conventions/tags-and-applies-to-are-a-two-part-routing-precondition-2026-08-06.md)
