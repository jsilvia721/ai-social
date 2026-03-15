"use client";

import { useEffect, useState, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Calendar, Loader2, Trash2, Save, CheckCircle2 } from "lucide-react";
import type { Platform } from "@/types";

const PLATFORM_COLOR: Record<Platform, string> = {
  TWITTER: "bg-sky-900/50 text-sky-400 border-sky-800",
  INSTAGRAM: "bg-pink-900/50 text-pink-400 border-pink-800",
  FACEBOOK: "bg-blue-900/50 text-blue-400 border-blue-800",
  TIKTOK: "bg-zinc-700 text-zinc-100 border-zinc-600",
  YOUTUBE: "bg-red-900/50 text-red-400 border-red-800",
};

const PLATFORM_LIMITS: Record<Platform, { max: number; optimal: number }> = {
  TWITTER: { max: 280, optimal: 100 },
  INSTAGRAM: { max: 2200, optimal: 125 },
  FACEBOOK: { max: 63206, optimal: 80 },
  TIKTOK: { max: 4000, optimal: 150 },
  YOUTUBE: { max: 5000, optimal: 200 },
};

interface VariantPost {
  id: string;
  content: string;
  status: string;
  socialAccount: { platform: Platform; username: string };
}

export default function RepurposeReviewPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = params.groupId as string;

  const [posts, setPosts] = useState<VariantPost[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [pageOp, setPageOp] = useState<"idle" | "scheduling" | "deleting">("idle");
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [scheduledAt, setScheduledAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  const savesInFlight = useRef(0);
  const isBusy = pageOp !== "idle";

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/posts?repurposeGroupId=${groupId}`)
      .then(async (res) => {
        if (res.ok && !cancelled) {
          const data = await res.json();
          setPosts(data.posts);
          // Initialize edited content
          const initial: Record<string, string> = {};
          for (const post of data.posts) {
            initial[post.id] = post.content;
          }
          setEditedContent(initial);
        }
        if (!cancelled) setIsLoading(false);
      })
      .catch(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [groupId]);

  async function handleSave(postId: string) {
    const content = editedContent[postId];
    if (!content) return;

    setSavingIds((prev) => new Set(prev).add(postId));
    savesInFlight.current++;
    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        setError("Failed to save variant");
      }
    } finally {
      savesInFlight.current--;
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(postId);
        return next;
      });
    }
  }

  async function handleRemove(postId: string) {
    if (isBusy) return;
    setPageOp("deleting");
    try {
      const res = await fetch(`/api/posts?id=${postId}`, { method: "DELETE" });
      if (res.ok) {
        setPosts((prev) => prev.filter((p) => p.id !== postId));
        if (posts.length <= 1) {
          router.push("/dashboard/posts");
        }
      }
    } finally {
      setPageOp("idle");
    }
  }

  async function handleScheduleAll() {
    if (savesInFlight.current > 0) {
      setError("Please wait for edits to save");
      return;
    }
    if (!scheduledAt) {
      setError("Select a date and time to schedule");
      return;
    }

    setPageOp("scheduling");
    setError(null);
    try {
      const postIds = posts.map((p) => p.id);
      const res = await fetch("/api/posts/bulk-schedule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds, scheduledAt: new Date(scheduledAt).toISOString() }),
      });
      if (res.ok) {
        router.push("/dashboard/posts");
      } else {
        const data = await res.json();
        setError(typeof data.error === "string" ? data.error : "Failed to schedule");
      }
    } finally {
      setPageOp("idle");
    }
  }

  function charCountColor(platform: Platform, length: number): string {
    const limits = PLATFORM_LIMITS[platform];
    if (length > limits.max) return "text-red-400";
    if (length > limits.optimal) return "text-amber-400";
    return "text-emerald-400";
  }

  if (isLoading) {
    return (
      <div className="py-12 text-center text-zinc-500">Loading variants…</div>
    );
  }

  if (posts.length === 0) {
    return (
      <div className="py-12 text-center space-y-3">
        <p className="text-zinc-500">No variants found for this group.</p>
        <Button variant="outline" onClick={() => router.push("/dashboard/posts")}
          className="border-zinc-700 text-zinc-400 hover:text-zinc-200">
          Back to Posts
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/posts")}
            className="h-8 w-8 text-zinc-400 hover:text-zinc-200">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-zinc-50">Review Variants</h1>
            <p className="text-zinc-400 text-sm">{posts.length} platform variant{posts.length !== 1 ? "s" : ""}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-900/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Variant cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {posts.map((post) => {
          const platform = post.socialAccount.platform;
          const content = editedContent[post.id] ?? post.content;
          const hasChanges = content !== post.content;
          const isSaving = savingIds.has(post.id);

          return (
            <div key={post.id} className="rounded-lg border border-zinc-700 bg-zinc-800 p-4 space-y-3">
              {/* Platform badge + username */}
              <div className="flex items-center justify-between">
                <Badge variant="outline" className={PLATFORM_COLOR[platform]}>
                  {platform}
                </Badge>
                <span className="text-xs text-zinc-500">@{post.socialAccount.username}</span>
              </div>

              {/* Editable content */}
              <textarea
                value={content}
                onChange={(e) => setEditedContent((prev) => ({ ...prev, [post.id]: e.target.value }))}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 resize-y min-h-[100px]"
                rows={4}
                disabled={isBusy}
              />

              {/* Character count + actions */}
              <div className="flex items-center justify-between">
                <span className={`text-xs ${charCountColor(platform, content.length)}`}>
                  {content.length} / {PLATFORM_LIMITS[platform].max}
                </span>
                <div className="flex items-center gap-1">
                  {hasChanges && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs text-violet-400 hover:text-violet-300 hover:bg-violet-950/50"
                      onClick={() => handleSave(post.id)}
                      disabled={isSaving || isBusy}
                    >
                      {isSaving ? (
                        <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                      ) : (
                        <Save className="h-3 w-3 mr-1" />
                      )}
                      Save
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-zinc-600 hover:text-red-400 hover:bg-red-950/50"
                    onClick={() => handleRemove(post.id)}
                    disabled={isBusy}
                    aria-label={`Remove ${platform} variant`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer actions */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Calendar className="h-4 w-4 text-zinc-400" />
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
              disabled={isBusy}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() => router.push("/dashboard/posts")}
              disabled={isBusy}
              className="border-zinc-700 text-zinc-400 hover:text-zinc-200"
            >
              Save as Drafts
            </Button>
            <Button
              onClick={handleScheduleAll}
              disabled={isBusy || posts.length === 0}
              className="bg-violet-600 hover:bg-violet-700 text-white"
            >
              {pageOp === "scheduling" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <CheckCircle2 className="h-4 w-4 mr-2" />
              )}
              Schedule All ({posts.length})
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
