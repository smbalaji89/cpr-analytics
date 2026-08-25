import { Card } from "@/components/ui/card";
import {
  CPRCardSkeleton,
  ChartSkeleton,
  Skeleton,
  TableSkeleton,
} from "@/components/ui/skeleton";

/** Route-transition skeleton (PRD §28) — never a blank screen. */
export default function Loading() {
  return (
    <div className="min-h-dvh bg-surface-muted">
      <div className="h-14 border-b border-line bg-surface-raised" />
      <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-11 w-full sm:w-64" />
          <Skeleton className="h-11 w-full sm:w-76" />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <CPRCardSkeleton />
          </div>
          <Card>
            <ChartSkeleton />
          </Card>
          <Card className="lg:col-span-3">
            <TableSkeleton rows={6} />
          </Card>
        </div>
      </div>
    </div>
  );
}
