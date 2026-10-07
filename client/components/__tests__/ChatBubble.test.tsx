// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { SlideInLeft, SlideInRight } from "react-native-reanimated";
import { ChatBubble } from "../ChatBubble";

const { a11y } = vi.hoisted(() => ({ a11y: { reducedMotion: false } }));

vi.mock("@/hooks/useAccessibility", () => ({
  useAccessibility: () => a11y,
}));

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

describe("ChatBubble — entrance", () => {
  type Spied = { springify: () => unknown };
  let userSpring: ReturnType<typeof vi.spyOn>;
  let assistantSpring: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    a11y.reducedMotion = false;
    userSpring = vi.spyOn(SlideInRight as unknown as Spied, "springify");
    assistantSpring = vi.spyOn(SlideInLeft as unknown as Spied, "springify");
  });
  afterEach(() => {
    userSpring.mockRestore();
    assistantSpring.mockRestore();
  });

  // Positive controls: a live copy (just sent, or the reply streaming in)
  // slides in from its own side.
  it("slides a live user message in from the right", () => {
    renderComponent(<ChatBubble role="user" content="Hi" animateEntry />);
    expect(userSpring).toHaveBeenCalled();
  });

  it("slides a live reply in from the left", () => {
    renderComponent(
      <ChatBubble role="assistant" content="Hello" animateEntry />,
    );
    expect(assistantSpring).toHaveBeenCalled();
  });

  // Saved messages (history load, scrolling back, the swap once a reply is
  // saved) appear in place instead of replaying the slide.
  it("does not slide by default", () => {
    renderComponent(<ChatBubble role="assistant" content="Hello" />);
    renderComponent(<ChatBubble role="user" content="Hi" />);
    expect(assistantSpring).not.toHaveBeenCalled();
    expect(userSpring).not.toHaveBeenCalled();
  });

  it("does not slide under reduced motion", () => {
    a11y.reducedMotion = true;
    renderComponent(<ChatBubble role="user" content="Hi" animateEntry />);
    expect(userSpring).not.toHaveBeenCalled();
    expect(screen.getByText("Hi")).toBeDefined();
  });
});
