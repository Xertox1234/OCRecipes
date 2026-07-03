---
title: Reset derived state on prop change via useEffect keyed on the prop
track: knowledge
category: conventions
module: client
tags: [react, hooks, useeffect, derived-state, props]
applies_to: [client/components/**/*.tsx]
created: '2026-05-13'
---

# Reset derived state on prop change via useEffect keyed on the prop

## Rule

When a component tracks internal state derived from props (e.g., error states, loading flags, selection), that state can become stale when props change without the component remounting. Use a `useEffect` keyed on the relevant prop to reset.

## Examples

```typescript
// BAD — hasError persists even after source changes
const [hasError, setHasError] = useState(false);
// User updates avatar → new URI arrives → still shows fallback

// GOOD — reset when the driving prop changes
const [hasError, setHasError] = useState(false);
const sourceUri = source?.uri;
useEffect(() => {
  setHasError(false);
}, [sourceUri]);
```

## Why

**Key details:**

- Extract the primitive value from the prop (`source?.uri` not `source`) to avoid unnecessary resets from object reference changes
- This is different from the "Intentional useEffect Dependencies" pattern — here the goal IS to react to the specific prop change
- Alternative: use `key={sourceUri}` on the component to force a full remount, but this is heavier and destroys all internal state

## Exceptions

When to use: any component where internal state (error flags, validation results, expanded/collapsed) should reset when a key prop changes identity.

When NOT to use: state that should survive prop changes (scroll position, user input in a form that receives new defaults).

## See Also

- [Intentional useEffect dependencies](intentional-useeffect-dependencies-2026-05-13.md)
- [FallbackImage for remote image loading](../design-patterns/fallback-image-remote-image-loading-2026-05-13.md)
