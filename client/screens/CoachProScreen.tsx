import React, { useCallback, useState } from "react";
import { View, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { useCoachContext } from "@/hooks/useCoachContext";
import { useCreateConversation } from "@/hooks/useChat";
import { useCoachWarmUp } from "@/hooks/useCoachWarmUp";
import { usePremiumFeature } from "@/hooks/usePremiumFeatures";
import CoachDashboard from "@/components/coach/CoachDashboard";
import CoachChat from "@/components/coach/CoachChat";

export default function CoachProScreen() {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const isCoachPro = usePremiumFeature("coachPro");
  const { data: context } = useCoachContext(isCoachPro);
  const createConversation = useCreateConversation();
  const [conversationId, setConversationId] = useState<number | null>(null);
  const warmUpHook = useCoachWarmUp(conversationId);

  const handleCreateConversation = useCallback(async () => {
    const result = await createConversation.mutateAsync({ type: "coach" });
    setConversationId(result.id);
    return result.id;
  }, [createConversation]);

  const [pendingSuggestion, setPendingSuggestion] = useState<string | null>(null);

  const handleSuggestionPress = useCallback(
    (text: string) => {
      setPendingSuggestion(text);
    },
    [],
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: theme.backgroundDefault, paddingTop: insets.top },
      ]}
    >
      {context && (
        <CoachDashboard context={context} onSuggestionPress={handleSuggestionPress} />
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
});
