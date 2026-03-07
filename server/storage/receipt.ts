import {
  type ReceiptScan,
  type InsertReceiptScan,
  receiptScans,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, gte, lte, ne, sql } from "drizzle-orm";
import { getMonthBounds } from "./helpers";

/**
 * Create a receipt scan record.
 */
export async function createReceiptScan(
  scan: InsertReceiptScan,
): Promise<ReceiptScan> {
  const [result] = await db.insert(receiptScans).values(scan).returning();
  return result;
}

/**
 * Count non-failed receipt scans for a user within the month containing the given date.
 */
export async function getMonthlyReceiptScanCount(
  userId: string,
  date: Date,
): Promise<number> {
  const { startOfMonth, endOfMonth } = getMonthBounds(date);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(receiptScans)
    .where(
      and(
        eq(receiptScans.userId, userId),
        gte(receiptScans.scannedAt, startOfMonth),
        lte(receiptScans.scannedAt, endOfMonth),
        ne(receiptScans.status, "failed"),
      ),
    );

  return Number(result[0]?.count ?? 0);
}
