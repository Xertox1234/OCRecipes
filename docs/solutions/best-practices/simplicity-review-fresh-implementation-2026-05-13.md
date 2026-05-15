---
title: "Run a simplicity review immediately after every feature implementation"
track: knowledge
category: best-practices
tags: [simplicity, code-review, yagni, duplication, process]
module: client
created: 2026-03-19
---

# Run a simplicity review immediately after every feature implementation

## When this applies

Right after the initial implementation of a feature, before merging. The HomeScreen redesign review caught **~25% removable code** from a fresh implementation — duplication and dead code are easiest to spot the moment they are introduced, not months later.

## The checklist

1. **Search for existing components before creating new ones.** Before writing a "menu," "popup," or "overlay" component, grep for the keywords that describe its behavior (`backdrop`, `speed dial`, `bottom sheet`).
2. **If two components differ by one optional prop, merge them.** Two files for one `subtitle` line is more code than one component with an optional prop.
3. **Multiple hooks reading the same storage module is a smell.** When a single screen always uses both, merge them into one hook with one init call.
4. **Replace 3+ near-identical JSX blocks with `.map()` over a config array.** If blocks differ only by key/title/delay, extract a `SECTIONS` array.
5. **Centralize navigation targets.** If `screenA.tsx` calls `navigation.navigate("Scan")` and a shared `action-config.ts` also handles "Scan," let one file own the navigation; the other delegates.
6. **YAGNI applies to fresh code.** Remove unused `type` fields, unused utility exports, and premature `ready` state in the same session you wrote them.

## Why

The urge to "add it while I'm here" is strongest during initial implementation. A simplicity review at that moment is more effective than discovering bloat months later. The HomeScreen review removed ~25% of new code (`ScanMenu`/`SpeedDial` duplicate, `ActionRow`/`FeatureCard` merge, `useSectionState`/`useRecentActions` merge, copy-pasted JSX, duplicated navigation, dead fields/utilities).

## Examples

- `ScanMenu` was line-for-line identical to `SpeedDial`. The implementer searched for "menu" and missed "speed dial." Searching for "backdrop" would have surfaced the existing component.
- `ActionRow` + `FeatureCard` differed only by an optional subtitle. Merged into one `ActionRow` with optional `subtitle` prop.
- 4 near-identical `<Animated.View><CollapsibleSection>` blocks in HomeScreen collapsed to one `.map()` over a `SECTIONS` config (48 lines → 12).

## Exceptions

- Genuinely separate consumers can justify two hooks reading the same storage module — but verify with a quick "where is each used?" grep first.
- A pure helper that has no consumer **yet** but is required by an active follow-up todo is acceptable; commit it with the todo reference in the commit message.

## Related Files

- `client/components/home/action-config.ts`
- `client/components/home/ActionRow.tsx`
- `client/hooks/useHomeActions.ts`
- `client/components/ScanFAB.tsx`

## See Also

- [Config-driven screen rendering](../design-patterns/config-driven-screen-rendering-2026-05-13.md)
