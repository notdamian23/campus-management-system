"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import type { Selection, SortDescriptor } from "@react-types/shared";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { ScrollShadow } from "@heroui/scroll-shadow";
import type { LucideIcon } from "lucide-react";
import {
  CampusMetricCard,
  CampusWorkspaceHeaderCard,
} from "@/components/ui";
import {
  CampusDataTable,
  type CampusTableColumn,
} from "@/components/ui/CampusDataTable";
import { getECToneClasses, type ECTone } from "./ec-helpers";

export type ECStatItem = {
  label: string;
  value: ReactNode;
  description?: string;
  tone?: ECTone;
  icon?: LucideIcon;
};

type ECPageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
  icon?: LucideIcon;
  meta?: ReactNode;
  action?: ReactNode;
  aside?: ReactNode;
  className?: string;
  variant?: "default" | "hero";
};

export function ECPageHeader({
  title,
  description,
  eyebrow = "EC workspace",
  icon: Icon,
  meta,
  action,
  aside,
  className,
  variant = "default",
}: ECPageHeaderProps) {
  return (
    <CampusWorkspaceHeaderCard
      title={title}
      description={description}
      eyebrow={eyebrow}
      icon={Icon}
      meta={meta}
      action={action}
      aside={aside}
      className={className}
      variant={variant}
    />
  );
}

export function ECStatsGrid({
  items,
  className,
}: {
  items: ECStatItem[];
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => (
        <ECStatCard key={item.label} {...item} />
      ))}
    </div>
  );
}

function ECStatCard({
  label,
  value,
  description,
  tone = "blue",
  icon: Icon,
}: ECStatItem) {
  const toneClasses = getECToneClasses(tone);

  return (
    <CampusMetricCard
      label={label}
      value={value}
      description={description}
      icon={Icon}
      iconClassName={toneClasses.icon}
      valueClassName={toneClasses.value}
    />
  );
}

type ECFilterBarProps = {
  children: ReactNode;
  countLabel?: string;
  countValue?: ReactNode;
  countDescription?: string;
  controlsClassName?: string;
  className?: string;
};

export function ECFilterBar({
  children,
  countLabel,
  countValue,
  countDescription,
  controlsClassName,
  className,
}: ECFilterBarProps) {
  const showCountCard =
    typeof countLabel === "string" &&
    countLabel.trim().length > 0 &&
    countValue !== undefined &&
    countValue !== null;

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
          <div
            className={clsx(
              "grid flex-1 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3",
              controlsClassName,
            )}
          >
            {children}
          </div>

          {showCountCard ? (
            <div className="shrink-0 xl:w-64">
              <div className="rounded-[22px] border border-blue-100 bg-blue-50/70 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700">
                  {countLabel}
                </p>
                <div className="mt-3 flex items-end justify-between gap-3">
                  <p className="text-3xl font-bold text-blue-700">{countValue}</p>
                  <Chip size="sm" className="bg-white/80 text-blue-700">
                    Live view
                  </Chip>
                </div>
                {countDescription ? (
                  <p className="mt-2 text-xs leading-5 text-blue-700/85">
                    {countDescription}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

type ECEmptyStateProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  tone?: ECTone;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function ECEmptyState({
  title,
  description,
  icon: Icon,
  tone = "slate",
  action,
  className,
  compact = false,
}: ECEmptyStateProps) {
  const toneClasses = getECToneClasses(tone);

  return (
    <div
      className={clsx(
        "flex w-full flex-col items-center justify-center rounded-[24px] border border-dashed text-center",
        toneClasses.badge,
        compact ? "gap-2 px-4 py-6" : "gap-4 px-6 py-10",
        className,
      )}
    >
      {Icon ? (
        <div
          className={clsx(
            "flex h-12 w-12 items-center justify-center rounded-2xl",
            toneClasses.icon,
          )}
        >
          <Icon size={20} />
        </div>
      ) : null}

      <div className="space-y-1">
        <p className="text-sm font-semibold text-campus-text-primary">{title}</p>
        {description ? (
          <p className="max-w-xl text-sm leading-6 text-campus-text-secondary">
            {description}
          </p>
        ) : null}
      </div>

      {action ? <div>{action}</div> : null}
    </div>
  );
}

export function ECStatusChipGroup({
  items,
  className,
}: {
  items: Array<{
    label: string;
    value: ReactNode;
    tone?: ECTone;
    icon?: LucideIcon;
  }>;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-wrap gap-2", className)}>
      {items.map((item) => {
        const toneClasses = getECToneClasses(item.tone ?? "slate");
        const Icon = item.icon;

        return (
          <Chip
            key={`${item.label}-${String(item.value)}`}
            size="sm"
            className={toneClasses.chip}
          >
            <span className="inline-flex items-center gap-1.5">
              {Icon ? <Icon size={14} /> : null}
              <span className="font-medium">{item.label}:</span>
              <span>{item.value}</span>
            </span>
          </Chip>
        );
      })}
    </div>
  );
}

type ECQuickActionCardProps = {
  title: string;
  description: string;
  icon?: LucideIcon;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
};

export function ECQuickActionCard({
  title,
  description,
  icon: Icon,
  meta,
  action,
  className,
}: ECQuickActionCardProps) {
  return (
    <Card
      shadow="none"
      className={clsx(
        "border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <CardHeader className="items-start gap-4 p-5 pb-0 sm:p-6 sm:pb-0">
        {Icon ? (
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.2rem] bg-primary-50 text-primary-700 sm:h-12 sm:w-12">
            <Icon size={18} />
          </div>
        ) : null}

        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-base font-semibold text-campus-text-primary">
            {title}
          </p>
          <p className="text-sm leading-6 text-campus-text-secondary">
            {description}
          </p>
        </div>
      </CardHeader>

      <CardBody className="space-y-4 p-5 pt-4 sm:p-6 sm:pt-4">
        {meta ? <div>{meta}</div> : null}
        {action ? <div>{action}</div> : null}
      </CardBody>
    </Card>
  );
}

type ECDataTableProps<T extends object> = {
  ariaLabel: string;
  columns: CampusTableColumn<T>[];
  items: T[];
  renderCell: (item: T, columnKey: string) => ReactNode;
  getRowKey?: (item: T) => string | number;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyContent?: ReactNode;
  isLoading?: boolean;
  loadingContent?: ReactNode;
  className?: string;
  wrapperClassName?: string;
  tableClassName?: string;
  bottomContent?: ReactNode;
  bottomContentPlacement?: "inside" | "outside";
  topContent?: ReactNode;
  topContentPlacement?: "inside" | "outside";
  selectionMode?: "none" | "single" | "multiple";
  selectedKeys?: Selection;
  onSelectionChange?: (keys: Selection) => void;
  showSelectionCheckboxes?: boolean;
  sortDescriptor?: SortDescriptor;
  onSortChange?: (descriptor: SortDescriptor) => void;
  isHeaderSticky?: boolean;
};

export function ECDataTable<T extends object>({
  emptyTitle = "No records found",
  emptyDescription,
  emptyContent,
  className,
  wrapperClassName,
  tableClassName,
  ...props
}: ECDataTableProps<T>) {
  return (
    <div
      className={clsx(
        "overflow-hidden rounded-[28px] border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <ScrollShadow orientation="horizontal" hideScrollBar className="w-full">
        <CampusDataTable
          {...props}
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
          emptyContent={
            emptyContent ?? (
              <ECEmptyState
                title={emptyTitle}
                description={emptyDescription}
                compact
                className="mx-auto my-8 max-w-lg border-none bg-transparent"
              />
            )
          }
          className="w-full"
          wrapperClassName={clsx(
            "border-none bg-transparent shadow-none",
            wrapperClassName,
          )}
          tableClassName={clsx("min-w-[760px]", tableClassName)}
        />
      </ScrollShadow>
    </div>
  );
}
