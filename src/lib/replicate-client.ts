/**
 * Shared Replicate client — lazy-initialized singleton.
 *
 * Used by media.ts (image generation) and fulfillment.ts (prediction polling).
 */

import Replicate from "replicate";
import { env } from "@/env";

let _replicate: Replicate | null = null;

export function getReplicateClient(): Replicate {
  if (!_replicate) {
    _replicate = new Replicate({ auth: env.REPLICATE_API_TOKEN });
  }
  return _replicate;
}
