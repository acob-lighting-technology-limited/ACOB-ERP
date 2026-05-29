export default function DeptLoading() {
  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="bg-muted h-10 w-10 animate-pulse rounded-lg" />
        <div className="space-y-1.5">
          <div className="bg-muted h-5 w-32 animate-pulse rounded" />
          <div className="bg-muted h-4 w-24 animate-pulse rounded" />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="bg-card rounded-xl border p-5">
            <div className="mb-3 flex items-center gap-3">
              <div className="bg-muted h-8 w-8 animate-pulse rounded-lg" />
              <div className="bg-muted h-4 w-28 animate-pulse rounded" />
            </div>
            <div className="space-y-1.5">
              <div className="bg-muted h-3.5 w-full animate-pulse rounded" />
              <div className="bg-muted h-3.5 w-3/4 animate-pulse rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
