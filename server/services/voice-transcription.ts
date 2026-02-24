import OpenAI, { toFile } from "openai";

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

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
