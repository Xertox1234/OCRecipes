import { Pressable, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTheme } from "@/hooks/useTheme";
import { useNotebookEntries } from "@/hooks/useNotebook";
import { ThemedText } from "@/components/ThemedText";
import { Spacing } from "@/constants/theme";
import { toSecondPerson } from "@shared/lib/notebook-text";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const MAX_NAME_CHARS = 40;

function shortName(e: { label?: string | null; content: string }): string {
  const text = e.label ?? toSecondPerson(e.content).replace(/[.!]+$/, "");
  return text.length <= MAX_NAME_CHARS
    ? text
    : `${text.slice(0, MAX_NAME_CHARS - 1)}…`;
}

/**
 * "From your notebook: avoiding dairy · quick breakfasts" under a Coach reply
 * that used confirmed memories (visible memory R1). The ids are already
 * server-filtered; any not in the local notebook are skipped. Each name opens
 * that memory.
 */
export default function MemoryRefsTag({ ids }: { ids: readonly number[] }) {
  const { theme } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data: entries = [] } = useNotebookEntries({ status: "active" });
  const used = ids
    .map((id) => entries.find((e) => e.id === id))
    .filter((e): e is NonNullable<typeof e> => e != null);
  if (used.length === 0) return null;

  return (
    <View style={styles.row}>
      <ThemedText type="caption" style={{ color: theme.textSecondary }}>
        From your notebook:
      </ThemedText>
      {used.map((e, i) => (
        <Pressable
          key={e.id}
          onPress={() =>
            navigation.navigate("NotebookEntry", { entryId: e.id })
          }
          accessibilityRole="button"
          accessibilityLabel={shortName(e)}
          style={styles.link}
        >
          <ThemedText type="caption" style={{ color: theme.link }}>
            {shortName(e)}
            {i < used.length - 1 ? " ·" : ""}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: Spacing.xs,
    paddingLeft: Spacing.lg + 31,
    paddingRight: Spacing.lg,
    marginTop: -Spacing.xs,
  },
  link: { minHeight: 44, justifyContent: "center" },
});
