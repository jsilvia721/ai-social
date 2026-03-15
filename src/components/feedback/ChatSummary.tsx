"use client";

import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2 } from "lucide-react";
import type { FeedbackClassification } from "@/lib/feedback-formatter";

export interface SummaryData {
  classification: FeedbackClassification;
  title: string;
  description: string;
  priority: string;
}

interface ChatSummaryProps {
  summary: SummaryData;
  onConfirm: () => void;
  onCorrect: () => void;
  isSubmitting?: boolean;
}

const CLASSIFICATION_LABELS: Record<FeedbackClassification, string> = {
  bug: "Bug Report",
  feature: "Feature Request",
  general: "General Feedback",
};

const CLASSIFICATION_COLORS: Record<FeedbackClassification, string> = {
  bug: "bg-red-900/30 text-red-400 border-red-800/50",
  feature: "bg-emerald-900/30 text-emerald-400 border-emerald-800/50",
  general: "bg-blue-900/30 text-blue-400 border-blue-800/50",
};

/**
 * Renders the AI's final summary as a distinct card with confirm/correct actions.
 */
export function ChatSummary({
  summary,
  onConfirm,
  onCorrect,
  isSubmitting,
}: ChatSummaryProps) {
  return (
    <div
      data-testid="chat-summary"
      className="rounded-xl border border-zinc-700 bg-zinc-800/50 p-4 space-y-3"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        <span className="text-sm font-medium text-zinc-200">
          Summary ready for review
        </span>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border ${CLASSIFICATION_COLORS[summary.classification]}`}
          >
            {CLASSIFICATION_LABELS[summary.classification]}
          </span>
          <span className="text-xs text-zinc-500 capitalize">
            {summary.priority} priority
          </span>
        </div>

        <h4 className="font-medium text-zinc-100">{summary.title}</h4>
        <p className="text-zinc-400 leading-relaxed">{summary.description}</p>
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={onConfirm}
          disabled={isSubmitting}
          aria-label="Looks good"
        >
          {isSubmitting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : null}
          Looks good!
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onCorrect}
          disabled={isSubmitting}
          aria-label="Not quite"
        >
          Not quite
        </Button>
      </div>
    </div>
  );
}
