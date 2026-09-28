---
title: "CodeQL alert #219 (js/insufficient-password-hash) on dev-api-cache.ts is a false positive that re-fails the CodeQL check on nutrition PRs"
status: backlog
priority: low
created: 2026-09-28
updated: 2026-09-28
assignee:
labels: [deferred, security, ci]
github_issue:
human_led: true
blocked_reason: "Needs the user's choice: dismiss the alert (an outward GitHub action the user runs) or change computeRequestHash's param selection. Closing also needs a later PR's CodeQL result to confirm."
---

# CodeQL alert #219 on `dev-api-cache.ts` is a false positive that re-fails the CodeQL check on nutrition PRs

## Summary

Code-scanning alert #219 (`js/insufficient-password-hash`, severity high) has been open on
`main` since 2026-07-06 at `server/services/dev-api-cache.ts:128`. It is a false positive: the
API key never reaches the SHA-256 input. Close it, dismissed or with a code change CodeQL can
follow, so it stops failing the `CodeQL` check on PRs that edit a request URL.

## Background

`computeRequestHash` hashes `method:basePath(url):sortedParams` to key the dev API cache.
CodeQL traces `USDA_API_KEY` and `SPOONACULAR_API_KEY` from the request URLs in
`server/services/nutrition-lookup.ts` (and the Spoonacular callers) into that hash and reports
the key as a password hashed with too little computational effort.

The key is not in the hash input:

- `extractParams` skips every query or body field matching
  `API_KEY_FIELD_RE = /^(api[_-]?key|key|x-api-key)$/i`.
- `basePath` keeps only `origin + pathname`, dropping the query string.

CodeQL can't see either filter, so it treats the whole URL as tainted.

The `CodeQL` check fails as "1 new alert in code changed by this pull request" whenever a PR
edits a line on that taint path. PR #1135 (2026-09-28) hit this by changing the USDA URL's
`pageSize`. It is not a required status check, so it doesn't block merging, but it shows a
red High security result on unrelated PRs.

## Acceptance Criteria

- [ ] Alert #219 is closed, in one of two ways:
  - Dismissed as "false positive", with a comment citing `API_KEY_FIELD_RE` and `basePath`.
  - Or cleared by a code change that CodeQL recognises, for example building the hashed
    params from an allowlist rather than a denylist.
- [ ] If there is a code change, the cache key is unchanged for every existing recorded
      fixture: same method, path and non-key params give the same hash. A test pins one
      known URL to its hash before and after.
- [ ] A PR that edits a USDA or Spoonacular request URL no longer fails the `CodeQL` check
      with this alert.

## Implementation Notes

- `server/services/dev-api-cache.ts:74-129`: `API_KEY_FIELD_RE`, `extractParams`, `basePath`,
  `computeRequestHash`.
- Dismissing an alert is an outward-facing GitHub action. Hand the user the exact
  `gh api -X PATCH repos/Xertox1234/OCRecipes/code-scanning/alerts/219 -f state=dismissed
-f dismissed_reason="false positive" -f dismissed_comment="..."` command rather than
  running it from an agent.
- A code change must not alter hash values. Recorded fixtures are looked up by hash, and a
  change would silently turn every recorded response into a cache miss.

## Scope Contract

- **Mechanisms to use:** GitHub code-scanning dismissal, or the existing `computeRequestHash` /
  `extractParams` functions. Nothing new.
- **Files in scope:** `server/services/dev-api-cache.ts` and its `__tests__/` file.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- A dismissal comes back if CodeQL changes the rule's fingerprint. A code fix doesn't.

## Updates

### 2026-09-28

- Filed at the user's request after PR #1135's CodeQL check failed on this alert.
