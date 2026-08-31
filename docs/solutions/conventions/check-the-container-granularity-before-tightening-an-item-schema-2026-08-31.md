---
title: "Before tightening one entry of a validation map, check what container the failure propagates through — and don't soften it into a dead affordance"
track: knowledge
category: conventions
tags: [ai-prompting, api, typescript, testing, zod, validation, coach]
module: shared
applies_to: [shared/schemas/**/*.ts, client/components/coach/**/*.ts]
symptoms: ["A per-screen or per-type schema is made strict while its siblings strip unknown keys", "A single invalid element removes a whole list from the UI", "Reaching for .catch() to stop one bad element from failing a z.array", "A validation tightening whose real-world failure rate cannot be observed in production"]
created: '2026-08-31'
---

# Check the container's failure granularity before tightening an item schema

## Rule

When you tighten validation on **one entry** of a map of schemas — switching it from stripping
unknown keys to `.strict()`, or adding a required field — the user-visible cost is not decided by
that entry. It is decided by the **container** the failure propagates through.

Find every consumer of the schema and ask what unit each one drops when validation fails. Write
the answer into the comment beside the tightening, and cover the worst container with a test.

## Smell patterns

- A comment justifying a strict schema that names only the friendliest consumer ("only the
  offending block is dropped") when a second consumer has coarser granularity.
- A schema map where entries differ in strictness with no note saying why.
- Tests for a newly-strict schema that all go through one consumer, when two exist.
- A tightening whose failure is invisible in production — no metric, no breadcrumb, `logger.debug`.

## Why

`screenParamSchemas` in `shared/schemas/coach-blocks.ts` gained a `.strict()` entry so an
AI-emitted param the screen does not read is **rejected** rather than silently stripped — the
defect class being killed was a param that went nowhere. Its four siblings strip.

That schema has two consumers, and they differ:

- `actionCardSchema` — one card. A rejection costs that one button. This is the case the comment
  originally described.
- `suggestionListSchema` — `items: z.array(z.object({ …, action: … }))`. **`z.array` fails
  wholesale**, so one item carrying an unrecognised param drops *every* suggestion in the list.

The amplification is not new — any validation failure inside that array already behaved this way
— but the tightening adds a *new way to reach it*, on a screen the coach's system prompt never
describes params for, which makes an invented field the most likely guess. The cost of the
ruling is a whole list, not a button, and the comment said otherwise.

### The tempting fix that is worse

The obvious containment is `.catch(null)` on the item's action union, which is already
`z.union([navigateAction, z.null()]).nullable()` — a failed action would degrade to "no action"
and the other N−1 suggestions would survive.

**Reject it here.** A suggestion that renders, looks tappable, and does nothing is precisely the
silent-failure class the strict entry exists to eliminate — the same shape as the param that went
nowhere. A dropped list is louder, and loud is the property being bought. Softening the blast
radius would trade a visible failure for an invisible one and undo the reason for the change.

This is a genuine trade, not a free win: record it where the next reader will meet it, and make
it revisitable with evidence rather than argument (see Exceptions).

## Examples

```ts
// GOOD — the comment names the worst container, not the friendliest one.
// `.strict()` — unlike the sibling entries (which STRIP unknown keys), an unknown
// or misspelled field here is REJECTED. filterValidBlocks drops the CONTAINING
// block: for an action_card that is one card, but for a suggestion_list it is
// every item in the list, because z.array fails wholesale.
RecipeBrowserModal: z
  .object({
    mealType: z.string().optional(),
    plannedDate: z.string().optional(),
    searchQuery: z.string().optional(),
    planDays: z.array(mealPlanDaySchema).optional(),
  })
  .strict(),
```

Cover the coarse container explicitly — a test that only goes through the fine-grained consumer
understates the change:

```ts
it("drops the WHOLE suggestion list when one item carries an unknown param", () => {
  const list = { type: "suggestion_list", items: [validItem, itemWithStrayDateField] };
  expect(suggestionListSchema.safeParse(list).success).toBe(false);
});
```

And pin the mechanism, not just the outcome, so the test cannot pass for an unrelated reason:

```ts
expect(result.error.issues.some((i) => i.code === "unrecognized_keys")).toBe(true);
```

## Exceptions

- **A single-consumer schema** needs none of this — granularity is whatever that consumer does.
- **Stripping is right when the field is real but the reader is elsewhere.** The sibling entries
  strip because they carry fields real callers rely on; deleting those would break working paths.
  Strictness is for a screen whose param vocabulary is closed.
- **Make the ruling falsifiable.** As shipped, this trade cannot be evaluated in production: the
  client drop (`filterValidBlocks`) logs nothing and the server-side drop is `logger.debug`. Add a
  breadcrumb on drop before arguing about the rate — otherwise a revisit is opinion against
  opinion.

## Related Files

- `shared/schemas/coach-blocks.ts` — `screenParamSchemas`, the strict entry, and
  `validateNavigateParams`; the header comment documents the by-hand sync with the ParamList
- `client/components/coach/coach-chat-utils.ts` — `filterValidBlocks`, which decides the unit
  dropped
- `shared/schemas/__tests__/coach-blocks.test.ts` — the `suggestion_list` amplification test

## See Also

- [z.array(z.string()).catch() silently drops the whole array on a YAML scalar tag](../logic-errors/zod-array-string-drops-yaml-scalar-tags-2026-06-14.md) — the same `z.array` all-or-nothing behaviour, and the `.catch()` this doc argues against reaching for
- [A Zod ingestion schema stricter than its readers is a new silent failure](../logic-errors/zod-ingestion-validation-stricter-than-readers-2026-05-29.md) — the failure mode when tightening runs ahead of consumers
- [Use Zod .strict() to phase-gate future request fields](zod-strict-phase-gate-request-fields-2026-05-13.md) — the case where strictness is the default-right choice
- [AI output field whitelisting (Zod enum, never z.string)](ai-output-field-whitelisting-2026-05-13.md) — constraining what a model may emit at the boundary
