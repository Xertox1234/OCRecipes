# server/CLAUDE.md

<!-- Moved from the root CLAUDE.md (harness item 7, 2026-11-02). Claude Code loads this file the first time Claude reads or edits a file under server/. No .env.example exists (.gitignore ignores .env.*), so this list is where the variables are documented. -->

## Environment variables

**Core:** `DATABASE_URL`, `JWT_SECRET`, `AI_INTEGRATIONS_OPENAI_API_KEY`, `AI_INTEGRATIONS_OPENAI_BASE_URL`, `RUNWARE_API_KEY` (image gen; Runware only, no fallback — unset = no AI pictures), `SPOONACULAR_API_KEY`, `USDA_API_KEY`, `API_NINJAS_KEY`, `ADMIN_USER_IDS`, `LOG_LEVEL`, `R2_PUBLIC_BASE_URL` (CDN base for stored images; also gates the backfill's "ours" image classification), `IMAGE_ART_DIRECTOR_LLM` (set to `off` to disable the per-image LLM art-director pre-pass — defaults on when OpenAI is configured; the deterministic style library still runs), `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY` (PEM, `\n` for newlines — Vertex AI direct for the vision rows marked `primary: "vertex"`, and the backup route (Gemini 3.8 Flash) for rows marked `vertexBackup` when OpenRouter fails; a dedicated service account, never the Play IAP one; unset = `primary: "vertex"` rows start at OpenRouter and `vertexBackup` rows have no backup — neither ever falls back to OpenAI), `SENTRY_DSN` (server-side Sentry error tracking — 5xx + crash capture, requestId-tagged; only active in `NODE_ENV=production`; distinct from the client's `EXPO_PUBLIC_SENTRY_DSN`)

**Privacy:** `RETENTION_CLEANUP_ENABLED` (`"true"` schedules the daily retention deletions; on in production), `VOICE_TRANSCRIPTION_ENABLED` (`"true"` turns on `POST /api/food/transcribe`, which sends audio straight to OpenAI; off by default and no app code calls it. Before turning it on, add OpenAI to `AI_RECIPIENTS` in `shared/lib/ai-sharing.ts` and the privacy page, and bump `AI_SHARING_VERSION` — privacy audit 2026-11-10, M3)

**Expo push:** `EXPO_PUBLIC_DOMAIN` (API domain for client), `EXPO_ACCESS_TOKEN` (server-side; omit to disable server-driven push), `EXPO_PUBLIC_PROJECT_ID` (required alongside `EXPO_ACCESS_TOKEN`)

**Apple IAP:** `APPLE_ISSUER_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` (PEM, `\n` for newlines — the App Store Connect In-App Purchase key; signs the App Store Server API call that checks a subscription's current status at its first claim, so a wrong key fails every first Apple claim with `STORE_API_ERROR`), `APPLE_BUNDLE_ID`, `APPLE_ENVIRONMENT` (sandbox/production), `APPLE_APP_ID` (numeric, required for prod JWS), `APPLE_ROOT_CA_DIR` (defaults to `server/certs/`), `RECEIPT_VALIDATION_STUB` (`"true"` for dev stub mode)

**Google IAP:** `GOOGLE_PACKAGE_NAME`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` (PEM, `\n` for newlines)

**E2E only:** `OPENROUTER_BASE_URL` points the OpenRouter client at the E2E run's `scripts/ci/stub-openai.mjs`; honoured only when NODE_ENV is explicitly `development` or `test`.

**Evals (not used in production):** `OPENROUTER_API_KEY` (REQUIRED — eval generation runs through OpenRouter with the fallback off; also the preferred judge backend), `ANTHROPIC_API_KEY` (judge via Anthropic direct when no OpenRouter key, or always with `EVAL_JUDGE_BACKEND=anthropic` — spends the Anthropic credit on judging while generation stays on OpenRouter), `EVAL_JUDGE_MODEL` (default `anthropic/claude-sonnet-4.6` via OpenRouter, `claude-sonnet-4-6` via Anthropic direct; used as given), `--candidate "feature=provider/model[;k=v]"` + `npm run eval:paired -- --baseline-file A --candidate-file B` for model switches, `EVAL_SAMPLES_PER_CASE` (1-10, default 1), `EVAL_PARALLELISM` (1-10, default 1). Runner refuses `NODE_ENV=production` without `--allow-prod`.
