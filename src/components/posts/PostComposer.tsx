"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, Loader2, Send, Clock } from "lucide-react";
import type { Platform } from "@/types";

const CHAR_LIMITS: Partial<Record<Platform, number>> = {
  TWITTER: 280,
};

const PLATFORM_LABELS: Record<Platform, string> = {
  TWITTER: "Twitter / X",
  INSTAGRAM: "Instagram",
  FACEBOOK: "Facebook",
};

interface Account {
  id: string;
  platform: Platform;
  username: string;
}

export function PostComposer() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [content, setContent] = useState("");
  const [aiTopic, setAiTopic] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"draft" | "schedule">("draft");
  const [scheduledAt, setScheduledAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/accounts")
      .then((res) => res.json())
      .then((data) => setAccounts(data))
      .catch(() => {});
  }, []);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const charLimit = selectedAccount ? CHAR_LIMITS[selectedAccount.platform] : undefined;
  const charCount = content.length;
  const isOverLimit = charLimit !== undefined && charCount > charLimit;

  async function handleGenerate() {
    if (!aiTopic.trim()) return;
    setIsGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: aiTopic,
          platform: selectedAccount?.platform ?? "TWITTER",
        }),
      });
      if (!res.ok) throw new Error("Generation failed");
      const data = await res.json();
      setContent(data.content);
    } catch {
      setError("Failed to generate content. Please try again.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedAccountId || !content.trim() || isOverLimit) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        content: content.trim(),
        socialAccountId: selectedAccountId,
      };

      if (scheduleMode === "schedule" && scheduledAt) {
        body.scheduledAt = new Date(scheduledAt).toISOString();
      }

      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to create post");
      }

      router.push("/dashboard/posts");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create post.");
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-2xl">
      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Account select */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-zinc-300">Social Account</label>
        {accounts.length === 0 ? (
          <p className="text-sm text-zinc-500">
            No accounts connected.{" "}
            <a href="/dashboard/accounts" className="text-violet-400 hover:underline">
              Connect one first.
            </a>
          </p>
        ) : (
          <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
            <SelectTrigger className="bg-zinc-800 border-zinc-700 text-zinc-200">
              <SelectValue placeholder="Select an account…" />
            </SelectTrigger>
            <SelectContent className="bg-zinc-800 border-zinc-700">
              {accounts.map((account) => (
                <SelectItem
                  key={account.id}
                  value={account.id}
                  className="text-zinc-200 focus:bg-zinc-700"
                >
                  {PLATFORM_LABELS[account.platform]} · @{account.username}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Content */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-zinc-300">Content</label>
          {charLimit && (
            <span className={`text-xs ${isOverLimit ? "text-red-400" : "text-zinc-500"}`}>
              {charCount} / {charLimit}
            </span>
          )}
        </div>
        <Textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="What do you want to say?"
          rows={5}
          className={`bg-zinc-800 border-zinc-700 text-zinc-100 placeholder:text-zinc-600 resize-none ${
            isOverLimit ? "border-red-700 focus-visible:ring-red-700" : ""
          }`}
        />
      </div>

      {/* AI Generate */}
      <Card className="bg-zinc-900 border-zinc-700">
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <span className="text-sm font-medium text-zinc-300">AI Generate</span>
          </div>
          <div className="flex gap-2">
            <Input
              value={aiTopic}
              onChange={(e) => setAiTopic(e.target.value)}
              placeholder="Enter a topic or idea…"
              className="bg-zinc-800 border-zinc-700 text-zinc-200 placeholder:text-zinc-600"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
            />
            <Button
              type="button"
              onClick={handleGenerate}
              disabled={!aiTopic.trim() || isGenerating}
              className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
            >
              {isGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span className="ml-2">{isGenerating ? "Generating…" : "Generate"}</span>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Schedule toggle */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-zinc-300">Timing</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setScheduleMode("draft")}
            className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
              scheduleMode === "draft"
                ? "border-violet-600 bg-violet-600/10 text-violet-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
            }`}
          >
            <Send className="h-4 w-4 inline-block mr-2 -mt-0.5" />
            Save as Draft
          </button>
          <button
            type="button"
            onClick={() => setScheduleMode("schedule")}
            className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
              scheduleMode === "schedule"
                ? "border-violet-600 bg-violet-600/10 text-violet-300"
                : "border-zinc-700 text-zinc-500 hover:border-zinc-600 hover:text-zinc-300"
            }`}
          >
            <Clock className="h-4 w-4 inline-block mr-2 -mt-0.5" />
            Schedule for Later
          </button>
        </div>

        {scheduleMode === "schedule" && (
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            min={new Date().toISOString().slice(0, 16)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-violet-600"
            required={scheduleMode === "schedule"}
          />
        )}
      </div>

      {/* Submit */}
      <Button
        type="submit"
        disabled={!selectedAccountId || !content.trim() || isOverLimit || isSubmitting}
        className="w-full bg-violet-600 hover:bg-violet-700 text-white"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Saving…
          </>
        ) : scheduleMode === "schedule" ? (
          <>
            <Clock className="h-4 w-4 mr-2" />
            Schedule Post
          </>
        ) : (
          <>
            <Send className="h-4 w-4 mr-2" />
            Save Draft
          </>
        )}
      </Button>
    </form>
  );
}
