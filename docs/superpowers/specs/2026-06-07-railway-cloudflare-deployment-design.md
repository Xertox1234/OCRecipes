# OCRecipes Deployment Design — Railway + Cloudflare

- **Date:** 2026-06-07
- **Status:** Draft — awaiting user review
- **Author:** brainstorming session (Claude)
- **Posture:** Standing up reproducible production infra. **Not** launching to real users yet → optimize for a clean, reproducible setup over go-live polish. Single instance is acceptable; defer Redis and heavy monitoring.

> This file lives under `docs/superpowers/` which is **gitignored / local-only** in this repo (per project policy, 2026-05-21). It is a durable on-disk artifact, not a tracked commit.

---

## 1. Goal

Deploy OCRecipes to production using:

- **Railway** — hosts the Express API + managed PostgreSQL.
- **Cloudflare** — DNS (nameservers moved off Hostinger), R2 object storage for images, and Workers Static Assets hosting the web frontend.
- **Hostinger** — domain registrar only (change nameservers to Cloudflare).
- **Resend** — _out of scope for this plan_ (account exists; email is net-new code, deferred).

The Express API **cannot run on Cloudflare Workers** — it uses native modules (`bcrypt`, `sharp`), a long-lived process, `pg` connection pooling, and `multer`, none of which run in the Workers V8-isolate runtime. So the division of labor is fixed: **Railway runs the app; Cloudflare provides DNS + storage + the static web host.**

## 2. Locked decisions (from brainstorming Q&A)

| Decision        | Choice                                                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cloudflare role | DNS + R2 + host web app on Workers Static Assets. No edge-proxy Worker, no Verified-Product-API Worker yet.                                             |
| In scope        | Backend API + PostgreSQL (Railway), **and** web frontend hosting.                                                                                       |
| Out of scope    | Mobile store submission (EAS) — deferred; Email/Resend — skipped; Redis/multi-instance — deferred; edge proxy & public API Worker — deferred.           |
| Postgres host   | **Railway managed Postgres** (Neon noted as a drop-in `DATABASE_URL` swap if portability is wanted later).                                              |
| Railway build   | **Nixpacks + `railway.json`** (pin build/start commands + Node version). Dockerfile noted as the more-deterministic upgrade if native builds misbehave. |
| Sequencing      | **Approach ① — spine-first, web-second.** Phase 1 ships a working API on the domain; Phase 2 tackles the web export as its own spec.                    |

## 3. Target architecture

```
   Hostinger (registrar) ── change nameservers ──▶ Cloudflare
                                                       │
                       ┌───────────────────────────────┼────────────────────────────┐
                       │                         Cloudflare DNS                        │
                       │   api.<domain>          app.<domain>            img.<domain>   │
                       └──────────┬──────────────────┬─────────────────────┬──────────┘
                       proxied CNAME           Workers route          R2 custom domain
                                  │                  │                     │
                       ┌──────────▼─────────┐ ┌──────▼────────────┐ ┌──────▼──────────┐
                       │ Railway            │ │ Workers Static    │ │ R2 bucket        │
                       │  Express API       │ │ Assets            │ │  ocrecipes-images│
                       │  + managed Postgres│ │ (Expo web SPA)    │ │  public via CDN  │
                       │  single instance   │ │  PHASE 2          │ │  PHASE 1         │
                       └────────────────────┘ └───────────────────┘ └──────────────────┘
                              PHASE 1
```

Subdomain plan (final names are the user's call; these are the working defaults):

- `api.<domain>` → proxied CNAME → Railway service public domain.
- `img.<domain>` → R2 bucket custom domain (public read).
- `app.<domain>` → Workers Static Assets (web app) — Phase 2.
- Apex `<domain>` → redirect to `app.<domain>` or a marketing page — Phase 2 decision.

---

## PHASE 1 — Infra spine + R2 image migration

The only phase with a hard prerequisite: **R2 migration must land before/with the first real deploy**, because Railway's filesystem is **ephemeral** — every redeploy wipes `uploads/avatars` and `uploads/recipe-images`. Without R2, uploaded avatars and generated recipe images disappear on each deploy.

### 1a. Railway — application service

- **Build:** Nixpacks, configured via committed `railway.json`:
  - `build`: `npm ci && npm run server:build` (esbuild → `server_dist/`).
  - `start`: `npm run server:prod` (`NODE_ENV=production node server_dist/index.js`).
  - Pin Node version (the repo targets Node 24 in CI) via `.nvmrc` or `railway.json`/`nixpacks.toml` so the build is reproducible.
  - Native deps (`sharp`, `bcrypt`) build under Nixpacks' Node provider; verify the first build compiles them (this is the main "does Nixpacks suffice or do we need a Dockerfile" checkpoint).
- **Health check:** Railway healthcheck path = `/api/health` (already implemented at `server/index.ts:201`; it runs `SELECT 1`, returns 503 if DB unreachable). Set a generous timeout so cold DB connects don't flap.
- **Port:** app already reads `process.env.PORT` and binds `0.0.0.0` (`server/index.ts:216`). Railway injects `PORT` — no change needed.
- **Single instance (hard constraint for now):** Replicas = 1. Rationale, verified in code:
  - Five **in-memory session stores** (`server/storage/sessions.ts` — `analysisStore`, `labelStore`, `cookingSessionStore`, `frontLabelSessionStore`, `warmUpStore`) with a `TODO: Replace with Redis for horizontal scaling`. A second replica would split these stores and break multi-step flows.
  - **Cron/interval jobs** that must run exactly once: retention cleanup (`server/index.ts:246`, opt-in), cache cleanup + canonical promotion intervals (`server/index.ts:228,231`), push-notification scheduler (`server/routes.ts:112`). Multiple replicas = duplicate runs / duplicate pushes.
  - → Scaling past one instance is a **separate future spec** (introduce Redis-backed sessions + single-leader or externalized cron). Explicitly deferred.
- **Graceful shutdown:** already handled (`SIGTERM`/`SIGINT`, drains pool, waits for in-flight retention — `server/index.ts:281`). Railway sends SIGTERM on redeploy; this is correctly wired.

### 1b. Railway — managed PostgreSQL

- Provision Railway PostgreSQL plugin in the same project; use **private networking** so the app reaches the DB without public egress.
- Railway injects a `DATABASE_URL`; the app reads it (`server/db.ts` via `pg` pool). Confirm SSL mode matches Railway's requirement (`?sslmode=require` or pool `ssl` config) — verify during setup.
- **Schema:** Drizzle is **stateless `push`** (`npm run db:push` = `drizzle-kit push`). One-time: enable the `pg_trgm` extension (`CREATE EXTENSION IF NOT EXISTS pg_trgm;`) per CLAUDE.md, then `db:push`. Note `predb:push` runs a timestamptz migration check.
- **Backups:** enable Railway's automated backups (paid plan) before any real data exists. Low effort, listed so it isn't forgotten.
- _Portability note:_ swapping to Neon later = change `DATABASE_URL` only; no code change.

### 1c. R2 image migration — **CODE** (the prerequisite)

Current state (verified): images are written to local disk and served by Express static routes; the DB stores **relative** `imageUrl` paths like `/api/recipe-images/<file>` and `/api/avatars/<file>` (`server/scripts/migrate-recipe-images.ts:86`), which the client prepends with the API domain. Precedent exists: that script already migrated this same column once (DB-base64 → disk).

Design — minimal, mirrors the existing migration pattern:

1. **Add an R2 client module** (e.g. `server/lib/r2.ts`). R2 is S3-compatible → use `@aws-sdk/client-s3` (or `aws4fetch` for a lighter dep) pointed at the R2 endpoint. New env vars:
   - `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL` (e.g. `https://img.<domain>`).
   - Register these in `server/lib/env.ts` validation (optional-with-fallback so dev without R2 still boots, or required-in-prod — decide in implementation; fail-closed in prod is safer).
2. **Redirect the 3 write sites** from `fs.writeFile` to R2 `putObject`, then store the **full public CDN URL** (`${R2_PUBLIC_BASE_URL}/<key>`) in the DB column instead of a relative path:
   - `server/routes/auth.ts:315` — avatar upload (`avatarUrl`).
   - `server/services/recipe-generation.ts:370` — generated recipe image (`imageUrl`).
   - `server/lib/runware.ts:191` — Runware image fetch+store.
   - Keep `multer.memoryStorage()` (already in `server/routes/_upload.ts`) — buffers go straight to R2, no disk hop.
3. **Client URL guard:** at the client's image-URL resolution point, if `imageUrl` is already absolute (`http(s)://`), use as-is; else prepend the API base (back-compat for un-migrated rows). One small helper change. _(Confirm the exact resolution site during implementation.)_
4. **Backfill script** `server/scripts/migrate-images-to-r2.ts` — clone the structure of `server/scripts/migrate-recipe-images.ts`: select rows whose `imageUrl`/`avatarUrl` are relative `/api/...` paths, read the file from disk (or accept that pre-deploy local disk holds them), `putObject` to R2, rewrite the column to the full CDN URL. Idempotent; dry-run flag. Run **before cutover** while the disk files still exist locally.
5. **Transition fallback:** keep the Express `/api/recipe-images` + `/api/avatars` static routes (`server/index.ts:179-198`) during migration so any not-yet-migrated row still resolves; remove them in a follow-up once backfill is verified at 0 relative rows.
6. **Bucket config:** R2 bucket `ocrecipes-images`, public read via a Cloudflare custom domain (`img.<domain>`) so the CDN fronts it (zero egress — the documented reason R2 was chosen over S3). Images are already public/no-auth, so a public bucket matches current behavior.

### 1d. Cloudflare account + DNS cutover

- Create Cloudflare account; add `<domain>` as a zone.
- **At Hostinger:** change the domain's **nameservers** to the two Cloudflare assigns. (Keep registration at Hostinger — only NS changes.) Propagation up to ~24h.
- Recreate any existing DNS records in Cloudflare _before_ the NS switch to avoid downtime on anything currently resolving.
- Add records: `api` (proxied CNAME → Railway domain), `img` (R2 custom domain). `app`/apex in Phase 2.
- _(Resend note for later: when email is built, SPF/DKIM/DMARC records get added here — Cloudflare DNS — not Hostinger.)_

### 1e. Secrets / config on Railway

Set as Railway service variables (verified runtime list from `server/lib/env.ts` + grep):

- **Required:** `DATABASE_URL` (auto-injected), `JWT_SECRET` (≥32 chars), `NODE_ENV=production`, `PORT` (auto), `EXPO_PUBLIC_DOMAIN` (the API origin, e.g. `https://api.<domain>` — also gates CORS, see 1f).
- **R2 (new):** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`.
- **AI / data (optional, features degrade if absent):** `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`, `RUNWARE_API_KEY`, `SPOONACULAR_API_KEY`, `USDA_API_KEY`, `API_NINJAS_KEY`.
- **Push (optional):** `EXPO_ACCESS_TOKEN`, `EXPO_PUBLIC_PROJECT_ID`.
- **IAP (optional, needed when monetization goes live):** Apple `APPLE_*`, Google `GOOGLE_*` (see CLAUDE.md for the full set). **Never** set `RECEIPT_VALIDATION_STUB` in prod (env.ts forbids it).
- **Ops:** `ADMIN_USER_IDS`, `LOG_LEVEL`, `RETENTION_CLEANUP_ENABLED` (leave unset/false unless retention is intended).

### 1f. CORS

`setupCors` (`server/index.ts:43`) already allows `process.env.EXPO_PUBLIC_DOMAIN` and drops dev tunnels in production. Setting `EXPO_PUBLIC_DOMAIN` correctly is the only action. When the web app (Phase 2) is served from `app.<domain>`, that origin must also be allowed — either set it as the public domain or extend the allow-list to include the web origin. **Flag:** confirm whether one env var can cover both API and web origins, or the allow-list needs a second entry.

### 1g. Phase 1 acceptance criteria

- [ ] `https://api.<domain>/api/health` returns `{status:"ok"}` (DB reachable over private networking).
- [ ] A redeploy does **not** lose previously uploaded avatars/recipe images (proves R2 cutover).
- [ ] New avatar upload + new recipe-image generation both land in R2 and resolve via `img.<domain>`.
- [ ] Backfill script reports 0 remaining relative `/api/...` rows; static fallback routes can be safely removed.
- [ ] Mobile app (dev build) pointed at `api.<domain>` can log in, scan, and load images.
- [ ] `railway.json` + `.nvmrc`/nixpacks config committed → a fresh deploy reproduces the build.

---

## PHASE 2 — Web frontend on Cloudflare Workers (outline + spike)

**Own spec.** Higher risk; do not let it block Phase 1.

- **Reality:** No web export exists. `scripts/build.js` / `expo:static:build` produces **iOS+Android OTA bundles**, not a web SPA. A web build needs `expo export --platform web` set up fresh.
- **Hard constraint:** the app depends on **native-only modules** — `react-native-vision-camera`, `@react-native-ml-kit/text-recognition`, `react-native-nitro-image`, `expo-iap`. These do not run in a browser. The camera/scan core (the app's identity) **cannot exist on web as-is**.
- **First step = feasibility spike**, not implementation: attempt `expo export -p web`, catalog which screens/modules break, and decide the web scope: realistically a **subset** — auth, browse recipes, coach chat, meal plan — with camera disabled or replaced by a file-upload fallback (web `<input type=file>` → existing upload endpoints).
- **Host:** Cloudflare Workers Static Assets (the modern successor to Pages; an MCP `migrate_pages_to_workers_guide` tool exists). Output of `expo export -p web` (a `dist/` of static assets) → Workers Static Assets, routed at `app.<domain>`.
- **CORS:** ensure `app.<domain>` is an allowed origin against the Railway API (ties to 1f).
- **Open question for Phase 2 kickoff:** is the web target the _full app minus camera_, or a _lighter companion_ (e.g. recipe browsing + account management only)? This decides spike scope.

---

## Explicitly out of scope (this plan)

- **Email / Resend** — net-new code; no `nodemailer`/`resend`/SMTP anywhere today. Deferred to its own spec. (DNS for it lands at Cloudflare when built.)
- **Mobile store submission (EAS Build → TestFlight/Play)** — deferred.
- **Redis / horizontal scaling** — deferred; single instance until needed.
- **Edge-proxy Worker** and **Verified-Product-API Worker** — deferred (noted as future Cloudflare uses).
- **Production monitoring/alerting polish** — minimal for now (Railway logs + `/api/health`); Sentry already wired client-side.

## Risks & open questions

1. **Native builds under Nixpacks** — `sharp`/`bcrypt` must compile on Railway's first build. Mitigation: if they fail, switch to a committed Dockerfile (decision checkpoint at first deploy).
2. **Web export native-dep wall** — the biggest unknown; quarantined to Phase 2 spike.
3. **CORS dual-origin** (API + web) — confirm env/allow-list shape (1f).
4. **R2 backfill timing** — must run while local disk files still exist (i.e., before the first ephemeral wipe). Sequence carefully.
5. **DNS cutover window** — recreate records in Cloudflare before the Hostinger NS switch to avoid a resolution gap.
6. **SSL to Railway Postgres** — verify the `pg` pool SSL setting matches Railway's requirement.

## Sequencing (dependency order)

1. Cloudflare account + zone; **recreate existing DNS records** (no NS switch yet).
2. R2 bucket + `img.<domain>` custom domain.
3. **R2 migration code** (client module, 3 write sites, client guard, backfill script) — land + test locally.
4. Railway project: app service (`railway.json`) + managed Postgres; set all secrets incl. R2.
5. `db:push` (+ `pg_trgm`) against Railway Postgres.
6. Deploy app; run **backfill script**; verify images on R2.
7. Add `api.<domain>` proxied record → Railway; set `EXPO_PUBLIC_DOMAIN`.
8. **Switch Hostinger nameservers → Cloudflare.**
9. Verify Phase 1 acceptance criteria.
10. (Later) Phase 2 web spike → export → Workers Static Assets.

## Rough cost sketch (monthly, setup-not-launch scale)

- Railway: app + Postgres on a usage/Hobby-tier plan — low; enable backups (paid).
- Cloudflare: DNS free; R2 — near-zero at low volume, **zero egress** via CDN.
- Workers Static Assets (Phase 2): free tier likely sufficient.
- Resend: out of scope.
