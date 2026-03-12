"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense } from "react";
import { AccountCard } from "@/components/accounts/AccountCard";
import type { Platform } from "@/types";

const PLATFORMS: Platform[] = ["TWITTER", "INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"];

interface Account {
  id: string;
  platform: Platform;
  username: string;
  businessId: string;
}

function AccountsContent() {
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const activeBusinessId = (session?.user as { id: string; activeBusinessId?: string | null })
    ?.activeBusinessId;

  const successParam = searchParams.get("success");
  const errorParam = searchParams.get("error");

  useEffect(() => {
    if (successParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNotification({ type: "success", message: "Account connected successfully." });
    } else if (errorParam) {
      const errorMessages: Record<string, string> = {
        connect: "Failed to connect account. Please try again.",
        not_on_blotato: "No matching account found on Blotato. Please connect the account on blotato.com first, then try again.",
        invalid_platform: "Unsupported platform returned by Blotato.",
        state_mismatch: "OAuth state mismatch — please try again.",
        account_claimed: "This account is already connected to another workspace.",
      };
      setNotification({
        type: "error",
        message: errorMessages[errorParam] ?? `Failed to connect account (${errorParam}). Please try again.`,
      });
    }
  }, [successParam, errorParam]);

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

  const getAccount = (platform: Platform) =>
    accounts.find((a) => a.platform === platform);

  if (!activeBusinessId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-zinc-50">Accounts</h1>
          <p className="text-zinc-400 mt-1">Connect your social media accounts to start posting.</p>
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
        <p className="text-zinc-400 mt-1">Connect social media accounts to this workspace via Blotato.</p>
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLATFORMS.map((platform) => (
          <AccountCard
            key={platform}
            platform={platform}
            businessId={activeBusinessId}
            account={
              getAccount(platform)
                ? {
                    id: getAccount(platform)!.id,
                    username: getAccount(platform)!.username,
                  }
                : undefined
            }
            onDisconnect={handleDisconnect}
          />
        ))}
      </div>

      <p className="text-xs text-zinc-600">
        Accounts are connected via Blotato, which manages OAuth tokens on your behalf.
        To connect an account, click &quot;Connect&quot; and follow the Blotato authorization flow.
      </p>
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
