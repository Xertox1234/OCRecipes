---
title: "An output screen run on the raw AI reply misses what the reader decodes — screen the decoded JSON too, accept everything every reader accepts, and screen every path that shows the output"
track: bug
category: logic-errors
module: server
severity: medium
tags: [security, ai-prompting, api, architecture]
symptoms: [A coach or recipe-chat reply passes containsDangerousDietaryAdvice but the card on screen shows the phrase, A JSON escape such as   inside a fenced block hides a phrase from a regex screen, A reply with a stray fence marker or a trailing no-break space is decoded by the reader but not by the screen, A second feature reuses an AI generator and shows its output with no unsafe-advice screen]
applies_to: ["server/lib/ai-safety.ts", "server/services/chat-turn.ts", "server/services/recipe-chat.ts", "server/services/recipe-finder/**/*.ts", "server/services/write-cards/**/*.ts"]
created: 2026-11-12
---

# An output screen run on the raw AI reply misses what the reader decodes

## Problem

The unsafe-advice screen (`containsDangerousDietaryAdvice`, `containsUnsafeMedicalAdvice`
in `server/lib/ai-safety.ts`) ran its patterns on the reply **as written**. But much of
what the user reads is not the reply as written: coach blocks, recipe cards and write
cards are JSON inside the reply, shown after `JSON.parse`. JSON has its own escapes, so
`"fast for 3 days"` contains no match for `/fast\s+for\s+\d+\s+days/` in
the raw text and reads "fast for 3 days" on the card (security audit 2026-11-12, M1).

Fixing that by "also decode the fence" then failed three more times in review, each time
because the screen decoded **less** than a reader did:

1. A stray ` ``` ` earlier in the reply shifted which pieces the screen treated as
   fences; each reader looks for its own opening tag and was not shifted.
2. Recipe chat also reads a recipe written as a bare object with text around it (first
   `{` to last `}`); the screen only looked inside fences.
3. Recipe chat trims a fence body before parsing. `String.prototype.trim` removes a
   no-break space, a BOM and a line separator; `JSON.parse` refuses all three. Untrimmed,
   the screen's parse threw and the reader's did not.

And one path had no screen at all: Recipe Finder inside Coach Pro
(`server/services/recipe-finder/coach-turn.ts`) called the recipe-chat generator and
saved and showed its recipe without the check the recipe-chat route runs (M4).

## Symptoms

- Raw reply text passes the screen; the rendered card shows the phrase.
- A reviewer's probe corpus finds replies the reader decodes and the screen does not.
- A new consumer of an existing generator ships with no output screen, because the
  screen lives in the first consumer's route and not in the generator.

## Root Cause

The screen and the reader are two parsers of the same text, written apart. Anything the
reader accepts and the screen does not is a way past the screen. The first version made
the gap as wide as JSON's escape syntax; each repair narrowed it but kept the screen
modelled on "how the reply should look" instead of on "what any reader will accept".

## Solution

`containsUnsafeCoachAdvice(text)` is the one screen for a reply. It checks the raw text
and every JSON value any reader could decode from it:

```ts
// server/lib/ai-safety.ts
function decodedJson(text: string): unknown[] {
  const candidates: string[] = [];
  for (const segment of text.split("```")) {        // every piece, not every second one
    const start = segment.search(/[[{]/);
    if (start !== -1) candidates.push(segment.slice(start));
  }
  const open = text.indexOf("{");
  const close = text.lastIndexOf("}");
  if (open !== -1 && close > open) candidates.push(text.slice(open, close + 1));
  // … JSON.parse(candidate.trim()) for each, failures ignored
}
```

`containsUnsafeCoachAdviceInValue(value)` walks a decoded value and screens each string
on its own (values only, never keys; never joined — joined fields flag phrases nobody
reads). Use it wherever the code already holds the decoded object:

- Recipe Finder turn: `containsUnsafeCoachAdvice(text) || containsUnsafeCoachAdviceInValue(recipe)`
  → save and show `STANDARD_SAFETY_MESSAGE`, no card.
- Write-card tool arguments (`server/services/write-cards/tool-args.ts`): a Zod
  refinement, so unsafe card text fails the tool call and no card exists.
- Coach status lines (`coach-step-labels.ts`): an unsafe AI-written value is dropped.

## Prevention

- **The screen must be a superset of every reader.** When a reader changes how it finds
  or cleans JSON (a new fence tag, a trim, a fallback), the screen changes in the same
  PR. Prefer over-decoding: a piece that decodes for nobody costs one failed `JSON.parse`.
- **Probe with the reader, not with a list of strings.** The review probes that caught
  the three parity gaps ran reader and screen over the same generated replies and
  checked "reader decodes it ⇒ screen saw it". Each gap then got a fixed test row.
- **A new consumer of a generator needs the screen.** Grep for callers of
  `generateRecipeChatResponse` and the coach generators; each one that saves or shows
  output must call `containsUnsafeCoachAdvice` / `…InValue` and fall back to
  `STANDARD_SAFETY_MESSAGE`. Not yet traced for this: `recipe-generation.ts` and the
  photo recipe path.
- One message: `STANDARD_SAFETY_MESSAGE` in `ai-safety.ts`. Do not write a second copy.

## Related Files

- `server/lib/ai-safety.ts` — `containsUnsafeCoachAdvice`, `containsUnsafeCoachAdviceInValue`, `STANDARD_SAFETY_MESSAGE`
- `server/lib/__tests__/ai-safety.test.ts` — escape, stray-fence, bare-object and trim rows
- `server/services/chat-turn.ts`, `server/services/recipe-finder/coach-turn.ts`
- `server/services/write-cards/tool-args.ts`, `server/services/coach-step-labels.ts`

## See Also

- [calorie-restriction-regex-missed-4-digit-targets](calorie-restriction-regex-missed-4-digit-targets-2026-05-13.md) — an earlier gap in the same screen's patterns
- [lenient-parser-makes-the-fallback-guard-unreachable](lenient-parser-makes-the-fallback-guard-unreachable-2026-08-10.md) — another case of two parsers of one input disagreeing
