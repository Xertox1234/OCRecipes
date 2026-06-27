// client/components/home/GenerateRecipeDrawer.tsx
import React, { useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";

import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";
import { useHaptics } from "@/hooks/useHaptics";
import { GENERATE_IDEA_CHIPS } from "@/components/home/trending-fallback";
import {
  Spacing,
  BorderRadius,
  FontFamily,
  withOpacity,
} from "@/constants/theme";
import type { HomeScreenNavigationProp } from "@/types/navigation";

interface GenerateRecipeDrawerProps {
  onUsed: () => void;
}

export function GenerateRecipeDrawer({ onUsed }: GenerateRecipeDrawerProps) {
  const { theme } = useTheme();
  const haptics = useHaptics();
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const [text, setText] = useState("");

  const generate = (prompt: string) => {
    const p = prompt.trim();
    if (!p) return;
    haptics.selection();
    onUsed();
    navigation.navigate("RecipeChat", { initialMessage: p });
  };

  return (
    <View style={styles.container}>
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: theme.backgroundSecondary,
            borderColor: theme.border,
          },
        ]}
      >
        <TextInput
          style={[styles.input, { color: theme.text }]}
          placeholder="Describe a recipe…"
          placeholderTextColor={theme.textSecondary}
          value={text}
          onChangeText={setText}
          onSubmitEditing={() => generate(text)}
          returnKeyType="go"
          accessibilityLabel="Describe a recipe to generate"
        />
        <Pressable
          onPress={() => generate(text)}
          accessibilityRole="button"
          accessibilityLabel="Generate recipe"
          hitSlop={8}
          style={({ pressed }) => [
            styles.goButton,
            { opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Feather
            name="arrow-right"
            size={20}
            color={theme.link}
            accessible={false}
          />
        </Pressable>
      </View>

      <View style={styles.chipsWrap}>
        {GENERATE_IDEA_CHIPS.map((idea) => (
          <Pressable
            key={idea}
            onPress={() => generate(idea)}
            accessibilityRole="button"
            accessibilityLabel={`Generate: ${idea}`}
            style={({ pressed }) => [
              styles.chip,
              {
                backgroundColor: withOpacity(theme.link, 0.08),
                borderColor: theme.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <ThemedText
              style={[styles.chipText, { color: theme.link }]}
              numberOfLines={1}
            >
              {idea}
            </ThemedText>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.sm },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: BorderRadius.xs,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    gap: Spacing.xs,
  },
  input: { flex: 1, height: 40, fontSize: 14, fontFamily: FontFamily.regular },
  goButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
  },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: Spacing.xs },
  chip: {
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: "center",
  },
  chipText: { fontSize: 13, fontFamily: FontFamily.medium },
});
