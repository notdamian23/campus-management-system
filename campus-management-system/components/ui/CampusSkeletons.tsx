"use client";

import clsx from "clsx";
import { Card, CardBody } from "@heroui/card";
import { Skeleton } from "@heroui/skeleton";

type ClassNameProps = {
  className?: string;
};

export function CampusMetricSkeleton({
  count = 4,
  className,
}: ClassNameProps & { count?: number }) {
  return (
    <div
      className={clsx(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {Array.from({ length: count }).map((_, index) => (
        <Card key={index} shadow="sm" className="border">
          <CardBody className="space-y-3 p-5">
            <Skeleton className="h-4 w-24 rounded-lg" />
            <Skeleton className="h-10 w-20 rounded-xl" />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function CampusCardListSkeleton({
  rows = 4,
  className,
}: ClassNameProps & { rows?: number }) {
  return (
    <div className={clsx("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Card key={index} shadow="sm" className="border">
          <CardBody className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-44 rounded-lg" />
                <Skeleton className="h-4 w-56 rounded-lg" />
                <Skeleton className="h-4 w-32 rounded-lg" />
              </div>
              <Skeleton className="h-8 w-24 rounded-xl" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export function CampusTableBodySkeleton({
  rows = 5,
  columns = 5,
  className,
}: ClassNameProps & { rows?: number; columns?: number }) {
  return (
    <div className={clsx("w-full space-y-3 p-4", className)}>
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid gap-3 rounded-2xl border border-border/70 bg-white/80 p-3"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: columns }).map((__, columnIndex) => (
            <Skeleton
              key={`${rowIndex}-${columnIndex}`}
              className={clsx(
                "h-4 rounded-lg",
                columnIndex === 0 ? "w-4/5" : "w-full",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CampusDetailSkeleton({
  rows = 5,
  className,
}: ClassNameProps & { rows?: number }) {
  return (
    <div className={clsx("space-y-4 rounded-2xl border p-5", className)}>
      <Skeleton className="h-6 w-40 rounded-lg" />
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="space-y-2">
          <Skeleton className="h-3 w-20 rounded-lg" />
          <Skeleton className="h-5 w-full rounded-lg" />
        </div>
      ))}
      <Skeleton className="h-10 w-full rounded-xl" />
    </div>
  );
}

export function CampusLayoutLoadingState({
  title,
  description,
  className,
}: ClassNameProps & { title: string; description: string }) {
  return (
    <div
      className={clsx(
        "flex min-h-[100dvh] items-center justify-center bg-[#f2f2f2] px-4",
        className,
      )}
    >
      <Card shadow="sm" className="w-full max-w-md border">
        <CardBody className="space-y-4 p-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40 rounded-lg" />
            <Skeleton className="h-4 w-full rounded-lg" />
            <Skeleton className="h-4 w-4/5 rounded-lg" />
          </div>
          <div className="space-y-3">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
          <div className="pt-1">
            <p className="text-sm font-semibold text-campus-text-primary">
              {title}
            </p>
            <p className="text-xs text-campus-text-secondary">{description}</p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
