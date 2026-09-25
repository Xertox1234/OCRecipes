---
title: React Compiler is active — how it changes memoization findings and fixes
track: knowledge
category: best-practices
module: client
tags: [performance, react-compiler, react-native, expo, flatlist]
created: '2026-06-10'
last_updated: '2026-09-25'
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
  `ls node_modules/babel-plugin-react-compiler` (dep of babel-preset-expo). That
  only proves the compiler is *installed and enabled* — it says nothing about
  whether a given component actually compiles. Measured 2026-09-23, 61 of
  226 client `.tsx` files contain a component that bails out, and a
  2026-09-25 review found 20 more among client `.ts` hooks (value mutation,
  `eslint-disable` of hooks rules, ref access in render, `try`/`finally`,
  memo-not-preserved). "Don't add manual memo" applies ONLY to a component
  that compiles — check with `node scripts/check-react-compiler-bailouts.js`,
  a CI-enforced ratchet (chained onto `npm run lint`) against a checked-in
  baseline (`scripts/react-compiler-bailout-baseline.json`). The baseline is
  per FILE, but bailing is per function: 26 of the 61 baseline `.tsx` files
  also contain components that compile cleanly (e.g. ProfileScreen: 4
  errors, 1 success). So check which function bailed before adding manual
  memoization — memoize the component that is actually skipped, not the
  whole file.
- **Gotcha if you ever re-derive this measurement**: the compiler's logger
  fires a `CompileSuccess` event too (once per compiled function/component),
  not just on failure — checking `events.length > 0` to detect a bailout is
  wrong and flags nearly every file (225/226 measured). Check the event
  *kind* — bailout iff any event is NOT `CompileSuccess`, or the transform
  throws. See `scripts/check-react-compiler-bailouts.js`'s header comment.
- **Caveat**: the pinned `babel-plugin-react-compiler@1.0.0` stops lowering a
  function at its first error, so a file with two independent bailout causes
  (e.g. a `try`/`finally` AND a separate render-body `ref.current =` write —
  see `docs/rules/hooks.md`) only ever reports the first one found. Treat
  bailout status as presence/absence per file, never "the reason," once more
  than one construct could be at fault.

## Related Files

- `app.json` (experiments.reactCompiler)
- `client/components/coach/CoachChat.tsx`
- `docs/rules/performance.md`
- `scripts/check-react-compiler-bailouts.js` — the CI-enforced coverage ratchet
- `scripts/react-compiler-bailout-baseline.json` — the checked-in known-bailout set

## See Also

- docs/audits/2026-06-10-full.md (M2, M3, L7)
- [React Compiler discards a useMemo/useCallback dependency the callback never reads](../conventions/react-compiler-discards-unread-usememo-dependency-2026-09-02.md) — a second, distinct compiler hazard in covered files
