import type { Transaction } from "@shared/schema";

const transactionDefaults: Transaction = {
  id: 1,
  userId: "1",
  transactionId: "txn_test_123",
  receipt: "test-receipt-data",
  platform: "ios",
  productId: "com.ocrecipes.premium.monthly",
  status: "pending",
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

export function createMockTransaction(
  overrides: Partial<Transaction> = {},
): Transaction {
  return { ...transactionDefaults, ...overrides };
}
