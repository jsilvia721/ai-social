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

  // 3. Replace ISO timestamps (2024-01-15T14:30:00.000Z)
  result = result.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z?/g, "<TIMESTAMP>");

  // 4. Replace datetime strings (2024-01-15 14:30:00)
  result = result.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/g, "<TIMESTAMP>");

  // 5. Replace standalone numbers
  result = result.replace(/\b\d+\b/g, "<N>");

  // 6. Strip query strings
  result = result.replace(/\?[^\s]*/g, "");

  // 7. Collapse whitespace and trim
  result = result.replace(/\s+/g, " ").trim();

  return result;
}
