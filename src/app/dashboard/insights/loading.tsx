export default function InsightsLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-2">
          <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
          <div className="h-4 w-64 bg-zinc-800 rounded animate-pulse" />
        </div>
        <div className="h-9 w-52 bg-zinc-800 rounded-lg animate-pulse" />
      </div>

      {/* Summary card */}
      <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 space-y-3">
        <div className="h-4 w-36 bg-zinc-700 rounded animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 w-full bg-zinc-700 rounded animate-pulse" />
          <div className="h-4 w-5/6 bg-zinc-700 rounded animate-pulse" />
          <div className="h-4 w-4/6 bg-zinc-700 rounded animate-pulse" />
        </div>
      </div>

      {/* Top Performers */}
      <div className="space-y-4">
        <div className="h-6 w-36 bg-zinc-800 rounded animate-pulse" />
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 divide-y divide-zinc-700">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-4 px-6 py-4">
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 bg-zinc-700 rounded animate-pulse" />
                <div className="h-3 w-24 bg-zinc-700 rounded animate-pulse" />
              </div>
              <div className="h-6 w-14 bg-zinc-700 rounded-full animate-pulse" />
            </div>
          ))}
        </div>
      </div>

      {/* Key Insights */}
      <div className="space-y-4">
        <div className="h-6 w-28 bg-zinc-800 rounded animate-pulse" />
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-4 bg-zinc-700 rounded animate-pulse" style={{ width: `${85 - i * 10}%` }} />
          ))}
        </div>
      </div>

      {/* Strategy Adjustments */}
      <div className="space-y-4">
        <div className="h-6 w-44 bg-zinc-800 rounded animate-pulse" />
        <div className="rounded-lg border border-zinc-700 bg-zinc-800 p-6 space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-4 bg-zinc-700 rounded animate-pulse" style={{ width: `${70 - i * 15}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
