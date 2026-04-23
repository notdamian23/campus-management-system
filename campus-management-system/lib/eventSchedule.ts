type TimestampLike = {
  toDate?: () => Date;
  toMillis?: () => number;
  seconds?: number;
  nanoseconds?: number;
};

export type EventScheduleDateInput =
  | Date
  | string
  | TimestampLike
  | null
  | undefined;

export type EventScheduleInput = {
  date?: EventScheduleDateInput;
  scheduledTime?: string | null;
  timeStart?: string | null;
  timeEnd?: string | null;
};

export type EventLifecycle = "upcoming" | "ongoing" | "completed";

export type EventLifecycleInput = EventScheduleInput & {
  startAt?: EventScheduleDateInput;
  endAt?: EventScheduleDateInput;
  status?: string | null;
};

export type EventLifecycleDetails = {
  lifecycle: EventLifecycle;
  startAt: Date | null;
  endAt: Date | null;
  now: Date;
  statusFallbackUsed: boolean;
};

type DateParts = {
  year: number;
  monthIndex: number;
  day: number;
};

type TimeParts = {
  hour24: number;
  minute: number;
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const DEFAULT_EVENT_DURATION_MS = 60 * 60 * 1000;

function isValidDateParts(parts: DateParts) {
  const candidate = new Date(parts.year, parts.monthIndex, parts.day);

  return (
    !Number.isNaN(candidate.getTime()) &&
    candidate.getFullYear() === parts.year &&
    candidate.getMonth() === parts.monthIndex &&
    candidate.getDate() === parts.day
  );
}

function toDateValue(value: EventScheduleDateInput): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value);
  }

  if (typeof value === "object" && value !== null) {
    if (typeof value.toDate === "function") {
      const date = value.toDate();
      return Number.isNaN(date.getTime()) ? null : date;
    }

    if (typeof value.toMillis === "function") {
      const ms = value.toMillis();
      if (Number.isFinite(ms)) {
        const date = new Date(ms);
        return Number.isNaN(date.getTime()) ? null : date;
      }
    }

    if (typeof value.seconds === "number") {
      const milliseconds =
        value.seconds * 1000 +
        (typeof value.nanoseconds === "number" ? value.nanoseconds / 1_000_000 : 0);
      const date = new Date(milliseconds);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }

  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (isoMatch) {
    const date = new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeDateParts(value: EventScheduleDateInput): DateParts | null {
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return null;

    const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if (isoMatch) {
      const parts = {
        year: Number(isoMatch[1]),
        monthIndex: Number(isoMatch[2]) - 1,
        day: Number(isoMatch[3]),
      };

      return isValidDateParts(parts) ? parts : null;
    }
  }

  const parsed = toDateValue(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return null;

  return {
    year: parsed.getFullYear(),
    monthIndex: parsed.getMonth(),
    day: parsed.getDate(),
  };
}

function formatDateLabel(value: EventScheduleInput["date"]) {
  const parts = normalizeDateParts(value);
  if (!parts) return "Date TBA";

  return `${MONTH_LABELS[parts.monthIndex]} ${parts.day}, ${parts.year}`;
}

function normalizeTimeText(value: string | null | undefined) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\bA\.?M\.?\b/i, "AM")
    .replace(/\bP\.?M\.?\b/i, "PM");
}

function isTimeTba(value: string) {
  const normalized = value.toUpperCase();
  return (
    !normalized ||
    normalized === "TBA" ||
    normalized === "TIME TBA" ||
    normalized === "TBD" ||
    normalized === "TIME TBD"
  );
}

function splitTimeRange(value: string) {
  const rangeMatch = value.match(/^(.+?)\s*(?:-|\u2013|\u2014|\bto\b)\s*(.+)$/i);
  if (!rangeMatch) {
    return { start: value, end: "" };
  }

  return {
    start: rangeMatch[1].trim(),
    end: rangeMatch[2].trim(),
  };
}

function parseTimeParts(value: string): TimeParts | null {
  const normalized = normalizeTimeText(value);
  if (isTimeTba(normalized)) return null;

  const twelveHourMatch = normalized.match(
    /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i,
  );
  if (twelveHourMatch) {
    const rawHour = Number(twelveHourMatch[1]);
    const minute = Number(twelveHourMatch[2] ?? "0");
    const meridiem = twelveHourMatch[3].toUpperCase();

    if (
      !Number.isInteger(rawHour) ||
      rawHour < 1 ||
      rawHour > 12 ||
      !Number.isInteger(minute) ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }

    let hour24 = rawHour % 12;
    if (meridiem === "PM") hour24 += 12;

    return { hour24, minute };
  }

  const twentyFourHourMatch = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    const hour24 = Number(twentyFourHourMatch[1]);
    const minute = Number(twentyFourHourMatch[2]);

    if (
      !Number.isInteger(hour24) ||
      hour24 < 0 ||
      hour24 > 23 ||
      !Number.isInteger(minute) ||
      minute < 0 ||
      minute > 59
    ) {
      return null;
    }

    return { hour24, minute };
  }

  return null;
}

function buildDateTime(
  dateValue: EventScheduleDateInput,
  timeValue: string | null | undefined,
) {
  const parts = normalizeDateParts(dateValue);
  const timeParts = parseTimeParts(String(timeValue ?? ""));
  if (!parts || !timeParts) return null;

  return new Date(
    parts.year,
    parts.monthIndex,
    parts.day,
    timeParts.hour24,
    timeParts.minute,
    0,
    0,
  );
}

function normalizeLifecycleFromStatus(status: string | null | undefined) {
  const normalized = String(status ?? "").trim().toLowerCase();

  if (
    normalized === "completed" ||
    normalized === "closed" ||
    normalized === "archived"
  ) {
    return "completed" as const;
  }

  if (
    normalized === "ongoing" ||
    normalized === "active" ||
    normalized === "live" ||
    normalized === "in progress"
  ) {
    return "ongoing" as const;
  }

  if (
    normalized === "upcoming" ||
    normalized === "scheduled" ||
    normalized === "pending"
  ) {
    return "upcoming" as const;
  }

  return null;
}

function resolveScheduleTexts({
  scheduledTime,
  timeStart,
  timeEnd,
}: Pick<EventLifecycleInput, "scheduledTime" | "timeStart" | "timeEnd">) {
  const normalizedScheduledTime = normalizeTimeText(String(scheduledTime ?? ""));
  const normalizedTimeStart = normalizeTimeText(String(timeStart ?? ""));
  const normalizedTimeEnd = normalizeTimeText(String(timeEnd ?? ""));
  const scheduledRange = splitTimeRange(normalizedScheduledTime);

  return {
    startText: normalizedTimeStart || scheduledRange.start,
    endText: normalizedTimeEnd || scheduledRange.end,
  };
}

function resolveLifecycleWindow(input: EventLifecycleInput) {
  const directStartAt = toDateValue(input.startAt);
  const directEndAt = toDateValue(input.endAt);
  const dateValue = directStartAt ?? input.date;
  const { startText, endText } = resolveScheduleTexts(input);
  const hasExplicitTime = Boolean(startText);

  const startAt =
    directStartAt ??
    buildDateTime(dateValue, startText) ??
    (() => {
      const parts = normalizeDateParts(dateValue);
      if (!parts) return null;
      return new Date(parts.year, parts.monthIndex, parts.day, 0, 0, 0, 0);
    })();

  let endAt =
    directEndAt ??
    buildDateTime(directStartAt ?? dateValue, endText) ??
    null;
  let usedDefaultEnd = false;

  if (!endAt && startAt) {
    if (hasExplicitTime) {
      endAt = new Date(startAt.getTime() + DEFAULT_EVENT_DURATION_MS);
      usedDefaultEnd = true;
    } else {
      endAt = new Date(startAt);
      endAt.setHours(23, 59, 59, 999);
    }
  }

  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
    endAt = new Date(startAt.getTime() + DEFAULT_EVENT_DURATION_MS);
    usedDefaultEnd = true;
  }

  return {
    startAt,
    endAt,
    usedDefaultEnd,
  };
}

export function resolveEventLifecycle(
  input: EventLifecycleInput,
  now = new Date(),
): EventLifecycleDetails {
  const { startAt, endAt, usedDefaultEnd } = resolveLifecycleWindow(input);
  const fallbackLifecycle = normalizeLifecycleFromStatus(input.status);
  let lifecycle: EventLifecycle = fallbackLifecycle ?? "upcoming";
  let statusFallbackUsed = false;

  if (startAt && endAt) {
    if (now.getTime() < startAt.getTime()) {
      lifecycle = "upcoming";
    } else if (now.getTime() <= endAt.getTime()) {
      lifecycle = "ongoing";
    } else {
      lifecycle = "completed";
    }

    if (
      usedDefaultEnd &&
      fallbackLifecycle === "completed" &&
      now.getTime() >= startAt.getTime()
    ) {
      lifecycle = "completed";
      statusFallbackUsed = true;
    }
  } else if (fallbackLifecycle) {
    lifecycle = fallbackLifecycle;
    statusFallbackUsed = true;
  }

  return {
    lifecycle,
    startAt,
    endAt,
    now,
    statusFallbackUsed,
  };
}

export function computeEventLifecycle(
  input: EventLifecycleInput,
  now = new Date(),
) {
  return resolveEventLifecycle(input, now).lifecycle;
}

export function getEventStartDateTime(input: EventLifecycleInput) {
  return resolveLifecycleWindow(input).startAt;
}

export function formatEventLifecycleLabel(lifecycle: EventLifecycle) {
  return `${lifecycle.charAt(0).toUpperCase()}${lifecycle.slice(1)}`;
}

function formatTimeLabel(value: string | null | undefined) {
  const parts = parseTimeParts(String(value ?? ""));
  if (!parts) return null;

  const meridiem = parts.hour24 >= 12 ? "PM" : "AM";
  const hour12 = parts.hour24 % 12 || 12;

  return `${hour12}:${String(parts.minute).padStart(2, "0")} ${meridiem}`;
}

function buildTimeLabel({
  scheduledTime,
  timeStart,
  timeEnd,
}: Pick<EventScheduleInput, "scheduledTime" | "timeStart" | "timeEnd">) {
  const rawStart = normalizeTimeText(
    String(timeStart || scheduledTime || ""),
  );
  const rawEnd = normalizeTimeText(String(timeEnd ?? ""));
  const startRange = splitTimeRange(rawStart);

  const startLabel = formatTimeLabel(startRange.start);
  const endLabel = formatTimeLabel(rawEnd || startRange.end);

  if (startLabel && endLabel && startLabel !== endLabel) {
    return `${startLabel} - ${endLabel}`;
  }

  if (startLabel) return startLabel;

  return "Time TBA";
}

export function formatEventScheduleDisplay({
  date,
  scheduledTime,
  timeStart,
  timeEnd,
}: EventScheduleInput) {
  const dateLabel = formatDateLabel(date);
  const timeLabel = buildTimeLabel({ scheduledTime, timeStart, timeEnd });

  return {
    dateLabel,
    timeLabel,
    scheduleLabel: `${dateLabel} | ${timeLabel}`,
  };
}
