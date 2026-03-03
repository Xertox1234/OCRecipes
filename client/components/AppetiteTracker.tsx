import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";
import { APPETITE_LEVELS } from "./appetite-utils";

interface AppetiteTrackerProps {
  value?: number;
  onChange: (level: number) => void;
}

export default function AppetiteTracker({
  value,
  onChange,
}: AppetiteTrackerProps) {
  const { theme } = useTheme();
  const [selected, setSelected] = useState(value);

  const handleSelect = (level: number) => {
    setSelected(level);
    onChange(level);
  };

  return (
    <View style={[styles.container, { gap: Spacing.xs }]}>
      <Text
        style={[
          styles.label,
          { color: theme.textSecondary, marginBottom: Spacing.xs },
        ]}
      >
        Appetite Level
      </Text>
      <View style={styles.levels} accessibilityRole="radiogroup">
        {APPETITE_LEVELS.map((level) => (
          <Pressable
            key={level.value}
            onPress={() => handleSelect(level.value)}
            accessibilityLabel={`Appetite level ${level.label}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: selected === level.value }}
            style={[
              styles.level,
              {
                backgroundColor:
                  selected === level.value
                    ? theme.link
                    : theme.backgroundSecondary,
                borderColor:
                  selected === level.value ? theme.link : theme.border,
                borderRadius: Spacing.sm,
                padding: Spacing.sm,
              },
            ]}
          >
            <Text style={styles.emoji}>{level.emoji}</Text>
            <Text
              style={[
                styles.levelLabel,
                {
                  color:
                    selected === level.value ? theme.buttonText : theme.text,
                  fontSize: 11,
                },
              ]}
            >
              {level.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  label: { fontSize: 14, fontWeight: "500" },
  levels: { flexDirection: "row", justifyContent: "space-between" },
  level: {
    alignItems: "center",
    flex: 1,
    marginHorizontal: 2,
    borderWidth: 1,
    minWidth: 44,
    minHeight: 44,
  },
  emoji: { fontSize: 20 },
  levelLabel: { fontWeight: "500", marginTop: 2 },
});
