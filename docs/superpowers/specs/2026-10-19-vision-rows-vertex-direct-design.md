# Vision features on Vertex AI direct, OpenRouter as fallback, no OpenAI

Date: 2026-10-19 · Status: design approved in chat, spec under review

## 1. Goal and owner rulings

The owner's goal is to stop depending on OpenAI, including as the backup. gpt-4o
and gpt-4o-mini retire on OpenAI direct on 2027-01-14 and on Azure (through
OpenRouter) on 2027-04-14. This spec covers the first slice.

Rulings, all from the owner on 2026-10-19:

- **Scope: the 9 vision rows of `AI_FEATURES`, and nothing else.** They are
  `photo-analyze`, `photo-classify`, `photo-recipe`, `photo-label`,
  `front-label-scan`, `receipt-scan`, `menu-scan`, `cooking-ingredient-photo`
  and `recipe-chat-image`.
- **Primary route: Google Vertex AI, called directly.** The privacy policy
  already names Vertex AI, and Vertex runs without keeping prompts. The
  Gemini Developer API (AI Studio key) was rejected because it keeps prompts
  for up to 55 days for abuse monitoring.
- **Fallback route: OpenRouter, pinned to `google-vertex` with ZDR, as today.**
- **These rows never reach OpenAI direct.**
- **Out of scope:**
  - the GPT-6 Luna coach chats (they stay as they are);
  - the 25 text rows, including `photo-refine`, which stays on gpt-4o with the
    OpenAI backup until a later slice;
  - `voice-transcription.ts` (whisper-1).
- **Checking before a switch.**
  - Photo test sets plus a paired eval against gpt-4o for the 3 risky rows:
    `photo-label`, `front-label-scan` and `menu-scan`.
  - A live check on a few real photos for the 5 others.
  - `photo-analyze` is already measured (#1509, switched in #1514).

## 2. Routing design

### 2.1 Table

`AiFeatureConfig` (`server/lib/ai-models.ts`) gains an optional
`primary?: "vertex"`.

- **A row with the flag** routes Vertex → OpenRouter → error. Its `model`
  (e.g. `google/gemini-3.8-flash`) is sent unchanged to both routes: Vertex's
  OpenAI-compatible endpoint uses the same `google/<model>` ids. Plan Task 1
  verifies this against the live API before any code depends on it.
- **The `fallback` field.** It names the OpenAI-direct model, so it is
  meaningless on a flagged row. `fallback` becomes optional, with no type
  union. Its readers are `ai-client.ts` (only on the unflagged path, which
  keeps the field) and `ai-models.test.ts:22,74`, which iterate every row.
  A union would force casts at each of them for no runtime gain.
- **The table test pins it** (`server/lib/__tests__/ai-models.test.ts`):
  - every flagged row has no `fallback`;
  - every unflagged row has one;
  - every row with `vision: true` carries `primary: "vertex"` once rollout is
    complete. Until then, the test's existing `SWITCHED` map names the rows
    already flagged.
- **Unflagged rows (the 25 text rows and the 2 coach rows) are unchanged.**
  They keep OpenRouter → OpenAI direct.

### 2.2 Client

`defaultDeps()` (`server/lib/ai-client.ts`) builds a third client of the
existing `openai` SDK (6.39, which accepts `apiKey: () => Promise<string>`):

- **Endpoint:**
  `baseURL = https://aiplatform.googleapis.com/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/global/endpoints/openapi`.
  Task 1 confirms the hostname, the `global` location and the model-id form
  from Google's current docs (Context7, or the Vertex docs page), not from
  recall, and then with one live call.
- **Login:** an async `apiKey` function that returns an access token from a
  `google-auth-library` `GoogleAuth` client.
  - Scope: `https://www.googleapis.com/auth/cloud-platform`.
  - Credentials: `GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL` +
    `GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY` (PEM, `\n` for newlines), passed as
    `credentials: { client_email, private_key }`. This is the same email + PEM
    shape as the existing Google Play IAP pair (`GOOGLE_SERVICE_ACCOUNT_*`,
    `server/lib/env.ts:120-121`, `receipt-validation.ts`), so there is one
    convention to learn.
  - It is a **separate account, under its own names.** The Play account must
    not gain Vertex rights (least privilege), and AI routing must never read
    the IAP credentials. The receipt-validation code is untouched.
  - All three vars are added to the `server/lib/env.ts` Zod schema as
    optional strings.
  - The library caches the token and renews it before expiry.
- **Build failures are not crashes.**
  - If any of the three env vars is missing, `vertex` is `null`.
  - A bad key surfaces on the first call as a Vertex failure of kind `config`
    (reported and throttled, as in §2.3). The key value is never logged.

`AiChatDeps` gains:

- `vertex: AiChatClient | null`;
- a second breaker, `vertexBreaker`. The existing `breaker` keeps meaning
  "OpenRouter is unhealthy".

### 2.3 Request flow for a flagged row

1. **Build the body.**
   - `adaptParams(params, row.adapt, override?.set)` with `model` set. The
     row's adapt block (e.g. `reasoning_effort: "low"`) applies on BOTH routes.
   - The OpenRouter attempt alone adds `provider: { zdr: true, only: [host] }`.
2. **Try Vertex.** Skip it when `vertex` is null or `vertexBreaker` is open.
   - **On success:** record `provider: "vertex"`, log `ai call`, and record a
     breaker success.
   - **On failure:** handle it as below.
     - An abort is rethrown (the existing `isAbort`).
     - Otherwise, classify it with `classifyAiFailure` and feed
       `vertexBreaker` only for the kinds that `countsTowardBreaker` names.
     - Report a `config` failure throttled per feature: the existing
       `configReportedAt` mechanism, keyed by route + feature.
     - Then go on to step 3.
3. **Try OpenRouter.** Skip it when the key is absent or `breaker` is open.
   Success and failure are handled as today, except that a failure never calls
   `callFallback`.
4. **Neither route answered.** Throw the last error, or a config error naming
   both missing env vars when neither client exists. Never call
   `deps.fallback`.

**Streaming.** No vision row streams (`recipe-chat-image` is a single
completion). A flagged row called with `stream: true` throws. A test pins
this, so no one needs to build a Vertex stream path without a caller.

**Eval context** (`ctx.fallback === "off"`). Only the first available route is
tried, and the failure is recorded as today. With Vertex configured, evals
measure the Vertex path. `--candidate` overrides keep working because the ids
match.

**Records and logs.** `answeredProvider` is `"vertex"` or the OpenRouter host.
`fellBack: true` when OpenRouter answered after a Vertex attempt failed.

### 2.4 Logging and alerts

| Event                                   | Today                                  | New                                                                               |
| --------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------- |
| Vertex failure that moves to OpenRouter | n/a                                    | warn `ai call using fallback`, with `provider: "openrouter"` and `fallbackReason` |
| Both routes failed                      | n/a                                    | error log, plus a Sentry report naming the feature (throttled per feature)        |
| OpenRouter 402 on a flagged row         | "AI traffic is on the OpenAI fallback" | must not say that. The report text is fixed to name the real situation.           |

## 3. Rollout (four PRs)

1. **PR 1, plumbing.** Behavior does not change.
   - The optional `primary`/`fallback` fields, the Vertex client, `vertexBreaker`, the flagged-row flow,
     `ai:smoke` support for the Vertex route, unit tests, and
     `.env.example` / CLAUDE.md env lines.
   - No row is flagged. This PR can merge before the owner's Google Cloud setup
     is done.
2. **PR 2, `photo-analyze` gets `primary: "vertex"`.** Same model, same adapt
   block, same `LOG_MAX_TOKENS` (1500).
   - Gate: `npm run ai:smoke -- photo-analyze` on the Vertex route, plus a
     fallback-off eval run on the existing photo set, compared with #1509's
     Flash-low numbers (7.76). It should land within noise, and the
     `finish_reason: length` count is reported.
   - After the deploy, prod logs must show `provider: "vertex"` lines for the
     feature.
   - **Privacy wording, in this PR.** `site/privacy/index.html:22` says Google
     is one of the companies OpenRouter "connects us to". From this PR on,
     photo scanning reaches Google directly. The recipient, the data and the
     zero retention are the same, so only the sentence changes: Google is
     reached directly for photo scanning, and through OpenRouter as a backup.
     The OpenRouter row (line 69) and the Google row (line 71) stay accurate:
     `photo-analyze` sends only the image, as the other 6 non-menu vision
     functions do (their signatures take only image data:
     `photo-analysis.ts:336/505/597/822`, `receipt-analysis.ts:100`,
     `front-label-analysis.ts:55`; `menu-analysis.ts:95-110` is the one that
     adds user context).
3. **PR 3, the five lower-risk rows.** `photo-classify`, `photo-recipe`,
   `receipt-scan`, `cooking-ingredient-photo` and `recipe-chat-image` move to
   `google/gemini-3.8-flash` with `adapt: { set: { reasoning_effort: "low" } }`
   and `primary: "vertex"`.
   - Gate per row: `ai:smoke` plus 3–5 real photos run through the service
     function, each read by a human against the photo (the #1509 lesson: the
     judge never sees the image).
   - Report each reply's token use and `finish_reason`. Raise a row's cap only
     where a reply was cut off, and record the measured numbers next to the
     change.
   - **The `detail` image parameter** (`recipe-chat-image` sends `"low"`; the
     cooking row varies it) must be accepted by Vertex. If Vertex rejects it,
     strip it in the Vertex body builder. Do not edit the call sites.
4. **PR 4, the three risky rows.** `photo-label`, `front-label-scan` and
   `menu-scan`.
   - **First, build an eval set per row** in `evals/datasets/`:
     - 8–12 real photos each, with a written inventory of what is visible;
     - hand-checked expected values for label numbers;
     - for menus, at least 3 cases whose user context has an allergy that a
       dish on the menu contains.
   - **Run a paired eval** (`npm run eval:paired`) of Gemini Flash-low on
     Vertex against gpt-4o. The owner approves each switch on the numbers.
     A row that does not pass stays on gpt-4o, and the owner decides next
     steps.
   - **The privacy-policy change ships in the PR that switches `menu-scan`.**
     `site/privacy/index.html`, the Google row, becomes: "Photo scanning
     (identifying foods, labels, menus and recipes in a photo)", and it
     receives "The photo and the scan instructions; for menu scans, also your
     goal, allergies and food dislikes, to suggest dishes — not your chats".
     Merging it in the same PR keeps the policy and the data flow true
     together.
   - **The two other OpenAI mentions stay accurate.** The OpenAI row still
     lists photo analysis, and it must drop the photo-scanning features that
     have moved. Done in this PR.

## 4. Owner setup (needed before PR 2)

1. Create a Google Cloud project, link billing, and enable the Vertex AI API.
2. Create a NEW service account (not the Google Play one) with the role
   `roles/aiplatform.user`, and create a JSON key for it. From the key, the
   `client_email` and `private_key` fields go into the env vars below.
3. Turn off Vertex AI's prompt caching for the project, so that no request
   data is retained. The exact console setting or API call is confirmed from
   Google's current documentation in plan Task 1. Request an abuse-monitoring
   logging exemption if Google still requires one for zero retention.
4. Set `GOOGLE_VERTEX_PROJECT`, `GOOGLE_VERTEX_SERVICE_ACCOUNT_EMAIL` and
   `GOOGLE_VERTEX_SERVICE_ACCOUNT_KEY` (the PEM, with `\n` for newlines):
   - in Railway (OCRecipes service, production);
   - in the local `.env` for smoke tests and evals.

   The agent never prints the key. Variable reads mask values.

## 5. Testing

- **Unit tests (`server/lib/__tests__/ai-client.test.ts`, fake clients).**
  - Flagged row: Vertex success; Vertex fail → OpenRouter success; both fail →
    throws, and `deps.fallback.chat.completions.create` is never called.
  - Flagged row: `vertex` is null → OpenRouter; both null → config error.
  - Flagged row, Vertex present, OpenRouter absent → Vertex answers, with no
    warn and no throw. This guards against today's early return
    (`ai-client.ts:231`, `!deps.openrouter` → straight to OpenAI) staying ahead
    of the new routing.
  - `vertexBreaker` open → straight to OpenRouter, and the OpenRouter breaker
    is untouched by Vertex failures (and the reverse).
  - Abort on Vertex is rethrown, without trying OpenRouter.
  - Bodies:
    - the Vertex body has no `provider` key;
    - the OpenRouter body has it;
    - both carry the adapt settings.
  - Eval context with the fallback off → one route only, failure recorded.
  - A flagged row with `stream: true` throws.
  - **Unflagged rows:** the existing tests stay green, unmodified. This is the
    regression guard for the 27 rows that don't move.
- **Table tests (`ai-models` tests).** Flagged rows have no `fallback`, and
  unflagged rows have one. The `SWITCHED` map matches the flagged rows.
- **Build failures.**
  - A missing env var → `vertex` null.
  - A bad key → the Vertex attempt fails as kind `config`, the call moves to
    OpenRouter, and the key value never appears in the reported message.
- **Live.** `ai:smoke` on the Vertex route for every flagged row, before its PR
  opens.

## 6. Risks

- **The model id or the `global` location may differ on Vertex.** Task 1
  checks this first. If the ids differ, the row gains an optional
  `vertexModel` field, the only design change allowed without a new review.
- **Gemini latency.** #1509 measured a p90 of 21 s against gpt-4o's 7.3 s on
  OpenRouter → Vertex. Calling direct removes one hop, not the model's own
  time. The PR 2 report gives p50/p90 from the eval run. Per-call timeouts
  (`OPENAI_TIMEOUT_*`) are unchanged. A Vertex timeout counts as a failure
  and moves the call to OpenRouter, so a hung Vertex call can cost up to two
  timeouts. That is acceptable for these rows, and the report says so.
- **OpenRouter's budget.** The workspace daily cap is $5. With Vertex primary,
  OpenRouter carries only failover traffic, which lowers the risk.
- **Cost visibility.** Vertex replies carry no `usage.cost`. Logs record token
  counts. Billing is read in Google Cloud.
