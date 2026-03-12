"use client";

import { SessionProvider as NextAuthSessionProvider } from "next-auth/react";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextAuthSessionProvider
      // Disable automatic session refetch on tab focus to prevent
      // CLIENT_FETCH_ERROR when the session endpoint is transiently
      // unreachable (e.g. Lambda cold start behind CloudFront).
      refetchOnWindowFocus={false}
    >
      {children}
    </NextAuthSessionProvider>
  );
}
