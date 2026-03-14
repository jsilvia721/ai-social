"use client";

import { useEffect, useState, useCallback } from "react";
import { ReviewCard } from "@/components/review/ReviewCard";
import type { ReviewPost } from "@/components/review/ReviewCard";
import { FileCheck } from "lucide-react";

interface Props {
  initialPosts: ReviewPost[];
}

export function ReviewQueueClient({ initialPosts }: Props) {
  const [posts, setPosts] = useState<ReviewPost[]>(initialPosts);

  const pollPosts = useCallback(async () => {
    try {
      const res = await fetch("/api/review/posts");
      if (res.ok) {
        const data = await res.json();
        setPosts(data.posts);
      }
    } catch {
      // Silently ignore polling failures
    }
  }, []);

  // Poll for changes every 30s (catches auto-approvals)
  useEffect(() => {
    const id = setInterval(pollPosts, 30_000);
    return () => clearInterval(id);
  }, [pollPosts]);

  if (posts.length === 0) {
    return (
      <div className="text-center py-16">
        <FileCheck className="mx-auto h-12 w-12 text-zinc-600 mb-4" />
        <h2 className="text-lg font-medium text-zinc-300 mb-2">No posts to review</h2>
        <p className="text-zinc-500 text-sm">
          The AI agent will generate posts from your content briefs.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Review Queue</h1>
          <p className="text-sm text-zinc-400 mt-1">
            {posts.length} post{posts.length !== 1 ? "s" : ""} awaiting review
          </p>
        </div>
      </div>
      <div className="space-y-4">
        {posts.map((post) => (
          <ReviewCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
