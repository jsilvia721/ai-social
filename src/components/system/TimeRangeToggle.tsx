"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";

type Range = "24h" | "7d" | "30d";

const RANGES: { value: Range; label: string }[] = [
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
];

function isValidRange(value: string | null): value is Range {
  return value != null && RANGES.some((r) => r.value === value);
}

export function TimeRangeToggle() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawRange = searchParams.get("range");
  const current: Range = isValidRange(rawRange) ? rawRange : "24h";

  function handleClick(range: Range) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("range", range);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="flex gap-1 rounded-lg bg-zinc-900 p-1">
      {RANGES.map(({ value, label }) => (
        <button
          key={value}
          onClick={() => handleClick(value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            current === value
              ? "bg-violet-600 text-white"
              : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
