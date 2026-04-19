"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Tab, Tabs } from "@heroui/tabs";
import { Tooltip } from "@heroui/tooltip";
import type { LucideIcon } from "lucide-react";
import {
  BellRing,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  CreditCard,
  GraduationCap,
  Landmark,
  MapPin,
  Megaphone,
  ShieldAlert,
} from "lucide-react";
import type {
  StudentAccountStatus,
  StudentEventStatus,
  StudentNotificationType,
  StudentPayment,
} from "./StudentPortalProvider";
import {
  CampusMetricCard,
  CampusWorkspaceHeaderCard,
} from "@/components/ui";
import {
  buildStudentAudienceLabel,
  formatStudentCurrency,
  getStudentAccountStatusTone,
  getStudentEventTone,
  getStudentNotificationTone,
  getStudentPaymentTone,
  getStudentToneClasses,
  isStudentPaymentOverdue,
  type StudentTone,
} from "./student-helpers";

export type StudentStatItem = {
  label: string;
  value: ReactNode;
  description?: string;
  tone?: StudentTone;
  icon?: LucideIcon;
  surfaceTone?: boolean;
  valueClassName?: string;
};

type StudentPageHeaderProps = {
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

export function StudentPageHeader({
  title,
  description,
  eyebrow = "Student portal",
  icon: Icon,
  meta,
  action,
  aside,
  className,
  variant = "default",
}: StudentPageHeaderProps) {
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

export function StudentStatsGrid({
  items,
  className,
}: {
  items: StudentStatItem[];
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
        <StudentStatCard key={item.label} {...item} />
      ))}
    </div>
  );
}

function StudentStatCard({
  label,
  value,
  description,
  tone = "blue",
  icon: Icon,
  surfaceTone = false,
  valueClassName,
}: StudentStatItem) {
  const toneClasses = getStudentToneClasses(tone);

  return (
    <CampusMetricCard
      label={label}
      value={value}
      description={description}
      icon={Icon}
      surfaceClassName={surfaceTone ? toneClasses.surface : undefined}
      iconClassName={toneClasses.icon}
      valueClassName={clsx(toneClasses.value, valueClassName)}
    />
  );
}

type StudentFilterBarProps = {
  children: ReactNode;
  countLabel?: string;
  countValue?: ReactNode;
  countDescription?: string;
  controlsClassName?: string;
  className?: string;
};

export function StudentFilterBar({
  children,
  countLabel,
  countValue,
  countDescription,
  controlsClassName,
  className,
}: StudentFilterBarProps) {
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

type StudentEmptyStateProps = {
  title: string;
  description?: string;
  icon?: LucideIcon;
  tone?: StudentTone;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

export function StudentEmptyState({
  title,
  description,
  icon: Icon,
  tone = "slate",
  action,
  className,
  compact = false,
}: StudentEmptyStateProps) {
  const toneClasses = getStudentToneClasses(tone);

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

export function StudentEventStatusBadge({
  status,
}: {
  status: StudentEventStatus;
}) {
  const toneClasses = getStudentToneClasses(getStudentEventTone(status));

  return (
    <Chip size="sm" className={toneClasses.chip}>
      {status}
    </Chip>
  );
}

export function StudentAccountStatusChip({
  status,
  helperText,
}: {
  status: StudentAccountStatus;
  helperText?: string;
}) {
  const toneClasses = getStudentToneClasses(getStudentAccountStatusTone(status));
  const content = (
    <Chip size="sm" className={toneClasses.chip}>
      Account: {status}
    </Chip>
  );

  if (!helperText) return content;

  return <Tooltip content={helperText}>{content}</Tooltip>;
}

type StudentEventCardProps = {
  title: string;
  description?: string;
  dateLabel: string;
  timeLabel?: string;
  location?: string;
  status: StudentEventStatus;
  audienceLabel?: string;
  action?: ReactNode;
  footer?: ReactNode;
  onPress?: () => void;
  className?: string;
};

export function StudentEventCard({
  title,
  description,
  dateLabel,
  timeLabel,
  location,
  status,
  audienceLabel,
  action,
  footer,
  onPress,
  className,
}: StudentEventCardProps) {
  const toneClasses = getStudentToneClasses(getStudentEventTone(status));

  return (
    <Card
      shadow="none"
      isPressable={Boolean(onPress)}
      onPress={onPress}
      className={clsx(
        "w-full border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]",
        onPress ? "cursor-pointer transition-transform hover:-translate-y-0.5" : "",
        className,
      )}
    >
      <CardHeader className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <StudentEventStatusBadge status={status} />
            {audienceLabel ? (
              <Chip size="sm" className="bg-slate-100 text-slate-700">
                {audienceLabel}
              </Chip>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-campus-text-primary">
              {title}
            </h3>
            {description ? (
              <p className="text-sm leading-6 text-campus-text-secondary">
                {description}
              </p>
            ) : null}
          </div>

          <div className="flex flex-col gap-2 text-sm text-campus-text-secondary sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays size={14} />
              {dateLabel}
              {timeLabel ? ` | ${timeLabel}` : ""}
            </span>
            {location ? (
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={14} />
                {location}
              </span>
            ) : null}
          </div>
        </div>

        {action ? <div className="w-full shrink-0 lg:w-auto lg:pt-1">{action}</div> : null}
      </CardHeader>

      {footer ? (
        <CardBody className="px-4 pb-4 pt-0 sm:px-5 sm:pb-5">
          <div className={clsx("rounded-[20px] p-3.5 sm:p-4", toneClasses.surface)}>
            {footer}
          </div>
        </CardBody>
      ) : null}
    </Card>
  );
}

type StudentPaymentCardProps = {
  title: string;
  ref: string;
  amount: number;
  dateLabel: string;
  status: StudentPayment["status"];
  details?: string;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function StudentPaymentCard({
  title,
  ref,
  amount,
  dateLabel,
  status,
  details,
  action,
  footer,
  className,
}: StudentPaymentCardProps) {
  const isOverdue = status === "UNPAID";
  const toneClasses = getStudentToneClasses(
    getStudentPaymentTone(status, isOverdue),
  );

  return (
    <Card
      shadow="none"
      className={clsx(
        "border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <CardHeader className="flex flex-col gap-4 p-4 sm:p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" className={toneClasses.chip}>
              {status}
            </Chip>
            <Chip size="sm" className="bg-slate-100 text-slate-700">
              Ref: {ref}
            </Chip>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-campus-text-primary">
              {title}
            </h3>
            <p className="text-sm text-campus-text-secondary">Due: {dateLabel}</p>
            {details ? (
              <p className="text-sm leading-6 text-campus-text-secondary">
                {details}
              </p>
            ) : null}
          </div>
        </div>

        <div className="w-full shrink-0 space-y-3 sm:w-auto sm:text-right">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-campus-text-secondary">
              Amount
            </p>
            <p className={clsx("mt-1 text-2xl font-bold", toneClasses.value)}>
              {formatStudentCurrency(amount)}
            </p>
          </div>
          {action ? action : null}
        </div>
      </CardHeader>

      {footer ? (
        <CardBody className="px-4 pb-4 pt-0 sm:px-5 sm:pb-5">
          <div className={clsx("rounded-[20px] p-3.5 sm:p-4", toneClasses.surface)}>
            {footer}
          </div>
        </CardBody>
      ) : null}
    </Card>
  );
}

type StudentNotificationCardProps = {
  title: string;
  description: string;
  type: StudentNotificationType;
  displayDate: string;
  relativeDate?: string;
  unread?: boolean;
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
};

export function StudentNotificationCard({
  title,
  description,
  type,
  displayDate,
  relativeDate,
  unread = false,
  primaryAction,
  secondaryAction,
  className,
}: StudentNotificationCardProps) {
  const toneClasses = getStudentToneClasses(getStudentNotificationTone(type));
  const meta = getNotificationMeta(type);
  const MetaIcon = meta.icon;

  return (
    <Card
      shadow="none"
      className={clsx(
        "border border-border/70 shadow-[var(--shadow-soft)]",
        unread ? "bg-white" : "bg-slate-50/80",
        className,
      )}
    >
      <CardHeader className="items-start gap-4 p-4 sm:p-5">
        <div
          className={clsx(
            "mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.2rem] sm:h-12 sm:w-12",
            toneClasses.icon,
          )}
        >
          <MetaIcon size={18} />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip size="sm" className={toneClasses.chip}>
              {meta.label}
            </Chip>
            {unread ? (
              <Chip size="sm" className="bg-primary-50 text-primary-700">
                Unread
              </Chip>
            ) : (
              <Chip size="sm" className="bg-slate-100 text-slate-700">
                Read
              </Chip>
            )}
          </div>

          <div className="space-y-1.5">
            <h3 className="text-base font-semibold text-campus-text-primary">
              {title}
            </h3>
            <p className="text-sm leading-6 text-campus-text-secondary">
              {description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-campus-text-secondary">
            <span>{displayDate}</span>
            {relativeDate ? <span>| {relativeDate}</span> : null}
          </div>
        </div>
      </CardHeader>

      {primaryAction || secondaryAction ? (
        <CardBody className="px-4 pb-4 pt-0 sm:px-5 sm:pb-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {primaryAction}
            {secondaryAction}
          </div>
        </CardBody>
      ) : null}
    </Card>
  );
}

type StudentStatusTabsProps<T extends string> = {
  items: Array<{
    key: T;
    label: string;
    icon?: LucideIcon;
  }>;
  selectedKey: T;
  onSelectionChange: (key: T) => void;
  className?: string;
};

export function StudentStatusTabs<T extends string>({
  items,
  selectedKey,
  onSelectionChange,
  className,
}: StudentStatusTabsProps<T>) {
  return (
    <Tabs
      selectedKey={selectedKey}
      onSelectionChange={(key) => onSelectionChange(String(key) as T)}
      fullWidth
      className={className}
      classNames={{
        base: "w-full",
        tabList:
          "grid w-full grid-cols-1 gap-2 rounded-[22px] bg-slate-100 p-1 sm:grid-cols-3",
        cursor: "bg-primary-500 shadow-sm",
        tab: "h-11 px-3",
        tabContent:
          "text-sm font-semibold group-data-[selected=true]:text-white",
      }}
    >
      {items.map((item) => {
        const Icon = item.icon;

        return (
          <Tab
            key={item.key}
            title={
              <span className="inline-flex items-center gap-2">
                {Icon ? <Icon size={15} /> : null}
                <span>{item.label}</span>
              </span>
            }
          />
        );
      })}
    </Tabs>
  );
}

function getNotificationMeta(type: StudentNotificationType) {
  switch (type) {
    case "upcoming":
      return { label: "Upcoming event", icon: CalendarDays };
    case "payment":
      return { label: "Payment notice", icon: CreditCard };
    case "missed":
      return { label: "Missed event", icon: ShieldAlert };
    case "preregister":
      return { label: "Pre-registration", icon: BellRing };
    default:
      return { label: "General notice", icon: Megaphone };
  }
}

export const studentStatusIcons = {
  attended: CheckCircle2,
  missed: CircleAlert,
  payments: Landmark,
  course: GraduationCap,
  upcoming: Clock3,
};

export function studentPaymentFooter(payment: StudentPayment) {
  const overdue = isStudentPaymentOverdue(payment);
  const toneClasses = getStudentToneClasses(
    getStudentPaymentTone(payment.status, overdue),
  );

  return (
    <div className="flex flex-wrap gap-2">
      <Chip size="sm" className={toneClasses.chip}>
        {payment.status}
      </Chip>
      {payment.source === "event" ? (
        <Chip size="sm" className="bg-blue-100 text-blue-700">
          Event payment
        </Chip>
      ) : null}
      {overdue ? (
        <Chip size="sm" className="bg-rose-100 text-rose-700">
          Overdue
        </Chip>
      ) : null}
    </div>
  );
}

export function studentEventAudienceChip(course: string, yearLevel: string) {
  const label = buildStudentAudienceLabel(course, yearLevel);
  return (
    <Chip size="sm" className="bg-slate-100 text-slate-700">
      {label}
    </Chip>
  );
}
