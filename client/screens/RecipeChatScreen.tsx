import React, {
  useState,
  useCallback,
  useRef,
  useMemo,
  useEffect,
} from "react";
import {
  View,
  Text,
  FlatList,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
  KeyboardAvoidingView,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useQuery } from "@tanstack/react-query";

import { useTheme } from "@/hooks/useTheme";
import { withOpacity, Spacing, BorderRadius } from "@/constants/theme";
import { ThemedText } from "@/components/ThemedText";
import type { RootStackParamList } from "@/navigation/RootStackNavigator";
import type { RecipeChatScreenNavigationProp } from "@/types/navigation";
import {
  useCreateConversation,
  useChatMessages,
  useSendMessage,
  useSaveRecipeFromChat,
  type StreamingRecipe,
} from "@/hooks/useChat";
import { FLATLIST_DEFAULTS } from "@/constants/performance";
import { RecipeCard } from "@/components/recipe-chat/RecipeCard";
import { generateRemixChips, type RemixChip } from "@/lib/remix-chips";
import { apiRequest } from "@/lib/query-client";

type RecipeChatRouteProp = RouteProp<RootStackParamList, "RecipeChat">;

const SUGGESTION_CHIPS = [
  {
    label: "Quick & Easy",
    emoji: "⚡",
    prompt: "Give me a quick and easy recipe I can make in under 20 minutes",
  },
  {
    label: "High Protein",
    emoji: "💪",
    prompt: "Create a high-protein meal for post-workout recovery",
  },
  {
    label: "Italian",
    emoji: "🍝",
    prompt: "Make me an authentic Italian dinner",
  },
  {
    label: "Comfort Food",
    emoji: "🍲",
    prompt: "I want something warm and comforting",
  },
  {
    label: "Kid-Friendly",
    emoji: "⭐",
    prompt: "Create a healthy kid-friendly meal",
  },
  {
    label: "Low Carb",
    emoji: "🥗",
    prompt: "Give me a delicious low-carb dinner option",
  },
  {
    label: "Budget Friendly",
    emoji: "💵",
    prompt: "Create a tasty meal using affordable ingredients",
  },
  {
    label: "Date Night",
    emoji: "🕯",
    prompt: "Create an impressive dinner for two",
  },
];

export default function RecipeChatScreen() {
  const route = useRoute<RecipeChatRouteProp>();
  const navigation = useNavigation<RecipeChatScreenNavigationProp>();
  const insets = useSafeAreaInsets();
  const { theme } = useTheme();
  const flatListRef = useRef<FlatList>(null);

  // Remix mode detection
  const isRemixMode = !!route.params?.remixSourceRecipeId;
  const remixSourceRecipeId = route.params?.remixSourceRecipeId;
  const remixSourceRecipeTitle = route.params?.remixSourceRecipeTitle;

  const [conversationId, setConversationId] = useState<number | null>(
    route.params?.conversationId ?? null,
  );
  const [inputText, setInputText] = useState("");
  const [hasStarted, setHasStarted] = useState(!!route.params?.conversationId);
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(
    null,
  );

  const createConversation = useCreateConversation();

  // Fetch user dietary profile for remix chip generation
  const { data: userProfile } = useQuery<{
    allergies?: { name: string; severity: "mild" | "moderate" | "severe" }[];
    dietType?: string | null;
  }>({
    queryKey: ["/api/user/dietary-profile"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/user/dietary-profile");
      return res.json();
    },
    enabled: isRemixMode,
  });

  // Fetch source recipe ingredients for chip generation
  const { data: sourceRecipe } = useQuery<{
    ingredients: { name: string; quantity: string; unit: string }[];
    dietTags?: string[];
  }>({
    queryKey: [`/api/recipes/${remixSourceRecipeId}`],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/recipes/${remixSourceRecipeId}`,
      );
      return res.json();
    },
    enabled: isRemixMode && !!remixSourceRecipeId,
  });

  // Generate dynamic remix chips
  const remixChips = useMemo<RemixChip[]>(() => {
    if (!isRemixMode || !sourceRecipe) return [];
    return generateRemixChips(sourceRecipe, userProfile);
  }, [isRemixMode, sourceRecipe, userProfile]);
  const { data: messages = [] } = useChatMessages(conversationId);
  const {
    sendMessage,
    streamingContent,
    streamingRecipe,
    isStreaming,
    streamError,
    requestError,
  } = useSendMessage(conversationId);
  const saveRecipeMutation = useSaveRecipeFromChat();
  const savedMessageIdsRef = useRef(new Set<number>());
  const [, forceRender] = useState(0);

  // Clear optimistic user message once streaming completes
  useEffect(() => {
    if (!isStreaming) setPendingUserMessage(null);
  }, [isStreaming]);

  const handleSaveRecipe = useCallback(
    async (messageId: number) => {
      if (!conversationId || savedMessageIdsRef.current.has(messageId)) return;
      try {
        await saveRecipeMutation.mutateAsync({ conversationId, messageId });
        savedMessageIdsRef.current.add(messageId);
        forceRender((n) => n + 1);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    },
    [conversationId, saveRecipeMutation],
  );

  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text || inputText).trim();
      if (!content || isStreaming) return;

      setInputText("");
      setHasStarted(true);
      setPendingUserMessage(content);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      let convId = conversationId;
      if (!convId) {
        try {
          const conv = await createConversation.mutateAsync(
            isRemixMode
              ? {
                  type: "remix",
                  sourceRecipeId: remixSourceRecipeId,
                }
              : {
                  title: "New Recipe Chat",
                  type: "recipe",
                },
          );
          convId = conv.id;
          setConversationId(convId);
        } catch {
          setPendingUserMessage(null);
          return;
        }
      }

      sendMessage(content, undefined, convId);
    },
    [
      inputText,
      isStreaming,
      conversationId,
      createConversation,
      sendMessage,
      isRemixMode,
      remixSourceRecipeId,
    ],
  );

  const handleChipPress = useCallback(
    (prompt: string) => {
      handleSend(prompt);
    },
    [handleSend],
  );

  // Build display messages from fetched messages + streaming state
  const displayMessages = React.useMemo(() => {
    // System messages are internal AI context — never show in the chat UI
    const msgs = messages.filter((m) => m.role !== "system");

    // Optimistic user message: show the sent text immediately before the server
    // persists it, so the UI doesn't appear blank while awaiting the first response.
    // Only shown when streaming and the message isn't yet in the DB query result.
    if (pendingUserMessage && isStreaming) {
      const lastUserMsg = msgs.filter((m) => m.role === "user").at(-1);
      if (lastUserMsg?.content !== pendingUserMessage) {
        msgs.push({
          id: -3,
          conversationId: conversationId ?? 0,
          role: "user",
          content: pendingUserMessage,
          metadata: null,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Add streaming message if active — always push so typing indicator shows immediately.
    // Strip JSON fence from streaming display — recipe card shows the structured data.
    // Intentionally greedy-to-EOF (no closing fence anchor): the stream is mid-flight so
    // the closing ``` hasn't arrived yet. The server strips the full closed fence before
    // persisting, so the saved message and the streaming display are consistent.
    if (isStreaming) {
      const streamingDisplayContent = streamingContent
        .replace(/\n*```json[\s\S]*$/, "")
        .trimEnd();

      msgs.push({
        id: -1,
        conversationId: conversationId ?? 0,
        role: "assistant",
        content: streamingDisplayContent,
        metadata: streamingRecipe ? { recipe: streamingRecipe } : null,
        createdAt: new Date().toISOString(),
      });
    }

    // Show request errors (e.g. premium gate) as an inline error message
    if (requestError) {
      msgs.push({
        id: -2,
        conversationId: conversationId ?? 0,
        role: "assistant",
        content: requestError,
        metadata: { isError: true },
        createdAt: new Date().toISOString(),
      });
    }

    // Show dropped-connection error as an inline bubble
    if (streamError) {
      msgs.push({
        id: -4,
        conversationId: conversationId ?? 0,
        role: "assistant",
        content: "Connection dropped. Your response may be incomplete.",
        metadata: { isError: true },
        createdAt: new Date().toISOString(),
      });
    }

    return msgs;
  }, [
    messages,
    isStreaming,
    streamingContent,
    streamingRecipe,
    conversationId,
    requestError,
    streamError,
    pendingUserMessage,
  ]);

  const renderMessage = useCallback(
    ({ item }: { item: (typeof displayMessages)[0] }) => {
      const isUser = item.role === "user";
      const metadata = item.metadata as Record<string, unknown> | null;
      const recipe = metadata?.recipe as StreamingRecipe | undefined;
      const allergenWarning = metadata?.allergenWarning as string | undefined;
      const isError = !!metadata?.isError;
      const isAlreadySaved = savedMessageIdsRef.current.has(item.id);
      const isStreaming_ = item.id === -1;

      return (
        <View>
          {/* Text bubble — or typing indicator while waiting for first token */}
          {item.content ? (
            <View
              style={[
                styles.messageBubble,
                isUser
                  ? [styles.userBubble, { backgroundColor: theme.link }]
                  : isError
                    ? [
                        styles.assistantBubble,
                        {
                          backgroundColor: withOpacity(theme.error, 0.1),
                          borderWidth: 1,
                          borderColor: withOpacity(theme.error, 0.3),
                        },
                      ]
                    : [
                        styles.assistantBubble,
                        {
                          backgroundColor: withOpacity(theme.text, 0.06),
                        },
                      ],
              ]}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${isUser ? "You" : isError ? "Error" : "RecipeChef"}: ${item.content}`}
            >
              <ThemedText
                style={[
                  isUser ? { color: theme.buttonText } : undefined,
                  isError ? { color: theme.error } : undefined,
                ]}
              >
                {item.content}
              </ThemedText>
            </View>
          ) : isStreaming_ ? (
            <View
              style={[
                styles.messageBubble,
                styles.assistantBubble,
                { backgroundColor: withOpacity(theme.text, 0.06) },
              ]}
              accessible
              accessibilityRole="text"
              accessibilityLabel="RecipeChef is thinking"
            >
              <ActivityIndicator size="small" color={theme.textSecondary} />
            </View>
          ) : null}

          {/* Recipe card (if present in metadata) */}
          {recipe && (
            <RecipeCard
              recipe={recipe}
              allergenWarning={allergenWarning}
              isImageLoading={isStreaming_ && recipe.imageUrl === undefined}
              isSaved={isAlreadySaved}
              isSaving={
                saveRecipeMutation.isPending && !isAlreadySaved && !isStreaming_
              }
              onSave={
                isStreaming_ ? undefined : () => handleSaveRecipe(item.id)
              }
            />
          )}
        </View>
      );
    },
    [theme, saveRecipeMutation.isPending, handleSaveRecipe],
  );

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.backgroundRoot }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + Spacing.xs,
            borderBottomColor: withOpacity(theme.text, 0.08),
          },
        ]}
      >
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={styles.headerButton}
        >
          <Feather name="x" size={22} color={theme.text} />
        </Pressable>
        <ThemedText type="body">
          {isRemixMode ? "Recipe Remix" : "Recipe Chat"}
        </ThemedText>
        <View style={styles.headerButton} />
      </View>

      {/* Messages or Empty State */}
      {!hasStarted ? (
        <View style={styles.emptyState}>
          <View
            style={[
              styles.iconWrapper,
              { backgroundColor: withOpacity(theme.link, 0.1) },
            ]}
          >
            <Feather
              name={isRemixMode ? "shuffle" : "book-open"}
              size={32}
              color={theme.link}
            />
          </View>
          <ThemedText
            type="h3"
            style={{ textAlign: "center", marginTop: Spacing.md }}
            accessibilityRole="header"
          >
            {isRemixMode
              ? `Remix ${remixSourceRecipeTitle ?? "Recipe"}`
              : "What would you like to cook?"}
          </ThemedText>
          <ThemedText
            type="body"
            style={{
              textAlign: "center",
              color: theme.textSecondary,
              marginTop: Spacing.xs,
            }}
          >
            {isRemixMode
              ? "Choose a modification or describe what you'd like to change"
              : "Describe a recipe, upload a photo of ingredients, or pick a suggestion below"}
          </ThemedText>

          {/* Suggestion Chips */}
          {isRemixMode ? (
            /* Remix: horizontal scroll (dynamic chip count) */
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsScrollContent}
              style={{ marginTop: Spacing.lg, alignSelf: "stretch" }}
              accessible
              accessibilityRole="none"
              accessibilityLabel="Remix suggestions"
            >
              {remixChips.map((chip) => (
                <Pressable
                  key={chip.label}
                  onPress={() => handleChipPress(chip.prompt)}
                  style={[
                    styles.chip,
                    {
                      backgroundColor: withOpacity(theme.link, 0.08),
                      borderColor: withOpacity(theme.link, 0.2),
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Suggested prompt: ${chip.label}`}
                >
                  <ThemedText
                    type="caption"
                    style={{ color: theme.link, fontWeight: "600" }}
                  >
                    {chip.label}
                  </ThemedText>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            /* Default: 2-column wrapping grid — all chips visible, no scroll */
            <View
              style={styles.chipsGrid}
              accessible
              accessibilityRole="none"
              accessibilityLabel="Suggested prompts"
            >
              {SUGGESTION_CHIPS.map((chip) => (
                <Pressable
                  key={chip.label}
                  onPress={() => handleChipPress(chip.prompt)}
                  style={[
                    styles.chip,
                    styles.chipGridItem,
                    {
                      backgroundColor: withOpacity(theme.link, 0.08),
                      borderColor: withOpacity(theme.link, 0.2),
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`Suggested prompt: ${chip.label}`}
                >
                  <Text style={styles.chipEmoji}>{chip.emoji}</Text>
                  <ThemedText
                    type="caption"
                    style={{
                      color: theme.link,
                      fontWeight: "600",
                      flexShrink: 1,
                    }}
                    numberOfLines={1}
                  >
                    {chip.label}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayMessages}
          renderItem={renderMessage}
          keyExtractor={(item) => {
            if (item.id === -1) return "streaming";
            if (item.id === -2) return "error";
            if (item.id === -3) return "pending-user";
            if (item.id === -4) return "stream-error";
            return item.id.toString();
          }}
          contentContainerStyle={[
            styles.messageList,
            { paddingBottom: Spacing.md },
          ]}
          onContentSizeChange={() =>
            flatListRef.current?.scrollToEnd({ animated: true })
          }
          onLayout={() => flatListRef.current?.scrollToEnd({ animated: false })}
          keyboardDismissMode="interactive"
          {...FLATLIST_DEFAULTS}
        />
      )}

      {/* Input Bar */}
      <View
        style={[
          styles.inputBar,
          {
            paddingBottom: Math.max(insets.bottom, Spacing.sm),
            borderTopColor: withOpacity(theme.text, 0.08),
            backgroundColor: theme.backgroundRoot,
          },
        ]}
      >
        <TextInput
          value={inputText}
          onChangeText={setInputText}
          placeholder={
            isRemixMode
              ? "Describe what you'd like to change..."
              : "Describe what you want to cook..."
          }
          placeholderTextColor={theme.textSecondary}
          style={[
            styles.textInput,
            {
              backgroundColor: withOpacity(theme.text, 0.06),
              color: theme.text,
            },
          ]}
          multiline
          maxLength={2000}
          editable={!isStreaming}
          onSubmitEditing={() => handleSend()}
          returnKeyType="send"
          blurOnSubmit
          accessibilityLabel="Recipe request"
          accessibilityHint="Describe what you want to cook"
        />
        <Pressable
          onPress={() => handleSend()}
          disabled={!inputText.trim() || isStreaming}
          style={[
            styles.sendButton,
            {
              backgroundColor:
                inputText.trim() && !isStreaming
                  ? theme.link
                  : withOpacity(theme.link, 0.3),
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          accessibilityState={{ disabled: !inputText.trim() || isStreaming }}
        >
          {isStreaming ? (
            <ActivityIndicator size="small" color={theme.buttonText} />
          ) : (
            <Feather name="send" size={18} color={theme.buttonText} />
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.xl,
  },
  iconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: Spacing.sm,
  },
  chipsScrollContent: {
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
    alignItems: "flex-start",
  },
  chipsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    width: "100%",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
  },
  chipGridItem: {
    flexBasis: "47%",
    flexGrow: 1,
    flexShrink: 1,
  },
  chipEmoji: {
    fontSize: 15,
  },
  messageList: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  messageBubble: {
    maxWidth: "80%",
    padding: Spacing.md,
    borderRadius: BorderRadius.card,
    marginBottom: Spacing.sm,
  },
  userBubble: {
    alignSelf: "flex-end",
    borderBottomRightRadius: BorderRadius.xs,
  },
  assistantBubble: {
    alignSelf: "flex-start",
    borderBottomLeftRadius: BorderRadius.xs,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: BorderRadius.card,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 16,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
