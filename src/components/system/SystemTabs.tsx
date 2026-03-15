"use client";

import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";

type Tab = "health" | "schedules";

const TABS: { label: string; value: Tab }[] = [
  { label: "Health", value: "health" },
  { label: "Schedules", value: "schedules" },
];

function isValidTab(value: string): value is Tab {
  return value === "health" || value === "schedules";
}

interface SystemTabsProps {
  healthContent: ReactNode;
  schedulesContent: ReactNode;
}

export function SystemTabs({ healthContent, schedulesContent }: SystemTabsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab") ?? "health";
  const activeTab: Tab = isValidTab(tabParam) ? tabParam : "health";

  function handleTabChange(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.push(`?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      {/* Tab bar */}
      <div
        className="flex gap-1 border-b border-zinc-800"
        role="tablist"
        aria-label="System tabs"
      >
        {TABS.map(({ label, value }) => (
          <button
            key={value}
            role="tab"
            aria-selected={activeTab === value}
            onClick={() => handleTabChange(value)}
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

      {/* Tab content */}
      <div role="tabpanel">
        {activeTab === "health" ? healthContent : schedulesContent}
      </div>
    </div>
  );
}
