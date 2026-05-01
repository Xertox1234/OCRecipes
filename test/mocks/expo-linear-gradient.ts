// Mock expo-linear-gradient for tests. Renders as a plain View.
import React from "react";

interface LinearGradientProps {
  colors: string[];
  start?: { x: number; y: number };
  end?: { x: number; y: number };
  style?: unknown;
  children?: React.ReactNode;
  [key: string]: unknown;
}

export function LinearGradient({
  colors: _colors,
  start: _start,
  end: _end,
  ...rest
}: LinearGradientProps) {
  return React.createElement("View", rest);
}
