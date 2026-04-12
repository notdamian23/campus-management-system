import type {
  StudentAccountStatus,
  StudentEventStatus,
  StudentNotificationType,
  StudentPayment,
} from "./StudentPortalProvider";

export type StudentTone =
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "purple"
  | "slate";

export const studentToneClasses: Record<
  StudentTone,
  {
    chip: string;
    badge: string;
    icon: string;
    value: string;
    surface: string;
  }
> = {
  blue: {
    chip: "bg-blue-100 text-blue-700",
    badge: "border-blue-100 bg-blue-50 text-blue-700",
    icon: "bg-blue-100 text-blue-700",
    value: "text-blue-700",
    surface: "bg-blue-50/80",
  },
  green: {
    chip: "bg-emerald-100 text-emerald-700",
    badge: "border-emerald-100 bg-emerald-50 text-emerald-700",
    icon: "bg-emerald-100 text-emerald-700",
    value: "text-emerald-700",
    surface: "bg-emerald-50/80",
  },
  amber: {
    chip: "bg-amber-100 text-amber-700",
    badge: "border-amber-100 bg-amber-50 text-amber-700",
    icon: "bg-amber-100 text-amber-700",
    value: "text-amber-700",
    surface: "bg-amber-50/80",
  },
  red: {
    chip: "bg-rose-100 text-rose-700",
    badge: "border-rose-100 bg-rose-50 text-rose-700",
    icon: "bg-rose-100 text-rose-700",
    value: "text-rose-700",
    surface: "bg-rose-50/80",
  },
  purple: {
    chip: "bg-violet-100 text-violet-700",
    badge: "border-violet-100 bg-violet-50 text-violet-700",
    icon: "bg-violet-100 text-violet-700",
    value: "text-violet-700",
    surface: "bg-violet-50/80",
  },
  slate: {
    chip: "bg-slate-100 text-slate-700",
    badge: "border-slate-200 bg-slate-50 text-slate-700",
    icon: "bg-slate-100 text-slate-700",
    value: "text-slate-700",
    surface: "bg-slate-50/80",
  },
};

export function getStudentToneClasses(tone: StudentTone = "slate") {
  return studentToneClasses[tone];
}

export function formatStudentEventDate(date: Date | null, fallback: string) {
  if (!date) return fallback || "Date TBA";

  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatStudentCurrency(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

export function formatStudentRelativeTime(date: Date) {
  const diffMs = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);

  if (Math.abs(diffMin) < 60) {
    if (diffMin === 0) return "just now";
    if (diffMin > 0) return `in ${diffMin}m`;
    return `${Math.abs(diffMin)}m ago`;
  }

  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) {
    if (diffHour > 0) return `in ${diffHour}h`;
    return `${Math.abs(diffHour)}h ago`;
  }

  const diffDay = Math.round(diffHour / 24);
  if (diffDay > 0) return `in ${diffDay}d`;
  return `${Math.abs(diffDay)}d ago`;
}

export function getStudentEventTone(status: StudentEventStatus): StudentTone {
  if (status === "Attended") return "green";
  if (status === "Missed") return "red";
  if (status === "Payment Due") return "red";
  if (status === "Pre-registered") return "green";
  if (status === "Waitlisted") return "amber";
  if (status === "Cancelled") return "slate";
  if (status === "Pre-registration") return "blue";
  return "amber";
}

export function getStudentNotificationTone(
  type: StudentNotificationType,
): StudentTone {
  if (type === "missed") return "red";
  if (type === "payment") return "amber";
  if (type === "preregister") return "blue";
  if (type === "upcoming") return "green";
  return "slate";
}

export function getStudentPaymentTone(
  status: StudentPayment["status"],
  isOverdue: boolean,
): StudentTone {
  if (status === "PAID") return "green";
  if (isOverdue) return "red";
  return "amber";
}

export function getStudentAccountStatusTone(
  status: StudentAccountStatus,
): StudentTone {
  return status === "Inactive" ? "red" : "green";
}

export function parseStudentDate(rawDate: string) {
  const normalized = String(rawDate ?? "").trim();
  if (!normalized) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split("-").map(Number);
    const nextDate = new Date(year, month - 1, day);
    return Number.isNaN(nextDate.getTime()) ? null : nextDate;
  }

  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function isStudentPaymentOverdue(payment: StudentPayment) {
  if (payment.status === "PAID") return false;

  const dueDate = parseStudentDate(payment.date);
  if (!dueDate) return false;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return dueDate.getTime() < today.getTime();
}

export function formatStudentDateLabel(rawDate: string, fallbackMs = 0) {
  const parsed = parseStudentDate(rawDate);
  if (parsed) {
    return parsed.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  if (fallbackMs) {
    return new Date(fallbackMs).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return "No date";
}

export function buildStudentAudienceLabel(course: string, yearLevel: string) {
  const parts: string[] = [];

  if (course && course !== "All Courses") {
    parts.push(course);
  }

  if (yearLevel && yearLevel !== "All Years") {
    parts.push(yearLevel);
  }

  return parts.length > 0 ? parts.join(" | ") : "All students";
}
