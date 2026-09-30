// @vitest-environment jsdom
// Return's behaviour on the shared coach input: a single-line input sends on
// Return; a multiline one inserts a newline (the Coach overlay) unless the
// caller asks Return to send (Coach Pro, which went multiline so iOS offers
// Paste — user report 2026-09-30). jsdom drops RN's boolean props, so the
// TextInput double records what it receives.
import React from "react";
import { renderComponent } from "../../../../test/utils/render-component";
import { CoachChatBase } from "../CoachChatBase";

const { textInputProps } = vi.hoisted(() => ({
  textInputProps: [] as Record<string, unknown>[],
}));

vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  return {
    ...actual,
    TextInput: (props: Record<string, unknown>) => {
      textInputProps.push(props);
      return null;
    },
  };
});

beforeEach(() => {
  textInputProps.length = 0;
});

const base = {
  inputText: "",
  onChangeText: vi.fn(),
  onSend: vi.fn(),
  isStreaming: false,
};

const lastInput = () => textInputProps[textInputProps.length - 1];

describe("CoachChatBase — input Return behaviour", () => {
  it("single-line (default): Return sends", () => {
    renderComponent(<CoachChatBase {...base}>{null}</CoachChatBase>);
    expect(lastInput().multiline).toBe(false);
    expect(lastInput().blurOnSubmit).toBe(true);
  });

  it("multiline: Return inserts a newline", () => {
    renderComponent(
      <CoachChatBase {...base} multilineInput>
        {null}
      </CoachChatBase>,
    );
    expect(lastInput().multiline).toBe(true);
    expect(lastInput().blurOnSubmit).toBe(false);
  });

  it("multiline with submitOnReturn: Return sends", () => {
    renderComponent(
      <CoachChatBase {...base} multilineInput submitOnReturn>
        {null}
      </CoachChatBase>,
    );
    expect(lastInput().multiline).toBe(true);
    expect(lastInput().blurOnSubmit).toBe(true);
  });
});
