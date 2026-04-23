import type {
  TeacherAttendanceStatus,
  TeacherEvent,
  TeacherFile,
  TeacherLifecycle,
} from "./TeacherPortalProvider";

export type TeacherTone =
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "purple"
  | "slate";

export const teacherToneClasses: Record<
  TeacherTone,
  {
    chip: string;
    badge: string;
    icon: string;
    value: string;
  }
> = {
  blue: {
    chip: "bg-blue-100 text-blue-700",
    badge: "border-blue-100 bg-blue-50 text-blue-700",
    icon: "bg-blue-100 text-blue-700",
    value: "text-blue-700",
  },
  green: {
    chip: "bg-emerald-100 text-emerald-700",
    badge: "border-emerald-100 bg-emerald-50 text-emerald-700",
    icon: "bg-emerald-100 text-emerald-700",
    value: "text-emerald-700",
  },
  amber: {
    chip: "bg-amber-100 text-amber-700",
    badge: "border-amber-100 bg-amber-50 text-amber-700",
    icon: "bg-amber-100 text-amber-700",
    value: "text-amber-700",
  },
  red: {
    chip: "bg-rose-100 text-rose-700",
    badge: "border-rose-100 bg-rose-50 text-rose-700",
    icon: "bg-rose-100 text-rose-700",
    value: "text-rose-700",
  },
  purple: {
    chip: "bg-violet-100 text-violet-700",
    badge: "border-violet-100 bg-violet-50 text-violet-700",
    icon: "bg-violet-100 text-violet-700",
    value: "text-violet-700",
  },
  slate: {
    chip: "bg-slate-100 text-slate-700",
    badge: "border-slate-200 bg-slate-50 text-slate-700",
    icon: "bg-slate-100 text-slate-700",
    value: "text-slate-700",
  },
};

export function getTeacherToneClasses(tone: TeacherTone = "slate") {
  return teacherToneClasses[tone];
}

export function capitalizeTeacherLabel(value: string) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatTeacherDateTime(ms: number) {
  if (!ms) return "Unknown date";

  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatTeacherBytes(bytes: number) {
  if (!bytes) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;

  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }

  const digits = index === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[index]}`;
}

export function getTeacherLifecycleTone(
  lifecycle: TeacherLifecycle,
): TeacherTone {
  if (lifecycle === "completed") return "green";
  if (lifecycle === "ongoing") return "amber";
  return "blue";
}

export function getTeacherAttendanceTone(
  status: TeacherAttendanceStatus,
): TeacherTone {
  if (status === "Present") return "green";
  if (status === "Absent") return "red";
  return "blue";
}

export function teacherAudienceLabel(
  event: Pick<TeacherEvent, "course" | "yearLevel" | "targetStudent">,
) {
  const parts: string[] = [];

  if (event.course && event.course !== "All Courses") {
    parts.push(event.course);
  }

  if (event.yearLevel && event.yearLevel !== "All Years") {
    parts.push(event.yearLevel);
  }

  if (event.targetStudent) {
    parts.push(`Specific students: ${event.targetStudent}`);
  }

  return parts.length > 0 ? parts.join(" | ") : "All students";
}

export function isTeacherImageFile(
  file: Pick<TeacherFile, "kind" | "contentType" | "name"> | null,
) {
  if (!file) return false;
  if (file.kind === "images") return true;
  if (file.contentType.toLowerCase().startsWith("image/")) return true;

  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
}
