"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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

interface CalendarPost {
  id: string;
  content: string;
  status: PostStatus;
  scheduledAt: string | null;
  socialAccount: { platform: Platform; username: string };
}

interface WeekCalendarProps {
  posts: CalendarPost[];
  weekStart: Date; // Monday UTC
  onNavigate: (weekStart: Date) => void;
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
  PUBLISHED: "ring-emerald-500",
  FAILED: "ring-red-500",
  PENDING_REVIEW: "ring-violet-500",
  RETRYING: "ring-orange-500",
  PUBLISHING: "ring-sky-500",
};

const START_HOUR = 6;
const END_HOUR = 23;
const HOUR_HEIGHT = 60; // px

function formatHour(hour: number): string {
  const ampm = hour >= 12 ? "PM" : "AM";
  const h = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${h} ${ampm}`;
}

function getWeekDays(weekStart: Date): Date[] {
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(Date.UTC(
      weekStart.getUTCFullYear(),
      weekStart.getUTCMonth(),
      weekStart.getUTCDate() + i
    )));
  }
  return days;
}

function getMondayOfWeek(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = 1
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

function formatDateRange(weekStart: Date): string {
  const weekEnd = new Date(Date.UTC(
    weekStart.getUTCFullYear(),
    weekStart.getUTCMonth(),
    weekStart.getUTCDate() + 6
  ));
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", timeZone: "UTC" };
  const startStr = weekStart.toLocaleDateString(undefined, opts);
  const endOpts: Intl.DateTimeFormatOptions = {
    ...opts,
    year: weekStart.getUTCFullYear() !== weekEnd.getUTCFullYear() ? "numeric" : undefined,
  };
  const endStr = weekEnd.toLocaleDateString(undefined, endOpts);
  return `${startStr} – ${endStr}, ${weekEnd.getUTCFullYear()}`;
}

function isPastSlot(date: Date, hour: number): boolean {
  const slotEnd = new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour + 1
  ));
  return slotEnd < new Date();
}

// Draggable post in week view
function WeekDraggablePost({ post }: { post: CalendarPost }) {
  const isDraggable = post.status === "SCHEDULED";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `week-${post.id}`,
    data: { post },
    disabled: !isDraggable,
  });

  return (
    <div
      ref={setNodeRef}
      {...(isDraggable ? { ...listeners, ...attributes } : {})}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-xs truncate ring-1 ${STATUS_RING[post.status]} bg-zinc-900/80 ${
        isDraggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${isDragging ? "opacity-30" : ""}`}
      title={`${post.socialAccount.platform}: ${post.content}`}
    >
      <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${PLATFORM_DOT[post.socialAccount.platform]}`} />
      <span className="text-zinc-300 truncate leading-tight">{post.content.slice(0, 15)}</span>
    </div>
  );
}

// Droppable hour slot
function DroppableSlot({
  date,
  hour,
  posts,
  isPast,
}: {
  date: Date;
  hour: number;
  posts: CalendarPost[];
  isPast: boolean;
}) {
  const slotId = `slot-${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}-${hour}`;
  const { isOver, setNodeRef } = useDroppable({
    id: slotId,
    data: { date, hour },
    disabled: isPast,
  });

  return (
    <div
      ref={setNodeRef}
      className={`border-b border-r border-zinc-700/50 p-0.5 min-h-[${HOUR_HEIGHT}px] ${
        isOver && !isPast ? "bg-violet-900/30" : ""
      } ${isPast && isOver ? "bg-red-950/20" : ""}`}
      style={{ height: `${HOUR_HEIGHT}px` }}
    >
      <div className="space-y-0.5">
        {posts.map((post) => (
          <WeekDraggablePost key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}

export function WeekCalendar({ posts, weekStart, onNavigate, onReschedule }: WeekCalendarProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [activePost, setActivePost] = useState<CalendarPost | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const days = getWeekDays(weekStart);
  const today = new Date();
  const todayKey = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;

  // Group posts by day and hour
  const postsBySlot = new Map<string, CalendarPost[]>();
  for (const post of posts) {
    if (!post.scheduledAt) continue;
    const d = new Date(post.scheduledAt);
    const hour = d.getUTCHours();
    const clampedHour = Math.max(START_HOUR, Math.min(END_HOUR, hour));
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}-${clampedHour}`;
    if (!postsBySlot.has(key)) postsBySlot.set(key, []);
    postsBySlot.get(key)!.push(post);
  }

  // Posts for selected day panel
  const selectedDayPosts = selectedDay
    ? posts.filter((p) => {
        if (!p.scheduledAt) return false;
        const d = new Date(p.scheduledAt);
        return (
          d.getUTCFullYear() === selectedDay.getUTCFullYear() &&
          d.getUTCMonth() === selectedDay.getUTCMonth() &&
          d.getUTCDate() === selectedDay.getUTCDate()
        );
      })
    : [];

  // Auto-scroll to current hour on mount
  useEffect(() => {
    if (scrollRef.current) {
      const currentHour = new Date().getHours();
      const targetHour = Math.max(START_HOUR, Math.min(END_HOUR, currentHour));
      const offset = (targetHour - START_HOUR) * HOUR_HEIGHT;
      scrollRef.current.scrollTop = Math.max(0, offset - HOUR_HEIGHT);
    }
  }, []);

  function prevWeek() {
    setSelectedDay(null);
    const prev = new Date(Date.UTC(
      weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() - 7
    ));
    onNavigate(prev);
  }

  function nextWeek() {
    setSelectedDay(null);
    const next = new Date(Date.UTC(
      weekStart.getUTCFullYear(), weekStart.getUTCMonth(), weekStart.getUTCDate() + 7
    ));
    onNavigate(next);
  }

  function handleDayHeaderClick(day: Date) {
    setSelectedDay((prev) => {
      if (prev && prev.getTime() === day.getTime()) return null;
      return day;
    });
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

    const targetData = over.data.current as { date: Date; hour: number } | undefined;
    if (!targetData) return;

    const { date: targetDate, hour: targetHour } = targetData;

    // Build new date with the target hour
    const newDate = new Date(Date.UTC(
      targetDate.getUTCFullYear(),
      targetDate.getUTCMonth(),
      targetDate.getUTCDate(),
      targetHour,
      0,
      0
    ));

    // Skip if same slot
    const original = new Date(post.scheduledAt);
    if (
      original.getUTCFullYear() === newDate.getUTCFullYear() &&
      original.getUTCMonth() === newDate.getUTCMonth() &&
      original.getUTCDate() === newDate.getUTCDate() &&
      original.getUTCHours() === newDate.getUTCHours()
    ) return;

    if (isPastSlot(targetDate, targetHour)) return;

    await onReschedule(post.id, newDate);
  }

  const hours = Array.from({ length: END_HOUR - START_HOUR + 1 }, (_, i) => START_HOUR + i);
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="relative rounded-lg border border-zinc-700 bg-zinc-800/50 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
            onClick={prevWeek}
            aria-label="Previous week"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-sm font-semibold text-zinc-100">
            {formatDateRange(weekStart)}
          </h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-zinc-400 hover:text-zinc-100"
            onClick={nextWeek}
            aria-label="Next week"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b border-zinc-700">
          <div className="py-2 text-center text-xs font-medium text-zinc-500" />
          {days.map((day, i) => {
            const dayKey = `${day.getUTCFullYear()}-${day.getUTCMonth()}-${day.getUTCDate()}`;
            const isToday = dayKey === todayKey;
            return (
              <button
                key={dayKey}
                type="button"
                onClick={() => handleDayHeaderClick(day)}
                className={`py-2 text-center transition-colors hover:bg-zinc-700/30 ${
                  isToday ? "bg-violet-950/20" : ""
                }`}
              >
                <div className="text-xs font-medium text-zinc-500">{DAY_NAMES[i]}</div>
                <div className={`text-sm font-semibold mt-0.5 ${
                  isToday ? "text-violet-400" : "text-zinc-300"
                }`}>
                  {day.getUTCDate()}
                </div>
              </button>
            );
          })}
        </div>

        {/* Time grid */}
        <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: `${8 * HOUR_HEIGHT}px` }}>
          <div className="grid grid-cols-[60px_repeat(7,1fr)]">
            {hours.map((hour) => (
              <div key={`row-${hour}`} className="contents">
                {/* Hour label */}
                <div
                  className="border-b border-r border-zinc-700/50 px-2 flex items-start justify-end pt-1"
                  style={{ height: `${HOUR_HEIGHT}px` }}
                >
                  <span className="text-xs text-zinc-500">{formatHour(hour)}</span>
                </div>
                {/* Day columns */}
                {days.map((day) => {
                  const slotKey = `${day.getUTCFullYear()}-${day.getUTCMonth()}-${day.getUTCDate()}-${hour}`;
                  const slotPosts = postsBySlot.get(slotKey) ?? [];
                  const past = isPastSlot(day, hour);

                  return (
                    <DroppableSlot
                      key={slotKey}
                      date={day}
                      hour={hour}
                      posts={slotPosts}
                      isPast={past}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Day detail panel */}
        {selectedDay && (
          <DayDetailPanel
            date={selectedDay}
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

export { getMondayOfWeek };
