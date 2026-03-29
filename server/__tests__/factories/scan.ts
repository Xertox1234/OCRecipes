import type { MenuScan, ReceiptScan } from "@shared/schema";

const menuScanDefaults: MenuScan = {
  id: 1,
  userId: "1",
  restaurantName: null,
  cuisine: null,
  menuItems: [],
  imageUrl: null,
  scannedAt: new Date("2024-01-01"),
};

export function createMockMenuScan(
  overrides: Partial<MenuScan> = {},
): MenuScan {
  return { ...menuScanDefaults, ...overrides };
}

const receiptScanDefaults: ReceiptScan = {
  id: 1,
  userId: "1",
  itemCount: 0,
  photoCount: 1,
  status: "completed",
  scannedAt: new Date("2024-01-01"),
};

export function createMockReceiptScan(
  overrides: Partial<ReceiptScan> = {},
): ReceiptScan {
  return { ...receiptScanDefaults, ...overrides };
}
