---
title: Monthly usage cap with `COUNT(*)` instead of fetching rows
track: knowledge
category: design-patterns
module: server
tags: [database, drizzle, performance, premium, rate-limiting]
applies_to: [server/storage/**/*.ts]
created: '2026-05-13'
---

# Monthly usage cap with `COUNT(*)` instead of fetching rows

## When this applies

For premium features with monthly limits, use `COUNT(*)` instead of fetching all rows.

## Why

`COUNT(*)` is handled entirely by the database without transferring row data. Fetching all rows via `select().from()` + `.length` transfers unnecessary data and scales poorly.

## Examples

```typescript
// server/storage/receipt.ts
import { sql } from "drizzle-orm";

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
        ne(receiptScans.status, "failed"), // Failed attempts don't count
        gte(receiptScans.scannedAt, startOfMonth),
        lte(receiptScans.scannedAt, endOfMonth),
      ),
    );
  return Number(result[0]?.count ?? 0);
}
```

Route usage:

```typescript
const count = await getMonthlyReceiptScanCount(req.userId!, new Date());
if (count >= features.monthlyReceiptScans) {
  return sendError(
    res,
    429,
    "Monthly receipt scan limit reached",
    ErrorCode.LIMIT_REACHED,
  );
}
```

## When to use

Any usage-capped feature (monthly scans, daily limits).

## Exceptions

When you need the actual rows for further processing — then query and count.

## Related Files

- `server/storage/receipt.ts`

## See Also

- [Rate limiting on external API endpoints](rate-limiting-external-api-endpoints-2026-05-13.md)
- [Premium-gate parity across endpoints hitting expensive AI paths](../conventions/premium-gate-parity-expensive-ai-paths-2026-05-13.md)
