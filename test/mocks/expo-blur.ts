// Mock expo-blur for tests. Prevents unparseable JSX in compiled expo-blur output.
import React from "react";
import { flattenStyle } from "./react-native";

export function BlurView(props: Record<string, unknown>) {
  return React.createElement("View", {
    ...props,
    style: flattenStyle(props.style),
  });
}
