---
title: "Roll back the accidental preview-channel OTA (2026-08-16 review incident)"
status: backlog
priority: high
created: 2026-08-16
updated: 2026-08-16
assignee:
labels: [incident, deployment]
github_issue:
human_led: true
---

# Roll back the accidental preview-channel OTA (2026-08-16 review incident)

## Summary

A code-review subagent accidentally published a real OTA to the `preview` channel (mis-named `fake-eas` stub → PATH fell through to the real CLI). The head of `preview` is a bundle built from an unrelated branch WITHOUT env inlining. Restore the pre-incident channel state.

## Background

Incident details: update group `2735c5f5-7b5a-468e-852c-1184e93fa49c`, message "fix the --platform bug", rtv 1.2.0, android+ios, built from `test/eslint-fix-pin-regression-coverage` with `EXPO_PUBLIC_DOMAIN` from local `.env` (likely a LAN IP). Preview devices pull on the 2nd cold start. The agent-side rollback was correctly blocked by the permission classifier — this is **human-run only**. Full narrative: memory `project_ota_accidental_publish_2026_08_16.md` and `docs/solutions/conventions/never-execute-an-outward-facing-cli-fragment-in-review-2026-08-16.md`.

## Acceptance Criteria

- [ ] Run: `eas update:republish --group ffa0af0b-cc3b-4e6d-b9bf-b6e580398476 -m "rollback: revert accidental publish (group 2735c5f5)" --non-interactive`
- [ ] `eas update:list --branch preview --limit 2` shows the republished group at the head
- [ ] Decide separately whether `preview` should get a fresh proper publish from `main` (`npm run update:preview -- --message ...`) — the restored head is the week-old "DO NOT MERGE" probe build

## Implementation Notes

`update:republish` copies an existing update group byte-for-byte — no build step, no env involvement, additive (channel history preserved). The pre-incident head `ffa0af0b` was itself probe instrumentation, so a follow-up real publish may be wanted regardless.

## Scope Contract

- **Mechanisms to use:** `eas update:republish` only — no new builds, no channel edits.
- **Files in scope:** none (EAS dashboard state only).
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- Authenticated `eas` CLI on the operator's machine (already the case).

## Risks

- Delaying leaves preview testers pulling a bundle that may point at an unreachable API host.

## Updates

### 2026-08-16

- Initial creation from the guard-coverage session incident report.
