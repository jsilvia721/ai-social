"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Copy, Check, Upload, Calendar, Loader2, Film } from "lucide-react";
import { isVideoUrl, isMovUrl, getFilenameFromUrl } from "@/lib/media-utils";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { reportError } from "@/lib/error-reporter";

type Platform = "TWITTER" | "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE";
type BriefFormat = "TEXT" | "IMAGE" | "CAROUSEL" | "VIDEO";

interface Brief {
  id: string;
  topic: string;
  rationale: string;
  suggestedCaption: string;
  aiImagePrompt: string | null;
  contentGuidance: string | null;
  recommendedFormat: BriefFormat;
  platform: Platform;
  scheduledFor: string;
  businessId: string;
}

interface SocialAccount {
  id: string;
  platform: Platform;
  username: string;
}

const PLATFORM_LABELS: Record<Platform, string> = {
  TWITTER: "Twitter",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
};

const PLATFORM_COLORS: Record<Platform, string> = {
  TWITTER: "text-sky-400",
  INSTAGRAM: "text-pink-500",
  FACEBOOK: "text-blue-500",
  TIKTOK: "text-zinc-100",
  YOUTUBE: "text-red-500",
};

interface FulfillmentPanelProps {
  brief: Brief;
  onClose: () => void;
  onFulfilled: (nextBriefId: string | null) => void;
  onCancelled: () => void;
  onSkip: () => void;
}

export function FulfillmentPanel({
  brief,
  onClose,
  onFulfilled,
  onCancelled,
  onSkip,
}: FulfillmentPanelProps) {
  const [caption, setCaption] = useState(brief.suggestedCaption);
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState(
    new Date(brief.scheduledFor).toISOString().slice(0, 16)
  );
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset form when brief changes
  useEffect(() => {
    setCaption(brief.suggestedCaption);
    setMediaUrls([]);
    setScheduledAt(new Date(brief.scheduledFor).toISOString().slice(0, 16));
    setError(null);
    setSelectedAccountId("");
  }, [brief.id, brief.suggestedCaption, brief.scheduledFor]);

  // Fetch accounts for this business
  useEffect(() => {
    async function fetchAccounts() {
      try {
        const res = await fetch("/api/accounts");
        if (res.ok) {
          const data = await res.json();
          const matching = data.filter(
            (a: SocialAccount) => a.platform === brief.platform
          );
          setAccounts(matching);
          if (matching.length === 1) {
            setSelectedAccountId(matching[0].id);
          }
        }
      } catch {
        // silent
      }
    }
    fetchAccounts();
  }, [brief.platform]);

  const handleCopyPrompt = useCallback(async () => {
    if (!brief.aiImagePrompt) return;
    await navigator.clipboard.writeText(brief.aiImagePrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [brief.aiImagePrompt]);

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files?.length) return;

    setIsUploading(true);
    setError(null);

    try {
      for (const file of Array.from(files)) {
        // Get presigned URL
        const presignRes = await fetch(
          `/api/upload/presigned?mimeType=${encodeURIComponent(file.type)}&fileSize=${file.size}`
        );
        if (!presignRes.ok) {
          const data = await presignRes.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to get upload URL");
        }
        const { uploadUrl, publicUrl } = await presignRes.json();

        // Upload to S3
        const uploadRes = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!uploadRes.ok) throw new Error("Upload failed");

        setMediaUrls((prev) => [...prev, publicUrl]);
      }
    } catch (err) {
      const file = files?.length ? files[0] : undefined;
      reportError(err, {
        url: window.location.href,
        metadata: { type: "UPLOAD", method: "presigned", fileType: file?.type, fileSize: file?.size },
      });
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSubmit() {
    if (!selectedAccountId) {
      setError("Please select a social account");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/briefs/${brief.id}/fulfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          caption,
          mediaUrls,
          scheduledAt: new Date(scheduledAt).toISOString(),
          socialAccountId: selectedAccountId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to schedule post");
      }

      const data = await res.json();
      onFulfilled(data.nextBriefId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to schedule post");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleCancel() {
    setIsCancelling(true);
    try {
      const res = await fetch(`/api/briefs/${brief.id}`, { method: "PATCH" });
      if (res.ok) {
        onCancelled();
      }
    } catch {
      // silent
    } finally {
      setIsCancelling(false);
    }
  }

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 bg-zinc-900 overflow-y-auto md:static md:z-auto md:w-[480px] md:shrink-0 md:border-l md:border-zinc-800">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-zinc-900 border-b border-zinc-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={cn("text-sm font-medium", PLATFORM_COLORS[brief.platform])}>
              {PLATFORM_LABELS[brief.platform]}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-300">
              {brief.recommendedFormat}
            </span>
          </div>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-5 w-5" />
          </button>
        </div>
        <h2 className="text-lg font-semibold text-zinc-100 mt-2">{brief.topic}</h2>
        <p className="text-xs text-zinc-500 mt-1">
          Scheduled for {new Date(brief.scheduledFor).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </p>
      </div>

      <div className="px-6 py-5 space-y-6">
        {/* Rationale */}
        <section>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Why this topic</h3>
          <p className="text-sm text-zinc-300">{brief.rationale}</p>
        </section>

        {/* Content Guidance */}
        {brief.contentGuidance && (
          <section>
            <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Content guidance</h3>
            <p className="text-sm text-zinc-300">{brief.contentGuidance}</p>
          </section>
        )}

        {/* AI Prompt */}
        {brief.aiImagePrompt && (
          <section>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider">AI Image Prompt</h3>
              <button
                onClick={handleCopyPrompt}
                className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300"
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="bg-zinc-800 rounded-lg p-3 text-sm text-zinc-300 font-mono">
              {brief.aiImagePrompt}
            </div>
          </section>
        )}

        {/* Caption */}
        <section>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Caption</h3>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-2 focus:ring-violet-600 resize-none"
          />
        </section>

        {/* Media Upload */}
        <section>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Media</h3>
          {mediaUrls.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {mediaUrls.map((url, i) => (
                <div key={i} className={`relative group ${isVideoUrl(url) ? "w-full" : ""}`}>
                  {isVideoUrl(url) ? (
                    isMovUrl(url) ? (
                      <div className="w-full rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center gap-2 py-6">
                        <Film className="h-5 w-5 text-zinc-500" />
                        <span className="text-xs text-zinc-400">{getFilenameFromUrl(url)}</span>
                      </div>
                    ) : (
                      <video
                        src={url}
                        className="w-full rounded-lg max-h-40 border border-zinc-700"
                        controls
                      />
                    )
                  ) : (
                    <img
                      src={url}
                      alt={`Upload ${i + 1}`}
                      className="h-20 w-20 rounded-lg object-cover border border-zinc-700"
                    />
                  )}
                  <button
                    onClick={() => setMediaUrls((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-zinc-700 text-zinc-300 flex items-center justify-center text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="flex items-center justify-center gap-2 rounded-lg border-2 border-dashed border-zinc-700 px-4 py-6 text-sm text-zinc-400 hover:border-zinc-600 hover:text-zinc-300 cursor-pointer transition-colors">
            {isUploading ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Upload className="h-5 w-5" />
            )}
            {isUploading ? "Uploading..." : "Drop files or click to upload"}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4"
              multiple
              className="hidden"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
          </label>
        </section>

        {/* Social Account */}
        <section>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">Account</h3>
          {accounts.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No {PLATFORM_LABELS[brief.platform]} accounts connected.
            </p>
          ) : accounts.length === 1 ? (
            <p className="text-sm text-zinc-300">@{accounts[0].username}</p>
          ) : (
            <select
              value={selectedAccountId}
              onChange={(e) => setSelectedAccountId(e.target.value)}
              className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-violet-600"
            >
              <option value="">Select account</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  @{a.username}
                </option>
              ))}
            </select>
          )}
        </section>

        {/* Schedule Time */}
        <section>
          <h3 className="text-xs font-medium text-zinc-400 uppercase tracking-wider mb-2">
            <Calendar className="h-3.5 w-3.5 inline mr-1" />
            Schedule time
          </h3>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-violet-600"
          />
        </section>

        {/* Error */}
        {error && (
          <div className="rounded-lg bg-red-900/20 border border-red-900/50 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2 pt-2">
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !caption.trim()}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : null}
            Schedule Post
          </Button>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              onClick={onSkip}
              className="flex-1 text-zinc-400 hover:text-zinc-200"
            >
              Skip
            </Button>
            <Button
              variant="ghost"
              onClick={handleCancel}
              disabled={isCancelling}
              className="flex-1 text-red-400 hover:text-red-300 hover:bg-red-900/20"
            >
              Cancel Brief
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
