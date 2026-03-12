"use client";

import { useEffect } from "react";
import { reportError } from "@/lib/error-reporter";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { url: window.location.href });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: "flex",
            minHeight: "100vh",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "1rem",
            padding: "2rem",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <h2 style={{ fontSize: "1.25rem", fontWeight: 600 }}>
            Something went wrong
          </h2>
          <p style={{ color: "#666", fontSize: "0.875rem" }}>
            A critical error occurred. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              padding: "0.5rem 1rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              backgroundColor: "#000",
              color: "#fff",
              border: "none",
              borderRadius: "0.375rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
