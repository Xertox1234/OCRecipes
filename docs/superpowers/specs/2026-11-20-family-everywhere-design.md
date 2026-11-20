# Family, visible from the start — design

Date: 2026-11-20. Builds on `2026-11-16-plan-week-grid-family-profiles-design.md` (the "family
spec" below), which shipped as #1890 and #1893. Every ruling in that spec still holds.

## Why

Family planning exists, but a person only meets it if they open Profile settings and flip a
switch, and once on it changes one tab. The owner sees family as a feature that can set the app
apart and wants it woven in: someone who cooks for a family should learn in their first minutes
that everyone they feed is covered, and keep meeting family touches as they use the app. Someone
who cooks for one should never see any of it.

## Owner decisions (final, 2026-11-20)

1. **People with no use for family see no family features in the UI.**
2. **Every family feature is premium.** Nothing family works on a free account.
3. **A person can set their family up in onboarding**, free or not. For a free account the result
   is visible only as the locked "Plan for my family" row in Profile settings.
4. **Onboarding makes it clear that family is a premium feature.**
5. **Three stages, three PRs:** the front door, then recipes, then reminders around the app.
6. Named wants: onboarding setup, tips, and a way to "Family Size" a recipe.

## My calls (not confirmed by the owner — correct any of these)

- **Onboarding collects names only, no allergies or notes.** Nobody is premium during onboarding,
  so anything collected sits unused until an upgrade that may never come. Names are not health
  data; allergies of other people (some of them children) are. Allergies are added after upgrading.
  The owner was asked this directly and answered a different point, so this is unconfirmed.
- **No paywall in the middle of onboarding.** One upgrade offer when onboarding finishes, shown
  only to people who chose "My family".
- **The "Plan for my family" row in Profile stays visible to everyone**, as today. It is the only
  way in for someone who chose "Just me" or whose account predates this work.
- **A free account that has entered names also sees the "Family" link** under the locked switch,
  so it can see, add to and delete the names it entered. Deleting them all is how a free person
  changes their mind.
- **Upgrading through a family prompt turns family planning on; upgrading any other way does
  not.** In the second case the switch is simply unlocked and off, with the names waiting. This
  keeps owner decision 1: nobody gets family features without asking for them.
- **Tips go only to people whose family planning is active.** No tip advertises family to anyone
  else.
- **Existing accounts are untouched.** They are never re-asked; their switch stays as it is.
- **The new step does not write `householdSize`** (reason under Stage 1).
- **Free accounts can add and delete names but not rename them** (reason under Stage 1).

## Goals

- A new user is asked who they cook for, can enter their family, and is told plainly that family
  planning is part of Premium.
- Upgrading turns family planning on with the people already entered, with no further setup.
- After that, family shows up where it helps: on recipes (stage 2) and around the app (stage 3).

## Non-goals

- Anything where an AI provider learns about family members. Ruled out 2026-11-18; not reopened.
- Per-person calorie targets, logging for a family member, invites, shared accounts (family spec).
- "Family favourites" or recording who liked a recipe. It needs new stored data; a later project.
- Any restyle. Existing theme, components and tokens only (owner ruling 2026-10-29).
- Re-asking existing users, or changing what the onboarding `householdSize` value does.

## Anti-goals

- A "Just me" person seeing a family tip, chip, button, card or upsell anywhere outside the one
  Profile settings row.
- A free account storing a family member's allergies or note.
- Family Size, or anything else, writing a headcount into a planned meal's `servings` (that puts
  four portions on the user's own calorie ring; family spec anti-goal).
- A profile's name, allergies or note reaching an AI provider.
- A new user reading the family choice as free and meeting a paywall later as a surprise.

## How it works today

- **The gate.** `isFamilyPlanningActive` (`shared/types/family.ts`) is true only with the premium
  flag `familyProfiles` AND `user_profiles.familyPlanningEnabled`. Every functional reader goes
  through it: on the server `getFamilyContext` (`server/services/family-context.ts`, used by the
  meal-plan and grocery routes and the pantry generator); on the client `useFamilyContext` and
  `usePlanFamily` (`client/hooks/useFamily.ts`). `usePlanFamily` returns null unless family is
  active and there is at least one profile, and the Plan tab renders no family control on null.
  Verified 2026-11-20 by grepping every use of `familyPlanningEnabled`: the only readers that skip
  the premium half are the Profile row (`useFamilySwitch`: `serverOn`, which shows the "Family"
  link) and the `enabled` field of `GET /api/family-profiles`.
- **Server rules** (`server/routes/family.ts`): `GET` and `DELETE /api/family-profiles` are open
  to any signed-in account (so a lapsed user can clean up). `POST` and `PUT /:id` need premium.
  `PUT /api/family-planning` needs premium to turn on, never to turn off. Allergies or a note need
  the health-data consent. The profile-update path strips `familyPlanningEnabled`
  (`server/storage/user-profiles.ts`), so only `setFamilyPlanningEnabled` writes it.
- **Profile row** (`client/hooks/useFamilySwitch.ts`): hidden while the plan is unknown; on a free
  plan the switch reads off and a press opens the upgrade prompt.
- **Onboarding** (`client/context/onboarding-steps.ts`): Welcome, AiSharing, HealthDataConsent,
  then six question screens. The step count, progress bar and the Welcome copy's "6 quick steps"
  derive from the list. `completeOnboarding` (`client/context/OnboardingContext.tsx`) posts the
  profile, then the taste picks, then marks the user onboarded. Skipping posts the defaults.
- **`householdSize`** is carried in the onboarding data (default 1) but no screen asks for it.
  The server reads it in the pantry generator when family is not active (portions on the user's
  ring, the family spec's known exception), the coach's about-you lines, Recipe Finder and
  inspired recipes.
- **Recipes** have a serving adjuster (`client/hooks/useServingAdjuster.ts`, used by
  `client/components/RecipeDetailContent.tsx`) that scales displayed ingredients.
- **Clash check**: `getEaters`, `getMealClashes`, `describeClash` and `ALLERGENS_NOT_CHECKED` in
  `client/components/meal-plan/family-utils.ts`. Local, no AI.
- **Tips**: `FeatureTip` plus `useFeatureTip`, shown once each, used on Home, Scan, Pantry and the
  import screens.

## Approaches

**Staging (owner's choice).**

|                        | What                                    | Trade-off                                                                             |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------- |
| **1. Three stages**    | front door → recipes → reminders        | each is seen on a phone before the next; the one server rule change is reviewed alone |
| 2. Only what was named | onboarding, tips, Family Size in one PR | smaller; family still mostly lives in the Plan tab                                    |
| 3. One PR              | everything                              | one very large review; one flaw holds up all of it                                    |

The owner chose 1.

**Where a free account's family lives until it upgrades (my call).**

|                                                       | What                                                                                                                         | Trade-off                                                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Real rows and the switch stored on                 | names saved as `family_profiles` rows; onboarding also stores the switch on, premium being the gate's other half             | upgrade needs no code, but two server rules loosen, a free account cannot take the wish back, and a person who later upgrades for another reason gets family unasked |
| **B. Real rows, switch left alone**                   | names saved as `family_profiles` rows; the switch is turned on by the app only after an upgrade made through a family prompt | no migration; one server rule loosens; the switch route keeps its premium gate                                                                                       |
| C. New "wants family" column and a names holding area | separate from the live tables                                                                                                | nothing loosens, but a migration, a copy step at upgrade, and a second place holding names                                                                           |
| D. Keep it on the phone                               | names in device storage until upgrade                                                                                        | no server change; lost on reinstall or a second device                                                                                                               |

Chosen: B. A was the first draft; the builder check showed its three costs. Under B the names are
the whole record of a free account's family, and the stored switch keeps meaning what it means
today.

## Stage 1 — the front door (buildable now)

### Onboarding step

A new screen, `Household`, the first question screen (before Allergies). It is not a health
screen, so it is shown with or without the health-data consent.

```
 Who do you cook for?

 ( ) Just me
 ( ) My family                      [Premium]
     Plan meals, scale recipes and check allergies
     for everyone you feed. Part of Premium.

 — only when "My family" is chosen —
 Who's at your table?
   Ivy                         ✕
   Leo                         ✕
   + Add a person
 You can set this up now. It unlocks with Premium.

 [ Continue ]
```

- "Just me" is selected by default. Names: required text, max 50 characters, at most 8 people (the
  existing limits). "My family" with no names is allowed; it records the wish only.
- The Premium marker and both lines of copy are required (owner decision 4). Exact wording is the
  builder's, in plain words.
- Skipping onboarding counts as "Just me".
- On finish, only for "My family": create one profile per name. In `completeOnboarding` this goes
  after the taste picks succeed and before the user is marked onboarded. Unlike the taste picks
  (whose failure keeps the person on the last step to retry), a failed name is swallowed and
  logged: it never blocks finishing. A finish that is retried must not create duplicate names.
  If every name failed, the person has no Family link and sets their family up after upgrading.
- Then, only for "My family" and only when the account is not already premium: one upgrade offer
  using the existing upgrade prompt, framed around family planning. Declining leaves the person
  in the app as a free user. It is not shown again on later launches.
- An account that is already premium when it finishes (a restored purchase) and chose "My family"
  gets the switch turned on straight away through the existing route.
- The step does not touch `householdSize`. Writing the family headcount there would send
  "cooks for N people" to the coach and put N portions on a free user's ring through the pantry
  generator's old path, widening an exception the family spec left for the owner to rule on.

### Server

- `POST /api/family-profiles`: open to any signed-in account. A non-premium account sending any
  allergy or a note is refused with `PREMIUM_REQUIRED`; the health-consent check for those fields
  stays for premium accounts. The 8-profile limit applies to everyone.
- `PUT /api/family-profiles/:id` stays premium. A free account that mistyped a name deletes it and
  adds it again. This keeps the rule simple ("free accounts never write to an existing profile")
  and avoids deciding what a lapsed account's rename does to stored allergies.
- `PUT /api/family-planning` is unchanged: turning on still needs premium.
- No schema change and no migration.
- Meal audiences are untouched: writing `shared` or `profile` on a planned meal stays premium.

### Client after onboarding

- **Free account with at least one name:** the Profile switch still reads off with its lock and
  opens the upgrade prompt (today's behaviour). The "Family" link shows beneath it. Today that
  link follows the stored switch alone (`showFamilyRow` in `useFamilySwitch`); it becomes "stored
  switch on, or at least one profile", which means the profile list is fetched for the Profile
  row on non-premium accounts too. The Family list shows the names and lets a free account add
  and delete (today the list has no add button without premium: `canEdit` in
  `FamilyProfilesScreen.tsx`). The edit screen is not reachable for an existing person on a free
  account; adding a person shows the name field only, with the allergies and note area replaced
  by one line saying they come with Premium. No family control appears anywhere else
  (`usePlanFamily` stays null without premium).
- **Free account with no names** (chose "Just me", skipped, or deleted them all): the locked row
  only, as today.
- **On upgrade through a family prompt** (the end-of-onboarding offer, or the locked row in
  Profile): once the purchase is confirmed and the plan reads premium, the app turns the switch
  on through the existing route. The Plan tab then shows the chips for the people already
  entered. If that write fails the switch is simply off and unlocked; the person flips it.
- **On upgrade any other way:** the switch is unlocked and off, the names are waiting, and the
  Family link is there. Nothing family appears until the person turns it on.
- The Family list shows each person without allergies as "No allergies added", so the next step
  after upgrading is obvious.
- **"Just me", skipped, and existing accounts:** exactly as today.
- **Lapsed premium:** as the family spec says (treated as off, data kept). One new consequence: a
  lapsed account can now add a name-only person. Accepted; it matches a free account. A lapsed
  account whose stored switch is on gets family back on resubscribing, as the family spec says.

### Also in this stage

- Privacy pages (`site/privacy/index.html` and `site/health-privacy/index.html`, pinned by
  `shared/__tests__/site-privacy-family-profiles.test.ts`): one added line that a free account
  may store the first names of people it cooks for, that nothing else about them is stored
  without Premium, and how to delete them. Names are already in the data export and removed with
  the account. The Law 25 assessment is not in the repo; the owner updates it.
- The PR gets a security review (one access rule loosens) and is not auto-merged.
- The Maestro onboarding flows gain the new step.
- Never passed to the kimi workers (family data).

### Tests the builder writes first

- Server: a free account can create a name-only profile; is refused with allergies or a note; is
  refused on `PUT /:id`; is still refused turning the switch on; `getFamilyContext` is inactive
  for it.
- Client: step order and counts with and without consent; "Just me" and skip send nothing family;
  "My family" sends one create per name and a failed create does not block the finish; the upgrade
  offer shows only for a non-premium "My family" finish; the Family link shows for a free account
  with a name and not without; the switch is turned on after a family-prompt upgrade and not
  after any other.

## Stage 2 — recipes (outline; not planned until its questions are answered)

Everything here renders only when `usePlanFamily()` is non-null. That hook is the single gate for
every surface in stages 2 and 3; if it has to move out of the meal-plan area to be shared, move it
rather than writing a second gate.

- **Family Size.** A control on the recipe page that sets the existing serving adjuster to the
  family headcount (the user plus each profile), so the ingredient list shows the amount to cook.
  It changes what is displayed, never a stored `servings`. If it also offers "add to plan", the
  meal is added as `shared` with the user's own portion; the grocery list already adds one portion
  per profile for shared meals.
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

Screen and component breakdown; exact copy; which existing component marks "Premium"; where the
upgrade offer is triggered from so it survives the onboarding-to-app navigation switch; how
duplicate names are avoided on a retried finish; how the app knows an upgrade came from a family
prompt; route and hook shapes; whether the free add-person
form is the existing edit screen in a reduced mode or a small separate form.
