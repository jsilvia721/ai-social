"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Trash2, Loader2, Calendar, CheckCircle2, XCircle, FileText, Pencil, RefreshCw } from "lucide-react";
import type { PostStatus, Platform } from "@/types";

const STATUS_CONFIG: Record<PostStatus, { label: string; icon: React.ElementType; className: string }> = {
  DRAFT: { label: "Draft", icon: FileText, className: "bg-zinc-700 text-zinc-300 border-zinc-600" },
  SCHEDULED: { label: "Scheduled", icon: Calendar, className: "bg-amber-900/50 text-amber-400 border-amber-800" },
  PUBLISHED: { label: "Published", icon: CheckCircle2, className: "bg-emerald-900/50 text-emerald-400 border-emerald-800" },
  FAILED: { label: "Failed", icon: XCircle, className: "bg-red-900/50 text-red-400 border-red-800" },
};

const PLATFORM_COLOR: Record<Platform, string> = {
  TWITTER: "text-sky-400",
  INSTAGRAM: "text-pink-500",
  FACEBOOK: "text-blue-500",
};

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

const PLATFORM_ICONS: Record<Platform, React.ComponentType<{ className?: string }>> = {
  TWITTER: TwitterIcon,
  INSTAGRAM: InstagramIcon,
  FACEBOOK: FacebookIcon,
};

interface PostCardProps {
  post: {
    id: string;
    content: string;
    status: PostStatus;
    scheduledAt: string | null;
    errorMessage?: string | null;
    socialAccount: { platform: Platform; username: string };
  };
  onDelete: (id: string) => Promise<void>;
  onRetry?: (id: string) => Promise<void>;
}

export function PostCard({ post, onDelete, onRetry }: PostCardProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const statusConfig = STATUS_CONFIG[post.status];
  const StatusIcon = statusConfig.icon;
  const platformColor = PLATFORM_COLOR[post.socialAccount.platform];
  const PlatformIcon = PLATFORM_ICONS[post.socialAccount.platform];

  async function handleDelete() {
    setIsDeleting(true);
    try {
      await onDelete(post.id);
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleRetry() {
    if (!onRetry) return;
    setIsRetrying(true);
    try {
      await onRetry(post.id);
    } finally {
      setIsRetrying(false);
    }
  }

  const canEdit = post.status === "DRAFT" || post.status === "SCHEDULED";
  const canRetry = post.status === "FAILED" && !!onRetry;

  return (
    <div className="flex items-start gap-4 rounded-lg border border-zinc-700 bg-zinc-800 p-4">
      {/* Platform icon */}
      <div className={`mt-0.5 shrink-0 ${platformColor}`}>
        <PlatformIcon className="h-5 w-5" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-2">
        <p className="text-sm text-zinc-200 line-clamp-2">{post.content}</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-medium ${platformColor}`}>
            @{post.socialAccount.username}
          </span>
          {post.scheduledAt && (
            <span className="text-xs text-zinc-500">
              · {new Date(post.scheduledAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          )}
        </div>
        {post.status === "FAILED" && post.errorMessage && (
          <p className="text-xs text-red-400 truncate" title={post.errorMessage}>
            {post.errorMessage}
          </p>
        )}
      </div>

      {/* Status + actions */}
      <div className="flex items-center gap-2 shrink-0">
        <Badge variant="outline" className={`gap-1 ${statusConfig.className}`}>
          <StatusIcon className="h-3 w-3" />
          {statusConfig.label}
        </Badge>

        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-600 hover:text-violet-400 hover:bg-violet-950/50"
            aria-label="Edit post"
            asChild
          >
            <Link href={`/dashboard/posts/${post.id}/edit`}>
              <Pencil className="h-4 w-4" />
            </Link>
          </Button>
        )}

        {canRetry && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-600 hover:text-amber-400 hover:bg-amber-950/50"
            onClick={handleRetry}
            disabled={isRetrying}
            aria-label="Retry post"
          >
            {isRetrying ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        )}

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-zinc-600 hover:text-red-400 hover:bg-red-950/50"
          onClick={handleDelete}
          disabled={isDeleting}
          aria-label="Delete post"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
