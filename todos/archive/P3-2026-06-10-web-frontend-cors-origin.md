---
title: "Allowlist the web frontend's CORS origin before web launch"
status: done
priority: low
created: 2026-06-10
updated: 2026-06-10
assignee:
labels: [deferred, security, web]
github_issue:
---

# Allowlist the web frontend's CORS origin before web launch

## Summary

After PR #393, production's only HTTPS browser origin is `EXPO_PUBLIC_DOMAIN` — the API's own domain (`https://api.ocrecipes.com`). The planned web frontend (Cloudflare Workers, apex/www domain) is a different origin and will be CORS-blocked until explicitly allowlisted.

## Background

Surfaced as a SUGGESTION in the 2026-06-10 security audit's S2 per-fix review (manifest: `docs/audits/2026-06-10-security.md`, Deferred Items). Filed so web-frontend launch doesn't rediscover this as a mystery preflight failure. Related: web frontend is planned per `project_web_frontend` / the Railway+Cloudflare deployment plan.

## Acceptance Criteria

- [ ] A dedicated env var (e.g. `WEB_ORIGIN`) is read in `setupCors` and added to the production allowlist — do NOT overload `EXPO_PUBLIC_DOMAIN` (it's the API domain for the mobile client, a different concern)
- [ ] Var validated in `server/lib/env.ts` as optional + `https://`-only (mirror the `R2_PUBLIC_BASE_URL` `.startsWith("https://")` pattern)
- [ ] Unset var → behavior identical to today (no empty-string origin match)
- [ ] While in there: switch the reflected-ACAO `res.header("Vary", "Origin")` to `res.vary("Origin")` (append-safe; PR #393 review suggestion) and consider setting it for no-origin responses too
- [ ] Decide whether `Access-Control-Allow-Credentials: true` is still needed — if the web client uses Bearer-only auth (no cookies), it can be dropped

## Implementation Notes

- File: `server/index.ts` `setupCors` (`ALLOWED_ORIGIN_PATTERNS` + `publicDomain` exact-match block); env validation in `server/lib/env.ts`.
- Exact-match string compare (like `publicDomain`), not a regex.
- Railway env needs the new var set at web launch. (`EXPO_PUBLIC_DOMAIN` server-side presence was VERIFIED 2026-06-10 via live CORS probe — prod reflects ACAO for `https://api.ocrecipes.com`, so the third audit follow-up is closed; this todo is only the future `WEB_ORIGIN` work.)

## Dependencies

- Web frontend project reaching deploy stage (`project_web_frontend`); blocked-on-launch, not on code.

## Risks

- If the web app ever adopts cookie/session auth, the CORS+credentials posture needs a fresh security pass (CSRF surface) — note this in the PR that adds the origin.

## Updates

### 2026-06-10

- Initial creation (deferred from `/audit security` 2026-06-10, S2 review SUGGESTIONs + PR #393 review `res.vary` note; includes the EXPO_PUBLIC_DOMAIN-on-Railway verification)
