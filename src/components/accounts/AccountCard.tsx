"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import type { Platform } from "@/types";
import { PLATFORM_STYLES } from "./platform-utils";
import { PLATFORM_ICONS } from "./platform-icons";

interface AccountCardProps {
  platform: Platform;
  username: string;
  accountId: string;
  onDisconnect: (id: string) => Promise<void>;
}

export function AccountCard({ platform, username, accountId, onDisconnect }: AccountCardProps) {
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const styles = PLATFORM_STYLES[platform];
  const Icon = PLATFORM_ICONS[platform];

  async function handleDisconnect() {
    setIsDisconnecting(true);
    try {
      await onDisconnect(accountId);
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
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          <span className="text-sm text-zinc-300 truncate">@{username}</span>
          <Badge variant="outline" className="ml-auto shrink-0 bg-emerald-900/30 text-emerald-400 border-emerald-800 text-xs">
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
      </CardContent>
    </Card>
  );
}
