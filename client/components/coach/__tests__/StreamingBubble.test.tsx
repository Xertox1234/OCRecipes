// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import StreamingBubble from "../StreamingBubble";
import type { CoachBlock } from "@shared/schemas/coach-blocks";

const quickReplies: CoachBlock = {
  type: "quick_replies",
  options: [{ label: "Yes please", message: "Yes, show me more" }],
};

function renderBubble(streamBlocks: CoachBlock[]) {
  return renderComponent(
    <StreamingBubble
      streamingContent=""
      statusText=""
      isStreaming={false}
      streamBlocks={streamBlocks}
      onBlockAction={vi.fn()}
      onQuickReply={vi.fn()}
      onCommitmentAccept={vi.fn()}
      ttsSpeak={vi.fn()}
      isSpeaking={false}
      speakingMessageId={null}
    />,
  );
}

describe("StreamingBubble — live blocks", () => {
  // The saved reply takes over from the live blocks in place. Their exit
  // animations (the quick replies' fade) must not play for that swap, or a
  // fading second row shows over the saved one.
  it("skips the blocks' exit animations when the live copy is removed", () => {
    renderBubble([quickReplies]);

    const config = screen.getByTestId("layout-animation-config");
    expect(config.getAttribute("data-skip-exiting")).toBe("true");
    expect(config.textContent).toContain("Yes please");
  });
});

describe("StreamingBubble — paced steps (show-the-work spec 2026-11-09)", () => {
  it("the status row shows under partial text while a step runs", () => {
    renderComponent(
      <StreamingBubble
        streamingContent="Let me see what fits your day."
        statusText="Checking your pantry…"
        isStreaming
        streamBlocks={[]}
        onBlockAction={vi.fn()}
        onQuickReply={vi.fn()}
        onCommitmentAccept={vi.fn()}
        ttsSpeak={vi.fn()}
        isSpeaking={false}
        speakingMessageId={null}
      />,
    );
    expect(screen.getByText("Let me see what fits your day.")).toBeDefined();
    expect(screen.getByText("Checking your pantry…")).toBeDefined();
  });
});
