// Mock react-native-safe-area-context for component render tests.
import React from "react";

export const useSafeAreaInsets = () => ({
  top: 0,
  bottom: 0,
  left: 0,
  right: 0,
});

export const SafeAreaProvider = ({ children }: { children: React.ReactNode }) =>
  React.createElement("div", null, children);

export const SafeAreaView = React.forwardRef<unknown, Record<string, unknown>>(
  ({ children }, ref) =>
    React.createElement("div", { ref }, children as React.ReactNode),
);
SafeAreaView.displayName = "SafeAreaView";
