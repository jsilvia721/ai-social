"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PostCard } from "@/components/posts/PostCard";
import { Pagination } from "@/components/ui/pagination";
import { ContentCalendar } from "@/components/posts/ContentCalendar";
import { WeekCalendar, getMondayOfWeek } from "@/components/posts/WeekCalendar";
import { PenSquare, List, CalendarDays } from "lucide-react";
import type { PostStatus, Platform } from "@/types";

const TABS: { label: string; value: PostStatus | "ALL" }[] = [
  { label: "All", value: "ALL" },
  { label: "Scheduled", value: "SCHEDULED" },
  { label: "Published", value: "PUBLISHED" },
  { label: "Failed", value: "FAILED" },
];

const POSTS_PER_PAGE = 20;

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
  const { data: session } = useSession();
  const activeBusinessId = (session?.user as { id: string; activeBusinessId?: string | null } | undefined)
    ?.activeBusinessId;

  const [view, setView] = useState<"list" | "calendar">("list");
  const [calMode, setCalMode] = useState<"month" | "week">("month");
  const [activeTab, setActiveTab] = useState<PostStatus | "ALL">("ALL");
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);

  // Reset to page 1 when business context changes
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setPage(1); }, [activeBusinessId]);

  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth());
  const [calPosts, setCalPosts] = useState<Post[]>([]);
  const [isCalLoading, setIsCalLoading] = useState(false);

  // Week view state
  const [weekStart, setWeekStart] = useState(() => getMondayOfWeek(new Date()));
  const [weekPosts, setWeekPosts] = useState<Post[]>([]);
  const [isWeekLoading, setIsWeekLoading] = useState(false);

  useEffect(() => {
    if (view !== "list") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    const params = new URLSearchParams();
    if (activeTab !== "ALL") params.set("status", activeTab);
    if (activeBusinessId) params.set("businessId", activeBusinessId);
    params.set("page", String(page));
    params.set("limit", String(POSTS_PER_PAGE));
    fetch(`/api/posts?${params.toString()}`).then(async (res) => {
      if (res.ok && !cancelled) {
        const data = (await res.json()) as { posts: Post[]; total: number };
        setPosts(data.posts);
        setTotalPages(Math.max(1, Math.ceil(data.total / POSTS_PER_PAGE)));
      }
      if (!cancelled) setIsLoading(false);
    }).catch(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => { cancelled = true; };
  }, [view, activeTab, activeBusinessId, page, refreshKey]);

  useEffect(() => {
    if (view !== "calendar" || calMode !== "month") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsCalLoading(true);
    const params = new URLSearchParams({ year: String(calYear), month: String(calMonth) });
    if (activeBusinessId) params.set("businessId", activeBusinessId);
    fetch(`/api/posts/calendar?${params.toString()}`).then(async (res) => {
      if (res.ok && !cancelled) setCalPosts(await res.json());
      if (!cancelled) setIsCalLoading(false);
    }).catch(() => {
      if (!cancelled) setIsCalLoading(false);
    });
    return () => { cancelled = true; };
  }, [view, calMode, calYear, calMonth, activeBusinessId]);

  useEffect(() => {
    if (view !== "calendar" || calMode !== "week") return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsWeekLoading(true);
    const weekEnd = new Date(Date.UTC(
      weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 7
    ));
    const params = new URLSearchParams({
      startDate: weekStart.toISOString(),
      endDate: weekEnd.toISOString(),
    });
    if (activeBusinessId) params.set("businessId", activeBusinessId);
    fetch(`/api/posts/calendar?${params.toString()}`).then(async (res) => {
      if (res.ok && !cancelled) setWeekPosts(await res.json());
      if (!cancelled) setIsWeekLoading(false);
    }).catch(() => {
      if (!cancelled) setIsWeekLoading(false);
    });
    return () => { cancelled = true; };
  }, [view, calMode, weekStart, activeBusinessId]);

  async function handleDelete(id: string) {
    const res = await fetch(`/api/posts?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      if (posts.length === 1 && page > 1) {
        setPage((p) => p - 1); // triggers re-fetch via useEffect
      } else {
        setRefreshKey((k) => k + 1); // re-fetch current page
      }
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

  const handleWeekNavigate = useCallback((newWeekStart: Date) => {
    setWeekStart(newWeekStart);
  }, []);

  async function handleReschedule(postId: string, newDate: Date): Promise<boolean> {
    const newScheduledAt = newDate.toISOString();

    // Optimistic update for both month and week views
    const updatePosts = (setter: React.Dispatch<React.SetStateAction<Post[]>>, original: Post[]) => {
      const post = original.find((p) => p.id === postId);
      if (!post) return null;
      setter((prev) =>
        prev.map((p) => (p.id === postId ? { ...p, scheduledAt: newScheduledAt } : p))
      );
      return post;
    };

    const originalMonth = updatePosts(setCalPosts, calPosts);
    const originalWeek = updatePosts(setWeekPosts, weekPosts);
    const original = originalMonth ?? originalWeek;
    if (!original) return false;

    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledAt: newScheduledAt }),
      });
      if (!res.ok) {
        // Rollback
        if (originalMonth) setCalPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, scheduledAt: originalMonth.scheduledAt } : p)));
        if (originalWeek) setWeekPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, scheduledAt: originalWeek.scheduledAt } : p)));
        return false;
      }
      return true;
    } catch {
      if (originalMonth) setCalPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, scheduledAt: originalMonth.scheduledAt } : p)));
      if (originalWeek) setWeekPosts((prev) => prev.map((p) => (p.id === postId ? { ...p, scheduledAt: originalWeek.scheduledAt } : p)));
      return false;
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <div className="space-y-4">
          {/* Month / Week sub-toggle */}
          <div className="flex gap-1">
            <button
              onClick={() => setCalMode("month")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                calMode === "month"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              Month
            </button>
            <button
              onClick={() => setCalMode("week")}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                calMode === "week"
                  ? "bg-zinc-700 text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              }`}
            >
              Week
            </button>
          </div>

          {calMode === "month" ? (
            isCalLoading ? (
              <div className="py-12 text-center text-zinc-500">Loading calendar…</div>
            ) : (
              <ContentCalendar
                posts={calPosts}
                year={calYear}
                month={calMonth}
                onNavigate={handleCalendarNavigate}
                onReschedule={handleReschedule}
              />
            )
          ) : (
            isWeekLoading ? (
              <div className="py-12 text-center text-zinc-500">Loading week…</div>
            ) : (
              <WeekCalendar
                posts={weekPosts}
                weekStart={weekStart}
                onNavigate={handleWeekNavigate}
                onReschedule={handleReschedule}
              />
            )
          )}
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="flex gap-1 border-b border-zinc-800 pb-0">
            {TABS.map(({ label, value }) => (
              <button
                key={value}
                onClick={() => { setActiveTab(value); setPage(1); }}
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
          <div className="space-y-4 sm:space-y-3">
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

          {!isLoading && posts.length > 0 && (
            <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
          )}
        </>
      )}
    </div>
  );
}
