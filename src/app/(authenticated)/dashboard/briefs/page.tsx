"use client";

import { useEffect, useState, useCallback } from "react";
import { QueueItem } from "@/components/briefs/QueueItem";
import { FulfillmentPanel } from "@/components/briefs/FulfillmentPanel";
import { StoryboardReviewCard } from "@/components/briefs/StoryboardReviewCard";
import { ClipboardList, CheckCircle2, ListFilter } from "lucide-react";

type BriefStatus = "PENDING" | "FULFILLED" | "EXPIRED" | "CANCELLED" | "STORYBOARD_REVIEW" | "RENDERING";
type BriefFormat = "TEXT" | "IMAGE" | "CAROUSEL" | "VIDEO";
type Platform = "TWITTER" | "INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE";

interface Brief {
  id: string;
  topic: string;
  rationale: string;
  suggestedCaption: string;
  aiImagePrompt: string | null;
  contentGuidance: string | null;
  recommendedFormat: BriefFormat;
  platform: Platform;
  scheduledFor: string;
  status: BriefStatus;
  weekOf: string;
  sortOrder: number;
  businessId: string;
  videoScript?: string | null;
  videoPrompt?: string | null;
  storyboardImageUrl?: string | null;
  updatedAt?: string;
}

type TabValue = BriefStatus | "ALL" | "REVIEW";

const TABS: { label: string; value: TabValue }[] = [
  { label: "Pending", value: "PENDING" },
  { label: "Review", value: "REVIEW" },
  { label: "Fulfilled", value: "FULFILLED" },
  { label: "All", value: "ALL" },
];

function isStoryboardBrief(b: Brief) {
  return b.status === "STORYBOARD_REVIEW" || b.status === "RENDERING";
}

export default function BriefsPage() {
  const [briefs, setBriefs] = useState<Brief[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<TabValue>("PENDING");
  const [selectedBriefId, setSelectedBriefId] = useState<string | null>(null);

  const selectedBrief = briefs.find((b) => b.id === selectedBriefId) ?? null;

  const fetchBriefs = useCallback(async () => {
    setIsLoading(true);
    try {
      if (activeTab === "REVIEW") {
        // Fetch both STORYBOARD_REVIEW and RENDERING briefs
        const [reviewRes, renderingRes] = await Promise.all([
          fetch("/api/briefs?status=STORYBOARD_REVIEW"),
          fetch("/api/briefs?status=RENDERING"),
        ]);
        const reviewData = reviewRes.ok ? await reviewRes.json() : [];
        const renderingData = renderingRes.ok ? await renderingRes.json() : [];
        setBriefs([...reviewData, ...renderingData]);
      } else {
        const params = new URLSearchParams();
        if (activeTab !== "ALL") params.set("status", activeTab);
        const res = await fetch(`/api/briefs?${params}`);
        if (res.ok) {
          const data = await res.json();
          setBriefs(data);
        }
      }
    } catch {
      // silent
    } finally {
      setIsLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchBriefs();
  }, [fetchBriefs]);

  function handleFulfilled(nextBriefId: string | null) {
    // Remove the fulfilled brief from the list and advance
    setBriefs((prev) => prev.filter((b) => b.id !== selectedBriefId));
    if (nextBriefId) {
      setSelectedBriefId(nextBriefId);
    } else {
      setSelectedBriefId(null);
    }
  }

  function handleCancelled() {
    setBriefs((prev) => prev.filter((b) => b.id !== selectedBriefId));
    // Auto-advance to next
    const remaining = briefs.filter((b) => b.id !== selectedBriefId && b.status === "PENDING");
    setSelectedBriefId(remaining[0]?.id ?? null);
  }

  function handleSkip() {
    const currentIndex = briefs.findIndex((b) => b.id === selectedBriefId);
    const next = briefs.slice(currentIndex + 1).find((b) => b.status === "PENDING");
    setSelectedBriefId(next?.id ?? null);
  }

  function handleStoryboardStatusChange(briefId: string, newStatus: "RENDERING" | "REMOVED") {
    if (newStatus === "REMOVED") {
      setBriefs((prev) => prev.filter((b) => b.id !== briefId));
    } else {
      // Update brief status to RENDERING in place
      setBriefs((prev) =>
        prev.map((b) =>
          b.id === briefId ? { ...b, status: "RENDERING" as BriefStatus, updatedAt: new Date().toISOString() } : b
        )
      );
    }
  }

  const pendingCount = briefs.filter((b) => b.status === "PENDING").length;
  const reviewCount = briefs.filter(isStoryboardBrief).length;

  return (
    <div className="flex flex-col md:flex-row h-full">
      {/* Queue list */}
      <div className="flex-1 overflow-y-auto">
        <div className="py-2 md:px-6 md:py-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-zinc-50">Content Queue</h1>
              <p className="text-sm text-zinc-400 mt-1">
                {activeTab === "REVIEW"
                  ? reviewCount > 0
                    ? `${reviewCount} storyboard${reviewCount === 1 ? "" : "s"} to review`
                    : "No storyboards to review"
                  : pendingCount > 0
                    ? `${pendingCount} brief${pendingCount === 1 ? "" : "s"} to fulfill`
                    : "All caught up!"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <ListFilter className="h-4 w-4 text-zinc-500 mr-2" />
              {TABS.map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setActiveTab(tab.value)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    activeTab === tab.value
                      ? "bg-zinc-800 text-zinc-50"
                      : "text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-20 text-zinc-500">
              Loading briefs...
            </div>
          ) : briefs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
              {activeTab === "PENDING" ? (
                <>
                  <CheckCircle2 className="h-12 w-12 mb-3 text-emerald-500/50" />
                  <p className="text-lg font-medium text-zinc-400">All caught up!</p>
                  <p className="text-sm mt-1">No pending content briefs. Check back after the next generation cycle.</p>
                </>
              ) : (
                <>
                  <ClipboardList className="h-12 w-12 mb-3 text-zinc-700" />
                  <p className="text-sm">No briefs found.</p>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {briefs.map((brief) =>
                isStoryboardBrief(brief) ? (
                  <StoryboardReviewCard
                    key={brief.id}
                    brief={{
                      ...brief,
                      status: brief.status as "STORYBOARD_REVIEW" | "RENDERING",
                      updatedAt: brief.updatedAt ?? new Date().toISOString(),
                    }}
                    onStatusChange={handleStoryboardStatusChange}
                  />
                ) : (
                  <QueueItem
                    key={brief.id}
                    brief={brief as Parameters<typeof QueueItem>[0]["brief"]}
                    isSelected={brief.id === selectedBriefId}
                    onClick={() => setSelectedBriefId(brief.id)}
                  />
                )
              )}
            </div>
          )}
        </div>
      </div>

      {/* Fulfillment slide-over panel */}
      {selectedBrief && (
        <FulfillmentPanel
          brief={selectedBrief}
          onClose={() => setSelectedBriefId(null)}
          onFulfilled={handleFulfilled}
          onCancelled={handleCancelled}
          onSkip={handleSkip}
        />
      )}
    </div>
  );
}
