// Shown while the dashboard's server data resolves, so navigation feels instant.
// ponytail: dashboard only - it's the heaviest fetch; lighter pages don't need it.
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded bg-panel" />
          <div className="h-3 w-56 rounded bg-panel" />
        </div>
        <div className="h-6 w-24 rounded-md bg-panel" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[92px] rounded-lg border border-line bg-panel" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="h-64 rounded-lg border border-line bg-panel lg:col-span-2" />
        <div className="h-64 rounded-lg border border-line bg-panel" />
      </div>
      <div className="h-60 rounded-lg border border-line bg-panel" />
    </div>
  );
}
