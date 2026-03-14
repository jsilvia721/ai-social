"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, RefreshCw, ExternalLink, AlertCircle } from "lucide-react";
import type { Platform } from "@/types";
import { friendlyErrorMessage } from "@/lib/error-messages";
import { PLATFORM_STYLES } from "./platform-utils";
import { PLATFORM_ICONS } from "./platform-icons";

interface AvailableAccount {
  id: string;
  platform: Platform;
  username: string;
  fullname?: string;
}

interface BlotatoSyncSectionProps {
  onImportComplete: () => void;
}

export function BlotatoSyncSection({ onImportComplete }: BlotatoSyncSectionProps) {
  const [available, setAvailable] = useState<AvailableAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const fetchAvailable = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/accounts/available");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch");
      }
      const data = await res.json();
      setAvailable(data.accounts);
      setSelected(new Set());
    } catch (err) {
      setError(friendlyErrorMessage(err instanceof Error ? err.message : "Could not fetch available accounts from Blotato"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAvailable();
  }, [fetchAvailable]);

  function toggleAccount(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === available.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(available.map((a) => a.id)));
    }
  }

  async function handleImport() {
    setImporting(true);
    setImportError(null);
    try {
      const res = await fetch("/api/accounts/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountIds: Array.from(selected) }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Import failed");
      }
      onImportComplete();
      await fetchAvailable();
    } catch (err) {
      setImportError(friendlyErrorMessage(err instanceof Error ? err.message : "Failed to import accounts"));
    } finally {
      setImporting(false);
    }
  }

  // Loading state
  if (loading) {
    return (
      <Card className="bg-zinc-800 border-zinc-700">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400 mr-2" />
          <span className="text-sm text-zinc-400">Checking Blotato for available accounts…</span>
        </CardContent>
      </Card>
    );
  }

  // Error state
  if (error) {
    return (
      <Card className="bg-zinc-800 border-zinc-700">
        <CardContent className="py-6">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
            <div className="space-y-3">
              <p className="text-sm text-red-400">{error}</p>
              <Button variant="outline" size="sm" className="border-zinc-600" onClick={fetchAvailable}>
                <RefreshCw className="h-3.5 w-3.5 mr-2" />
                Retry
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Empty — no accounts on Blotato
  if (available.length === 0) {
    return (
      <Card className="bg-zinc-800 border-zinc-700">
        <CardHeader>
          <CardTitle className="text-base text-zinc-100">Import from Blotato</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-zinc-400">
            All your Blotato accounts have been imported, or no accounts were found.
          </p>
          <div className="text-sm text-zinc-500 space-y-1">
            <p>To add more accounts:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Go to blotato.com and connect your social accounts</li>
              <li>Come back here and click Refresh</li>
            </ol>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="border-zinc-600" asChild>
              <a href="https://blotato.com" target="_blank" rel="noopener noreferrer">
                Go to Blotato
                <ExternalLink className="h-3.5 w-3.5 ml-2" />
              </a>
            </Button>
            <Button variant="outline" size="sm" className="border-zinc-600" onClick={fetchAvailable}>
              <RefreshCw className="h-3.5 w-3.5 mr-2" />
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Available accounts — show checklist
  const allSelected = selected.size === available.length;

  return (
    <Card className="bg-zinc-800 border-zinc-700">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-base text-zinc-100">Available on Blotato</CardTitle>
          <Button variant="ghost" size="sm" className="text-zinc-400 h-8" onClick={fetchAvailable}>
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {available.map((account) => {
            const styles = PLATFORM_STYLES[account.platform];
            const Icon = PLATFORM_ICONS[account.platform];
            return (
              <label
                key={account.id}
                className="flex items-center gap-3 rounded-lg border border-zinc-700 px-3 py-2.5 cursor-pointer hover:bg-zinc-750 hover:border-zinc-600 transition-colors"
              >
                <Checkbox
                  checked={selected.has(account.id)}
                  onCheckedChange={() => toggleAccount(account.id)}
                  disabled={importing}
                />
                <div className={`flex h-7 w-7 items-center justify-center rounded ${styles.bg}`}>
                  <Icon className={`h-3.5 w-3.5 ${styles.color}`} />
                </div>
                <span className="text-sm text-zinc-300">{styles.label}</span>
                <span className="text-sm text-zinc-500">— @{account.username}</span>
              </label>
            );
          })}
        </div>

        {importError && (
          <div className="rounded-lg border border-red-800 bg-red-950/50 px-3 py-2 text-sm text-red-400">
            {importError}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="border-zinc-600 text-zinc-400"
            onClick={toggleAll}
            disabled={importing}
          >
            {allSelected ? "Deselect All" : "Select All"}
          </Button>
          <Button
            size="sm"
            className="bg-violet-600 hover:bg-violet-700 text-white"
            onClick={handleImport}
            disabled={selected.size === 0 || importing}
          >
            {importing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                Importing…
              </>
            ) : (
              `Import Selected (${selected.size})`
            )}
          </Button>
        </div>

        <p className="text-xs text-zinc-600">
          Don&apos;t see your account?{" "}
          <a
            href="https://blotato.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet-400 hover:underline"
          >
            Connect it on blotato.com
          </a>{" "}
          first, then refresh.
        </p>
      </CardContent>
    </Card>
  );
}
