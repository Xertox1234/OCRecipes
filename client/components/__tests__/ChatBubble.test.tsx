// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ChatBubble } from "../ChatBubble";

describe("ChatBubble", () => {
  it("renders user message with correct accessibility label", () => {
    renderComponent(<ChatBubble role="user" content="Hello!" />);
    expect(screen.getByText("Hello!")).toBeDefined();
    expect(screen.getByLabelText("You: Hello!")).toBeDefined();
  });

  it("renders assistant message with correct accessibility label", () => {
    renderComponent(<ChatBubble role="assistant" content="How can I help?" />);
    expect(screen.getByText("How can I help?")).toBeDefined();
    expect(screen.getByLabelText("NutriCoach: How can I help?")).toBeDefined();
  });

  // The screen strips markdown images and shows links as plain text; the
  // spoken label must match what is on screen, not read raw syntax or URLs.
  it("speaks the same cleaned text the screen shows: no image syntax, link text without its URL", () => {
    renderComponent(
      <ChatBubble
        role="assistant"
        content={
          "Try this ![bowl](https://x.test/b.jpg) from [Bon Appetit](https://ba.test/r)."
        }
      />,
    );
    expect(
      screen.getByLabelText("NutriCoach: Try this from Bon Appetit."),
    ).toBeDefined();
  });

  it("renders nothing for an assistant message that is only an image (strips to empty)", () => {
    renderComponent(
      <ChatBubble role="assistant" content="![bowl](https://x.test/b.jpg)" />,
    );
    expect(screen.queryByLabelText(/NutriCoach/)).toBeNull();
  });

  it("returns null when content is empty and not streaming", () => {
    const { container } = renderComponent(
      <ChatBubble role="assistant" content="" />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("returns null when content is empty even if isStreaming is set", () => {
    const { container } = renderComponent(
      <ChatBubble role="assistant" content="" isStreaming />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders content when streaming with text", () => {
    renderComponent(
      <ChatBubble role="assistant" content="Thinking..." isStreaming />,
    );
    expect(screen.getByText("Thinking...")).toBeDefined();
  });
});
