import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Every user password is hashed through server/lib/password-hash.ts, so it
// gets the pv2 pre-hash (spec §3). A direct bcrypt.hash elsewhere would write
// a legacy hash that silently ignores everything past 72 bytes.
const ALLOWED = new Set([
  "server/lib/password-hash.ts",
  "server/storage/api-keys.ts", // API keys, not passwords
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "node_modules" || name === "__tests__") continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("bcrypt.hash is only called through the facade", () => {
  it("no user-password bcrypt.hash outside password-hash.ts", () => {
    const files = walk("server");
    expect(files.length).toBeGreaterThan(50); // non-vacuous walk
    // Positive control: the facade itself is walked and does match.
    expect(files).toContain("server/lib/password-hash.ts");
    expect(
      /\bbcrypt\.hash\s*\(/.test(
        readFileSync("server/lib/password-hash.ts", "utf8"),
      ),
    ).toBe(true);
    const offenders = files.filter(
      (f) =>
        !ALLOWED.has(f) &&
        /\bbcrypt\.hash\s*\(/.test(readFileSync(f, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});
