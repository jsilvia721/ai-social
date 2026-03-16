/**
 * Media generation — Replicate (Flux 1.1 Pro) integration.
 * Mock with jest.mock("@/lib/media") in tests, or shouldMockExternalApis() for dev/staging.
 */

import { Readable } from "stream";
import { Upload } from "@aws-sdk/lib-storage";
import { env } from "@/env";
import { s3, bucket, getPublicUrl } from "@/lib/storage";
import { shouldMockExternalApis } from "@/lib/mocks/config";
import { getReplicateClient } from "@/lib/replicate-client";
import { VIDEO_DURATION_DEFAULT, VIDEO_MODEL_DEFAULT, VIDEO_PROMPT_MAX_LENGTH } from "@/lib/video";

export interface GeneratedImage {
  buffer: Buffer;
  mimeType: string;
}

export interface GenerateVideoOptions {
  prompt: string;
  aspectRatio: string;
  webhookUrl: string;
  duration?: number;
}

export interface GenerateVideoResult {
  predictionId: string;
}

const REPLICATE_TIMEOUT_MS = 60_000;

// ── Allowed hostnames for Replicate media ────────────────────────────────────

const ALLOWED_REPLICATE_HOSTNAMES = new Set([
  "replicate.delivery",
  "pbxt.replicate.delivery",
]);

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
      // URL string — validate hostname before fetching (SSRF guard)
      const parsedUrl = new URL(output);
      if (!ALLOWED_REPLICATE_HOSTNAMES.has(parsedUrl.hostname)) {
        throw new Error(`Untrusted image source hostname: ${parsedUrl.hostname}`);
      }
      const res = await fetch(output);
      if (!res.ok) throw new Error(`Failed to fetch image from Replicate: ${res.status}`);
      const ct = res.headers.get("Content-Type") ?? "";
      if (!ct.startsWith("image/")) {
        throw new Error(`Expected image/* Content-Type, got: ${ct}`);
      }
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

/**
 * Generate a video asynchronously via Replicate (Kling V3 Omni).
 * Returns the prediction ID — the result is delivered via webhook callback.
 */
export async function generateVideo(
  options: GenerateVideoOptions
): Promise<GenerateVideoResult> {
  if (shouldMockExternalApis() || !env.REPLICATE_API_TOKEN) {
    return { predictionId: "mock-prediction-id" };
  }

  // Sanitize prompt: strip control characters, limit to Kling V3 max
  const sanitizedPrompt = options.prompt
    .replace(/[\x00-\x1F\x7F]/g, "")
    .slice(0, VIDEO_PROMPT_MAX_LENGTH);

  // Audit log: capture prompt for debugging/review
  console.log("[video-gen] prompt:", sanitizedPrompt.slice(0, 200));

  const replicate = getReplicateClient();
  const prediction = await replicate.predictions.create({
    model: VIDEO_MODEL_DEFAULT,
    input: {
      prompt: sanitizedPrompt,
      aspect_ratio: options.aspectRatio,
      duration: options.duration ?? VIDEO_DURATION_DEFAULT,
      mode: "pro",
      generate_audio: true,
    },
    webhook: options.webhookUrl,
    webhook_events_filter: ["completed"],
  });

  return { predictionId: prediction.id };
}

/**
 * Download a video from Replicate and stream-upload it to S3 via multipart.
 * Uses @aws-sdk/lib-storage Upload for ~16MB memory footprint (8MB parts, queue of 2).
 *
 * @param sourceUrl — URL to the video file (must be on replicate.delivery)
 * @param s3Key    — destination key in S3
 * @returns public URL of the uploaded video
 */
export async function downloadAndUploadVideo(
  sourceUrl: string,
  s3Key: string
): Promise<string> {
  // Validate source URL hostname
  const parsed = new URL(sourceUrl);
  if (!ALLOWED_REPLICATE_HOSTNAMES.has(parsed.hostname)) {
    throw new Error(`Untrusted video source hostname: ${parsed.hostname}`);
  }

  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to download video: HTTP ${response.status}`);
  }

  // Validate Content-Type before streaming to S3
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.startsWith("video/")) {
    throw new Error(`Expected video/* Content-Type, got: ${contentType}`);
  }

  if (!response.body) {
    throw new Error("Video response has no body");
  }

  // Stream the response body to S3 via multipart upload
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Node.js ReadableStream type mismatch with Web Streams API
  const nodeStream = Readable.fromWeb(response.body as any);
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: s3Key,
      Body: nodeStream,
      ContentType: "video/mp4",
    },
    partSize: 8 * 1024 * 1024, // 8MB
    queueSize: 2,
  });

  await upload.done();
  return getPublicUrl(s3Key);
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
