/**
 * Media generation — Replicate (Flux 1.1 Pro) integration.
 * Mock with jest.mock("@/lib/media") in tests, or shouldMockExternalApis() for dev/staging.
 */

import Replicate from "replicate";
import { env } from "@/env";
import { shouldMockExternalApis } from "@/lib/mocks/config";

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
}

const REPLICATE_TIMEOUT_MS = 60_000;

// Lazy init to ensure .env.local is loaded by Next.js before we read the token.
// We read from env (Zod-parsed) to get the .env.local value, which takes
// precedence over any stale shell env var that process.env might have.
let _replicate: Replicate | null = null;
function getReplicateClient(): Replicate {
  if (!_replicate) {
    _replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });
  }
  return _replicate;
}

/**
 * Generate an image from a text prompt using Flux 1.1 Pro via Replicate.
 * Returns raw buffer + mimeType so the caller doesn't assume format.
 */
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  if (shouldMockExternalApis() || !env.REPLICATE_API_TOKEN) {
    return mockGenerateImage();
  }

  // Sanitize prompt: strip control characters, limit length
  const sanitizedPrompt = prompt
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, 1900);

  // Audit log: capture prompt for debugging/review
  console.log("[image-gen] prompt:", sanitizedPrompt.slice(0, 200));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REPLICATE_TIMEOUT_MS);

  try {
    const output = await getReplicateClient().run("black-forest-labs/flux-1.1-pro", {
      input: {
        prompt: sanitizedPrompt,
        aspect_ratio: "1:1",
      },
    });

    // Replicate returns a ReadableStream or URL string for image models
    let imageBuffer: Buffer;
    if (output instanceof ReadableStream) {
      const chunks: Uint8Array[] = [];
      const reader = output.getReader();
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        if (result.value) chunks.push(result.value);
      }
      imageBuffer = Buffer.concat(chunks);
    } else if (typeof output === "string") {
      // URL string — fetch the image
      const res = await fetch(output);
      if (!res.ok) throw new Error(`Failed to fetch image from Replicate: ${res.status}`);
      imageBuffer = Buffer.from(await res.arrayBuffer());
    } else {
      throw new Error("Replicate returned unexpected output format");
    }

    if (imageBuffer.length === 0) {
      throw new Error("Replicate returned empty image data");
    }

    return {
      buffer: imageBuffer,
      mimeType: "image/webp",
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
