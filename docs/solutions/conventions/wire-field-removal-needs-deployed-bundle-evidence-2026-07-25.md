---
title: Removing a field from a response body needs deployed-bundle evidence — a source grep only proves the current tree has no reader
track: knowledge
category: conventions
module: server
tags: [api, wire-contract, ota, eas-update, dead-code, response-body, backwards-compatibility]
applies_to: ["server/routes/**/*.ts", "shared/types/**/*.ts"]
created: '2026-07-25'
last_updated: '2026-07-25'
---

# Removing a field from a response body needs deployed-bundle evidence — a source grep only proves the current tree has no reader

## Rule

Before deleting a field from an API response body, `grep` is necessary but **not
sufficient**. A clean grep proves no reader exists in the **current source
tree**. It says nothing about readers in **bundles already running on users'
devices**.

Treat a field as safe to remove only when both hold:

1. No reader in current source (the grep), **and**
2. Every client bundle that could still read it is out of circulation.

If (2) is not established, **keep the field and document why**, with the
condition under which the trim becomes safe. Removing a field the client no
longer *declares* is not the same as removing one no client *reads*.

**Date the window from the SHIP date, and verify it from git.** The whole
decision reduces to "how long ago did the last reader stop shipping," so that
one date is load-bearing — and it is easy to get wrong by grabbing a nearby,
plausible-looking date instead of the merge commit's. Never take it from:

- a **todo/issue filename or filing date** — work is filed days before it ships;
- the date the field was **added** — an adjacent commit touching the same
  symbol, and the easiest one to grab by mistake;
- "the last release" from memory.

Confirm it: `git log --format='%h %ad %s' --date=short -S'<fieldName>' -- client/ shared/`
shows every commit that changed the symbol's occurrence count, and
`git show <sha> -- client shared` tells you which one removed it versus added it.

## Smell patterns

- A cleanup PR removes a client-side type field, and a follow-up proposes
  trimming the matching server field "since nothing reads it now."
- The justification for a wire-contract change is a `grep` result with no
  accompanying statement about deployed versions.
- A comment says a field is "kept — it is displayed" but the render path
  actually consumes a *derived* value (a computed flag, a partition, a
  selector output), not the raw field.
- The removal date in the justification is cited bare, with no commit sha —
  or matches a todo filename rather than a merge commit.

## Why

This app ships JS over the air. Two properties make a source grep misleading:

- **EAS Updates apply on the second cold start.** A user who opens the app once
  after an update is still running the previous bundle. See
  [reference: EAS Update (OTA)] in `CLAUDE.md` → Development Commands.
- **There is an embedded-vs-OTA split.** Users on the store build run whatever
  JS was embedded at build time until they receive and apply an update. That
  population is not bounded by "days since the source change."

So the window in which an old reader can still hit the endpoint is measured in
**app-store and update-adoption time**, not in commits.

The asymmetry matters: keeping a dead field costs a few bytes per response.
Removing one that a live bundle reads produces `undefined` in that bundle's
render path — and it is **not reversible for the affected user**, who cannot
roll back to a server that still sends it. Cost is small and recoverable in one
direction, unbounded and unrecoverable in the other.

A second trap: a grep hit on the field name is not automatically a reader.
`NutritionDetailScreen.tsx` matches `nutriScore`, but it renders
`partition.nutriScore` — a `ScanFlag` built from `orderedFlags` by
`nutrition-detail-flags-utils.ts` — not the raw scalar. Classify each hit as
*reader*, *derived-value coincidence*, or *test fixture* before concluding
anything.

## Examples

`server/routes/nutrition.ts`, `buildBarcodeResponseBody` — the raw `novaGroup`
and `nutriScore` scalars are consumed as `evaluateUniversalFlags` input and
reach the user only as the computed `processing:ultra` / `nutriscore:<grade>`
flags. The client-side `NutritionData.novaGroup`/`nutriScore` fields were
deleted by #708 (`13bf5059`), which **shipped 2026-07-24**, and a follow-up todo
offered "drop the two fields from the response body entirely if confirmed
unused."

Resolution (PR #713): **kept the fields, corrected the comment.** The grep was
clean, but the client fields had been gone for a single day — well inside the
window where pre-cleanup bundles are live. The comment now records the finding,
the reason, and the condition under which the trim becomes safe, so the next
reader does not re-derive it:

```ts
// `novaGroup`/`nutriScore` are deliberately NOT trimmed, but they are not
// "displayed" either — an earlier version of this comment said so and was
// wrong. [...] They stay on the wire for compatibility with already-shipped
// bundles that predate the removal of the client-side
// `NutritionData.novaGroup`/`nutriScore` fields, which SHIPPED 2026-07-24
// (#708, `13bf5059`) [...] Safe to drop from the response body once those
// bundles are out of circulation.
```

Note what the comment does that a bare deletion-or-not decision does not: it
converts an open question into a recorded decision plus a **trigger condition**.

## Exceptions

- **Never-shipped fields.** A field added and removed within the same unreleased
  change has no deployed readers by construction — trim freely.
- **Licence/privacy-driven strips.** Fields that must not reach the client at all
  (the ODbL-licensed `additivesTags`/`categoriesTags` in the same destructure)
  are removed on legal grounds regardless of readers; compatibility does not
  outrank that.
- **Server-internal shapes.** Types that never cross the wire are ordinary dead
  code — the grep is sufficient.

## Related Files

- `server/routes/nutrition.ts` — `buildBarcodeResponseBody`, the destructure and
  its comment
- `client/screens/nutrition-detail-flags-utils.ts` — builds `partition.nutriScore`
  from `orderedFlags`; the derived-value coincidence
- `todos/archive/P3-2026-07-24-nutrition-route-stale-nova-comment.md` — the
  decision record

## See Also

- [wire optional defense-in-depth parameters](wire-optional-defense-in-depth-parameters-2026-05-13.md) — the complementary direction: adding a parameter requires wiring every call site
- [../logic-errors/duplicated-flag-composition-desyncs-display-surfaces-2026-07-24.md](../logic-errors/duplicated-flag-composition-desyncs-display-surfaces-2026-07-24.md) — the same "one value, several surfaces" confusion that makes a grep hit hard to classify
