import type { WeeklyReportBlock } from "@shared/schemas/coach-blocks";
import { formatWeekRange } from "@/components/weekly-report/weekly-report-utils";

/**
 * Pure helpers for the Coach's weekly report card (roadmap A3), so the card
 * in WeeklyReportCard.tsx stays thin and Vitest covers its wording.
 */

function days(n: number): string {
  return n === 1 ? "1 day" : `${n} days`;
}

/** The counts under the headline; a week with no protein goal has two. */
export function reportStats(block: WeeklyReportBlock): string[] {
  return [
    `${block.daysActive} of 7 days logged`,
    block.mealsLogged === 1 ? "1 meal" : `${block.mealsLogged} meals`,
    ...(block.proteinDaysMet === null
      ? []
      : [`Protein goal met ${days(block.proteinDaysMet)}`]),
  ];
}

export function reportEyebrow(block: WeeklyReportBlock): string {
  return `Your week · ${formatWeekRange(block.weekStart, block.weekEnd)}`;
}

/**
 * The whole card as one spoken button; what a tap does is its hint. A
 * headline that already ends a sentence is not given a second full stop.
 */
export function reportSpoken(block: WeeklyReportBlock): string {
  const headline = block.headline.trim();
  return [
    `Your week, ${formatWeekRange(block.weekStart, block.weekEnd)}. `,
    /[.!?]$/.test(headline) ? `${headline} ` : `${headline}. `,
    reportStats(block).join(". "),
  ].join("");
}

/** Where a tap goes: the report on the Profile tab, as the root stack's "Main" params. */
export function weeklyReportScreen(id: number) {
  return {
    screen: "ProfileTab" as const,
    params: { screen: "WeeklyReport" as const, params: { id } },
  };
}
