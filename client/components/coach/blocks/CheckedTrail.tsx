import { StyleSheet, View } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { ThemedText } from "@/components/ThemedText";
import { Spacing } from "@/constants/theme";

/**
 * "Checked: today's log · beef burger" under a Coach reply: what Coach looked
 * up to answer (show-the-work spec 2026-11-09). One quiet line, not a button
 * and not a live region — it is read with the reply. Server-built.
 */
export default function CheckedTrail({ items }: { items: readonly string[] }) {
  const { theme } = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={styles.row}>
      <ThemedText
        type="caption"
        style={{ color: theme.textSecondary }}
        accessibilityLabel={`Checked: ${items.join(", ")}`}
      >
        {`Checked: ${items.join(" · ")}`}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  // Lines up with the reply text, like the "From your notebook" tag.
  row: {
    paddingLeft: Spacing.lg + 31,
    paddingRight: Spacing.lg,
    paddingBottom: Spacing.xs,
  },
});
