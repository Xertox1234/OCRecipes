---
title: rn-component-render-test-jsdom-pattern
track: knowledge
category: conventions
module: client
tags: [testing, vitest, react-native, render-tests, jsdom]
applies_to: [client/**/__tests__/*.test.tsx, test/utils/render-component.tsx, test/mocks/react-native.ts]
created: '2026-05-16'
---

# RN component render-test pattern (jsdom)

## Rule

React Native component render tests in this repo are **not** written with
`@testing-library/react-native`. They use jsdom + `@testing-library/react`
(the web variant):

1. First line of the file is the pragma `// @vitest-environment jsdom`.
2. `screen`, `fireEvent`, and `act` are imported from `@testing-library/react`.
3. The component is mounted with `renderComponent` from
   `test/utils/render-component.tsx`, which wraps it in a `QueryClientProvider`.

This works because `vitest.config.ts` aliases the `react-native` module to
`test/mocks/react-native.ts`, a DOM-rendering mock — `Pressable` → `<button>`,
`View` → `<div>`, `Text` → `<span>`, `accessibilityLabel` → `aria-label`,
`accessibilityRole` → `role`. So `fireEvent.click` and
`screen.getByRole("button", { name: /.../i })` are the correct queries.

## When this applies

Any test that mounts a `client/components/**` or `client/screens/**` component
and asserts on rendered output or interaction. The 10+ existing render tests
under `client/components/home/__tests__/` and `client/components/recipe-wizard/__tests__/`
all follow this shape — match it; do not introduce `@testing-library/react-native`.

## Why

- The repo already aliases every native RN module to a JS-only DOM mock. Adding
  `@testing-library/react-native` would duplicate that infrastructure and pull
  the real native bindings Vitest cannot parse.
- jsdom + `@testing-library/react` is fast and needs no separate RN test env.

> **Reviewer note:** this is intentional. A reviewer without project-infra
> context may flag the `@testing-library/react` import or `fireEvent.click` as
> a CRITICAL bug ("should use `@testing-library/react-native` / `fireEvent.press`").
> It is not a bug — the `react-native` → DOM-mock alias makes the web variant
> correct here.

## Examples

Testing internal component state that is only reachable through a hook
callback: mock the hook, capture the callback into a `vi.hoisted` mutable ref,
then invoke it inside `act()` to flip state. Mock heavy child components as
thin doubles exposing only the props under test.

```tsx
// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { act, screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import CoachChat from "../CoachChat";

// vi.mock factories are hoisted above imports — share state via vi.hoisted.
const { coachStreamRef } = vi.hoisted(() => ({
  coachStreamRef: { onError: null as ((message: string) => void) | null },
}));

vi.mock("@/hooks/useCoachStream", () => ({
  useCoachStream: (opts: { onError: (message: string) => void }) => {
    coachStreamRef.onError = opts.onError;
    return {
      startStream: vi.fn(),
      abortStream: vi.fn(),
      streamingContent: "",
      statusText: "",
      isStreaming: false,
    };
  },
}));

// Thin double — exposes only visible / onUpgrade / onClose.
vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({
    visible,
    onUpgrade,
  }: {
    visible: boolean;
    onUpgrade?: () => void;
  }) =>
    visible ? (
      <button onClick={() => onUpgrade?.()}>mock-upgrade</button>
    ) : null,
}));

describe("CoachChat", () => {
  it("renders the limit banner after a 429 stream error", () => {
    renderComponent(<CoachChat /* ...props */ />);
    act(() => coachStreamRef.onError?.("429 daily limit reached"));
    expect(
      screen.getByRole("button", { name: /upgrade to coach pro/i }),
    ).toBeTruthy();
  });
});
```

Note: this repo's render tests assert with plain `toBeTruthy()` / `toBeNull()`
on query results — `jest-dom` matchers like `toBeInTheDocument()` are not set up.

## Related Files

- `client/components/coach/__tests__/CoachChat.test.tsx` — full worked example
- `test/utils/render-component.tsx` — the `QueryClientProvider` render helper
- `test/mocks/react-native.ts` — the DOM-rendering RN mock
- `vitest.config.ts` — aliases `react-native` to the mock

## See Also

- `docs/solutions/design-patterns/controllable-mock-via-vi-hoisted-2026-05-13.md`
- `docs/solutions/design-patterns/vitest-alias-mocks-native-libraries-2026-05-13.md`
