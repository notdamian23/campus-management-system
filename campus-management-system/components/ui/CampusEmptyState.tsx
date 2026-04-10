"use client";

import type { ReactNode } from "react";
import clsx from "clsx";

type CampusEmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function CampusEmptyState({
  title,
  description,
  action,
  className,
  compact = false,
}: CampusEmptyStateProps) {
  return (
    <div
      className={clsx(
        "flex w-full flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-bg-main/60 text-center",
        compact ? "gap-2 px-4 py-6" : "gap-3 px-6 py-10",
        className,
      )}
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold text-campus-text-primary">
          {title}
        </p>
        {description ? (
          <p className="max-w-xl text-sm text-campus-text-secondary">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
