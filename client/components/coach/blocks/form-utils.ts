import type { FormBlock, FormNumberField } from "@shared/schemas/coach-form";

/** One answer per field, in field order: a choice's option (null: none yet),
 *  a multi-choice's ticked options, or a number's current value. */
export type FormAnswer = string | null | string[] | number;

export function initialFormAnswers(block: FormBlock): FormAnswer[] {
  return block.fields.map((f) =>
    f.kind === "choice" ? null : f.kind === "multi_choice" ? [] : f.value,
  );
}

const decimals = (n: number) => (String(n).split(".")[1] ?? "").length;

/** The decimals a number field shows: as many as its step or its min has. */
const fieldDecimals = (f: Pick<FormNumberField, "min" | "step">) =>
  Math.max(decimals(f.step), decimals(f.min));

/** One step up or down from `value`, kept on the field's grid and in range. */
export function stepFormNumber(
  f: Pick<FormNumberField, "min" | "max" | "step">,
  value: number,
  delta: 1 | -1,
): number {
  const steps = Math.round((value - f.min) / f.step) + delta;
  const next = Number((f.min + steps * f.step).toFixed(fieldDecimals(f)));
  return Math.min(f.max, Math.max(f.min, next));
}

export function formatFormNumber(
  f: Pick<FormNumberField, "min" | "step">,
  value: number,
): string {
  const places = fieldDecimals(f);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
}

/** Tick or untick `option`, keeping the field's own option order. */
export function toggleFormOption(
  options: readonly string[],
  ticked: readonly string[],
  option: string,
): string[] {
  const next = new Set(ticked);
  if (next.has(option)) next.delete(option);
  else next.add(option);
  return options.filter((o) => next.has(o));
}

/** "Label: answer", or "Label? answer" for a label that is a question. */
const line = (label: string, answer: string) =>
  /[?:]$/.test(label) ? `${label} ${answer}` : `${label}: ${answer}`;

/**
 * The user's message for a filled-in form: one line per answered field. An
 * answer that is not one of the field's own options is left out, so the
 * message only ever holds text the form showed.
 */
export function formAnswerMessage(
  block: FormBlock,
  answers: readonly FormAnswer[],
): string {
  const lines: string[] = [];
  block.fields.forEach((f, i) => {
    const a = answers[i];
    if (f.kind === "choice") {
      if (typeof a === "string" && f.options.includes(a)) {
        lines.push(line(f.label, a));
      }
    } else if (f.kind === "multi_choice") {
      const ticked = Array.isArray(a)
        ? f.options.filter((o) => a.includes(o))
        : [];
      if (ticked.length > 0) lines.push(line(f.label, ticked.join(", ")));
    } else if (typeof a === "number") {
      const shown = formatFormNumber(f, a);
      lines.push(line(f.label, f.unit ? `${shown} ${f.unit}` : shown));
    }
  });
  return lines.join("\n");
}

export function canSubmitForm(
  block: FormBlock,
  answers: readonly FormAnswer[],
): boolean {
  return formAnswerMessage(block, answers) !== "";
}
