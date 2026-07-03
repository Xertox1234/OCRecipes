---
title: OpenAI 401 "Missing Authentication header" — an OpenAI key behind an OpenRouter base URL
track: bug
category: runtime-errors
module: server
severity: high
tags: [openai, openrouter, ai-config, env, railway, authentication]
symptoms: [Every OpenAI call throws `401 Missing Authentication header` (e.g. in `generateRecipeContent`)., AI works locally but 401s in prod (Railway)., The recipe seed inserts 0 rows — summary reads "N skipped (quality gate)" because content generation throws before the image step.]
applies_to: [server/lib/openai.ts, server/services/**/*.ts]
created: '2026-06-25'
---

# OpenAI 401 "Missing Authentication header" — an OpenAI key behind an OpenRouter base URL

## Problem

All OpenAI calls in prod fail with `401 Missing Authentication header`, while the
same code works locally. The cause is a **provider/credential mismatch**: the
API _key_ is an OpenAI key (`sk-proj-…`) but the client `baseURL` points at a
**different provider** (`https://openrouter.ai/api/v1`). OpenRouter authenticates
with its own `sk-or-…` keys and rejects the OpenAI key — its 401 body is the
gateway-style `Missing Authentication header`, not OpenAI's `Incorrect API key`.

## Symptoms

- `AuthenticationError: 401 Missing Authentication header` thrown from the first
  OpenAI request in a flow (content generation, coach, chat, photo analysis).
- Local works, prod fails — because local `.env` has the OpenAI key with **no**
  `AI_INTEGRATIONS_OPENAI_BASE_URL`, so it talks to `api.openai.com` directly.
- The seed reports "0 inserted, N skipped (quality gate)" — the `try/catch` in
  `seedOneRecipe` swallows the thrown 401 and counts the recipe as skipped, so
  the summary hides an auth failure as a quality-gate skip.

## Root Cause

`server/lib/openai.ts` builds the chat client as
`new OpenAI({ apiKey: AI_INTEGRATIONS_OPENAI_API_KEY, baseURL: AI_INTEGRATIONS_OPENAI_BASE_URL })`.
The key and the base URL are **independent env vars** with no consistency check,
so a key for provider A pointed at provider B's endpoint compiles fine and only
fails at request time. The `dalleClient` in the same file deliberately omits
`baseURL` (DALL·E is OpenAI-exclusive — OpenRouter has no image endpoint), which
is the tell that the base-URL override was only ever meant for chat, and only
with a matching OpenRouter key.

## Solution

Make the key and base URL agree. The app is OpenAI-native (models are bare
`gpt-4o`/`gpt-4o-mini`/`dall-e-3`, no OpenRouter namespacing, zero OpenRouter
code), so the fix is to use OpenAI directly: **remove
`AI_INTEGRATIONS_OPENAI_BASE_URL`** (an unset base URL defaults to
`api.openai.com/v1`). On Railway:

```bash
railway variables delete AI_INTEGRATIONS_OPENAI_BASE_URL --service OCRecipes
```

Verify with a live call (not just by re-reading the var):

```bash
railway run --service OCRecipes -- node -e \
  'const O=require("openai");new (O.OpenAI||O)({apiKey:process.env.AI_INTEGRATIONS_OPENAI_API_KEY,baseURL:process.env.AI_INTEGRATIONS_OPENAI_BASE_URL}).chat.completions.create({model:"gpt-4o-mini",max_tokens:5,messages:[{role:"user",content:"reply OK"}]}).then(r=>console.log("OK",r.choices[0].message.content)).catch(e=>console.error("FAIL",e.status,e.message))'
```

(If you genuinely want OpenRouter for chat, the key must be an `sk-or-…` key,
the chat models must use OpenRouter's `provider/model` namespacing, and the
DALL·E client still needs a separate OpenAI key — a deliberate code change, not
a config flip.)

## Prevention

- Treat `AI_INTEGRATIONS_OPENAI_BASE_URL` + `AI_INTEGRATIONS_OPENAI_API_KEY` as a
  **matched pair**: an OpenAI `sk-proj-…`/`sk-…` key ⇒ no base URL (or
  `api.openai.com`); an OpenRouter `sk-or-…` key ⇒ the openrouter base URL.
- After migrating off a managed host (Replit-style `AI_INTEGRATIONS_*` proxy
  vars), audit every managed-service var on the new host — the env _contract_
  doesn't migrate with the code.
- Don't let a `try/catch` count an auth failure as a benign "skip" — log the
  error class so a 401 is distinguishable from a real quality-gate skip.

## Related Files

- `server/lib/openai.ts` — both clients; the chat client reads the base URL, the DALL·E client omits it.
- `server/services/recipe-generation.ts` — `generateRecipeContent` (throws the 401), `dalleClient.images.generate`.
- `server/scripts/seed-recipes.ts` — `seedOneRecipe` catch block that masks the throw as a skip.

## See Also

- [railway-variables-are-per-environment-2026-06-25.md](../best-practices/railway-variables-are-per-environment-2026-06-25.md) — why the dashboard delete of this var kept "not taking".
