import React from "react";
import { Image, StyleSheet, View } from "react-native";
import { Feather } from "@expo/vector-icons";

import { useTheme } from "@/hooks/useTheme";
import { getCategoryIcon, getIngredientIcon } from "@/lib/ingredient-icon";

interface IngredientIconProps {
  name: string;
  category?: string;
  size?: number;
}

export const IngredientIcon = React.memo(function IngredientIcon({
  name,
  category,
  size = 24,
}: IngredientIconProps) {
  const { theme } = useTheme();
  const icon = getIngredientIcon(name) ?? getCategoryIcon(category);

  const containerSize = size + 4;
  const borderRadius = size / 4;

  if (!icon) {
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.container,
          {
            width: containerSize,
            height: containerSize,
            borderRadius,
            backgroundColor: theme.backgroundSecondary,
          },
        ]}
      >
        <Feather name="circle" size={size * 0.6} color={theme.textSecondary} />
      </View>
    );
  }

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.container,
        {
          width: containerSize,
          height: containerSize,
          borderRadius,
          backgroundColor: theme.backgroundSecondary,
        },
      ]}
    >
      <Image
        source={icon}
        style={{ width: size, height: size, borderRadius }}
        resizeMode="cover"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
});
