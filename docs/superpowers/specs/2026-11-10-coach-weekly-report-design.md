# Coach weekly report ("Sunday look-back") — design

Date: 2026-11-10. Research source: Coach chat polish report (idea P5, with M9, M12, M19, R12, T3, T4).
Mockups: https://claude.ai/artifact/CYQJeV7GsADsJTXPwioQkh (five phone screens; sample data).

## Why

Coach Pro already knows a lot about each person's week (meal logs, 7-day meal patterns, recipes saved,
goals) but never looks back with them. A weekly report turns that into one personal moment a week:
what went well, what to watch, one idea for next week. The research named it the app's one
"signature moment" and the one place a small celebration is earned.

It is also a retention lever for paying users. A Coach Pro subscriber who barely used the app this
week gets an easier way back in and learns about features they are paying for but haven't tried.

## Owner decisions (final)

1. **Everything in the research idea stays:** wins first, patterns, one idea for next week, a
   goal-vs-actual chart.
2. **It lives in the profile, not the chat.** It's a saved report people can return to, not a chat
   message that gets buried.
3. **Delivery: a push notification, or an in-app popup if the person is already in the app.**
   Whichever happens first; never both for the same report.
4. **Coach Pro only.**
5. **AI-written words, exact numbers.** Coach writes the sentences (one AI call per Pro user per
   week); every number shown comes from the person's own data, not the model.
6. **Light weeks still get a report.** The report shows what was logged, then makes the app easier
   to use: camera logging, recipe import and other features the person hasn't used.
7. **Highlight recipes saved or imported that week.**
8. **Show how often they showed up.** Drawn as "N of 7 days you showed up", shown in every week,
   light weeks included.
9. **A "Did you know?" card** promoting one real feature, e.g. barcode scanning for nutrition,
   macros and allergens.
10. **Past reports can be reviewed, with trends** across weeks.
11. **"Met the goal" (per day):** protein counts when the day reaches at least 90% of the protein
    goal. Calories counts when the day lands within ±10% of the calorie goal; under is never better
    than over. Carbs, if shown, uses the same ±10% band.
12. **The celebration** plays when protein met its goal on 5 or more days of the week, or when the
    person logged on all 7 days. A user with no protein goal gets no protein stat, protein chart or
    protein celebration (the 7-day logging celebration still applies).
13. **Fibre is dropped for now.** There is no fibre goal and logs don't snapshot fibre. Chart chips:
    Protein (default), Calories, Carbs. Trend chips: Protein days, Days active, Recipes. Fibre can come
    later as its own change.
14. **"Days you showed up"** = days with at least one meal logged (the app does not record opens).
15. **A lapsed Pro user can still read old reports** and they stay in the data export. New reports
    stop; the trends card shows only weeks that have a report.

## Goals

- A Pro user opens the app on Sunday and reads a short, accurate, encouraging look at their week.
- Every past week stays readable, exactly as written that Sunday.
- A trends view shows direction over the last six weeks.
- Light-week users are steered toward the easiest ways to log and toward features they haven't used.

## Non-goals

- No change to the Coach chat itself; the report is not a chat message.
- No free-tier version, no teaser for free users (that's a separate upsell decision).
- No weight tracking, body measurements or calorie-deficit maths.
- No editing of a report after it's written.

## Anti-goals (a failure even if it works)

- Any guilt: "you missed", "streak broken", "only 2 days", red numbers, a running streak that resets to
  zero. The research cites a charity's eating-disorder chatbot pulled for exactly this.
- Praising eating less, or ever presenting a calorie deficit as a win.
- Inferred guesses about body or mood ("you seem stressed").
- A number in the report that disagrees with the person's log.
- Both a push and a popup for the same report, or more than one report push per week.
- A celebration on a week where no goal was met, or a celebration that replays every time.

## Constraints

- Visual identity is fixed: restyle within `client/constants/theme.ts` only (owner ruling 2026-10-29).
  The mockups use existing tokens (cream background, terracotta accent, Poppins, 15 px card radius).
- Health-safety rules from the research (T4) apply to every word Coach writes here, and the
  existing coach safety rules in `server/services/nutrition-coach.ts` carry over.
- At most one report push a week; it goes through the existing notification registry
  (`server/services/notifications/registry.ts`) as a new category.
- Every proactive surface has a way to say less of this ("Fewer like this") and a settings route.
- Strict TDD, CI as the source of truth (project rules).

## What people see

### 1. Profile (mockup 1)

- For the week a report is new, a **"Your week" card** sits at the top of the profile: date range, a
  "New" badge, the report's headline, a 7-bar sparkline and "Read your week". _(Builder's call made in
  the mockup: the card shows only while unread or during its week; after that the tile is the way in.)_
- A **"Weekly Reports" tile** in the Library grid, with the report count. It opens the past-reports
  screen. Pro only; hidden for free users.

### 2. Sunday popup (mockup 2)

- A bottom sheet when the person is in the app at the moment the report becomes ready, or opens the
  app after it is ready and before the push went out.
- Content: "Your week is ready · <range>", the headline, one line, **Read my week**, and
  **Later — it's saved in your profile**.
- Shown once per report. Opening the report from the push counts as seen: no popup afterwards.

### 3. A normal week (mockup 3), top to bottom

1. **Headline card** — one sentence naming the week's best thing. When a weekly goal was met, it
   carries the **one celebration** (M12): a short, settled moment that plays once, the first time
   the report is opened, never again. No celebration if no goal was met.
2. **Week in numbers** — three stats: _N of 7 days you showed up_, _meals logged_, _recipes added_.
3. **Wins** — two short sentences.
4. **New in your kitchen** — each recipe saved or imported that week, with how it arrived and whether
   how often it was logged ("Saved · logged twice", "Imported from a link"). Tapping one opens the recipe.
5. **Goal vs actual chart** (M9) — bars per day against the goal line; chips switch the nutrient
   (Protein default; Calories; Carbs). Days that met the goal are in the accent; others neutral.
6. **Watch** — up to three plain patterns from the week (R12), e.g. "Dinner ran after 9 pm three
   times, all on weekdays." Facts about logged behaviour, never about the body.
7. **Next week** — one idea tied to a Watch pattern, with **Add to my plan** (where the idea is a
   recipe/meal) and **Ask Coach about this week** (opens Coach with the report as context).
8. **Did you know?** — one real feature, preferring one the person hasn't used.
9. Footer: **Fewer like this** and **Report settings**.

Headings are short (M19): Wins · Watch · Next week.

### 4. A quiet week (mockup 4)

- Headline that states it plainly and kindly ("A lighter week for logging, and that's fine.").
- The same **week in numbers** row, numbers shown as-is, same wording as any week.
- **From what you logged** — what the logged days showed, if anything.
- **Try this week** — up to two features, chosen from ones the person hasn't used, leading with the
  easiest logging (camera photo of a plate; recipe import from a photo or link).
- **Did you know?** card.
- A week with **no logs at all** still gets a report: the numbers row and the "Try this week" and
  "Did you know?" parts only. No wins, patterns or chart.

### 5. Past reports and trends (mockup 5)

- **Your trends** card: last six weeks, one bar per week. Chips: Protein days, Days active, Recipes
  (Fibre dropped, decision 13). Each bar is a **count of days a goal was met** (or days active / recipes added), not daily
  amounts. The newest week is highlighted. One line of commentary from Coach, written when the latest
  report was written.
- **Every week** list, newest first, each row the week's date range and headline; tapping opens that
  report exactly as it was written.
- Reports are kept for the life of the account (deleted with it, included in data export).

## How it works (decided parts)

- **The week:** Monday–Sunday in the person's own timezone. The report covers the week that is ending.
- **When:** Sunday evening, local time, using the existing local-hour scheduling in
  `server/services/notification-scheduler.ts`. _(Builder's call: the exact hour; the mockups assume
  around 18:00.)_
- **Who:** active Coach Pro users at generation time. A user who becomes Pro mid-week gets a report
  that Sunday.
- **Numbers first, words second.** A server step assembles the week's facts from stored data: days
  active, meals logged, per-day nutrient totals vs goals, goals met, recipes saved/imported and
  how often each was logged, meal patterns (reuse `buildMealPatternSummary` in
  `server/services/coach-context-builder.ts`), features used/unused. Coach is then given those facts
  and writes only the sentences (headline, wins, watch, next idea, trend line). It never computes or
  invents a number; every figure on screen is rendered from the assembled facts.
- **Saved once.** The facts and the written text are stored together as that week's report. Opening a
  report, now or months later, reads the stored copy. Editing an old meal later does not change an old
  report. Trends read the stored facts of the last six reports.
- **Celebration rule:** shown only when the facts say a weekly goal was met, and only on first open.
- **Did you know?** comes from a fixed list of real features written by us (not by the model), each
  with its action link. Pick one the person hasn't used; don't repeat until the list is used up.
  Starting list: barcode scan (nutrition, macros, allergens), photo of a plate, recipe import from a
  photo or link, pantry + "what can I make tonight?", meal plan with grocery list, voice logging in
  Coach, cookbooks.
- **Delivery:** a new notification category for the weekly report (push + in-app). Push and popup
  share one "delivered" record per report so only one ever fires.
- **Opt-out:** "Fewer like this" and Report settings let the person turn off the push (report still
  saved in the profile) or turn the report off entirely.

## Safety rules for the written text (T4)

- Lead with wins. Never use "missed", "failed", "only", "broken", "behind".
- No weight, body, deficit or restriction talk; never praise eating less or a low-calorie day.
- Patterns describe logged behaviour (timing, skipped meals, variety), never body or mood.
- If the week's data or the person's notebook shows disordered-eating signals, skip the patterns and
  "next" sections and use supportive copy with the existing professional-referral wording.
- If the model's output fails validation (schema, banned words, a number not in the facts), fall back
  to a data-only report with plain template sentences rather than showing nothing.

## Cost

One AI call per active Coach Pro user per week, plus a template fallback that costs nothing. No calls
on open, on the trends view or on old reports.

## Calls I made (from the builder check; owner may override)

- **Safety signal:** run the existing `disordered_eating` detector
  (`server/services/coach-intent-classifier.ts`) over the person's Coach messages from the week. If it
  fires, the report drops Watch, Next week and the trend line and uses supportive copy with the
  existing professional-referral wording. No extra AI call.
- **Delivery timing:** generate and deliver at the same moment. The push goes out at generation. When
  the app is in the foreground the client suppresses the banner and shows the popup instead; when the
  app comes to the foreground with an unseen report and the push was never opened, the popup shows.
  Seen state is one flag per report, so only one surface appears. The report does **not** use the
  `pending_reminders` in-app row, which lights the Coach badge (`hasPendingReminders` ignores type);
  the profile card's "New" badge is its own unread state.
- **Recipes "saved or imported" that week:** new favourites, new saved items, and recipes imported
  (meal-plan recipes created that week from an import source). The caption counts how many times the
  recipe was **logged** that week ("Saved · logged twice"), because the app records logging, not
  cooking. "Recipes added" is the count of these.
- **"Add to my plan"** is offered only when the Next-week idea names a recipe from the week's facts
  (the person's own recipes), validated by id. Otherwise the idea shows with only "Ask Coach about this
  week".
- **Mockup differences:** the mockups show Fibre chips and a "cooked twice" caption; this document
  wins.

## Left to the builder

- The data model for stored reports and the API shape.
- Exact Sunday hour, retries if generation fails, and backfilling a missed Sunday.
- Celebration motion details, within the existing motion and haptics conventions.
- How "feature not used yet" is detected for each Did you know? entry.
- The prompt text, within the rules above (prompt-engineer review applies).
- Accessibility labels for the charts (the mockups give one example).
