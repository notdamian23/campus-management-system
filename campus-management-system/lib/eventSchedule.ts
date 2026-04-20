type EventScheduleInput = {
  date?: Date | string | null;
  scheduledTime?: string | null;
  timeStart?: string | null;
  timeEnd?: string | null;
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

function isValidDateParts(parts: DateParts) {
  const candidate = new Date(parts.year, parts.monthIndex, parts.day);

  return (
    !Number.isNaN(candidate.getTime()) &&
    candidate.getFullYear() === parts.year &&
    candidate.getMonth() === parts.monthIndex &&
    candidate.getDate() === parts.day
  );
}

function normalizeDateParts(value: EventScheduleInput["date"]): DateParts | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;

    return {
      year: value.getFullYear(),
      monthIndex: value.getMonth(),
      day: value.getDate(),
    };
  }

  const raw = String(value ?? "").trim();
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

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;

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
  const rangeMatch = value.match(
    /^(.+?)\s*(?:-|–|—|\bto\b)\s*(.+)$/i,
  );
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
    String(scheduledTime ?? timeStart ?? ""),
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
