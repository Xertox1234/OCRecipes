// Mock react-native-gesture-handler for component render tests.
// Provides minimal stubs so components render without native gesture runtime.
import React from "react";

// Gesture class mock — chainable methods return the same instance
class GestureMock {
  activeOffsetX() {
    return this;
  }
  activeOffsetY() {
    return this;
  }
  onStart() {
    return this;
  }
  onUpdate() {
    return this;
  }
  onEnd() {
    return this;
  }
  onFinalize() {
    return this;
  }
  minDuration() {
    return this;
  }
  maxDuration() {
    return this;
  }
  minDistance() {
    return this;
  }
  enabled() {
    return this;
  }
}

export const Gesture = {
  Pan: () => new GestureMock(),
  Tap: () => new GestureMock(),
  LongPress: () => new GestureMock(),
  Pinch: () => new GestureMock(),
  Rotation: () => new GestureMock(),
  Fling: () => new GestureMock(),
  Native: () => new GestureMock(),
  Race: (..._gestures: unknown[]) => new GestureMock(),
  Simultaneous: (..._gestures: unknown[]) => new GestureMock(),
  Exclusive: (..._gestures: unknown[]) => new GestureMock(),
};

// GestureDetector renders children directly
export function GestureDetector({ children }: { children: React.ReactNode }) {
  return children;
}

// GestureHandlerRootView renders children in a div
export const GestureHandlerRootView = React.forwardRef<
  unknown,
  Record<string, unknown>
>(({ children, ...rest }, ref) =>
  React.createElement("div", { ref }, children as React.ReactNode),
);
GestureHandlerRootView.displayName = "GestureHandlerRootView";

// Swipeable stub
export const Swipeable = React.forwardRef<unknown, Record<string, unknown>>(
  ({ children }, ref) =>
    React.createElement("div", { ref }, children as React.ReactNode),
);
Swipeable.displayName = "Swipeable";

export default {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  Swipeable,
};
