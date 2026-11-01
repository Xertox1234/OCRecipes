export type EmptyStateVariant = "firstTime" | "temporary" | "noResults";

interface EmptyStateDefaults {
  iconSize: number;
  iconOpacity: number;
}

export function getEmptyStateDefaults(
  variant: EmptyStateVariant,
): EmptyStateDefaults {
  switch (variant) {
    case "firstTime":
      return { iconSize: 48, iconOpacity: 0.4 };
    case "temporary":
      return { iconSize: 40, iconOpacity: 0.25 };
    case "noResults":
      return { iconSize: 36, iconOpacity: 0.3 };
  }
}

/**
 * TanStack's default networkMode pauses a query that fires offline: not
 * loading, not errored, no data. Callers that default `data = []` would render
 * that as genuinely empty, so they check this first. `hasData` is whether the
 * screen already holds usable data (cached or persisted).
 */
export function isPausedWithoutData(
  fetchStatus: string | undefined,
  hasData: boolean,
): boolean {
  return fetchStatus === "paused" && !hasData;
}
