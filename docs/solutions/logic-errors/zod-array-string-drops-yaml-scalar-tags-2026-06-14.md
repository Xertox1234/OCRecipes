---
title: z.array(z.string()).catch() silently drops the whole array on a YAML scalar tag
track: bug
category: logic-errors
module: server
severity: medium
tags: [zod, yaml, gray-matter, frontmatter, validation, tags, silent-failure, data-integrity, typescript, server]
symptoms: [A frontmatter list (tags/symptoms) that clearly has values comes back empty after parse, 'Only SOME files lose their list — the ones whose list contains a number, `null`, or `true`/`false`', 'No error or warning beyond a generic ''tags missing'' — the data is gone, not flagged']
applies_to: [scripts/solutions-db/lib/parse.ts]
created: '2026-06-14'
---

# z.array(z.string()).catch() silently drops the whole array on a YAML scalar tag

## Problem

`tags: z.array(z.string()).optional().catch(undefined)` looks safe, but a single non-string
element makes the **entire array** fail validation, and `.catch(undefined)` swallows it to
`undefined` → the field is silently dropped. YAML turns `404` into a number, bare `null` into
null, and `true`/`false` (and under YAML 1.1, `yes`/`no`/`on`/`off`) into booleans — so a tag
list like `[api, fetch, 404, error-handling]` or `[..., default, null, schema-evolution]` parses
to `[]`, not `["404"]`/`["null"]`. The data is lost without a hard failure.

## Symptoms

- `tags`/`symptoms` empty in the store for files that visibly have them in frontmatter.
- Affected files always contain a status code (`404`/`401`/`503`), a `null`, or a boolean-ish token.
- A downstream tag-match (search, the inject hook) silently can't find those files.

## Root Cause

Two compounding behaviors: (1) Zod array validation is all-or-nothing — one bad element fails
the array; (2) `.catch()` converts that failure to a default instead of surfacing it. The YAML
parser (js-yaml via gray-matter) is the source of the non-string elements: it eagerly types
bare scalars. Note js-yaml 4.x uses the **core schema**, so only `true`/`false`/`null` (+ digits)
are special — `off`/`yes` stay strings — but that still covers the common status-code and `null`
tags.

## Solution

Coerce the scalar union to string at the element level so a numeric/null/boolean tag is kept,
not dropped:

```ts
tags: z
  .array(z.union([z.string(), z.number(), z.boolean(), z.null()]).transform((v) => String(v)))
  .optional()
  .catch(undefined),
// → [api, fetch, 404] becomes ["api","fetch","404"]; [..., null] becomes [..., "null"]
```

Apply the same to every author-typed list field (`symptoms`, etc.). A genuinely malformed element
(a nested object) still fails → `.catch` → empty, which is the correct fallback for truly bad input.

## Prevention

- For any author-typed YAML list, assume scalars get auto-typed; coerce, don't `z.string()`-gate.
- Lock it with a test that includes a numeric AND a `null`/boolean element (`[api, 404, null, true]`
  → `["api","404","null","true"]`).
- Be wary of `.catch()` on a field whose loss is silent — prefer surfacing into a `warnings[]`.

## Related Files

- `scripts/solutions-db/lib/parse.ts` — `FrontmatterSchema` tags/symptoms coercion
- `scripts/solutions-db/__tests__/parse.test.ts` — the numeric + null/boolean lock tests

## See Also

- [../conventions/gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md](../conventions/gate-over-two-derivations-of-same-function-is-blind-2026-06-14.md) — a parser bug like this is invisible to a parity gate that runs the same parser on both sides
