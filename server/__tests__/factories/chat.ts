import type {
  ChatConversation,
  ChatMessage,
  CoachNotebookEntry,
} from "@shared/schema";

const chatConversationDefaults: ChatConversation = {
  id: 1,
  userId: "1",
  title: "Test Conversation",
  type: "coach",
  metadata: null,
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

const coachNotebookEntryDefaults: CoachNotebookEntry = {
  id: 1,
  userId: "1",
  type: "observation",
  content: "Test notebook entry",
  status: "active",
  followUpDate: null,
  sourceConversationId: null,
  dedupeKey: null,
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockCoachNotebookEntry(
  overrides: Partial<CoachNotebookEntry> = {},
): CoachNotebookEntry {
  return { ...coachNotebookEntryDefaults, ...overrides };
}
