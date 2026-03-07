"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Platform, PostStatus } from "@/types";

interface CalendarPost {
  id: string;
  content: string;
  status: PostStatus;
  scheduledAt: string | null;
  socialAccount: { platform: Platform; username: string };
}

interface ContentCalendarProps {
  posts: CalendarPost[];
  year: number;
  month: number;
  onNavigate: (year: number, month: number) => void;
}

const PLATFORM_DOT: Record<Platform, string> = {
  TWITTER: "bg-sky-400",
  INSTAGRAM: "bg-pink-500",
  FACEBOOK: "bg-blue-500",
  TIKTOK: "bg-zinc-100",
  YOUTUBE: "bg-red-500",
};

const STATUS_RING: Record<PostStatus, string> = {
  DRAFT: "ring-zinc-600",
  SCHEDULED: "ring-amber-500",
  PUBLISHING: "ring-sky-500",
  PUBLISHED: "ring-emerald-500",
  FAILED: "ring-red-500",
  PENDING_REVIEW: "ring-violet-500",
  RETRYING: "ring-orange-500",
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toUTCDateKey(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

export function ContentCalendar({ posts, year, month, onNavigate }: ContentCalendarProps) {
  // Group posts by local day key
  const byDay = new Map<string, CalendarPost[]>();
  for (const post of posts) {
    if (!post.scheduledAt) continue;
    const key = toUTCDateKey(post.scheduledAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(post);
  }

  // Build calendar grid (all calculations in UTC for consistency with stored dates)
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay(); // 0=Sun
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  // Pad to complete last row
  while (cells.length % 7 !== 0) cells.push(null);

  function prevMonth() {
    if (month === 0) onNavigate(year - 1, 11);
    else onNavigate(year, month - 1);
  }

  function nextMonth() {
    if (month === 11) onNavigate(year + 1, 0);
    else onNavigate(year, month + 1);
  }

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
          onClick={prevMonth}
          aria-label="Previous month"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h2 className="text-sm font-semibold text-zinc-100">
          {MONTH_NAMES[month]} {year}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
          onClick={nextMonth}
          aria-label="Next month"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 border-b border-zinc-700">
        {DAY_NAMES.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-medium text-zinc-500">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7">
        {cells.map((day, idx) => {
          if (day === null) {
            return <div key={`empty-${idx}`} className="min-h-[80px] border-b border-r border-zinc-700/50 bg-zinc-900/30" />;
          }

          const cellKey = `${year}-${month}-${day}`;
          const dayPosts = byDay.get(cellKey) ?? [];
          const isToday = cellKey === todayKey;

          return (
            <div
              key={cellKey}
              className={`min-h-[80px] p-1.5 border-b border-r border-zinc-700/50 ${
                isToday ? "bg-violet-950/20" : ""
              }`}
            >
              {/* Day number */}
              <div className="flex items-center justify-end mb-1">
                <span
                  className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full ${
                    isToday
                      ? "bg-violet-600 text-white"
                      : "text-zinc-400"
                  }`}
                >
                  {day}
                </span>
              </div>

              {/* Post dots */}
              <div className="space-y-0.5">
                {dayPosts.slice(0, 3).map((post) => (
                  <div
                    key={post.id}
                    className={`flex items-center gap-1 px-1 py-0.5 rounded text-xs truncate ring-1 ${STATUS_RING[post.status]} bg-zinc-900/60`}
                    title={`${post.socialAccount.platform}: ${post.content}`}
                  >
                    <span
                      className={`shrink-0 w-1.5 h-1.5 rounded-full ${PLATFORM_DOT[post.socialAccount.platform]}`}
                    />
                    <span className="text-zinc-300 truncate leading-tight">
                      {post.content.slice(0, 20)}
                    </span>
                  </div>
                ))}
                {dayPosts.length > 3 && (
                  <div className="text-xs text-zinc-500 px-1">
                    +{dayPosts.length - 3} more
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-t border-zinc-700">
        {(Object.entries(PLATFORM_DOT) as [Platform, string][]).map(([platform, dot]) => (
          <span key={platform} className="flex items-center gap-1.5 text-xs text-zinc-500">
            <span className={`w-2 h-2 rounded-full ${dot}`} />
            {platform.charAt(0) + platform.slice(1).toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}
