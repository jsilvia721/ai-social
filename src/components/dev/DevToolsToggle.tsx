"use client";

import { useState, useEffect } from "react";

export function DevToolsToggle() {
  const [mocking, setMocking] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch("/api/dev/mock-mode")
      .then((r) => r.json())
      .then((d) => setMocking(d.mocking))
      .catch(() => {});
  }, []);

  async function toggle() {
    const next = !mocking;
    const res = await fetch("/api/dev/mock-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mock: next }),
    });
    const data = await res.json();
    setMocking(data.mocking);
  }

  async function reset() {
    const res = await fetch("/api/dev/mock-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mock: null }),
    });
    const data = await res.json();
    setMocking(data.mocking);
  }

  if (mocking === null) return null;

  return (
    <div className="fixed bottom-16 right-4 z-50 md:bottom-4">
      {open ? (
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 shadow-xl space-y-2 w-56">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">
              Dev Tools
            </span>
            <button
              onClick={() => setOpen(false)}
              className="text-zinc-500 hover:text-zinc-300 text-xs"
            >
              close
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-zinc-300">API Mocking</span>
            <button
              onClick={toggle}
              className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                mocking
                  ? "bg-amber-600/20 text-amber-400 border border-amber-700"
                  : "bg-emerald-600/20 text-emerald-400 border border-emerald-700"
              }`}
            >
              {mocking ? "MOCK" : "LIVE"}
            </button>
          </div>
          <button
            onClick={reset}
            className="text-xs text-zinc-500 hover:text-zinc-300 underline"
          >
            Reset to default
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className={`px-2 py-1 rounded-md text-xs font-medium shadow-lg transition-colors ${
            mocking
              ? "bg-amber-600/20 text-amber-400 border border-amber-700"
              : "bg-emerald-600/20 text-emerald-400 border border-emerald-700"
          }`}
        >
          {mocking ? "MOCK" : "LIVE"}
        </button>
      )}
    </div>
  );
}
