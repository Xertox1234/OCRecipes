/** Returns the device's IANA timezone string, e.g. "America/Los_Angeles". */
export function getDeviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}
