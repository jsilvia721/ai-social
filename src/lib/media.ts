/**
 * Media generation — Gemini Imagen 4 integration.
 * Mock with jest.mock("@/lib/media") in tests, or shouldMockExternalApis() for dev/staging.
 */

import { GoogleGenAI } from "@google/genai";
import { env } from "@/env";
import { shouldMockExternalApis } from "@/lib/mocks/config";

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
}

// Module-level singleton (matches Anthropic client pattern in ai/index.ts)
const ai = new GoogleGenAI({ apiKey: env.GOOGLE_AI_API_KEY });

const GEMINI_TIMEOUT_MS = 30_000;

/**
 * Generate an image from a text prompt.
 * Returns raw buffer + mimeType so the caller doesn't assume format.
 */
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  if (shouldMockExternalApis()) {
    return mockGenerateImage();
  }

  // Sanitize prompt: strip control characters, limit length
  const sanitizedPrompt = prompt
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, 1900); // Gemini limit ~480 tokens ≈ ~1900 chars

  // Audit log: capture prompt for debugging/review
  console.log("[image-gen] prompt:", sanitizedPrompt.slice(0, 200));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const response = await ai.models.generateImages({
      model: "imagen-4.0-generate-001",
      prompt: sanitizedPrompt,
      config: {
        numberOfImages: 1,
        aspectRatio: "1:1",
      },
    });

    const image = response.generatedImages?.[0];
    if (!image?.image?.imageBytes) {
      throw new Error("Gemini returned no image data");
    }

    return {
      buffer: Buffer.from(image.image.imageBytes, "base64"),
      mimeType: "image/png",
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Deterministic mock image for dev/staging/testing */
function mockGenerateImage(): GeneratedImage {
  // 1x1 transparent PNG
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
    "base64"
  );
  return { buffer: pngBytes, mimeType: "image/png" };
}
