"use client";

import { cn } from "@/lib/utils";

type Platform = "TWITTER" | "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE";
type BriefFormat = "TEXT" | "IMAGE" | "CAROUSEL" | "VIDEO";
type BriefStatus = "PENDING" | "FULFILLED" | "EXPIRED" | "CANCELLED";

interface Brief {
  id: string;
  topic: string;
  platform: Platform;
  recommendedFormat: BriefFormat;
  scheduledFor: string;
  status: BriefStatus;
  suggestedCaption: string;
}

const PLATFORM_COLORS: Record<Platform, string> = {
  TWITTER: "text-sky-400",
  INSTAGRAM: "text-pink-500",
  FACEBOOK: "text-blue-500",
  TIKTOK: "text-zinc-100",
  YOUTUBE: "text-red-500",
};

const PLATFORM_LABELS: Record<Platform, string> = {
  TWITTER: "Twitter",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
  TIKTOK: "TikTok",
  YOUTUBE: "YouTube",
};

const FORMAT_BADGE: Record<BriefFormat, { label: string; className: string }> = {
  TEXT: { label: "Text", className: "bg-zinc-700 text-zinc-300" },
  IMAGE: { label: "Image", className: "bg-violet-900/50 text-violet-300" },
  CAROUSEL: { label: "Carousel", className: "bg-amber-900/50 text-amber-300" },
  VIDEO: { label: "Video", className: "bg-red-900/50 text-red-300" },
};

const STATUS_BADGE: Record<BriefStatus, { label: string; className: string }> = {
  PENDING: { label: "Pending", className: "bg-amber-900/50 text-amber-300" },
  FULFILLED: { label: "Fulfilled", className: "bg-emerald-900/50 text-emerald-300" },
  EXPIRED: { label: "Expired", className: "bg-zinc-700 text-zinc-400" },
  CANCELLED: { label: "Cancelled", className: "bg-zinc-700 text-zinc-400" },
};

function getUrgency(scheduledFor: string): { label: string; className: string } | null {
  const now = new Date();
  const due = new Date(scheduledFor);
  const diffMs = due.getTime() - now.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) return { label: "Overdue", className: "text-red-400" };
  if (diffDays === 0) return { label: "Due today", className: "text-amber-400" };
  if (diffDays === 1) return { label: "Due tomorrow", className: "text-amber-300" };
  if (diffDays <= 3) return { label: `${diffDays} days`, className: "text-zinc-400" };
  return null;
}

interface QueueItemProps {
  brief: Brief;
  isSelected: boolean;
  onClick: () => void;
}

export function QueueItem({ brief, isSelected, onClick }: QueueItemProps) {
  const urgency = brief.status === "PENDING" ? getUrgency(brief.scheduledFor) : null;
  const format = FORMAT_BADGE[brief.recommendedFormat];
  const status = STATUS_BADGE[brief.status];

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-lg border p-4 transition-colors",
        isSelected
          ? "border-violet-600 bg-violet-900/10"
          : "border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-800/50"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={cn("text-xs font-medium", PLATFORM_COLORS[brief.platform])}>
              {PLATFORM_LABELS[brief.platform]}
            </span>
            <span className={cn("text-xs px-1.5 py-0.5 rounded", format.className)}>
              {format.label}
            </span>
            {brief.status !== "PENDING" && (
              <span className={cn("text-xs px-1.5 py-0.5 rounded", status.className)}>
                {status.label}
              </span>
            )}
          </div>
          <h3 className="text-sm font-medium text-zinc-200 truncate">{brief.topic}</h3>
          <p className="text-xs text-zinc-500 mt-0.5 truncate">
            {brief.suggestedCaption.slice(0, 80)}
            {brief.suggestedCaption.length > 80 ? "..." : ""}
          </p>
        </div>
        <div className="text-right shrink-0">
          {urgency && (
            <span className={cn("text-xs font-medium", urgency.className)}>
              {urgency.label}
            </span>
          )}
          <p className="text-xs text-zinc-600 mt-0.5">
            {new Date(brief.scheduledFor).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </p>
        </div>
      </div>
    </button>
  );
}
