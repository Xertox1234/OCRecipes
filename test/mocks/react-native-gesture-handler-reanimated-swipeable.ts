// Mock react-native-gesture-handler/ReanimatedSwipeable for component render tests.
import React from "react";

const ReanimatedSwipeable = React.forwardRef<unknown, Record<string, unknown>>(
  ({ children }, ref) =>
    React.createElement("div", { ref }, children as React.ReactNode),
);
ReanimatedSwipeable.displayName = "ReanimatedSwipeable";

export default ReanimatedSwipeable;
export type SwipeableMethods = {
  close: () => void;
  openLeft: () => void;
  openRight: () => void;
  reset: () => void;
};
