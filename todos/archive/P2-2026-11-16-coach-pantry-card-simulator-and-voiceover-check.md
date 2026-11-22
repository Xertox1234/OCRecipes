---
title: "Coach pantry card: first look in the simulator, with a VoiceOver pass"
status: done
priority: medium
created: 2026-11-16
updated: 2026-11-22
assignee:
labels: [deferred, accessibility, react-native]
github_issue:
---

# Coach pantry card: first look in the simulator, with a VoiceOver pass

## Summary

The Coach pantry card (PRs 1895 and 1897) has never been drawn on a screen. Only automated
tests have exercised it. Look at it in the iOS Simulator, in every state, and fix what is wrong.

## Background

The design (`docs/superpowers/specs/2026-11-16-coach-grocery-read-and-pantry-card-design.md`)
promised a simulator and VoiceOver check. It was skipped on 2026-11-16 because getting a card
on screen needs either a paid model call or a hand-made card row, and paid model checks are
parked. A hand-made row costs nothing, so that is the route for this todo.

The card is `client/components/coach/blocks/write-cards/PantryWriteCard.tsx`, drawn through
`WriteCard.tsx`, with rows from `CardCheckRow.tsx` (which gained an optional `tag`).

## Acceptance Criteria

- [x] A pantry card with add, use and remove rows is on screen in the simulator, made from a
      seeded `coach_write_cards` row and its message block on the local database (no model call).
- [x] Screenshots, light and dark, of each state: fresh, a row unticked, saved (with the
      receipt line, including a skipped count), undone, and saved again after Undo.
- [x] Save, Undo and the second save change the local pantry as the receipt says.
- [x] VoiceOver reads each row's action, name and amount, and the tick state; Save and Undo
      are reachable and named.
- [x] The card holds up at the largest accessibility text size (no clipped buttons).
- [x] Any defect found is fixed in the same PR, test first.

## Implementation Notes

- The server only offers the tool to a Coach Pro user whose plan has `pantryTracking`; a
  seeded row sidesteps the tool but saving still checks the plan, so the local test user needs
  that plan.
- Payload shape: `pantryCardPayloadSchema` in `shared/schemas/coach-write-cards.ts`.
- Use the `/verify-ui` skill for the capture; pass the simulator UDID.
- A seed helper, if one is written, stays in a test or script folder and never runs on prod.

## Scope Contract

- **Mechanisms to use:** a local seeded card row; `/verify-ui`; existing card components.
- **Files in scope:** `client/components/coach/blocks/write-cards/**`, their tests, and at
  most one local-only seed script.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Local dev server and the iOS Simulator. No OTA and no phone needed.

## Risks

- A seeded row can differ from what a real turn writes; build it with the same payload builder
  the server uses (`buildPantryPayload` in `server/services/write-cards/pantry.ts`).

## Updates

### 2026-11-16

- Initial creation

### 2026-11-22

- Seeded with `server/scripts/seed-pantry-card-check.ts` (local `demo`, Coach Pro), opened from
  the Coach tab, iPhone 17 Pro simulator. Screenshots of all five states, light and dark, plus
  the largest text size before and after the fix: `/Volumes/U34Bolt/OCRecipes/tmp/pantry-card/`.
- Pantry after each step matched its receipt: save with spinach unticked and rice changed under
  the card → "2 added, 1 used · 1 skipped" (eggs 6→18, new oat milk with a 7-day best-before,
  milk 2→1.5, rice and spinach untouched); Undo restored all four rows and deleted the oat milk;
  saving again → "2 added, 2 used".
- Fixed at the largest accessibility size, test first: rows squeezed the name to one letter
  wide (`CardCheckRow` now stacks tag, name and amount), the saved receipt broke mid-word
  beside Undo (now above it), and Save/Undo labels were clipped by `Button`'s fixed 52pt
  height (card buttons now grow). Default size unchanged: rows 44pt, button 52pt.
- Criterion 4, accessibility tree (simulator): the accessibility tree gives every row "Action, name, amount"
  with checkbox checked/unchecked, and names "Update pantry" and "Undo"; VoiceOver speech, the
  save announcement and focus after Undo can only be heard on a device.
- Found, out of scope, filed: `todos/P2-2026-11-22-coach-pro-links-open-the-plain-chat-without-cards.md`
  (the `chat/<id>` link opens a screen with no cards) and
  `todos/P2-2026-11-22-button-fixed-height-clips-labels-at-large-text.md` (app-wide).
- Criterion 4 checked by the owner on the iPhone with VoiceOver (production OTA from
  e516f5ca1, which includes the card), 2026-11-22: "looks good", after a listen-through of
  the rows, a tick change, Save with its receipt, and Undo.
