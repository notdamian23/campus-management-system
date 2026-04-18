"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { Card, CardBody, CardFooter, CardHeader } from "@heroui/card";
import type { LucideIcon } from "lucide-react";

type CampusWorkspaceHeaderCardProps = {
  title: string;
  description: string;
  eyebrow?: string;
  icon?: LucideIcon;
  meta?: ReactNode;
  action?: ReactNode;
  aside?: ReactNode;
  className?: string;
  surfaceClassName?: string;
  variant?: "default" | "hero";
};

export function CampusWorkspaceHeaderCard({
  title,
  description,
  eyebrow,
  icon: Icon,
  meta,
  action,
  aside,
  className,
  surfaceClassName,
  variant = "default",
}: CampusWorkspaceHeaderCardProps) {
  const isHero = variant === "hero";

  return (
    <Card
      shadow="none"
      className={clsx(
        "overflow-hidden",
        isHero
          ? "border-none bg-gradient-to-br from-primary-700 via-primary-600 to-[#f19b4c] text-white shadow-[var(--shadow-card)]"
          : "border border-border/70 bg-white/90 shadow-[var(--shadow-soft)]",
        surfaceClassName,
        className,
      )}
    >
      <CardHeader className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 items-start gap-4 sm:gap-5">
          {Icon ? (
            <div
              className={clsx(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.35rem] sm:h-14 sm:w-14",
                isHero
                  ? "bg-white/15 text-white"
                  : "bg-primary-50 text-primary-700",
              )}
            >
              <Icon size={22} />
            </div>
          ) : null}

          <div className="min-w-0 space-y-2.5">
            {eyebrow ? (
              <p
                className={clsx(
                  "text-xs font-semibold uppercase tracking-[0.2em]",
                  isHero ? "text-white/75" : "text-primary-700",
                )}
              >
                {eyebrow}
              </p>
            ) : null}

            <div className="space-y-2">
              <h1
                className={clsx(
                  "text-2xl font-bold tracking-tight sm:text-3xl",
                  isHero ? "text-white" : "text-campus-text-primary",
                )}
              >
                {title}
              </h1>
              <p
                className={clsx(
                  "max-w-3xl text-sm leading-6 sm:text-[0.95rem]",
                  isHero ? "text-white/85" : "text-campus-text-secondary",
                )}
              >
                {description}
              </p>
            </div>
          </div>
        </div>

        {aside ? (
          <div className="w-full shrink-0 lg:w-auto lg:min-w-[320px]">{aside}</div>
        ) : action ? (
          <div className="w-full shrink-0 sm:w-auto">{action}</div>
        ) : null}
      </CardHeader>

      {meta ? (
        <CardBody className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-0 sm:px-6 sm:pb-6">
          {meta}
        </CardBody>
      ) : null}
    </Card>
  );
}

type CampusMetricCardProps = {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  badge?: ReactNode;
  footer?: ReactNode;
  className?: string;
  surfaceClassName?: string;
  iconClassName?: string;
  valueClassName?: string;
};

export function CampusMetricCard({
  label,
  value,
  description,
  icon: Icon,
  badge,
  footer,
  className,
  surfaceClassName,
  iconClassName,
  valueClassName,
}: CampusMetricCardProps) {
  return (
    <Card
      shadow="none"
      className={clsx(
        "border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]",
        surfaceClassName,
        className,
      )}
    >
      <CardHeader className="items-start justify-between gap-4 p-5 pb-0 sm:p-6 sm:pb-0">
        <div className="min-w-0 space-y-1.5">
          <p className="text-sm font-semibold text-campus-text-primary">{label}</p>
          {description ? (
            <p className="text-xs leading-5 text-campus-text-secondary">
              {description}
            </p>
          ) : null}
        </div>

        {Icon ? (
          <div
            className={clsx(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.2rem] sm:h-12 sm:w-12",
              iconClassName,
            )}
          >
            <Icon size={18} />
          </div>
        ) : null}
      </CardHeader>

      <CardBody className="gap-4 p-5 pt-4 sm:p-6 sm:pt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div
            className={clsx(
              "text-3xl font-black tracking-tight sm:text-[2.05rem]",
              valueClassName,
            )}
          >
            {value}
          </div>
          {badge}
        </div>

        {footer ? <div>{footer}</div> : null}
      </CardBody>
    </Card>
  );
}

type CampusSectionCardProps = {
  title?: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  surfaceClassName?: string;
  headerClassName?: string;
  bodyClassName?: string;
  footerClassName?: string;
  iconClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
};

export function CampusSectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
  footer,
  className,
  surfaceClassName,
  headerClassName,
  bodyClassName,
  footerClassName,
  iconClassName,
  titleClassName,
  descriptionClassName,
}: CampusSectionCardProps) {
  const hasHeader = Boolean(title || description || Icon || action);

  return (
    <Card
      shadow="none"
      className={clsx(
        "border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]",
        surfaceClassName,
        className,
      )}
    >
      {hasHeader ? (
        <CardHeader
          className={clsx(
            "flex flex-col gap-4 p-5 pb-0 sm:p-6 sm:pb-0 sm:flex-row sm:items-start sm:justify-between",
            headerClassName,
          )}
        >
          <div className="flex min-w-0 flex-1 items-start gap-4">
            {Icon ? (
              <div
                className={clsx(
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.2rem] bg-primary-50 text-primary-700 sm:h-12 sm:w-12",
                  iconClassName,
                )}
              >
                <Icon size={18} />
              </div>
            ) : null}

            <div className="min-w-0 space-y-1.5">
              {title ? (
                <div
                  className={clsx(
                    "text-lg font-semibold text-campus-text-primary",
                    titleClassName,
                  )}
                >
                  {title}
                </div>
              ) : null}
              {description ? (
                <p
                  className={clsx(
                    "text-sm leading-6 text-campus-text-secondary",
                    descriptionClassName,
                  )}
                >
                  {description}
                </p>
              ) : null}
            </div>
          </div>

          {action ? <div className="w-full shrink-0 sm:w-auto">{action}</div> : null}
        </CardHeader>
      ) : null}

      <CardBody
        className={clsx(
          "space-y-4 p-5 sm:space-y-5 sm:p-6",
          hasHeader ? "pt-4 sm:pt-4" : "pt-5 sm:pt-6",
          bodyClassName,
        )}
      >
        {children}
      </CardBody>

      {footer ? (
        <CardFooter className={clsx("px-5 pb-5 pt-0 sm:px-6 sm:pb-6", footerClassName)}>
          {footer}
        </CardFooter>
      ) : null}
    </Card>
  );
}

type CampusDetailTileProps = {
  label: ReactNode;
  value: ReactNode;
  icon?: LucideIcon;
  description?: ReactNode;
  className?: string;
  iconClassName?: string;
  labelClassName?: string;
  valueClassName?: string;
  descriptionClassName?: string;
};

export function CampusDetailTile({
  label,
  value,
  icon: Icon,
  description,
  className,
  iconClassName,
  labelClassName,
  valueClassName,
  descriptionClassName,
}: CampusDetailTileProps) {
  return (
    <Card
      shadow="none"
      className={clsx("border border-border/70 bg-slate-50/70", className)}
    >
      <CardHeader className="items-center gap-2 p-4 pb-0 sm:p-5 sm:pb-0">
        {Icon ? (
          <div
            className={clsx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl bg-white text-campus-text-secondary shadow-sm",
              iconClassName,
            )}
          >
            <Icon size={15} />
          </div>
        ) : null}
        <p
          className={clsx(
            "text-xs font-semibold uppercase tracking-[0.18em] text-campus-text-secondary",
            labelClassName,
          )}
        >
          {label}
        </p>
      </CardHeader>
      <CardBody className="p-4 pt-3 sm:p-5 sm:pt-3">
        <div
          className={clsx(
            "break-words text-sm leading-6 text-campus-text-primary",
            valueClassName,
          )}
        >
          {value}
        </div>
        {description ? (
          <p
            className={clsx(
              "mt-2 text-xs leading-5 text-campus-text-secondary",
              descriptionClassName,
            )}
          >
            {description}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
