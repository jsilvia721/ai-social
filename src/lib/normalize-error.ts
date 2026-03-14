/**
 * Normalizes error messages by replacing dynamic values (IDs, timestamps, numbers,
 * query strings) with placeholders. Used for fingerprinting and deduplication so
 * that errors differing only in dynamic values are grouped together.
 *
 * The raw message is still stored in the DB; only the fingerprint changes.
 */
export function normalizeMessage(msg: string): string {
  let result = msg;

  // 1. Replace UUIDs
  result = result.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    "<UUID>"
  );

  // 2. Replace CUIDs/nanoids (lowercase letter followed by 24+ lowercase alphanumeric chars)
  result = result.replace(/\b[a-z][a-z0-9]{24,}\b/g, "<ID>");

  // 3. Replace compound hyphenated IDs (e.g. seed-blotato-post-1772985511806-xa5g)
  // Matches: one or more word-prefix segments, a pure digit segment, and a short (≤8) alphanumeric suffix
  result = result.replace(
    /\b([a-zA-Z][a-zA-Z0-9]*-)+\d+-[a-zA-Z0-9]{1,8}\b/g,
    "<COMPOUND_ID>"
  );

  // 4. Replace ISO timestamps (2024-01-15T14:30:00.000Z)
  result = result.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<TIMESTAMP>");

  // 5. Replace datetime strings (2024-01-15 14:30:00)
  result = result.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "<TIMESTAMP>");

  // 6. Replace standalone numbers
  result = result.replace(/\b\d+\b/g, "<N>");

  // 7. Strip query strings
  result = result.replace(/\?[^\s]*/g, "");

  // 8. Collapse whitespace and trim
  result = result.replace(/\s+/g, " ").trim();

  return result;
}
