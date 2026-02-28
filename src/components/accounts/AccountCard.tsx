"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { Platform } from "@/types";

const PLATFORM_STYLES: Record<Platform, { color: string; bg: string; label: string }> = {
  TWITTER: { color: "text-sky-400", bg: "bg-sky-950/50 border-sky-800", label: "Twitter / X" },
  INSTAGRAM: { color: "text-pink-500", bg: "bg-pink-950/50 border-pink-800", label: "Instagram" },
  FACEBOOK: { color: "text-blue-500", bg: "bg-blue-950/50 border-blue-800", label: "Facebook" },
};

function TwitterIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  );
}

function FacebookIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

const PLATFORM_ICONS: Record<Platform, React.ComponentType<{ className?: string }>> = {
  TWITTER: TwitterIcon,
  INSTAGRAM: InstagramIcon,
  FACEBOOK: FacebookIcon,
};

const CONNECT_URLS: Record<Platform, string> = {
  TWITTER: "/api/connect/twitter",
  INSTAGRAM: "/api/connect/meta",
  FACEBOOK: "/api/connect/meta",
};

interface ConnectedAccount {
  id: string;
  username: string;
  expiresAt: Date | null;
}

interface AccountCardProps {
  platform: Platform;
  account?: ConnectedAccount;
  onDisconnect: (id: string) => Promise<void>;
}

export function AccountCard({ platform, account, onDisconnect }: AccountCardProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const styles = PLATFORM_STYLES[platform];
  const Icon = PLATFORM_ICONS[platform];
  const connectUrl = CONNECT_URLS[platform];

  async function handleDisconnect() {
    if (!account) return;
    setIsDisconnecting(true);
    try {
      await onDisconnect(account.id);
    } finally {
      setIsDisconnecting(false);
    }
  }

  return (
    <Card className="bg-zinc-800 border-zinc-700">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${styles.bg}`}>
            <Icon className={`h-5 w-5 ${styles.color}`} />
          </div>
          <CardTitle className="text-base text-zinc-100">{styles.label}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {account ? (
          <>
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              <span className="text-sm text-zinc-300">@{account.username}</span>
              <Badge variant="outline" className="ml-auto bg-emerald-900/30 text-emerald-400 border-emerald-800 text-xs">
                Connected
              </Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full border-zinc-600 text-zinc-400 hover:bg-red-950/50 hover:text-red-400 hover:border-red-800"
              onClick={handleDisconnect}
              disabled={isDisconnecting}
            >
              {isDisconnecting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />
                  Disconnecting…
                </>
              ) : (
                <>
                  <XCircle className="h-3.5 w-3.5 mr-2" />
                  Disconnect
                </>
              )}
            </Button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-zinc-600" />
              <span className="text-sm text-zinc-500">Not connected</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              className={`w-full border-zinc-600 hover:border-current ${styles.color}`}
              asChild
            >
              <a href={connectUrl}>Connect {styles.label}</a>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
