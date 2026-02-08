---
title: "P0: Harden SSRF protection — redirect bypass & DNS rebinding"
status: backlog
priority: critical
created: 2026-02-06
updated: 2026-02-06
assignee:
labels: [security, p0, meal-plan]
---

# P0: Harden SSRF protection — redirect bypass & DNS rebinding

## Summary

The recipe URL import uses `redirect: "follow"` which allows an attacker to bypass the SSRF blocklist via redirects to internal IPs. DNS rebinding can also bypass hostname-based checks.

## Background

`server/services/recipe-import.ts:212` — the `fetch()` call follows redirects without re-validating the target URL against `isBlockedUrl()`. An external server can respond with `302 Location: http://169.254.169.254/latest/meta-data/` to reach cloud metadata endpoints. Additionally, DNS rebinding (domain resolves to public IP during validation, then to `127.0.0.1` at fetch time) bypasses the hostname check. IPv6-mapped IPv4 addresses like `::ffff:127.0.0.1` are also not covered.

## Acceptance Criteria

- [ ] Change `redirect: "follow"` to `redirect: "manual"` and validate each redirect target with `isBlockedUrl()` before following
- [ ] Resolve DNS to IP before connecting and validate the resolved IP against blocked ranges
- [ ] Block additional IP representations: `::ffff:127.0.0.1`, `0x7f000001`, `0.0.0.0/8`, `100.64.0.0/10` (CGNAT), `fc00::/7` (IPv6 ULA)
- [ ] Add tests for redirect and DNS rebinding scenarios
- [ ] No regressions on existing recipe import tests

## Implementation Notes

- Switch to `redirect: "manual"`, read the `Location` header, validate with `isBlockedUrl()`, then fetch again (max 3 redirects)
- Use `dns.lookup()` to resolve hostname before fetch, check resolved IP against blocked ranges
- Consider `ssrf-req-filter` package or implement IP validation at socket level

## Dependencies

- None (self-contained fix in `recipe-import.ts`)

## Risks

- Some legitimate recipe sites may use redirects that break with manual redirect handling — test with common recipe URLs

## Updates

### 2026-02-06

- Created from multi-agent code review of `feat/meal-planning-phase-1`
