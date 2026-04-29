import React, { useCallback, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { useCoachContext } from "@/hooks/useCoachContext";
import { useChatConversations, useCreateConversation } from "@/hooks/useChat";
import { useCoachWarmUp } from "@/hooks/useCoachWarmUp";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { usePremiumContext } from "@/context/PremiumContext";
import CoachDashboard from "@/components/coach/CoachDashboard";
import CoachChat from "@/components/coach/CoachChat";
import { SkeletonBox, SkeletonProvider } from "@/components/SkeletonLoader";
import { Spacing, BorderRadius } from "@/constants/theme";

export default function CoachProScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { isLoading: isPremiumLoading } = usePremiumContext();
  const isCoachPro = usePremiumFeature("coachPro");
  // Enable context fetch when premium is confirmed OR while premium status is still loading
  // (this screen is only mounted for Coach Pro users, so assume access while loading)
  const contextEnabled = isCoachPro || isPremiumLoading;
  const {
    data: context,
    isLoading: isContextLoading,
    isError: isContextError,
    refetch: refetchContext,
  } = useCoachContext(contextEnabled);
  const createConversation = useCreateConversation();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const { data: coachConversations = [] } = useChatConversations("coach");
  const recentConversations = useMemo(
    () => coachConversations.slice(0, 6),
    [coachConversations],
  );
  const warmUpHook = useCoachWarmUp(conversationId);

  useEffect(() => {
    if (conversationId || recentConversations.length === 0) return;
    setConversationId(recentConversations[0].id);
  }, [conversationId, recentConversations]);

  const handleCreateConversation = useCallback(async () => {
    const result = await createConversation.mutateAsync({ type: "coach" });
    setConversationId(result.id);
    return result.id;
  }, [createConversation]);

  const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(
    null,
  );

  const handleSuggestionPress = useCallback((text: string) => {
    setPendingSuggestion(text);
  }, []);

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
      ]}
    >
      {isContextLoading && (
        <SkeletonProvider>
          <View
            style={styles.loadingContainer}
            accessibilityLabel="Loading..."
            accessibilityElementsHidden
          >
            <SkeletonBox
              width="60%"
              height={20}
              borderRadius={BorderRadius.sm}
            />
            <SkeletonBox
              width="90%"
              height={48}
              borderRadius={BorderRadius.md}
              style={{ marginTop: Spacing.sm }}
            />
            <SkeletonBox
              width="40%"
              height={16}
              borderRadius={BorderRadius.xs}
              style={{ marginTop: Spacing.sm }}
            />
          </View>
        </SkeletonProvider>
      )}
      {isContextError && (
        <View style={styles.errorContainer}>
          <Text style={[styles.errorText, { color: theme.textSecondary }]}>
            Unable to load dashboard
          </Text>
          <Pressable
            onPress={() => refetchContext()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading dashboard"
          >
            <Text style={[styles.retryText, { color: theme.link }]}>Retry</Text>
          </Pressable>
        </View>
      )}
      {context && (
        <CoachDashboard
          context={context}
          onSuggestionPress={handleSuggestionPress}
        />
      )}
      <View style={[styles.threadBar, { borderBottomColor: theme.border }]}>
        <Pressable
          onPress={() => setConversationId(null)}
          style={({ pressed }) => [
            styles.newThreadButton,
            {
              borderColor: theme.border,
              backgroundColor: pressed
                ? theme.backgroundSecondary
                : theme.backgroundDefault,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Start a new coach conversation"
        >
          <Text style={[styles.newThreadText, { color: theme.link }]}>New</Text>
        </Pressable>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.threadList}
        >
          {recentConversations.map((conversation) => {
            const isSelected = conversation.id === conversationId;
            return (
              <Pressable
                key={conversation.id}
                onPress={() => setConversationId(conversation.id)}
                style={[
                  styles.threadChip,
                  {
                    borderColor: isSelected ? theme.link : theme.border,
                    backgroundColor: isSelected
                      ? theme.backgroundSecondary
                      : theme.backgroundDefault,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                accessibilityLabel={`Open coach conversation ${conversation.title}`}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.threadTitle,
                    { color: isSelected ? theme.text : theme.textSecondary },
                  ]}
                >
                  {conversation.title || "Coach conversation"}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <CoachChat
        conversationId={conversationId}
        onCreateConversation={handleCreateConversation}
        isCoachPro={isCoachPro}
        warmUpHook={warmUpHook}
        initialMessage={pendingSuggestion}
        onInitialMessageSent={() => setPendingSuggestion(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingContainer: {
    paddingVertical: Spacing.xl,
    paddingHorizontal: Spacing.lg,
  },
  errorContainer: {
    paddingVertical: Spacing.md,
    alignItems: "center",
    gap: Spacing.xs,
  },
  errorText: {
    fontSize: 13,
  },
  retryText: {
    fontSize: 13,
    fontWeight: "600",
  },
  threadBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  newThreadButton: {
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  newThreadText: {
    fontSize: 13,
    fontWeight: "700",
  },
  threadList: {
    gap: Spacing.sm,
    paddingRight: Spacing.md,
  },
  threadChip: {
    width: 148,
    minHeight: 36,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  threadTitle: {
    fontSize: 12,
    fontWeight: "600",
  },
});
