---
title: "Strategic personalization backlog"
status: backlog
priority: medium
created: 2026-05-10
updated: 2026-05-10
assignee:
labels: [deferred, personalization]
---

# Strategic Personalization Backlog

## Summary

Track the higher-effort personalization ideas deferred from the May 2026 personalization roadmap so they are not lost while the team focuses on macro-gap correctness, shared personalization context, pantry-aware scan suggestions, behavioral reminders, HealthKit signals, and Weekly Food Story.

## Background

The personalization deep-dive identified several strategic opportunities with strong long-term upside, but they depend on a richer shared context foundation, more user behavior data, or experimentation infrastructure. They were intentionally deferred in `docs/superpowers/plans/2026-05-09-personalization-roadmap.md` to keep the near-term plan focused on correctness and visible user value.

Deferred items:

- **Collaborative filtering on recipe favorites and scan history** — Feasible after Phase 1 shared context ships; minimum useful threshold: about 1,000 users with at least 5 recipe favorites or 10 recent scan interactions each so cold-start noise does not dominate.
- **Item-item recommendations from scan co-occurrence** — Feasible after pantry-aware scan suggestions prove value; minimum useful threshold: about 10,000 authenticated scans across 500+ items, with at least 20 meaningful co-occurrences per candidate pair before ranking goes live.
- **Preference elicitation UI with recipe thumbnail picks** — ✅ Spec approved 2026-05-10; feasible now because it ships independently via `cuisineOrigin` write-through and gives immediate signal even at low scale. Keep it skippable/editable and use it to seed later collaborative models. See `docs/superpowers/specs/2026-05-10-taste-picks-design.md`.
- **Behavioral archetype onboarding or progressive profiling** — Prefer progressive profiling over fixed onboarding labels after Phases 1 and 3; minimum useful threshold: at least 14 days of history with 6+ active log/scan days before inferring anything user-facing. Make labels optional, editable, and framed as helpful defaults rather than identity buckets.
- **LLM-generated notification copy with A/B testing** — Only feasible after experiment tracking exists and reminder timing is stable; require notification consent, category-level opt-down/mute controls, and hard frequency caps (for example, no more than 1 meal-log nudge per day). Keep model output inside approved templates so experimentation changes wording, not policy.
- **Event-driven adaptive goals beyond the current scheduled analysis** — Feasible only after shared context and reliable health/activity inputs exist; minimum useful threshold: 2-4 weeks of stable logs plus recent weight/activity data before suggesting any change. Require safety guardrails, user confirmation and easy revert, bounded goal deltas, and explicitly non-shaming language.

## Acceptance Criteria

- [x] Each strategic item has a short feasibility note after the shared personalization context service ships.
- [x] Items that require scale define the minimum useful data threshold before implementation begins.
- [x] Items that affect notifications include consent, frequency cap, and opt-down controls.
- [x] Items that affect health or goals include safety guardrails and non-shaming language requirements.
- [ ] Selected items are split into focused implementation todos before work starts.

## Implementation Notes

Use `docs/superpowers/plans/2026-05-09-personalization-roadmap.md` as the source of truth for sequencing. Revisit this backlog after Phase 1 and Phase 3 of that plan, when shared context and behavioral reminder infrastructure make the strategic items easier to evaluate.

## Dependencies

- `docs/superpowers/plans/2026-05-09-personalization-roadmap.md` Phase 1: shared personalization context
- Behavioral event data from scans, favorites, dismissals, meal logs, and notification interactions
- A/B testing or experiment tracking before LLM-generated notification copy
- Explicit product decisions for preference elicitation and behavioral archetypes

## Risks

- Collaborative filtering may be low-signal until the user base and recipe interaction data are large enough.
- Notification personalization can become intrusive without strict frequency caps and granular mutes.
- Behavioral archetypes can feel reductive if presented as fixed labels rather than adjustable preferences.
- Goal adaptation and predictive prompts can drift into pressure or shame without health-domain guardrails.

## Updates

### 2026-05-10

- Initial creation from the deferred strategic items in the personalization follow-up plan.
- Added concise feasibility notes, scale thresholds, notification guardrails, and adaptive-goal safety constraints from the personalization roadmap.
