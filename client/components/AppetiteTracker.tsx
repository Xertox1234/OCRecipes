import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { Spacing } from "@/constants/theme";

interface AppetiteTrackerProps {
  value?: number;
  onChange: (level: number) => void;
}

const LEVELS = [
  { value: 1, label: "Very Low", emoji: "\u{1F636}" },
  { value: 2, label: "Low", emoji: "\u{1F642}" },
  { value: 3, label: "Normal", emoji: "\u{1F60A}" },
  { value: 4, label: "High", emoji: "\u{1F60B}" },
  { value: 5, label: "Very High", emoji: "\u{1F924}" },
];

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
      <View style={styles.levels}>
        {LEVELS.map((level) => (
          <Pressable
            key={level.value}
            onPress={() => handleSelect(level.value)}
            accessibilityLabel={`Appetite level ${level.label}`}
            accessibilityRole="button"
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
  },
  emoji: { fontSize: 20 },
  levelLabel: { fontWeight: "500", marginTop: 2 },
});
