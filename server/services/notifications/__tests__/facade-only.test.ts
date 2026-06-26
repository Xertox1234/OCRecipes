import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Files allowed to reference the low-level senders: the facade itself, the push
// service module, the storage module that defines createPendingReminder, and tests.
const ALLOWLIST = [
  "server/services/notifications/notify.ts",
  "server/services/push-notifications.ts",
  "server/storage/reminders.ts",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") return [];
      return walk(p);
    }
    return p.endsWith(".ts") ? [p] : [];
  });
}

describe("facade-only enforcement", () => {
  it("no producer calls sendPushToUser or createPendingReminder directly", () => {
    const files = walk("server").filter(
      (f) => !ALLOWLIST.some((a) => f.endsWith(a)),
    );
    const offenders = files.filter((f) => {
      const src = readFileSync(f, "utf8");
      return (
        /\bsendPushToUser\s*\(/.test(src) ||
        /\bcreatePendingReminder\s*\(/.test(src)
      );
    });
    expect(offenders).toEqual([]);
  });
});
