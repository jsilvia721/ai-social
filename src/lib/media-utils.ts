/**
 * Shared media utility functions — pure helpers with no server-side dependencies.
 * Safe to import in both server and client components.
 */

export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);

export function isVideoUrl(url: string): boolean {
  return VIDEO_EXTENSIONS.has(getUrlExtension(url));
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}

/** Extract file extension from a URL, stripping query params. Returns lowercase e.g. ".mp4" */
export function getUrlExtension(url: string): string {
  const pathname = url.split("?")[0];
  return pathname.slice(pathname.lastIndexOf(".")).toLowerCase();
}

/** Check if URL points to a .mov file (needs placeholder, not inline playback) */
export function isMovUrl(url: string): boolean {
  return getUrlExtension(url) === ".mov";
}

/** Extract filename from URL, stripping query params */
export function getFilenameFromUrl(url: string): string {
  const pathname = url.split("?")[0];
  return pathname.split("/").pop() ?? "";
}
