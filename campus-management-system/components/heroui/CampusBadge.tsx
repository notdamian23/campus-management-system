"use client";

import { Chip, ChipProps } from "@heroui/chip";

interface CampusBadgeProps extends Omit<ChipProps, "color"> {
  status?: "upcoming" | "completed" | "ongoing" | "missed" | "paid" | "unpaid" | "active";
}

export function CampusBadge({ status, ...props }: CampusBadgeProps) {
  const colorMap = {
    upcoming: "primary" as const,
    completed: "success" as const,
    ongoing: "warning" as const,
    missed: "danger" as const,
    paid: "success" as const,
    unpaid: "danger" as const,
    active: "success" as const,
  };

  return <Chip color={status ? colorMap[status] : "default"} size="sm" {...props} />;
}
