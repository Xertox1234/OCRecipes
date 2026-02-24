import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

interface CuisineTagProps {
  cuisine: string;
  size?: "small" | "medium";
}

const CUISINE_COLORS: Record<string, string> = {
  Japanese: "#D32F2F",
  Korean: "#1976D2",
  "East Asian": "#F57C00",
  "Southeast Asian": "#388E3C",
  Vietnamese: "#7B1FA2",
  "South Asian": "#FF8F00",
  "Middle Eastern": "#5D4037",
  Mexican: "#C62828",
  "Latin American": "#00838F",
  Italian: "#2E7D32",
  Spanish: "#E65100",
  European: "#37474F",
  "Eastern European": "#4527A0",
  "North African": "#BF360C",
  Ethiopian: "#1B5E20",
  "West African": "#E65100",
  African: "#4E342E",
};

export default function CuisineTag({
  cuisine,
  size = "small",
}: CuisineTagProps) {
  const { theme } = useTheme();
  const bgColor = CUISINE_COLORS[cuisine] || theme.link;

  return (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: bgColor + "20",
          borderColor: bgColor + "40",
          borderRadius: size === "small" ? 4 : 6,
          paddingHorizontal: size === "small" ? 6 : Spacing.sm,
          paddingVertical: size === "small" ? 2 : 4,
        },
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: bgColor,
            fontSize: size === "small" ? 10 : 12,
          },
        ]}
      >
        {cuisine}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { borderWidth: 1, alignSelf: "flex-start" },
  text: { fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
});
