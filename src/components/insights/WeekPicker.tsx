"use client";

import { useRouter } from "next/navigation";

interface WeekPickerProps {
  weeks: { weekOf: string; label: string }[];
  selected: string;
}

export function WeekPicker({ weeks, selected }: WeekPickerProps) {
  const router = useRouter();

  if (weeks.length <= 1) return null;

  return (
    <select
      value={selected}
      onChange={(e) => router.push(`/dashboard/insights?week=${e.target.value}`)}
      className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:ring-2 focus:ring-violet-500"
    >
      {weeks.map(({ weekOf, label }, i) => (
        <option key={weekOf} value={weekOf}>
          {label}{i === 0 ? " (Latest)" : ""}
        </option>
      ))}
    </select>
  );
}
