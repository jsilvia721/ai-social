"use client";

import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Pencil,
  Save,
  X,
  Plus,
  Trash2,
  Loader2,
} from "lucide-react";
import type { Prisma } from "@prisma/client";
import { PLATFORM_FORMATS } from "@/lib/strategy/schemas";

// ── Types ────────────────────────────────────────────────────────────────────

type SectionKey = "core" | "publishing" | "research";
type SectionState = "viewing" | "editing" | "saving" | "error";

interface Strategy {
  industry: string;
  targetAudience: string;
  contentPillars: string[];
  brandVoice: string;
  optimizationGoal: string;
  reviewWindowEnabled: boolean;
  reviewWindowHours: number;
  postingCadence: Prisma.JsonValue;
  formatMix: Prisma.JsonValue;
  researchSources: Prisma.JsonValue;
  optimalTimeWindows: Prisma.JsonValue;
  lastOptimizedAt: string | null;
  updatedAt: string;
}

interface Props {
  initialStrategy: Strategy;
  businessId: string;
  isOwner: boolean;
}

const GOAL_OPTIONS = [
  { value: "ENGAGEMENT", label: "Engagement" },
  { value: "REACH", label: "Reach" },
  { value: "CONVERSIONS", label: "Conversions" },
  { value: "BRAND_AWARENESS", label: "Brand Awareness" },
];

const PLATFORMS = ["TWITTER", "INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"] as const;

type ReviewMode = "always_human" | "timed_auto" | "immediate";

function getReviewMode(enabled: boolean, hours: number): ReviewMode {
  if (!enabled) return "always_human";
  if (hours === 0) return "immediate";
  return "timed_auto";
}

function reviewModeToFields(mode: ReviewMode, hours: number): { reviewWindowEnabled: boolean; reviewWindowHours: number } {
  switch (mode) {
    case "always_human": return { reviewWindowEnabled: false, reviewWindowHours: hours || 24 };
    case "timed_auto": return { reviewWindowEnabled: true, reviewWindowHours: Math.max(hours, 1) };
    case "immediate": return { reviewWindowEnabled: true, reviewWindowHours: 0 };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Parse postingCadence JSON: { platform: number | null } */
function asCadenceRecord(val: Prisma.JsonValue): Record<string, number | null> {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, number | null>;
  }
  return {};
}

/** Parse formatMix JSON: { platform: { format: weight } | null } */
function asFormatMixRecord(val: Prisma.JsonValue): Record<string, Record<string, number> | null> {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    return val as Record<string, Record<string, number> | null>;
  }
  return {};
}

/** Compute percentage from weight within a platform's format weights */
function weightToPercent(weight: number, totalWeight: number): number {
  if (totalWeight === 0) return 0;
  return Math.round((weight / totalWeight) * 100);
}

/** Capitalize first letter, lowercase the rest */
function capitalize(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

function asResearchSources(val: Prisma.JsonValue): {
  rssFeeds: string[];
  subreddits: string[];
} {
  if (val && typeof val === "object" && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    return {
      rssFeeds: Array.isArray(obj.rssFeeds)
        ? (obj.rssFeeds as string[])
        : [],
      subreddits: Array.isArray(obj.subreddits)
        ? (obj.subreddits as string[])
        : [],
    };
  }
  return { rssFeeds: [], subreddits: [] };
}


// ── Component ────────────────────────────────────────────────────────────────

export function StrategyClient({ initialStrategy, businessId, isOwner }: Props) {
  // Committed state (last saved / server truth)
  const [committed, setCommitted] = useState<Strategy>(initialStrategy);

  // Per-section state machine
  const [sectionStates, setSectionStates] = useState<Record<SectionKey, SectionState>>({
    core: "viewing",
    publishing: "viewing",
    research: "viewing",
  });

  // Per-section error messages
  const [errors, setErrors] = useState<Record<SectionKey, string | null>>({
    core: null,
    publishing: null,
    research: null,
  });

  // Draft state for each section (populated when editing)
  const [coreDraft, setCoreDraft] = useState({
    industry: committed.industry,
    targetAudience: committed.targetAudience,
    contentPillars: [...committed.contentPillars],
    brandVoice: committed.brandVoice,
    optimizationGoal: committed.optimizationGoal,
  });

  const [pubDraft, setPubDraft] = useState({
    reviewWindowEnabled: committed.reviewWindowEnabled,
    reviewWindowHours: committed.reviewWindowHours,
    postingCadence: asCadenceRecord(committed.postingCadence),
    formatMix: asFormatMixRecord(committed.formatMix),
  });

  const [resDraft, setResDraft] = useState(asResearchSources(committed.researchSources));

  // Double-click guards (refs, not state)
  const saveInFlight = useRef<Record<SectionKey, boolean>>({
    core: false,
    publishing: false,
    research: false,
  });

  // ── Section transitions ──────────────────────────────────────────────────

  function startEdit(section: SectionKey) {
    if (sectionStates[section] !== "viewing") return;
    // Snapshot current committed values into drafts
    if (section === "core") {
      setCoreDraft({
        industry: committed.industry,
        targetAudience: committed.targetAudience,
        contentPillars: [...committed.contentPillars],
        brandVoice: committed.brandVoice,
        optimizationGoal: committed.optimizationGoal,
      });
    } else if (section === "publishing") {
      setPubDraft({
        reviewWindowEnabled: committed.reviewWindowEnabled,
        reviewWindowHours: committed.reviewWindowHours,
        postingCadence: { ...asCadenceRecord(committed.postingCadence) },
        formatMix: structuredClone(asFormatMixRecord(committed.formatMix)),
      });
    } else {
      setResDraft({ ...asResearchSources(committed.researchSources) });
    }
    setSectionStates((s) => ({ ...s, [section]: "editing" }));
    setErrors((e) => ({ ...e, [section]: null }));
  }

  function cancelEdit(section: SectionKey) {
    setSectionStates((s) => ({ ...s, [section]: "viewing" }));
    setErrors((e) => ({ ...e, [section]: null }));
  }

  const handleSave = useCallback(
    async (section: SectionKey) => {
      if (saveInFlight.current[section]) return;
      saveInFlight.current[section] = true;
      setSectionStates((s) => ({ ...s, [section]: "saving" }));
      setErrors((e) => ({ ...e, [section]: null }));

      // Build patch payload
      let patchData: Record<string, unknown> = {};
      if (section === "core") {
        patchData = { ...coreDraft };
      } else if (section === "publishing") {
        patchData = { ...pubDraft };
      } else {
        patchData = { researchSources: resDraft };
      }

      try {
        const res = await fetch(`/api/businesses/${businessId}/strategy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            updatedAt: committed.updatedAt,
            ...patchData,
          }),
        });

        if (res.status === 409) {
          setErrors((e) => ({
            ...e,
            [section]:
              "Settings were modified since you loaded them. Please refresh the page.",
          }));
          setSectionStates((s) => ({ ...s, [section]: "error" }));
          return;
        }

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Failed to save");
        }

        const updated = (await res.json()) as Strategy;
        // Update committed state with server response (only this section's fields + updatedAt)
        setCommitted((prev) => ({ ...prev, ...updated }));
        setSectionStates((s) => ({ ...s, [section]: "viewing" }));
      } catch (err) {
        setErrors((e) => ({
          ...e,
          [section]: err instanceof Error ? err.message : "Failed to save",
        }));
        setSectionStates((s) => ({ ...s, [section]: "error" }));
      } finally {
        saveInFlight.current[section] = false;
      }
    },
    [businessId, committed.updatedAt, coreDraft, pubDraft, resDraft]
  );

  // ── Render helpers ─────────────────────────────────────────────────────

  function SectionHeader({
    title,
    section,
  }: {
    title: string;
    section: SectionKey;
  }) {
    const state = sectionStates[section];
    return (
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-lg text-zinc-100">{title}</CardTitle>
        {isOwner && (
          <div className="flex items-center gap-2">
            {state === "viewing" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => startEdit(section)}
                className="text-zinc-400 hover:text-zinc-200"
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit
              </Button>
            )}
            {(state === "editing" || state === "error") && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => cancelEdit(section)}
                  className="text-zinc-400 hover:text-zinc-200"
                >
                  <X className="h-3.5 w-3.5 mr-1.5" />
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleSave(section)}
                  className="bg-violet-600 hover:bg-violet-700"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  Save
                </Button>
              </>
            )}
            {state === "saving" && (
              <Button size="sm" disabled className="bg-violet-600/60">
                <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                Saving...
              </Button>
            )}
          </div>
        )}
      </CardHeader>
    );
  }

  function ErrorBanner({ section }: { section: SectionKey }) {
    const msg = errors[section];
    if (!msg) return null;
    return (
      <div className="mx-6 mb-4 rounded-lg bg-red-900/20 border border-red-800 px-4 py-3 text-sm text-red-400">
        {msg}
      </div>
    );
  }

  // ── Section: Core Strategy ─────────────────────────────────────────────

  const coreEditing = sectionStates.core !== "viewing";

  function CoreSection() {
    return (
      <Card className="bg-zinc-800 border-zinc-700">
        <SectionHeader title="Core Strategy" section="core" />
        <ErrorBanner section="core" />
        <CardContent className="space-y-5">
          <Field label="Industry">
            {coreEditing ? (
              <Input
                value={coreDraft.industry}
                onChange={(e) =>
                  setCoreDraft((d) => ({ ...d, industry: e.target.value }))
                }
                maxLength={200}
                className="bg-zinc-700 border-zinc-600"
              />
            ) : (
              <p className="text-zinc-300">{committed.industry}</p>
            )}
          </Field>

          <Field label="Target Audience">
            {coreEditing ? (
              <Textarea
                value={coreDraft.targetAudience}
                onChange={(e) =>
                  setCoreDraft((d) => ({ ...d, targetAudience: e.target.value }))
                }
                maxLength={1000}
                rows={3}
                className="bg-zinc-700 border-zinc-600 resize-none"
              />
            ) : (
              <p className="text-zinc-300">{committed.targetAudience}</p>
            )}
          </Field>

          <Field
            label="Content Pillars"
            description="The core topics and themes your content revolves around. These guide AI-generated briefs to stay on-brand and cover a balanced mix of subjects."
          >
            {coreEditing ? (
              <TagEditor
                tags={coreDraft.contentPillars}
                onChange={(tags) =>
                  setCoreDraft((d) => ({ ...d, contentPillars: tags }))
                }
                maxTags={10}
                maxLength={100}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                {committed.contentPillars.map((p) => (
                  <span
                    key={p}
                    className="rounded-full bg-violet-600/20 px-3 py-1 text-sm text-violet-300"
                  >
                    {p}
                  </span>
                ))}
              </div>
            )}
          </Field>

          <Field label="Brand Voice">
            {coreEditing ? (
              <Textarea
                value={coreDraft.brandVoice}
                onChange={(e) =>
                  setCoreDraft((d) => ({ ...d, brandVoice: e.target.value }))
                }
                maxLength={2000}
                rows={4}
                className="bg-zinc-700 border-zinc-600 resize-none"
              />
            ) : (
              <p className="text-zinc-300 whitespace-pre-wrap">
                {committed.brandVoice}
              </p>
            )}
          </Field>

          <Field label="Optimization Goal">
            {coreEditing ? (
              <select
                value={coreDraft.optimizationGoal}
                onChange={(e) =>
                  setCoreDraft((d) => ({ ...d, optimizationGoal: e.target.value }))
                }
                className="w-full rounded-md bg-zinc-700 border border-zinc-600 px-3 py-2 text-sm text-zinc-100"
              >
                {GOAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-zinc-300">
                {GOAL_OPTIONS.find(
                  (o) => o.value === committed.optimizationGoal
                )?.label ?? committed.optimizationGoal}
              </p>
            )}
          </Field>
        </CardContent>
      </Card>
    );
  }

  // ── Section: Publishing Config ─────────────────────────────────────────

  const pubEditing = sectionStates.publishing !== "viewing";
  const cadence = pubEditing
    ? pubDraft.postingCadence
    : asCadenceRecord(committed.postingCadence);
  const fmix = pubEditing
    ? pubDraft.formatMix
    : asFormatMixRecord(committed.formatMix);

  function PublishingSection() {
    const reviewMode = pubEditing
      ? getReviewMode(pubDraft.reviewWindowEnabled, pubDraft.reviewWindowHours)
      : getReviewMode(committed.reviewWindowEnabled, committed.reviewWindowHours);

    function setReviewMode(mode: ReviewMode) {
      const fields = reviewModeToFields(mode, pubDraft.reviewWindowHours);
      setPubDraft((d) => ({ ...d, ...fields }));
    }

    const configuredCadencePlatforms = Object.keys(cadence);
    const unusedCadencePlatforms = PLATFORMS.filter((p) => !(p in cadence));
    const configuredMixPlatforms = Object.keys(fmix);
    const unusedMixPlatforms = PLATFORMS.filter((p) => !(p in fmix));

    return (
      <Card className="bg-zinc-800 border-zinc-700">
        <SectionHeader title="Publishing Config" section="publishing" />
        <ErrorBanner section="publishing" />
        <CardContent className="space-y-5">
          {/* Review Mode */}
          <Field label="Review Mode">
            {pubEditing ? (
              <div className="space-y-2">
                <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-zinc-700 p-3 hover:bg-zinc-700/30 transition-colors">
                  <input
                    type="radio"
                    name="reviewMode"
                    checked={reviewMode === "always_human"}
                    onChange={() => setReviewMode("always_human")}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Always require human review</p>
                    <p className="text-xs text-zinc-500">Posts stay in review until manually approved or rejected</p>
                  </div>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-zinc-700 p-3 hover:bg-zinc-700/30 transition-colors">
                  <input
                    type="radio"
                    name="reviewMode"
                    checked={reviewMode === "timed_auto"}
                    onChange={() => setReviewMode("timed_auto")}
                    className="mt-0.5"
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-zinc-200">Auto-approve after delay</p>
                    <p className="text-xs text-zinc-500">Posts auto-approve if not reviewed within the window</p>
                    {reviewMode === "timed_auto" && (
                      <div className="flex items-center gap-2 mt-2">
                        <Input
                          type="number"
                          min={1}
                          max={168}
                          value={pubDraft.reviewWindowHours}
                          onChange={(e) =>
                            setPubDraft((d) => ({
                              ...d,
                              reviewWindowHours: parseInt(e.target.value) || 1,
                            }))
                          }
                          className="w-20 bg-zinc-700 border-zinc-600"
                        />
                        <span className="text-sm text-zinc-400">hours</span>
                      </div>
                    )}
                  </div>
                </label>
                <label className="flex items-start gap-2.5 cursor-pointer rounded-lg border border-zinc-700 p-3 hover:bg-zinc-700/30 transition-colors">
                  <input
                    type="radio"
                    name="reviewMode"
                    checked={reviewMode === "immediate"}
                    onChange={() => setReviewMode("immediate")}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-zinc-200">Automatic (no review)</p>
                    <p className="text-xs text-zinc-500">Posts publish immediately without review</p>
                  </div>
                </label>
              </div>
            ) : (
              <p className="text-zinc-300">
                {reviewMode === "always_human" && "Always require human review"}
                {reviewMode === "timed_auto" && `Auto-approve after ${committed.reviewWindowHours}h if not reviewed`}
                {reviewMode === "immediate" && "Automatic — posts publish without review"}
              </p>
            )}
          </Field>

          {/* Posting Cadence — per platform with AI toggle */}
          <Field
            label="Posting Cadence"
            description="Set the number of posts per week for each platform, or let AI optimize automatically."
          >
            <div className="space-y-2">
              {configuredCadencePlatforms.map((platform) => {
                const value = cadence[platform];
                const isAI = value === null;
                return (
                  <div
                    key={platform}
                    className="flex items-center gap-3 rounded-lg border border-zinc-700 p-3"
                  >
                    <span className="text-sm font-medium text-zinc-200 w-24">
                      {capitalize(platform)}
                    </span>
                    {pubEditing ? (
                      <div className="flex items-center gap-3 flex-1">
                        <label className="flex items-center gap-1.5 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isAI}
                            onChange={(e) =>
                              setPubDraft((d) => ({
                                ...d,
                                postingCadence: {
                                  ...d.postingCadence,
                                  [platform]: e.target.checked ? null : 3,
                                },
                              }))
                            }
                            className="rounded"
                          />
                          <span className="text-xs text-zinc-400">AI optimized</span>
                        </label>
                        {!isAI && (
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={0}
                              max={30}
                              value={value ?? 3}
                              onChange={(e) =>
                                setPubDraft((d) => ({
                                  ...d,
                                  postingCadence: {
                                    ...d.postingCadence,
                                    [platform]: parseInt(e.target.value) || 0,
                                  },
                                }))
                              }
                              className="w-16 bg-zinc-700 border-zinc-600"
                            />
                            <span className="text-xs text-zinc-400">posts/week</span>
                          </div>
                        )}
                        <button
                          onClick={() =>
                            setPubDraft((d) => {
                              const { [platform]: _, ...rest } = d.postingCadence;
                              return { ...d, postingCadence: rest };
                            })
                          }
                          className="ml-auto text-zinc-500 hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <span className="text-sm text-zinc-300">
                        {isAI ? "AI optimized" : `${value} posts/week`}
                      </span>
                    )}
                  </div>
                );
              })}
              {!pubEditing && configuredCadencePlatforms.length === 0 && (
                <p className="text-sm text-zinc-500">Not configured</p>
              )}
              {pubEditing && unusedCadencePlatforms.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {unusedCadencePlatforms.map((p) => (
                    <Button
                      key={p}
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPubDraft((d) => ({
                          ...d,
                          postingCadence: { ...d.postingCadence, [p]: 3 },
                        }))
                      }
                      className="text-violet-400 text-xs"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {capitalize(p)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </Field>

          {/* Format Mix — per platform with weight sliders */}
          <Field
            label="Format Mix"
            description="Set relative weights for each content format per platform. Percentages are calculated automatically from the weights you assign."
          >
            <div className="space-y-4">
              {configuredMixPlatforms.map((platform) => {
                const platformWeights = fmix[platform];
                const isAI = platformWeights === null;
                const validFormats = PLATFORM_FORMATS[platform] ?? [];
                const totalWeight = isAI
                  ? 0
                  : Object.values(platformWeights ?? {}).reduce((a, b) => a + b, 0);

                return (
                  <div
                    key={platform}
                    className="rounded-lg border border-zinc-700 p-3 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-zinc-200">
                        {capitalize(platform)}
                      </span>
                      <div className="flex items-center gap-2">
                        {pubEditing && (
                          <>
                            <label className="flex items-center gap-1.5 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={isAI}
                                onChange={(e) =>
                                  setPubDraft((d) => ({
                                    ...d,
                                    formatMix: {
                                      ...d.formatMix,
                                      [platform]: e.target.checked
                                        ? null
                                        : Object.fromEntries(
                                            validFormats.map((f) => [f, 1])
                                          ),
                                    },
                                  }))
                                }
                                className="rounded"
                              />
                              <span className="text-xs text-zinc-400">AI optimized</span>
                            </label>
                            <button
                              onClick={() =>
                                setPubDraft((d) => {
                                  const { [platform]: _, ...rest } = d.formatMix;
                                  return { ...d, formatMix: rest };
                                })
                              }
                              className="text-zinc-500 hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {isAI ? (
                      <p className="text-xs text-zinc-500">AI will determine the best format mix for this platform</p>
                    ) : (
                      <div className="space-y-2">
                        {validFormats.map((format) => {
                          const weight = platformWeights?.[format] ?? 0;
                          const pct = weightToPercent(weight, totalWeight);

                          return (
                            <div key={format} className="flex items-center gap-3">
                              <span className="text-xs text-zinc-400 w-16">
                                {capitalize(format)}
                              </span>
                              {pubEditing ? (
                                <>
                                  <input
                                    type="range"
                                    min={0}
                                    max={10}
                                    step={1}
                                    value={weight}
                                    onChange={(e) =>
                                      setPubDraft((d) => ({
                                        ...d,
                                        formatMix: {
                                          ...d.formatMix,
                                          [platform]: {
                                            ...(d.formatMix[platform] ?? {}),
                                            [format]: parseInt(e.target.value),
                                          },
                                        },
                                      }))
                                    }
                                    className="flex-1 h-1.5 accent-violet-500 bg-zinc-700 rounded-full cursor-pointer appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-violet-500 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-zinc-700"
                                  />
                                  <span className="text-xs text-zinc-400 w-8 text-right tabular-nums">
                                    {weight}
                                  </span>
                                  <span className="text-xs text-zinc-500 w-10 text-right tabular-nums">
                                    {pct}%
                                  </span>
                                </>
                              ) : (
                                <>
                                  <div className="flex-1 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-violet-500 rounded-full"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-zinc-300 w-10 text-right tabular-nums">
                                    {pct}%
                                  </span>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {!pubEditing && configuredMixPlatforms.length === 0 && (
                <p className="text-sm text-zinc-500">Not configured</p>
              )}
              {pubEditing && unusedMixPlatforms.length > 0 && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {unusedMixPlatforms.map((p) => (
                    <Button
                      key={p}
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setPubDraft((d) => ({
                          ...d,
                          formatMix: {
                            ...d.formatMix,
                            [p]: Object.fromEntries(
                              (PLATFORM_FORMATS[p] ?? []).map((f) => [f, 1])
                            ),
                          },
                        }))
                      }
                      className="text-violet-400 text-xs"
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {capitalize(p)}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </Field>
        </CardContent>
      </Card>
    );
  }

  // ── Section: Research Sources ───────────────────────────────────────────

  const resEditing = sectionStates.research !== "viewing";
  const sources = resEditing
    ? resDraft
    : asResearchSources(committed.researchSources);

  function ResearchSection() {
    return (
      <Card className="bg-zinc-800 border-zinc-700">
        <SectionHeader title="Research Sources" section="research" />
        <ErrorBanner section="research" />
        <CardContent className="space-y-5">
          <Field label="RSS Feeds">
            {resEditing ? (
              <ListEditor
                items={resDraft.rssFeeds}
                onChange={(feeds) => setResDraft((d) => ({ ...d, rssFeeds: feeds }))}
                placeholder="https://blog.example.com/feed.xml"
                validateItem={(url) => {
                  try {
                    new URL(url);
                    return url.startsWith("https://") ? null : "Must use HTTPS";
                  } catch {
                    return "Invalid URL";
                  }
                }}
              />
            ) : sources.rssFeeds.length > 0 ? (
              <ul className="space-y-1">
                {sources.rssFeeds.map((url) => (
                  <li key={url} className="text-sm text-zinc-300 truncate">
                    {url}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-500">No RSS feeds configured</p>
            )}
          </Field>

          <Field label="Subreddits">
            {resEditing ? (
              <ListEditor
                items={resDraft.subreddits}
                onChange={(subs) =>
                  setResDraft((d) => ({ ...d, subreddits: subs }))
                }
                placeholder="marketing"
                prefix="r/"
                validateItem={(name) =>
                  /^[a-zA-Z0-9_]+$/.test(name)
                    ? null
                    : "Letters, numbers, and underscores only"
                }
              />
            ) : sources.subreddits.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {sources.subreddits.map((sub) => (
                  <span
                    key={sub}
                    className="rounded-full bg-zinc-700 px-3 py-1 text-sm text-zinc-300"
                  >
                    r/{sub}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">No subreddits configured</p>
            )}
          </Field>
        </CardContent>
      </Card>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────

  return (
    <div className="py-2 md:px-6 md:py-6">
      <div className="flex flex-col gap-1 mb-6">
        <h1 className="text-2xl font-bold text-zinc-50">Content Strategy</h1>
        {committed.lastOptimizedAt && (
          <p className="text-sm text-zinc-500">
            Last optimized:{" "}
            {new Date(committed.lastOptimizedAt).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        )}
      </div>

      <div className="space-y-6">
        <CoreSection />
        <PublishingSection />
        <ResearchSection />
      </div>
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-zinc-400 mb-0.5">{label}</p>
      {description && (
        <p className="text-xs text-zinc-500 mb-2">{description}</p>
      )}
      {!description && <div className="mb-1" />}
      {children}
    </div>
  );
}

function TagEditor({
  tags,
  onChange,
  maxTags,
  maxLength,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  maxTags: number;
  maxLength: number;
}) {
  const [input, setInput] = useState("");

  function addTag() {
    const trimmed = input.trim();
    if (!trimmed || tags.includes(trimmed) || tags.length >= maxTags) return;
    onChange([...tags, trimmed]);
    setInput("");
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <span
            key={tag}
            className="flex items-center gap-1 rounded-full bg-violet-600/20 px-3 py-1 text-sm text-violet-300"
          >
            {tag}
            <button
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="text-violet-400 hover:text-violet-200"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      {tags.length < maxTags && (
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={maxLength}
            placeholder="Add a content pillar..."
            className="bg-zinc-700 border-zinc-600"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTag();
              }
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={addTag}
            disabled={!input.trim()}
            className="text-violet-400"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

function ListEditor({
  items,
  onChange,
  placeholder,
  prefix,
  validateItem,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  prefix?: string;
  validateItem?: (item: string) => string | null;
}) {
  const [input, setInput] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  function addItem() {
    const trimmed = input.trim();
    if (!trimmed || items.includes(trimmed)) return;
    if (validateItem) {
      const err = validateItem(trimmed);
      if (err) {
        setValidationError(err);
        return;
      }
    }
    onChange([...items, trimmed]);
    setInput("");
    setValidationError(null);
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item} className="flex items-center gap-2">
          <span className="flex-1 text-sm text-zinc-300 truncate">
            {prefix}
            {item}
          </span>
          <button
            onClick={() => onChange(items.filter((i) => i !== item))}
            className="text-zinc-500 hover:text-red-400"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <Input
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setValidationError(null);
          }}
          placeholder={placeholder}
          className="bg-zinc-700 border-zinc-600"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={addItem}
          disabled={!input.trim()}
          className="text-violet-400"
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>
      {validationError && (
        <p className="text-xs text-red-400">{validationError}</p>
      )}
    </div>
  );
}
