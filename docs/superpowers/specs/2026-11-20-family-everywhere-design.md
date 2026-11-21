# Family, visible from the start — design

Date: 2026-11-20, revised 2026-11-21. Builds on
`2026-11-16-plan-week-grid-family-profiles-design.md` (the "family spec" below), which shipped as
#1890 and #1893. Every ruling in that spec still holds.

## Why

Family planning exists, but a person only meets it if they open Profile settings and flip a
switch, and once on it changes one tab. The owner sees family as a feature that can set the app
apart and wants it woven in: someone who cooks for a family should learn in their first minutes
that everyone they feed is covered, and keep meeting family touches as they use the app. It should
also win new subscriptions.

## Owner decisions (final)

1. **People with no use for family see no family features in the UI** (2026-11-20). The onboarding
   card below is the one place everyone sees family mentioned, once.
2. **Every family feature is premium.** Nothing family works on a free account. Free users see the
   locked row in Profile settings, as today.
3. **Onboarding shows an information card** about the family feature: that it is premium and how
   to turn it on. Then onboarding moves to the next step. No setup happens in onboarding
   (2026-11-21; this replaces the earlier draft where onboarding collected names).
4. **The card reads like sales copy.** It promotes the feature and encourages subscribing.
5. **Three stages, three PRs:** the front door, then recipes, then reminders around the app.
6. Named wants: tips, and a way to "Family Size" a recipe.

## My calls (not confirmed by the owner — correct any of these)

- **The card is its own onboarding screen with one button, Continue.** No purchase button on it:
  buying in the middle of onboarding is a detour, and the owner asked for "then onto the next
  step". The card says where to turn it on instead.
- **It comes right after Welcome**, before the AI-sharing question, and is not counted as a
  question step (the Welcome copy keeps saying "6 quick steps"). The first draft put it after the
  health-data consent, but that screen's copy leads straight into the health questions.
- **Everyone sees it once, in onboarding only**, including people who skip nothing else. Skipping
  onboarding skips the card. Existing accounts never see it.
- **The card promises only what works today**: shared and one-person meals, per-person allergy
  checks in the plan, grocery lists sized for everyone. Family Size is added to the copy when
  stage 2 ships.
- **Tips (stage 3) go only to people whose family planning is on.** No tip advertises family.

## Goals

- A new user learns in onboarding that the app can plan for their whole family, that it is part of
  Premium, and where to turn it on.
- After that, for people who turned it on, family shows up where it helps: on recipes (stage 2)
  and around the app (stage 3).

## Non-goals

- Collecting family names, a "who do you cook for" answer, or anything else in onboarding.
- Any server, database or access-rule change in stage 1.
- Anything where an AI provider learns about family members. Ruled out 2026-11-18; not reopened.
- Per-person calorie targets, logging for a family member, invites, shared accounts (family spec).
- "Family favourites" or recording who liked a recipe. It needs new stored data; a later project.
- Any restyle. Existing theme, components and tokens only (owner ruling 2026-10-29).

## Anti-goals

- A person who never turned family on meeting a family tip, chip, button or card anywhere after
  onboarding, other than the Profile settings row.
- The card reading as if family were free, so the lock in Profile comes as a surprise.
- The card promising something the app does not do yet.
- Family Size, or anything else, writing a headcount into a planned meal's `servings` (that puts
  four portions on the user's own calorie ring; family spec anti-goal).
- A profile's name, allergies or note reaching an AI provider.

## How it works today

- **The gate.** `isFamilyPlanningActive` (`shared/types/family.ts`) is true only with the premium
  flag `familyProfiles` AND `user_profiles.familyPlanningEnabled`. On the client, `usePlanFamily`
  (`client/hooks/useFamily.ts`) returns null unless family is active and there is at least one
  profile, and the Plan tab renders no family control on null.
- **Profile row** (`client/hooks/useFamilySwitch.ts`): "Plan for my family". Hidden while the plan
  is unknown; on a free plan the switch reads off and a press opens the upgrade prompt; on premium
  it turns family on and leads to adding the first person.
- **Onboarding** (`client/context/onboarding-steps.ts`): Welcome, AiSharing, HealthDataConsent
  (`INTRO_SCREEN_COUNT = 3`), then six question screens. The step count, progress bar and the
  Welcome copy's "6 quick steps" derive from that list and that count.
- **Recipes** have a serving adjuster (`client/hooks/useServingAdjuster.ts`, used by
  `client/components/RecipeDetailContent.tsx`) that scales displayed ingredients.
- **Clash check**: `getEaters`, `getMealClashes`, `describeClash` and `ALLERGENS_NOT_CHECKED` in
  `client/components/meal-plan/family-utils.ts`. Local, no AI.
- **Tips**: `FeatureTip` plus `useFeatureTip`, shown once each, used on Home, Scan, Pantry and the
  import screens.

## Approaches

**Staging (owner's choice).**

|                        | What                                    | Trade-off                                          |
| ---------------------- | --------------------------------------- | -------------------------------------------------- |
| **1. Three stages**    | front door → recipes → reminders        | each is seen on a phone before the next            |
| 2. Only what was named | onboarding, tips, Family Size in one PR | smaller; family still mostly lives in the Plan tab |
| 3. One PR              | everything                              | one very large review; one flaw holds up all of it |

The owner chose 1.

**What onboarding does about family.**

|                            | What                                                        | Trade-off                                                                                              |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| A. Ask and collect names   | "Who do you cook for?", names saved for free accounts       | feels set up, but loosens a server rule, stores other people's names for accounts that cannot use them |
| **B. An information card** | one promotional screen: what it is, that it is Premium, how | client-only, no data, no security surface; nothing is set up until the person upgrades and turns it on |
| C. Nothing in onboarding   | promote it elsewhere                                        | misses "from the start"                                                                                |

The owner chose B (2026-11-21). A was the earlier draft.

## Stage 1 — the front door (a small change)

One new onboarding screen, `FamilyIntro`, after Welcome and before AiSharing. It is an
intro screen (the intro count becomes 4), shown with or without the health-data consent, and it
collects nothing.

```
            [ family / group icon ]

        Cooking for more than one?

   Plan the week for your whole table.

   ✓  One plan for everyone: mark a meal as shared,
      or just for one person
   ✓  Allergy checks for each person you cook for
   ✓  Grocery lists sized for every plate

   Family planning is part of Premium.
   Turn it on any time in Profile → Plan for my family.

                 [ Continue ]
```

- **Copy.** Sales in tone, plain in words, and true: the three points above are what the feature
  does today. It must say both that it is part of Premium and where to turn it on (owner decisions
  3 and 4). The wording above is a draft for the owner to change.
- **Behaviour.** Continue goes to the next step; back works as on the other screens. Nothing is
  saved and nothing is sent. Shown once per onboarding, to free and premium accounts alike.
- **Look.** Existing onboarding layout, theme tokens and components. Entrance motion follows the
  other onboarding screens and respects reduced motion.
- **Accessibility.** The headline is a header; the three points read as a list; the Premium line
  is read, not only drawn.
- **Not touched:** the server, the database, the Profile row, `householdSize`, the privacy pages.

Tests first: the step list has the new screen in the right place; the intro count is 4 and the
question-step labels and "6 quick steps" are unchanged, with and without consent; the screen
renders its copy and Continue advances. The Maestro onboarding flows gain the screen.

No security review is needed (client-only, no data). One ordinary review pass.

## Stage 2 — recipes (outline; not planned until its questions are answered)

Everything here renders only when `usePlanFamily()` is non-null. That hook is the single gate for
every surface in stages 2 and 3; if it has to move out of the meal-plan area to be shared, move it
rather than writing a second gate.

- **Family Size.** A control on the recipe page that sets the existing serving adjuster to the
  family headcount (the user plus each profile), so the ingredient list shows the amount to cook.
  It changes what is displayed, never a stored `servings`. If it also offers "add to plan", the
  meal is added as `shared` with the user's own portion; the grocery list already adds one portion
  per profile for shared meals. When this ships, the onboarding card gains a line about it.
- **Per-person clash lines on the recipe page**, reusing `getMealClashes` and `describeClash`.
  "Possible" foods are worded "may contain", never "contains" (owner ruling 2026-11-15). A recipe
  whose allergens are not worked out says "Allergens not checked".
- **Warning when a meal is picked for the plan**:
  `todos/P2-2026-11-20-allergen-warning-when-a-meal-is-picked.md`. This stage carries that todo.

Open — the owner's decision, to be asked before this stage is planned:

1. The todo's four questions: which add paths are covered; warn-and-continue or block; the
   wording and placement, including the not-checked case; whether who the meal is for is shown.
2. Family Size: one portion per person, or a way to count a small child as less? And is it only a
   scaling button, or does it also add the meal to the plan as shared?
3. Does recipe search get a "Safe for my family" filter beside "Safe for me"? (It would run on our
   server against stored allergens; no AI. It is new server work, unlike the two items above.)

## Stage 3 — reminders around the app (outline)

Same gate. Candidates, all display-only on data the app already computes:

- One-time tips for family-active users: on the Plan tab (what shared means), on a recipe (Family
  Size), on the grocery list.
- A line on a generated grocery list: "Covers 4 people".
- A Home card for tonight's shared dinner, with any clash named.

Open — the owner's decision: which of these to build, and the Home card's place among the existing
Home sections.

## Left to the builder (stage 1)

Component breakdown, the icon, spacing, and final copy once the owner has edited the draft.
