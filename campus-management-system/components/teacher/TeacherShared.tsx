"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import type { Selection, SortDescriptor } from "@react-types/shared";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { ScrollShadow } from "@heroui/scroll-shadow";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, MapPin } from "lucide-react";
import {
  CampusDataTable,
  type CampusTableColumn,
} from "@/components/ui/CampusDataTable";
import {
  capitalizeTeacherLabel,
  formatTeacherEventDate,
  getTeacherLifecycleTone,
  getTeacherToneClasses,
  type TeacherTone,
} from "./teacher-helpers";

export type TeacherStatItem = {
  label: string;
  value: ReactNode;
  description?: string;
  tone?: TeacherTone;
  icon?: LucideIcon;
};

type TeacherPageHeaderProps = {
  title: string;
  description: string;
  eyebrow?: string;
  icon?: LucideIcon;
  meta?: ReactNode;
  action?: ReactNode;
  className?: string;
  variant?: "default" | "hero";
};

export function TeacherPageHeader({
  title,
  description,
  eyebrow = "Teacher workspace",
  icon: Icon,
  meta,
  action,
  className,
  variant = "default",
}: TeacherPageHeaderProps) {
  const isHero = variant === "hero";

  return (
    <Card
      shadow="none"
      className={clsx(
        "overflow-hidden",
        isHero
          ? "border-none bg-gradient-to-br from-primary-700 via-primary-600 to-[#f19b4c] text-white shadow-[var(--shadow-card)]"
          : "border border-border/70 bg-white/90 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <CardBody className="gap-5 p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex flex-1 items-start gap-4">
            {Icon ? (
              <div
                className={clsx(
                  "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl",
                  isHero
                    ? "bg-white/15 text-white"
                    : "bg-primary-50 text-primary-700",
                )}
              >
                <Icon size={20} />
              </div>
            ) : null}

            <div className="min-w-0 space-y-2">
              <p
                className={clsx(
                  "text-xs font-semibold uppercase tracking-[0.2em]",
                  isHero ? "text-white/75" : "text-primary-700",
                )}
              >
                {eyebrow}
              </p>
              <h1
                className={clsx(
                  "text-2xl font-bold sm:text-3xl",
                  isHero ? "text-white" : "text-campus-text-primary",
                )}
              >
                {title}
              </h1>
              <p
                className={clsx(
                  "max-w-3xl text-sm leading-6",
                  isHero ? "text-white/85" : "text-campus-text-secondary",
                )}
              >
                {description}
              </p>
            </div>
          </div>

          {action ? <div className="shrink-0">{action}</div> : null}
        </div>

        {meta ? (
          <div className="flex flex-wrap items-center gap-2">{meta}</div>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function TeacherStatsGrid({
  items,
  className,
}: {
  items: TeacherStatItem[];
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
        <TeacherStatCard key={item.label} {...item} />
      ))}
    </div>
  );
}

function TeacherStatCard({
  label,
  value,
  description,
  tone = "blue",
  icon: Icon,
}: TeacherStatItem) {
  const toneClasses = getTeacherToneClasses(tone);

  return (
    <Card
      shadow="none"
      className="border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]"
    >
      <CardBody className="gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm font-medium text-campus-text-secondary">
              {label}
            </p>
            {description ? (
              <p className="text-xs leading-5 text-campus-text-secondary">
                {description}
              </p>
            ) : null}
          </div>

          {Icon ? (
            <div
              className={clsx(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                toneClasses.icon,
              )}
            >
              <Icon size={18} />
            </div>
          ) : null}
        </div>

        <div className={clsx("text-3xl font-bold", toneClasses.value)}>
          {value}
        </div>
      </CardBody>
    </Card>
  );
}

type TeacherFilterBarProps = {
  children: ReactNode;
  countLabel?: string;
  countValue?: ReactNode;
  countDescription?: string;
  controlsClassName?: string;
  className?: string;
};

export function TeacherFilterBar({
  children,
  countLabel,
  countValue,
  countDescription,
  controlsClassName,
  className,
}: TeacherFilterBarProps) {
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

type TeacherEmptyStateProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  tone?: TeacherTone;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function TeacherEmptyState({
  title,
  description,
  icon: Icon,
  tone = "slate",
  action,
  className,
  compact = false,
}: TeacherEmptyStateProps) {
  const toneClasses = getTeacherToneClasses(tone);

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

export function TeacherActivityChipGroup({
  items,
  className,
}: {
  items: Array<{
    label: string;
    value: ReactNode;
    tone?: TeacherTone;
    icon?: LucideIcon;
  }>;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-wrap gap-2", className)}>
      {items.map((item) => {
        const toneClasses = getTeacherToneClasses(item.tone ?? "slate");
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

type TeacherEventSnapshotCardProps = {
  title: string;
  lifecycle: string;
  dateLabel: string;
  location: string;
  registrationCount?: number;
  presentCount?: number;
  absentCount?: number;
  attendanceCount?: number;
  fileCount?: number;
  action?: ReactNode;
  className?: string;
};

export function TeacherEventSnapshotCard({
  title,
  lifecycle,
  dateLabel,
  location,
  registrationCount,
  presentCount,
  absentCount,
  attendanceCount,
  fileCount,
  action,
  className,
}: TeacherEventSnapshotCardProps) {
  const lifecycleTone = getTeacherLifecycleTone(
    lifecycle as "upcoming" | "ongoing" | "completed",
  );
  const lifecycleClasses = getTeacherToneClasses(lifecycleTone);

  const summaryItems: Array<{
    label: string;
    value: number;
    tone: TeacherTone;
  }> = [];

  if (registrationCount != null) {
    summaryItems.push({ label: "Pre-Reg", value: registrationCount, tone: "blue" });
  }

  if (attendanceCount != null) {
    summaryItems.push({
      label: "Attendance",
      value: attendanceCount,
      tone: "slate",
    });
  }

  if (presentCount != null) {
    summaryItems.push({ label: "Present", value: presentCount, tone: "green" });
  }

  if (absentCount != null) {
    summaryItems.push({ label: "Missed", value: absentCount, tone: "red" });
  }

  if (fileCount != null) {
    summaryItems.push({ label: "Files", value: fileCount, tone: "purple" });
  }

  return (
    <Card
      shadow="none"
      className={clsx(
        "border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <CardBody className="gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Chip size="sm" className={lifecycleClasses.chip}>
                {capitalizeTeacherLabel(lifecycle)}
              </Chip>
            </div>

            <div className="space-y-1">
              <h3 className="text-base font-semibold text-campus-text-primary">
                {title}
              </h3>
              <div className="flex flex-wrap gap-3 text-sm text-campus-text-secondary">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={14} />
                  {dateLabel}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <MapPin size={14} />
                  {location}
                </span>
              </div>
            </div>

            {summaryItems.length > 0 ? (
              <TeacherActivityChipGroup items={summaryItems} />
            ) : null}
          </div>

          {action ? <div className="shrink-0 lg:pt-1">{action}</div> : null}
        </div>
      </CardBody>
    </Card>
  );
}

type TeacherDataTableProps<T extends object> = {
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

export function TeacherDataTable<T extends object>({
  emptyTitle = "No records found",
  emptyDescription,
  emptyContent,
  className,
  wrapperClassName,
  tableClassName,
  ...props
}: TeacherDataTableProps<T>) {
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
              <TeacherEmptyState
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
          tableClassName={clsx("min-w-[780px]", tableClassName)}
        />
      </ScrollShadow>
    </div>
  );
}

export function buildTeacherEventSnapshotFromRecord(event: {
  title: string;
  lifecycle: "upcoming" | "ongoing" | "completed";
  eventDate: Date | null;
  date: string;
  location: string;
  registrationCount: number;
  presentCount: number;
  absentCount: number;
  attendanceCount: number;
  documentCount: number;
  imageCount: number;
}) {
  return {
    title: event.title,
    lifecycle: event.lifecycle,
    dateLabel: formatTeacherEventDate(event.eventDate, event.date),
    location: event.location,
    registrationCount: event.registrationCount,
    presentCount: event.presentCount,
    absentCount: event.absentCount,
    attendanceCount: event.attendanceCount,
    fileCount: event.documentCount + event.imageCount,
  };
}
