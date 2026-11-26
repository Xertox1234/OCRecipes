---
title: "Label calorie range: two misreads it still lets through"
status: backlog
priority: low
created: 2026-11-26
updated: 2026-11-26
assignee:
labels: [deferred, server]
github_issue:
---

# Label calorie range: two misreads it still lets through

## Summary

`labelEnergyAgrees` in shared/lib/label-energy.ts guards the Coach's label
reads: the phone read, the server photo read, and the `/label` endpoint. The
nutrition review's confirmation pass found two low misreads it still accepts.

## Background

1. **Carbs with fibre unread count for nothing in the floor.** This is so EU
   labels, which list fibre outside the carbs, and sugar-alcohol bars are
   never refused. The `/label` body has no fibre field, so that endpoint always
   checks this way, and so does the server photo read when the model returns
   no fibre. A carb-heavy, low-fat label that loses a digit gets through:
   200 kcal with 50 g carbs, 1 g protein and 0 fat, read as "20".
   - Options: count unread-fibre carbs at about 1 kcal a gram, or add an
     optional `fibre` field to the `/label` body (client/lib/coach-label-pre-read.ts
     and server/routes/chat-barcode.ts).
2. **The 250 kcal alcohol room swallows kilojoules on small foods.** On the
   server and `/label` paths, kJ read as kcal passes when the macros make about
   95 kcal or less. For example, a 60 kcal snack read as 251 is logged. A
   ratio test alone can't tell this from light beer.
   - Option: allow the alcohol room only when fat and protein are about 0.

## Acceptance Criteria

- [ ] The 200-kcal / 50 g carbs label read as "20" is refused on the `/label`
      path, while the fibre-cereal, EU-label and keto-bar rows in
      shared/lib/**tests**/label-energy.test.ts still pass.
- [ ] A decision is recorded on the kJ-on-small-foods gap: fixed, or accepted
      with a test documenting it.
