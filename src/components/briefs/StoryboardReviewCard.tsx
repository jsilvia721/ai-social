"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PLATFORM_COLORS, PLATFORM_LABELS } from "@/lib/platforms";
import type { Platform } from "@/types";

type StoryboardStatus = "STORYBOARD_REVIEW" | "RENDERING";

export interface StoryboardBrief {
  id: string;
  topic: string;
  platform: Platform;
  scheduledFor: string;
  videoScript?: string | null;
  videoPrompt?: string | null;
  storyboardImageUrl?: string | null;
  status: StoryboardStatus;
  updatedAt: string;
}

function formatElapsed(updatedAt: string): string {
  const diffMs = Date.now() - new Date(updatedAt).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

interface StoryboardReviewCardProps {
  brief: StoryboardBrief;
  onStatusChange: (briefId: string, newStatus: "RENDERING" | "REMOVED") => void;
}

export function StoryboardReviewCard({ brief, onStatusChange }: StoryboardReviewCardProps) {
  const [editedPrompt, setEditedPrompt] = useState(brief.videoPrompt ?? "");
  const [isApproving, setIsApproving] = useState(false);
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isReview = brief.status === "STORYBOARD_REVIEW";
  const isRendering = brief.status === "RENDERING";

  async function handleApprove() {
    setIsApproving(true);
    setError(null);
    try {
      const res = await fetch(`/api/briefs/${brief.id}/approve-storyboard`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoPrompt: editedPrompt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to approve");
      }
      onStatusChange(brief.id, "RENDERING");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve");
      setIsApproving(false);
    }
  }

  async function handleReject() {
    setIsRejecting(true);
    setError(null);
    try {
      const res = await fetch(`/api/briefs/${brief.id}/reject-storyboard`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to reject");
      }
      onStatusChange(brief.id, "REMOVED");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject");
      setIsRejecting(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex flex-col sm:flex-row gap-4">
        {/* Thumbnail */}
        <div className="w-full sm:w-48 shrink-0">
          {brief.storyboardImageUrl ? (
            <div className="relative">
              <img
                src={brief.storyboardImageUrl}
                alt={`Storyboard for ${brief.topic}`}
                className="w-full rounded-md object-cover aspect-video"
              />
              {isRendering && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 rounded-md">
                  <div className="animate-pulse text-sm font-medium text-violet-300">
                    Rendering...
                  </div>
                  <div className="text-xs text-zinc-400 mt-1">
                    {formatElapsed(brief.updatedAt)}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="w-full rounded-md bg-zinc-800 aspect-video flex items-center justify-center">
              <span className="text-xs text-zinc-500">No thumbnail</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header: platform badge + date */}
          <div className="flex items-center gap-2 mb-2">
            <span className={cn("text-xs font-medium", PLATFORM_COLORS[brief.platform])}>
              {PLATFORM_LABELS[brief.platform]}
            </span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/50 text-red-300">
              Video
            </span>
            <span className="text-xs text-zinc-500">
              {new Date(brief.scheduledFor).toLocaleDateString("en-US", {
                weekday: "short",
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>

          {/* Topic */}
          <h3 className="text-sm font-medium text-zinc-200 mb-2">{brief.topic}</h3>

          {/* Video script */}
          {brief.videoScript && (
            <div className="mb-3">
              <label className="text-xs font-medium text-zinc-400 block mb-1">Script</label>
              <p className="text-sm text-zinc-300 whitespace-pre-wrap">{brief.videoScript}</p>
            </div>
          )}

          {/* Editable video prompt */}
          {isReview && (
            <div className="mb-3">
              <label className="text-xs font-medium text-zinc-400 block mb-1">
                Video Prompt
              </label>
              <textarea
                value={editedPrompt}
                onChange={(e) => setEditedPrompt(e.target.value)}
                rows={3}
                className="w-full rounded-md bg-zinc-800 border border-zinc-700 text-sm text-zinc-200 p-2 focus:outline-none focus:border-violet-600 resize-y"
              />
            </div>
          )}

          {/* Rendering overlay info (when no thumbnail) */}
          {isRendering && !brief.storyboardImageUrl && (
            <div className="mb-3">
              <span className="text-sm text-violet-300 animate-pulse">Rendering...</span>
              <span className="text-xs text-zinc-400 ml-2">{formatElapsed(brief.updatedAt)}</span>
            </div>
          )}

          {/* Error display */}
          {error && (
            <p className="text-sm text-red-400 mb-2">{error}</p>
          )}

          {/* Actions */}
          {isReview && (
            <div className="flex gap-2">
              <button
                onClick={handleApprove}
                disabled={isApproving || isRejecting}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                  isApproving
                    ? "bg-violet-700/50 text-violet-300 cursor-wait"
                    : "bg-violet-600 text-white hover:bg-violet-500"
                )}
              >
                {isApproving ? "Approving..." : "Approve"}
              </button>
              <button
                onClick={handleReject}
                disabled={isApproving || isRejecting}
                className={cn(
                  "px-4 py-2 text-sm font-medium rounded-md transition-colors",
                  isRejecting
                    ? "bg-zinc-700/50 text-zinc-400 cursor-wait"
                    : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                )}
              >
                {isRejecting ? "Rejecting..." : "Reject"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
