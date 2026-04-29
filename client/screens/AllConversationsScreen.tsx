import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/hooks/useTheme";
import {
  useChatConversations,
  useDeleteConversation,
  usePinConversation,
  type ChatConversation,
} from "@/hooks/useChat";
import { Spacing, BorderRadius } from "@/constants/theme";
import type { AllConversationsNavigationProp } from "@/types/navigation";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";

const MAX_PINNED = 3;

function formatRelativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default function AllConversationsScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<AllConversationsNavigationProp>();
  const route = useRoute<RouteProp<RootStackParamList, "AllConversations">>();

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const { data: conversations = [], isLoading } = useChatConversations(
    "coach",
    {
      search: debouncedSearch || undefined,
    },
  );
  const pinConversation = usePinConversation();
  const deleteConversation = useDeleteConversation();

  const { pinned, unpinned } = useMemo(
    () => ({
      pinned: conversations.filter((c) => c.isPinned),
      unpinned: conversations.filter((c) => !c.isPinned),
    }),
    [conversations],
  );

  const handleTogglePin = useCallback(
    async (conv: ChatConversation) => {
      const pinnedCount = conversations.filter((c) => c.isPinned).length;
      if (!conv.isPinned && pinnedCount >= MAX_PINNED) {
        Alert.alert(
          "Pin limit reached",
          "Unpin an existing conversation first.",
        );
        return;
      }
      await pinConversation.mutateAsync({
        id: conv.id,
        isPinned: !conv.isPinned,
      });
    },
    [conversations, pinConversation],
  );

  const handleDelete = useCallback(
    (conv: ChatConversation) => {
      Alert.alert("Delete conversation", `Delete "${conv.title}"?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteConversation.mutate(conv.id),
        },
      ]);
    },
    [deleteConversation],
  );

  const renderRow = useCallback(
    (conv: ChatConversation) => (
      <Pressable
        key={conv.id}
        style={[styles.row, { borderBottomColor: theme.border }]}
        onPress={() => {
          route.params.onSelect(conv.id);
          navigation.goBack();
        }}
        accessibilityRole="button"
        accessibilityLabel={`Open conversation: ${conv.title}`}
      >
        <View style={styles.rowContent}>
          <Text
            numberOfLines={1}
            style={[styles.rowTitle, { color: theme.text }]}
          >
            {conv.title || "Coach conversation"}
          </Text>
          <Text style={[styles.rowMeta, { color: theme.textSecondary }]}>
            {formatRelativeDate(conv.updatedAt)}
          </Text>
        </View>
        <View style={styles.rowActions}>
          <Pressable
            onPress={() => handleTogglePin(conv)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={
              conv.isPinned ? "Unpin conversation" : "Pin conversation"
            }
          >
            <Feather
              name="bookmark"
              size={18}
              color={conv.isPinned ? theme.link : theme.textSecondary}
            />
          </Pressable>
          <Pressable
            onPress={() => handleDelete(conv)}
            hitSlop={12}
            style={{ marginLeft: Spacing.sm }}
            accessibilityRole="button"
            accessibilityLabel="Delete conversation"
          >
            <Feather name="trash-2" size={18} color={theme.textSecondary} />
          </Pressable>
        </View>
      </Pressable>
    ),
    [handleDelete, handleTogglePin, navigation, route, theme],
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
          All Conversations
        </Text>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Feather name="x" size={24} color={theme.text} />
        </Pressable>
      </View>

      <View
        style={[
          styles.searchBar,
          { backgroundColor: theme.backgroundSecondary },
        ]}
      >
        <Feather name="search" size={16} color={theme.textSecondary} />
        <TextInput
          style={[styles.searchInput, { color: theme.text }]}
          placeholder="Search conversations…"
          placeholderTextColor={theme.textSecondary}
          value={search}
          onChangeText={setSearch}
          returnKeyType="search"
          accessibilityLabel="Search conversations"
        />
      </View>

      {isLoading ? (
        <ActivityIndicator style={styles.loading} color={theme.link} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
        >
          {pinned.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { color: theme.link }]}>
                PINNED
              </Text>
              {pinned.map(renderRow)}
            </>
          )}
          {unpinned.length > 0 && (
            <>
              <Text
                style={[styles.sectionLabel, { color: theme.textSecondary }]}
              >
                CONVERSATIONS
              </Text>
              {unpinned.map(renderRow)}
            </>
          )}
          {conversations.length === 0 && (
            <Text style={[styles.empty, { color: theme.textSecondary }]}>
              No conversations found
            </Text>
          )}
        </ScrollView>
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
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    margin: Spacing.md,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  searchInput: { flex: 1, fontSize: 14 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowContent: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: "500" },
  rowMeta: { fontSize: 12, marginTop: 2 },
  rowActions: { flexDirection: "row", alignItems: "center" },
  listContent: { paddingBottom: Spacing.xl },
  loading: { marginTop: Spacing.xl },
  empty: { textAlign: "center", marginTop: Spacing.xl, fontSize: 14 },
});
