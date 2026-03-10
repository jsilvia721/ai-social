/**
 * Media generation — single function, no interface/factory pattern.
 * Mock with jest.mock("@/lib/media") in tests.
 * When a second provider is needed, refactor then.
 */

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
}

/**
 * Generate an image from a text prompt.
 * Returns raw buffer + mimeType so the caller doesn't assume image/png.
 */
export async function generateImage(_prompt: string): Promise<GeneratedImage> {
  // TODO: Replace with actual provider (Gemini/OpenAI/Replicate)
  // When wired in, add: prompt sanitization, AbortController timeout, shouldMockExternalApis() guard
  return mockGenerateImage();
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
