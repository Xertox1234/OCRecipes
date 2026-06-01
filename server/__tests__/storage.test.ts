import { escapeLike } from "../storage/helpers";

// Real production-code coverage for the storage layer lives in
// server/storage/__tests__/*.test.ts, which import and call the actual
// functions against a Postgres test-transaction fixture: user functions
// (getUser/getUserByUsername/createUser/updateUser/getUserProfile) in
// users.test.ts; scanned-item, daily-log, and daily-summary functions
// (getScannedItems/getScannedItem/createScannedItem/getDailyLogs/
// createDailyLog/getDailySummary) in nutrition.test.ts; and the
// IDOR/saved-item functions also in nutrition.test.ts. The previous inline
// `vi.fn()` describe blocks here ("Storage Interface Contract", "IDOR
// Protection", "Saved Items") asserted only their own stubs' return values
// and exercised zero production code, so they were removed.
//
// A "Date Range Calculations" describe block was also removed: it
// re-implemented day-boundary math inline (`new Date(d); d.setHours(0,0,0,0)`)
// and then asserted that same computation, exercising no production code. The
// real day-boundary helper is `getDayBounds` in server/storage/helpers.ts; its
// behaviour is covered against the real-DB fixture in nutrition.test.ts
// (getDailyLogs "does not return logs from a different date", getDailyScanCount
// "returns 0 when no scans exist for the date", and the getDailySummary suite,
// all of which route through getDayBounds).

describe("escapeLike", () => {
  it("should return plain strings unchanged", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });

  it("should escape percent signs", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("should escape underscores", () => {
    expect(escapeLike("my_product")).toBe("my\\_product");
  });

  it("should escape backslashes", () => {
    expect(escapeLike("path\\to")).toBe("path\\\\to");
  });

  it("should escape multiple metacharacters in one string", () => {
    expect(escapeLike("50% off_sale\\now")).toBe("50\\% off\\_sale\\\\now");
  });

  it("should handle empty string", () => {
    expect(escapeLike("")).toBe("");
  });

  it("should handle strings with only metacharacters", () => {
    expect(escapeLike("%_%")).toBe("\\%\\_\\%");
  });

  it("should not escape other special regex or SQL characters", () => {
    expect(escapeLike("it's a [test] (value)")).toBe("it's a [test] (value)");
  });
});
