"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, Loader2, Send, Clock, ImageIcon, Upload, X, Film, Copy, Wand2 } from "lucide-react";
import type { Platform } from "@/types";
import { reportError } from "@/lib/error-reporter";
import { isVideoUrl, isVideoFile, isMovUrl, getFilenameFromUrl, VIDEO_EXTENSIONS } from "@/lib/media-utils";

const CHAR_LIMITS: Partial<Record<Platform, number>> = {
  TWITTER: 280,
};

const PLATFORM_LABELS: Record<Platform, string> = {
  TWITTER: "Twitter / X",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
};

const VIDEO_PUBLISHING_PLATFORMS = new Set<Platform>(["TWITTER", "INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"]);

const UPLOAD_TIMEOUT_MS = 300_000; // 5 minutes
const UPLOAD_MAX_RETRIES = 1;

/** Format a Date as YYYY-MM-DDTHH:mm in local time (for datetime-local inputs). */
function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

interface Account {
  id: string;
  platform: Platform;
  username: string;
}

interface EditPostData {
  id: string;
  content: string;
  socialAccountId: string;
  platform: Platform;
  username: string;
  scheduledAt: string | null;
  mediaUrls: string[];
  coverImageUrl?: string | null;
}

export function PostComposer({ editPost, defaultScheduledAt }: { editPost?: EditPostData; defaultScheduledAt?: string }) {
  const isEditMode = !!editPost;
  const router = useRouter();
  const { data: session } = useSession();
  const activeBusinessId = (session?.user as { id: string; activeBusinessId?: string | null })
    ?.activeBusinessId;
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState(editPost?.socialAccountId ?? "");
  const [content, setContent] = useState(editPost?.content ?? "");
  const [aiTopic, setAiTopic] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"draft" | "schedule" | "now">(
    editPost?.scheduledAt || defaultScheduledAt ? "schedule" : "draft"
  );
  const [scheduledAt, setScheduledAt] = useState(
    editPost?.scheduledAt
      ? toLocalDatetimeString(new Date(editPost.scheduledAt))
      : defaultScheduledAt ?? ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRepurposing, setIsRepurposing] = useState(false);
  const repurposeInFlight = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [mediaUrls, setMediaUrls] = useState<string[]>(editPost?.mediaUrls ?? []);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [imagePrompt, setImagePrompt] = useState("");
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(editPost?.coverImageUrl ?? null);
  const [isUploadingCover, setIsUploadingCover] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const imageAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isEditMode) return; // don't fetch accounts in edit mode
    const url = activeBusinessId
      ? `/api/accounts?businessId=${activeBusinessId}`
      : "/api/accounts";
    fetch(url)
      .then((res) => res.json())
      .then((data) => setAccounts(data))
      .catch(() => {});
  }, [isEditMode, activeBusinessId]);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const charLimit = selectedAccount ? CHAR_LIMITS[selectedAccount.platform] : undefined;
  const charCount = content.length;
  const isOverLimit = charLimit !== undefined && charCount > charLimit;
  const selectedPlatform = isEditMode ? editPost.platform : selectedAccount?.platform;
  const videoSupported = !selectedPlatform || VIDEO_PUBLISHING_PLATFORMS.has(selectedPlatform);
  const hasVideo = mediaUrls.some(isVideoUrl);

  async function handleGenerate() {
    if (!aiTopic.trim()) return;
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: aiTopic,
          platform: selectedAccount?.platform ?? "TWITTER",
        }),
      });
      if (!res.ok) throw new Error("Generation failed");
      const data = await res.json();
      setContent(data.content);
    } catch {
      setError("Failed to generate content. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleRepurpose() {
    if (repurposeInFlight.current || !content.trim()) return;
    repurposeInFlight.current = true;
    setIsRepurposing(true);
    setError(null);
    try {
      const res = await fetch("/api/posts/repurpose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceContent: content.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Repurposing failed");
      }
      const { repurposeGroupId } = await res.json();
      router.push(`/dashboard/posts/repurpose/${repurposeGroupId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Repurposing failed.");
      setIsRepurposing(false);
      repurposeInFlight.current = false;
    }
  }

  function uploadViaPresigned(file: File): Promise<string> {

    async function attemptUpload(retryCount: number): Promise<string> {
      const res = await fetch(
        `/api/upload/presigned?mimeType=${encodeURIComponent(file.type)}&fileSize=${file.size}`
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Failed to get upload URL");
      }
      const { uploadUrl, publicUrl } = await res.json();

      return new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhrRef.current = xhr;
        xhr.timeout = UPLOAD_TIMEOUT_MS;

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          xhrRef.current = null;
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve(publicUrl);
          } else if (xhr.status >= 500) {
            // S3 5xx errors (e.g. 503 SlowDown) are transient — retry
            handleRetriableError(`Upload to storage failed (status ${xhr.status})`);
          } else {
            reject(new Error(`Upload to storage failed (status ${xhr.status})`));
          }
        };

        function handleRetriableError(errorMsg: string) {
          xhrRef.current = null;
          if (retryCount < UPLOAD_MAX_RETRIES) {
            setUploadProgress(null);
            resolve(attemptUpload(retryCount + 1));
          } else {
            reject(new Error(errorMsg));
          }
        }

        xhr.onerror = () => {
          handleRetriableError("Upload failed — check your connection and try again");
        };

        xhr.ontimeout = () => {
          handleRetriableError("Upload timed out — try a smaller file or check your connection");
        };

        xhr.onabort = () => {
          xhrRef.current = null;
          reject(new Error("Upload cancelled"));
        };

        xhr.open("PUT", uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type);
        xhr.send(file);
      });
    }

    return attemptUpload(0);
  }

  function abortUpload() {
    if (xhrRef.current) {
      xhrRef.current.abort();
    }
  }

  async function handleGenerateImage() {
    if (!imagePrompt.trim() || !activeBusinessId) return;
    setIsGeneratingImage(true);
    setError(null);
    const controller = new AbortController();
    imageAbortRef.current = controller;
    try {
      const res = await fetch("/api/ai/generate-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: imagePrompt.trim(), businessId: activeBusinessId }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Image generation failed");
      }
      const { url } = await res.json();
      setMediaUrls((prev) => {
        const images = prev.filter((u) => !isVideoUrl(u));
        if (images.length >= 4) return prev; // respect limit
        return [...prev, url];
      });
      setImagePrompt("");
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      reportError(err, { url: window.location.href, metadata: { type: "IMAGE_GENERATION" } });
      setError(err instanceof Error ? err.message : "Image generation failed.");
    } finally {
      setIsGeneratingImage(false);
      imageAbortRef.current = null;
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const videos = files.filter(isVideoFile);
    const images = files.filter((f) => !isVideoFile(f));

    // Mutual exclusion: video and images can't coexist
    if (videos.length > 0 && images.length > 0) {
      setError("You can attach either images or a video, not both.");
      return;
    }

    if (videos.length > 1) {
      setError("You can attach at most 1 video.");
      return;
    }

    if (videos.length > 0 && mediaUrls.length > 0 && !mediaUrls.every(isVideoUrl)) {
      setError("Remove existing images before adding a video.");
      return;
    }

    if (images.length > 0 && hasVideo) {
      setError("Remove the existing video before adding images.");
      return;
    }

    if (images.length + mediaUrls.length > 4) {
      setError("You can attach at most 4 images.");
      return;
    }

    setIsUploading(true);
    setError(null);
    setUploadProgress(null);
    try {
      if (videos.length === 1) {
        // Video: use presigned URL with progress tracking
        const url = await uploadViaPresigned(videos[0]);
        // Clear any existing images (mutual exclusion)
        setMediaUrls([url]);
        setUploadProgress(null);
      } else {
        // Images: use server-side upload
        const uploaded: string[] = [];
        for (const file of images) {
          const fd = new FormData();
          fd.append("file", file);
          const res = await fetch("/api/upload", { method: "POST", body: fd });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error ?? "Upload failed");
          }
          const { url } = await res.json();
          uploaded.push(url);
        }
        // Clear any existing video (mutual exclusion)
        setMediaUrls((prev) => {
          const existing = prev.filter((u) => !isVideoUrl(u));
          return [...existing, ...uploaded];
        });
      }
    } catch (err) {
      setUploadProgress(null);
      if (err instanceof Error && err.message === "Upload cancelled") {
        // Don't show error for intentional cancellation
      } else {
        const file = files[0];
        const method = videos.length > 0 ? "presigned" : "server";
        reportError(err, {
          url: window.location.href,
          metadata: { type: "UPLOAD", method, fileType: file?.type, fileSize: file?.size },
        });
        setError(err instanceof Error ? err.message : "Upload failed.");
      }
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeMedia(index: number) {
    setMediaUrls((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleCoverImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingCover(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Cover image upload failed");
      }
      const { url } = await res.json();
      setCoverImageUrl(url);
    } catch (err) {
      reportError(err, {
        url: window.location.href,
        metadata: { type: "UPLOAD", method: "server", fileType: file.type, fileSize: file.size },
      });
      setError(err instanceof Error ? err.message : "Cover image upload failed.");
    } finally {
      setIsUploadingCover(false);
      if (coverInputRef.current) coverInputRef.current.value = "";
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAccountId || !content.trim() || isOverLimit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        content: content.trim(),
        socialAccountId: selectedAccountId,
        mediaUrls,
        ...(activeBusinessId ? { businessId: activeBusinessId } : {}),
        ...(selectedPlatform === "INSTAGRAM" && hasVideo ? { coverImageUrl } : {}),
      };

      if (scheduleMode === "now") {
        body.scheduledAt = new Date().toISOString();
      } else if (scheduleMode === "schedule" && scheduledAt) {
        body.scheduledAt = new Date(scheduledAt).toISOString();
      }

      const res = await fetch(
        isEditMode ? `/api/posts/${editPost.id}` : "/api/posts",
        {
          method: isEditMode ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create post");
      }

      router.push("/dashboard/posts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create post.");
      setIsSubmitting(false);
    }
  }

  const fileAccept = videoSupported
    ? "image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm"
    : "image/jpeg,image/png,image/gif,image/webp";

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Account select */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-300">Social Account</label>
        {isEditMode ? (
          <p className="text-sm text-zinc-400 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2">
            {PLATFORM_LABELS[editPost.platform]} · @{editPost.username}
          </p>
        ) : accounts.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No accounts connected.{" "}
            <a href="/dashboard/accounts" className="text-violet-400 hover:underline">
              Connect one first.
            </a>
          </p>
        ) : (
          <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200">
              <SelectValue placeholder="Select an account…" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              {accounts.map((account) => (
                <SelectItem
                  key={account.id}
                  value={account.id}
                  className="text-zinc-200 focus:bg-zinc-700"
                >
                  {PLATFORM_LABELS[account.platform]} · @{account.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Content */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-zinc-300">Content</label>
          {charLimit && (
            <span className={`text-xs ${isOverLimit ? "text-red-400" : "text-zinc-500"}`}>
              {charCount} / {charLimit}
            </span>
          )}
        </div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What do you want to say?"
          rows={5}
          className={`bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 resize-none ${
            isOverLimit ? "border-red-700 focus-visible:ring-red-700" : ""
          }`}
        />
      </div>

      {/* hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={fileAccept}
        multiple
        className="hidden"
        onChange={handleFileSelect}
      />
      <input
        ref={coverInputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleCoverImageSelect}
      />

      {/* Media */}
      <Card className="bg-zinc-900 border-zinc-700">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-zinc-400" />
              <span className="text-sm font-medium text-zinc-300">Media</span>
              {!videoSupported && selectedPlatform && (
                <span className="text-xs text-zinc-500">(images only — video not yet supported for {PLATFORM_LABELS[selectedPlatform]})</span>
              )}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading || (mediaUrls.length >= 4 && !hasVideo)}
              className="border-zinc-600 text-zinc-300 hover:bg-zinc-800"
            >
              {isUploading ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <Upload className="h-3 w-3 mr-1" />
              )}
              {isUploading ? "Uploading…" : "Add media"}
            </Button>
          </div>

          {/* AI Image Generation */}
          <div className="flex gap-2">
            <Input
              value={imagePrompt}
              onChange={(e) => setImagePrompt(e.target.value)}
              placeholder="Describe an image to generate…"
              className="bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-600"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleGenerateImage();
                }
              }}
              disabled={isGeneratingImage || isUploading}
            />
            {isGeneratingImage ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => imageAbortRef.current?.abort()}
                className="border-red-700 text-red-400 hover:bg-red-950 shrink-0"
              >
                <X className="h-3 w-3 mr-1" />
                Cancel
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={handleGenerateImage}
                disabled={!imagePrompt.trim() || !activeBusinessId || isUploading || (mediaUrls.length >= 4 && !hasVideo)}
                className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
              >
                <Wand2 className="h-3 w-3 mr-1" />
                Generate
              </Button>
            )}
          </div>

          {/* Upload progress bar */}
          {isUploading && uploadProgress !== null && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Uploading video… {uploadProgress}%</span>
                <button
                  type="button"
                  onClick={abortUpload}
                  className="text-red-400 hover:text-red-300"
                >
                  Cancel
                </button>
              </div>
              <div className="w-full bg-zinc-700 rounded-full h-1.5">
                <div
                  className="bg-violet-500 h-1.5 rounded-full transition-all duration-200"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
            </div>
          )}

          {mediaUrls.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {mediaUrls.map((url, i) =>
                isVideoUrl(url) ? (
                  <div key={i} className="relative group col-span-2">
                    {isMovUrl(url) ? (
                      <div className="w-full rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center gap-2 py-8">
                        <Film className="h-6 w-6 text-zinc-500" />
                        <span className="text-sm text-zinc-400">
                          {getFilenameFromUrl(url)}
                        </span>
                      </div>
                    ) : (
                      <video
                        src={url}
                        className="w-full rounded-md object-cover max-h-48"
                        controls
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => removeMedia(i)}
                      className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ) : (
                  <div key={i} className="relative group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={url}
                      alt={`media ${i + 1}`}
                      className="w-full rounded-md object-cover max-h-40"
                    />
                    <button
                      type="button"
                      onClick={() => removeMedia(i)}
                      className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                )
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cover Image (Instagram + video only) */}
      {selectedPlatform === "INSTAGRAM" && hasVideo && (
        <Card className="bg-zinc-900 border-zinc-700">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-zinc-400" />
                <span className="text-sm font-medium text-zinc-300">Cover image</span>
              </div>
              {!coverImageUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => coverInputRef.current?.click()}
                  disabled={isUploadingCover}
                  className="border-zinc-600 text-zinc-300 hover:bg-zinc-800"
                >
                  {isUploadingCover ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Upload className="h-3 w-3 mr-1" />
                  )}
                  {isUploadingCover ? "Uploading…" : "Upload cover"}
                </Button>
              )}
            </div>
            {coverImageUrl && (
              <div className="relative group w-full sm:w-48">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={coverImageUrl}
                  alt="Cover image preview"
                  className="w-full rounded-md object-cover max-h-40"
                />
                <button
                  type="button"
                  aria-label="Remove cover image"
                  onClick={() => setCoverImageUrl(null)}
                  className="absolute top-1 right-1 bg-black/60 rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              </div>
            )}
            {!coverImageUrl && (
              <p className="text-xs text-zinc-500">
                Optional thumbnail image displayed as the Reel cover.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* AI Generate */}
      <Card className="bg-zinc-900 border-zinc-700">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-medium text-zinc-300">AI Generate</span>
          </div>
          <div className="flex gap-2">
            <Input
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              placeholder="Enter a topic or idea…"
              className="bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-600"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={!aiTopic.trim() || isGenerating}
              className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span className="ml-2">{isGenerating ? "Generating…" : "Generate"}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Repurpose to all platforms */}
      {!isEditMode && content.trim() && (
        <Card className="bg-zinc-900 border-zinc-700">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Copy className="h-4 w-4 text-violet-400" />
                <span className="text-sm font-medium text-zinc-300">Repurpose</span>
              </div>
              <Button
                type="button"
                onClick={handleRepurpose}
                disabled={isRepurposing || !content.trim()}
                className="bg-violet-600 hover:bg-violet-700 text-white"
                size="sm"
              >
                {isRepurposing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Copy className="h-4 w-4 mr-2" />
                )}
                {isRepurposing ? "Creating variants…" : "Repurpose to all platforms"}
              </Button>
            </div>
            <p className="text-xs text-zinc-500">
              Generate platform-native variants of your content for all connected accounts.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Schedule toggle */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-zinc-300">Timing</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setScheduleMode("draft")}
            className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
              scheduleMode === "draft"
                ? "border-violet-600 bg-violet-600/10 text-violet-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
            }`}
          >
            <Send className="h-4 w-4 inline-block mr-2 -mt-0.5" />
            Draft
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode("schedule")}
            className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
              scheduleMode === "schedule"
                ? "border-violet-600 bg-violet-600/10 text-violet-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
            }`}
          >
            <Clock className="h-4 w-4 inline-block mr-2 -mt-0.5" />
            Schedule
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode("now")}
            className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
              scheduleMode === "now"
                ? "border-violet-600 bg-violet-600/10 text-violet-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
            }`}
          >
            <Send className="h-4 w-4 inline-block mr-2 -mt-0.5" />
            Post Now
          </button>
        </div>

        {scheduleMode === "schedule" && (
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            min={toLocalDatetimeString(new Date())}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-violet-600"
            required={scheduleMode === "schedule"}
          />
        )}
      </div>

      {/* Submit */}
      <Button
        type="submit"
        disabled={!selectedAccountId || !content.trim() || isOverLimit || isSubmitting || isUploading}
        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            {scheduleMode === "now" ? "Posting…" : "Saving…"}
          </>
        ) : scheduleMode === "schedule" ? (
          <>
            <Clock className="h-4 w-4 mr-2" />
            Schedule Post
          </>
        ) : scheduleMode === "now" ? (
          <>
            <Send className="h-4 w-4 mr-2" />
            Post Now
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            Save Draft
          </>
        )}
      </Button>
    </form>
  );
}
