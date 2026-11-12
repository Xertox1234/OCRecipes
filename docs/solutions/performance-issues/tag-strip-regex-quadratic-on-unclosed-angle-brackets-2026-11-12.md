---
title: "The tag-strip regex /<[^>]*>/g is quadratic on a run of \"<\" with no \">\" — exclude \"<\" from the class, and time any regex that runs on a fetched page"
track: bug
category: performance-issues
module: server
severity: high
tags: [security, performance, architecture, api]
symptoms: [The server stops answering while one recipe import is being parsed, A replace with a negated character class takes four times as long each time the input doubles, An import of a page made of repeated "<" characters pins one CPU core]
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

Measured on the audit laptop, `"<".repeat(n)`:

| n      | `/<[^>]*>/g` | `/<[^<>]*>/g` |
| ------ | ------------ | ------------- |
| 20,000 | 272.6 ms     | 0.1 ms        |
| 40,000 | 982.0 ms     | 0.3 ms        |
| 60,000 | about 2 s    | under 1 ms    |

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

Exclude `<` from the class. A tag cannot contain `<`, so the scan from one `<` stops at
the next one instead of running to the end:

```ts
// server/services/recipe-import.ts
// An HTML tag. `[^<>]`, not `[^>]`: with the latter a run of "<" that never
// closes is rescanned from every "<", which is quadratic in a page-sized string.
const TAG = /<[^<>]*>/g;
```

Behaviour on real HTML is the same. On malformed input one stray `<` can stay in the
text (`a <a<b> c` → `a <a c`); React Native renders it as text, so it is harmless.

The test is a timing test with a wide margin (60,000 characters must finish in under
500 ms; the old pattern takes about 2,000 ms, the new one under 1 ms), for both the
string branch and the HowToStep branch.

## Prevention

- For any regex that runs on text from a fetched page, an upload or an AI reply, ask:
  "from each place a match can start, how far can it read before it fails?" If the
  answer is "to the end", and there can be many start places, it is quadratic.
- A delimiter pattern excludes **both** delimiters from its class: `<[^<>]*>`,
  `\[[^\[\]]*\]`, `"[^"\n]*"`.
- Time it: `"<".repeat(20_000)` and `40_000`. A ×4 step is the signature.
- When a replace is added in front of an existing one, re-time the existing one on the
  first one's output.

## Related Files

- `server/services/recipe-import.ts` — `TAG`, `normalizeInstructions`
- `server/services/__tests__/recipe-import.test.ts` — "strips tags in linear time"

## See Also

- [data-parsed-from-a-remote-page-gets-the-manual-create-caps](../conventions/data-parsed-from-a-remote-page-gets-the-manual-create-caps-2026-11-12.md) — the other half of treating an imported page as hostile
- [ssrf-ipv6-mapped-hex-form-and-bracketed-hostname](../logic-errors/ssrf-ipv6-mapped-hex-form-and-bracketed-hostname-2026-10-29.md) — the fetch guard in front of this parser
