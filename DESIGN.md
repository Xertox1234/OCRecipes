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
