# OCRecipes design direction

**Status: keep the current design (owner ruling 2026-10-29).** The identity pass proposed on
2026-10-21 is closed: the owner is happy with the current look and chose none of the five
directions on the canvas, and asked that no ideas be borrowed from them.

## Rules

- Follow `client/constants/theme.ts` and the existing shared components for colours, type,
  spacing and motion. Restyle within those tokens; match neighbouring screens.
- **Don't propose another identity pass**, and don't restyle screens toward any of the canvas
  directions (no label-style panels, no receipt styling).
- The 2026-10-09 list-entrance rulings still apply: staggered entrance on the cookbook list and
  cookbook detail only, none on recipe-finder rows.

## Screen records

### Cookbook cover (New / Edit Cookbook, cookbook list) — 2026-10-31

The cover is a physical book you are making, previewed live while you fill in the form.

| Part                     | Look                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| Board, no photo          | Terracotta cloth (`accentSolid`, AA-safe in both themes) with a light-to-dark gradient      |
| Ink, no photo            | The theme's cream: `backgroundRoot` in light, `text` in dark. Placeholder "Untitled" at 60% |
| Board, with photo        | The photo under a dark scrim; white ink (`buttonText`)                                      |
| Spine                    | Dark band down the hinge with a cream crease line                                           |
| Keyline                  | Hairline stamped border in the ink colour                                                   |
| Pages                    | `surface` block with two `border` lines, showing 6pt past the fore-edge                     |
| Lift                     | Shadow on its own board layer (an `overflow: hidden` view clips its own shadow on iOS)      |
| Type                     | Title in the platform serif, description under it in serif italic (2 lines)                 |
| List thumbnail, no photo | The same terracotta with a cream book icon                                                  |

Moments and budget:

| Moment                         | How often           | Budget                                                                                                     |
| ------------------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Typing the name or description | Many times a minute | No motion: the text lands on the cover in place                                                            |
| Field focus                    | A few times         | Cover compacts with `expandTimingConfig` so it stays above the keyboard                                    |
| Tap the cover                  | A few times         | Press spring 0.98 (`pressSpringConfig`), opens the photo picker                                            |
| Cover generation armed         | Rare                | Feather badge on the cover, no motion                                                                      |
| Cookbook saved                 | Once per visit      | The signature: overshoot pop (`successPopConfig`, to 1.05 and back), success toast, then close after 450ms |

Reduced motion: the cover's size change snaps, a cover press dims instead of scaling, and save
skips the pop and closes at once. The haptic and the toast stay.

### New Cookbook flow (create) — 2026-10-31

New Cookbook is four steps: Basics, Cover, Recipes, Review. It follows the owner's Claude Design
project "AI-Powered Cookbook Creator", scoped to what today's server can do. Left for later: the AI
cover studio, Pages, "What's it for", and the AI suggestion chips. Edit mode keeps the single-page
form (`CookbookEditForm`).

| Part                | Look                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Step bar segments   | `link` for every step reached so far, `backgroundTertiary` for the rest; the fill colour fades in                               |
| Step bar labels     | Uppercase. The current step is `link` in semibold, the others `textSecondary`                                                   |
| Reached steps       | Tappable: behind the current step "Go back to Cover", reached ahead of it "Go to Review". Each label cell is at least 44pt tall |
| Cover cards         | Unselected: `border` outline on `surface`. Selected: `link` outline, `link` at 8% fill, tinted icon                             |
| Bottom bar          | Back (steps 2 to 4) beside one primary button, on `backgroundRoot` with a `border` top line                                     |
| Primary button text | Continue; "Continue · N recipes" once some are picked; "Skip for now" with none; "Create Cookbook" last                         |

Rules:

- The name is required.
- The cover is optional: the plain cloth is a valid cover.
- Pick at least one recipe, unless you have none. Then the button reads "Skip for now".
- Jumping forward (step bar, Review's Edit links) is refused while an earlier rule is unmet.
- While recipes are still loading, Continue does not advance.

Moments and budget:

| Moment             | How often      | Budget                                                                                                                     |
| ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Step change        | A few times    | Cross-fade: 220ms in, 120ms out. Scrolls to the top. VoiceOver hears "Step n of 4, <Label>"                                |
| Blocked Continue   | Rare           | Error haptic, the message shakes, and the message is announced. A refused jump stays quiet (no step announcement)          |
| Cookbook created   | Once per visit | The signature: the cover pops (`successPopConfig`), success haptic, toast "Cookbook created", close after 450ms            |
| Created with a gap | Rare           | No pop. Warning haptic and a toast from `describeWizardOutcome`, e.g. "Cookbook created, but 2 recipes couldn't be added." |

Reduced motion: no fade, no pop, and the screen closes at once. The announcements, haptics and
messages stay.
