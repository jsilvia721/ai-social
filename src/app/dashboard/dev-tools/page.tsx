"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import {
  Users,
  FileText,
  BarChart2,
  FlaskConical,
  Layers,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";

interface SeedAction {
  id: string;
  label: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  variant: "default" | "destructive";
}

const SEED_ACTIONS: SeedAction[] = [
  {
    id: "seed-accounts",
    label: "Social Accounts",
    description:
      "Creates 5 accounts — one for each platform (Twitter, Instagram, Facebook, TikTok, YouTube)",
    icon: Users,
    variant: "default",
  },
  {
    id: "seed-posts",
    label: "Posts",
    description:
      "Creates 11 posts across all statuses — drafts, scheduled, published (with metrics), failed, and pending review",
    icon: FileText,
    variant: "default",
  },
  {
    id: "seed-research",
    label: "Research Summary",
    description:
      "Creates a research summary with Google Trends, RSS, and Reddit data plus AI-synthesized themes",
    icon: BarChart2,
    variant: "default",
  },
  {
    id: "seed-briefs",
    label: "Content Briefs",
    description:
      "Creates 6 content briefs across platforms and statuses — pending, fulfilled, and expired",
    icon: FlaskConical,
    variant: "default",
  },
  {
    id: "seed-all",
    label: "Seed Everything",
    description:
      "Creates all of the above at once — accounts, posts, research, and briefs",
    icon: Layers,
    variant: "default",
  },
  {
    id: "clear",
    label: "Clear Workspace Data",
    description:
      "Deletes all posts, accounts, briefs, research, and content strategy for this workspace",
    icon: Trash2,
    variant: "destructive",
  },
];

interface ActionResult {
  status: "success" | "error";
  message: string;
}

export default function DevToolsPage() {
  const { data: session } = useSession();
  const [loading, setLoading] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, ActionResult>>({});
  const [confirmClear, setConfirmClear] = useState(false);

  const activeBusinessId = session?.user?.activeBusinessId;

  async function handleAction(actionId: string) {
    if (actionId === "clear" && !confirmClear) {
      setConfirmClear(true);
      return;
    }

    setLoading(actionId);
    setConfirmClear(false);
    setResults((prev) => {
      const next = { ...prev };
      delete next[actionId];
      return next;
    });

    try {
      const res = await fetch("/api/dev/seed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionId, businessId: activeBusinessId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResults((prev) => ({
          ...prev,
          [actionId]: { status: "error", message: data.error || "Failed" },
        }));
      } else {
        setResults((prev) => ({
          ...prev,
          [actionId]: { status: "success", message: data.message },
        }));
      }
    } catch {
      setResults((prev) => ({
        ...prev,
        [actionId]: { status: "error", message: "Network error" },
      }));
    } finally {
      setLoading(null);
    }
  }

  if (!activeBusinessId) {
    return (
      <div className="text-zinc-400 text-sm">
        Select a workspace first to use dev tools.
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Dev Tools</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Seed test data into the active workspace. Only available in
          staging and local development.
        </p>
      </div>

      <div className="grid gap-3">
        {SEED_ACTIONS.map((action) => {
          const Icon = action.icon;
          const result = results[action.id];
          const isLoading = loading === action.id;
          const isDestructive = action.variant === "destructive";
          const showConfirm = action.id === "clear" && confirmClear;

          return (
            <div
              key={action.id}
              className="flex items-start gap-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4"
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                  isDestructive ? "bg-red-900/40" : "bg-violet-900/40"
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${isDestructive ? "text-red-400" : "text-violet-400"}`}
                />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200">
                  {action.label}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {action.description}
                </p>
                {result && (
                  <div
                    className={`mt-2 flex items-center gap-1.5 text-xs ${
                      result.status === "success"
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {result.status === "success" ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <AlertCircle className="h-3.5 w-3.5" />
                    )}
                    {result.message}
                  </div>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                {showConfirm ? (
                  <>
                    <button
                      onClick={() => handleAction(action.id)}
                      disabled={isLoading}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-600"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => handleAction(action.id)}
                    disabled={loading !== null}
                    className={`rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${
                      isDestructive
                        ? "bg-red-900/60 text-red-300 hover:bg-red-900/80"
                        : "bg-violet-600 text-white hover:bg-violet-500"
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isDestructive ? (
                      "Clear"
                    ) : (
                      "Seed"
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
