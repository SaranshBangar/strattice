// Generic route skeleton for dynamic pages (strategies, billing, account, admin).
// The dashboard has its own tailored loading.tsx which takes precedence.
export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-7 w-44 rounded bg-panel" />
      <div className="h-32 rounded-lg border border-line bg-panel" />
      <div className="h-52 rounded-lg border border-line bg-panel" />
    </div>
  );
}
