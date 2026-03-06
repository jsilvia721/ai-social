import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { env } from "@/env";

function getKey(): Buffer {
  return Buffer.from(env.TOKEN_ENCRYPTION_KEY, "hex");
}

/**
 * Encrypts a plaintext token using AES-256-GCM.
 * Output format: base64url(iv):base64url(ciphertext):base64url(authTag)
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12); // 96-bit IV recommended for GCM
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}:${encrypted.toString("base64url")}:${tag.toString("base64url")}`;
}

/**
 * Decrypts a token encrypted by encryptToken.
 * If the value doesn't match the encrypted format (legacy plaintext), returns it as-is.
 * This allows gradual migration: old plaintext tokens continue to work until refreshed.
 */
export function decryptToken(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) return ciphertext; // legacy plaintext — not yet encrypted

  const [ivB64, encB64, tagB64] = parts;
  try {
    const key = getKey();
    const iv = Buffer.from(ivB64, "base64url");
    const encrypted = Buffer.from(encB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    // Decryption failed — likely a legacy plaintext token that happens to contain colons
    return ciphertext;
  }
}
