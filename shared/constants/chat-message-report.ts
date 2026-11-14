/**
 * Why a person reported an AI reply (privacy audit 2026-11-10, G7 — Google
 * Play asks for an in-app way to report AI-generated content). A report saves
 * the reply's id, one of these reasons and who reported: never the text, and
 * no free-text field, which would collect more health data.
 *
 * The database CHECK in migrations/0046 lists the same ids — change both.
 */
export const CHAT_MESSAGE_REPORT_REASONS = [
  { id: "inaccurate", label: "Wrong or misleading" },
  { id: "harmful", label: "Harmful or unsafe" },
  { id: "offensive", label: "Offensive" },
  { id: "other", label: "Something else" },
] as const;

export type ChatMessageReportReason =
  (typeof CHAT_MESSAGE_REPORT_REASONS)[number]["id"];

export const CHAT_MESSAGE_REPORT_REASON_IDS = CHAT_MESSAGE_REPORT_REASONS.map(
  (r) => r.id,
) as [ChatMessageReportReason, ...ChatMessageReportReason[]];
