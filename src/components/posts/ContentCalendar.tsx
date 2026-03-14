"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  useDraggable,
  useDroppable,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DayDetailPanel } from "@/components/posts/DayDetailPanel";
import type { Platform, PostStatus } from "@/types";
import { PLATFORM_STYLES } from "@/components/accounts/platform-utils";

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
  onReschedule?: (postId: string, newDate: Date) => Promise<boolean>;
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

function isPastDay(year: number, month: number, day: number): boolean {
  const now = new Date();
  const cellDate = new Date(Date.UTC(year, month, day, 23, 59, 59));
  return cellDate < now;
}

// Draggable post item
function DraggablePost({ post, isDragOverlay }: { post: CalendarPost; isDragOverlay?: boolean }) {
  const isDraggable = post.status === "SCHEDULED";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: post.id,
    data: { post },
    disabled: !isDraggable,
  });

  return (
    <div
      ref={setNodeRef}
      {...(isDraggable ? { ...listeners, ...attributes } : {})}
      className={`flex items-center gap-1 px-1 py-0.5 rounded text-xs truncate ring-1 ${STATUS_RING[post.status]} bg-zinc-900/60 ${
        isDraggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${isDragging && !isDragOverlay ? "opacity-30" : ""}`}
      title={`${post.socialAccount.platform}: ${post.content}`}
    >
      <span
        className={`shrink-0 w-1.5 h-1.5 rounded-full ${PLATFORM_DOT[post.socialAccount.platform]}`}
      />
      <span className="text-zinc-300 truncate leading-tight">
        {post.content.slice(0, 20)}
      </span>
    </div>
  );
}

// Droppable day cell
function DroppableDay({
  day,
  year,
  month,
  dayPosts,
  isToday,
  isSelected,
  isPast,
  onClick,
}: {
  day: number;
  year: number;
  month: number;
  dayPosts: CalendarPost[];
  isToday: boolean;
  isSelected: boolean;
  isPast: boolean;
  onClick: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `day-${year}-${month}-${day}`,
    data: { day, year, month },
    disabled: isPast,
  });

  return (
    <div
      ref={setNodeRef}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={`min-h-[80px] p-1.5 border-b border-r border-zinc-700/50 text-left transition-colors cursor-pointer ${
        isToday ? "bg-violet-950/20" : ""
      } ${isSelected ? "bg-violet-950/40 ring-1 ring-inset ring-violet-500/50" : "hover:bg-zinc-700/30"} ${
        isOver && !isPast ? "bg-violet-900/30 ring-1 ring-inset ring-violet-400/60" : ""
      } ${isPast && isOver ? "bg-red-950/20" : ""}`}
      aria-label={`${MONTH_NAMES[month]} ${day}, ${dayPosts.length} posts`}
    >
      {/* Day number */}
      <div className="flex items-center justify-end mb-1">
        <span
          className={`text-xs font-medium w-5 h-5 flex items-center justify-center rounded-full ${
            isToday ? "bg-violet-600 text-white" : "text-zinc-400"
          }`}
        >
          {day}
        </span>
      </div>

      {/* Post dots */}
      <div className="space-y-0.5">
        {dayPosts.slice(0, 3).map((post) => (
          <DraggablePost key={post.id} post={post} />
        ))}
        {dayPosts.length > 3 && (
          <div className="text-xs text-zinc-500 px-1">
            +{dayPosts.length - 3} more
          </div>
        )}
      </div>
    </div>
  );
}

export function ContentCalendar({ posts, year, month, onNavigate, onReschedule }: ContentCalendarProps) {
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const [activePost, setActivePost] = useState<CalendarPost | null>(null);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [undoTimer, setUndoTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  // Group posts by local day key
  const byDay = new Map<string, CalendarPost[]>();
  for (const post of posts) {
    if (!post.scheduledAt) continue;
    const key = toUTCDateKey(post.scheduledAt);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key)!.push(post);
  }

  // Build calendar grid
  const firstDay = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;

  const cells: (number | null)[] = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  function prevMonth() {
    setSelectedDay(null);
    if (month === 0) onNavigate(year - 1, 11);
    else onNavigate(year, month - 1);
  }

  function nextMonth() {
    setSelectedDay(null);
    if (month === 11) onNavigate(year + 1, 0);
    else onNavigate(year, month + 1);
  }

  function handleDayClick(day: number) {
    setSelectedDay((prev) => (prev === day ? null : day));
  }

  const handleClosePanel = useCallback(() => {
    setSelectedDay(null);
  }, []);

  function handleDragStart(event: DragStartEvent) {
    const post = event.active.data.current?.post as CalendarPost | undefined;
    if (post) setActivePost(post);
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActivePost(null);

    const { active, over } = event;
    if (!over || !onReschedule) return;

    const post = active.data.current?.post as CalendarPost | undefined;
    if (!post?.scheduledAt) return;

    const targetData = over.data.current as { day: number; year: number; month: number } | undefined;
    if (!targetData) return;

    // Check if same day — no-op
    const originalKey = toUTCDateKey(post.scheduledAt);
    const targetKey = `${targetData.year}-${targetData.month}-${targetData.day}`;
    if (originalKey === targetKey) return;

    // Check if past
    if (isPastDay(targetData.year, targetData.month, targetData.day)) return;

    // Preserve original time, change only the date
    const original = new Date(post.scheduledAt);
    const newDate = new Date(Date.UTC(
      targetData.year,
      targetData.month,
      targetData.day,
      original.getUTCHours(),
      original.getUTCMinutes(),
      original.getUTCSeconds()
    ));

    const success = await onReschedule(post.id, newDate);
    if (!success) {
      setUndoMessage("Failed to reschedule post");
      if (undoTimer) clearTimeout(undoTimer);
      const timer = setTimeout(() => setUndoMessage(null), 3000);
      setUndoTimer(timer);
    }
  }

  // Get posts for the selected day
  const selectedDayPosts = selectedDay
    ? byDay.get(`${year}-${month}-${selectedDay}`) ?? []
    : [];
  const selectedDate = selectedDay
    ? new Date(Date.UTC(year, month, selectedDay))
    : null;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="relative rounded-lg border border-zinc-700 bg-zinc-800/50 overflow-x-auto">
        {/* Undo toast */}
        {undoMessage && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 bg-red-900/90 text-red-200 text-sm px-4 py-2 rounded-lg shadow-lg">
            {undoMessage}
          </div>
        )}

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
        <div className="grid grid-cols-7 border-b border-zinc-700" style={{ minWidth: "500px" }}>
          {DAY_NAMES.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-medium text-zinc-500">
              {d}
            </div>
          ))}
        </div>

        {/* Calendar grid */}
        <div className="grid grid-cols-7" style={{ minWidth: "500px" }}>
          {cells.map((day, idx) => {
            if (day === null) {
              return <div key={`empty-${idx}`} className="min-h-[80px] border-b border-r border-zinc-700/50 bg-zinc-900/30" />;
            }

            const cellKey = `${year}-${month}-${day}`;
            const dayPosts = byDay.get(cellKey) ?? [];
            const isToday = cellKey === todayKey;
            const isSelected = selectedDay === day;
            const isPast = isPastDay(year, month, day);

            return (
              <DroppableDay
                key={cellKey}
                day={day}
                year={year}
                month={month}
                dayPosts={dayPosts}
                isToday={isToday}
                isSelected={isSelected}
                isPast={isPast}
                onClick={() => handleDayClick(day)}
              />
            );
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2 border-t border-zinc-700">
          {(Object.entries(PLATFORM_DOT) as [Platform, string][]).map(([platform, dot]) => (
            <span key={platform} className="flex items-center gap-1.5 text-xs text-zinc-500">
              <span className={`w-2 h-2 rounded-full ${dot}`} />
              {PLATFORM_STYLES[platform].label}
            </span>
          ))}
        </div>

        {/* Day detail panel */}
        {selectedDay !== null && selectedDate && (
          <DayDetailPanel
            date={selectedDate}
            posts={selectedDayPosts}
            onClose={handleClosePanel}
          />
        )}
      </div>

      {/* Drag overlay */}
      <DragOverlay>
        {activePost && (
          <div className="flex items-center gap-1 px-2 py-1 rounded text-xs ring-1 ring-violet-500 bg-zinc-800 shadow-lg opacity-90">
            <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${PLATFORM_DOT[activePost.socialAccount.platform]}`} />
            <span className="text-zinc-200 truncate max-w-[150px]">{activePost.content.slice(0, 30)}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
