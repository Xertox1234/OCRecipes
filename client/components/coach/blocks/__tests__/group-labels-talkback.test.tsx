// @vitest-environment jsdom
//
// Coach chat audit 2026-11-24, L6 and L10: a labelled radiogroup whose name
// is also visible text above it. Android reads the labelled group node AND
// the text, so TalkBack spoke the question twice; iOS Fabric drops the
// group's label, so the visible text is iOS's only read. The text is hidden
// on Android only (`importantForAccessibility="no"`, which iOS ignores),
// the pattern RecipeAdjust already uses (RecipeAdjust.talkback.test.tsx).
import React, { useState } from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import WriteCard from "../write-cards/WriteCard";
import FormBlock from "../FormBlock";
import { RecipeQuestions } from "../../../recipe-finder/RecipeQuestions";
import type {
  WriteCardBlock,
  WriteCardEdits,
} from "@shared/schemas/coach-write-cards";
import type { FormBlock as FormBlockType } from "@shared/schemas/coach-form";
import type { RecipeQuestionsBlock } from "@shared/schemas/recipe-finder";

// The shared RN mock maps only "no-hide-descendants" to aria-hidden and drops
// "no", so surface the raw value as a data attribute.
vi.mock("@/components/ThemedText", async () => {
  const RN = await import("react-native");
  const ReactMod = await import("react");
  const MockText = RN.Text as unknown as React.ComponentType<
    Record<string, unknown>
  >;
  return {
    ThemedText: ({ maxScale: _maxScale, ...props }: Record<string, unknown>) =>
      ReactMod.createElement(MockText, {
        ...props,
        "data-important-for-a11y": props.importantForAccessibility,
      }),
  };
});

vi.mock("@/lib/query-client", () => ({ apiRequest: vi.fn() }));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    selection: vi.fn(),
    impact: vi.fn(),
    notification: vi.fn(),
  }),
}));

function WriteHarness({ block }: { block: WriteCardBlock }) {
  const [edits, setEdits] = useState<WriteCardEdits>({});
  return <WriteCard block={block} edits={edits} onEdit={setEdits} />;
}

/** The visible text is read once: hidden on Android, left for iOS. */
function expectAndroidOnlyHidden(text: string) {
  const el = screen.getByText(text);
  expect(el.getAttribute("data-important-for-a11y")).toBe("no");
  expect(el.getAttribute("aria-hidden")).toBeNull();
}

describe("visible group labels are read once on Android", () => {
  it("grocery card: the 'Add to' caption names the list group", () => {
    renderComponent(
      <WriteHarness
        block={{
          type: "write_card",
          cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
          kind: "grocery",
          status: "live",
          payload: {
            items: [
              { name: "Spinach", quantity: "1", unit: null, ticked: true },
            ],
            lists: [{ id: 7, title: "Weekly shop" }],
            defaultListId: 7,
            newListName: "Lentil stew",
          },
        }}
      />,
    );
    expect(screen.getByRole("radiogroup", { name: "Add to" })).toBeDefined();
    expectAndroidOnlyHidden("Add to");
  });

  it("allergy card: the severity question", () => {
    renderComponent(
      <WriteHarness
        block={{
          type: "write_card",
          cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
          kind: "allergy",
          status: "live",
          payload: { allergen: "tree_nuts" },
        }}
      />,
    );
    expect(
      screen.getByRole("radiogroup", { name: "How severe is it?" }),
    ).toBeDefined();
    expectAndroidOnlyHidden("How severe is it?");
  });

  it("form block: a choice field's label", () => {
    const block: FormBlockType = {
      type: "form",
      title: "A few details",
      fields: [
        { kind: "choice", label: "Which meal?", options: ["Lunch", "Dinner"] },
      ],
      submitLabel: "Send",
    };
    renderComponent(<FormBlock block={block} />);
    expect(
      screen.getByRole("radiogroup", { name: "Which meal?" }),
    ).toBeDefined();
    expectAndroidOnlyHidden("Which meal?");
  });

  it("recipe questions: each question", () => {
    const block: RecipeQuestionsBlock = {
      type: "recipe_questions",
      questions: [
        {
          question: "How much time do you have?",
          options: ["Under 20 minutes", "An hour or more"],
        },
      ],
      flow: {
        flowId: "00000000-0000-4000-8000-000000000000",
        stage: "clarifying",
        request: "x",
        query: { q: "x" },
        round: 0,
        shownIds: [],
      },
    };
    renderComponent(
      <RecipeQuestions block={block} isActive onSubmit={vi.fn()} />,
    );
    expectAndroidOnlyHidden("How much time do you have?");
  });
});
