import { toFile } from "openai";
import { openai } from "../lib/openai";

/**
 * Transcribes an audio buffer using OpenAI Whisper API.
 */
export async function transcribeAudio(
  buffer: Buffer,
  filename: string = "audio.m4a",
): Promise<string> {
  const file = await toFile(buffer, filename, { type: "audio/m4a" });
  const transcription = await openai.audio.transcriptions.create({
    file,
    model: "whisper-1",
    language: "en",
    prompt: "Food and nutrition logging. The user is describing what they ate.",
  });

  return transcription.text;
}
