import { describe, it, expect } from "vitest";
import { exportUserColumns } from "../export";

// The CCPA/PIPEDA export's load-bearing safety property is that the user-account
// projection is an explicit allowlist. The route layer never re-filters — if a
// sensitive column slips into the allowlist, it will appear in every export.
// This test guards the allowlist directly so a regression fails fast in CI,
// independent of any database, mocks, or HTTP setup.
describe("exportUserColumns", () => {
  const forbiddenKeys = ["password", "tokenVersion"] as const;

  for (const key of forbiddenKeys) {
    it(`does not include sensitive column "${key}"`, () => {
      expect(Object.keys(exportUserColumns)).not.toContain(key);
    });
  }
});

// Privacy audit 2026-11-10, M6: tables added after the export was written
// (coach write cards, migration 0042) silently stayed out of it. Every table
// with a foreign key to users must be either exported or excluded on purpose
// with a reason, so a new user-linked table fails here until someone decides.
describe("export coverage of user-linked tables", () => {
  it("accounts for every table that references users", async () => {
    const { getTableConfig, PgTable } = await import("drizzle-orm/pg-core");
    const schema = await import("@shared/schema");
    const { EXPORTED_USER_TABLES, EXPORT_EXCLUDED_TABLES } = await import(
      "../export"
    );

    const userLinked = Object.values(schema)
      .filter((t): t is InstanceType<typeof PgTable> => t instanceof PgTable)
      .map((t) => getTableConfig(t))
      .filter((cfg) =>
        cfg.foreignKeys.some(
          (fk) => getTableConfig(fk.reference().foreignTable).name === "users",
        ),
      )
      .map((cfg) => cfg.name)
      .sort();

    // Denominator: the schema has dozens of user-linked tables; an empty list
    // would mean the FK walk broke, not that coverage is complete.
    expect(userLinked.length).toBeGreaterThan(30);

    const accounted = new Set([
      ...EXPORTED_USER_TABLES,
      ...Object.keys(EXPORT_EXCLUDED_TABLES),
    ]);
    expect(userLinked.filter((name) => !accounted.has(name))).toEqual([]);
  });

  it("never both exports and excludes a table", async () => {
    const { EXPORTED_USER_TABLES, EXPORT_EXCLUDED_TABLES } = await import(
      "../export"
    );
    const excluded = new Set(Object.keys(EXPORT_EXCLUDED_TABLES));
    expect(EXPORTED_USER_TABLES.filter((t) => excluded.has(t))).toEqual([]);
  });
});

describe("export column allowlists for credential-bearing tables", () => {
  it("sign-in connections omit the Apple refresh token and provider subject", async () => {
    const { exportIdentityColumns } = await import("../export");
    const keys = Object.keys(exportIdentityColumns);
    expect(keys).not.toContain("appleRefreshTokenEnc");
    expect(keys).not.toContain("providerSubject");
    expect(keys).toEqual(
      expect.arrayContaining(["provider", "email", "createdAt"]),
    );
  });
});
