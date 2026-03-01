"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AccountCard } from "@/components/accounts/AccountCard";
import type { Platform } from "@/types";

const PLATFORMS: Platform[] = ["TWITTER", "INSTAGRAM", "FACEBOOK"];

interface Account {
  id: string;
  platform: Platform;
  username: string;
  expiresAt: string | null;
}

function AccountsContent() {
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [notification, setNotification] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);

  const successParam = searchParams.get("success");
  const errorParam = searchParams.get("error");

  useEffect(() => {
    if (successParam) {
      const messages: Record<string, string> = {
        twitter_connected: "Twitter account connected successfully.",
        meta_connected: "Facebook and Instagram accounts connected successfully.",
      };
      setNotification({
        type: "success",
        message: messages[successParam] ?? "Account connected successfully.",
      });
    } else if (errorParam) {
      const errorMessages: Record<string, string> = {
        meta_denied: "You denied the Meta permissions request.",
        state_mismatch: "OAuth state mismatch — please try again (cookie issue).",
        meta_token_failed: "Failed to exchange Meta auth code for a token. Check that your redirect URI is whitelisted in the Meta app settings.",
        meta_long_token_failed: "Failed to get long-lived Meta token.",
        meta_pages_failed: "Failed to fetch your Facebook Pages.",
        no_pages_found: "No Facebook Pages found. You must have at least one Facebook Page to connect Instagram/Facebook.",
      };
      setNotification({
        type: "error",
        message: errorMessages[errorParam] ?? `Failed to connect account (${errorParam}). Please try again.`,
      });
    }
  }, [successParam, errorParam]);

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/accounts");
    if (res.ok) {
      const data = await res.json();
      setAccounts(data);
    }
  }, []);

  useEffect(() => {
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-50">Accounts</h1>
        <p className="text-zinc-400 mt-1">Connect your social media accounts to start posting.</p>
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
            account={
              getAccount(platform)
                ? {
                    id: getAccount(platform)!.id,
                    username: getAccount(platform)!.username,
                    expiresAt: getAccount(platform)!.expiresAt
                      ? new Date(getAccount(platform)!.expiresAt!)
                      : null,
                  }
                : undefined
            }
            onDisconnect={handleDisconnect}
          />
        ))}
      </div>

      <p className="text-xs text-zinc-600">
        Instagram and Facebook use the same Meta OAuth connection. Connecting Meta will link both platforms.
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
