"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  CronConfigItem,
  CronName,
  IntervalUnit,
  DayOfWeek,
} from "@/components/system/types";
import {
  CRON_DESCRIPTIONS,
  RATE_CRON_NAMES,
  WEEKLY_CRON_NAMES,
  INTERVAL_LIMITS,
} from "@/components/system/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DAY_LABELS: Record<DayOfWeek, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

const ALL_DAYS: DayOfWeek[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function isIntervalUnit(v: string): v is IntervalUnit {
  return v === "minutes" || v === "hours";
}

function isDayOfWeek(v: string): v is DayOfWeek {
  return ALL_DAYS.includes(v as DayOfWeek);
}

function formatSchedule(config: CronConfigItem): string {
  if (config.scheduleType === "rate" && config.intervalValue && config.intervalUnit) {
    const unit = config.intervalUnit === "hours" && config.intervalValue === 1
      ? "hour"
      : config.intervalUnit === "minutes" && config.intervalValue === 1
        ? "minute"
        : config.intervalUnit;
    return `Every ${config.intervalValue} ${unit}`;
  }
  if (config.scheduleType === "cron" && config.dayOfWeek && config.hourUtc !== null) {
    return `${DAY_LABELS[config.dayOfWeek]} at ${String(config.hourUtc).padStart(2, "0")}:00 UTC`;
  }
  return config.scheduleExpression;
}

function formatRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now"; // handles future dates too
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function validateRateInterval(
  cronName: CronName,
  value: number,
  unit: IntervalUnit
): string | null {
  const limits = INTERVAL_LIMITS[cronName];
  if (!limits) return null;
  const inMinutes = unit === "hours" ? value * 60 : value;
  if (inMinutes < limits.min) {
    return `Minimum: ${limits.min} minutes`;
  }
  if (inMinutes > limits.max) {
    return `Maximum: ${limits.max} minutes`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// CronCard sub-component
// ---------------------------------------------------------------------------

interface CronCardProps {
  config: CronConfigItem;
  onToggle: (cronName: CronName, enabled: boolean) => void;
  onSave: (
    cronName: CronName,
    update: {
      intervalValue?: number;
      intervalUnit?: IntervalUnit;
      dayOfWeek?: DayOfWeek;
      hourUtc?: number;
    }
  ) => Promise<boolean>;
}

function CronCard({ config, onToggle, onSave }: CronCardProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Rate cron editing state
  const [editValue, setEditValue] = useState(config.intervalValue ?? 1);
  const [editUnit, setEditUnit] = useState<IntervalUnit>(
    config.intervalUnit ?? "minutes"
  );

  // Weekly cron editing state
  const [editDay, setEditDay] = useState<DayOfWeek>(config.dayOfWeek ?? "MON");
  const [editHour, setEditHour] = useState(config.hourUtc ?? 0);

  const isRate = RATE_CRON_NAMES.has(config.cronName);
  const isWeekly = WEEKLY_CRON_NAMES.has(config.cronName);
  const desc = CRON_DESCRIPTIONS[config.cronName];

  function handleStartEdit() {
    // Reset to current values
    setEditValue(config.intervalValue ?? 1);
    setEditUnit(config.intervalUnit ?? "minutes");
    setEditDay(config.dayOfWeek ?? "MON");
    setEditHour(config.hourUtc ?? 0);
    setValidationError(null);
    setEditing(true);
  }

  function handleCancel() {
    setEditing(false);
    setValidationError(null);
  }

  async function handleSave() {
    // Client-side validation
    if (isRate) {
      const error = validateRateInterval(config.cronName, editValue, editUnit);
      if (error) {
        setValidationError(error);
        return;
      }
    }

    setSaving(true);
    const update = isRate
      ? { intervalValue: editValue, intervalUnit: editUnit }
      : { dayOfWeek: editDay, hourUtc: editHour };

    const ok = await onSave(config.cronName, update);
    setSaving(false);
    if (ok) {
      setEditing(false);
      setValidationError(null);
    }
  }

  return (
    <div
      data-testid={`cron-card-${config.cronName}`}
      className="bg-zinc-800 border border-zinc-700 rounded-lg p-4 space-y-3"
    >
      {/* Header row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-0.5">
          <h3 className="text-sm font-semibold text-zinc-100">{desc.label}</h3>
          <p className="text-xs text-zinc-400">{desc.description}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Sync status badge */}
          <span
            className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
              config.syncStatus === "SYNCED"
                ? "bg-green-900/40 text-green-400"
                : "bg-yellow-900/40 text-yellow-400"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                config.syncStatus === "SYNCED" ? "bg-green-400" : "bg-yellow-400"
              }`}
            />
            {config.syncStatus === "SYNCED" ? "Synced" : "Pending"}
          </span>
          {/* Toggle */}
          <button
            role="switch"
            aria-checked={config.enabled}
            aria-label={`Toggle ${desc.label}`}
            onClick={() => onToggle(config.cronName, !config.enabled)}
            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${
              config.enabled ? "bg-violet-600" : "bg-zinc-600"
            }`}
          >
            <span
              className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transform transition-transform ${
                config.enabled ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Schedule display */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between text-xs">
        <span className="text-zinc-300">{formatSchedule(config)}</span>
        {config.lastRunAt && (
          <span className="text-zinc-500">
            Last run: {formatRelativeTime(config.lastRunAt)}
          </span>
        )}
        {!config.lastRunAt && (
          <span className="text-zinc-500">Last run: never</span>
        )}
      </div>

      {/* Edit controls */}
      {!editing && (
        <button
          onClick={handleStartEdit}
          aria-label={`Edit ${desc.label} schedule`}
          className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
        >
          Edit schedule
        </button>
      )}

      {editing && (
        <div className="space-y-3 pt-2 border-t border-zinc-700">
          {isRate && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="text-xs text-zinc-400 shrink-0">
                Run every
              </label>
              <input
                type="number"
                min={1}
                value={editValue}
                onChange={(e) => {
                  setEditValue(Math.max(1, parseInt(e.target.value) || 1));
                  setValidationError(null);
                }}
                className="w-20 rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 focus:border-violet-500 focus:outline-none"
              />
              <Select
                value={editUnit}
                onValueChange={(v) => {
                  if (isIntervalUnit(v)) {
                    setEditUnit(v);
                    setValidationError(null);
                  }
                }}
              >
                <SelectTrigger className="w-28 border-zinc-600 bg-zinc-900 text-zinc-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minutes">minutes</SelectItem>
                  <SelectItem value="hours">hours</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {isWeekly && (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="text-xs text-zinc-400 shrink-0">
                Run on
              </label>
              <Select
                value={editDay}
                onValueChange={(v) => { if (isDayOfWeek(v)) setEditDay(v); }}
              >
                <SelectTrigger className="w-32 border-zinc-600 bg-zinc-900 text-zinc-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ALL_DAYS.map((day) => (
                    <SelectItem key={day} value={day}>
                      {DAY_LABELS[day]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="text-xs text-zinc-400 shrink-0">at</label>
              <Select
                value={String(editHour)}
                onValueChange={(v) => setEditHour(parseInt(v))}
              >
                <SelectTrigger className="w-24 border-zinc-600 bg-zinc-900 text-zinc-200">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from({ length: 24 }, (_, i) => (
                    <SelectItem key={i} value={String(i)}>
                      {String(i).padStart(2, "0")}:00 UTC
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {validationError && (
            <p className="text-xs text-red-400">{validationError}</p>
          )}

          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              aria-label={`Save ${desc.label} schedule`}
              className="px-3 py-1.5 text-xs font-medium rounded-md bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              onClick={handleCancel}
              disabled={saving}
              aria-label={`Cancel editing ${desc.label}`}
              className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-600 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirmation Dialog
// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDialog({
  open,
  title,
  message,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-zinc-800 border border-zinc-700 rounded-lg p-6 max-w-sm w-full mx-4 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
        <p className="text-sm text-zinc-400">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-600 text-zinc-400 hover:text-zinc-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
          >
            Disable
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main CronScheduleManager
// ---------------------------------------------------------------------------

export function CronScheduleManager() {
  const [configs, setConfigs] = useState<CronConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    cronName: CronName;
    message: string;
  } | null>(null);

  const fetchConfigs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/system/cron-config");
      if (!res.ok) {
        throw new Error("Failed to load cron configurations");
      }
      const data = (await res.json()) as { configs: CronConfigItem[] };
      setConfigs(data.configs);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load cron configurations"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { fetchConfigs(); }, [fetchConfigs]);

  async function handleToggle(cronName: CronName, enabled: boolean) {
    // If disabling publish, show confirmation with scheduled post count
    if (cronName === "publish" && !enabled) {
      try {
        const res = await fetch("/api/posts?status=SCHEDULED&limit=1");
        const data = (await res.json()) as { total?: number };
        const count = data.total ?? 0;
        setConfirmDialog({
          cronName,
          message:
            count > 0
              ? `There ${count === 1 ? "is" : "are"} ${count} scheduled post${count === 1 ? "" : "s"} that will not be published while the publisher is disabled. Are you sure?`
              : "Disabling the publisher will prevent any scheduled posts from being published. Are you sure?",
        });
      } catch {
        // Fallback if count fetch fails
        setConfirmDialog({
          cronName,
          message:
            "Disabling the publisher will prevent scheduled posts from being published. Are you sure?",
        });
      }
      return;
    }

    await executeToggle(cronName, enabled);
  }

  async function executeToggle(cronName: CronName, enabled: boolean) {
    // Optimistic update
    setConfigs((prev) =>
      prev.map((c) => (c.cronName === cronName ? { ...c, enabled } : c))
    );

    try {
      const res = await fetch("/api/system/cron-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cronName, enabled }),
      });
      if (!res.ok) {
        // Rollback
        setConfigs((prev) =>
          prev.map((c) =>
            c.cronName === cronName ? { ...c, enabled: !enabled } : c
          )
        );
      }
    } catch {
      // Rollback
      setConfigs((prev) =>
        prev.map((c) =>
          c.cronName === cronName ? { ...c, enabled: !enabled } : c
        )
      );
    }
  }

  async function handleSave(
    cronName: CronName,
    update: {
      intervalValue?: number;
      intervalUnit?: IntervalUnit;
      dayOfWeek?: DayOfWeek;
      hourUtc?: number;
    }
  ): Promise<boolean> {
    try {
      const res = await fetch("/api/system/cron-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cronName, ...update }),
      });
      if (res.ok) {
        // Refresh configs to get updated data from server
        await fetchConfigs();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function handleConfirmDisable() {
    if (confirmDialog) {
      const cronName = confirmDialog.cronName;
      setConfirmDialog(null);
      await executeToggle(cronName, false);
    }
  }

  if (loading) {
    return (
      <div className="py-12 text-center text-zinc-500">
        Loading cron schedules…
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-12 text-center space-y-3">
        <p className="text-red-400 text-sm">Failed to load cron configurations.</p>
        <button
          onClick={fetchConfigs}
          aria-label="Retry loading"
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-zinc-600 text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-200">Cron Schedules</h2>
        <p className="text-zinc-400 text-sm mt-1">
          Manage cron job schedules and enable/disable individual jobs.
        </p>
      </div>

      <div className="grid gap-4 grid-cols-1">
        {configs.map((config) => (
          <CronCard
            key={config.id}
            config={config}
            onToggle={handleToggle}
            onSave={handleSave}
          />
        ))}
      </div>

      <ConfirmDialog
        open={confirmDialog !== null}
        title="Disable Publisher?"
        message={confirmDialog?.message ?? ""}
        onConfirm={handleConfirmDisable}
        onCancel={() => setConfirmDialog(null)}
      />
    </div>
  );
}
