import React, { useState, useCallback, useRef, useMemo } from "react";
import {
  View,
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
    prompt: "Give me a quick and easy recipe I can make in under 20 minutes",
  },
  {
    label: "High Protein",
    prompt: "Create a high-protein meal for post-workout recovery",
  },
  {
    label: "Italian",
    prompt: "Make me an authentic Italian dinner",
  },
  {
    label: "Comfort Food",
    prompt: "I want something warm and comforting",
  },
  {
    label: "Kid-Friendly",
    prompt: "Create a healthy kid-friendly meal",
  },
  {
    label: "Low Carb",
    prompt: "Give me a delicious low-carb dinner option",
  },
  {
    label: "Budget Friendly",
    prompt: "Create a tasty meal using affordable ingredients",
  },
  {
    label: "Date Night",
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
  const { sendMessage, streamingContent, streamingRecipe, isStreaming } =
    useSendMessage(conversationId);
  const saveRecipeMutation = useSaveRecipeFromChat();
  const savedMessageIdsRef = useRef(new Set<number>());
  const [, forceRender] = useState(0);

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
    const msgs = [...messages];

    // Add streaming message if active
    if (isStreaming && streamingContent) {
      msgs.push({
        id: -1,
        conversationId: conversationId ?? 0,
        role: "assistant",
        content: streamingContent,
        metadata: streamingRecipe ? { recipe: streamingRecipe } : null,
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
  ]);

  const renderMessage = useCallback(
    ({ item }: { item: (typeof displayMessages)[0] }) => {
      const isUser = item.role === "user";
      const metadata = item.metadata as Record<string, unknown> | null;
      const recipe = metadata?.recipe as StreamingRecipe | undefined;
      const allergenWarning = metadata?.allergenWarning as string | undefined;
      const isAlreadySaved = savedMessageIdsRef.current.has(item.id);
      const isStreaming_ = item.id === -1;

      return (
        <View>
          {/* Text bubble */}
          {item.content ? (
            <View
              style={[
                styles.messageBubble,
                isUser
                  ? [styles.userBubble, { backgroundColor: theme.link }]
                  : [
                      styles.assistantBubble,
                      {
                        backgroundColor: withOpacity(theme.text, 0.06),
                      },
                    ],
              ]}
              accessible
              accessibilityRole="text"
              accessibilityLabel={`${isUser ? "You" : "RecipeChef"}: ${item.content}`}
            >
              <ThemedText
                style={isUser ? { color: theme.buttonText } : undefined}
              >
                {item.content}
              </ThemedText>
            </View>
          ) : null}

          {/* Recipe card (if present in metadata) */}
          {recipe && (
            <RecipeCard
              recipe={recipe}
              allergenWarning={allergenWarning}
              isImageLoading={isStreaming_ && !recipe.imageUrl}
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
          <Feather
            name={isRemixMode ? "shuffle" : "book-open"}
            size={48}
            color={theme.link}
          />
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
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContainer}
            style={{ marginTop: Spacing.lg }}
            accessible
            accessibilityRole="none"
            accessibilityLabel={
              isRemixMode ? "Remix suggestions" : "Suggested prompts"
            }
          >
            {(isRemixMode ? remixChips : SUGGESTION_CHIPS).map((chip) => (
              <Pressable
                key={chip.label}
                onPress={() => handleChipPress(chip.prompt)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: withOpacity(theme.link, 0.08),
                    borderColor: withOpacity(theme.link, 0.15),
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
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={displayMessages}
          renderItem={renderMessage}
          keyExtractor={(item) =>
            item.id === -1 ? "streaming" : item.id.toString()
          }
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

      {/* Streaming indicator */}
      {isStreaming && !streamingContent && (
        <View style={styles.typingRow}>
          <ActivityIndicator size="small" color={theme.link} />
          <ThemedText
            type="caption"
            style={{ color: theme.textSecondary, marginLeft: Spacing.xs }}
          >
            RecipeChef is thinking...
          </ThemedText>
        </View>
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
  chipsContainer: {
    paddingHorizontal: Spacing.md,
    gap: Spacing.sm,
  },
  chip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.full,
    borderWidth: 1,
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
  typingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
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
