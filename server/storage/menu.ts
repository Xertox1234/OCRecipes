import { type MenuScan, type InsertMenuScan, menuScans } from "@shared/schema";
import { db } from "../db";
import { eq, desc, and } from "drizzle-orm";

// ============================================================================
// MENU SCANS
// ============================================================================

export async function getMenuScans(
  userId: string,
  limit = 20,
): Promise<MenuScan[]> {
  return db
    .select()
    .from(menuScans)
    .where(eq(menuScans.userId, userId))
    .orderBy(desc(menuScans.scannedAt))
    .limit(limit);
}

export async function createMenuScan(scan: InsertMenuScan): Promise<MenuScan> {
  const [created] = await db.insert(menuScans).values(scan).returning();
  return created;
}

export async function deleteMenuScan(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(menuScans)
    .where(and(eq(menuScans.id, id), eq(menuScans.userId, userId)))
    .returning({ id: menuScans.id });
  return result.length > 0;
}
