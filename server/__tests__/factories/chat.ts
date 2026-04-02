import type { ChatConversation, ChatMessage } from "@shared/schema";

const chatConversationDefaults: ChatConversation = {
  id: 1,
  userId: "1",
  title: "Test Conversation",
  type: "coach",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockChatConversation(
  overrides: Partial<ChatConversation> = {},
): ChatConversation {
  return { ...chatConversationDefaults, ...overrides };
}

const chatMessageDefaults: ChatMessage = {
  id: 1,
  conversationId: 1,
  role: "user",
  content: "Test message",
  metadata: null,
  createdAt: new Date("2024-01-01"),
};

export function createMockChatMessage(
  overrides: Partial<ChatMessage> = {},
): ChatMessage {
  return { ...chatMessageDefaults, ...overrides };
}
