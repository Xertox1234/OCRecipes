# Owner rulings

Decisions the owner has already made. They are final: don't re-ask them, don't re-propose the
rejected options, and don't raise the "not unprompted" items unless the owner brings them up.
Each line gives the date it was decided, so a newer ruling wins over an older one.

This file exists so cloud and fresh sessions (which don't see local agent memory) stop re-opening
settled questions. When the owner makes a new lasting ruling, add a line here in the same PR or the
next one. This repo is public: write the decision and its reason, never account names, keys, IDs or
user data.

## Standing working rules

- **Always roll forward** (2026-09-17). A defect found after merge gets a fix PR. Never revert a
  merged commit and don't offer to. Say plainly the defect is live until the fix lands.
- **One review pass per PR, plus at most one confirmation pass** after in-place fixes
  (2026-09-22, refined 2026-10-30). Details: `docs/AI_WORKFLOW.md` → Review Policy.
- **Harness freeze covers only guard changes that add real CI time** (2026-10-16, restated
  2026-10-30). Other hook/guard edits are not frozen. Guard bypasses go to
  `docs/harness-residuals.md`, never a todo.
- **OTA updates are published only when the owner asks.** Offer once when relevant, never publish
  unasked.
- **Eval runs and other paid AI calls need the owner's OK first**, with a quoted cost.
- **Unused is not removable** (2026-11-05). Code that looks unused may be unfinished work: record
  it, report built-but-unwired code as "confirm intent", never delete a feature.
- **No paid CI runners** (2026-11-12). E2E must work on the free macOS runner. Running E2E
  overnight on the owner's Mac is deferred; raise only if asked.
- **Never edit `ios/` or `android/`** (Expo CNG, 2026-10-16). Native config lives in `app.json`
  and `plugins/`; `npx expo prebuild --clean` is safe.
- **The app has no users yet** (2026-10-06). Don't design allowlists, staging or
  old-binary compatibility gates "to protect users". Prod flag flips still need the owner's yes.
  Re-check after public launch.

## Product and safety

- **Oats are a gluten (wheat) risk everywhere** (2026-10-16), as a derived keyword (moderate and
  severe flag, mild doesn't). No "certified GF oats" carve-out. After any allergen keyword change:
  OTA, then the prod allergen backfill, then a server restart.
- **"Possible allergen" level** (2026-11-15): ambiguous foods (cookies, chocolate, pesto…) warn for
  all nine allergens. A possible match is hidden from "Safe for me" for moderate/severe allergies
  and shown with the warning for mild. A possible match never removes a diet icon; only a definite
  match does.
- **Family members' allergens are not sent to the AI** (2026-11-18). Family meal plans send only the
  headcount; the client's per-person clash warning is the safety net. Grocery items derived from
  family-only meals reaching the coach's grocery tool is accepted. Any new AI reader of family
  data needs a fresh ruling.
- **Coach family card** (2026-11-27): the Coach may propose adding ONE new family member from what
  the user typed in the chat (a name and the nine common allergens; the user picks each severity and
  taps Save). Stored family profiles are still never sent to the AI; the Coach knows only how many
  there are. Editing or reading existing profiles from the chat needs another ruling.
- **Coach food card** (2026-11-15): counted units ("egg", "slice") keep the coach's own estimate;
  don't add a per-unit weight to the `log_food_item` tool.
- **Keep the current design** (2026-10-29). No identity pass or redesign; don't borrow ideas from
  the old direction boards. Restyle within `client/constants/theme.ts` and existing shared
  components, matching neighbouring screens.
- **Auth** (2026-10-12): password minimum is 8 for everyone (breach check stays); no forced stop at
  sign-in, ever; two-step is optional and by emailed code only. Don't re-propose authenticator
  apps, recovery codes or a 15-character policy. A wrong identity-token key keeps the server running
  and alerts; it never refuses to start. Judge new auth friction by "would a first-time user
  delete the app?"
- **Scan cost cap** (2026-11-05): unconfirmed analyses get a separate claim-first cap (photo
  analysis 100, receipt scan 20); the daily scan limit is unchanged. Cook-mode round-then-sum is
  accepted.
- **Coach's notes are used only while the health-data consent is on record** (2026-11-24, coach
  chat audit). Owner: "If consent is withdrawn we should not do it"; for the existing notes, "Ask
  the user what they want to do with it". At withdrawal the app asks whether to delete the notes or
  keep them. Until the consent is given again Coach reads none, saves none and sends no commitment
  reminders; the user can still see and delete kept notes. A user who never answered the consent
  question is paused the same way (owner, later the same day: "Pause them too").
- **Coach's notes hold no medical conditions and no medications** (2026-11-25, coach chat audit).
  Owner: "I don't think it is appropriate to keep info like that in the notes, if the user is
  diabetic it should be known from onboarding, as for the meds I would say do not keep." Enforced
  in code for the notes Coach extracts and the ones a user types
  (`server/lib/health-note-screen.ts`). The onboarding conditions stay on the profile.
- **Coach is told the profile's health conditions** (2026-11-25). Owner: "Coach needs access to
  on-boarding info to function properly." The conditions go into Coach's context beside the goal,
  weight and activity level (`buildAboutUser` in `server/services/coach-context-builder.ts`), which
  sends them to the AI companies that run Coach. The privacy pages already name health conditions
  for AI coaching. The GLP-1 profile fields are still not read (owner, same day: "leave GLP-1 out").
  Coach does not add "check with your doctor" to an ordinary food answer because of a condition on
  the profile (owner, same day: "I don't like the repitition").
- **Privacy page date, not the consent version** (2026-11-24). The notes wording change moved the
  pages' effective date to November 24, 2026. `HEALTH_CONSENT_VERSION` stays at `2026-11-10`:
  nobody is asked to agree again (owner: "Date only").

## AI providers

- **Backup route is Vertex direct, Gemini 3.8 Flash, for every row** (2026-11-02). OpenRouter stays
  primary for text rows. No OpenAI-direct fallback anywhere. The privacy page must say Google may
  keep data for a limited period; never claim zero retention for Vertex (2026-10-20).
- **Stay on `gemini-3.8-flash`** (2026-11-15). No trial of or switch to newer Gemini models; don't
  raise new Gemini releases unprompted.
- **The gpt-4o/mini primary migration (Azure deadline 2027-04-14) waits** for the owner's own
  research (2026-11-03). Don't start it or push for it.
- **Image generation is Runware only** (2026-10-18).
- **Spoonacular is discovery only** (2026-10-12/19): its results are never shown; only recipe
  titles feed inspired-recipe prompts. Any cache of Spoonacular data needs their written permission
  first; storing anything beyond id/title/image is a licensing question for the owner.

## Architecture

- **Storage modules delete their own R2 images** (2026-11-06): write first, delete after commit,
  fire-and-forget. Don't re-raise "external I/O in the data layer" for these sites
  (`docs/rules/architecture.md` records the exception).
- **zod 4 + drizzle-zod 0.8 migration is sanctioned** (2026-11-09). Keep the body-shape guard
  regardless.
- **`@expo/cli` runtime-version cache patch stays** (2026-11-02). Regenerate it at each SDK bump.

## Web app

- **The web app is its own product, centred on Cookbook Creation** (2026-10-12). It does not mirror
  the mobile app. Stack locked: Astro + React islands, our own cookbook editor, the existing
  Express/Postgres as the single source of truth and the only auth. No CMS (EmDash, Payload and Puck
  were rejected).
- **Books contain only the user's own recipes and OCRecipes-authored ones** (2026-10-12),
  server-enforced.
- **pen.dev is deferred until the web work starts** (2026-09-27). Don't pitch it for the native app.

## Don't raise unprompted

- Store launch-prep gaps (agreements, ratings, listings, Google OAuth consent screen
  publishing): not until the owner says launch is near (2026-10-31).
- Nightly E2E failures: the owner considers the E2E work done (2026-11-06). Mention only if a
  required check on a PR you're landing fails because of it.
- The recipe-quality prompt experiment: parked until the owner says to resume (2026-11-15).
- On-device recipe import device checks: parked until the owner brings it up (2026-11-09).
- Simulator-only visual glitches with no device sighting: mention once at most.
