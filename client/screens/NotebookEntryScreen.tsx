import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Alert,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useTheme } from "@/hooks/useTheme";
import {
  useNotebookEntries,
  useCreateNotebookEntry,
  useUpdateNotebookEntry,
  type NotebookEntry,
} from "@/hooks/useChat";
import { Spacing, BorderRadius } from "@/constants/theme";
import { useNotebookNotifications } from "@/hooks/useNotebookNotifications";
import { notebookEntryTypes } from "@shared/schemas/coach-notebook";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { NotebookEntryNavigationProp } from "@/types/navigation";

type RouteProps = RouteProp<RootStackParamList, "NotebookEntry">;

const TYPE_LABELS: Record<string, string> = {
  commitment: "Commitment",
  insight: "Insight",
  goal: "Goal",
  preference: "Preference",
  coaching_strategy: "Strategy",
  motivation: "Motivation",
  emotional_context: "Emotional",
  conversation_summary: "Summary",
};

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

export default function NotebookEntryScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NotebookEntryNavigationProp>();
  const route = useRoute<RouteProps>();
  const entryId = route.params?.entryId;
  const isCreate = !entryId;

  const { data: allEntries = [] } = useNotebookEntries();
  const entry: NotebookEntry | undefined = allEntries.find(
    (e) => e.id === entryId,
  );

  const [type, setType] = useState(entry?.type ?? "insight");
  const [content, setContent] = useState(entry?.content ?? "");
  const [followUpDate, setFollowUpDate] = useState<string | null>(
    entry?.followUpDate
      ? new Date(entry.followUpDate).toISOString().slice(0, 10)
      : null,
  );

  useEffect(() => {
    if (entry) {
      setType(entry.type);
      setContent(entry.content);
      setFollowUpDate(
        entry.followUpDate
          ? new Date(entry.followUpDate).toISOString().slice(0, 10)
          : null,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const createEntry = useCreateNotebookEntry();
  const updateEntry = useUpdateNotebookEntry();
  const isSaving = createEntry.isPending || updateEntry.isPending;
  const { scheduleCommitmentReminder, cancelCommitmentReminder } =
    useNotebookNotifications();

  const isDirty = isCreate
    ? content.trim().length > 0
    : content !== entry?.content ||
      type !== entry?.type ||
      followUpDate !==
        (entry?.followUpDate
          ? new Date(entry.followUpDate).toISOString().slice(0, 10)
          : null);

  const handleSave = useCallback(async () => {
    if (!content.trim()) return;
    let savedEntry: NotebookEntry | undefined;
    if (isCreate) {
      savedEntry = await createEntry.mutateAsync({
        type,
        content: content.trim(),
        followUpDate,
      });
    } else if (entryId) {
      savedEntry = await updateEntry.mutateAsync({
        id: entryId,
        type,
        content: content.trim(),
        followUpDate,
      });
    }
    if (savedEntry && savedEntry.type === "commitment") {
      if (savedEntry.followUpDate) {
        await scheduleCommitmentReminder(
          savedEntry.id,
          savedEntry.content,
          new Date(savedEntry.followUpDate).toISOString().slice(0, 10),
        );
      } else {
        await cancelCommitmentReminder(savedEntry.id);
      }
    }
    navigation.goBack();
  }, [
    isCreate,
    entryId,
    type,
    content,
    followUpDate,
    createEntry,
    updateEntry,
    scheduleCommitmentReminder,
    cancelCommitmentReminder,
    navigation,
  ]);

  const handleMarkComplete = useCallback(() => {
    if (!entryId) return;
    Alert.alert("Mark complete", "Mark this entry as completed?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Complete",
        onPress: async () => {
          await updateEntry.mutateAsync({ id: entryId, status: "completed" });
          await cancelCommitmentReminder(entryId);
          navigation.goBack();
        },
      },
    ]);
  }, [entryId, updateEntry, cancelCommitmentReminder, navigation]);

  const handleArchive = useCallback(() => {
    if (!entryId) return;
    Alert.alert("Archive entry", "Move this entry to archive?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Archive",
        onPress: async () => {
          await updateEntry.mutateAsync({ id: entryId, status: "archived" });
          await cancelCommitmentReminder(entryId);
          navigation.goBack();
        },
      },
    ]);
  }, [entryId, updateEntry, cancelCommitmentReminder, navigation]);

  const sourceLabel = isCreate
    ? "Added by you"
    : entry?.sourceConversationId
      ? "Extracted by Coach"
      : "Added by you";

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: theme.backgroundDefault }]}
      contentContainerStyle={{
        paddingTop: insets.top + Spacing.md,
        paddingBottom: insets.bottom + Spacing.xl,
        paddingHorizontal: Spacing.md,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={[styles.back, { color: theme.link }]}>← Back</Text>
        </Pressable>
        <Pressable
          onPress={handleSave}
          disabled={!isDirty || isSaving || !content.trim()}
          accessibilityRole="button"
          accessibilityLabel="Save entry"
        >
          <Text
            style={[
              styles.saveBtn,
              {
                color:
                  isDirty && content.trim() ? theme.link : theme.textSecondary,
              },
            ]}
          >
            {isSaving ? "Saving…" : "Save"}
          </Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>TYPE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.typeRow}>
            {notebookEntryTypes.map((t) => (
              <Pressable
                key={t}
                onPress={() => setType(t)}
                style={[
                  styles.typeChip,
                  {
                    backgroundColor:
                      type === t ? TYPE_COLORS[t] : theme.backgroundSecondary,
                  },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ checked: type === t }}
                accessibilityLabel={TYPE_LABELS[t] ?? t}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    { color: type === t ? "#FFFFFF" : theme.textSecondary }, // hardcoded
                  ]}
                >
                  {TYPE_LABELS[t] ?? t}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.section}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          CONTENT
        </Text>
        <TextInput
          style={[
            styles.contentInput,
            { backgroundColor: theme.backgroundSecondary, color: theme.text },
          ]}
          value={content}
          onChangeText={setContent}
          multiline
          maxLength={500}
          placeholder="Enter content…"
          placeholderTextColor={theme.textSecondary}
          accessibilityLabel="Entry content"
        />
        <Text style={[styles.charCount, { color: theme.textSecondary }]}>
          {content.length}/500
        </Text>
      </View>

      {type === "commitment" && (
        <View style={styles.section}>
          <Text style={[styles.label, { color: theme.textSecondary }]}>
            FOLLOW-UP DATE
          </Text>
          <TextInput
            style={[
              styles.dateInput,
              { backgroundColor: theme.backgroundSecondary, color: theme.text },
            ]}
            value={followUpDate ?? ""}
            onChangeText={(v) => setFollowUpDate(v || null)}
            placeholder="YYYY-MM-DD"
            placeholderTextColor={theme.textSecondary}
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            accessibilityLabel="Follow-up date in YYYY-MM-DD format"
          />
        </View>
      )}

      <View style={styles.section}>
        <Text style={[styles.label, { color: theme.textSecondary }]}>
          SOURCE
        </Text>
        <Text style={[styles.sourceText, { color: theme.textSecondary }]}>
          {sourceLabel}
        </Text>
      </View>

      {!isCreate && entry?.status === "active" && (
        <View style={styles.actionRow}>
          {(entry.type === "commitment" || entry.type === "goal") && (
            <Pressable
              style={[styles.actionBtn, { backgroundColor: "#008A38" }]} // hardcoded
              onPress={handleMarkComplete}
              accessibilityRole="button"
              accessibilityLabel="Mark complete"
            >
              <Text style={styles.actionBtnText}>Mark Complete</Text>
            </Pressable>
          )}
          <Pressable
            style={[
              styles.actionBtn,
              { backgroundColor: theme.backgroundSecondary },
            ]}
            onPress={handleArchive}
            accessibilityRole="button"
            accessibilityLabel="Archive entry"
          >
            <Text
              style={[styles.actionBtnText, { color: theme.textSecondary }]}
            >
              Archive
            </Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.lg,
  },
  back: { fontSize: 14 },
  saveBtn: { fontSize: 14, fontWeight: "600" },
  section: { marginBottom: Spacing.lg },
  label: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: Spacing.xs,
  },
  typeRow: { flexDirection: "row", gap: Spacing.xs },
  typeChip: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  typeChipText: { fontSize: 12, fontWeight: "600" },
  contentInput: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 100,
    textAlignVertical: "top",
  },
  charCount: { fontSize: 11, textAlign: "right", marginTop: 4 },
  dateInput: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    fontSize: 14,
  },
  sourceText: { fontSize: 13 },
  actionRow: { flexDirection: "row", gap: Spacing.sm, marginTop: Spacing.md },
  actionBtn: {
    flex: 1,
    padding: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  actionBtnText: { color: "#FFFFFF", fontSize: 14, fontWeight: "600" }, // hardcoded
});
