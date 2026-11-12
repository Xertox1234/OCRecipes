---
title: "The tag-strip regex /<[^>]*>/g is quadratic on a run of \"<\" with no \">\" — strip only up to the last \">\"; excluding \"<\" from the class is fast but one pass leaves a reassembled tag"
track: bug
category: performance-issues
module: server
severity: high
tags: [security, performance, architecture, api]
symptoms: [The server stops answering while one recipe import is being parsed, A replace with a negated character class takes four times as long each time the input doubles, An import of a page made of repeated "<" characters pins one CPU core, A tag strip leaves a complete tag in its output when brackets are nested]
applies_to: ["server/services/recipe-import.ts", "server/services/**/*.ts", "server/lib/**/*.ts"]
created: 2026-11-12
---

# The tag-strip regex `/<[^>]*>/g` is quadratic on a run of `<` with no `>`

## Problem

`normalizeInstructions` in `server/services/recipe-import.ts` removed HTML tags from
imported recipe steps with `text.replace(/<[^>]*>/g, "")`. On text holding many `<` and
no `>`, that replace takes time proportional to the **square** of the length. A signed-in
user can import a page they host, the page may be megabytes, and Node runs the regex on
the one thread that answers every request (security audit 2026-11-12, H1).

Measured on the audit laptop (node v24.20.0), `"<".repeat(n)`:

| n      | `/<[^>]*>/g` | `stripTags` (the fix) |
| ------ | ------------ | --------------------- |
| 20,000 | 264.5 ms     | under 0.1 ms          |
| 40,000 | 1,020.7 ms   | under 0.1 ms          |
| 80,000 | 3,767.3 ms   | 0.1 ms                |

At the route's size limit the server would not answer for minutes. The 5-per-minute
import limiter does not help: one request is enough.

## Symptoms

- Time for one replace grows ×4 per doubling of the input.
- Health checks time out while a single import request is in flight.

## Root Cause

The pattern has no nested quantifier, so it does not look like the textbook
"catastrophic backtracking" shape and passes a casual read. The cost comes from the
global scan: at each `<` the engine reads `[^>]*` to the end of the string looking for a
`>`, finds none, fails, and starts again at the next `<`. With n openers that is
n + (n−1) + … reads.

A second trap, found in the same review: a **first** replace that removes the `>`
characters (here, turning `<br>` into a newline) can make input quadratic for the second
replace that was linear before.

## Solution

Keep the pattern, and run it only where it is linear — up to the last `>`. Inside that
part every `<` has a `>` after it, so each scan from a `<` ends in a match and no
character is read twice. After the last `>` nothing can match, so that tail is kept as
it is:

```ts
// server/services/recipe-import.ts
function stripTags(text: string): string {
  const last = text.lastIndexOf(">");
  if (last === -1) return text;
  return text.slice(0, last + 1).replace(/<[^>]*>/g, "") + text.slice(last + 1);
}
```

The output is the old output on every input: 0 differences over all 2,015,538 strings
of 1–8 atoms from `<`, `>`, `b`, `/`, space and newline.

### The first fix, and why it was replaced

The first fix excluded `<` from the class: `/<[^<>]*>/g`. It is linear, and it was
committed as "same on real HTML". Of the two reviewers who then looked at it, the one
who read the pattern found nothing; the one who generated a corpus found that one pass
of it **builds tags the old pattern never left**:

| Input                              | `/<[^>]*>/g`              | `/<[^<>]*>/g`               |
| ---------------------------------- | ------------------------- | --------------------------- |
| `<<b>script>alert(1)<</b>/script>` | `script>alert(1)/script>` | `<script>alert(1)</script>` |
| `<a title="1 < 2">link</a>`        | `link`                    | `<a title="1 link`          |

On the same 2,015,538-string corpus its output differed from the old one on 214,182
strings and held a complete `<…>` on 43,682 (old pattern and `stripTags`: 0). Nothing
renders step text as HTML today, so it was not exploitable — but a strip whose output
can hold a tag is a stored-markup hole waiting for the first HTML consumer.

Repeating that replace until nothing changes removes the leftover tags and is quadratic
again: 893 ms / 3,473 ms / 13,351 ms on `"<".repeat(n) + ">".repeat(n)` for
n = 20k / 40k / 80k.

### Tests

- Timing, wide margin: 60,000 `<` must finish in under 500 ms (old pattern about
  2,000 ms), and the same for 60,000 `<` followed by 60,000 `>` (guards the
  repeat-until-stable variant). String branch and HowToStep branch each.
- Output: the two rows of the table above, both branches.

## Prevention

- For any regex that runs on text from a fetched page, an upload or an AI reply, ask:
  "from each place a match can start, how far can it read before it fails?" If the
  answer is "to the end", and there can be many start places, it is quadratic.
- Time it: `"<".repeat(20_000)` and `40_000`. A ×4 step is the signature.
- **A faster pattern is a different pattern.** When a performance fix changes what a
  sanitising regex matches, compare old and new output over a generated corpus (every
  short string over the delimiters and two or three fillers), not over examples. Prefer
  a fix that bounds the input and keeps the pattern.
- A strip must not be able to produce what it strips: check the output of the corpus
  for a complete match of the pattern.
- When a replace is added in front of an existing one, re-time the existing one on the
  first one's output.

## Related Files

- `server/services/recipe-import.ts` — `stripTags`, `normalizeInstructions`
- `server/services/__tests__/recipe-import.test.ts` — "strips tags in linear time", "leaves no tag that nested brackets reassemble"

## See Also

- [data-parsed-from-a-remote-page-gets-the-manual-create-caps](../conventions/data-parsed-from-a-remote-page-gets-the-manual-create-caps-2026-11-12.md) — the other half of treating an imported page as hostile
- [ssrf-ipv6-mapped-hex-form-and-bracketed-hostname](../logic-errors/ssrf-ipv6-mapped-hex-form-and-bracketed-hostname-2026-10-29.md) — the fetch guard in front of this parser
