/* eslint-disable react/display-name */
// Mock expo-image for tests. Renders as a plain <img>, mirroring the RN
// Image mock (test/mocks/react-native.ts) so components that switch from RN's
// Image to expo-image's keep the same DOM-level assertions (src from
// source.uri, data-testid from testID, aria-label/alt from
// accessibilityLabel).
//
// Two differences from the RN mock reflect real API differences between the
// two libraries, and are exactly what a migration test needs to observe:
//  - cachePolicy/contentFit are surfaced as data-* attributes so a test can
//    assert they actually reached the rendered element — expo-image already
//    disk-caches by default (`cachePolicy` defaults to 'disk'), so setting
//    `cachePolicy="memory-disk"` (what the FallbackImage migration this mock
//    supports actually does) adds a memory tier on top of that default, it
//    doesn't turn caching on from nothing.
//  - onError is invoked with expo-image's real callback shape
//    (`{ error: string }`), not a wrapped NativeSyntheticEvent — expo-image's
//    onError is a plain callback, never an RN-style native event object.
import React from "react";

export const Image = React.forwardRef<unknown, Record<string, unknown>>(
  (
    {
      source,
      testID,
      accessibilityLabel,
      contentFit,
      cachePolicy,
      onError,
      ...rest
    },
    ref,
  ) =>
    React.createElement("img", {
      ref,
      src:
        typeof source === "object" && source !== null
          ? ((source as Record<string, unknown>).uri ?? "")
          : "",
      "data-testid": testID,
      "data-content-fit": contentFit,
      "data-cache-policy": cachePolicy,
      "aria-label": accessibilityLabel,
      alt: accessibilityLabel,
      onError:
        typeof onError === "function"
          ? () =>
              (onError as (event: { error: string }) => void)({
                error: "mock-image-load-error",
              })
          : undefined,
      ...rest,
    }),
);
(Image as unknown as { displayName: string }).displayName = "ExpoImage";
