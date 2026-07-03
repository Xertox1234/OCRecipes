---
title: React Compiler is active — how it changes memoization findings and fixes
track: knowledge
category: best-practices
tags: [performance, react-compiler, react-native, expo, flatlist]
created: '2026-06-10'
source: 2026-06-10 full audit (M2 better-fix; M3/L7 false-positives)
---

## Rule

React Compiler is ACTIVE in this app (`app.json` → `experiments.reactCompiler: true`;
`babel-plugin-react-compiler@^1.0.0` ships as a dependency of `babel-preset-expo`,
SDK 54). Classic memoization advice is mostly obsolete here:

- Do NOT add `React.memo` / `useCallback` / `useMemo` purely for identity
  stability of values consumed by *function components* — the compiler
  auto-memoizes component output and closure identities.
- DO still manually memoize values passed as props to **class-component
  internals** — the compiler does not protect `VirtualizedList`'s internal
  `PureComponent` compare, so an inline `extraData={[a, b]}` array still
  re-renders every visible FlatList cell per parent render. `useMemo` the tuple.
- A component with **ref reads during render** (e.g. `renderItem` reading
  `usedQuickRepliesRef`) is a plausible compiler bailout — manual memoization
  inside such components is load-bearing, not redundant.

## Why

The 2026-06-10 audit's performance discovery produced three classic
"missing memo / inline closure" findings; Phase 2.5 research discovered the
compiler and flipped two to false-positives (`react.dev`: "React.memo is not
needed with React Compiler"). Only the `extraData` half survived, because its
consumer is a class component. Future performance audits/reviews that don't
check the compiler will re-report these.

## Examples

- `client/components/coach/CoachChat.tsx` — `listExtraData` useMemo kept
  (feeds `FlatList.extraData`); inline `keyExtractor` left alone (compiler).
- Verify the compiler is genuinely on: `grep reactCompiler app.json` +
  `ls node_modules/babel-plugin-react-compiler` (dep of babel-preset-expo).

## Related Files

- `app.json` (experiments.reactCompiler)
- `client/components/coach/CoachChat.tsx`
- `docs/rules/performance.md`

## See Also

- docs/audits/2026-06-10-full.md (M2, M3, L7)
