export default function RepurposeReviewLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-48 bg-zinc-800 rounded animate-pulse" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-lg border border-zinc-700 bg-zinc-800 p-4 space-y-3">
            <div className="h-5 w-24 bg-zinc-700 rounded animate-pulse" />
            <div className="h-24 bg-zinc-700 rounded animate-pulse" />
            <div className="h-4 w-16 bg-zinc-700 rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
