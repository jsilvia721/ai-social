"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Save, Clock, Image as ImageIcon, Film } from "lucide-react";
import { cn } from "@/lib/utils";
import { isVideoUrl } from "@/lib/media-utils";
import type { Platform } from "@/types";

const PLATFORM_COLORS: Record<Platform, string> = {
  TWITTER: "bg-sky-400/10 text-sky-400 border-sky-400/20",
  INSTAGRAM: "bg-pink-500/10 text-pink-500 border-pink-500/20",
  FACEBOOK: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  TIKTOK: "bg-zinc-100/10 text-zinc-100 border-zinc-100/20",
  YOUTUBE: "bg-red-500/10 text-red-500 border-red-500/20",
};

export interface ReviewPost {
  id: string;
  content: string;
  mediaUrls: string[];
  status: string;
  scheduledAt: string | null;
  reviewWindowExpiresAt: string | null;
  briefId: string | null;
  socialAccount: { platform: Platform; username: string };
  contentBrief: { id: string; topic: string; recommendedFormat: string } | null;
}

type ActiveOp = "idle" | "approving" | "rejecting" | "saving";

function formatDuration(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function ReviewCard({ post }: { post: ReviewPost }) {
  const router = useRouter();
  const [activeOp, setActiveOp] = useState<ActiveOp>("idle");
  const [editedContent, setEditedContent] = useState(post.content);
  const [countdownText, setCountdownText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isBusy = activeOp !== "idle";
  const isEdited = editedContent !== post.content;

  // Countdown timer for auto-approval
  useEffect(() => {
    if (!post.reviewWindowExpiresAt) return;

    const remaining = new Date(post.reviewWindowExpiresAt).getTime() - Date.now();
    if (remaining <= 0) {
      setCountdownText("Auto-approving...");
      router.refresh();
      return;
    }
    setCountdownText(formatDuration(remaining));

    const id = setInterval(() => {
      const r = new Date(post.reviewWindowExpiresAt!).getTime() - Date.now();
      if (r <= 0) {
        setCountdownText("Auto-approving...");
        clearInterval(id);
        router.refresh();
        return;
      }
      setCountdownText(formatDuration(r));
    }, 60_000);
    return () => clearInterval(id);
  }, [post.reviewWindowExpiresAt, router]);

  async function handleApprove() {
    if (isBusy) return;
    setActiveOp("approving");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}/approve`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to approve");
      }
    } catch {
      setError("Network error");
    } finally {
      setActiveOp("idle");
      router.refresh();
    }
  }

  async function handleReject() {
    if (isBusy) return;
    setActiveOp("rejecting");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}/reject`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to reject");
      }
    } catch {
      setError("Network error");
    } finally {
      setActiveOp("idle");
      router.refresh();
    }
  }

  async function handleSaveEdit() {
    if (isBusy) return;
    setActiveOp("saving");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editedContent }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }
      const data = await res.json();
      if (data.status !== "PENDING_REVIEW") {
        setError("This post was auto-approved while you were editing.");
      }
    } catch {
      setError("Network error");
    } finally {
      setActiveOp("idle");
      router.refresh();
    }
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 sm:p-5">
      {/* Header: platform + timing */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium w-fit",
            PLATFORM_COLORS[post.socialAccount.platform]
          )}
        >
          {post.socialAccount.platform}
          <span className="text-zinc-500">@{post.socialAccount.username}</span>
        </span>

        {post.scheduledAt && (
          <span className="text-xs text-zinc-500">
            Scheduled: {new Date(post.scheduledAt).toLocaleDateString()} at{" "}
            {new Date(post.scheduledAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </span>
        )}

        {countdownText && (
          <span className="flex items-center gap-1 text-xs text-amber-400">
            <Clock className="h-3 w-3" />
            Auto-approves in {countdownText}
          </span>
        )}

        {!post.reviewWindowExpiresAt && (
          <span className="text-xs text-zinc-500">Manual approval required</span>
        )}
      </div>

      {/* Brief topic */}
      {post.contentBrief && (
        <p className="text-xs text-zinc-500 mb-2">
          Topic: {post.contentBrief.topic} &middot; Format: {post.contentBrief.recommendedFormat}
        </p>
      )}

      {/* Content (editable) */}
      <textarea
        value={editedContent}
        onChange={(e) => setEditedContent(e.target.value)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 resize-y min-h-[80px] focus:outline-none focus:ring-1 focus:ring-violet-500 focus:border-violet-500"
        rows={3}
      />

      {/* Media preview */}
      {post.mediaUrls.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto flex-wrap">
          {post.mediaUrls.map((url, i) =>
            isVideoUrl(url) ? (
              <div key={i} className="w-full shrink-0">
                {url.endsWith(".mov") ? (
                  <div className="w-full rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center gap-2 py-6">
                    <Film className="h-5 w-5 text-zinc-500" />
                    <span className="text-xs text-zinc-400">{url.split("/").pop()}</span>
                  </div>
                ) : (
                  <video
                    src={url}
                    className="w-full rounded-lg max-h-40 border border-zinc-700"
                    controls
                  />
                )}
              </div>
            ) : (
              <img
                key={i}
                src={url}
                alt={`Media ${i + 1}`}
                className="h-20 w-20 rounded-lg object-cover border border-zinc-700 shrink-0"
              />
            )
          )}
        </div>
      ) : (
        <div className="mt-3 flex items-center gap-2 text-xs text-zinc-600">
          <ImageIcon className="h-3.5 w-3.5" />
          No media attached
        </div>
      )}

      {/* Error message */}
      {error && (
        <p className="mt-2 text-xs text-red-400">{error}</p>
      )}

      {/* Actions */}
      <div className="mt-4 flex flex-col sm:flex-row gap-2">
        <button
          onClick={handleApprove}
          disabled={isBusy}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            "bg-emerald-600 hover:bg-emerald-500 text-white",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <Check className="h-4 w-4" />
          {activeOp === "approving" ? "Approving..." : "Approve"}
        </button>

        <button
          onClick={handleReject}
          disabled={isBusy}
          className={cn(
            "flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
            "bg-red-600/10 hover:bg-red-600/20 text-red-400 border border-red-600/20",
            "disabled:opacity-50 disabled:cursor-not-allowed"
          )}
        >
          <X className="h-4 w-4" />
          {activeOp === "rejecting" ? "Rejecting..." : "Reject"}
        </button>

        {isEdited && (
          <button
            onClick={handleSaveEdit}
            disabled={isBusy}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
              "bg-violet-600 hover:bg-violet-500 text-white",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            <Save className="h-4 w-4" />
            {activeOp === "saving" ? "Saving..." : "Save Edit"}
          </button>
        )}
      </div>
    </div>
  );
}
