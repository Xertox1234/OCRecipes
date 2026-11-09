import React, { useCallback } from "react";
import {
  View,
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
import { PressableScale } from "@/components/PressableScale";
import { useToast } from "@/context/ToastContext";
import {
  useNotebookEntries,
  useConfirmNotebookEntries,
  useRejectNotebookEntries,
  useClearNotebook,
} from "@/hooks/useNotebook";
import { ThemedText } from "@/components/ThemedText";
import { EmptyState, OfflineEmptyState } from "@/components/EmptyState";
import { isPausedWithoutData } from "@/components/empty-state-utils";
import { Spacing, BorderRadius, FontFamily } from "@/constants/theme";
import {
  groupForPage,
  type PageItem,
} from "@/components/coach/what-coach-knows-utils";
import type { NotebookScreenNavigationProp } from "@/types/navigation";

/**
 * "What Coach knows" (visible memory R3, approved mockup A): what the coach
 * remembers, as plain sentences grouped by meaning. A memory the coach saved
 * quietly asks "Is this right?" — confirming it is what lets the coach bring
 * it up. Interpretations, summaries and feelings are never shown.
 */
export default function NotebookScreen() {
  const { theme } = useTheme();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NotebookScreenNavigationProp>();

  const {
    data: entries,
    isLoading,
    isError,
    fetchStatus,
    refetch,
  } = useNotebookEntries({ status: "active" });
  const page = groupForPage(entries ?? []);
  const isEmpty =
    page.goals.length + page.preferences.length + page.trying.length === 0 &&
    page.howCoachTalks === null;

  const { mutate: confirm } = useConfirmNotebookEntries();
  const { mutate: reject } = useRejectNotebookEntries();
  const { mutate: clear } = useClearNotebook();

  const openEntry = useCallback(
    (id: number) => navigation.navigate("NotebookEntry", { entryId: id }),
    [navigation],
  );
  const handleConfirm = (id: number) =>
    confirm([id], {
      onError: () => toast.error("Couldn't save that. Please try again."),
    });
  const handleRemove = (id: number) =>
    reject([id], {
      onError: () => toast.error("Couldn't remove that. Please try again."),
    });
  const handleClear = () =>
    Alert.alert(
      "Clear everything Coach knows?",
      "Coach will forget all your goals, preferences and the things you're trying. This can't be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear everything",
          style: "destructive",
          onPress: () =>
            clear(undefined, {
              onError: () =>
                toast.error("Couldn't clear your notebook. Please try again."),
            }),
        },
      ],
    );

  const renderItem = (item: PageItem) =>
    item.confirmed ? (
      <Pressable
        key={item.id}
        onPress={() => openEntry(item.id)}
        style={({ pressed }) => [
          styles.item,
          { backgroundColor: theme.backgroundSecondary },
          pressed && { opacity: 0.7 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={item.text}
        accessibilityHint="Opens it to edit or remove"
      >
        <ThemedText type="body" style={styles.itemText}>
          {item.text}
        </ThemedText>
        <Feather
          name="chevron-right"
          size={16}
          color={theme.textSecondary}
          accessible={false}
        />
      </Pressable>
    ) : (
      <View
        key={item.id}
        style={[
          styles.item,
          styles.itemAsk,
          { backgroundColor: theme.backgroundSecondary },
        ]}
      >
        <ThemedText type="body" style={styles.itemText}>
          {item.text}
        </ThemedText>
        <View style={styles.askRow}>
          <ThemedText type="small" style={{ color: theme.link }}>
            Is this right?
          </ThemedText>
          <Pressable
            onPress={() => handleConfirm(item.id)}
            style={[styles.pill, { backgroundColor: theme.accentSolid }]}
            accessibilityRole="button"
            accessibilityLabel="Yes, that's right"
          >
            <ThemedText
              type="small"
              style={[styles.pillText, { color: theme.buttonText }]}
            >
              Yes
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => openEntry(item.id)}
            style={[styles.pill, { borderColor: theme.link, borderWidth: 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Edit"
          >
            <ThemedText
              type="small"
              style={[styles.pillText, { color: theme.link }]}
            >
              Edit
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => handleRemove(item.id)}
            style={[styles.pill, { borderColor: theme.link, borderWidth: 1 }]}
            accessibilityRole="button"
            accessibilityLabel="Remove"
          >
            <ThemedText
              type="small"
              style={[styles.pillText, { color: theme.link }]}
            >
              Remove
            </ThemedText>
          </Pressable>
        </View>
      </View>
    );

  const group = (title: string, items: PageItem[]) =>
    items.length === 0 ? null : (
      <View style={styles.group} key={title}>
        <ThemedText
          type="caption"
          style={[styles.groupTitle, { color: theme.textSecondary }]}
          accessibilityRole="header"
        >
          {title}
        </ThemedText>
        {items.map(renderItem)}
      </View>
    );

  let body: React.ReactNode;
  if (isLoading) {
    body = <ActivityIndicator style={styles.loading} color={theme.link} />;
  } else if (isError) {
    body = (
      <EmptyState
        variant="temporary"
        icon="alert-circle"
        title="Couldn't load your notebook"
        description="Something went wrong. Tap below to try again."
        actionLabel="Try Again"
        onAction={() => {
          void refetch();
        }}
      />
    );
  } else if (isPausedWithoutData(fetchStatus, (entries?.length ?? 0) > 0)) {
    body = <OfflineEmptyState what="notebook" />;
  } else if (isEmpty) {
    body = (
      <ThemedText
        type="small"
        style={[styles.empty, { color: theme.textSecondary }]}
      >
        Coach hasn&apos;t saved anything yet. Things you tell it about your
        goals and preferences show up here.
      </ThemedText>
    );
  } else {
    body = (
      <>
        {group("Goals", page.goals)}
        {group("Preferences", page.preferences)}
        {group("Trying", page.trying)}
        {page.howCoachTalks && (
          <View style={styles.group}>
            <ThemedText
              type="caption"
              style={[styles.groupTitle, { color: theme.textSecondary }]}
              accessibilityRole="header"
            >
              How Coach talks to you
            </ThemedText>
            <ThemedText
              type="small"
              style={[
                styles.soft,
                {
                  backgroundColor: theme.backgroundSecondary,
                  color: theme.textSecondary,
                },
              ]}
            >
              {page.howCoachTalks}
            </ThemedText>
          </View>
        )}
        <Pressable
          onPress={handleClear}
          style={styles.clear}
          accessibilityRole="button"
          accessibilityLabel="Clear everything Coach knows"
        >
          <ThemedText type="small" style={{ color: theme.link }}>
            Clear everything Coach knows
          </ThemedText>
        </Pressable>
      </>
    );
  }

  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.container,
        { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
      ]}
    >
      <View style={[styles.header, { borderBottomColor: theme.border }]}>
        <ThemedText type="h4">What Coach knows</ThemedText>
        <View style={styles.headerActions}>
          <PressableScale
            onPress={() => navigation.navigate("NotebookEntry", {})}
            style={[styles.newBtn, { backgroundColor: theme.accentSolid }]}
            hitSlop={{ top: 7, bottom: 7 }}
            accessibilityRole="button"
            accessibilityLabel="Add something for Coach to know"
          >
            <ThemedText
              type="small"
              style={[styles.newBtnText, { color: theme.buttonText }]}
            >
              + Add
            </ThemedText>
          </PressableScale>
          <Pressable
            onPress={() => navigation.goBack()}
            hitSlop={12}
            style={({ pressed }) => [
              { marginLeft: Spacing.sm },
              pressed && { opacity: 0.7 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Feather name="x" size={24} color={theme.text} accessible={false} />
          </Pressable>
        </View>
      </View>
      <ScrollView
        contentContainerStyle={[
          styles.list,
          { paddingBottom: insets.bottom + Spacing.lg },
        ]}
      >
        {!isLoading && !isError && (
          <ThemedText
            type="small"
            style={[styles.lede, { color: theme.textSecondary }]}
          >
            Coach uses these to tailor advice. Remove anything that&apos;s
            wrong.
          </ThemedText>
        )}
        {body}
      </ScrollView>
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
  headerActions: { flexDirection: "row", alignItems: "center" },
  newBtn: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: BorderRadius.full,
  },
  newBtnText: { fontFamily: FontFamily.semiBold },
  list: { padding: Spacing.md, gap: Spacing.md },
  lede: { lineHeight: 20 },
  group: { gap: Spacing.sm },
  groupTitle: {
    fontFamily: FontFamily.semiBold,
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  item: {
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  itemAsk: { flexDirection: "column", alignItems: "stretch" },
  itemText: { flex: 1 },
  askRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  pill: {
    minHeight: 44,
    justifyContent: "center",
    borderRadius: BorderRadius.lg,
    paddingHorizontal: Spacing.md,
  },
  pillText: { fontFamily: FontFamily.medium },
  soft: {
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    overflow: "hidden",
  },
  clear: { minHeight: 44, justifyContent: "center", marginTop: Spacing.sm },
  loading: { marginTop: Spacing.xl },
  empty: { textAlign: "center", marginTop: Spacing.xl, lineHeight: 20 },
});
