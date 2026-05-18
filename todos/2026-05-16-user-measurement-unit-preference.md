---
title: "Add user measurement-unit preference (kg/lbs toggle for body weight)"
status: backlog
priority: medium
created: 2026-05-16
updated: 2026-05-18
assignee:
labels: [feature, database]
github_issue:
---

# Add user measurement-unit preference (kg/lbs toggle for body weight)

## Summary

The app stores and displays body weight exclusively in **kilograms** — there is
no way for a user to see weight in pounds. Add a per-user measurement-unit
preference and convert weight (and height) displays accordingly.

## Background

Originally filed (2026-05-16, audit finding L1) on a false premise — that weight
"always displays in imperial". Investigation on 2026-05-18 found the opposite:
`users.weight`, `users.goalWeight`, `users.height`, and `weight_logs.weight` are
all stored as **kg**, and every display surface (`WeightTrackingScreen`,
`GoalSetupScreen`, `WeightChart`) correctly labels them kg. The only defects
were two strings mislabelling kg values as `"lbs"` — those were fixed directly
(`server/services/profile-hub.ts:54`, `client/components/profile/MiniWidgetRow.tsx:119`).

What remains is a genuine **feature**: imperial-locale users have no way to view
weight in pounds. This is not a one-line fix — it needs a schema column, a
settings UI control, a migration, and display-time conversion. Re-specced from
`priority: low` to `priority: medium` accordingly.

## Open product decision

- **Default unit for existing + new users.** Current behaviour is metric (kg),
  so the migration default should be `metric` to preserve behaviour — but the
  product may want locale-based defaulting for new signups. Decide before
  implementing.

## Acceptance Criteria

- [ ] Add a measurement-unit column to `users` (e.g. `measurementUnit` —
      `"metric" | "imperial"`), migration defaults existing rows to `metric`
- [ ] Add a settings UI control (Profile / dietary-profile area) to change it
- [ ] Convert weight display at all sites when preference is `imperial`:
      `profile-hub.ts` payload, `WeightTrackingScreen`, `GoalSetupScreen`,
      `WeightChart`, `MiniWidgetRow`
- [ ] Convert weight **input** too (entry fields accept lbs and store kg)
- [ ] Audit height display sites for the same treatment
- [ ] kg↔lbs conversion is centralised in one shared util (no scattered factors)

## Implementation Notes

- Storage unit is confirmed **kg** for all body-weight/height columns — conversion
  happens only at the display/input boundary, never in storage.
- The two mislabel bugs are already fixed; do not re-touch them except to route
  the unit through the new preference.
- Weight tracking and goal-setup screens display AND accept weight — both
  directions need conversion.

## Dependencies

- Schema migration (`npm run db:push`)

## Risks

- Round-trip precision: converting kg→lbs for display then lbs→kg on save must
  not drift stored values. Prefer storing the raw entered value's kg equivalent
  once, not re-deriving on every render.

## Updates

### 2026-05-16

- Initial creation (audit 2026-05-16-unfinished-features, finding L1).

### 2026-05-18

- `/todo` executor halted: the todo premise was false. Confirmed all body-weight
  storage is kg; fixed the two `"lbs"` mislabel bugs directly. Re-specced the
  remaining work as a `priority: medium` feature with an explicit open product
  decision on the default unit.
