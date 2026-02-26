// Mock @expo/vector-icons for component render tests.
// Renders a span with the icon name as text content for easy assertions.
import React from "react";

function createIconComponent(setName: string) {
  const Icon = React.forwardRef<
    unknown,
    {
      name?: string;
      size?: number;
      color?: string;
      style?: unknown;
      testID?: string;
    }
  >(({ name, testID, ...rest }, ref) =>
    React.createElement(
      "span",
      { ref, "data-testid": testID, "data-icon": name, ...rest },
      name,
    ),
  );
  Icon.displayName = setName;
  return Icon;
}

export const Feather = createIconComponent("Feather");
export const MaterialCommunityIcons = createIconComponent(
  "MaterialCommunityIcons",
);
export const Ionicons = createIconComponent("Ionicons");
export const FontAwesome = createIconComponent("FontAwesome");
