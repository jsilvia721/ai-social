/**
 * Returns a count with the properly pluralized noun.
 * e.g. pluralize(1, "account") => "1 account"
 *      pluralize(2, "account") => "2 accounts"
 *      pluralize(1, "business", "businesses") => "1 business"
 */
export function pluralize(
  count: number,
  singular: string,
  plural?: string
): string {
  const form = count === 1 ? singular : (plural ?? `${singular}s`);
  return `${count} ${form}`;
}
