"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PostCard } from "@/components/posts/PostCard";
import { ContentCalendar } from "@/components/posts/ContentCalendar";
import { PenSquare, List, CalendarDays } from "lucide-react";
import type { PostStatus, Platform } from "@/types";

const TABS: { label: string; value: PostStatus | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Scheduled", value: "SCHEDULED" },
  { label: "Published", value: "PUBLISHED" },
  { label: "Failed", value: "FAILED" },
];

interface Post {
  id: string;
  content: string;
  status: PostStatus;
  scheduledAt: string | null;
  errorMessage: string | null;
  metricsLikes: number | null;
  metricsComments: number | null;
  metricsShares: number | null;
  metricsImpressions: number | null;
  metricsReach: number | null;
  metricsSaves: number | null;
  socialAccount: { platform: Platform; username: string };
}

export default function PostsPage() {
  const [view, setView] = useState<"list" | "calendar">("list");
  const [activeTab, setActiveTab] = useState<PostStatus | "ALL">("ALL");
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calPosts, setCalPosts] = useState<Post[]>([]);
  const [isCalLoading, setIsCalLoading] = useState(false);

  useEffect(() => {
    if (view !== "list") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    const url = activeTab === "ALL" ? "/api/posts" : `/api/posts?status=${activeTab}`;
    fetch(url).then(async (res) => {
      if (res.ok && !cancelled) setPosts((await res.json()).posts);
      if (!cancelled) setIsLoading(false);
    }).catch(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [view, activeTab]);

  useEffect(() => {
    if (view !== "calendar") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsCalLoading(true);
    fetch(`/api/posts/calendar?year=${calYear}&month=${calMonth}`).then(async (res) => {
      if (res.ok && !cancelled) setCalPosts(await res.json());
      if (!cancelled) setIsCalLoading(false);
    }).catch(() => {
      if (!cancelled) setIsCalLoading(false);
    });
    return () => { cancelled = true; };
  }, [view, calYear, calMonth]);

  async function handleDelete(id: string) {
    const res = await fetch(`/api/posts?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      setPosts((prev) => prev.filter((p) => p.id !== id));
    }
  }

  async function handleRetry(id: string) {
    const res = await fetch(`/api/posts/${id}/retry`, { method: "POST" });
    if (res.ok) {
      setPosts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: "SCHEDULED" as PostStatus, errorMessage: null } : p))
      );
    }
  }

  function handleCalendarNavigate(year: number, month: number) {
    setCalYear(year);
    setCalMonth(month);
  }

  async function handleReschedule(postId: string, newDate: Date): Promise<boolean> {
    // Optimistic update
    const original = calPosts.find((p) => p.id === postId);
    if (!original) return false;

    const newScheduledAt = newDate.toISOString();
    setCalPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, scheduledAt: newScheduledAt } : p))
    );

    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: newScheduledAt }),
      });
      if (!res.ok) {
        // Rollback
        setCalPosts((prev) =>
          prev.map((p) => (p.id === postId ? { ...p, scheduledAt: original.scheduledAt } : p))
        );
        return false;
      }
      return true;
    } catch {
      // Rollback on network error
      setCalPosts((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, scheduledAt: original.scheduledAt } : p))
      );
      return false;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Posts</h1>
          <p className="text-zinc-400 mt-1">Manage your scheduled and published posts.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-md border border-zinc-700 overflow-hidden">
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 transition-colors ${
                view === "list"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
              aria-label="List view"
            >
              <List className="h-3.5 w-3.5" />
              List
            </button>
            <button
              onClick={() => setView("calendar")}
              className={`px-3 py-1.5 text-sm flex items-center gap-1.5 border-l border-zinc-700 transition-colors ${
                view === "calendar"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
              aria-label="Calendar view"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Calendar
            </button>
          </div>

          <Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
            <Link href="/dashboard/posts/new">
              <PenSquare className="h-4 w-4 mr-2" />
              New Post
            </Link>
          </Button>
        </div>
      </div>

      {view === "calendar" ? (
        <div>
          {isCalLoading ? (
            <div className="py-12 text-center text-zinc-500">Loading calendar…</div>
          ) : (
            <ContentCalendar
              posts={calPosts}
              year={calYear}
              month={calMonth}
              onNavigate={handleCalendarNavigate}
              onReschedule={handleReschedule}
            />
          )}
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-zinc-800 pb-0">
            {TABS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => setActiveTab(value)}
                className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                  activeTab === value
                    ? "border-violet-500 text-violet-400"
                    : "border-transparent text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Posts list */}
          <div className="space-y-3">
            {isLoading ? (
              <div className="py-12 text-center text-zinc-500">Loading posts…</div>
            ) : posts.length === 0 ? (
              <div className="rounded-lg border border-zinc-700 border-dashed py-16 text-center space-y-3">
                <p className="text-zinc-500">No posts found.</p>
                <Button asChild variant="outline" size="sm" className="border-zinc-700 text-zinc-400 hover:text-zinc-200">
                  <Link href="/dashboard/posts/new">Create your first post</Link>
                </Button>
              </div>
            ) : (
              posts.map((post) => (
                <PostCard key={post.id} post={post} onDelete={handleDelete} onRetry={handleRetry} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
