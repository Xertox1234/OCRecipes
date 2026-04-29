import React, { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  Alert,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import {
  useNotebookEntries,
  useUpdateNotebookEntry,
  useDeleteNotebookEntry,
  type NotebookEntry,
} from "@/hooks/useChat";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { NotebookScreenNavigationProp } from "@/types/navigation";

const TYPE_COLORS: Record<string, string> = {
  commitment: "#f59e0b", // hardcoded
  insight: "#7c6dff", // hardcoded
  goal: "#008A38", // hardcoded
  preference: "#06b6d4", // hardcoded
  coaching_strategy: "#06b6d4", // hardcoded
  motivation: "#ec4899", // hardcoded
  emotional_context: "#ec4899", // hardcoded
  conversation_summary: "#888888", // hardcoded
};

const FILTERS = [
  "all",
  "commitment",
  "insight",
  "goal",
  "preference",
  "coaching_strategy",
  "archived",
] as const;
type Filter = (typeof FILTERS)[number];

function typeColor(type: string): string {
  return TYPE_COLORS[type] ?? "#888888"; // hardcoded
}

export default function NotebookScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NotebookScreenNavigationProp>();
  const [filter, setFilter] = useState<Filter>("all");

  const queryOpts =
    filter === "all"
      ? undefined
      : filter === "archived"
        ? { status: "archived" }
        : { type: filter };

  const { data: entries = [], isLoading } = useNotebookEntries(queryOpts);
  const updateEntry = useUpdateNotebookEntry();
  const deleteEntry = useDeleteNotebookEntry();

  const handleArchive = useCallback(
    (entry: NotebookEntry) => {
      Alert.alert("Archive entry", "Move this entry to archive?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          onPress: () =>
            updateEntry.mutate({ id: entry.id, status: "archived" }),
        },
      ]);
    },
    [updateEntry],
  );

  const handleDelete = useCallback(
    (entry: NotebookEntry) => {
      Alert.alert("Delete entry", "Permanently delete this entry?", [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteEntry.mutate(entry.id),
        },
      ]);
    },
    [deleteEntry],
  );

  const renderEntry = useCallback(
    ({ item }: { item: NotebookEntry }) => {
      const color = typeColor(item.type);
      const isCompleted = item.status === "completed";
      return (
        <Pressable
          style={[
            styles.entryCard,
            { backgroundColor: theme.backgroundSecondary },
          ]}
          onPress={() =>
            navigation.navigate("NotebookEntry", { entryId: item.id })
          }
          accessibilityRole="button"
          accessibilityLabel={`${item.type}: ${item.content.slice(0, 60)}`}
        >
          <View style={styles.entryRow}>
            <View style={[styles.typeDot, { backgroundColor: color }]} />
            <View style={styles.entryBody}>
              <Text style={[styles.typeLabel, { color }]}>
                {item.type.replace(/_/g, " ").toUpperCase()}
                {isCompleted ? " · DONE" : ""}
              </Text>
              <Text
                numberOfLines={2}
                style={[
                  styles.entryContent,
                  { color: isCompleted ? theme.textSecondary : theme.text },
                  isCompleted && styles.strikethrough,
                ]}
              >
                {item.content}
              </Text>
              {item.followUpDate && !isCompleted && (
                <Text style={[styles.dueDate, { color }]}>
                  {new Date(item.followUpDate).toLocaleDateString()}
                </Text>
              )}
            </View>
            <View style={styles.entryActions}>
              <Pressable
                onPress={() => handleArchive(item)}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Archive entry"
              >
                <Feather name="archive" size={16} color={theme.textSecondary} />
              </Pressable>
              <Pressable
                onPress={() => handleDelete(item)}
                hitSlop={12}
                style={{ marginTop: Spacing.xs }}
                accessibilityRole="button"
                accessibilityLabel="Delete entry"
              >
                <Feather name="trash-2" size={16} color={theme.textSecondary} />
              </Pressable>
            </View>
          </View>
        </Pressable>
      );
    },
    [handleArchive, handleDelete, navigation, theme],
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <Text style={[styles.headerTitle, { color: theme.text }]}>
          My Notebook
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => navigation.navigate("NotebookEntry", {})}
            style={[styles.newBtn, { backgroundColor: theme.link }]}
            accessibilityRole="button"
            accessibilityLabel="Create new notebook entry"
          >
            <Text style={styles.newBtnText}>+ New</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={{ marginLeft: Spacing.sm }}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Feather name="x" size={24} color={theme.text} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[
              styles.filterChip,
              {
                backgroundColor:
                  filter === f ? theme.link : theme.backgroundSecondary,
              },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: filter === f }}
            accessibilityLabel={`Filter by ${f === "all" ? "all" : f}`}
          >
            <Text
              style={[
                styles.filterText,
                { color: filter === f ? "#FFFFFF" : theme.textSecondary }, // hardcoded
              ]}
            >
              {f === "all"
                ? "All"
                : f === "archived"
                  ? "Archived"
                  : f === "coaching_strategy"
                    ? "Strategy"
                    : f === "preference"
                      ? "Preference"
                      : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} color={theme.link} />
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => String(e.id)}
          renderItem={renderEntry}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: theme.textSecondary }]}>
              No entries yet
            </Text>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "600" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  newBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  newBtnText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" }, // hardcoded
  filterRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.sm,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  filterText: { fontSize: 13, fontWeight: "500" },
  list: { padding: Spacing.md, gap: Spacing.sm },
  entryCard: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
  },
  entryRow: { flexDirection: "row", alignItems: "flex-start", gap: Spacing.sm },
  typeDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 5,
    flexShrink: 0,
  },
  entryBody: { flex: 1 },
  typeLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  entryContent: { fontSize: 14, lineHeight: 20 },
  strikethrough: { textDecorationLine: "line-through" },
  dueDate: { fontSize: 12, marginTop: 4 },
  entryActions: { alignItems: "center", gap: 4 },
  loading: { marginTop: Spacing.xl },
  empty: { textAlign: "center", marginTop: Spacing.xl, fontSize: 14 },
});
