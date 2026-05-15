---
title: "NetInfo isConnected: null on cold start flashes a false offline banner"
track: bug
category: logic-errors
tags: [netinfo, react-native, nullable-boolean, network-status]
module: client
applies_to: ["client/hooks/useNetworkStatus.ts"]
symptoms:
  - "Offline banner briefly flashes on app launch even with connectivity"
  - "isConnected check uses truthy/falsy logic on a boolean | null value"
  - "Network status flickers from offline to online in the first ~200ms"
created: 2026-03-24
severity: medium
---

# NetInfo isConnected: null on cold start flashes a false offline banner

## Problem

`@react-native-community/netinfo` fires its initial callback with `isConnected: null` while it determines actual connectivity. The original `useNetworkStatus` hook treated `null` as falsy and rendered the offline banner for ~200ms before NetInfo resolved the real state.

## Symptoms

- "You're offline" banner briefly visible on app cold start
- Banner disappears once NetInfo settles, even though the device has connectivity the whole time
- Bug is timing-sensitive — easy to miss in fast-network testing

## Root Cause

`NetInfo` typed `isConnected` and `isInternetReachable` as `boolean | null`. Truthy/falsy checks treat `null` and `false` identically:

```typescript
// Bad — null is falsy, so !(null && ...) === true → "offline"
const isOffline = !(state.isConnected && state.isInternetReachable);
```

`null` represents "not yet determined," not "confirmed offline." The hook reported offline before NetInfo had any data.

## Solution

Use explicit `=== false` checks so that `null` (indeterminate) stays out of the offline branch:

```typescript
// Good — only report offline when explicitly confirmed
const isOffline =
  state.isConnected === false || state.isInternetReachable === false;
```

## Prevention

- For any nullable boolean from a platform API, decide explicitly how the "unknown" state should behave. Default to a non-alarming branch (here: "not offline").
- Add a unit test for the `null` initial state when wrapping nullable-boolean APIs.

## Related Files

- `client/hooks/useNetworkStatus.ts`
- `@react-native-community/netinfo` `NetInfoState` type definition

## See Also

- [NetInfo documentation](https://github.com/react-native-netinfo/react-native-netinfo)
