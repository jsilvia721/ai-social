/**
 * Shared media utility functions — pure helpers with no server-side dependencies.
 * Safe to import in both server and client components.
 */

export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);

export function isVideoUrl(url: string): boolean {
  // Strip query params before extracting extension
  const pathname = url.split("?")[0];
  const ext = pathname.slice(pathname.lastIndexOf(".")).toLowerCase();
  return VIDEO_EXTENSIONS.has(ext);
}

export function isVideoFile(file: File): boolean {
  return file.type.startsWith("video/");
}
