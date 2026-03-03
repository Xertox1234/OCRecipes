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
