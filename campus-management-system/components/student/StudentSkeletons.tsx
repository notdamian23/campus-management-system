"use client";

import clsx from "clsx";
import { Card, CardBody } from "@heroui/card";
import { Skeleton } from "@heroui/skeleton";

type ClassNameProps = {
  className?: string;
};

export function StudentPageHeaderSkeleton({
  hero = false,
  className,
}: ClassNameProps & { hero?: boolean }) {
  return (
    <Card
      shadow="none"
      className={clsx(
        "overflow-hidden border border-border/70 shadow-[var(--shadow-soft)]",
        hero
          ? "border-none bg-gradient-to-br from-primary-700 via-primary-600 to-[#f19b4c]"
          : "bg-white/90",
        className,
      )}
    >
      <CardBody className="gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-1 items-start gap-4">
            <Skeleton
              className={clsx(
                "h-12 w-12 rounded-2xl",
                hero ? "bg-white/20" : undefined,
              )}
            />
            <div className="min-w-0 flex-1 space-y-3">
              <Skeleton
                className={clsx(
                  "h-3 w-28 rounded-lg",
                  hero ? "bg-white/25" : undefined,
                )}
              />
              <Skeleton
                className={clsx(
                  "h-8 w-56 rounded-xl",
                  hero ? "bg-white/30" : undefined,
                )}
              />
              <Skeleton
                className={clsx(
                  "h-4 w-full max-w-2xl rounded-lg",
                  hero ? "bg-white/20" : undefined,
                )}
              />
              <Skeleton
                className={clsx(
                  "h-4 w-4/5 max-w-xl rounded-lg",
                  hero ? "bg-white/20" : undefined,
                )}
              />
            </div>
          </div>

          <Skeleton
            className={clsx(
              "h-20 w-full rounded-[24px] lg:w-80",
              hero ? "bg-white/25" : undefined,
            )}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <Skeleton
            className={clsx(
              "h-8 w-28 rounded-full",
              hero ? "bg-white/20" : undefined,
            )}
          />
          <Skeleton
            className={clsx(
              "h-8 w-24 rounded-full",
              hero ? "bg-white/20" : undefined,
            )}
          />
          <Skeleton
            className={clsx(
              "h-8 w-32 rounded-full",
              hero ? "bg-white/20" : undefined,
            )}
          />
        </div>
      </CardBody>
    </Card>
  );
}

export function StudentFilterBarSkeleton({
  filters = 2,
  showSummary = false,
  className,
}: ClassNameProps & { filters?: number; showSummary?: boolean }) {
  return (
    <Card
      shadow="none"
      className={clsx(
        "border border-border/70 bg-white/90 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <CardBody className="p-4 sm:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
          <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: filters }).map((_, index) => (
              <div
                key={index}
                className="rounded-2xl border border-border/70 bg-slate-50/70 p-3"
              >
                <Skeleton className="h-3 w-20 rounded-lg" />
                <Skeleton className="mt-3 h-10 w-full rounded-xl" />
              </div>
            ))}
          </div>

          {showSummary ? (
            <div className="shrink-0 xl:w-64">
              <div className="rounded-[22px] border border-blue-100 bg-blue-50/70 p-4">
                <Skeleton className="h-3 w-24 rounded-lg" />
                <Skeleton className="mt-3 h-8 w-20 rounded-xl" />
                <Skeleton className="mt-3 h-4 w-full rounded-lg" />
              </div>
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

export function StudentCardStackSkeleton({
  rows = 3,
  className,
}: ClassNameProps & { rows?: number }) {
  return (
    <div className={clsx("space-y-3", className)}>
      {Array.from({ length: rows }).map((_, index) => (
        <Card
          key={index}
          shadow="none"
          className="border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]"
        >
          <CardBody className="gap-4 p-4 sm:p-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Skeleton className="h-7 w-24 rounded-full" />
                  <Skeleton className="h-7 w-20 rounded-full" />
                </div>
                <Skeleton className="h-5 w-2/3 rounded-lg" />
                <Skeleton className="h-4 w-full rounded-lg" />
                <Skeleton className="h-4 w-1/2 rounded-lg" />
              </div>
              <Skeleton className="h-10 w-28 rounded-2xl" />
            </div>
          </CardBody>
        </Card>
      ))}
    </div>
  );
}
