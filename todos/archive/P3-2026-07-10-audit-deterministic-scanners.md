<!-- Filename: P3-2026-07-10-audit-deterministic-scanners.md -->

---

title: "Wire deterministic scanners into the /audit skill for zero-hallucination ground truth"
status: done
priority: low
created: 2026-07-10
updated: 2026-07-12
assignee:
labels: [deferred, harness, audit]
github_issue:

---

# Wire deterministic scanners into the /audit skill for zero-hallucination ground truth

## Summary

The /audit pipeline relies solely on LLM discovery and misses cheap, deterministic
ground truth. Add npx-runnable scanners whose findings feed the existing audit manifest,
freeing the LLM passes for judgment rather than detection.

## Background

Surfaced by the PG Lab episodic-distillation experiment (candidate #192, triaged
2026-07-10): audit sessions repeatedly rediscover facts that deterministic tools report
instantly and without hallucination risk.

## Acceptance Criteria

- [ ] Security-scope audits run `npm audit` and `gitleaks` (or equivalent) and feed
      findings into the audit manifest before LLM discovery starts.
- [ ] Maintainability-scope audits run `npx knip` (dead exports), `npx jscpd`
      (duplication), `npx madge --circular`, and a `wc -l` threshold sweep, same routing.
- [ ] Scanner findings are deduped against LLM findings in the manifest (scanner wins as
      the evidence source).
- [ ] `.claude/skills/audit/SKILL.md` documents which scanners run per scope and how to
      skip them (offline / speed).

## Implementation Notes

- All tools are npx-runnable; no new package.json dependencies required.
- Scanner output → manifest rows should carry a `source: <tool>` field so per-fix
  verification knows the finding is deterministic (re-run tool = verification).
- Keep scanners advisory-fast: cap runtime, fail-open to LLM-only audit if a tool is
  unavailable (never block an audit on a missing npx package).

## Dependencies

- None (skill-file + script change only).

## Risks

- jscpd/knip noise on a codebase this size may need config tuning before findings are
  manifest-worthy; start with conservative thresholds.

## Updates

### 2026-07-10

- Filed from distillation-candidate triage (user chose todo over solution doc).
