import { transcribeAudio } from "../voice-transcription";

import { openai } from "../../lib/openai";

// Mock the openai module
vi.mock("../../lib/openai", () => ({
  openai: {
    audio: {
      transcriptions: {
        create: vi.fn(),
      },
    },
  },
  OPENAI_TIMEOUT_HEAVY_MS: 60_000,
}));

// Mock the openai 'toFile' helper
vi.mock("openai", () => ({
  toFile: vi.fn().mockResolvedValue({ name: "audio.m4a" }),
}));

const mockTranscribe = vi.mocked(openai.audio.transcriptions.create);

describe("Voice Transcription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("transcribeAudio", () => {
    it("returns transcribed text from Whisper API", async () => {
      mockTranscribe.mockResolvedValue({
        text: "I had two eggs and toast for breakfast",
      } as any);

      const buffer = Buffer.from("fake audio data");
      const result = await transcribeAudio(buffer);

      expect(result).toBe("I had two eggs and toast for breakfast");
    });

    it("calls Whisper with correct parameters", async () => {
      mockTranscribe.mockResolvedValue({ text: "some text" } as any);

      const buffer = Buffer.from("fake audio");
      await transcribeAudio(buffer, "recording.m4a");

      expect(mockTranscribe).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "whisper-1",
          language: "en",
        }),
        expect.objectContaining({ timeout: 60_000 }),
      );
    });

    it("uses default filename when not provided", async () => {
      mockTranscribe.mockResolvedValue({ text: "test" } as any);

      const buffer = Buffer.from("fake audio");
      await transcribeAudio(buffer);

      expect(mockTranscribe).toHaveBeenCalled();
    });

    it("propagates API errors", async () => {
      mockTranscribe.mockRejectedValue(new Error("API rate limited"));

      const buffer = Buffer.from("fake audio");
      await expect(transcribeAudio(buffer)).rejects.toThrow(
        "Voice transcription failed: API rate limited",
      );
    });

    it("throws on empty transcription response", async () => {
      mockTranscribe.mockResolvedValue({ text: "" } as any);

      const buffer = Buffer.from("silence");
      await expect(transcribeAudio(buffer)).rejects.toThrow(
        "Voice transcription returned empty result",
      );
    });
  });
});
