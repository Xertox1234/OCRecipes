---
title: "Re-verify WCAG contrast for every foreground after a background color change"
track: knowledge
category: best-practices
tags: [accessibility, wcag, theme, colors, contrast, rebrand]
module: client
applies_to: ["client/constants/theme.ts", "client/constants/**/*colors*.ts"]
symptoms:
  - "Background colour changed (e.g. white → cream) without revisiting foreground contrast"
  - "Greens or mid-greys that 'looked fine on white' appearing low-contrast on the new background"
  - "WCAG ratio comments in theme.ts not updated to match the new background"
created: 2026-05-12
severity: medium
---

# Re-verify WCAG contrast for every foreground after a background color change

## When this applies

Any change to `backgroundRoot`, `backgroundDefault`, or `backgroundSecondary` in `client/constants/theme.ts`, or to any other root-surface colour anywhere in the app. The check is required even for "small" luminance shifts (white → cream) because foreground colours near the 4.5:1 boundary — especially greens and mid-greys — flip from pass to fail with shifts that look visually trivial.

## Why it fails silently

A foreground green that _seems_ fine on white can fail audibly on a warm cream (`#FAF6F0`) because cream has lower luminance — the threshold (4.5:1) stays the same but the denominator shifted. Green is especially at risk — it typically sits close to the 4.5:1 minimum, and pre-rebrand "passing on white" was often only _just_ passing.

```text
// Example from the 2026-04-25 rebrand:
// #008A38 on #FFFFFF → 4.48:1  ✗ (already fails AA — just below the 4.5:1 floor)
// #008A38 on #FAF6F0 → 4.20:1  ✗ (fails AA, worse — cream bg is darker than white)
// Fix: darken to #007A30 → 5.1:1 on #FAF6F0 ✓
```

The lesson is not "this colour was passing before the rebrand" — it wasn't. The lesson is that **a colour borderline on one background fails decisively on a darker background**, and the rebrand was the moment that latent borderline became a visible failure.

## Checklist when changing any background

1. Identify every foreground colour used against that background (text, links, icons, status indicators).
2. Recalculate contrast ratio for each using the new background luminance.
3. Pay particular attention to greens and mid-greys — they are closest to the 4.5:1 boundary.
4. Update WCAG ratio comments in `theme.ts` to reflect the new accurate values.

## Where it applies

`backgroundRoot`, `backgroundDefault`, `backgroundSecondary` changes all affect every screen. Even a small luminance shift (white → cream) is enough to break borderline colours. Run the checklist before merging the colour change — fixing failing contrasts retroactively is more invasive than tuning them once at write time.

## Related Files

- `client/constants/theme.ts` — theme colour definitions with WCAG ratio comments

## See Also

- [Use theme values, not hardcoded colors](../conventions/use-theme-values-not-hardcoded-colors-2026-05-12.md) — hardcoded colours bypass this checklist entirely
