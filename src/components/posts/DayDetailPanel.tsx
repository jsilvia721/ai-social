"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { X, PenSquare, Calendar, CheckCircle2, XCircle, FileText, Clock, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Platform, PostStatus } from "@/types";

const STATUS_CONFIG: Record<PostStatus, { label: string; icon: React.ElementType; className: string }> = {
  DRAFT: { label: "Draft", icon: FileText, className: "bg-zinc-700 text-zinc-300 border-zinc-600" },
  SCHEDULED: { label: "Scheduled", icon: Calendar, className: "bg-amber-900/50 text-amber-400 border-amber-800" },
  PUBLISHED: { label: "Published", icon: CheckCircle2, className: "bg-emerald-900/50 text-emerald-400 border-emerald-800" },
  FAILED: { label: "Failed", icon: XCircle, className: "bg-red-900/50 text-red-400 border-red-800" },
  PENDING_REVIEW: { label: "Pending Review", icon: Clock, className: "bg-violet-900/50 text-violet-400 border-violet-800" },
  RETRYING: { label: "Retrying", icon: RefreshCw, className: "bg-orange-900/50 text-orange-400 border-orange-800" },
  PUBLISHING: { label: "Publishing", icon: Loader2, className: "bg-sky-900/50 text-sky-400 border-sky-800" },
};

const PLATFORM_DOT: Record<Platform, string> = {
  TWITTER: "bg-sky-400",
  INSTAGRAM: "bg-pink-500",
  FACEBOOK: "bg-blue-500",
  TIKTOK: "bg-zinc-100",
  YOUTUBE: "bg-red-500",
};

interface DayPost {
  id: string;
  content: string;
  status: PostStatus;
  scheduledAt: string | null;
  socialAccount: { platform: Platform; username: string };
}

interface DayDetailPanelProps {
  date: Date;
  posts: DayPost[];
  onClose: () => void;
}

export function DayDetailPanel({ date, posts, onClose }: DayDetailPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Focus the panel on mount for accessibility
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });

  const dateParam = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}T09:00`;

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      className="absolute right-0 top-0 bottom-0 w-full sm:w-80 bg-zinc-900 border-l border-zinc-700 shadow-xl z-10 flex flex-col outline-none"
      role="dialog"
      aria-label={`Posts for ${dateLabel}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
        <h3 className="text-sm font-semibold text-zinc-100 truncate">{dateLabel}</h3>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-zinc-400 hover:text-zinc-100 shrink-0"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {posts.length === 0 ? (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-zinc-500">No posts scheduled for this day.</p>
            <Button asChild size="sm" className="bg-violet-600 hover:bg-violet-700 text-white">
              <Link href={`/dashboard/posts/new?date=${dateParam}`}>
                <PenSquare className="h-3.5 w-3.5 mr-1.5" />
                Schedule a post
              </Link>
            </Button>
          </div>
        ) : (
          posts.map((post) => {
            const statusConfig = STATUS_CONFIG[post.status];
            const StatusIcon = statusConfig.icon;
            const canEdit = post.status !== "PUBLISHED";
            const time = post.scheduledAt
              ? new Date(post.scheduledAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
              : null;

            return (
              <div
                key={post.id}
                className="rounded-lg border border-zinc-700 bg-zinc-800 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className={`shrink-0 w-2 h-2 rounded-full ${PLATFORM_DOT[post.socialAccount.platform]}`} />
                    <span className="text-xs text-zinc-400 truncate">
                      @{post.socialAccount.username}
                    </span>
                  </div>
                  <Badge variant="outline" className={`gap-1 shrink-0 text-xs ${statusConfig.className}`}>
                    <StatusIcon className="h-3 w-3" />
                    {statusConfig.label}
                  </Badge>
                </div>

                <p className="text-sm text-zinc-200 line-clamp-3">{post.content}</p>

                <div className="flex items-center justify-between">
                  {time && (
                    <span className="text-xs text-zinc-500">{time}</span>
                  )}
                  {canEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-zinc-400 hover:text-violet-400 hover:bg-violet-950/50 ml-auto"
                      asChild
                    >
                      <Link href={`/dashboard/posts/${post.id}/edit`}>
                        Edit
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer with new post CTA when there are posts */}
      {posts.length > 0 && (
        <div className="px-3 py-2 border-t border-zinc-700">
          <Button asChild size="sm" variant="outline" className="w-full border-zinc-700 text-zinc-400 hover:text-zinc-200">
            <Link href={`/dashboard/posts/new?date=${dateParam}`}>
              <PenSquare className="h-3.5 w-3.5 mr-1.5" />
              Add post
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
