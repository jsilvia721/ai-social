"use client";

import { useEffect } from "react";
import { initErrorReporter } from "@/lib/error-reporter";

export function ErrorReporterProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  useEffect(() => {
    const cleanup = initErrorReporter();
    return cleanup;
  }, []);

  return <>{children}</>;
}
