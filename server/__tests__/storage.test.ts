import { escapeLike } from "../storage/helpers";

describe("Date Range Calculations", () => {
  it("calculates start of day correctly", () => {
    const date = new Date("2024-03-15T14:30:00");
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    expect(startOfDay.getHours()).toBe(0);
    expect(startOfDay.getMinutes()).toBe(0);
    expect(startOfDay.getSeconds()).toBe(0);
    expect(startOfDay.getMilliseconds()).toBe(0);
    expect(startOfDay.getDate()).toBe(15);
  });

  it("calculates end of day correctly", () => {
    const date = new Date("2024-03-15T14:30:00");
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    expect(endOfDay.getHours()).toBe(23);
    expect(endOfDay.getMinutes()).toBe(59);
    expect(endOfDay.getSeconds()).toBe(59);
    expect(endOfDay.getMilliseconds()).toBe(999);
    expect(endOfDay.getDate()).toBe(15);
  });

  it("handles month boundaries", () => {
    const date = new Date("2024-01-31T12:00:00");
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    expect(startOfDay.getMonth()).toBe(0); // January
    expect(startOfDay.getDate()).toBe(31);
  });

  it("handles year boundaries", () => {
    const date = new Date("2024-12-31T23:59:59");
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    expect(startOfDay.getFullYear()).toBe(2024);
    expect(startOfDay.getMonth()).toBe(11); // December
    expect(startOfDay.getDate()).toBe(31);
  });
});

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
