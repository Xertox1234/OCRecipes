---
title: "Re-triage the expanded Dependabot alert set on main (21 incl. 9 high)"
status: backlog
priority: low
created: 2026-06-20
updated: 2026-06-20
assignee:
labels: [deferred, dependencies, security]
github_issue:
---

# Re-triage expanded Dependabot alert set (21 alerts, 9 high)

## Summary

The default-branch Dependabot count jumped from **3 moderate** to **21 (9 high,
7 moderate, 5 low)** as surfaced on pushes during the 2026-06-20 `/todo` batch.
Re-triage the now-9 **high** alerts against the reachability framework already
established for the original 3, and update the existing watchpoint.

## Background

The original triage (`P3-2026-06-01-dependabot-triage-3-medium-transitive.md`,
status `blocked`) classified 3 transitive Medium alerts (uuid / brace-expansion /
esbuild) as not-urgent on a **reachability** axis: dev/build/test-only, never in
the RN bundle or Express runtime, no attacker-controlled input path. That todo is
the canonical home and its framework still applies.

What changed: the alert count grew to 21 with **9 high**. The increase is likely
more transitive dev/build/test deps re-scanned (open PR #404 already bumps
`multer` in the `npm-security` group), but **9 high is a material jump that has
not been triaged** — it should not ride the old "3 moderate, not urgent" note
unexamined. The discriminating question per alert is unchanged: is it
production-reachable (shipped artifact) AND attacker-reachable?

## Acceptance Criteria

- [ ] Pull live alert state:
      `gh api /repos/Xertox1234/OCRecipes/dependabot/alerts?state=open` (or the
      Security tab) and list each of the 9 **high** alerts: package, advisory,
      dependency path (`npm ls <pkg>`), and runtime-vs-tooling classification.
- [ ] For each high alert, record a reachability verdict (production-reachable?
      attacker-reachable?) and a disposition: patch now / safe scoped override /
      defer-to-upstream / dismiss as `tolerable_risk`.
- [ ] Any alert that IS production-reachable (RN bundle or bundled Express
      runtime) and attacker-reachable is fixed or escalated out of this P3 — do
      not leave a reachable high silently deferred.
- [ ] The existing watchpoint todo
      (`P3-2026-06-01-dependabot-triage-3-medium-transitive.md`) is updated with
      the new count + the high-alert dispositions so the two don't diverge; this
      todo is then archived or folded in.

## Implementation Notes

- Reachability, not severity, is the axis (see the original todo). Dependabot's
  "runtime" scope labels are inferred from `package-lock.json` and mislabel
  tooling (`@expo/ngrok`, `eslint`) as runtime.
- `npm ls <pkg>` per alert to confirm the dependency path is dev/build/test vs
  shipped.
- Honor the "blunt override unsafe" guardrail from the original triage — a single
  pin frequently breaks Expo/minimatch/vite consumers. Prefer scoped-nested
  overrides only when a path is genuinely reachable.
- `.github/dependabot.yml` is security-only/grouped with zod + `expo >=55` pins —
  don't widen it as part of this.

## Dependencies

- Relates to `P3-2026-06-01-dependabot-triage-3-medium-transitive.md` (canonical
  watchpoint — update it rather than diverging).
- PR #404 (`multer` bump, `npm-security` group) is already open and may clear
  some count on merge — re-pull after.

## Risks

- Low triage effort; the risk is the opposite — a genuinely reachable **high**
  hiding in a set assumed to be all transitive tooling. The per-alert
  reachability check is the guard against rubber-stamping.

## Updates

### 2026-06-20

- Initial creation — alert count jumped 3 → 21 (9 high) during the 2026-06-20
  `/todo` batch; the 9 high have not been triaged against the reachability
  framework. Surfaced in that batch's Phase 5 summary.

### 2026-06-20 (DONE — triaged and folded into the canonical watchpoint; archiving)

- The 8 **high** alerts (the count had drifted from 21/9-high to live **19 open:
  8 high, 6 moderate, 5 low** by triage time — PR #404 `multer` bump shifted it)
  were triaged against the reachability framework and recorded in the canonical
  home, `P3-2026-06-01-dependabot-triage-3-medium-transitive.md` → Updates
  2026-06-20. **Verdict: no high alert is both production-reachable and
  attacker-reachable** — `undici` ×4 (WS-client/SOCKS5 surfaces unused),
  `form-data` (test/type-only + JSON-only Apple lib), `ws` ×2 (dev tooling only;
  `openai`'s `ws@8.21.0` is out of range), `vite` (vitest-only, no dev server).
  Nothing escalates out of P3; pre-launch re-triage gate carried in the canonical
  todo. This todo did its job (forced the high-tier triage) and is now redundant —
  archived to avoid two diverging homes.
