import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { useCoachContext } from "@/hooks/useCoachContext";
import { useCreateConversation } from "@/hooks/useChat";
import { useCoachWarmUp } from "@/hooks/useCoachWarmUp";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import { usePremiumContext } from "@/context/PremiumContext";
import CoachDashboard from "@/components/coach/CoachDashboard";
import CoachChat from "@/components/coach/CoachChat";
import { Spacing } from "@/constants/theme";

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
  const warmUpHook = useCoachWarmUp(conversationId);

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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={theme.link} />
        </View>
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
    alignItems: "center",
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
});
