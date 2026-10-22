# OCRecipes design direction

**Status: identity pass proposed 2026-10-21, waiting for the owner's pick.**

The current look (cream background, terracotta accent, Poppins) is a common AI-generated default, so an
identity pass was proposed instead of restyling screens one at a time. Five Home-screen directions are on
the canvas: https://claude.ai/artifact/JMPjUh3UPw3A6qqsj8WcXw

1. Keep what you have
2. Nutrition Facts
3. Day dots
4. Receipt
5. Transit map

## Until a direction is picked

- Follow `client/constants/theme.ts` and the existing shared components for colors, type, spacing and
  motion. Don't restyle screens toward any of the five directions.
- **Don't propose another identity pass.** This one is open, and the choice belongs to the owner.
  New UI work follows the current system; mention the open pick only if the work depends on it.
- The 2026-10-09 list-entrance rulings still apply: staggered entrance on the cookbook list and cookbook
  detail only, none on recipe-finder rows.

## After a pick

Replace this file with the chosen direction: what it is and why it fits, the rejected directions,
the signature moments, and the tokens it changes in `theme.ts`.
