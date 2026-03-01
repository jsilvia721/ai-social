"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PostCard } from "@/components/posts/PostCard";
import { PenSquare } from "lucide-react";
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
  const [activeTab, setActiveTab] = useState<PostStatus | "ALL">("ALL");
  const [posts, setPosts] = useState<Post[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    setIsLoading(true);
    const url = activeTab === "ALL" ? "/api/posts" : `/api/posts?status=${activeTab}`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      setPosts(data);
    }
    setIsLoading(false);
  }, [activeTab]);

  useEffect(() => {
    fetchPosts();
  }, [fetchPosts]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Posts</h1>
          <p className="text-zinc-400 mt-1">Manage your scheduled and published posts.</p>
        </div>
        <Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
          <Link href="/dashboard/posts/new">
            <PenSquare className="h-4 w-4 mr-2" />
            New Post
          </Link>
        </Button>
      </div>

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
    </div>
  );
}
