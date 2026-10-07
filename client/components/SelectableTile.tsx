import React from "react";
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { PressableScale } from "@/components/PressableScale";
import { useHaptics } from "@/hooks/useHaptics";

type SelectableTileShape = "tile" | "chip" | "row";

type SelectableTileProps = Omit<
  PressableProps,
  "style" | "onPress" | "accessibilityLabel"
> & {
  onPress: () => void;
  /** Required: a tile's content is often icons and badges, not plain text. */
  accessibilityLabel: string;
  /** Static style only — the scaling shapes can't resolve a `({ pressed })` function. */
  style?: StyleProp<ViewStyle>;
  /**
   * Press feedback by shape: a grid `tile` scales to 0.97 (card tier), a pill
   * `chip` to 0.95, and a full-width `row` dims instead of scaling.
   */
  shape?: SelectableTileShape;
};

const SCALE: Record<Exclude<SelectableTileShape, "row">, number> = {
  tile: 0.97,
  chip: 0.95,
};

/**
 * A pickable option whose content is richer than a `Chip` label: icons,
 * descriptions, badges. A press ticks `selection()` before `onPress`, so
 * callers must not buzz themselves. Callers own the selected look and the
 * accessibility role and state (`checked` for checkboxes, `selected` for
 * radios); the colours snap rather than fade.
 */
export function SelectableTile({
  onPress,
  accessibilityLabel,
  style,
  shape = "tile",
  children,
  ...rest
}: SelectableTileProps) {
  const haptics = useHaptics();

  const handlePress = () => {
    haptics.selection();
    onPress();
  };

  if (shape === "row") {
    return (
      <Pressable
        {...rest}
        onPress={handlePress}
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [style, pressed && { opacity: 0.7 }]}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <PressableScale
      {...rest}
      onPress={handlePress}
      accessibilityLabel={accessibilityLabel}
      scaleTo={SCALE[shape]}
      style={style}
    >
      {children}
    </PressableScale>
  );
}
