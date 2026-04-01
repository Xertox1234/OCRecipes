import { toFile } from "openai";
import { openai, OPENAI_TIMEOUT_HEAVY_MS } from "../lib/openai";

/**
 * Transcribes an audio buffer using OpenAI Whisper API.
 */
export async function transcribeAudio(
  buffer: Buffer,
  _filename: string = "audio.m4a",
): Promise<string> {
  // Use a safe static filename — client-provided names are untrusted
  const safeFilename = `audio-${Date.now()}.m4a`;
  const file = await toFile(buffer, safeFilename, { type: "audio/m4a" });

  let text: string;
  try {
    const transcription = await openai.audio.transcriptions.create(
      {
        file,
        model: "whisper-1",
        language: "en",
        prompt:
          "Food and nutrition logging. The user is describing what they ate.",
      },
      { timeout: OPENAI_TIMEOUT_HEAVY_MS },
    );
    text = transcription.text;
  } catch (error) {
    throw new Error(
      `Voice transcription failed: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }

  if (!text || text.trim().length === 0) {
    throw new Error("Voice transcription returned empty result");
  }

  return text.trim();
}
