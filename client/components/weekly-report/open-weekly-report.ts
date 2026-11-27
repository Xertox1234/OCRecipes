import { navigationRef } from "@/navigation/navigationRef";

/**
 * Opens a weekly report on the Profile tab, from anywhere: the report popup,
 * a push, or the Coach's weekly report card in the chat (another tab).
 */
export function openWeeklyReport(id: number): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate(
    "Main",
    {
      screen: "ProfileTab",
      params: { screen: "WeeklyReport", params: { id } },
    },
    { pop: true },
  );
}
