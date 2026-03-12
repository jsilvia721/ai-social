"use client";

import { useEffect, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { Suspense } from "react";
import { AccountCard } from "@/components/accounts/AccountCard";
import { BlotatoSyncSection } from "@/components/accounts/BlotatoSyncSection";
import { Separator } from "@/components/ui/separator";
import type { Platform } from "@/types";

interface Account {
  id: string;
  platform: Platform;
  username: string;
  businessId: string;
}

function AccountsContent() {
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const activeBusinessId = (session?.user as { id: string; activeBusinessId?: string | null })
    ?.activeBusinessId;

  const fetchAccounts = useCallback(async () => {
    if (!activeBusinessId) return;
    const res = await fetch(`/api/accounts?businessId=${activeBusinessId}`);
    if (res.ok) {
      const data = await res.json();
      setAccounts(data);
    }
  }, [activeBusinessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAccounts();
  }, [fetchAccounts]);

  async function handleDisconnect(id: string) {
    const res = await fetch(`/api/accounts?id=${id}`, { method: "DELETE" });
    if (res.ok) {
      await fetchAccounts();
      setNotification({ type: "success", message: "Account disconnected." });
    } else {
      setNotification({ type: "error", message: "Failed to disconnect account." });
    }
  }

  function handleImportComplete() {
    fetchAccounts();
    setNotification({ type: "success", message: "Accounts imported successfully." });
  }

  if (!activeBusinessId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Accounts</h1>
          <p className="text-zinc-400 mt-1">Import your social media accounts from Blotato.</p>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 px-6 py-8 text-center">
          <p className="text-zinc-400">
            No workspace selected.{" "}
            <a href="/dashboard/businesses/new" className="text-violet-400 hover:underline">
              Create a workspace first.
            </a>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Accounts</h1>
        <p className="text-zinc-400 mt-1">Import your social media accounts from Blotato.</p>
      </div>

      {notification && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            notification.type === "success"
              ? "bg-emerald-950/50 border-emerald-800 text-emerald-400"
              : "bg-red-950/50 border-red-800 text-red-400"
          }`}
        >
          {notification.message}
        </div>
      )}

      <BlotatoSyncSection onImportComplete={handleImportComplete} />

      <Separator className="bg-zinc-700" />

      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-zinc-100">Imported Accounts</h2>

        {accounts.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((account) => (
              <AccountCard
                key={account.id}
                platform={account.platform}
                username={account.username}
                accountId={account.id}
                onDisconnect={handleDisconnect}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-6 py-8 text-center">
            <p className="text-sm text-zinc-500">No imported accounts yet. Select accounts above to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<div className="text-zinc-400">Loading accounts…</div>}>
      <AccountsContent />
    </Suspense>
  );
}
