"use client";

import type { ReactNode } from "react";
import { addToast } from "@heroui/toast";

export type CampusToastTone = "success" | "error" | "warning" | "info";

type CampusToastOptions = {
  title?: ReactNode;
  description?: ReactNode;
  tone?: CampusToastTone;
  timeout?: number;
  dedupeKey?: string;
  dedupeWindowMs?: number;
  preventDuplicate?: boolean;
};

const TONE_TO_COLOR = {
  success: "success",
  error: "danger",
  warning: "warning",
  info: "primary",
} as const;

const DEFAULT_TITLE = {
  success: "Success",
  error: "Something went wrong",
  warning: "Heads up",
  info: "Update",
} as const;

const recentToastKeys = new Map<string, number>();

function toToastKeyValue(value: ReactNode) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean" || value == null) {
    return "";
  }

  return "[node]";
}

function shouldSuppressToast(key: string, dedupeWindowMs: number) {
  const now = Date.now();

  recentToastKeys.forEach((timestamp, entryKey) => {
    if (now - timestamp > dedupeWindowMs) {
      recentToastKeys.delete(entryKey);
    }
  });

  const existing = recentToastKeys.get(key);
  if (existing && now - existing < dedupeWindowMs) {
    return true;
  }

  recentToastKeys.set(key, now);
  return false;
}

function showCampusToast({
  title,
  description,
  tone = "info",
  timeout,
  dedupeKey,
  dedupeWindowMs = 2200,
  preventDuplicate = true,
}: CampusToastOptions) {
  const resolvedTitle = title ?? DEFAULT_TITLE[tone];
  const toastKey =
    dedupeKey ??
    `${tone}:${toToastKeyValue(resolvedTitle)}:${toToastKeyValue(description)}`;

  if (preventDuplicate && shouldSuppressToast(toastKey, dedupeWindowMs)) {
    return;
  }

  addToast({
    title: resolvedTitle,
    description,
    color: TONE_TO_COLOR[tone],
    variant: "flat",
    radius: "md",
    timeout:
      timeout ?? (tone === "error" ? 6500 : tone === "warning" ? 5500 : 4500),
    shouldShowTimeoutProgress: true,
    classNames: {
      base: "border border-border bg-white/95 shadow-lg backdrop-blur",
      title: "font-semibold text-campus-text-primary",
      description: "text-campus-text-secondary",
      closeButton: "text-campus-text-secondary",
    },
  });
}

export const campusToast = {
  show: showCampusToast,
  success: (options: Omit<CampusToastOptions, "tone">) =>
    showCampusToast({ ...options, tone: "success" }),
  error: (options: Omit<CampusToastOptions, "tone">) =>
    showCampusToast({ ...options, tone: "error" }),
  warning: (options: Omit<CampusToastOptions, "tone">) =>
    showCampusToast({ ...options, tone: "warning" }),
  info: (options: Omit<CampusToastOptions, "tone">) =>
    showCampusToast({ ...options, tone: "info" }),
};
