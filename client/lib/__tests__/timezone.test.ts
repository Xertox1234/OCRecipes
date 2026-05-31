import { getDeviceTimezone } from "../timezone";

describe("getDeviceTimezone", () => {
  it("returns the resolved IANA timezone when available", () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockReturnValue({
      resolvedOptions: () => ({ timeZone: "America/Los_Angeles" }),
    } as unknown as Intl.DateTimeFormat);

    expect(getDeviceTimezone()).toBe("America/Los_Angeles");

    spy.mockRestore();
  });

  it('falls back to "UTC" when timezone resolution throws', () => {
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(() => {
      throw new Error("Intl unavailable");
    });

    expect(getDeviceTimezone()).toBe("UTC");

    spy.mockRestore();
  });
});
