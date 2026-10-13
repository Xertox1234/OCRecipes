# OpenRouter Model Routing — Design

- **Date:** 2026-10-06 (brainstormed 2026-10-05)
- **Status:** the owner approved the scope, routing, outage behavior, quality gate, and design sections 1–5 in the brainstorming conversation. Revised the same day after a spec-review pass: all 9 findings were addressed, 3 with an alternative fix (3.7 context-carried overrides, 3.8 custom lint rule, §5 judge model name used as given). Awaiting the owner's approval.
- **Follow-on (separate spec, not this one):** the coach camera feature. The coach asks for a photo of ingredients, asks follow-ups, and generates a recipe. This spec is the groundwork that lets the coach run on GPT-6 Luna and the photo step on Gemini 3.8 Flash.

## 1. Goal

Every AI text and vision call goes through **OpenRouter**, and each AI job picks its **own model** from one table. Then features can move to cheaper or better models (GPT-6 Luna for chat, Gemini 3.8 Flash for photos) **one at a time**, each after an eval shows no quality loss. If OpenRouter fails, the call quietly falls back to today's OpenAI path.

### Decisions (owner-approved 2026-10-05)

| Decision                   | Choice                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope                      | **Set up first, then switch per feature.** The setup changes no model. Each later switch is its own PR with an eval report and the owner's yes.   |
| Routing                    | **Everything through OpenRouter**: one key, one bill. DALL-E and Whisper stay on the existing OpenAI key (not chat calls).                        |
| OpenRouter down or failing | **Fall back to today's OpenAI path**, invisibly to users.                                                                                         |
| Quality gate               | **The existing evals, with the judge running on OpenRouter** (no Anthropic credits needed).                                                       |
| Approach                   | **A per-feature model table plus one call helper** (approach A). Not an env-only base-URL swap, and not relying only on OpenRouter's model lists. |

### Candidate targets (research 2026-10-05, not part of the setup)

| Job        | Today                               | Candidate                                 | Why                                                                               |
| ---------- | ----------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Coach chat | `gpt-4o-mini` ($0.15 / $0.60 per M) | `openai/gpt-6-luna` ($0.10 / $0.50)       | Newer, cheaper, built for chat and light tool use. Use reasoning effort `low`.    |
| Photo scan | `gpt-4o` ($2.50 / $10)              | `google/gemini-3.8-flash` ($0.75 / $3.75) | Roboflow Vision Evals: 85.4% overall, 97.9% identification (Luna: 77.2% / 87.5%). |

## 2. Inventory (measured 2026-10-06)

- **30** `openai.chat.completions.create` calls in **22** files (a raw grep finds 32 lines; one is a comment in `notebook-extraction.ts` and one a `typeof` type reference in `nutrition-coach.ts`): 20 services and 2 scripts (`seed-recipes.ts`, `backfill-community-nutrition.ts`). Six of the calls are in `photo-analysis.ts`.
- **Streaming AI calls:** 2 services, `nutrition-coach.ts` and `recipe-chat.ts`. (`recipe-import.ts` streams, but not from an AI call.)
- **Services that send photos to a model:** 6. These are `photo-analysis`, `receipt-analysis`, `front-label-analysis`, `menu-analysis`, `cooking-session` and `recipe-chat`. (`barcode-lookup.ts` mentions `image_url` but makes no AI call.)
- _Correction to the brainstorm:_ the conversation said "3 streaming" and "7 photo services". The numbers above are measured.
- **Request parameters in use:**

  | Parameter               | Files |
  | ----------------------- | ----- |
  | `temperature`           | 22    |
  | `max_completion_tokens` | 19    |
  | `max_tokens`            | 3     |
  | `response_format`       | 20    |

- **Not affected:** `voice-transcription.ts` (Whisper) and DALL-E (`dalleClient`). Both stay on the OpenAI key.
- **Code that compares model names as strings:** none outside `server/lib/openai.ts` (grep for `"gpt-4o`).
- **33** test files fake `lib/openai`.

## 3. Server design

### 3.1 The model table — `server/lib/ai-models.ts`

There is one row per AI job, and each call site gets its own row. The six photo-analysis calls get six rows, so they can move separately.

```ts
export interface AiFeatureConfig {
  /** OpenRouter model id, e.g. "openai/gpt-4o-mini" */
  model: string;
  /** Model id for the fallback client (today's path), e.g. "gpt-4o-mini" */
  fallback: string;
  /** Request rewrites applied ONLY to the OpenRouter attempt — see 3.3 */
  adapt?: {
    drop?: string[]; // e.g. ["temperature"] for Luna
    rename?: Record<string, string>; // e.g. { max_completion_tokens: "max_tokens" } for Gemini
    set?: Record<string, unknown>; // e.g. { reasoning_effort: "low" }
  };
}

export const AI_FEATURES = {
  "coach-chat": { model: "openai/gpt-4o-mini", fallback: "gpt-4o-mini" },
  "photo-identify": { model: "openai/gpt-4o", fallback: "gpt-4o" },
  // … one row per call site (~30 rows)
} as const satisfies Record<string, AiFeatureConfig>;

export type AiFeature = keyof typeof AI_FEATURES;
```

- **On day one, every row points at the model the call uses today.** `model` is `fallback` with the provider prefix, and there is no `adapt`.
- Moving a feature later means editing its row. That one-row diff is the whole PR, apart from the eval report.
- A unit test fails if any row's `model` lacks a `provider/` prefix, or if any `fallback` has one. That catches the name mix-up that would make the fallback ask OpenAI for a model it doesn't recognize.

### 3.2 The call helper — `server/lib/ai-client.ts`

```ts
aiChat(feature: AiFeature, params: Omit<ChatCompletionCreateParams, "model">, options?: RequestOptions)
```

- Its input is the same as today's `create` call minus `model`. Its output is the same type, a completion or a stream, depending on `params.stream`. Call sites change only the function and drop the `model:` line.
- **It has two clients:**
  - `openrouter`: the OpenAI SDK with `baseURL: "https://openrouter.ai/api/v1"`, key `OPENROUTER_API_KEY`, and an `X-Title: OCRecipes` header.
  - `fallbackClient`: **the existing `openai` client, unchanged**, and its optional `AI_INTEGRATIONS_OPENAI_BASE_URL`. That variable is unset in production (4.3), so the fallback is OpenAI directly.
- **No `OPENROUTER_API_KEY`:** the helper calls `fallbackClient` with the `fallback` model and the original params. That is identical to today. Local dev, CI and tests behave as before, and setting the key in Railway is what turns OpenRouter on.
- **Data protection on every OpenRouter request:** `provider: { zdr: true }`, OpenRouter's zero-data-retention routing, sent per request so an account-settings change can't remove it. Verified 2026-10-06 against `https://openrouter.ai/api/v1/endpoints/zdr`:
  - Every model in the setup and the candidate list has a zero-retention endpoint.
  - The OpenAI models (`gpt-4o-mini`, `gpt-4o`, `gpt-6-luna`) run on **Microsoft Azure**. Zero-retention mode excludes OpenAI's own servers.
  - `gemini-3.8-flash` runs on **Google Vertex**. Zero-retention mode excludes Google AI Studio.
  - This is why the privacy policy (4.2) names Azure and Vertex.

### 3.3 Request adaptation

A switched model may reject parameters today's model accepts. Verified from OpenRouter's `supported_parameters`:

- `openai/gpt-6-luna` does **not** list `temperature`, which 22 files set.
- `google/gemini-3.8-flash` does **not** list `max_completion_tokens`, which 19 files use.

The row's `adapt` rewrites the request **for the OpenRouter attempt only**:

- `drop` removes these keys.
- `rename` moves them to the new name.
- `set` adds or overrides these keys.

The fallback attempt always gets the **original** params with the `fallback` model, which accepts them today.

### 3.4 Fallback rules

| OpenRouter result                                                                                                                                      | Behavior                                                                                                         | Outage switch      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------ |
| Network error, timeout, 5xx, 429                                                                                                                       | Fall back. Log as `transport`.                                                                                   | Counts             |
| 402 (balance empty)                                                                                                                                    | Fall back. Sentry **error** "OpenRouter balance exhausted".                                                      | Counts             |
| 4xx caused by **this request's content**: context length exceeded, content-filter block (OpenRouter `code`/message match, list kept in `ai-client.ts`) | Fall back (the fallback may accept it, e.g. Azure's stricter filter). Log as `request` at `warn`. **No Sentry.** | **Does not count** |
| Other 4xx (400, 404, 422: bad parameter, unknown model, no zero-retention endpoint)                                                                    | Fall back. Sentry **error** "AI config error: `<feature>`" with status and message.                              | **Does not count** |
| Caller aborted (user left the screen)                                                                                                                  | No fallback; re-throw the abort.                                                                                 | Does not count     |

- Any fallback logs a structured `warn` line.
- **Why 4xx doesn't count:** a 4xx means one row is misconfigured. If it counted, a single bad row (say, a Luna switch missing its `drop: ["temperature"]`) would trip the switch and push every feature off OpenRouter. It falls back anyway so users never see the mistake, and the separate Sentry alert makes sure the switch doesn't fail silently.
- **Outage switch (circuit breaker):** 5 counted failures within 60 s open the switch, and then calls go straight to the fallback for 60 s. After that the next call tries OpenRouter again, and one success closes the switch. It is held in memory per process, which suits the single Railway service. Revisit this if the server ever runs several copies.
- **Timeouts:** each attempt keeps the call's current timeout (`OPENAI_TIMEOUT_*`). The outage switch limits the double wait to the first few calls of an outage.

### 3.5 Streaming

- The helper **waits for the first chunk** before returning the stream to the caller.
- **The first chunk means any SSE event**, including a role-only delta or a tool-call delta, not the first text token. The coach uses tools, so its first chunk may carry no text.
- **Before the caller has received anything,** a failure triggers the fallback. That includes an HTTP error, or a first event that is an OpenRouter in-stream error (`error` at the top level, `finish_reason: "error"`, HTTP 200). The fallback stream is then returned instead.
- **After the first chunk has been returned,** there is no fallback. A later in-stream error is passed to the caller as an error. The coach's existing cut-off-reply handling then shows the error with Retry (owner ruling: a cut-off reply means error plus Retry).
- **The helper wraps the whole stream.** It does not hand back the raw SDK stream. The wrapper:
  - **replays the chunk it already read** first, then passes the rest through;
  - records the answering model and provider from the chunks;
  - logs usage and cost when the stream ends.
- OpenRouter puts usage, including cost, in the **last SSE message automatically**. Its docs (checked 2026-10-06) say `stream_options.include_usage` is deprecated there and has no effect, so nothing is added to requests. Fallback streams (OpenAI direct) log without cost, as today.

### 3.6 Logging and cost

Every call logs: `feature`, `provider` (`openrouter` | `fallback`), the model requested, the model and provider that **actually answered** (OpenRouter's response `model` and `provider` fields), `fallbackReason` when there was one, `requestId`, and OpenRouter's reported `usage.cost` when present. Per-job cost then comes from the logs, and no new table is needed.

**Call-record context (for evals).** `ai-client.ts` exports `withAiCallContext(ctx, fn)`, built on `AsyncLocalStorage`.

- Inside `fn`, every `aiChat` call:
  - reads the context's **model overrides** and **fallback switch** (3.7);
  - appends a record `{ feature, requestedModel, answeredModel, answeredProvider, fellBack }` to `ctx.calls`. For streams, the record is written when the stream ends.
- **Outside a context, which covers all production traffic,** there are no overrides, the fallback is always on, and nothing is recorded.
- Services return results only (e.g. `generateCoachResponse`, `analyzePhoto`), so this is how the eval runner learns which model actually answered without changing any service's signature.

### 3.7 Eval-only switches

Overrides and the fallback switch are **not read from the environment by `ai-client.ts`**. They exist only inside a `withAiCallContext` (3.6), which only the eval runner opens.

- **Why not environment variables gated on `NODE_ENV`:** the owner's shell exports `NODE_ENV=production`, and the runner accepts `--allow-prod`. Under a gate like that, the overrides would be silently ignored. The "candidate" run would then ask for today's model, get today's model, pass every consistency check, and report "no quality loss" for a model that never ran.
- With the context approach, production can never apply an override, because nothing in the server opens a context. The eval runner can never lose one, whatever `NODE_ENV` says.

Runner side (`evals/lib/runner-core.ts`):

- **Candidate selection:** a CLI flag, e.g. `--candidate "coach-chat=openai/gpt-6-luna;reasoning_effort=low"`. The exact syntax is fixed in the plan. The runner parses it and checks every named feature exists in `AI_FEATURES` (unknown feature → exit 1).
- **Each sample** runs inside `withAiCallContext({ overrides, fallback: "off", calls: [] })`.
  - With the fallback off, an OpenRouter failure throws. Without this, a failing candidate would quietly answer with today's model, and the score would partly measure today's model.
- **After each sample,** the runner **refuses to produce a report** (exit 1, naming the case) if any recorded call:
  - for an overridden feature, has a `requestedModel` that isn't the candidate;
  - has an `answeredModel` that doesn't match its `requestedModel`;
  - has `fellBack: true`.

  A baseline run (no `--candidate`) applies the same checks against the table's models.

### 3.8 Migrating the call sites

- Each of the 30 calls changes from `openai.chat.completions.create({ model: MODEL_X, ...rest })` to `aiChat("<feature>", { ...rest })`. Each test file's fake changes from `lib/openai` to `lib/ai-client`.
- The last migration PR deletes `MODEL_FAST` and `MODEL_HEAVY`. `server/lib/openai.ts` keeps the `openai` client, used as the fallback and by Whisper, plus `dalleClient`, `isAiConfigured` and the timeout constants.
- After this, a direct `chat.completions.create` call anywhere in `server/**` outside `server/lib/ai-client.ts` is a lint error. A new custom rule, `ocrecipes/no-direct-chat-completions`, in the existing `eslint-plugin-ocrecipes`, enforces it.
  - **Not `no-restricted-syntax`:** that rule is already set for `**/*.test.{ts,tsx}` (the `as never` ban, `eslint.config.js`). A second flat-config block setting the same rule would **replace** it, not merge, for files both blocks match.
  - The rule matches the **call**, not the import. So `voice-transcription.ts` (`audio.transcriptions.create`) and DALL-E (`images.generate`) need no exemption.

## 4. Configuration and privacy

### 4.1 Environment

- `OPENROUTER_API_KEY` is **optional**. It is added to:
  - the zod schema in `server/lib/env.ts`;
  - the env table in `server/__tests__/README.md`.
- The repo has no `.env.example`. CLAUDE.md is gitignored, so updating its env list is a local note only, not a repo change.
- Set it to a **dedicated app key** with a monthly spending limit. Not the key the `kimi-*` dev scripts use.

### 4.2 Privacy policy (`site/privacy/index.html`)

The provider table today has one OpenAI row covering photos, voice, food text, coach, recipe chat and generation, and meal plans. The update:

- **OpenRouter (new row):** routes AI requests to the companies that run the models. It receives what the OpenAI row lists and keeps no copy (zero data retention).
- **OpenAI row:** reworded so the OpenAI models run on Microsoft Azure via OpenRouter, with OpenAI directly as a backup and for voice and pictures. The data list is unchanged.
- **Google (new row):** Gemini via Google Vertex, for **photo scanning**. It receives **the photo and the scan instructions only**, with no profile, goals or chat history. This matches what `photo-analysis.ts` sends today (verified: no profile fields).
- **Restriction this spec imposes:** these rows send more than the photo, and none of them may move to a Google model until the Google row's wording is widened to match:
  - `menu-analysis`: the user's goals and diet.
  - `recipe-chat` and `cooking-session`: conversation.
  - `photo-analysis.ts` `refineAnalysis`: the user's free-text answer to a follow-up question.
  - `photo-analysis.ts` `structureRecipeFromText`: user text with no photo at all.

  Step 6.5.2 names the exact rows it moves (see there).

- Bump the effective date.
- **Ordering:** the updated policy must be live **before** `OPENROUTER_API_KEY` is set in production.

### 4.3 Owner checks (before the key goes into Railway)

1. ~~Is `AI_INTEGRATIONS_OPENAI_BASE_URL` set in Railway production?~~ **Resolved 2026-10-06 (owner):** it is not set in Railway (only `AI_INTEGRATIONS_OPENAI_API_KEY` is), and not in the local `.env`. The SDK default (`api.openai.com`) is in use. Today's path, and so the fallback, is OpenAI directly, and the current privacy policy is accurate.
2. App Store privacy labels: same data types, same purpose, still third-party processors. **Expected** to need no change. The owner confirms in App Store Connect.
3. Create the OpenRouter app key with a spending limit.

## 5. Evals on OpenRouter

- **Judge:** `evals/lib/judge-generic.ts` is the only Anthropic caller (one `messages.create`). It moves to the OpenAI SDK pointed at OpenRouter, with default model `anthropic/claude-sonnet-4.6`, the same judge as today, so scores stay comparable. If only `ANTHROPIC_API_KEY` is set, it keeps using Anthropic directly.
- **Runner key gate:** today `runner-core.ts` exits with "ANTHROPIC_API_KEY is required." That relaxes to **"`OPENROUTER_API_KEY` or `ANTHROPIC_API_KEY`."** Without this, the evals still can't run without Anthropic credits, which defeats the purpose of the change.
- **Judge model name:** OpenRouter names models `anthropic/claude-sonnet-4.6`; Anthropic directly uses `claude-sonnet-4-6`.
  - `EVAL_JUDGE_MODEL` is used **as given** for whichever provider is active. No automatic conversion, which would be a fragile name mapping.
  - On the OpenRouter path, a value without a `/` exits 1 with a message showing the expected form.
  - The local CLAUDE.md note on `EVAL_JUDGE_MODEL` gets the new form.
- **Comparison protocol for a switch:**
  - Run the job's suite twice on the same cases with `EVAL_SAMPLES_PER_CASE >= 3`: a baseline run, and a run with `--candidate`.
  - Per case, average the samples, then take the **paired difference** (candidate − baseline) for each score dimension.
  - The 95% CI comes from the existing `bootstrapMeanCI` (`evals/lib/bootstrap.ts`) over those per-case differences, resampling cases, not samples.
  - **Pass/fail rule** (scores are on the 0–10 scale; numeric gates in the style of the coach-intent-router plan):
    - every score dimension: **CI lower bound of the difference ≥ −0.5**;
    - `safety` dimension, if the suite scores it: **≥ −0.25**;
    - hard assertions: **zero cases that pass on the baseline and fail on the candidate**.
  - The runner prints PASS or FAIL against this rule. The owner decides from the report.
- **Dataset gaps:**
  - `photo-analysis-cases.json` has 12 cases, 11 of them clean Wikimedia stock photos. They can't tell the models apart. Before any photo job moves to Gemini, add **15–20 real-world photos**: cluttered plates, dim light, partly hidden packaging, ideally taken on the owner's phone.
  - Receipts, menus, front labels and cooking sessions have **no eval suite**. They stay on `gpt-4o` until each has one. That is separate later work.

## 6. Rollout

Each step is its own PR or owner action. All of it is server-side: no app build, no OTA. Railway deploys on merge.

**Review and merge policy:**

- Every PR in this section gets **individual human review and is never auto-merged**, including any that comes through the `/todo` pipeline. They touch three of the Hard Exclusions in `.github/copilot-instructions.md`:
  - a new secret (`OPENROUTER_API_KEY`);
  - user data going to new processors;
  - a broad cross-cutting change (30 call sites).
- The `kimi-*` cheap workers are **excluded** from all of it, because coach and photo prompts carry user health and profile data (an absolute exclusion in CLAUDE.md).
- Review roster: `code-reviewer` + `server-reviewer` + `ai-reviewer`, plus `security-auditor` for the foundation PR and the privacy step.

1. **Foundation PR.** Add `ai-models.ts` and `ai-client.ts`, test-first (§7). No call site uses them yet.
2. **Migration PRs** (about four, by area):
   - coach and recipe chat (the streaming ones);
   - photo services;
   - recipe and meal services;
   - everything else, including the two scripts, the `MODEL_*` deletion and the ESLint rule.

   Every row still names today's model, so behavior is unchanged.

3. **Evals + smoke PR.** Move the judge to OpenRouter, add `withAiCallContext`-based `--candidate` runs with the fallback off and the per-sample model checks (3.7), relax the runner's key gate, add the paired PASS/FAIL report (§5), and add the `ai:smoke` script used in step 4.
4. **Owner, in order:** publish the privacy policy, complete the 4.3 checks, then set `OPENROUTER_API_KEY` in Railway.
   - Then run the **row smoke check**, `npm run ai:smoke`. It makes one tiny call per row, with that row's adapted params, inside a call context with the fallback off. **Rows whose call uses `response_format` repeat it** (`json_object` or `json_schema`), so the reply must parse. It prints pass/fail and the answering provider per row. This proves zero-retention routing, parameters and JSON mode for every row in production config.
   - Then watch for one day: fallback rate, config-error alerts, cost per job. The models are the same as before, so any problem is in the plumbing.
5. **Per-feature switches,** each a one-row PR plus an eval report plus the owner's yes, and the smoke check on that row:
   1. `coach-chat` (and the other coach rows) → `openai/gpt-6-luna` with `adapt: { drop: ["temperature"], set: { reasoning_effort: "low" } }`. The coach suite has 41 cases.
   2. The image-only photo-scan rows → `google/gemini-3.8-flash`. These are the rows for `analyzePhoto`, `analyzeLabelPhoto`, `analyzeRecipePhoto` and `classifyAndAnalyze`, with the final row names fixed in the plan, and **never** `refineAnalysis` or `structureRecipeFromText` (4.2). with `adapt: { rename: { max_completion_tokens: "max_tokens" } }`. This comes **after** the real-world photo set exists.
   3. The other photo jobs, once each has an eval suite and, where 4.2 requires it, a widened policy.

## 7. Testing

The foundation is written test-first (Vitest, `server/lib/__tests__/`), with both clients faked:

- No key: calls the fallback client with the `fallback` model and the original params.
- Key set: calls OpenRouter with the `model`, the `adapt` rewrites and `provider.zdr: true`.
- Each row of the 3.4 table:
  - each failure type triggers the fallback with the **original** params;
  - the outage switch counts transport, 5xx, 429 and 402, and does **not** count other 4xx;
  - an abort is re-thrown without fallback;
  - a 402 raises the balance alert;
  - other 4xx raise the config alert.
- Outage switch: opens after 5 counted failures in 60 s, skips OpenRouter while open, and closes after a successful retry after 60 s. Uses fake timers.
- Streaming:
  - an HTTP error before any chunk falls back;
  - an in-stream error as the first event falls back;
  - a role-only or tool-call first chunk counts as received (no fallback after it);
  - an error after the first chunk is passed through.
- Call-record context:
  - overrides and `fallback: "off"` apply only inside `withAiCallContext`, and **outside one they never apply, whatever `NODE_ENV` is**;
  - each call appends `{ feature, requestedModel, answeredModel, answeredProvider, fellBack }`;
  - stream records are written at stream end.
- Stream wrapper: the peeked first chunk is **replayed** to the caller (the caller sees every chunk exactly once, in order), and usage and cost from the last SSE message are logged at the end.
- Runner (`evals/__tests__`):
  - with `NODE_ENV=production` and `--allow-prod`, a `--candidate` run still sends the candidate model (the context, not the environment, carries it);
  - the runner exits 1 when a sample's `requestedModel` isn't the candidate, the answering model doesn't match, or `fellBack` is true;
  - an unknown feature in `--candidate` exits 1;
  - with only `OPENROUTER_API_KEY` set, the runner starts;
  - an OpenRouter-path `EVAL_JUDGE_MODEL` without a `/` exits 1;
  - the paired PASS/FAIL rule matches hand-computed fixtures.
- Lint: `ocrecipes/no-direct-chat-completions` flags a direct call in `server/services/**` and allows `ai-client.ts`, `audio.transcriptions.create` and `images.generate`. Run `npm run lint` to show the `as never` ban still fires in `server/services/**/__tests__`.
- Fallback reasons: context-length and content-filter 4xx are logged as `request` at warn level with no Sentry alert, and don't count toward the outage switch.
- Table check: every `model` has a `provider/` prefix and no `fallback` does.
- Migration PRs: each service's existing tests pass after their fake moves to `ai-client`, with no behavior assertions changed.

## 8. Risks

| Risk                                                                                       | Mitigation                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A switched row silently falls back (bad parameter, no zero-retention endpoint)             | Config-error Sentry alert (3.4); row smoke check before and after each switch (6.4); answering model logged on every call (3.6)                                                                        |
| A candidate eval secretly scored with today's model                                        | Overrides live in the call context, not the environment, so `NODE_ENV` can't void them; fallback off in eval runs; the runner checks requested and answering model and `fellBack` per sample (3.7)     |
| Coach Pro's tool loop falls back in the middle of a turn, mixing providers within one turn | Accepted. Tool-call messages are the standard OpenAI format on both paths, and while every coach row is an OpenAI model the mix is invisible. Revisit if a coach row ever moves to a non-OpenAI model. |
| OpenRouter balance runs out and everything quietly costs more                              | 402 → dedicated Sentry error (3.4)                                                                                                                                                                     |
| One bad row pushes all traffic off OpenRouter                                              | 4xx errors don't count toward the outage switch (3.4)                                                                                                                                                  |
| The zero-retention provider list changes (an endpoint leaves)                              | Calls fall back and the config alert fires; the smoke check shows which row                                                                                                                            |
| Azure applies content filtering stricter than OpenAI's own                                 | Seen as config or 4xx alerts per feature during the 6.4 watch day; affected rows can stay on fallback until resolved                                                                                   |
| The privacy policy promises Google "photo only" but a richer row moves                     | 4.2 forbids moving `menu-analysis`, `recipe-chat` and `cooking-session` to Google without a wording change first                                                                                       |
| The outage switch is per process                                                           | Fine for one Railway service; revisit if the server is ever scaled out                                                                                                                                 |
