# Design: Audit Skill Agent Mapping Update

> **Date:** 2026-05-02
> **Trigger:** Six new specialist agents added to `.claude/agents/` since the audit skill was last updated. The skill's domain mapping was not updated to reflect them, meaning audits were routing work to the wrong agents.

## Problem

The audit skill's domain mapping table references 8 agents across 6 domains. Since the mapping was written, 6 specialist agents were added:

| New agent                  | What it covers                                                         |
| -------------------------- | ---------------------------------------------------------------------- |
| `accessibility-specialist` | VoiceOver/TalkBack, WCAG, modal focus trapping, touch targets          |
| `api-specialist`           | Express route patterns, premium gates, error response standards        |
| `architecture-specialist`  | Service/storage layering, dependency direction, SSE patterns           |
| `performance-specialist`   | FlatList memoization, useCallback stability, streaming UI, Promise.all |
| `quality-specialist`       | Error handling, naming, code organization, documentation               |
| `typescript-specialist`    | Type guards, Zod schemas, navigation typing, discriminated unions      |

Two agents in the old mapping were incorrect for their domains:

- `architecture` used `database-specialist` + `ai-llm-specialist` — neither covers layering
- `performance` used `database-specialist` + `rn-ui-ux-specialist` — `rn-ui-ux-specialist` focuses on UX design, not performance

Additionally, `accessibility` had no domain at all, meaning accessibility findings only surfaced when a camera/UX agent happened to notice them (as in audits 2026-05-02, 2026-04-28).

The `code-reviewer.md` agent also has no accessibility section, meaning code reviews miss the entire accessibility domain.

## Scope

Two files change:

1. `.claude/skills/audit/SKILL.md` — replace domain mapping table, update batch instruction
2. `.claude/agents/code-reviewer.md` — add §14 Accessibility checklist section

No other phases of the audit workflow change (setup, discovery prompts, fix, defer, close, codify all stay the same).

## Change 1: audit/SKILL.md — New Domain Mapping

Replace the 6-row table with this 7-row table:

| Audit Domain            | Primary Agent(s)                                                      | What They Check                                                                                      |
| ----------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `security`              | `security-auditor` + `ai-llm-specialist`                              | IDOR, rate limiting, JWT, SSRF, prompt injection, AI safety                                          |
| `performance`           | `performance-specialist` + `database-specialist`                      | FlatList memoization, useCallback stability, streaming UI, Promise.all, N+1 queries, missing indexes |
| `data-integrity`        | `database-specialist` + `nutrition-domain-expert`                     | Soft deletes, polymorphic FK orphans, cache dedup, nutrition accuracy                                |
| `architecture`          | `architecture-specialist` + `api-specialist`                          | Service/storage layering, dependency direction, route module structure, SSE patterns, singleton init |
| `code-quality`          | `quality-specialist` + `typescript-specialist` + `testing-specialist` | Error handling, naming, type guards, Zod schemas, nav typing, test coverage gaps                     |
| `camera`                | `camera-specialist` + `rn-ui-ux-specialist`                           | Permissions, scan debouncing, frame processors, lifecycle management                                 |
| `accessibility` _(new)_ | `accessibility-specialist` + `rn-ui-ux-specialist`                    | Modal focus trapping, VoiceOver/TalkBack announcements, touch targets, WCAG contrast, aria-invalid   |

Update the full/pre-launch batch instruction from:

> "batch in groups of 4-5, not all at once"

to:

> "batch in groups of 4 (e.g., four batches: 4, 4, 4, 3), not all at once"

The `code-quality` domain now has 3 agents; the batch math changes from 12 to 15 agent launches across 4 batches of 4+4+4+3.

## Change 2: code-reviewer.md — Add §14 Accessibility

Add a new section **§14 Accessibility** after the existing §13 Documentation & Todos section. Content:

**Checklist items:**

- `accessibilityViewIsModal={true}` on the inner container of every modal, bottom sheet, overlay, and confirmation dialog — without this, VoiceOver users can navigate behind the modal
- `accessibilityLiveRegion` (Android) always paired with `AccessibilityInfo.announceForAccessibility` in a `useEffect` (iOS) — neither alone is sufficient
- `accessibilityLiveRegion="assertive"` only for errors; `"polite"` for loading/progress states — assertive for loading interrupts users mid-sentence every 500ms
- Every `TextInput` with a validation error uses `aria-invalid={true}` + `<InlineError>` component — NOT `accessibilityState={{ invalid: true }}` (TypeScript error) and NOT raw `<Text style={styles.error}>` (invisible to screen readers)
- Decorative icons inside `Pressable`/`TouchableOpacity` have `accessible={false}` — without this VoiceOver announces each icon as a separate focus element
- Interactive elements meet 44×44pt minimum touch target (WCAG 2.5.5); use `hitSlop` for small visual elements
- Role/state pairs are correct: `role="radio"` → `accessibilityState={{ selected }}`, `role="checkbox"` → `accessibilityState={{ checked }}`; grouping containers use `role="radiogroup"` or `role="list"`

**Pattern reference:**

- `accessibility-specialist` agent — full pattern catalog
- `client/components/InlineError.tsx` — canonical error announcement (reference implementation)
- `scripts/check-accessibility.js` — pre-commit script (note: only catches 3 categories; this section catches the remaining 7)

## What Does Not Change

- Phases 1–7 of the audit workflow are unchanged
- The audit manifest template is unchanged
- The discovery prompt template is unchanged
- The named-scope dispatch rule is unchanged — it now correctly routes `/audit architecture` to `architecture-specialist` + `api-specialist`
- `code-reviewer.md` sections §1–§13 are unchanged — the new §14 is purely additive
- No other agent files need updating

## Success Criteria

- `/audit full` launches 7 domains (15 agent invocations across 4 batches: 4+4+4+3)
- `/audit architecture` launches `architecture-specialist` + `api-specialist`
- `/audit performance` launches `performance-specialist` + `database-specialist`
- `/audit accessibility` launches `accessibility-specialist` + `rn-ui-ux-specialist`
- Code reviews via `/review` now check accessibility using §14
