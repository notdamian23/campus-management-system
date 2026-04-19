"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FiCalendar, FiChevronDown } from "react-icons/fi";

import { app, auth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collectionGroup,
  collection,
  deleteDoc,
  DocumentData,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  QueryDocumentSnapshot,
  query,
  setDoc,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { DatePicker } from "@heroui/date-picker";
import { TimeInput } from "@heroui/date-input";
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from "@heroui/dropdown";
import { Input, Textarea } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import { Switch } from "@heroui/switch";
import { Tab, Tabs } from "@heroui/tabs";
import { CampusCardListSkeleton } from "@/components/ui";
import {
  AllEventDocumentsModal,
  AllEventImagesModal,
  EventDetailFileItem,
  EventDetailInfoRow,
  EventDetailSectionCard,
  EventDetailStat,
  EventFilesTabs,
  eventDetailTabsClassNames,
} from "@/components/events/EventDetailsShared";
import {
  BellRing,
  CalendarDays,
  CalendarClock,
  Clock3,
  ClipboardList,
  Download,
  FileStack,
  MapPin,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import {
  ECEmptyState,
  ECFilterBar,
  ECPageHeader,
  ECQuickActionCard,
  ECStatsGrid,
  ECStatusChipGroup,
  type ECStatItem,
  useIsBelowBreakpoint,
} from "@/components/ecmember";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import {
  CalendarDate,
  getLocalTimeZone,
  Time,
  today,
} from "@internationalized/date";
import { createCampusLogger } from "@/lib/campus-logger";
import type { CampusProfileDoc } from "@/lib/campus-auth";
import {
  canEditEvent,
  canViewEvent,
  getCourseScope,
  isBOD,
  isRegularEC,
} from "@/lib/ec-permissions";
import { logPermissionDeniedAttemptForCurrentUser } from "@/lib/firebase-functions";
import { campusToast } from "@/lib/toast";
import { formatStudentFullName } from "@/lib/student-name";

type Role = "teacher" | "student" | "ec" | "ecmember" | "admin";
type EventStatus = "upcoming" | "ongoing" | "completed";
const ecEventsLogger = createCampusLogger("EC Events");

type ViewerProfile = CampusProfileDoc & {
  uid: string;
};

type EventDoc = {
  id: string;
  title: string;
  location?: string;
  date: string;
  scheduledTime?: string;
  // Legacy fields kept for older records
  timeStart?: string;
  timeEnd?: string;
  yearLevel?: string;
  course?: string;
  yearLevels?: string[];
  courses?: string[];
  targetStudent?: string;
  selectedStudentIds?: string[];
  selectedSchoolIds?: string[];
  details?: string;
  isPreReg?: boolean;
  withPayment?: boolean;
  paymentRequired?: boolean;
  waitlistEnabled?: boolean;
  requiredPaymentId?: string;
  linkedPaymentId?: string;
  registrationStartAt?: any;
  registrationEndAt?: any;
  cancellationDeadlineAt?: any;

  preRegSlots?: number | null;
  preRegCount?: number;
  waitlistCount?: number;

  status?: EventStatus;
  createdBy?: string | null;
  createdByPosition?: string | null;
  createdByCourseScope?: string | null;
  courseScope?: string | null;
  ownerType?: "ec" | "bod";
  createdAt?: any;
};

const addToast = ({
  title,
  description,
  color = "primary",
  timeout,
}: {
  title: string;
  description: string;
  color?:
    | "success"
    | "danger"
    | "warning"
    | "primary"
    | "secondary"
    | "default";
  timeout?: number;
}) => {
  const tone =
    color === "success"
      ? "success"
      : color === "warning"
        ? "warning"
        : color === "danger"
          ? "error"
          : "info";

  campusToast.show({
    title,
    description,
    tone,
    timeout,
    dedupeKey: `ec-events:${color}:${title}:${description}`,
  });
};

function describeError(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const maybe = error as {code?: unknown; message?: unknown};
    const message =
      typeof maybe.message === "string" && maybe.message.trim() ?
        maybe.message.trim() :
        fallback;
    if (typeof maybe.code === "string" && maybe.code.trim()) {
      return `${maybe.code}: ${message}`;
    }
    return message;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}

async function logEventPermissionDeniedAttempt(
  action: string,
  targetId: string,
  error: unknown,
) {
  const message = describeError(error, "");
  if (!message.toLowerCase().includes("permission-denied")) {
    return;
  }

  try {
    await logPermissionDeniedAttemptForCurrentUser({
      action,
      targetType: "event",
      targetId,
      reason: message,
    });
  } catch {
    // Best-effort audit only.
  }
}

type EventFile = {
  id: string;
  name?: string;
  path?: string;
  downloadURL?: string;
  contentType?: string;
  size?: number;
  createdAt?: any;
  uploadedByUid?: string;
};

type RegistrationDoc = {
  id: string;
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  status: "PRE_REGISTERED" | "WAITLISTED" | "CANCELLED";
  createdAt?: any;
  updatedAt?: any;
  registeredAt?: any;
  waitlistedAt?: any;
  cancelledAt?: any;
};

type EventPaymentStudentDoc = {
  id: string;
  uid?: string;
  schoolId?: string;
  name?: string;
  studentName?: string;
  course?: string;
  year?: string;
  status?: string;
  createdAt?: any;
  updatedAt?: any;
};

type RemoteStudent = {
  uid?: string;
  schoolId?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  studentName?: string;
  name?: string;
  course?: string;
  yearLevel?: string;
  year?: string;
  status?: string;
  role?: string;
};

type StudentLookup = {
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  searchText: string;
  status: string;
  role: string;
};

type NotificationListStatus = "scheduled" | "sent";
type EventFilesTab = "images" | "docs";
type EventSortMode = "latest_to_oldest" | "oldest_to_latest" | "alphabetical";
type PendingDeleteFile = {
  eventId: string;
  kind: "images" | "docs";
  fileDocId: string;
  path: string;
  fileName: string;
};
type PendingDeleteEvent = {
  id: string;
  title: string;
};

type NotificationSummary = {
  id: string;
  dispatchId: string;
  title: string;
  message: string;
  date: string;
  scheduledTime: string;
  recipientType: "all" | "course" | "year" | "student";
  course: string;
  yearLevel: string;
  targetStudent: string;
  createdAt?: any;
  recipientCount: number;
  status: NotificationListStatus;
};

type EventDetailsTab = "overview" | "participants" | "files";

type EventAttendanceDoc = {
  id: string;
  uid?: string;
  studentUid?: string;
  schoolId?: string;
  studentName?: string;
  name?: string;
  course?: string;
  yearLevel?: string;
  year?: string;
  status?: string;
  attendanceStatus?: string;
  present?: boolean;
  timeIn?: any;
  timeInIso?: string;
  timeOut?: any;
  timeOutIso?: string;
  timestamp?: any;
  deviceTimestampIso?: string;
  createdAt?: any;
  updatedAt?: any;
};

type EventParticipantRow = {
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  attendanceStatus: string;
  attendanceTimeIn: string;
  attendanceTimeOut: string;
  paymentStatus: "Paid" | "Not Paid" | "Not Required";
  sortMs: number;
};

type AttendanceExportRow = {
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  attendanceStatus: string;
  attendanceTimeIn: string;
  attendanceTimeOut: string;
};

const ONE_MB_IN_BYTES = 1024 * 1024;
const MAX_EVENT_FILE_SIZE_BYTES = 10 * ONE_MB_IN_BYTES;
const MAX_IMAGE_DIMENSION = 2048;
const IMAGE_COMPRESSION_QUALITY_STEPS = [
  0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42,
];
const IMAGE_COMPRESSION_SCALE_STEPS = [1, 0.9, 0.8, 0.72, 0.64];
const EVENT_DOC_EXTENSIONS = new Set(["pdf", "doc", "docx"]);
const EVENT_DOC_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const EVENT_YEAR_LEVEL_CHOICES = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
];
const EVENT_COURSE_CHOICES = [
  "Computer Engineering",
  "Mechanical Engineering",
  "Electrical Engineering",
  "Electronics Engineering",
  "Industrial Engineering",
];
const ITEMS_PER_PAGE = 5;
const PARTICIPANT_ROWS_PER_PAGE_OPTIONS = ["10", "25", "50"] as const;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function parseTime12ToMinutes(t?: string) {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;

  let hour = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3].toUpperCase();

  if (hour === 12) hour = 0;
  if (ap === "PM") hour += 12;

  return hour * 60 + min;
}

function computeStatus(ev: {
  date: string;
  scheduledTime?: string;
  timeStart?: string;
  timeEnd?: string;
}): EventStatus {
  const startM = parseTime12ToMinutes(ev.scheduledTime || ev.timeStart);
  const endM = parseTime12ToMinutes(ev.timeEnd);
  if (startM == null) return "upcoming";

  const now = new Date();
  const [y, mo, d] = ev.date.split("-").map(Number);
  if (!y || !mo || !d) return "upcoming";

  const eventDate = new Date(y, mo - 1, d);

  const start = new Date(eventDate);
  start.setHours(Math.floor(startM / 60), startM % 60, 0, 0);

  if (endM == null) {
    return now < start ? "upcoming" : "completed";
  }

  const safeEnd = endM >= startM ? endM : startM + 60;
  const end = new Date(eventDate);
  end.setHours(Math.floor(safeEnd / 60), safeEnd % 60, 0, 0);

  if (now < start) return "upcoming";
  if (now >= start && now <= end) return "ongoing";
  return "completed";
}

type TimeParts = { hour: number; minute: number; ampm: "AM" | "PM" };

function to12hParts(time24: string): TimeParts {
  const [hStr, mStr] = (time24 || "07:00").split(":");
  const h = Number(hStr);
  const minute = Number(mStr);

  const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  let hour = h % 12;
  if (hour === 0) hour = 12;

  return { hour, minute: clamp(minute || 0, 0, 59), ampm };
}

function format12h(time24: string) {
  const p = to12hParts(time24);
  return `${p.hour}:${pad2(p.minute)} ${p.ampm}`;
}

function isoDateToday() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function toIsoDate(value: { year: number; month: number; day: number } | null) {
  if (!value) return "";
  return `${value.year}-${pad2(value.month)}-${pad2(value.day)}`;
}

function toCalendarDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) {
    return today(getLocalTimeZone());
  }
  return new CalendarDate(y, m, d);
}

function now24h() {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

function parse24h(time24: string) {
  const [hourRaw, minuteRaw] = String(time24 || "").split(":");
  const hour = clamp(Number(hourRaw) || 0, 0, 23);
  const minute = clamp(Number(minuteRaw) || 0, 0, 59);
  return { hour, minute };
}

function to24hStringFromValue(value: { hour: number; minute: number } | null) {
  if (!value) return "00:00";
  return `${pad2(value.hour)}:${pad2(value.minute)}`;
}

function toTimeValue(time24: string) {
  const { hour, minute } = parse24h(time24);
  return new Time(hour, minute);
}

function dateFromIsoAnd24h(dateIso: string, time24: string) {
  const [year, month, day] = String(dateIso ?? "").split("-").map(Number);
  if (!year || !month || !day) return null;

  const { hour, minute } = parse24h(time24);
  const nextDate = new Date(year, month - 1, day, hour, minute, 0, 0);
  return Number.isNaN(nextDate.getTime()) ? null : nextDate;
}

function isoDateFromDate(date: Date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function time24FromDate(date: Date) {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function toMinutesFrom24h(time24: string) {
  const { hour, minute } = parse24h(time24);
  return hour * 60 + minute;
}

function minutesTo24h(totalMinutes: number) {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function splitCommaValues(raw: string | undefined) {
  return String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeLookupText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLowerLookupText(value: unknown) {
  return normalizeLookupText(value).toLowerCase();
}

function toEventTargetList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeLookupText(item)).filter(Boolean);
  }

  return splitCommaValues(
    typeof value === "string" ? value : String(value ?? ""),
  );
}

function normalizeEventIdentifierList(value: unknown) {
  return toEventTargetList(value).map((item) => normalizeLookupText(item)).filter(Boolean);
}

function countSpecificEventAudienceSelections(
  event: Pick<EventDoc, "targetStudent" | "selectedStudentIds" | "selectedSchoolIds">,
) {
  const explicitSelections = new Set(
    [
      ...normalizeEventIdentifierList(event.selectedStudentIds).map(
        (item) => `uid:${normalizeLowerLookupText(item)}`,
      ),
      ...normalizeEventIdentifierList(event.selectedSchoolIds).map(
        (item) => `school:${normalizeLowerLookupText(item)}`,
      ),
    ].filter(Boolean),
  );
  if (explicitSelections.size > 0) {
    return explicitSelections.size;
  }

  return new Set(
    String(event.targetStudent ?? "")
      .split(";")
      .map((item) => normalizeLowerLookupText(item))
      .filter(Boolean),
  ).size;
}

function getSpecificEventAudienceSummary(
  event: Pick<EventDoc, "targetStudent" | "selectedStudentIds" | "selectedSchoolIds">,
) {
  const count = countSpecificEventAudienceSelections(event);
  return count > 0 ? `Specific students selected (${count})` : "";
}

function hasExplicitSelectedEventAudience(
  event: Pick<EventDoc, "selectedStudentIds" | "selectedSchoolIds">,
) {
  return (
    normalizeEventIdentifierList(event.selectedStudentIds).length > 0 ||
    normalizeEventIdentifierList(event.selectedSchoolIds).length > 0
  );
}

function matchesSelectedEventAudience(
  event: Pick<EventDoc, "selectedStudentIds" | "selectedSchoolIds">,
  uid: string,
  schoolId: string,
) {
  if (!hasExplicitSelectedEventAudience(event)) {
    return true;
  }

  const selectedStudentIds = normalizeEventIdentifierList(event.selectedStudentIds);
  const selectedSchoolIds = normalizeEventIdentifierList(event.selectedSchoolIds);
  const normalizedUid = normalizeLowerLookupText(uid);
  const normalizedSchoolId = normalizeLowerLookupText(schoolId);

  return (
    selectedStudentIds.some(
      (item) => normalizeLowerLookupText(item) === normalizedUid,
    ) ||
    selectedSchoolIds.some(
      (item) => normalizeLowerLookupText(item) === normalizedSchoolId,
    )
  );
}

function matchesEventTargetList(
  targetValue: unknown,
  studentValue: string,
  allLabel: string,
) {
  const targets = toEventTargetList(targetValue);
  if (targets.length === 0) return true;

  if (
    targets.some(
      (item) => normalizeLowerLookupText(item) === normalizeLowerLookupText(allLabel),
    )
  ) {
    return true;
  }

  return targets.some(
    (item) =>
      normalizeLowerLookupText(item) === normalizeLowerLookupText(studentValue),
  );
}

function matchesSpecificEventStudentTarget(
  targetValue: unknown,
  schoolId: string,
  studentName: string,
) {
  const rawTarget = normalizeLookupText(targetValue);
  if (!rawTarget) return true;

  const normalizedSchoolId = normalizeLowerLookupText(schoolId);
  const normalizedStudentName = normalizeLowerLookupText(studentName);
  if (!normalizedSchoolId && !normalizedStudentName) return false;

  const parts = rawTarget
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts.length > 0 ? parts : [rawTarget]) {
    const normalized = normalizeLowerLookupText(part);
    const withoutParens = normalizeLowerLookupText(
      part.replace(/\([^)]*\)/g, " ").trim(),
    );
    const parenMatch = part.match(/\(([^)]+)\)/);
    const insideParen = normalizeLowerLookupText(parenMatch?.[1] ?? "");

    if (
      normalized === normalizedSchoolId ||
      normalized === normalizedStudentName
    ) {
      return true;
    }

    if (insideParen && insideParen === normalizedSchoolId) {
      return true;
    }

    if (
      withoutParens &&
      (withoutParens === normalizedStudentName ||
        normalizedStudentName.includes(withoutParens) ||
        withoutParens.includes(normalizedStudentName))
    ) {
      return true;
    }

    if (normalizedSchoolId && normalized.includes(normalizedSchoolId)) {
      return true;
    }

    if (normalizedStudentName && normalized.includes(normalizedStudentName)) {
      return true;
    }
  }

  return false;
}

function sortStudentLookups(rows: StudentLookup[]) {
  return [...rows].sort(
    (left, right) =>
      left.studentName.localeCompare(right.studentName) ||
      left.schoolId.localeCompare(right.schoolId),
  );
}

function resolveRequiredEventAudience(
  event: Pick<
    EventDoc,
    | "course"
    | "courses"
    | "yearLevel"
    | "yearLevels"
    | "targetStudent"
    | "selectedStudentIds"
    | "selectedSchoolIds"
  >,
  students: StudentLookup[],
) {
  const courseTargets =
    Array.isArray(event.courses) && event.courses.length > 0
      ? event.courses.map((item) => normalizeLookupText(item)).filter(Boolean)
      : toEventTargetList(event.course);
  const yearTargets =
    Array.isArray(event.yearLevels) && event.yearLevels.length > 0
      ? event.yearLevels.map((item) => normalizeLookupText(item)).filter(Boolean)
      : toEventTargetList(event.yearLevel);
  const hasSpecificTarget = Boolean(normalizeLookupText(event.targetStudent));
  const hasSelectedAudience = hasExplicitSelectedEventAudience(event);
  const hasExplicitAudience =
    courseTargets.length > 0 ||
    yearTargets.length > 0 ||
    hasSpecificTarget ||
    hasSelectedAudience;

  if (!hasExplicitAudience) {
    return {
      resolved: false,
      students: [] as StudentLookup[],
    };
  }

  const activeStudents = students.filter(
    (student) => normalizeLowerLookupText(student.status) !== "inactive",
  );

  const matchedStudents = activeStudents.filter((student) => {
    const selectedMatch = matchesSelectedEventAudience(
      event,
      student.uid,
      student.schoolId,
    );
    if (!selectedMatch) {
      return false;
    }

    if (hasSelectedAudience) {
      return true;
    }

    const courseMatch = matchesEventTargetList(
      courseTargets,
      student.course,
      "All Courses",
    );
    const yearMatch = matchesEventTargetList(
      yearTargets,
      student.year,
      "All Years",
    );
    const studentMatch = matchesSpecificEventStudentTarget(
      event.targetStudent,
      student.schoolId,
      student.studentName,
    );
    return courseMatch && yearMatch && studentMatch;
  });

  return {
    resolved: true,
    students: sortStudentLookups(matchedStudents),
  };
}

function parseTargetStudents(
  targetStudent: string | undefined,
  allStudents: StudentLookup[],
) {
  const tokens = String(targetStudent ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (tokens.length === 0) return [] as StudentLookup[];

  const seen = new Set<string>();
  const selected: StudentLookup[] = [];

  tokens.forEach((token, index) => {
    const match = token.match(/^(.*)\(([^)]+)\)$/);
    const studentName = formatStudentFullName({
      name: String(match?.[1] ?? token).trim(),
    });
    const schoolId = String(match?.[2] ?? "").trim();

    const fromOptions =
      (schoolId
        ? allStudents.find((student) => student.schoolId === schoolId)
        : undefined) ??
      allStudents.find(
        (student) =>
          student.studentName.toLowerCase() === studentName.toLowerCase(),
      );

    if (fromOptions) {
      const key = `uid:${fromOptions.uid}`;
      if (!seen.has(key)) {
        seen.add(key);
        selected.push(fromOptions);
      }
      return;
    }

    const fallbackName = studentName || schoolId || `Student ${index + 1}`;
    const fallbackSchoolId = schoolId || "Unknown ID";
    const fallbackKey =
      `manual:${fallbackSchoolId}|${fallbackName}`.toLowerCase();
    if (seen.has(fallbackKey)) return;

    seen.add(fallbackKey);
    selected.push({
      uid: `manual-${index}-${fallbackSchoolId}-${fallbackName}`
        .replace(/\s+/g, "-")
        .toLowerCase(),
      schoolId: fallbackSchoolId,
      studentName: fallbackName,
      course: "",
      year: "",
      searchText: `${fallbackName} ${fallbackSchoolId}`.toLowerCase(),
      status: "Unknown",
      role: "student",
    });
  });

  return selected;
}

function toMillis(value: any): number {
  if (
    value &&
    typeof value === "object" &&
    typeof value.toMillis === "function"
  ) {
    return value.toMillis();
  }
  if (value && typeof value === "object" && typeof value.seconds === "number") {
    return Number(value.seconds) * 1000;
  }
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function parseRegistrationStatus(
  raw: unknown,
): RegistrationDoc["status"] {
  const normalized = String(raw ?? "").trim().toUpperCase();
  if (normalized === "WAITLISTED") return "WAITLISTED";
  if (normalized === "CANCELLED") return "CANCELLED";
  return "PRE_REGISTERED";
}

function formatRegistrationStatus(
  status: RegistrationDoc["status"],
): string {
  if (status === "WAITLISTED") return "Waitlisted";
  if (status === "CANCELLED") return "Cancelled";
  return "Pre-registered";
}

function registrationSortMillis(row: Partial<RegistrationDoc>): number {
  return (
    toMillis(row.registeredAt) ||
    toMillis(row.waitlistedAt) ||
    toMillis(row.cancelledAt) ||
    toMillis(row.updatedAt) ||
    toMillis(row.createdAt)
  );
}

function formatDateTime(value: any): string {
  const ms = toMillis(value);
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function makePaymentRef(paymentId: string) {
  const year = new Date().getFullYear();
  return `PMT-${year}-${paymentId.slice(0, 6).toUpperCase()}`;
}

function isPresentAttendanceStatus(status: string) {
  const normalized = normalizeLowerLookupText(status);
  return normalized === "present" || normalized === "timed in";
}

function getEventLinkedPaymentId(
  event: Pick<EventDoc, "linkedPaymentId" | "requiredPaymentId"> | null | undefined,
) {
  return String(event?.linkedPaymentId ?? event?.requiredPaymentId ?? "").trim();
}

function normalizePaymentAssignmentStatus(value: unknown): "Paid" | "Unpaid" {
  return normalizeLowerLookupText(value) === "paid" ? "Paid" : "Unpaid";
}

function getPaymentStatusByStudent(
  event: Pick<EventDoc, "withPayment" | "paymentRequired"> | null | undefined,
  paymentAssignmentsByUid: Map<string, "Paid" | "Unpaid">,
  paymentAssignmentsBySchoolId: Map<string, "Paid" | "Unpaid">,
  uid: string,
  schoolId: string,
): EventParticipantRow["paymentStatus"] {
  const paymentRequired =
    event?.withPayment === true || event?.paymentRequired === true;
  if (!paymentRequired) {
    return "Not Required";
  }

  const normalizedUid = String(uid ?? "").trim();
  const normalizedSchoolId = String(schoolId ?? "").trim();
  const status =
    (normalizedUid ? paymentAssignmentsByUid.get(normalizedUid) : undefined) ??
    (normalizedSchoolId ?
      paymentAssignmentsBySchoolId.get(normalizedSchoolId) :
      undefined);

  return status === "Paid" ? "Paid" : "Not Paid";
}

function participantStatusSortRank(status: string) {
  const normalized = normalizeLowerLookupText(status);
  if (normalized === "present" || normalized === "timed in") return 0;
  if (normalized === "absent" || normalized === "missed") return 1;
  if (normalized === "not paid") return 2;
  if (normalized === "pre-registered") return 3;
  if (normalized === "waitlisted") return 4;
  if (normalized === "cancelled") return 5;
  return 6;
}

function buildAttendanceMetadataRows(
  event: Pick<
    EventDoc,
    "title" | "date" | "scheduledTime" | "timeStart" | "timeEnd" | "location"
  >,
  generatedAt: string,
) {
  return [
    ["Event Title", String(event.title ?? "").trim() || "-"],
    ["Date", String(event.date ?? "").trim() || "-"],
    [
      "Scheduled Time In / Start Time",
      String(event.scheduledTime || event.timeStart || "").trim() || "-",
    ],
    [
      "Scheduled Time Out / End Time",
      String(event.timeEnd || "").trim() || "-",
    ],
    ["Location", String(event.location ?? "").trim() || "-"],
    ["Generated At", generatedAt],
    [],
  ];
}

function buildAttendanceSheetRows(
  event: Pick<
    EventDoc,
    "title" | "date" | "scheduledTime" | "timeStart" | "timeEnd" | "location"
  >,
  rows: AttendanceExportRow[],
  generatedAt: string,
  includeTimeColumns: boolean,
) {
  const metadataRows = buildAttendanceMetadataRows(event, generatedAt);
  const headerRow = includeTimeColumns
    ? [
        "School ID",
        "Student Name",
        "Course",
        "Year",
        "Attendance Status",
        "Attendance Time In",
        "Attendance Time Out",
      ]
    : ["School ID", "Student Name", "Course", "Year", "Attendance Status"];
  const bodyRows = rows.map((row) =>
    includeTimeColumns
      ? [
          row.schoolId,
          row.studentName,
          row.course,
          row.year,
          row.attendanceStatus,
          row.attendanceTimeIn,
          row.attendanceTimeOut,
        ]
      : [
          row.schoolId,
          row.studentName,
          row.course,
          row.year,
          row.attendanceStatus,
        ],
  );

  return [...metadataRows, headerRow, ...bodyRows];
}

function formatEventScheduleLabel(event: Pick<EventDoc, "scheduledTime" | "timeStart" | "timeEnd">) {
  const start = String(event.scheduledTime || event.timeStart || "").trim() || "TBA";
  const end = String(event.timeEnd || "").trim();
  return end ? `${start} - ${end}` : start;
}

function getEventTargetLabel(
  event: Pick<
    EventDoc,
    "course" | "yearLevel" | "targetStudent" | "selectedStudentIds" | "selectedSchoolIds"
  >,
) {
  const specificAudienceSummary = getSpecificEventAudienceSummary(event);
  if (specificAudienceSummary) {
    return specificAudienceSummary;
  }

  const pieces: string[] = [];

  if (String(event.course ?? "").trim() && String(event.course).trim() !== "All Courses") {
    pieces.push(String(event.course).trim());
  }

  if (String(event.yearLevel ?? "").trim() && String(event.yearLevel).trim() !== "All Years") {
    pieces.push(String(event.yearLevel).trim());
  }

  return pieces.length > 0 ? pieces.join(" | ") : "All students";
}

function toEventDetailFileItem(
  file: EventFile,
  kind: "images" | "docs",
): EventDetailFileItem {
  return {
    id: file.id,
    name:
      String(
        file.name ?? (kind === "images" ? "Untitled image" : "Untitled document"),
      ).trim() || (kind === "images" ? "Untitled image" : "Untitled document"),
    kind,
    size: Number(file.size ?? 0),
    downloadURL: String(file.downloadURL ?? "").trim(),
    contentType: String(file.contentType ?? "").trim(),
    createdAtMs: toMillis(file.createdAt),
  };
}

function getEventParticipantToneClasses(status: string) {
  if (status === "Present") return "bg-emerald-100 text-emerald-700";
  if (status === "Not Paid") return "bg-amber-100 text-amber-800";
  if (status === "Missed" || status === "Absent") return "bg-rose-100 text-rose-700";
  if (status === "Waitlisted") return "bg-amber-100 text-amber-700";
  if (status === "Cancelled") return "bg-slate-100 text-slate-700";
  return "bg-blue-100 text-blue-700";
}

function buildEventParticipantRows(
  event: EventDoc | null,
  registrations: RegistrationDoc[],
  attendanceRows: EventAttendanceDoc[],
  paymentAssignments: EventPaymentStudentDoc[] = [],
  audienceStudents: StudentLookup[] = [],
) {
  if (!event) return [] as EventParticipantRow[];

  const rowsByUid = new Map<string, EventParticipantRow>();
  const preRegisteredByUid = new Set<string>();
  const preRegisteredBySchoolId = new Set<string>();
  const paymentAssignmentsByUid = new Map<string, "Paid" | "Unpaid">();
  const paymentAssignmentsBySchoolId = new Map<string, "Paid" | "Unpaid">();

  paymentAssignments.forEach((assignment) => {
    const uid = String(assignment.uid ?? assignment.id).trim();
    const schoolId = String(assignment.schoolId ?? "").trim();
    const status = normalizePaymentAssignmentStatus(assignment.status);

    if (uid) {
      paymentAssignmentsByUid.set(uid, status);
    }
    if (schoolId) {
      paymentAssignmentsBySchoolId.set(schoolId, status);
    }
  });

  audienceStudents.forEach((student) => {
    const uid = String(student.uid ?? "").trim();
    if (!uid) return;

    const schoolId = String(student.schoolId ?? "").trim() || uid;
    const paymentStatus = getPaymentStatusByStudent(
      event,
      paymentAssignmentsByUid,
      paymentAssignmentsBySchoolId,
      uid,
      schoolId,
    );

    rowsByUid.set(uid, {
      uid,
      schoolId,
      studentName: student.studentName || schoolId,
      course: String(student.course ?? "").trim() || "-",
      year: String(student.year ?? "").trim() || "-",
      attendanceStatus: paymentStatus === "Not Paid" ? "Not Paid" : "Eligible",
      attendanceTimeIn: "-",
      attendanceTimeOut: "-",
      paymentStatus,
      sortMs: 0,
    });
  });

  registrations.forEach((registration) => {
    const uid = String(registration.uid ?? registration.id).trim();
    if (!uid) return;
    const schoolId = String(registration.schoolId ?? "").trim();
    const studentName = formatStudentFullName(
      {
        studentName: registration.studentName,
        schoolId: registration.schoolId,
      },
      schoolId || uid,
    );
    const course = String(registration.course ?? "").trim() || "-";
    const year = String(registration.year ?? "").trim() || "-";
    if (
      !matchesSelectedEventAudience(event, uid, schoolId) ||
      (!hasExplicitSelectedEventAudience(event) &&
        (!matchesEventTargetList(
          Array.isArray(event.courses) && event.courses.length > 0
            ? event.courses
            : event.course,
          course,
          "All Courses",
        ) ||
          !matchesEventTargetList(
            Array.isArray(event.yearLevels) && event.yearLevels.length > 0
              ? event.yearLevels
              : event.yearLevel,
            year,
            "All Years",
          ) ||
          !matchesSpecificEventStudentTarget(
            event.targetStudent,
            schoolId,
            studentName,
          )))
    ) {
      return;
    }

    if (parseRegistrationStatus(registration.status) === "PRE_REGISTERED") {
      preRegisteredByUid.add(uid);
      if (schoolId) {
        preRegisteredBySchoolId.add(schoolId);
      }
    }

    const paymentStatus = getPaymentStatusByStudent(
      event,
      paymentAssignmentsByUid,
      paymentAssignmentsBySchoolId,
      uid,
      schoolId || uid,
    );

    rowsByUid.set(uid, {
      uid,
      schoolId: schoolId || uid,
      studentName,
      course,
      year,
      attendanceStatus:
        paymentStatus === "Not Paid" ?
          "Not Paid" :
          formatRegistrationStatus(parseRegistrationStatus(registration.status)),
      attendanceTimeIn: "-",
      attendanceTimeOut: "-",
      paymentStatus,
      sortMs: registrationSortMillis(registration),
    });
  });

  attendanceRows.forEach((rowDoc) => {
    const uid = String(rowDoc.uid ?? rowDoc.studentUid ?? rowDoc.id).trim();
    if (!uid) return;

    const existing = rowsByUid.get(uid);
    const schoolId =
      String(rowDoc.schoolId ?? existing?.schoolId ?? "").trim() || uid;
    const studentName = formatStudentFullName(
      {
        studentName: rowDoc.studentName ?? existing?.studentName,
        name: rowDoc.name,
        schoolId: rowDoc.schoolId ?? existing?.schoolId,
      },
      schoolId,
    );
    const course = String(rowDoc.course ?? existing?.course ?? "").trim() || "-";
    const year =
      String(rowDoc.yearLevel ?? rowDoc.year ?? existing?.year ?? "").trim() ||
      "-";
    if (
      !matchesSelectedEventAudience(event, uid, schoolId) ||
      (!hasExplicitSelectedEventAudience(event) &&
        (!matchesEventTargetList(
          Array.isArray(event.courses) && event.courses.length > 0
            ? event.courses
            : event.course,
          course,
          "All Courses",
        ) ||
          !matchesEventTargetList(
            Array.isArray(event.yearLevels) && event.yearLevels.length > 0
              ? event.yearLevels
              : event.yearLevel,
            year,
            "All Years",
          ) ||
          !matchesSpecificEventStudentTarget(
            event.targetStudent,
            schoolId,
            studentName,
          )))
    ) {
      return;
    }

    if (
      event.isPreReg &&
      !preRegisteredByUid.has(uid) &&
      !preRegisteredBySchoolId.has(schoolId)
    ) {
      return;
    }

    const fallbackStatus =
      typeof rowDoc.present === "boolean"
        ? rowDoc.present
          ? "Present"
          : "Absent"
        : "";
    const timeInValue = formatDateTime(
      rowDoc.timeInIso ||
        rowDoc.timeIn ||
        rowDoc.timestamp ||
        rowDoc.updatedAt ||
        rowDoc.createdAt,
    );
    const timeOutValue = formatDateTime(rowDoc.timeOutIso || rowDoc.timeOut);
    const derivedStatus =
      timeInValue !== "-" && timeOutValue !== "-"
        ? "Present"
        : timeInValue !== "-"
          ? "Timed In"
          : "";
    const status =
      String(
        rowDoc.attendanceStatus ?? rowDoc.status ?? fallbackStatus ?? "",
      ).trim() ||
      derivedStatus ||
      existing?.attendanceStatus ||
      "Recorded";

    const paymentStatus = getPaymentStatusByStudent(
      event,
      paymentAssignmentsByUid,
      paymentAssignmentsBySchoolId,
      uid,
      schoolId,
    );

    rowsByUid.set(uid, {
      uid,
      schoolId,
      studentName,
      course,
      year,
      attendanceStatus: paymentStatus === "Not Paid" ? "Not Paid" : status,
      attendanceTimeIn:
        timeInValue !== "-" ? timeInValue : (existing?.attendanceTimeIn ?? "-"),
      attendanceTimeOut:
        timeOutValue !== "-" ? timeOutValue : (existing?.attendanceTimeOut ?? "-"),
      paymentStatus,
      sortMs: Math.max(
        toMillis(rowDoc.updatedAt || rowDoc.createdAt || rowDoc.timestamp),
        existing?.sortMs ?? 0,
      ),
    });
  });

  const eventCompleted = computeStatus(event) === "completed";
  rowsByUid.forEach((row) => {
    const paymentStatus = getPaymentStatusByStudent(
      event,
      paymentAssignmentsByUid,
      paymentAssignmentsBySchoolId,
      row.uid,
      row.schoolId,
    );
    row.paymentStatus = paymentStatus;

    if (paymentStatus === "Not Paid") {
      row.attendanceStatus = "Not Paid";
      return;
    }

    if (row.attendanceStatus === "Missed") {
      row.attendanceStatus = "Absent";
    }

    if (
      eventCompleted &&
      !isPresentAttendanceStatus(row.attendanceStatus) &&
      row.attendanceStatus !== "Waitlisted" &&
      row.attendanceStatus !== "Cancelled" &&
      row.attendanceStatus !== "Not Paid"
    ) {
      row.attendanceStatus = "Absent";
    }
  });

  return Array.from(rowsByUid.values()).sort((left, right) => {
    const byStatus =
      participantStatusSortRank(left.attendanceStatus) -
      participantStatusSortRank(right.attendanceStatus);
    if (byStatus !== 0) return byStatus;
    const byName = left.studentName.localeCompare(right.studentName);
    if (byName !== 0) return byName;
    return left.schoolId.localeCompare(right.schoolId);
  });
}

function sortAttendanceExportRows(rows: AttendanceExportRow[]) {
  return [...rows].sort(
    (left, right) =>
      left.studentName.localeCompare(right.studentName) ||
      left.schoolId.localeCompare(right.schoolId),
  );
}

function toPresentAttendanceExportRow(
  student: StudentLookup,
  participantRow: EventParticipantRow,
): AttendanceExportRow {
  return {
    schoolId: participantRow.schoolId || student.schoolId,
    studentName: participantRow.studentName || student.studentName,
    course: participantRow.course || student.course || "-",
    year: participantRow.year || student.year || "-",
    attendanceStatus: "Present",
    attendanceTimeIn: participantRow.attendanceTimeIn || "-",
    attendanceTimeOut: participantRow.attendanceTimeOut || "-",
  };
}

function toAbsentAttendanceExportRow(student: StudentLookup): AttendanceExportRow {
  return {
    schoolId: student.schoolId,
    studentName: student.studentName,
    course: student.course || "-",
    year: student.year || "-",
    attendanceStatus: "Absent",
    attendanceTimeIn: "",
    attendanceTimeOut: "",
  };
}

function toNotPaidAttendanceExportRow(
  student: StudentLookup,
  participantRow?: EventParticipantRow | null,
): AttendanceExportRow {
  return {
    schoolId: participantRow?.schoolId || student.schoolId,
    studentName: participantRow?.studentName || student.studentName,
    course: participantRow?.course || student.course || "-",
    year: participantRow?.year || student.year || "-",
    attendanceStatus: "Not Paid",
    attendanceTimeIn: "",
    attendanceTimeOut: "",
  };
}

async function downloadAttendanceWorkbook(
  event: EventDoc,
  presentRows: AttendanceExportRow[],
  absentRows: AttendanceExportRow[],
  notPaidRows: AttendanceExportRow[],
) {
  const generatedAt = new Date().toLocaleString();
  const presentSheetData = buildAttendanceSheetRows(
    event,
    presentRows,
    generatedAt,
    true,
  );
  const absentSheetData = buildAttendanceSheetRows(
    event,
    absentRows,
    generatedAt,
    false,
  );
  const notPaidSheetData = buildAttendanceSheetRows(
    event,
    notPaidRows,
    generatedAt,
    false,
  );
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const presentSheet = XLSX.utils.aoa_to_sheet(presentSheetData);
  const absentsSheet = XLSX.utils.aoa_to_sheet(absentSheetData);
  const notPaidSheet = XLSX.utils.aoa_to_sheet(notPaidSheetData);

  presentSheet["!cols"] = [
    { wch: 16 },
    { wch: 30 },
    { wch: 24 },
    { wch: 10 },
    { wch: 18 },
    { wch: 24 },
    { wch: 24 },
  ];
  absentsSheet["!cols"] = [
    { wch: 16 },
    { wch: 30 },
    { wch: 24 },
    { wch: 10 },
    { wch: 18 },
  ];
  notPaidSheet["!cols"] = [
    { wch: 16 },
    { wch: 30 },
    { wch: 24 },
    { wch: 10 },
    { wch: 18 },
  ];

  XLSX.utils.book_append_sheet(workbook, presentSheet, "Present");
  XLSX.utils.book_append_sheet(workbook, absentsSheet, "Absents");
  XLSX.utils.book_append_sheet(workbook, notPaidSheet, "Not Paid");

  const slug = (event.title || event.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  XLSX.writeFile(workbook, `${slug || event.id}-attendance.xlsx`);
}

function getDateTimeMs(date: string, time12?: string) {
  const raw = String(date ?? "").trim();
  if (!raw) return 0;

  const [y, m, d] = raw.split("-").map(Number);
  if (!y || !m || !d) return 0;

  const out = new Date(y, m - 1, d);
  const mins = parseTime12ToMinutes(time12);
  if (mins != null) {
    out.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  } else {
    out.setHours(0, 0, 0, 0);
  }
  return out.getTime();
}

function computeNotificationStatus(
  date: string,
  scheduledTime?: string,
): NotificationListStatus {
  const when = getDateTimeMs(date, scheduledTime);
  if (!when) return "sent";
  return when > Date.now() ? "scheduled" : "sent";
}

function getFileExtension(filename: string) {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function isAllowedEventDocument(file: File) {
  const ext = getFileExtension(file.name);
  if (EVENT_DOC_EXTENSIONS.has(ext)) return true;
  return EVENT_DOC_MIME_TYPES.has(file.type);
}

function toMegabytesText(bytes: number) {
  return `${(bytes / ONE_MB_IN_BYTES).toFixed(2)}MB`;
}

function toCompressedImageName(filename: string) {
  const i = filename.lastIndexOf(".");
  const stem = i >= 0 ? filename.slice(0, i) : filename;
  return `${stem}.jpg`;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to compress image."));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`"${file.name}" is not a readable image.`));
    };

    image.src = objectUrl;
  });
}

async function compressImageForUpload(file: File, maxBytes: number) {
  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error(`"${file.name}" has invalid image dimensions.`);
  }

  const longestEdge = Math.max(sourceWidth, sourceHeight);
  const baseRatio =
    longestEdge > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / longestEdge : 1;
  const baseWidth = Math.max(1, Math.round(sourceWidth * baseRatio));
  const baseHeight = Math.max(1, Math.round(sourceHeight * baseRatio));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Image compression is not available in this browser.");

  let smallestBlob: Blob | null = null;

  for (const scale of IMAGE_COMPRESSION_SCALE_STEPS) {
    canvas.width = Math.max(1, Math.round(baseWidth * scale));
    canvas.height = Math.max(1, Math.round(baseHeight * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of IMAGE_COMPRESSION_QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!smallestBlob || blob.size < smallestBlob.size) smallestBlob = blob;

      if (blob.size <= maxBytes) {
        return new File([blob], toCompressedImageName(file.name), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }
    }
  }

  if (!smallestBlob) {
    throw new Error(`Unable to compress "${file.name}".`);
  }

  return new File([smallestBlob], toCompressedImageName(file.name), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

export default function EventDashboard() {
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);
  const isCompactViewport = useIsBelowBreakpoint(768);
  const [showAddEventForm, setShowAddEventForm] = useState(false);
  const [showNotificationForm, setShowNotificationForm] = useState(false);
  const [listTab, setListTab] = useState<"events" | "notifications">("events");

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | EventStatus>("all");
  const [eventDateFilter, setEventDateFilter] = useState("");
  const [eventSortMode, setEventSortMode] =
    useState<EventSortMode>("latest_to_oldest");
  const [eventPage, setEventPage] = useState(1);

  const [notifTitle, setNotifTitle] = useState("");
  const [notifDate, setNotifDate] = useState<string>(() => isoDateToday());
  const [notifDateValue, setNotifDateValue] = useState<any>(() =>
    toCalendarDate(isoDateToday()),
  );
  const [notifMessage, setNotifMessage] = useState("");
  const [notifSearchName, setNotifSearchName] = useState("");
  const [notifSearchId, setNotifSearchId] = useState("");
  const [selectedNotifStudents, setSelectedNotifStudents] = useState<
    StudentLookup[]
  >([]);
  const [notifYearSearch, setNotifYearSearch] = useState("");
  const [selectedNotifYearLevels, setSelectedNotifYearLevels] = useState<
    string[]
  >([]);
  const [showNotifYearDropdown, setShowNotifYearDropdown] = useState(false);
  const [isAllNotifYearsExplicit, setIsAllNotifYearsExplicit] = useState(false);
  const [notifCourseSearch, setNotifCourseSearch] = useState("");
  const [selectedNotifCourses, setSelectedNotifCourses] = useState<string[]>(
    [],
  );
  const [showNotifCourseDropdown, setShowNotifCourseDropdown] = useState(false);
  const [isAllNotifCoursesExplicit, setIsAllNotifCoursesExplicit] =
    useState(false);
  const [notifRegistrantsModalOpen, setNotifRegistrantsModalOpen] =
    useState(false);
  const [notifScheduled24, setNotifScheduled24] = useState<string>(() =>
    now24h(),
  );
  const [notifScheduledValue, setNotifScheduledValue] = useState<Time | null>(
    () => toTimeValue(now24h()),
  );
  const [editingNotificationDispatchId, setEditingNotificationDispatchId] =
    useState<string | null>(null);
  const [sendingNotif, setSendingNotif] = useState(false);
  const [notifError, setNotifError] = useState("");
  const [notifMsg, setNotifMsg] = useState("");
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState("");
  const [studentOptions, setStudentOptions] = useState<StudentLookup[]>([]);
  const [showStudentDropdown, setShowStudentDropdown] = useState(false);
  const studentPickerRef = useRef<HTMLDivElement | null>(null);
  const notifYearPickerRef = useRef<HTMLDivElement | null>(null);
  const notifCoursePickerRef = useRef<HTMLDivElement | null>(null);
  const [eventSearchName, setEventSearchName] = useState("");
  const [selectedEventStudents, setSelectedEventStudents] = useState<
    StudentLookup[]
  >([]);
  const [showEventStudentDropdown, setShowEventStudentDropdown] =
    useState(false);
  const [eventYearSearch, setEventYearSearch] = useState("");
  const [selectedEventYearLevels, setSelectedEventYearLevels] = useState<
    string[]
  >([]);
  const [showEventYearDropdown, setShowEventYearDropdown] = useState(false);
  const [isAllYearsExplicit, setIsAllYearsExplicit] = useState(false);
  const [eventCourseSearch, setEventCourseSearch] = useState("");
  const [selectedEventCourses, setSelectedEventCourses] = useState<string[]>(
    [],
  );
  const [showEventCourseDropdown, setShowEventCourseDropdown] = useState(false);
  const [isAllCoursesExplicit, setIsAllCoursesExplicit] = useState(false);
  const [registrantsModalOpen, setRegistrantsModalOpen] = useState(false);
  const eventStudentPickerRef = useRef<HTMLDivElement | null>(null);
  const eventYearPickerRef = useRef<HTMLDivElement | null>(null);
  const eventCoursePickerRef = useRef<HTMLDivElement | null>(null);

  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [selectedEventTab, setSelectedEventTab] =
    useState<EventDetailsTab>("overview");
  const [participantSearch, setParticipantSearch] = useState("");
  const [participantPage, setParticipantPage] = useState(1);
  const [participantRowsPerPage, setParticipantRowsPerPage] = useState<string>(
    PARTICIPANT_ROWS_PER_PAGE_OPTIONS[0],
  );
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState<string>(() => isoDateToday());
  const [eventDateValue, setEventDateValue] = useState<any>(() =>
    toCalendarDate(isoDateToday()),
  );
  const [details, setDetails] = useState("");
  const [isPreReg, setIsPreReg] = useState(false);
  const [withPayment, setWithPayment] = useState(false);
  const [waitlistEnabled, setWaitlistEnabled] = useState(false);
  const [requiredPaymentId, setRequiredPaymentId] = useState("");
  const [paymentTitle, setPaymentTitle] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentDueDate, setPaymentDueDate] = useState("");
  const [paymentDescription, setPaymentDescription] = useState("");

  const [eventScheduled24, setEventScheduled24] = useState("07:00");
  const [eventStartTimeValue, setEventStartTimeValue] = useState<Time | null>(
    () => toTimeValue("07:00"),
  );
  const [eventEnd24, setEventEnd24] = useState("08:00");
  const [eventEndTimeValue, setEventEndTimeValue] = useState<Time | null>(() =>
    toTimeValue("08:00"),
  );
  const [registrationStartDate, setRegistrationStartDate] = useState<string>(
    () => isoDateToday(),
  );
  const [registrationStartDateValue, setRegistrationStartDateValue] =
    useState<any>(() => toCalendarDate(isoDateToday()));
  const [registrationStart24, setRegistrationStart24] = useState(() => now24h());
  const [registrationStartTimeValue, setRegistrationStartTimeValue] =
    useState<Time | null>(() => toTimeValue(now24h()));
  const [registrationEndDate, setRegistrationEndDate] = useState<string>(
    () => isoDateToday(),
  );
  const [registrationEndDateValue, setRegistrationEndDateValue] = useState<any>(
    () => toCalendarDate(isoDateToday()),
  );
  const [registrationEnd24, setRegistrationEnd24] = useState("23:59");
  const [registrationEndTimeValue, setRegistrationEndTimeValue] =
    useState<Time | null>(() => toTimeValue("23:59"));
  const [cancellationDeadlineDate, setCancellationDeadlineDate] =
    useState<string>(() => isoDateToday());
  const [cancellationDeadlineDateValue, setCancellationDeadlineDateValue] =
    useState<any>(() => toCalendarDate(isoDateToday()));
  const [cancellationDeadline24, setCancellationDeadline24] =
    useState("23:59");
  const [cancellationDeadlineTimeValue, setCancellationDeadlineTimeValue] =
    useState<Time | null>(() => toTimeValue("23:59"));

  const [preRegSlots, setPreRegSlots] = useState<number>(50);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const [isECUser, setIsECUser] = useState(false);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(null);
  const [roleLoading, setRoleLoading] = useState(true);

  const [events, setEvents] = useState<EventDoc[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [expandedNotificationId, setExpandedNotificationId] = useState<
    string | null
  >(null);
  const [notificationSearchText, setNotificationSearchText] = useState("");
  const [notificationStatusFilter, setNotificationStatusFilter] = useState<
    "all" | NotificationListStatus
  >("all");
  const [notificationDateFilter, setNotificationDateFilter] = useState("");
  const [notificationSortMode, setNotificationSortMode] =
    useState<EventSortMode>("latest_to_oldest");
  const [notificationPage, setNotificationPage] = useState(1);

  const [currentUser, setCurrentUser] = useState<any>(null);

  // Files per event (subcollections)
  const [eventImages, setEventImages] = useState<Record<string, EventFile[]>>(
    {},
  );
  const [eventDocs, setEventDocs] = useState<Record<string, EventFile[]>>({});
  const [eventRegistrations, setEventRegistrations] = useState<
    Record<string, RegistrationDoc[]>
  >({});
  const [eventAttendance, setEventAttendance] = useState<
    Record<string, EventAttendanceDoc[]>
  >({});
  const [selectedEventAudienceStudents, setSelectedEventAudienceStudents] =
    useState<StudentLookup[]>([]);
  const [selectedEventPaymentAssignments, setSelectedEventPaymentAssignments] =
    useState<EventPaymentStudentDoc[]>([]);
  const [eventFilesTab, setEventFilesTab] = useState<EventFilesTab>("images");
  const [viewAllFilesModal, setViewAllFilesModal] = useState<{
    open: boolean;
    eventId: string | null;
    eventTitle: string;
    kind: EventFilesTab;
  }>({
    open: false,
    eventId: null,
    eventTitle: "",
    kind: "images",
  });
  const [pendingDeleteFile, setPendingDeleteFile] =
    useState<PendingDeleteFile | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [pendingDeleteEvent, setPendingDeleteEvent] =
    useState<PendingDeleteEvent | null>(null);
  const [deleteEventSubmitting, setDeleteEventSubmitting] = useState(false);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string>("");
  const [uploadMsg, setUploadMsg] = useState<string>("");
  const [exportingEventId, setExportingEventId] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string>("");
  const [exportError, setExportError] = useState<string>("");

  const viewerProfileWithUid = useMemo(
    () =>
      currentUser?.uid ?
        ({ uid: currentUser.uid, ...(viewerProfile ?? {}) } as ViewerProfile) :
        viewerProfile,
    [currentUser?.uid, viewerProfile],
  );
  const viewerIsRegularEc = useMemo(
    () => isRegularEC(viewerProfileWithUid),
    [viewerProfileWithUid],
  );
  const viewerIsBod = useMemo(
    () => isBOD(viewerProfileWithUid),
    [viewerProfileWithUid],
  );
  const viewerCourseScope = useMemo(
    () => getCourseScope(viewerProfileWithUid),
    [viewerProfileWithUid],
  );
  const canManageNotifications = viewerIsRegularEc;
  const canCreateEvents = isECUser;

  // Role check
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setRoleLoading(true);
      setCurrentUser(user);

      if (!user) {
        setIsECUser(false);
        setCurrentUser(null);
        setViewerProfile(null);
        setRoleLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "profiles", user.uid));
        const data = snap.exists()
          ? (snap.data() as CampusProfileDoc)
          : null;
        const role = data?.role as Role | undefined;
        setViewerProfile(
          data ?
            {
              uid: user.uid,
              ...data,
            } :
            { uid: user.uid },
        );
        setIsECUser(role === "ec" || role === "ecmember");
      } catch {
        setIsECUser(false);
        setViewerProfile({ uid: user.uid });
      } finally {
        setRoleLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const canViewEventRecord = useCallback(
    (event: EventDoc) => canViewEvent(viewerProfileWithUid, event),
    [viewerProfileWithUid],
  );

  const canEditEventRecord = useCallback(
    (event: EventDoc) => canEditEvent(viewerProfileWithUid, event),
    [viewerProfileWithUid],
  );

  const loadStudentsForNotifications = useCallback(async (): Promise<
    StudentLookup[]
  > => {
    if (!isECUser) return [];
    if (studentsLoading) return studentOptions;

    setStudentsLoading(true);
    setStudentsError("");

    try {
      const fn = httpsCallable<
        { limit: number },
        { students?: RemoteStudent[] }
      >(functions, "ecListStudents");
      const res = await fn({ limit: 2000 });
      const rows = (res.data?.students ?? [])
        .map((s) => {
          const uid = String(s.uid ?? "").trim();
          const schoolId = String(s.schoolId ?? "").trim();
          const studentName = formatStudentFullName(
            {
              firstName: s.firstName,
              lastName: s.lastName,
              fullName: s.fullName,
              studentName: s.studentName,
              name: s.name,
              schoolId,
            },
            schoolId || uid,
          );
          const course = String(s.course ?? "").trim();
          const year = String(s.year ?? s.yearLevel ?? "").trim();
          const status = String(s.status ?? "").trim() || "Active";
          const role = String(s.role ?? "").trim();

          if (!uid) return null;

          const searchText =
            `${studentName} ${schoolId} ${course} ${year}`.toLowerCase();
          return {
            uid,
            schoolId,
            studentName,
            course,
            year,
            searchText,
            status,
            role,
          } as StudentLookup;
        })
        .filter((s): s is StudentLookup => Boolean(s))
        .sort(
          (a, b) =>
            a.studentName.localeCompare(b.studentName) ||
            a.schoolId.localeCompare(b.schoolId),
        );

      setStudentOptions(rows);
      return rows;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load students.";
      setStudentsError(message);
      setStudentOptions([]);
      return [];
    } finally {
      setStudentsLoading(false);
    }
  }, [functions, isECUser, studentsLoading, studentOptions]);

  useEffect(() => {
    if (!showNotificationForm && !showAddEventForm) return;
    if (!isECUser) return;
    if (studentOptions.length > 0) return;
    void loadStudentsForNotifications();
  }, [
    showNotificationForm,
    showAddEventForm,
    isECUser,
    studentOptions.length,
    loadStudentsForNotifications,
  ]);

  useEffect(() => {
    if (!showNotificationForm && !showAddEventForm) return;

    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (studentPickerRef.current?.contains(target)) return;
      if (notifYearPickerRef.current?.contains(target)) return;
      if (notifCoursePickerRef.current?.contains(target)) return;
      if (eventStudentPickerRef.current?.contains(target)) return;
      if (eventYearPickerRef.current?.contains(target)) return;
      if (eventCoursePickerRef.current?.contains(target)) return;
      setShowStudentDropdown(false);
      setShowNotifYearDropdown(false);
      setShowNotifCourseDropdown(false);
      setShowEventStudentDropdown(false);
      setShowEventYearDropdown(false);
      setShowEventCourseDropdown(false);
    };

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [showAddEventForm, showNotificationForm]);

  const mapNotificationSummaryRows = useCallback(
    (docs: Array<{ id: string; data: () => any }>): NotificationSummary[] => {
      if (!currentUser) return [];

      const grouped = new Map<string, NotificationSummary>();

      docs.forEach((d) => {
        const data = d.data() as {
          dispatchId?: string;
          title?: string;
          message?: string;
          date?: string;
          scheduledTime?: string;
          recipientType?: string;
          course?: string;
          yearLevel?: string;
          targetStudent?: string;
          recipientCount?: number;
          createdAt?: any;
          createdByUid?: string;
        };

        const createdByUid = String(data.createdByUid ?? "");
        if (createdByUid && createdByUid !== currentUser.uid) return;

        const title = String(data.title ?? "Notification");
        const message = String(data.message ?? "");
        const date = String(data.date ?? "");
        const scheduledTime = String(data.scheduledTime ?? "");
        const createdAtMs = toMillis(data.createdAt);
        const recipientTypeRaw = String(data.recipientType ?? "all");
        const recipientType: NotificationSummary["recipientType"] =
          recipientTypeRaw === "course" ||
          recipientTypeRaw === "year" ||
          recipientTypeRaw === "student"
            ? recipientTypeRaw
            : "all";
        const explicitRecipientCount = Number(data.recipientCount ?? 0);

        const dispatchId = String(data.dispatchId ?? "").trim();
        const fallbackGroupKey = [
          createdByUid || currentUser.uid,
          title,
          message,
          date,
          scheduledTime,
          String(createdAtMs ? Math.floor(createdAtMs / 60000) : 0),
        ].join("|");
        const groupKey = dispatchId || fallbackGroupKey;

        if (!grouped.has(groupKey)) {
          grouped.set(groupKey, {
            id: d.id,
            dispatchId: groupKey,
            title,
            message,
            date,
            scheduledTime,
            recipientType,
            course: String(data.course ?? ""),
            yearLevel: String(data.yearLevel ?? ""),
            targetStudent: String(data.targetStudent ?? ""),
            createdAt: data.createdAt,
            recipientCount:
              explicitRecipientCount > 0 ? explicitRecipientCount : 0,
            status: computeNotificationStatus(date, scheduledTime),
          });
        }

        const current = grouped.get(groupKey)!;
        if (explicitRecipientCount > 0) {
          current.recipientCount = Math.max(
            current.recipientCount,
            explicitRecipientCount,
          );
        } else {
          current.recipientCount += 1;
        }
        if (toMillis(data.createdAt) > toMillis(current.createdAt)) {
          current.createdAt = data.createdAt;
        }
      });

      return Array.from(grouped.values()).sort(
        (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt),
      );
    },
    [currentUser],
  );

  const refreshSentNotificationsOnce = useCallback(async () => {
    if (!currentUser || !canManageNotifications) {
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }

    try {
      const ownQ = query(
        collection(db, "profiles", currentUser.uid, "notifications"),
        orderBy("createdAt", "desc"),
        limit(1200),
      );
      const ownSnap = await getDocs(ownQ);
      let rows = mapNotificationSummaryRows(ownSnap.docs);

      if (rows.length === 0) {
        try {
          const legacyQ = query(
            collectionGroup(db, "notifications"),
            orderBy("createdAt", "desc"),
            limit(1200),
          );
          const legacySnap = await getDocs(legacyQ);
          rows = mapNotificationSummaryRows(legacySnap.docs);
        } catch {
          // Ignore legacy fallback errors and keep rows from own profile query.
        }
      }

      setNotifications(rows);
    } catch {
      setNotifications((prev) => prev);
    } finally {
      setNotificationsLoading(false);
    }
  }, [canManageNotifications, currentUser, mapNotificationSummaryRows]);

  // Live sent notifications (grouped by dispatchId)
  useEffect(() => {
    if (!currentUser || !canManageNotifications) {
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }

    setNotificationsLoading(true);
    const qy = query(
      collection(db, "profiles", currentUser.uid, "notifications"),
      orderBy("createdAt", "desc"),
      limit(1200),
    );
    void refreshSentNotificationsOnce();

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setNotifications(mapNotificationSummaryRows(snap.docs));
        setNotificationsLoading(false);
      },
      () => {
        void refreshSentNotificationsOnce();
      },
    );

    return () => unsub();
  }, [
    canManageNotifications,
    currentUser,
    mapNotificationSummaryRows,
    refreshSentNotificationsOnce,
  ]);

  // Live events
  useEffect(() => {
    if (roleLoading) {
      return;
    }

    if (!isECUser) {
      setEvents([]);
      setEventsLoading(false);
      return;
    }

    if (viewerIsBod && !viewerCourseScope) {
      setEvents([]);
      setEventsLoading(false);
      return;
    }

    const mapEventRows = (docs: QueryDocumentSnapshot<DocumentData>[]) =>
      docs
        .map((snapshot) => {
          const data = snapshot.data() as Omit<EventDoc, "id">;
          return { id: snapshot.id, ...data };
        })
        .filter((event) => canViewEventRecord(event));

    const sortRows = (rows: EventDoc[]) =>
      [...rows].sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));

    if (viewerIsBod && viewerCourseScope) {
      let ecRows: EventDoc[] = [];
      let bodRows: EventDoc[] = [];

      const syncRows = () => {
        const merged = new Map<string, EventDoc>();
        [...ecRows, ...bodRows].forEach((event) => {
          merged.set(event.id, event);
        });
        setEvents(sortRows(Array.from(merged.values())));
        setEventsLoading(false);
      };

      const unsubEc = onSnapshot(
        query(collection(db, "events"), where("ownerType", "==", "ec")),
        (snap) => {
          ecRows = mapEventRows(snap.docs);
          syncRows();
        },
        () => {
          ecRows = [];
          syncRows();
        },
      );

      const unsubBod = onSnapshot(
        query(collection(db, "events"), where("courseScope", "==", viewerCourseScope)),
        (snap) => {
          bodRows = mapEventRows(snap.docs);
          syncRows();
        },
        () => {
          bodRows = [];
          syncRows();
        },
      );

      return () => {
        unsubEc();
        unsubBod();
      };
    }

    const unsub = onSnapshot(
      query(collection(db, "events"), orderBy("createdAt", "desc")),
      (snap) => {
        setEvents(mapEventRows(snap.docs));
        setEventsLoading(false);
      },
      () => {
        setEvents([]);
        setEventsLoading(false);
      },
    );

    return () => unsub();
  }, [
    canViewEventRecord,
    isECUser,
    roleLoading,
    viewerCourseScope,
    viewerIsBod,
  ]);

  // Live files for expanded event
  useEffect(() => {
    if (!expandedEventId) return;

    const imgQ = query(
      collection(db, "events", expandedEventId, "images"),
      orderBy("createdAt", "desc"),
    );
    const docQ = query(
      collection(db, "events", expandedEventId, "docs"),
      orderBy("createdAt", "desc"),
    );
    const attendanceQ =
      viewerIsBod && viewerCourseScope ?
        query(
          collection(db, "events", expandedEventId, "attendance"),
          where("course", "==", viewerCourseScope),
        ) :
        collection(db, "events", expandedEventId, "attendance");

    const unsubImgs = onSnapshot(imgQ, (snap) => {
      setEventImages((prev) => ({
        ...prev,
        [expandedEventId]: snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })),
      }));
    });

    const unsubDocs = onSnapshot(docQ, (snap) => {
      setEventDocs((prev) => ({
        ...prev,
        [expandedEventId]: snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })),
      }));
    });

    const unsubAttendance = onSnapshot(attendanceQ, (snap) => {
      setEventAttendance((prev) => ({
        ...prev,
        [expandedEventId]: snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })),
      }));
    });

    return () => {
      unsubImgs();
      unsubDocs();
      unsubAttendance();
    };
  }, [expandedEventId, viewerCourseScope, viewerIsBod]);

  // Live registrations for pre-registration events
  useEffect(() => {
    const preRegEventIds = events
      .filter((ev) => ev.isPreReg)
      .map((ev) => ev.id);

    if (preRegEventIds.length === 0) {
      setEventRegistrations({});
      return;
    }

    const unsubs = preRegEventIds.map((eventId) =>
      onSnapshot(
        viewerIsBod && viewerCourseScope ?
          query(
            collection(db, "events", eventId, "registrations"),
            where("course", "==", viewerCourseScope),
          ) :
          collection(db, "events", eventId, "registrations"),
        async (snap) => {
          try {
            const rows: RegistrationDoc[] = snap.docs
              .map((d) => {
                const data = d.data() as Partial<RegistrationDoc>;
                return {
                  id: d.id,
                  uid: String(data.uid ?? d.id),
                  schoolId: String(data.schoolId ?? ""),
                  studentName: String(data.studentName ?? ""),
                  course: String(data.course ?? ""),
                  year: String(data.year ?? ""),
                  createdAt: data.createdAt,
                  updatedAt: data.updatedAt,
                  registeredAt: data.registeredAt,
                  waitlistedAt: data.waitlistedAt,
                  cancelledAt: data.cancelledAt,
                  status: parseRegistrationStatus(data.status),
                };
              })
              .sort((a, b) => registrationSortMillis(b) - registrationSortMillis(a));

            const activeRows = await Promise.all(
              rows.map(async (row) => {
                const studentSnap = await getDoc(doc(db, "students", row.uid));
                const studentStatus = String(studentSnap.data()?.status ?? "")
                  .trim()
                  .toLowerCase();
                if (studentStatus === "inactive") {
                  return null;
                }

                return row;
              }),
            );

            setEventRegistrations((prev) => ({
              ...prev,
              [eventId]: activeRows.filter((row): row is RegistrationDoc =>
                Boolean(row),
              ),
            }));
          } catch {
            setEventRegistrations((prev) => ({ ...prev, [eventId]: [] }));
          }
        },
        () => {
          setEventRegistrations((prev) => ({ ...prev, [eventId]: [] }));
        },
      ),
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [events, viewerCourseScope, viewerIsBod]);

  const filteredEvents = useMemo(() => {
    const s = searchText.trim().toLowerCase();
    return events.filter((ev) => {
      const liveStatus = computeStatus(ev);
      const matchesStatus =
        statusFilter === "all" || liveStatus === statusFilter;
      const matchesDate =
        !eventDateFilter || String(ev.date ?? "") === eventDateFilter;

      const matchesSearch =
        !s ||
        ev.title.toLowerCase().includes(s) ||
        (ev.location ?? "").toLowerCase().includes(s) ||
        (ev.targetStudent ?? "").toLowerCase().includes(s) ||
        (ev.details ?? "").toLowerCase().includes(s);

      return matchesStatus && matchesSearch && matchesDate;
    });
  }, [events, searchText, statusFilter, eventDateFilter]);

  const selectedNotifStudentIds = useMemo(
    () => new Set(selectedNotifStudents.map((student) => student.uid)),
    [selectedNotifStudents],
  );
  const selectedNotifYearLevelsSet = useMemo(
    () => new Set(selectedNotifYearLevels),
    [selectedNotifYearLevels],
  );
  const selectedNotifCoursesSet = useMemo(
    () => new Set(selectedNotifCourses),
    [selectedNotifCourses],
  );
  const selectedEventStudentIds = useMemo(
    () => new Set(selectedEventStudents.map((student) => student.uid)),
    [selectedEventStudents],
  );
  const selectedEventYearLevelsSet = useMemo(
    () => new Set(selectedEventYearLevels),
    [selectedEventYearLevels],
  );
  const selectedEventCoursesSet = useMemo(
    () => new Set(selectedEventCourses),
    [selectedEventCourses],
  );

  const filteredStudentOptions = useMemo(() => {
    const nameQuery = notifSearchName.trim().toLowerCase();
    const idQuery = notifSearchId.trim().toLowerCase();

    return studentOptions
      .filter((student) => {
        if (selectedNotifStudentIds.has(student.uid)) return false;
        const matchesName =
          !nameQuery || student.studentName.toLowerCase().includes(nameQuery);
        const matchesId =
          !idQuery || student.schoolId.toLowerCase().includes(idQuery);
        return matchesName && matchesId;
      })
      .slice(0, 20);
  }, [notifSearchName, notifSearchId, studentOptions, selectedNotifStudentIds]);

  const filteredNotifYearOptions = useMemo(() => {
    const query = notifYearSearch.trim().toLowerCase();
    return EVENT_YEAR_LEVEL_CHOICES.filter((item) => {
      if (selectedNotifYearLevelsSet.has(item)) return false;
      if (!query) return true;
      return item.toLowerCase().includes(query);
    }).slice(0, 20);
  }, [notifYearSearch, selectedNotifYearLevelsSet]);

  const filteredNotifCourseOptions = useMemo(() => {
    const query = notifCourseSearch.trim().toLowerCase();
    return EVENT_COURSE_CHOICES.filter((item) => {
      if (selectedNotifCoursesSet.has(item)) return false;
      if (!query) return true;
      return item.toLowerCase().includes(query);
    }).slice(0, 20);
  }, [notifCourseSearch, selectedNotifCoursesSet]);
  const showNotifAllYearsOption = useMemo(() => {
    const query = notifYearSearch.trim().toLowerCase();
    return !query || "all years".includes(query);
  }, [notifYearSearch]);
  const showNotifAllCoursesOption = useMemo(() => {
    const query = notifCourseSearch.trim().toLowerCase();
    return !query || "all courses".includes(query);
  }, [notifCourseSearch]);

  const filteredEventStudentOptions = useMemo(() => {
    const query = eventSearchName.trim().toLowerCase();
    return studentOptions
      .filter((student) => {
        if (selectedEventStudentIds.has(student.uid)) return false;
        if (!query) return true;
        return student.searchText.includes(query);
      })
      .slice(0, 20);
  }, [eventSearchName, studentOptions, selectedEventStudentIds]);

  const filteredEventYearOptions = useMemo(() => {
    const query = eventYearSearch.trim().toLowerCase();
    return EVENT_YEAR_LEVEL_CHOICES.filter((item) => {
      if (selectedEventYearLevelsSet.has(item)) return false;
      if (!query) return true;
      return item.toLowerCase().includes(query);
    }).slice(0, 20);
  }, [eventYearSearch, selectedEventYearLevelsSet]);

  const filteredEventCourseOptions = useMemo(() => {
    const query = eventCourseSearch.trim().toLowerCase();
    return EVENT_COURSE_CHOICES.filter((item) => {
      if (selectedEventCoursesSet.has(item)) return false;
      if (!query) return true;
      return item.toLowerCase().includes(query);
    }).slice(0, 20);
  }, [eventCourseSearch, selectedEventCoursesSet]);
  const showAllYearsOption = useMemo(() => {
    const query = eventYearSearch.trim().toLowerCase();
    return !query || "all years".includes(query);
  }, [eventYearSearch]);
  const showAllCoursesOption = useMemo(() => {
    const query = eventCourseSearch.trim().toLowerCase();
    return !query || "all courses".includes(query);
  }, [eventCourseSearch]);

  const filteredNotifications = useMemo(() => {
    const s = notificationSearchText.trim().toLowerCase();
    return notifications.filter((item) => {
      const matchesStatus =
        notificationStatusFilter === "all" ||
        item.status === notificationStatusFilter;
      const matchesDate =
        !notificationDateFilter || item.date === notificationDateFilter;
      const matchesSearch =
        !s ||
        item.title.toLowerCase().includes(s) ||
        item.message.toLowerCase().includes(s) ||
        item.recipientType.toLowerCase().includes(s) ||
        item.targetStudent.toLowerCase().includes(s);

      return matchesStatus && matchesDate && matchesSearch;
    });
  }, [
    notifications,
    notificationSearchText,
    notificationStatusFilter,
    notificationDateFilter,
  ]);

  const sortedFilteredEvents = useMemo(() => {
    const list = [...filteredEvents];

    if (eventSortMode === "alphabetical") {
      list.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      );
      return list;
    }

    list.sort((a, b) => {
      const aMs =
        getDateTimeMs(a.date, a.scheduledTime || a.timeStart) ||
        toMillis(a.createdAt);
      const bMs =
        getDateTimeMs(b.date, b.scheduledTime || b.timeStart) ||
        toMillis(b.createdAt);
      return eventSortMode === "oldest_to_latest" ? aMs - bMs : bMs - aMs;
    });

    return list;
  }, [filteredEvents, eventSortMode]);

  const sortedFilteredNotifications = useMemo(() => {
    const list = [...filteredNotifications];

    if (notificationSortMode === "alphabetical") {
      list.sort((a, b) =>
        (a.title || "").localeCompare(b.title || "", undefined, {
          sensitivity: "base",
        }),
      );
      return list;
    }

    list.sort((a, b) => {
      const aMs =
        toMillis(a.createdAt) || getDateTimeMs(a.date, a.scheduledTime);
      const bMs =
        toMillis(b.createdAt) || getDateTimeMs(b.date, b.scheduledTime);
      return notificationSortMode === "oldest_to_latest"
        ? aMs - bMs
        : bMs - aMs;
    });

    return list;
  }, [filteredNotifications, notificationSortMode]);

  const eventTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedFilteredEvents.length / ITEMS_PER_PAGE)),
    [sortedFilteredEvents.length],
  );
  const paginatedEvents = useMemo(() => {
    const start = (eventPage - 1) * ITEMS_PER_PAGE;
    return sortedFilteredEvents.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedFilteredEvents, eventPage]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === expandedEventId) ?? null,
    [events, expandedEventId],
  );
  const selectedEventImages = useMemo(
    () =>
      selectedEvent
        ? (eventImages[selectedEvent.id] ?? []).map((file) =>
            toEventDetailFileItem(file, "images"),
          )
        : [],
    [eventImages, selectedEvent],
  );
  const selectedEventDocs = useMemo(
    () =>
      selectedEvent
        ? (eventDocs[selectedEvent.id] ?? []).map((file) =>
            toEventDetailFileItem(file, "docs"),
          )
        : [],
    [eventDocs, selectedEvent],
  );
  const selectedEventRegistrations = useMemo(
    () => (selectedEvent ? eventRegistrations[selectedEvent.id] ?? [] : []),
    [eventRegistrations, selectedEvent],
  );
  const selectedEventAttendanceRows = useMemo(
    () => (selectedEvent ? eventAttendance[selectedEvent.id] ?? [] : []),
    [eventAttendance, selectedEvent],
  );

  useEffect(() => {
    if (!selectedEvent) {
      setSelectedEventAudienceStudents([]);
      return;
    }

    const currentSelectedEvent = selectedEvent;
    let active = true;

    async function loadSelectedEventAudience() {
      let allStudents = studentOptions;
      if (allStudents.length === 0) {
        allStudents = await loadStudentsForNotifications();
      }
      if (!active) return;

      const audience = resolveRequiredEventAudience(
        currentSelectedEvent,
        allStudents,
      );
      setSelectedEventAudienceStudents(
        audience.resolved ? audience.students : [],
      );
    }

    void loadSelectedEventAudience();

    return () => {
      active = false;
    };
  }, [loadStudentsForNotifications, selectedEvent, studentOptions]);

  useEffect(() => {
    const paymentId = getEventLinkedPaymentId(selectedEvent);
    if (!selectedEvent || !(selectedEvent.withPayment || selectedEvent.paymentRequired) || !paymentId) {
      setSelectedEventPaymentAssignments([]);
      return;
    }

    const paymentStudentsQuery =
      viewerIsBod && viewerCourseScope ?
        query(
          collection(db, "payments", paymentId, "students"),
          where("course", "==", viewerCourseScope),
        ) :
        collection(db, "payments", paymentId, "students");

    const unsub = onSnapshot(
      paymentStudentsQuery,
      (snap) => {
        setSelectedEventPaymentAssignments(
          snap.docs.map((paymentStudentDoc) => ({
            id: paymentStudentDoc.id,
            ...(paymentStudentDoc.data() as Omit<EventPaymentStudentDoc, "id">),
          })),
        );
      },
      () => {
        setSelectedEventPaymentAssignments([]);
      },
    );

    return () => unsub();
  }, [selectedEvent, viewerCourseScope, viewerIsBod]);

  const selectedEventParticipantRows = useMemo(
    () =>
      buildEventParticipantRows(
        selectedEvent,
        selectedEventRegistrations,
        selectedEventAttendanceRows,
        selectedEventPaymentAssignments,
        selectedEventAudienceStudents,
      ),
    [
      selectedEvent,
      selectedEventAttendanceRows,
      selectedEventAudienceStudents,
      selectedEventPaymentAssignments,
      selectedEventRegistrations,
    ],
  );
  const filteredSelectedParticipantRows = useMemo(() => {
    const search = participantSearch.trim().toLowerCase();
    if (!search) return selectedEventParticipantRows;

    return selectedEventParticipantRows.filter((row) => {
      const haystack = [
        row.studentName,
        row.schoolId,
        row.course,
        row.year,
        row.attendanceStatus,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });
  }, [participantSearch, selectedEventParticipantRows]);
  const participantRowsPerPageValue = useMemo(() => {
    const value = Number(participantRowsPerPage);
    return Number.isFinite(value) && value > 0 ?
        value :
        Number(PARTICIPANT_ROWS_PER_PAGE_OPTIONS[0]);
  }, [participantRowsPerPage]);
  const selectedEventParticipantTotalPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(
          filteredSelectedParticipantRows.length / participantRowsPerPageValue,
        ),
      ),
    [filteredSelectedParticipantRows.length, participantRowsPerPageValue],
  );
  const paginatedSelectedParticipantRows = useMemo(() => {
    const start = (participantPage - 1) * participantRowsPerPageValue;
    return filteredSelectedParticipantRows.slice(
      start,
      start + participantRowsPerPageValue,
    );
  }, [
    filteredSelectedParticipantRows,
    participantPage,
    participantRowsPerPageValue,
  ]);
  const selectedEventPreviewImages = useMemo(
    () => selectedEventImages.slice(0, 3),
    [selectedEventImages],
  );
  const selectedEventPreviewDocs = useMemo(
    () => selectedEventDocs.slice(0, 3),
    [selectedEventDocs],
  );
  const selectedEventPresentCount = useMemo(
    () =>
      selectedEventParticipantRows.filter((row) =>
        isPresentAttendanceStatus(row.attendanceStatus),
      ).length,
    [selectedEventParticipantRows],
  );
  const selectedEventAbsentCount = useMemo(
    () =>
      selectedEventParticipantRows.filter(
        (row) => row.attendanceStatus === "Absent",
      ).length,
    [selectedEventParticipantRows],
  );
  const selectedEventNotPaidCount = useMemo(
    () =>
      selectedEventParticipantRows.filter(
        (row) => row.attendanceStatus === "Not Paid",
      ).length,
    [selectedEventParticipantRows],
  );
  const selectedEventStatus = useMemo(
    () => (selectedEvent ? computeStatus(selectedEvent) : null),
    [selectedEvent],
  );
  const selectedEventEditable = useMemo(
    () => (selectedEvent ? canEditEventRecord(selectedEvent) : false),
    [canEditEventRecord, selectedEvent],
  );

  const notificationTotalPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(sortedFilteredNotifications.length / ITEMS_PER_PAGE),
      ),
    [sortedFilteredNotifications.length],
  );
  const paginatedNotifications = useMemo(() => {
    const start = (notificationPage - 1) * ITEMS_PER_PAGE;
    return sortedFilteredNotifications.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedFilteredNotifications, notificationPage]);

  useEffect(() => {
    setEventPage(1);
  }, [searchText, statusFilter, eventDateFilter, eventSortMode]);

  useEffect(() => {
    setNotificationPage(1);
    setExpandedNotificationId(null);
  }, [
    notificationSearchText,
    notificationStatusFilter,
    notificationDateFilter,
    notificationSortMode,
  ]);

  useEffect(() => {
    setEventPage((prev) => Math.min(Math.max(prev, 1), eventTotalPages));
  }, [eventTotalPages]);

  useEffect(() => {
    setNotificationPage((prev) =>
      Math.min(Math.max(prev, 1), notificationTotalPages),
    );
  }, [notificationTotalPages]);

  useEffect(() => {
    if (!expandedNotificationId) return;
    const stillExists = sortedFilteredNotifications.some(
      (item) => item.dispatchId === expandedNotificationId,
    );
    if (!stillExists) {
      setExpandedNotificationId(null);
    }
  }, [expandedNotificationId, sortedFilteredNotifications]);

  useEffect(() => {
    setSelectedEventTab("overview");
    setParticipantSearch("");
    setParticipantPage(1);
    setParticipantRowsPerPage(PARTICIPANT_ROWS_PER_PAGE_OPTIONS[0]);
    setEventFilesTab("images");
  }, [expandedEventId]);

  useEffect(() => {
    setParticipantPage(1);
  }, [participantRowsPerPage, participantSearch]);

  useEffect(() => {
    setParticipantPage((prev) =>
      Math.min(Math.max(prev, 1), selectedEventParticipantTotalPages),
    );
  }, [selectedEventParticipantTotalPages]);

  useEffect(() => {
    if (!viewerIsBod || !viewerCourseScope) {
      return;
    }

    setSelectedEventCourses([viewerCourseScope]);
    setIsAllCoursesExplicit(false);
    setSelectedEventStudents([]);
    setEventCourseSearch("");
    setShowEventCourseDropdown(false);
    setShowEventStudentDropdown(false);
  }, [viewerCourseScope, viewerIsBod, showAddEventForm, editingEventId]);

  useEffect(() => {
    if (!canManageNotifications && showNotificationForm) {
      setShowNotificationForm(false);
    }
  }, [canManageNotifications, showNotificationForm]);

  const eventSortLabel = useMemo(() => {
    if (eventSortMode === "oldest_to_latest") return "Date, old to new";
    if (eventSortMode === "alphabetical") return "Alphabetically, A-Z";
    return "Date, new to old";
  }, [eventSortMode]);

  const notificationSortLabel = useMemo(() => {
    if (notificationSortMode === "oldest_to_latest") return "Date, old to new";
    if (notificationSortMode === "alphabetical") return "Alphabetically, A-Z";
    return "Date, new to old";
  }, [notificationSortMode]);

  const summary = useMemo(() => {
    const total = events.length;
    const upcoming = events.filter(
      (e) => computeStatus(e) === "upcoming",
    ).length;
    const ongoing = events.filter((e) => computeStatus(e) === "ongoing").length;
    const completed = events.filter(
      (e) => computeStatus(e) === "completed",
    ).length;
    return { total, upcoming, ongoing, completed };
  }, [events]);

  const totalParticipants = useMemo(
    () =>
      Object.values(eventRegistrations).reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
    [eventRegistrations],
  );

  const eventSummaryItems = useMemo<ECStatItem[]>(
    () => [
      {
        label: "Total Events",
        value: summary.total,
        description: "All tracked EC events",
        tone: "blue",
        icon: CalendarClock,
      },
      {
        label: "Upcoming",
        value: summary.upcoming,
        description: "Ready for preparation",
        tone: "amber",
        icon: ClipboardList,
      },
      {
        label: "Ongoing",
        value: summary.ongoing,
        description: "Currently active",
        tone: "green",
        icon: Users,
      },
      {
        label: "Completed",
        value: summary.completed,
        description: "Ready for review and cleanup",
        tone: "slate",
        icon: FileStack,
      },
    ],
    [summary.completed, summary.ongoing, summary.total, summary.upcoming],
  );
  const isEditingEvent = Boolean(editingEventId);
  const isEditingNotification = Boolean(editingNotificationDispatchId);
  const hasSpecificTarget = selectedEventStudents.length > 0;
  const hasEventYearFilter =
    isAllYearsExplicit || selectedEventYearLevels.length > 0;
  const hasEventCourseFilter =
    isAllCoursesExplicit || selectedEventCourses.length > 0;
  const hasEventRegistrantSelection =
    hasSpecificTarget || hasEventYearFilter || hasEventCourseFilter;
  const hasNotifYearFilter =
    isAllNotifYearsExplicit || selectedNotifYearLevels.length > 0;
  const hasNotifCourseFilter =
    isAllNotifCoursesExplicit || selectedNotifCourses.length > 0;
  const eventYearLevelLabel = isAllYearsExplicit
    ? "All Years"
    : selectedEventYearLevels.length > 0
      ? selectedEventYearLevels.join(", ")
      : "";
  const eventCourseLabel = isAllCoursesExplicit
    ? "All Courses"
    : selectedEventCourses.length > 0
      ? selectedEventCourses.join(", ")
      : "";
  const registrantsRequiredMissing =
    !isPreReg && !hasEventRegistrantSelection && !isEditingEvent;
  const notifHasSpecificTarget = selectedNotifStudents.length > 0;
  const notifYearLevelLabel = isAllNotifYearsExplicit
    ? "All Years"
    : selectedNotifYearLevels.length > 0
      ? selectedNotifYearLevels.join(", ")
      : "";
  const notifCourseLabel = isAllNotifCoursesExplicit
    ? "All Courses"
    : selectedNotifCourses.length > 0
      ? selectedNotifCourses.join(", ")
      : "";
  const hasNotifRecipientSelection =
    notifHasSpecificTarget || hasNotifYearFilter || hasNotifCourseFilter;
  const notifRecipientsRequiredMissing =
    !isEditingNotification && !hasNotifRecipientSelection;
  const viewAllModalImages = useMemo(() => {
    if (!viewAllFilesModal.eventId) return [];
    return eventImages[viewAllFilesModal.eventId] ?? [];
  }, [eventImages, viewAllFilesModal.eventId]);
  const viewAllModalDocs = useMemo(() => {
    if (!viewAllFilesModal.eventId) return [];
    return eventDocs[viewAllFilesModal.eventId] ?? [];
  }, [eventDocs, viewAllFilesModal.eventId]);

  const openViewAllFilesModal = (
    eventId: string,
    eventTitle: string,
    kind: EventFilesTab,
  ) => {
    setViewAllFilesModal({
      open: true,
      eventId,
      eventTitle,
      kind,
    });
  };

  const closeViewAllFilesModal = () => {
    setViewAllFilesModal((prev) => ({ ...prev, open: false }));
  };

  const statusChip = (status: EventStatus) => {
    if (status === "completed") return "bg-green-100 text-green-700";
    if (status === "ongoing") return "bg-orange-100 text-orange-700";
    return "bg-blue-100 text-blue-700";
  };

  const notifStatusChip = (status: NotificationListStatus) => {
    if (status === "scheduled") return "bg-blue-100 text-blue-700";
    return "bg-green-100 text-green-700";
  };

  const notifTargetLabel = (item: NotificationSummary) => {
    const pieces: string[] = [];
    if (String(item.targetStudent ?? "").trim()) {
      pieces.push(`Students: ${item.targetStudent}`);
    }
    if (
      String(item.yearLevel ?? "").trim() &&
      String(item.yearLevel).trim() !== "All Years"
    ) {
      pieces.push(`Year: ${item.yearLevel}`);
    }
    if (
      String(item.course ?? "").trim() &&
      String(item.course).trim() !== "All Courses"
    ) {
      pieces.push(`Course: ${item.course}`);
    }

    if (pieces.length > 0) return pieces.join(" | ");
    return "All Students";
  };

  async function uploadToEvent(
    eventId: string,
    kind: "images" | "docs",
    file: File,
  ) {
    if (!currentUser) throw new Error("Not logged in");
    const event = events.find((item) => item.id === eventId) ?? null;
    if (!event || !canEditEventRecord(event)) {
      throw new Error(
        viewerIsBod ?
          "B.O.D. members can only upload files to their own course activities." :
          "Only editable events can accept uploads.",
      );
    }

    const safeName = file.name.replace(/[^\w.\-()+ ]/g, "_");
    const fileId = `${Date.now()}_${safeName}`;
    const path = `events/${eventId}/${kind}/${fileId}`;

    const storageRef = ref(storage, path);
    const snap = await uploadBytes(storageRef, file, {
      contentType: file.type,
    });
    const downloadURL = await getDownloadURL(snap.ref);

    await addDoc(collection(db, "events", eventId, kind), {
      path,
      name: file.name,
      contentType: file.type,
      size: file.size,
      downloadURL,
      uploadedByUid: currentUser.uid,
      createdAt: serverTimestamp(),
    });

    return downloadURL;
  }

  function downloadEventFile(file: EventFile, fallbackName: string) {
    setUploadErr("");
    if (!file.downloadURL) {
      setUploadErr(`"${file.name || fallbackName}" has no download URL.`);
      return;
    }

    try {
      const safeName = String(file.name || fallbackName).trim() || fallbackName;
      const params = new URLSearchParams({
        url: file.downloadURL,
        name: safeName,
      });
      const anchor = document.createElement("a");
      anchor.href = `/api/download?${params.toString()}`;
      anchor.download = safeName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (e: any) {
      setUploadErr(e?.message || "Failed to start download.");
    }
  }

  async function handlePickFiles(
    eventId: string,
    kind: "images" | "docs",
    files: FileList | File[] | null,
  ) {
    if (!files || files.length === 0) {
      const msg = "No files were selected.";
      setUploadErr(msg);
      addToast({
        title: "No files selected",
        description: msg,
        color: "warning",
        timeout: 4500,
      });
      return;
    }

    const pickedFiles = Array.isArray(files) ? files : Array.from(files);
    if (pickedFiles.length === 0) {
      const msg = "No files were selected.";
      setUploadErr(msg);
      addToast({
        title: "No files selected",
        description: msg,
        color: "warning",
        timeout: 4500,
      });
      return;
    }

    setUploadErr("");
    setUploadMsg(
      `Uploading ${pickedFiles.length} file${pickedFiles.length === 1 ? "" : "s"}...`,
    );
    setUploadingFor(eventId);
    let uploaded = 0;
    const rejected: string[] = [];

    try {
      for (const file of pickedFiles) {
        if (kind === "images") {
          if (!file.type.startsWith("image/")) {
            rejected.push(`${file.name}: only image files are allowed.`);
            continue;
          }

          let compressed: File;
          try {
            compressed = await compressImageForUpload(
              file,
              MAX_EVENT_FILE_SIZE_BYTES,
            );
          } catch (e: any) {
            rejected.push(
              `${file.name}: ${e?.message || "Image compression failed."}`,
            );
            continue;
          }

          if (compressed.size > MAX_EVENT_FILE_SIZE_BYTES) {
            rejected.push(
              `${file.name}: still ${toMegabytesText(compressed.size)} after compression. Max is 10MB.`,
            );
            continue;
          }

          try {
            await uploadToEvent(eventId, kind, compressed);
            uploaded += 1;
          } catch (e: any) {
            rejected.push(`${file.name}: ${e?.message || "Upload failed."}`);
          }
          continue;
        }

        if (!isAllowedEventDocument(file)) {
          rejected.push(
            `${file.name}: only PDF, DOC, or DOCX files are allowed.`,
          );
          continue;
        }

        if (file.size > MAX_EVENT_FILE_SIZE_BYTES) {
          rejected.push(`${file.name}: exceeds 10MB.`);
          continue;
        }

        try {
          await uploadToEvent(eventId, kind, file);
          uploaded += 1;
        } catch (e: any) {
          rejected.push(`${file.name}: ${e?.message || "Upload failed."}`);
        }
      }
    } catch (e: any) {
      const msg = e?.message || "Unexpected upload error.";
      rejected.push(msg);
    } finally {
      setUploadingFor(null);
    }

    if (uploaded > 0) {
      const successMsg = `Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}${kind === "images" ? " (auto-compressed)." : "."}`;
      setUploadMsg(successMsg);
      addToast({
        title: "Upload complete",
        description: successMsg,
        color: "success",
        timeout: 4500,
      });
    }

    if (rejected.length > 0) {
      const preview = rejected.slice(0, 2).join(" ");
      const overflow =
        rejected.length > 2 ? ` (+${rejected.length - 2} more)` : "";
      const errorMsg = `${preview}${overflow}`;
      setUploadErr(errorMsg);
      addToast({
        title: uploaded > 0 ? "Some files were not uploaded" : "Upload failed",
        description: errorMsg,
        color: uploaded > 0 ? "warning" : "danger",
        timeout: 7000,
      });
    }

    if (uploaded === 0 && rejected.length === 0) {
      const msg = "No files were uploaded.";
      setUploadErr(msg);
      addToast({
        title: "Upload failed",
        description: msg,
        color: "danger",
        timeout: 5000,
      });
    }
  }

  function handleFileInputChange(
    eventId: string,
    kind: "images" | "docs",
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const pickedFiles = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";

    if (pickedFiles.length > 0) {
      addToast({
        title:
          kind === "images"
            ? "Preparing image upload"
            : "Preparing document upload",
        description: `${pickedFiles.length} file${pickedFiles.length === 1 ? "" : "s"} selected.`,
        color: "success",
        timeout: 2500,
      });
    }

    void handlePickFiles(eventId, kind, pickedFiles);
  }

  async function deleteEventFile(
    eventId: string,
    kind: "images" | "docs",
    fileDocId: string,
    path: string,
  ) {
    const event = events.find((item) => item.id === eventId) ?? null;
    if (!event || !canEditEventRecord(event)) return;
    await deleteObject(ref(storage, path));
    await deleteDoc(doc(db, "events", eventId, kind, fileDocId));
  }

  function requestDeleteEventFile(
    eventId: string,
    kind: "images" | "docs",
    fileDocId: string,
    path: string,
    fileName: string,
  ) {
    const event = events.find((item) => item.id === eventId) ?? null;
    if (!event || !canEditEventRecord(event)) return;
    setPendingDeleteFile({
      eventId,
      kind,
      fileDocId,
      path,
      fileName,
    });
  }

  async function confirmDeleteEventFile() {
    if (!pendingDeleteFile) return;

    setDeleteSubmitting(true);
    setUploadErr("");

    try {
      await deleteEventFile(
        pendingDeleteFile.eventId,
        pendingDeleteFile.kind,
        pendingDeleteFile.fileDocId,
        pendingDeleteFile.path,
      );

      addToast({
        title: "File deleted",
        description: `${pendingDeleteFile.fileName} was removed.`,
        color: "success",
        timeout: 3500,
      });

      setPendingDeleteFile(null);
    } catch (error: any) {
      await logEventPermissionDeniedAttempt(
        "delete_event_file",
        pendingDeleteFile.eventId,
        error,
      );
      const message = error?.message || "Failed to delete file.";
      setUploadErr(message);
      addToast({
        title: "Delete failed",
        description: message,
        color: "danger",
        timeout: 5500,
      });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function deleteDocsInChunks(
    docs: QueryDocumentSnapshot<DocumentData>[],
  ) {
    if (docs.length === 0) return;

    const chunkSize = 400;
    for (let i = 0; i < docs.length; i += chunkSize) {
      const chunk = docs.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      chunk.forEach((snap) => {
        batch.delete(snap.ref);
      });
      await batch.commit();
    }
  }

  async function deleteCompletedEventById(eventId: string) {
    const [imagesSnap, docsSnap, attendanceSnap, registrationsSnap] =
      await Promise.all([
        getDocs(collection(db, "events", eventId, "images")),
        getDocs(collection(db, "events", eventId, "docs")),
        getDocs(collection(db, "events", eventId, "attendance")),
        getDocs(collection(db, "events", eventId, "registrations")),
      ]);

    const storagePaths = [...imagesSnap.docs, ...docsSnap.docs]
      .map((snap) => String(snap.data()?.path ?? "").trim())
      .filter(Boolean);

    const storageDeletionResults = await Promise.allSettled(
      storagePaths.map(async (path) => {
        try {
          await deleteObject(ref(storage, path));
        } catch (error: any) {
          const code = String(error?.code ?? "");
          if (code !== "storage/object-not-found") {
            throw error;
          }
        }
      }),
    );

    const storageDeleteFailed = storageDeletionResults.some(
      (result) => result.status === "rejected",
    );
    if (storageDeleteFailed) {
      ecEventsLogger.warn("Some event files could not be removed from storage.", {
        eventId,
      });
    }

    await deleteDocsInChunks([
      ...imagesSnap.docs,
      ...docsSnap.docs,
      ...attendanceSnap.docs,
      ...registrationsSnap.docs,
    ]);
    await deleteDoc(doc(db, "events", eventId));
  }

  function requestDeleteCompletedEvent(eventToDelete: EventDoc) {
    if (roleLoading) {
      addToast({
        title: "Please wait",
        description: "Role check is still in progress.",
        color: "warning",
        timeout: 4500,
      });
      return;
    }

    if (!isECUser || !canEditEventRecord(eventToDelete)) {
      addToast({
        title: "Access denied",
        description: viewerIsBod ?
          "B.O.D. members can only delete their own completed course activities." :
          "Only editable events can be deleted.",
        color: "danger",
        timeout: 5000,
      });
      return;
    }

    if (computeStatus(eventToDelete) !== "completed") {
      addToast({
        title: "Delete unavailable",
        description: "Only completed events can be deleted.",
        color: "warning",
        timeout: 5000,
      });
      return;
    }

    setPendingDeleteEvent({
      id: eventToDelete.id,
      title: String(eventToDelete.title ?? "Event"),
    });
  }

  async function confirmDeleteCompletedEvent() {
    if (!pendingDeleteEvent) return;

    setDeleteEventSubmitting(true);

    try {
      const eventToDelete = events.find(
        (ev) => ev.id === pendingDeleteEvent.id,
      );
      if (!eventToDelete) {
        throw new Error("The event no longer exists.");
      }

      if (computeStatus(eventToDelete) !== "completed") {
        throw new Error("Only completed events can be deleted.");
      }

      if (!canEditEventRecord(eventToDelete)) {
        throw new Error(
          viewerIsBod ?
            "B.O.D. members can only delete their own completed course activities." :
            "You do not have permission to delete this event.",
        );
      }

      await deleteCompletedEventById(eventToDelete.id);

      if (expandedEventId === eventToDelete.id) {
        setExpandedEventId(null);
      }

      if (editingEventId === eventToDelete.id) {
        setEditingEventId(null);
        setShowAddEventForm(false);
        resetEventComposer();
      }

      if (viewAllFilesModal.eventId === eventToDelete.id) {
        closeViewAllFilesModal();
      }

      setEventImages((prev) => {
        if (!(eventToDelete.id in prev)) return prev;
        const next = { ...prev };
        delete next[eventToDelete.id];
        return next;
      });
      setEventDocs((prev) => {
        if (!(eventToDelete.id in prev)) return prev;
        const next = { ...prev };
        delete next[eventToDelete.id];
        return next;
      });
      setEventRegistrations((prev) => {
        if (!(eventToDelete.id in prev)) return prev;
        const next = { ...prev };
        delete next[eventToDelete.id];
        return next;
      });
      setEventAttendance((prev) => {
        if (!(eventToDelete.id in prev)) return prev;
        const next = { ...prev };
        delete next[eventToDelete.id];
        return next;
      });

      setPendingDeleteEvent(null);
      addToast({
        title: "Event deleted",
        description: `${eventToDelete.title} was removed.`,
        color: "success",
        timeout: 3500,
      });
    } catch (error: any) {
      await logEventPermissionDeniedAttempt(
        "delete_event",
        pendingDeleteEvent.id,
        error,
      );
      const message = error?.message || "Failed to delete event.";
      addToast({
        title: "Delete failed",
        description: message,
        color: "danger",
        timeout: 5500,
      });
    } finally {
      setDeleteEventSubmitting(false);
    }
  }

  const resetNotificationComposer = useCallback(() => {
    setNotifTitle("");
    const nextNotifDate = isoDateToday();
    const nextNotifTime = now24h();
    setNotifDate(nextNotifDate);
    setNotifDateValue(toCalendarDate(nextNotifDate));
    setNotifMessage("");
    setNotifSearchName("");
    setNotifSearchId("");
    setSelectedNotifStudents([]);
    setNotifYearSearch("");
    setSelectedNotifYearLevels([]);
    setShowNotifYearDropdown(false);
    setIsAllNotifYearsExplicit(false);
    setNotifCourseSearch("");
    setSelectedNotifCourses([]);
    setShowNotifCourseDropdown(false);
    setIsAllNotifCoursesExplicit(false);
    setNotifRegistrantsModalOpen(false);
    setShowStudentDropdown(false);
    setNotifScheduled24(nextNotifTime);
    setNotifScheduledValue(toTimeValue(nextNotifTime));
    setEditingNotificationDispatchId(null);
  }, []);

  const handleStartEditScheduledNotification = async (
    item: NotificationSummary,
  ) => {
    setNotifError("");
    setNotifMsg("");

    if (roleLoading) {
      addToast({
        title: "Please wait",
        description: "Role check is still in progress.",
        color: "warning",
        timeout: 4500,
      });
      return;
    }

    if (!isECUser) {
      addToast({
        title: "Access denied",
        description: "Only EC members can edit notifications.",
        color: "danger",
        timeout: 5000,
      });
      return;
    }

    const allStudents =
      studentOptions.length > 0
        ? studentOptions
        : await loadStudentsForNotifications();
    const parsedSelectedStudents = parseTargetStudents(
      item.targetStudent,
      allStudents,
    );
    const legacyYears = splitCommaValues(item.yearLevel);
    const legacyCourses = splitCommaValues(item.course);
    const parsedYears = legacyYears.filter((entry) =>
      EVENT_YEAR_LEVEL_CHOICES.includes(entry),
    );
    const parsedCourses = legacyCourses.filter((entry) =>
      EVENT_COURSE_CHOICES.includes(entry),
    );
    const allYearsExplicit =
      parsedYears.length === 0 &&
      legacyYears.some((entry) => entry.toLowerCase() === "all years");
    const allCoursesExplicit =
      parsedCourses.length === 0 &&
      legacyCourses.some((entry) => entry.toLowerCase() === "all courses");

    const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.date ?? ""))
      ? String(item.date)
      : isoDateToday();
    const scheduledMinutes = parseTime12ToMinutes(item.scheduledTime);
    const nextScheduled24 =
      scheduledMinutes == null ? now24h() : minutesTo24h(scheduledMinutes);

    setEditingNotificationDispatchId(item.dispatchId);
    setNotifTitle(String(item.title ?? ""));
    setNotifDate(nextDate);
    setNotifDateValue(toCalendarDate(nextDate));
    setNotifMessage(String(item.message ?? ""));
    setNotifScheduled24(nextScheduled24);
    setNotifScheduledValue(toTimeValue(nextScheduled24));
    setSelectedNotifStudents(parsedSelectedStudents);
    setSelectedNotifYearLevels(parsedYears);
    setIsAllNotifYearsExplicit(allYearsExplicit);
    setSelectedNotifCourses(parsedCourses);
    setIsAllNotifCoursesExplicit(allCoursesExplicit);
    setNotifYearSearch("");
    setNotifCourseSearch("");
    setNotifSearchName("");
    setNotifSearchId("");
    setShowStudentDropdown(false);
    setShowNotifYearDropdown(false);
    setShowNotifCourseDropdown(false);
    setNotifRegistrantsModalOpen(false);

    setShowAddEventForm(false);
    setShowNotificationForm(true);
  };

  const handleSendNotification = async () => {
    setNotifError("");
    setNotifMsg("");

    if (roleLoading) return setNotifError("Checking your role, please wait...");
    if (!canManageNotifications) {
      return setNotifError("Only regular EC members can send notifications.");
    }
    if (!notifTitle.trim())
      return setNotifError("Notification title is required.");
    if (!notifDate) return setNotifError("Notification date is required.");
    if (!notifMessage.trim())
      return setNotifError("Notification message is required.");
    const title = notifTitle.trim();
    const message = notifMessage.trim();
    const scheduledTime = format12h(notifScheduled24);
    const selectedLabel = selectedNotifStudents
      .map((student) => `${student.studentName} (${student.schoolId})`)
      .join("; ");
    const hasSpecificRecipients = selectedNotifStudents.length > 0;
    const yearLevelValue = isAllNotifYearsExplicit
      ? "All Years"
      : selectedNotifYearLevels.join(", ");
    const courseValue = isAllNotifCoursesExplicit
      ? "All Courses"
      : selectedNotifCourses.join(", ");
    const derivedRecipientType: NotificationSummary["recipientType"] =
      hasSpecificRecipients
        ? "student"
        : hasNotifCourseFilter && !isAllNotifCoursesExplicit
          ? "course"
          : hasNotifYearFilter && !isAllNotifYearsExplicit
            ? "year"
            : "all";

    if (!editingNotificationDispatchId && !hasNotifRecipientSelection) {
      return setNotifError(
        "Choose at least one registrant before sending a notification.",
      );
    }

    if (editingNotificationDispatchId) {
      if (!currentUser?.uid)
        return setNotifError("Session not ready. Please sign in again.");

      const existing =
        notifications.find(
          (item) => item.dispatchId === editingNotificationDispatchId,
        ) ?? null;
      if (!existing) return setNotifError("Notification record not found.");
      const payloadTargetStudent =
        selectedNotifStudents.length > 0
          ? selectedLabel
          : String(existing.targetStudent ?? "");
      const payloadCourse = courseValue || String(existing.course ?? "");
      const payloadYearLevel =
        yearLevelValue || String(existing.yearLevel ?? "");
      const payloadRecipientType: NotificationSummary["recipientType"] =
        payloadTargetStudent
          ? "student"
          : payloadCourse === "All Courses" || payloadYearLevel === "All Years"
            ? "all"
            : payloadCourse && payloadCourse !== "All Courses"
            ? "course"
            : payloadYearLevel && payloadYearLevel !== "All Years"
              ? "year"
              : existing.recipientType;

      const payload = {
        title,
        message,
        date: notifDate,
        scheduledTime,
        recipientType: payloadRecipientType,
        course: payloadCourse,
        yearLevel: payloadYearLevel,
        targetStudent: payloadTargetStudent,
        courses: selectedNotifCourses,
        yearLevels: selectedNotifYearLevels,
        status: computeNotificationStatus(notifDate, scheduledTime),
        updatedAt: serverTimestamp(),
      };

      try {
        setSendingNotif(true);
        // Always update the EC sender summary document first.
        await setDoc(
          doc(
            db,
            "profiles",
            currentUser.uid,
            "notifications",
            `dispatch_${editingNotificationDispatchId}`,
          ),
          {
            ...payload,
            dispatchId: editingNotificationDispatchId,
            recipientCount: existing.recipientCount,
            createdByUid: currentUser.uid,
            read: true,
            type: "announcement",
          },
          { merge: true },
        );

        let bulkUpdateBlockedByPermissions = false;

        try {
          const dispatchQ = query(
            collectionGroup(db, "notifications"),
            where("dispatchId", "==", editingNotificationDispatchId),
            limit(2000),
          );
          const dispatchSnap = await getDocs(dispatchQ);
          const docsToUpdate = dispatchSnap.docs.filter(
            (d) => String(d.data()?.createdByUid ?? "") === currentUser.uid,
          );

          if (docsToUpdate.length > 0) {
            const chunkSize = 400;
            for (let i = 0; i < docsToUpdate.length; i += chunkSize) {
              const chunk = docsToUpdate.slice(i, i + chunkSize);
              const batch = writeBatch(db);
              chunk.forEach((d) => {
                batch.set(d.ref, payload, { merge: true });
              });
              await batch.commit();
            }
          }
        } catch (bulkError: any) {
          const code = String(bulkError?.code ?? "");
          const message = String(bulkError?.message ?? "");
          const permissionDenied =
            code === "permission-denied" ||
            message.toLowerCase().includes("insufficient permissions") ||
            message
              .toLowerCase()
              .includes("missing or insufficient permissions");

          if (!permissionDenied) {
            throw bulkError;
          }

          bulkUpdateBlockedByPermissions = true;
          ecEventsLogger.warn(
            "Bulk recipient update skipped due to Firestore permissions.",
            {
              dispatchId: editingNotificationDispatchId,
              code,
              message,
            },
          );
        }

        setNotifications((prev) =>
          prev
            .map((item) =>
              item.dispatchId === editingNotificationDispatchId
                ? {
                    ...item,
                    title,
                    message,
                    date: notifDate,
                    scheduledTime,
                    recipientType: payloadRecipientType,
                    course: payloadCourse,
                    yearLevel: payloadYearLevel,
                    targetStudent: payloadTargetStudent,
                    status: computeNotificationStatus(notifDate, scheduledTime),
                  }
                : item,
            )
            .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
        );

        resetNotificationComposer();
        if (bulkUpdateBlockedByPermissions) {
          setNotifMsg(
            "Notification updated in EC list. Recipient records were not updated due to Firestore permissions.",
          );
          addToast({
            title: "Updated with limits",
            description:
              "EC notification copy was updated, but recipient copies require broader Firestore update permissions.",
            color: "warning",
            timeout: 6500,
          });
        } else {
          setNotifMsg("Notification updated.");
        }
        setNotificationPage(1);
        setExpandedNotificationId(editingNotificationDispatchId);
        void refreshSentNotificationsOnce();
        return;
      } catch (error: unknown) {
        await logEventPermissionDeniedAttempt(
          "edit_notification",
          editingNotificationDispatchId,
          error,
        );
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update notification.";
        setNotifError(message);
        return;
      } finally {
        setSendingNotif(false);
      }
    }

    let students = studentOptions;
    if (studentsLoading && students.length === 0) {
      return setNotifError("Students are still loading. Please wait.");
    }
    if (students.length === 0) {
      students = await loadStudentsForNotifications();
    }
    if (students.length === 0)
      return setNotifError("No student records found.");

    const selectedStudentIdSet = new Set(
      selectedNotifStudents.map((student) => student.uid),
    );
    const recipients = students.filter((student) => {
      const yearMatch =
        selectedNotifYearLevels.length === 0 ||
        selectedNotifYearLevels.includes(String(student.year ?? "").trim());
      const courseMatch =
        selectedNotifCourses.length === 0 ||
        selectedNotifCourses.includes(String(student.course ?? "").trim());
      const studentMatch =
        selectedStudentIdSet.size === 0 ||
        selectedStudentIdSet.has(student.uid);
      return yearMatch && courseMatch && studentMatch;
    });

    if (recipients.length === 0) {
      return setNotifError(
        "No recipients found for the selected registrant filters.",
      );
    }

    const dispatchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      setSendingNotif(true);
      const chunkSize = 400;

      for (let i = 0; i < recipients.length; i += chunkSize) {
        const chunk = recipients.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        chunk.forEach((student) => {
          const notifRef = doc(
            collection(db, "profiles", student.uid, "notifications"),
          );
          batch.set(notifRef, {
            title,
            message,
            date: notifDate,
            scheduledTime,
            type: "announcement",
            dispatchId,
            recipientType: derivedRecipientType,
            course: courseValue,
            yearLevel: yearLevelValue,
            targetStudent: selectedLabel,
            courses: selectedNotifCourses,
            yearLevels: selectedNotifYearLevels,
            studentUid: student.uid,
            studentName: student.studentName,
            schoolId: student.schoolId,
            createdByUid: currentUser ? currentUser.uid : null,
            createdAt: serverTimestamp(),
            read: false,
          });
        });

        await batch.commit();
      }

      if (currentUser?.uid) {
        await setDoc(
          doc(
            db,
            "profiles",
            currentUser.uid,
            "notifications",
            `dispatch_${dispatchId}`,
          ),
          {
            title,
            message,
            date: notifDate,
            scheduledTime,
            type: "announcement",
            dispatchId,
            recipientType: derivedRecipientType,
            course: courseValue,
            yearLevel: yearLevelValue,
            targetStudent: selectedLabel,
            courses: selectedNotifCourses,
            yearLevels: selectedNotifYearLevels,
            recipientCount: recipients.length,
            createdByUid: currentUser.uid,
            createdAt: serverTimestamp(),
            read: true,
          },
        );
      }

      const optimisticCreatedAt = new Date();
      const optimisticRow: NotificationSummary = {
        id: dispatchId,
        dispatchId,
        title,
        message,
        date: notifDate,
        scheduledTime,
        recipientType: derivedRecipientType,
        course: courseValue,
        yearLevel: yearLevelValue,
        targetStudent: selectedLabel,
        createdAt: optimisticCreatedAt,
        recipientCount: recipients.length,
        status: computeNotificationStatus(notifDate, scheduledTime),
      };

      setNotifications((prev) => {
        const next = [
          optimisticRow,
          ...prev.filter((item) => item.dispatchId !== dispatchId),
        ];
        return next.sort(
          (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt),
        );
      });
      setNotificationPage(1);
      void refreshSentNotificationsOnce();

      setNotifMsg(`Notification sent to ${recipients.length} student(s).`);
      resetNotificationComposer();
    } catch (error: unknown) {
      await logEventPermissionDeniedAttempt(
        "send_notification",
        dispatchId,
        error,
      );
      const message =
        error instanceof Error ? error.message : "Failed to send notification.";
      setNotifError(message);
    } finally {
      setSendingNotif(false);
    }
  };

  const resetEventComposer = useCallback(() => {
    const nextEventDate = isoDateToday();
    setTitle("");
    setLocation("");
    setDate(nextEventDate);
    setEventDateValue(toCalendarDate(nextEventDate));
    setSelectedEventYearLevels([]);
    setSelectedEventCourses([]);
    setIsAllYearsExplicit(false);
    setIsAllCoursesExplicit(false);
    setDetails("");
    setIsPreReg(false);
    setWithPayment(false);
    setWaitlistEnabled(false);
    setRequiredPaymentId("");
    setPaymentTitle("");
    setPaymentAmount("");
    setPaymentDueDate("");
    setPaymentDescription("");
    setSelectedEventStudents([]);
    setEventYearSearch("");
    setEventCourseSearch("");
    setEventSearchName("");
    setShowEventYearDropdown(false);
    setShowEventCourseDropdown(false);
    setShowEventStudentDropdown(false);
    setRegistrantsModalOpen(false);
    setPreRegSlots(50);
    setEventScheduled24("07:00");
    setEventStartTimeValue(toTimeValue("07:00"));
    setEventEnd24("08:00");
    setEventEndTimeValue(toTimeValue("08:00"));
    setRegistrationStartDate(nextEventDate);
    setRegistrationStartDateValue(toCalendarDate(nextEventDate));
    setRegistrationStart24(now24h());
    setRegistrationStartTimeValue(toTimeValue(now24h()));
    setRegistrationEndDate(nextEventDate);
    setRegistrationEndDateValue(toCalendarDate(nextEventDate));
    setRegistrationEnd24("23:59");
    setRegistrationEndTimeValue(toTimeValue("23:59"));
    setCancellationDeadlineDate(nextEventDate);
    setCancellationDeadlineDateValue(toCalendarDate(nextEventDate));
    setCancellationDeadline24("23:59");
    setCancellationDeadlineTimeValue(toTimeValue("23:59"));
  }, []);

  const syncEventPaymentRecord = useCallback(async ({
    eventId,
    eventTitle,
    linkedPaymentId,
    targetStudents,
    yearLevelValue,
    courseValue,
    targetStudentSummary,
    targetYearLevels,
    targetCourses,
  }: {
    eventId: string;
    eventTitle: string;
    linkedPaymentId: string;
    targetStudents: StudentLookup[];
    yearLevelValue: string;
    courseValue: string;
    targetStudentSummary: string;
    targetYearLevels: string[];
    targetCourses: string[];
  }) => {
    if (!currentUser?.uid) {
      throw new Error("You must be signed in to save an event payment.");
    }

    const amountValue = Number(paymentAmount);
    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      throw new Error("Amount is required for paid events.");
    }

    const activeTargets = sortStudentLookups(
      targetStudents.filter(
        (student) => normalizeLowerLookupText(student.status) !== "inactive",
      ),
    );
    if (activeTargets.length === 0) {
      throw new Error(
        "No active students match the selected audience for this paid event.",
      );
    }

    const paymentDocRef = linkedPaymentId ?
      doc(db, "payments", linkedPaymentId) :
      doc(collection(db, "payments"));
    const [paymentDocSnap, existingAssignmentsSnap] = await Promise.all([
      getDoc(paymentDocRef),
      linkedPaymentId ?
        getDocs(collection(db, "payments", paymentDocRef.id, "students")) :
        Promise.resolve(null),
    ]);

    const existingPaymentData = paymentDocSnap.data() as {
      ref?: unknown;
      createdAt?: unknown;
    } | undefined;

    const existingAssignments = new Map<
      string,
      {
        status: "Paid" | "Unpaid";
      }
    >();
    existingAssignmentsSnap?.docs.forEach((assignmentDoc) => {
      existingAssignments.set(assignmentDoc.id, {
        status: normalizePaymentAssignmentStatus(assignmentDoc.data()?.status),
      });
    });

    const nextTargetIds = new Set(activeTargets.map((student) => student.uid));
    let paidCount = 0;

    await setDoc(
      paymentDocRef,
      {
        title: paymentTitle.trim() || eventTitle,
        ref:
          String(existingPaymentData?.ref ?? "").trim() ||
          makePaymentRef(paymentDocRef.id),
        amount: amountValue,
        date: paymentDueDate.trim(),
        yearLevel: yearLevelValue || "All Years",
        course: courseValue || "All Courses",
        targetStudent: targetStudentSummary,
        targetYearLevels,
        targetCourses,
        details: paymentDescription.trim(),
        linkedEventId: eventId,
        eventId,
        linkedEventTitle: eventTitle,
        createdByUid: currentUser.uid,
        createdByRole: "ecmember",
        createdByCourseScope: viewerCourseScope ?? null,
        courseScope:
          targetCourses.length === 1 ? targetCourses[0] : null,
        source: "event",
        status: "active",
        updatedAt: serverTimestamp(),
        ...(paymentDocSnap.exists() ? {} : {createdAt: serverTimestamp()}),
      },
      {merge: true},
    );

    const upsertRows = activeTargets.map((student) => {
      const existingStatus = existingAssignments.get(student.uid)?.status ?? "Unpaid";
      if (existingStatus === "Paid") {
        paidCount += 1;
      }

      return {
        student,
        status: existingStatus,
      };
    });

    const writesPerBatch = 350;
    for (let index = 0; index < upsertRows.length; index += writesPerBatch) {
      const batch = writeBatch(db);
      const chunk = upsertRows.slice(index, index + writesPerBatch);

      chunk.forEach(({student, status}) => {
        batch.set(
          doc(db, "payments", paymentDocRef.id, "students", student.uid),
          {
            uid: student.uid,
            schoolId: student.schoolId,
            name: student.studentName,
            studentName: student.studentName,
            year: student.year || "-",
            section: "-",
            course: student.course || "-",
            status,
            updatedAt: serverTimestamp(),
            ...(
              existingAssignments.has(student.uid) ?
                {} :
                {createdAt: serverTimestamp()}
            ),
          },
          {merge: true},
        );
      });

      await batch.commit();
    }

    const removedAssignmentIds = Array.from(existingAssignments.keys()).filter(
      (uid) => !nextTargetIds.has(uid),
    );
    for (let index = 0; index < removedAssignmentIds.length; index += writesPerBatch) {
      const batch = writeBatch(db);
      removedAssignmentIds
        .slice(index, index + writesPerBatch)
        .forEach((uid) => {
          batch.delete(doc(db, "payments", paymentDocRef.id, "students", uid));
        });
      await batch.commit();
    }

    await setDoc(
      paymentDocRef,
      {
        totalStudents: activeTargets.length,
        paidCount,
        unpaidCount: Math.max(0, activeTargets.length - paidCount),
        updatedAt: serverTimestamp(),
      },
      {merge: true},
    );

    return {
      paymentId: paymentDocRef.id,
      created: !paymentDocSnap.exists(),
    };
  }, [
    currentUser?.uid,
    paymentAmount,
    paymentDescription,
    paymentDueDate,
    paymentTitle,
    viewerCourseScope,
  ]);

  const handleStartEditUpcomingEvent = async (eventToEdit: EventDoc) => {
    setSaveError("");
    setSaveMsg("");

    if (roleLoading) {
      addToast({
        title: "Please wait",
        description: "Role check is still in progress.",
        color: "warning",
        timeout: 4500,
      });
      return;
    }

    if (!isECUser || !canEditEventRecord(eventToEdit)) {
      addToast({
        title: "Access denied",
        description: viewerIsBod ?
          "B.O.D. members can only edit their own upcoming course activities." :
          "You do not have permission to edit this event.",
        color: "danger",
        timeout: 5000,
      });
      return;
    }

    if (computeStatus(eventToEdit) !== "upcoming") {
      addToast({
        title: "Edit unavailable",
        description: "Only upcoming events can be edited.",
        color: "warning",
        timeout: 5000,
      });
      return;
    }

    const allStudents =
      studentOptions.length > 0
        ? studentOptions
        : await loadStudentsForNotifications();

    const startMinutes = parseTime12ToMinutes(
      eventToEdit.scheduledTime || eventToEdit.timeStart,
    );
    const start24 = startMinutes == null ? "07:00" : minutesTo24h(startMinutes);
    const endMinutes = parseTime12ToMinutes(eventToEdit.timeEnd);
    const end24 =
      endMinutes == null
        ? minutesTo24h((startMinutes ?? toMinutesFrom24h(start24)) + 60)
        : minutesTo24h(endMinutes);

    const selectedYearsFromArray = Array.isArray(eventToEdit.yearLevels)
      ? eventToEdit.yearLevels
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [];
    const selectedCoursesFromArray = Array.isArray(eventToEdit.courses)
      ? eventToEdit.courses.map((item) => String(item).trim()).filter(Boolean)
      : [];

    const legacyYears = splitCommaValues(eventToEdit.yearLevel);
    const legacyCourses = splitCommaValues(eventToEdit.course);

    const selectedYears = (
      selectedYearsFromArray.length > 0 ? selectedYearsFromArray : legacyYears
    ).filter((item) => EVENT_YEAR_LEVEL_CHOICES.includes(item));
    const selectedCourses = (
      selectedCoursesFromArray.length > 0
        ? selectedCoursesFromArray
        : legacyCourses
    ).filter((item) => EVENT_COURSE_CHOICES.includes(item));
    const allYearsExplicit =
      selectedYears.length === 0 &&
      legacyYears.some((item) => item.toLowerCase() === "all years");
    const allCoursesExplicit =
      selectedCourses.length === 0 &&
      legacyCourses.some((item) => item.toLowerCase() === "all courses");

    const explicitSelectedStudentIds = normalizeEventIdentifierList(
      eventToEdit.selectedStudentIds,
    );
    const explicitSelectedSchoolIds = normalizeEventIdentifierList(
      eventToEdit.selectedSchoolIds,
    );
    const parsedTargets =
      explicitSelectedStudentIds.length > 0 || explicitSelectedSchoolIds.length > 0
        ? sortStudentLookups(
            allStudents.filter(
              (student) =>
                explicitSelectedStudentIds.includes(student.uid) ||
                explicitSelectedSchoolIds.includes(student.schoolId),
            ),
          )
        : parseTargetStudents(eventToEdit.targetStudent, allStudents);
    const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(String(eventToEdit.date ?? ""))
      ? String(eventToEdit.date)
      : isoDateToday();

    setEditingEventId(eventToEdit.id);
    setTitle(String(eventToEdit.title ?? ""));
    setLocation(String(eventToEdit.location ?? ""));
    setDate(nextDate);
    setEventDateValue(toCalendarDate(nextDate));
    setDetails(String(eventToEdit.details ?? ""));

    const preRegEnabled = Boolean(eventToEdit.isPreReg);
    const paymentEnabled =
      Boolean(eventToEdit.withPayment) || Boolean(eventToEdit.paymentRequired);
    const linkedPaymentId = getEventLinkedPaymentId(eventToEdit);
    setIsPreReg(preRegEnabled);
    setWithPayment(paymentEnabled);
    setWaitlistEnabled(Boolean(eventToEdit.waitlistEnabled));
    setRequiredPaymentId(linkedPaymentId);
    setPreRegSlots(
      typeof eventToEdit.preRegSlots === "number" &&
        eventToEdit.preRegSlots >= 0
        ? Math.trunc(eventToEdit.preRegSlots)
        : 50,
    );

    if (paymentEnabled && linkedPaymentId) {
      const paymentSnap = await getDoc(doc(db, "payments", linkedPaymentId));
      const paymentData = paymentSnap.data() as {
        title?: unknown;
        amount?: unknown;
        date?: unknown;
        details?: unknown;
      } | undefined;

      setPaymentTitle(String(paymentData?.title ?? eventToEdit.title ?? "").trim());
      setPaymentAmount(
        paymentData?.amount != null ? String(paymentData.amount) : "",
      );
      setPaymentDueDate(String(paymentData?.date ?? "").trim());
      setPaymentDescription(String(paymentData?.details ?? "").trim());
    } else {
      setPaymentTitle(String(eventToEdit.title ?? "").trim());
      setPaymentAmount("");
      setPaymentDueDate("");
      setPaymentDescription("");
    }

    setEventScheduled24(start24);
    setEventStartTimeValue(toTimeValue(start24));
    setEventEnd24(end24);
    setEventEndTimeValue(toTimeValue(end24));
    const registrationStartDateValueMs = toMillis(eventToEdit.registrationStartAt);
    const registrationEndDateValueMs = toMillis(eventToEdit.registrationEndAt);
    const cancellationDeadlineValueMs = toMillis(eventToEdit.cancellationDeadlineAt);
    const defaultRegistrationEnd = dateFromIsoAnd24h(nextDate, start24) ?? new Date();
    const registrationStartDateObject =
      registrationStartDateValueMs > 0 ?
        new Date(registrationStartDateValueMs) :
        new Date();
    const registrationEndDateObject =
      registrationEndDateValueMs > 0 ?
        new Date(registrationEndDateValueMs) :
        defaultRegistrationEnd;
    const cancellationDeadlineDateObject =
      cancellationDeadlineValueMs > 0 ?
        new Date(cancellationDeadlineValueMs) :
        registrationEndDateObject;

    setRegistrationStartDate(isoDateFromDate(registrationStartDateObject));
    setRegistrationStartDateValue(
      toCalendarDate(isoDateFromDate(registrationStartDateObject)),
    );
    setRegistrationStart24(time24FromDate(registrationStartDateObject));
    setRegistrationStartTimeValue(
      toTimeValue(time24FromDate(registrationStartDateObject)),
    );
    setRegistrationEndDate(isoDateFromDate(registrationEndDateObject));
    setRegistrationEndDateValue(
      toCalendarDate(isoDateFromDate(registrationEndDateObject)),
    );
    setRegistrationEnd24(time24FromDate(registrationEndDateObject));
    setRegistrationEndTimeValue(
      toTimeValue(time24FromDate(registrationEndDateObject)),
    );
    setCancellationDeadlineDate(isoDateFromDate(cancellationDeadlineDateObject));
    setCancellationDeadlineDateValue(
      toCalendarDate(isoDateFromDate(cancellationDeadlineDateObject)),
    );
    setCancellationDeadline24(time24FromDate(cancellationDeadlineDateObject));
    setCancellationDeadlineTimeValue(
      toTimeValue(time24FromDate(cancellationDeadlineDateObject)),
    );

    setSelectedEventYearLevels(selectedYears);
    setSelectedEventCourses(
      viewerIsBod && viewerCourseScope ? [viewerCourseScope] : selectedCourses,
    );
    setIsAllYearsExplicit(allYearsExplicit);
    setIsAllCoursesExplicit(viewerIsBod ? false : allCoursesExplicit);
    setSelectedEventStudents(viewerIsBod ? [] : parsedTargets);

    setEventYearSearch("");
    setEventCourseSearch("");
    setEventSearchName("");
    setShowEventYearDropdown(false);
    setShowEventCourseDropdown(false);
    setShowEventStudentDropdown(false);
    setRegistrantsModalOpen(false);

    setShowNotificationForm(false);
    setShowAddEventForm(true);
  };

  const handleSaveEvent = async () => {
    setSaveError("");
    setSaveMsg("");

    if (roleLoading) return setSaveError("Checking your role, please wait...");
    if (!canCreateEvents) {
      return setSaveError("Only EC members can save events.");
    }
    if (viewerIsBod && !viewerCourseScope) {
      return setSaveError("Your B.O.D. profile is missing a course scope.");
    }
    if (!title.trim()) return setSaveError("Title is required.");
    if (!date) return setSaveError("Date is required.");
    if (toMinutesFrom24h(eventEnd24) <= toMinutesFrom24h(eventScheduled24)) {
      return setSaveError("End time must be later than start time.");
    }
    if (isPreReg && (Number.isNaN(preRegSlots) || preRegSlots < 0)) {
      return setSaveError("Pre-reg slots must be at least 0.");
    }
    if (
      withPayment &&
      (!Number.isFinite(Number(paymentAmount)) || Number(paymentAmount) <= 0)
    ) {
      const message = "Amount is required for paid events.";
      setSaveError(message);
      addToast({
        title: "Missing payment amount",
        description: message,
        color: "danger",
        timeout: 5000,
      });
      return;
    }
    if (!isPreReg && !hasEventRegistrantSelection && !editingEventId) {
      return setSaveError(
        "Choose at least one registrant filter or student before creating an event.",
      );
    }

    const eventBeingEdited = editingEventId
      ? (events.find((ev) => ev.id === editingEventId) ?? null)
      : null;
    if (editingEventId && !eventBeingEdited) {
      return setSaveError("The event you are editing no longer exists.");
    }
    if (eventBeingEdited && !canEditEventRecord(eventBeingEdited)) {
      return setSaveError(
        viewerIsBod ?
          "B.O.D. members can only edit their own upcoming course activities." :
          "You do not have permission to edit this event.",
      );
    }
    if (eventBeingEdited && computeStatus(eventBeingEdited) !== "upcoming") {
      return setSaveError("Only upcoming events can be edited.");
    }

    try {
      setSaving(true);
      const slots = isPreReg ? preRegSlots : null;
      const registrationStartAt = isPreReg
        ? dateFromIsoAnd24h(registrationStartDate, registrationStart24)
        : null;
      const registrationEndAt = isPreReg
        ? dateFromIsoAnd24h(registrationEndDate, registrationEnd24)
        : null;
      const cancellationDeadlineAt = isPreReg
        ? dateFromIsoAnd24h(cancellationDeadlineDate, cancellationDeadline24)
        : null;
      const eventStartAt = dateFromIsoAnd24h(date, eventScheduled24);

      if (
        isPreReg &&
        (!registrationStartAt || !registrationEndAt || !cancellationDeadlineAt)
      ) {
        return setSaveError(
          "Set valid registration and cancellation date/time values.",
        );
      }
      if (
        isPreReg &&
        registrationStartAt &&
        registrationEndAt &&
        registrationStartAt > registrationEndAt
      ) {
        return setSaveError("Registration start must be earlier than the end.");
      }
      if (
        isPreReg &&
        eventStartAt &&
        registrationEndAt &&
        registrationEndAt > eventStartAt
      ) {
        return setSaveError(
          "Registration end must be on or before the event start time.",
        );
      }
      if (
        isPreReg &&
        cancellationDeadlineAt &&
        registrationStartAt &&
        cancellationDeadlineAt < registrationStartAt
      ) {
        return setSaveError(
          "Cancellation deadline cannot be earlier than registration start.",
        );
      }
      if (
        isPreReg &&
        cancellationDeadlineAt &&
        registrationEndAt &&
        cancellationDeadlineAt > registrationEndAt
      ) {
        return setSaveError(
          "Cancellation deadline must be on or before registration end.",
        );
      }

      const effectiveSelectedEventStudents =
        viewerIsBod ? [] : selectedEventStudents;
      const studentTarget = effectiveSelectedEventStudents
        .map((student) => `${student.studentName} (${student.schoolId})`)
        .join("; ");
      const selectedStudentIds = effectiveSelectedEventStudents
        .map((student) => student.uid.trim())
        .filter((value) => value.length > 0 && !value.startsWith("manual-"));
      const selectedSchoolIds = Array.from(
        new Set(
          effectiveSelectedEventStudents
            .map((student) => student.schoolId.trim())
            .filter((value) => value.length > 0 && value !== "Unknown ID"),
        ),
      );
      const startTime = format12h(eventScheduled24);
      const endTime = format12h(eventEnd24);
      const yearLevelValue = isAllYearsExplicit
        ? "All Years"
        : selectedEventYearLevels.join(", ");
      const targetCourses =
        viewerIsBod && viewerCourseScope ? [viewerCourseScope] : selectedEventCourses;
      const courseValue =
        viewerIsBod && viewerCourseScope ?
          viewerCourseScope :
          isAllCoursesExplicit ?
            "All Courses" :
            targetCourses.join(", ");
      const liveRegistrationCount = editingEventId
        ? eventRegistrations[editingEventId]?.filter(
            (row) => row.status === "PRE_REGISTERED",
          ).length
        : undefined;
      const liveWaitlistCount = editingEventId
        ? eventRegistrations[editingEventId]?.filter(
            (row) => row.status === "WAITLISTED",
          ).length
        : undefined;
      const fallbackRegistrationCount =
        typeof eventBeingEdited?.preRegCount === "number"
          ? Math.max(0, Math.trunc(eventBeingEdited.preRegCount))
          : 0;
      const fallbackWaitlistCount =
        typeof eventBeingEdited?.waitlistCount === "number"
          ? Math.max(0, Math.trunc(eventBeingEdited.waitlistCount))
          : 0;
      const preRegCount = isPreReg
        ? (liveRegistrationCount ?? fallbackRegistrationCount)
        : 0;
      const waitlistCount = isPreReg
        ? (liveWaitlistCount ?? fallbackWaitlistCount)
        : 0;
      const preRegRemaining =
        isPreReg && typeof slots === "number"
          ? Math.max(0, slots - preRegCount)
          : 0;
      const eventDocRef = editingEventId ?
        doc(db, "events", editingEventId) :
        doc(collection(db, "events"));
      const eventDocId = eventDocRef.id;
      let linkedPaymentId = withPayment ? requiredPaymentId.trim() : "";
      const previousLinkedPaymentId = getEventLinkedPaymentId(eventBeingEdited);

      if (withPayment) {
        let allStudents = studentOptions;
        if (allStudents.length === 0) {
          allStudents = await loadStudentsForNotifications();
        }

        const paymentAudience = resolveRequiredEventAudience(
          {
            course: courseValue || "All Courses",
            courses: targetCourses,
            yearLevel: yearLevelValue || "All Years",
            yearLevels: selectedEventYearLevels,
            targetStudent: studentTarget,
            selectedStudentIds,
            selectedSchoolIds,
          },
          allStudents,
        );
        const paymentTargets = paymentAudience.resolved ?
          paymentAudience.students :
          sortStudentLookups(
            allStudents.filter(
              (student) =>
                normalizeLowerLookupText(student.status) !== "inactive",
            ),
          );

        const paymentSync = await syncEventPaymentRecord({
          eventId: eventDocId,
          eventTitle: title.trim(),
          linkedPaymentId,
          targetStudents: paymentTargets,
          yearLevelValue: yearLevelValue || "All Years",
          courseValue: courseValue || "All Courses",
          targetStudentSummary: studentTarget,
          targetYearLevels: selectedEventYearLevels,
          targetCourses,
        });
        linkedPaymentId = paymentSync.paymentId;
        setRequiredPaymentId(paymentSync.paymentId);

        addToast({
          title: paymentSync.created ? "Payment created with event." : "Payment synced with event.",
          description: paymentSync.created ?
            "The linked payment record was created automatically." :
            "The linked payment record was updated automatically.",
          color: "success",
          timeout: 4500,
        });
      } else if (previousLinkedPaymentId) {
        await setDoc(
          doc(db, "payments", previousLinkedPaymentId),
          {
            status: "archived",
            linkedEventId: null,
            eventId: null,
            linkedEventTitle: "",
            updatedAt: serverTimestamp(),
          },
          {merge: true},
        );
      }

      const savePayload = {
        title: title.trim(),
        location: location.trim(),
        date,
        scheduledTime: startTime,
        timeStart: startTime,
        timeEnd: endTime,
        yearLevel: yearLevelValue || "All Years",
        course: courseValue || "All Courses",
        yearLevels: selectedEventYearLevels,
        courses: targetCourses,
        targetStudent: studentTarget,
        selectedStudentIds,
        selectedSchoolIds,
        details: details.trim(),
        isPreReg,
        withPayment,
        paymentRequired: withPayment,
        waitlistEnabled: isPreReg ? waitlistEnabled : false,
        requiredPaymentId: withPayment ? linkedPaymentId : "",
        linkedPaymentId: withPayment ? linkedPaymentId : null,
        registrationStartAt,
        registrationEndAt,
        cancellationDeadlineAt,
        preRegSlots: slots,
        preRegCount,
        preRegRemaining,
        waitlistCount,
        ownerType:
          viewerIsBod ? "bod" : (eventBeingEdited?.ownerType ?? "ec"),
        courseScope:
          viewerIsBod ? viewerCourseScope : (eventBeingEdited?.courseScope ?? null),
        createdBy:
          viewerIsBod ?
            (currentUser ? currentUser.uid : null) :
            (eventBeingEdited?.createdBy ?? (currentUser ? currentUser.uid : null)),
        createdByPosition:
          viewerIsBod ?
            String(viewerProfileWithUid?.ecPosition ?? "").trim() || null :
            (eventBeingEdited?.createdByPosition ?? null),
        createdByCourseScope:
          viewerIsBod ?
            viewerCourseScope :
            (eventBeingEdited?.createdByCourseScope ?? null),
      };

      if (editingEventId) {
        await setDoc(eventDocRef, {
          ...savePayload,
          updatedAt: serverTimestamp(),
        }, {merge: true});
        setSaveMsg(withPayment ? "Event and payment updated!" : "Event updated!");
      } else {
        await setDoc(eventDocRef, {
          ...savePayload,
          createdBy: currentUser ? currentUser.uid : null,
          createdAt: serverTimestamp(),
          status: "upcoming",
        });
        setSaveMsg(withPayment ? "Event and payment saved!" : "Event saved!");
      }

      setEditingEventId(null);
      resetEventComposer();
      setShowAddEventForm(false);
    } catch (err: any) {
      await logEventPermissionDeniedAttempt(
        editingEventId ? "edit_event" : "create_event",
        editingEventId || title.trim() || "new-event",
        err,
      );
      setSaveError(
        err?.message ||
          (editingEventId
            ? "Failed to update event."
            : "Failed to save event."),
      );
    } finally {
      setSaving(false);
    }
  };

  const exportEventAttendanceWorkbook = async (ev: EventDoc) => {
    setExportMsg("");
    setExportError("");
    setExportingEventId(ev.id);

    try {
      const paymentId = getEventLinkedPaymentId(ev);
      const [attendanceSnap, registrationsSnap, paymentAssignmentsSnap] = await Promise.all([
        getDocs(collection(db, "events", ev.id, "attendance")),
        getDocs(collection(db, "events", ev.id, "registrations")),
        ev.withPayment && paymentId ?
          getDocs(collection(db, "payments", paymentId, "students")) :
          Promise.resolve(null),
      ]);

      const registrations = registrationsSnap.docs.map((registrationDoc) => {
        const data = registrationDoc.data() as Partial<RegistrationDoc>;
        return {
          id: registrationDoc.id,
          uid: String(data.uid ?? registrationDoc.id).trim(),
          schoolId: String(data.schoolId ?? "").trim(),
          studentName: String(data.studentName ?? "").trim(),
          course: String(data.course ?? "").trim(),
          year: String(data.year ?? "").trim(),
          createdAt: data.createdAt,
          updatedAt: data.updatedAt,
          registeredAt: data.registeredAt,
          waitlistedAt: data.waitlistedAt,
          cancelledAt: data.cancelledAt,
          status: parseRegistrationStatus(data.status),
        } as RegistrationDoc;
      });
      const attendanceRows = attendanceSnap.docs.map((attendanceDoc) => ({
        id: attendanceDoc.id,
        ...(attendanceDoc.data() as Omit<EventAttendanceDoc, "id">),
      }));
      const paymentAssignments = paymentAssignmentsSnap?.docs.map(
        (paymentStudentDoc) => ({
          id: paymentStudentDoc.id,
          ...(paymentStudentDoc.data() as Omit<EventPaymentStudentDoc, "id">),
        }),
      ) ?? [];
      const participantRows = buildEventParticipantRows(
        ev,
        registrations,
        attendanceRows,
        paymentAssignments,
      );
      const participantRowsByUid = new Map<string, EventParticipantRow>();
      const participantRowsBySchoolId = new Map<string, EventParticipantRow>();

      participantRows.forEach((row) => {
        participantRowsByUid.set(row.uid, row);
        const schoolId = String(row.schoolId ?? "").trim();
        if (schoolId) {
          participantRowsBySchoolId.set(schoolId, row);
        }
      });

      let allStudents = studentOptions;
      if (allStudents.length === 0) {
        allStudents = await loadStudentsForNotifications();
      }

      const audience = resolveRequiredEventAudience(ev, allStudents);
      let presentRows: AttendanceExportRow[] = [];
      let absentRows: AttendanceExportRow[] = [];
      let notPaidRows: AttendanceExportRow[] = [];

      if (audience.resolved) {
        audience.students.forEach((student) => {
          const participantRow =
            participantRowsByUid.get(student.uid) ??
            participantRowsBySchoolId.get(student.schoolId);

          if (participantRow?.attendanceStatus === "Not Paid") {
            notPaidRows.push(toNotPaidAttendanceExportRow(student, participantRow));
            return;
          }

          if (participantRow && isPresentAttendanceStatus(participantRow.attendanceStatus)) {
            presentRows.push(toPresentAttendanceExportRow(student, participantRow));
            return;
          }

          absentRows.push(toAbsentAttendanceExportRow(student));
        });

        presentRows = sortAttendanceExportRows(presentRows);
        absentRows = sortAttendanceExportRows(absentRows);
        notPaidRows = sortAttendanceExportRows(notPaidRows);
      } else {
        // Older events do not always store explicit audience filters. In that
        // case we preserve the previous export data and leave the absents sheet
        // and Not Paid sheets empty instead of inferring rows from the whole roster.
        presentRows = sortAttendanceExportRows(
          participantRows
            .filter((row) => isPresentAttendanceStatus(row.attendanceStatus))
            .map((row) => ({
              schoolId: row.schoolId,
              studentName: row.studentName,
              course: row.course,
              year: row.year,
              attendanceStatus: row.attendanceStatus,
              attendanceTimeIn: row.attendanceTimeIn,
              attendanceTimeOut: row.attendanceTimeOut,
            })),
        );
        absentRows = sortAttendanceExportRows(
          participantRows
            .filter((row) => row.attendanceStatus === "Absent")
            .map((row) => ({
              schoolId: row.schoolId,
              studentName: row.studentName,
              course: row.course,
              year: row.year,
              attendanceStatus: row.attendanceStatus,
              attendanceTimeIn: "",
              attendanceTimeOut: "",
            })),
        );
        notPaidRows = sortAttendanceExportRows(
          participantRows
            .filter((row) => row.attendanceStatus === "Not Paid")
            .map((row) => ({
              schoolId: row.schoolId,
              studentName: row.studentName,
              course: row.course,
              year: row.year,
              attendanceStatus: row.attendanceStatus,
              attendanceTimeIn: "",
              attendanceTimeOut: "",
            })),
        );
      }

      if (
        !audience.resolved &&
        presentRows.length === 0 &&
        absentRows.length === 0 &&
        notPaidRows.length === 0
      ) {
        setExportError(
          "No registration or attendance records found for this event.",
        );
        addToast({
          title: "Nothing to export",
          description: "No registration or attendance records were found for this event.",
          color: "warning",
          timeout: 5000,
        });
        return;
      }

      await downloadAttendanceWorkbook(ev, presentRows, absentRows, notPaidRows);

      const description = audience.resolved
        ? `Downloaded ${presentRows.length} present, ${absentRows.length} absent, and ${notPaidRows.length} not-paid row(s).`
        : "Downloaded the attendance workbook. Audience rules were unavailable, so only captured Present, Absents, and Not Paid rows were exported.";
      setExportMsg(
        audience.resolved
          ? `Exported ${presentRows.length} present, ${absentRows.length} absent, and ${notPaidRows.length} not-paid row(s) for "${ev.title}".`
          : `Exported attendance rows for "${ev.title}" using the available attendance and payment records.`,
      );
      addToast({
        title: "Attendance export ready",
        description,
        color: "success",
        timeout: 5500,
      });
    } catch (err: any) {
      const message = err?.message || "Failed to export attendance.";
      setExportError(message);
      addToast({
        title: "Export failed",
        description: message,
        color: "danger",
        timeout: 5500,
      });
    } finally {
      setExportingEventId(null);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <ECPageHeader
        title="Campus Event Management System"
        description="Organize events, manage notices, and review event files from an EC workspace that stays comfortable on phones, tablets, and desktop."
        eyebrow="EC Events"
        icon={CalendarClock}
        variant="hero"
        meta={
          <>
            <Chip variant="flat" className="bg-white/15 text-white">
              {summary.total} events tracked
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              {totalParticipants} participants
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              {notifications.length} notices
            </Chip>
          </>
        }
      />

      <ECStatsGrid items={eventSummaryItems} />

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-campus-text-primary">
            Quick Actions
          </h2>
          <p className="text-sm text-campus-text-secondary">
            Keep the main creation flows visible without burying the lists
            underneath.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ECQuickActionCard
            title="Create Event"
            description="Open the event composer to schedule a new EC activity, set audience rules, and manage pre-registration settings."
            icon={CalendarClock}
            action={
              <Button
                className="w-full bg-[#7b0000] text-white sm:w-auto"
                onPress={() =>
                  setShowAddEventForm((v) => {
                    const next = !v;
                    if (next) {
                      setEditingEventId(null);
                      setEditingNotificationDispatchId(null);
                      setSaveError("");
                      setSaveMsg("");
                      resetEventComposer();
                      setShowNotificationForm(false);
                    } else {
                      setEditingEventId(null);
                      setEditingNotificationDispatchId(null);
                    }
                    return next;
                  })
                }
              >
                Create Event
              </Button>
            }
          />

          {canManageNotifications && (
            <ECQuickActionCard
              title="Create Notification"
              description="Open the notification composer to schedule or update an EC notice without losing your event list context."
              icon={BellRing}
              action={
                <Button
                  color="primary"
                  variant="flat"
                  className="w-full sm:w-auto"
                  onPress={() =>
                    setShowNotificationForm((v) => {
                      const next = !v;
                      if (next) {
                        setNotifError("");
                        setNotifMsg("");
                        resetNotificationComposer();
                        setShowAddEventForm(false);
                        setEditingEventId(null);
                      }
                      return next;
                    })
                  }
                >
                  Create Notification
                </Button>
              }
            />
          )}
        </div>
      </section>

      {/* ADD EVENT FORM */}
      {showAddEventForm && (
        <div className="bg-white p-4 sm:p-6 border rounded-xl shadow space-y-4 animate-slideDown">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <h2 className="text-xl font-semibold text-primary-900">
              {isEditingEvent ? "Edit Event" : "Add New Event"}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Switch
                isSelected={isPreReg}
                onValueChange={setIsPreReg}
              >
                Pre-Registration
              </Switch>

              <Switch
                isSelected={withPayment}
                onValueChange={(checked) => {
                  setWithPayment(checked);
                  if (!checked) {
                    setRequiredPaymentId("");
                    setPaymentTitle("");
                    setPaymentAmount("");
                    setPaymentDueDate("");
                    setPaymentDescription("");
                  } else if (!paymentTitle.trim()) {
                    setPaymentTitle(title.trim());
                  }
                }}
              >
                With Payment
              </Switch>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium">Title</label>
            <Input
              aria-label="Event title"
              value={title}
              onValueChange={setTitle}
              className="w-full mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Location</label>
            <Input
              aria-label="Event location"
              value={location}
              onValueChange={setLocation}
              className="w-full mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Date</label>
            <DatePicker
              aria-label="Event date"
              className="w-full mt-1"
              value={eventDateValue}
              onChange={(value) => {
                setEventDateValue(value);
                setDate(toIsoDate(value));
              }}
              granularity="day"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Start Time</label>
              <TimeInput
                aria-label="Event start time"
                className="w-full mt-1"
                value={eventStartTimeValue}
                onChange={(value) => {
                  setEventStartTimeValue(value);
                  setEventScheduled24(to24hStringFromValue(value));
                }}
                granularity="minute"
              />
            </div>

            <div>
              <label className="text-sm font-medium">End Time</label>
              <TimeInput
                aria-label="Event end time"
                className="w-full mt-1"
                value={eventEndTimeValue}
                onChange={(value) => {
                  setEventEndTimeValue(value);
                  setEventEnd24(to24hStringFromValue(value));
                }}
                granularity="minute"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Registrants</label>
            <Button
              variant="bordered"
              className="w-full justify-between"
              onPress={() => {
                setShowEventYearDropdown(false);
                setShowEventCourseDropdown(false);
                setShowEventStudentDropdown(false);
                setRegistrantsModalOpen(true);
              }}
            >
              Registrants
            </Button>
            <Modal
              isOpen={registrantsModalOpen}
              onOpenChange={(open) => {
                setRegistrantsModalOpen(open);
                if (!open) {
                  setShowEventYearDropdown(false);
                  setShowEventCourseDropdown(false);
                  setShowEventStudentDropdown(false);
                }
              }}
              size="2xl"
              scrollBehavior="inside"
            >
              <ModalContent>
                {(onClose) => (
                  <>
                    <ModalHeader>Registrants</ModalHeader>
                    <ModalBody>
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">
                            Year Level
                          </label>

                          {(isAllYearsExplicit ||
                            selectedEventYearLevels.length > 0) && (
                            <div
                              className="mt-1 min-h-[52px] rounded-lg border bg-white px-3 py-2"
                            >
                              <div className="flex flex-wrap gap-2">
                                {isAllYearsExplicit &&
                                selectedEventYearLevels.length === 0 ? (
                                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">
                                      All Years
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      onPress={() => {
                                        setIsAllYearsExplicit(false);
                                      }}
                                      aria-label="Remove All Years"
                                    >
                                      x
                                    </Button>
                                  </span>
                                ) : (
                                  selectedEventYearLevels.map((item) => (
                                    <span
                                      key={item}
                                      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                    >
                                      <span className="font-medium">
                                        {item}
                                      </span>
                                      <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                        className="h-5 min-w-5 text-campus-text-secondary"
                                        onPress={() => {
                                          setIsAllYearsExplicit(false);
                                          setSelectedEventYearLevels((prev) =>
                                            prev.filter((x) => x !== item),
                                          );
                                        }}
                                        aria-label={`Remove ${item}`}
                                      >
                                        x
                                      </Button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          <div
                            ref={eventYearPickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={eventYearSearch}
                              onValueChange={(value) => {
                                setEventYearSearch(value);
                                setShowEventYearDropdown(true);
                              }}
                              onFocus={() => setShowEventYearDropdown(true)}
                              placeholder="Search year level"
                              size="sm"
                              className="w-full"
                            />

                            {showEventYearDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {!showAllYearsOption &&
                                filteredEventYearOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                    {selectedEventYearLevels.length ===
                                    EVENT_YEAR_LEVEL_CHOICES.length
                                      ? "All year levels selected."
                                      : "No matching year levels."}
                                  </p>
                                ) : (
                                  <>
                                    {showAllYearsOption && (
                                      <Button
                                        size="sm"
                                        variant="light"
                                        className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                        onPress={() => {
                                          setSelectedEventYearLevels([]);
                                          setIsAllYearsExplicit(true);
                                          setEventYearSearch("");
                                          setShowEventYearDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">
                                          All Years
                                        </div>
                                      </Button>
                                    )}

                                    {filteredEventYearOptions.map((item) => (
                                      <Button
                                        key={item}
                                        size="sm"
                                        variant="light"
                                        className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                        onPress={() => {
                                          setIsAllYearsExplicit(false);
                                          setSelectedEventYearLevels((prev) =>
                                            prev.includes(item)
                                              ? prev
                                              : [...prev, item],
                                          );
                                          setEventYearSearch("");
                                          setShowEventYearDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">
                                          {item}
                                        </div>
                                      </Button>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">
                            Course
                          </label>

                          {(isAllCoursesExplicit ||
                            selectedEventCourses.length > 0) && (
                            <div
                              className="mt-1 min-h-[52px] rounded-lg border bg-white px-3 py-2"
                            >
                              <div className="flex flex-wrap gap-2">
                                {isAllCoursesExplicit &&
                                selectedEventCourses.length === 0 ? (
                                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">
                                      All Courses
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      onPress={() => {
                                        setIsAllCoursesExplicit(false);
                                      }}
                                      aria-label="Remove All Courses"
                                    >
                                      x
                                    </Button>
                                  </span>
                                ) : (
                                  selectedEventCourses.map((item) => (
                                    <span
                                      key={item}
                                      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                    >
                                      <span className="font-medium">
                                        {item}
                                      </span>
                                      <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                        className="h-5 min-w-5 text-campus-text-secondary"
                                        onPress={() => {
                                          setIsAllCoursesExplicit(false);
                                          setSelectedEventCourses((prev) =>
                                            prev.filter((x) => x !== item),
                                          );
                                        }}
                                        aria-label={`Remove ${item}`}
                                      >
                                        x
                                      </Button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          <div
                            ref={eventCoursePickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={eventCourseSearch}
                              onValueChange={(value) => {
                                setEventCourseSearch(value);
                                setShowEventCourseDropdown(true);
                              }}
                              onFocus={() => setShowEventCourseDropdown(true)}
                              placeholder="Search course"
                              size="sm"
                              className="w-full"
                            />

                            {showEventCourseDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {!showAllCoursesOption &&
                                filteredEventCourseOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                    {selectedEventCourses.length ===
                                    EVENT_COURSE_CHOICES.length
                                      ? "All courses selected."
                                      : "No matching courses."}
                                  </p>
                                ) : (
                                  <>
                                    {showAllCoursesOption && (
                                      <Button
                                        size="sm"
                                        variant="light"
                                        className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                        onPress={() => {
                                          setSelectedEventCourses([]);
                                          setIsAllCoursesExplicit(true);
                                          setEventCourseSearch("");
                                          setShowEventCourseDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">
                                          All Courses
                                        </div>
                                      </Button>
                                    )}

                                    {filteredEventCourseOptions.map((item) => (
                                      <Button
                                        key={item}
                                        size="sm"
                                        variant="light"
                                        className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                        onPress={() => {
                                          setIsAllCoursesExplicit(false);
                                          setSelectedEventCourses((prev) =>
                                            prev.includes(item)
                                              ? prev
                                              : [...prev, item],
                                          );
                                          setEventCourseSearch("");
                                          setShowEventCourseDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">
                                          {item}
                                        </div>
                                      </Button>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">
                            To *
                          </label>

                          {selectedEventStudents.length > 0 && (
                            <div
                              className="mt-1 min-h-[52px] rounded-lg border bg-white px-3 py-2"
                            >
                              <div className="flex flex-wrap gap-2">
                                {selectedEventStudents.map((student) => (
                                  <span
                                    key={student.uid}
                                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                  >
                                    <span className="font-medium">
                                      {student.studentName}
                                    </span>
                                    <span className="text-campus-text-secondary">
                                      ({student.schoolId})
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      onPress={() => {
                                        setSelectedEventStudents((prev) =>
                                          prev.filter(
                                            (x) => x.uid !== student.uid,
                                          ),
                                        );
                                      }}
                                      aria-label={`Remove ${student.studentName}`}
                                    >
                                      x
                                    </Button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div
                            ref={eventStudentPickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={eventSearchName}
                              onValueChange={(value) => {
                                setEventSearchName(value);
                                setShowEventStudentDropdown(true);
                              }}
                              onFocus={() => setShowEventStudentDropdown(true)}
                              placeholder="Search by name"
                              size="sm"
                              className="w-full"
                            />

                            {showEventStudentDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {studentsLoading ? (
                                  <div className="p-3">
                                    <CampusCardListSkeleton rows={2} />
                                  </div>
                                ) : filteredEventStudentOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                    No matching students.
                                  </p>
                                ) : (
                                  filteredEventStudentOptions.map((student) => (
                                    <Button
                                      key={student.uid}
                                      size="sm"
                                      variant="light"
                                      className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                      onPress={() => {
                                        setSelectedEventStudents((prev) =>
                                          prev.some(
                                            (x) => x.uid === student.uid,
                                          )
                                            ? prev
                                            : [...prev, student],
                                        );
                                        setEventSearchName("");
                                        setShowEventStudentDropdown(true);
                                      }}
                                    >
                                      <div className="text-sm font-medium text-campus-text-primary">
                                        {student.studentName}
                                      </div>
                                      <div className="text-xs text-campus-text-secondary">
                                        {student.schoolId} |{" "}
                                        {student.course || "Unassigned"} |{" "}
                                        {student.year || "Unassigned"}
                                      </div>
                                    </Button>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </ModalBody>
                    <ModalFooter>
                      <Button
                        variant="light"
                        onPress={() => {
                          setShowEventYearDropdown(false);
                          setShowEventCourseDropdown(false);
                          setShowEventStudentDropdown(false);
                          onClose();
                        }}
                      >
                        Done
                      </Button>
                    </ModalFooter>
                  </>
                )}
              </ModalContent>
            </Modal>

            {hasSpecificTarget && (
              <p className="text-xs text-campus-text-secondary">
                Year Level and Course are optional when targeting specific
                students.
              </p>
            )}
            <p className="text-xs text-campus-text-secondary">
              Current filters: Year Level - {eventYearLevelLabel || "All Years"}; Course -{" "}
              {eventCourseLabel || "All Courses"}.
            </p>
            {!isPreReg && !hasEventRegistrantSelection && !isEditingEvent && (
              <p className="text-xs text-red-600">
                Choose at least one registrant filter or student to create this
                event.
              </p>
            )}
            <p className="text-xs text-campus-text-secondary">
              Choose specific students, Year Level filters, Course filters, or
              a combination of them. Leave everything broad to open the event to
              all students.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Details</label>
            <Textarea
              aria-label="Event details"
              value={details}
              onValueChange={setDetails}
              minRows={4}
              className="w-full mt-1"
            />
          </div>

          {withPayment && (
            <div className="space-y-4 rounded-xl border border-amber-200 bg-amber-50/60 p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-campus-text-primary">
                  Event Payment Details
                </p>
                <p className="text-xs text-campus-text-secondary">
                  Saving this event will automatically create or update the linked payment record.
                </p>
                {requiredPaymentId ? (
                  <Chip size="sm" className="bg-white text-amber-800">
                    Linked payment: {requiredPaymentId}
                  </Chip>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">Payment Title/Name</label>
                  <Input
                    aria-label="Payment title"
                    value={paymentTitle}
                    onValueChange={setPaymentTitle}
                    className="mt-1 w-full"
                    placeholder="Defaults to the event title"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Amount</label>
                  <Input
                    aria-label="Payment amount"
                    type="number"
                    min={0}
                    step="0.01"
                    value={paymentAmount}
                    onValueChange={setPaymentAmount}
                    className="mt-1 w-full"
                    placeholder="Enter amount"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">Due Date</label>
                  <Input
                    aria-label="Payment due date"
                    type="date"
                    value={paymentDueDate}
                    onValueChange={setPaymentDueDate}
                    className="mt-1 w-full"
                  />
                </div>

                <div className="lg:col-span-2">
                  <label className="text-sm font-medium">Description</label>
                  <Textarea
                    aria-label="Payment description"
                    value={paymentDescription}
                    onValueChange={setPaymentDescription}
                    minRows={3}
                    className="mt-1 w-full"
                    placeholder="Optional payment notes for students"
                  />
                </div>
              </div>

              <p className="text-xs text-campus-text-secondary">
                Students will only be treated as eligible attendees after this linked payment is marked paid on their account.
              </p>
            </div>
          )}

          {isPreReg && (
            <div className="space-y-4 rounded-xl border border-border/70 bg-slate-50/80 p-4">
              <div className="space-y-1">
                <p className="text-sm font-semibold text-campus-text-primary">
                  Pre-Registration Settings
                </p>
                <p className="text-xs text-campus-text-secondary">
                  These dates are enforced by the server when a student registers
                  or cancels.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div>
                  <label className="text-sm font-medium">
                    Registration Start Date
                  </label>
                  <DatePicker
                    aria-label="Registration start date"
                    className="mt-1 w-full"
                    value={registrationStartDateValue}
                    onChange={(value) => {
                      setRegistrationStartDateValue(value);
                      setRegistrationStartDate(toIsoDate(value));
                    }}
                    granularity="day"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">
                    Registration Start Time
                  </label>
                  <TimeInput
                    aria-label="Registration start time"
                    className="mt-1 w-full"
                    value={registrationStartTimeValue}
                    onChange={(value) => {
                      setRegistrationStartTimeValue(value);
                      setRegistrationStart24(to24hStringFromValue(value));
                    }}
                    granularity="minute"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">
                    Registration End Date
                  </label>
                  <DatePicker
                    aria-label="Registration end date"
                    className="mt-1 w-full"
                    value={registrationEndDateValue}
                    onChange={(value) => {
                      setRegistrationEndDateValue(value);
                      setRegistrationEndDate(toIsoDate(value));
                    }}
                    granularity="day"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">
                    Registration End Time
                  </label>
                  <TimeInput
                    aria-label="Registration end time"
                    className="mt-1 w-full"
                    value={registrationEndTimeValue}
                    onChange={(value) => {
                      setRegistrationEndTimeValue(value);
                      setRegistrationEnd24(to24hStringFromValue(value));
                    }}
                    granularity="minute"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">
                    Cancellation Deadline Date
                  </label>
                  <DatePicker
                    aria-label="Cancellation deadline date"
                    className="mt-1 w-full"
                    value={cancellationDeadlineDateValue}
                    onChange={(value) => {
                      setCancellationDeadlineDateValue(value);
                      setCancellationDeadlineDate(toIsoDate(value));
                    }}
                    granularity="day"
                  />
                </div>

                <div>
                  <label className="text-sm font-medium">
                    Cancellation Deadline Time
                  </label>
                  <TimeInput
                    aria-label="Cancellation deadline time"
                    className="mt-1 w-full"
                    value={cancellationDeadlineTimeValue}
                    onChange={(value) => {
                      setCancellationDeadlineTimeValue(value);
                      setCancellationDeadline24(to24hStringFromValue(value));
                    }}
                    granularity="minute"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
                <div>
                  <label className="text-sm font-medium">
                    Pre-Registration Slots
                  </label>
                  <Input
                    aria-label="Pre-registration slots"
                    type="number"
                    min={0}
                    step={1}
                    value={String(preRegSlots)}
                    onValueChange={(value) => {
                      const parsed = Number(value);
                      if (Number.isNaN(parsed)) {
                        setPreRegSlots(0);
                        return;
                      }

                      setPreRegSlots(Math.max(0, Math.trunc(parsed)));
                    }}
                    className="mt-1 w-full"
                    placeholder="e.g. 100"
                  />
                  <p className="mt-1 text-xs text-campus-text-secondary">
                    This is the maximum number of students allowed to hold
                    confirmed pre-registration slots.
                  </p>
                </div>

                <Switch
                  isSelected={waitlistEnabled}
                  onValueChange={setWaitlistEnabled}
                >
                  Enable Waitlist
                </Switch>
              </div>
            </div>
          )}

          {isEditingEvent && (
            <p className="text-xs text-campus-text-secondary">
              You can edit all fields for upcoming events, including
              pre-registration and payment settings.
            </p>
          )}

          {saveError && <p className="text-red-600 text-sm">{saveError}</p>}
          {saveMsg && <p className="text-green-600 text-sm">{saveMsg}</p>}

          <Button
            color="primary"
            onPress={handleSaveEvent}
            isDisabled={
              saving || roleLoading || !isECUser || registrantsRequiredMissing
            }
            className="w-full"
          >
            {roleLoading
              ? "Checking role..."
              : saving
                ? isEditingEvent
                  ? "Updating..."
                  : "Saving..."
                : isEditingEvent
                  ? "Update Event"
                  : "Save"}
          </Button>

          {!roleLoading && !isECUser && (
            <p className="text-xs text-campus-text-secondary">
              Your Firestore role is not <b>ec</b> in{" "}
              <code>profiles/{`{uid}`}</code>.
            </p>
          )}
        </div>
      )}

      {/* NOTIFICATION FORM */}
      {showNotificationForm && (
        <div className="bg-white p-4 sm:p-6 border rounded-xl shadow space-y-4 animate-slideDown">
          <h2 className="text-xl font-semibold text-blue-600">
            {isEditingNotification ? "Edit Notification" : "Create Notification"}
          </h2>

          <div>
            <label className="text-sm font-medium">Notification Title</label>
            <Input
              aria-label="Notification title"
              value={notifTitle}
              onValueChange={setNotifTitle}
              type="text"
              className="w-full mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Date</label>
            <DatePicker
              aria-label="Notification date"
              className="w-full mt-1"
              value={notifDateValue}
              onChange={(value) => {
                setNotifDateValue(value);
                setNotifDate(toIsoDate(value));
              }}
              granularity="day"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Scheduled Time</label>
            <TimeInput
              aria-label="Notification scheduled time"
              className="w-full mt-1"
              value={notifScheduledValue}
              onChange={(value) => {
                setNotifScheduledValue(value);
                setNotifScheduled24(to24hStringFromValue(value));
              }}
              granularity="minute"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Registrants</label>
            <Button
              variant="bordered"
              className="w-full justify-between"
              onPress={() => {
                setShowStudentDropdown(false);
                setShowNotifYearDropdown(false);
                setShowNotifCourseDropdown(false);
                setNotifRegistrantsModalOpen(true);
              }}
            >
              Registrants
            </Button>
            <Modal
              isOpen={notifRegistrantsModalOpen}
              onOpenChange={(open) => {
                setNotifRegistrantsModalOpen(open);
                if (!open) {
                  setShowStudentDropdown(false);
                  setShowNotifYearDropdown(false);
                  setShowNotifCourseDropdown(false);
                }
              }}
              size="2xl"
              scrollBehavior="inside"
            >
              <ModalContent>
                {(onClose) => (
                  <>
                    <ModalHeader>Registrants</ModalHeader>
                    <ModalBody>
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">
                            Year Level
                          </label>

                          {(isAllNotifYearsExplicit ||
                            selectedNotifYearLevels.length > 0) && (
                            <div
                              className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isEditingNotification ? "bg-gray-100" : "bg-white"}`}
                            >
                              <div className="flex flex-wrap gap-2">
                                {isAllNotifYearsExplicit &&
                                selectedNotifYearLevels.length === 0 ? (
                                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">
                                      All Years
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      isDisabled={isEditingNotification}
                                      onPress={() => {
                                        setIsAllNotifYearsExplicit(false);
                                      }}
                                      aria-label="Remove All Years"
                                    >
                                      x
                                    </Button>
                                  </span>
                                ) : (
                                  selectedNotifYearLevels.map((item) => (
                                    <span
                                      key={item}
                                      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                    >
                                      <span className="font-medium">
                                        {item}
                                      </span>
                                      <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                        className="h-5 min-w-5 text-campus-text-secondary"
                                        isDisabled={isEditingNotification}
                                        onPress={() => {
                                          setIsAllNotifYearsExplicit(false);
                                          setSelectedNotifYearLevels((prev) =>
                                            prev.filter(
                                              (entry) => entry !== item,
                                            ),
                                          );
                                        }}
                                        aria-label={`Remove ${item}`}
                                      >
                                        x
                                      </Button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          <div
                            ref={notifYearPickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={notifYearSearch}
                              onValueChange={(value) => {
                                setNotifYearSearch(value);
                                setShowNotifYearDropdown(true);
                              }}
                              onFocus={() => setShowNotifYearDropdown(true)}
                              isDisabled={isEditingNotification}
                              placeholder="Search year level"
                              size="sm"
                              className="w-full"
                            />

                            {!isEditingNotification &&
                              showNotifYearDropdown && (
                                <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                  {!showNotifAllYearsOption &&
                                  filteredNotifYearOptions.length === 0 ? (
                                    <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                      {selectedNotifYearLevels.length ===
                                      EVENT_YEAR_LEVEL_CHOICES.length
                                        ? "All year levels selected."
                                        : "No matching year levels."}
                                    </p>
                                  ) : (
                                    <>
                                      {showNotifAllYearsOption && (
                                        <Button
                                          size="sm"
                                          variant="light"
                                          className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                          onPress={() => {
                                            setSelectedNotifYearLevels([]);
                                            setIsAllNotifYearsExplicit(true);
                                            setNotifYearSearch("");
                                            setShowNotifYearDropdown(true);
                                          }}
                                        >
                                          <div className="text-sm font-medium text-campus-text-primary">
                                            All Years
                                          </div>
                                        </Button>
                                      )}

                                      {filteredNotifYearOptions.map((item) => (
                                        <Button
                                          key={item}
                                          size="sm"
                                          variant="light"
                                          className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                          onPress={() => {
                                            setIsAllNotifYearsExplicit(false);
                                            setSelectedNotifYearLevels(
                                              (prev) =>
                                                prev.includes(item)
                                                  ? prev
                                                  : [...prev, item],
                                            );
                                            setNotifYearSearch("");
                                            setShowNotifYearDropdown(true);
                                          }}
                                        >
                                          <div className="text-sm font-medium text-campus-text-primary">
                                            {item}
                                          </div>
                                        </Button>
                                      ))}
                                    </>
                                  )}
                                </div>
                              )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">
                            Course
                          </label>

                          {(isAllNotifCoursesExplicit ||
                            selectedNotifCourses.length > 0) && (
                            <div
                              className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isEditingNotification ? "bg-gray-100" : "bg-white"}`}
                            >
                              <div className="flex flex-wrap gap-2">
                                {isAllNotifCoursesExplicit &&
                                selectedNotifCourses.length === 0 ? (
                                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">
                                      All Courses
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      isDisabled={isEditingNotification}
                                      onPress={() => {
                                        setIsAllNotifCoursesExplicit(false);
                                      }}
                                      aria-label="Remove All Courses"
                                    >
                                      x
                                    </Button>
                                  </span>
                                ) : (
                                  selectedNotifCourses.map((item) => (
                                    <span
                                      key={item}
                                      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                    >
                                      <span className="font-medium">
                                        {item}
                                      </span>
                                      <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                        className="h-5 min-w-5 text-campus-text-secondary"
                                        isDisabled={isEditingNotification}
                                        onPress={() => {
                                          setIsAllNotifCoursesExplicit(false);
                                          setSelectedNotifCourses((prev) =>
                                            prev.filter(
                                              (entry) => entry !== item,
                                            ),
                                          );
                                        }}
                                        aria-label={`Remove ${item}`}
                                      >
                                        x
                                      </Button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          <div
                            ref={notifCoursePickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={notifCourseSearch}
                              onValueChange={(value) => {
                                setNotifCourseSearch(value);
                                setShowNotifCourseDropdown(true);
                              }}
                              onFocus={() => setShowNotifCourseDropdown(true)}
                              isDisabled={isEditingNotification}
                              placeholder="Search course"
                              size="sm"
                              className="w-full"
                            />

                            {!isEditingNotification &&
                              showNotifCourseDropdown && (
                                <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                  {!showNotifAllCoursesOption &&
                                  filteredNotifCourseOptions.length === 0 ? (
                                    <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                      {selectedNotifCourses.length ===
                                      EVENT_COURSE_CHOICES.length
                                        ? "All courses selected."
                                        : "No matching courses."}
                                    </p>
                                  ) : (
                                    <>
                                      {showNotifAllCoursesOption && (
                                        <Button
                                          size="sm"
                                          variant="light"
                                          className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                          onPress={() => {
                                            setSelectedNotifCourses([]);
                                            setIsAllNotifCoursesExplicit(true);
                                            setNotifCourseSearch("");
                                            setShowNotifCourseDropdown(true);
                                          }}
                                        >
                                          <div className="text-sm font-medium text-campus-text-primary">
                                            All Courses
                                          </div>
                                        </Button>
                                      )}

                                      {filteredNotifCourseOptions.map(
                                        (item) => (
                                          <Button
                                            key={item}
                                            size="sm"
                                            variant="light"
                                            className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                            onPress={() => {
                                              setIsAllNotifCoursesExplicit(
                                                false,
                                              );
                                              setSelectedNotifCourses((prev) =>
                                                prev.includes(item)
                                                  ? prev
                                                  : [...prev, item],
                                              );
                                              setNotifCourseSearch("");
                                              setShowNotifCourseDropdown(true);
                                            }}
                                          >
                                            <div className="text-sm font-medium text-campus-text-primary">
                                              {item}
                                            </div>
                                          </Button>
                                        ),
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">
                            To *
                          </label>

                          {selectedNotifStudents.length > 0 && (
                            <div
                              className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isEditingNotification ? "bg-gray-100" : "bg-white"}`}
                            >
                              <div className="flex flex-wrap gap-2">
                                {selectedNotifStudents.map((student) => (
                                  <span
                                    key={student.uid}
                                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                  >
                                    <span className="font-medium">
                                      {student.studentName}
                                    </span>
                                    <span className="text-campus-text-secondary">
                                      ({student.schoolId})
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      isDisabled={isEditingNotification}
                                      onPress={() => {
                                        setSelectedNotifStudents((prev) =>
                                          prev.filter(
                                            (entry) =>
                                              entry.uid !== student.uid,
                                          ),
                                        );
                                      }}
                                      aria-label={`Remove ${student.studentName}`}
                                    >
                                      x
                                    </Button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div
                            ref={studentPickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={notifSearchName}
                              onValueChange={(value) => {
                                setNotifSearchName(value);
                                setShowStudentDropdown(true);
                              }}
                              onFocus={() => setShowStudentDropdown(true)}
                              isDisabled={isEditingNotification}
                              placeholder="Search by name"
                              size="sm"
                              className="w-full"
                            />

                            {!isEditingNotification && showStudentDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {studentsLoading ? (
                                  <div className="p-3">
                                    <CampusCardListSkeleton rows={2} />
                                  </div>
                                ) : filteredStudentOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                    No matching students.
                                  </p>
                                ) : (
                                  filteredStudentOptions.map((student) => (
                                    <Button
                                      key={student.uid}
                                      size="sm"
                                      variant="light"
                                      className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                      onPress={() => {
                                        setSelectedNotifStudents((prev) =>
                                          prev.some(
                                            (entry) =>
                                              entry.uid === student.uid,
                                          )
                                            ? prev
                                            : [...prev, student],
                                        );
                                        setNotifSearchName("");
                                        setNotifSearchId("");
                                        setShowStudentDropdown(true);
                                      }}
                                    >
                                      <div className="text-sm font-medium text-campus-text-primary">
                                        {student.studentName}
                                      </div>
                                      <div className="text-xs text-campus-text-secondary">
                                        {student.schoolId} |{" "}
                                        {student.course || "Unassigned"} |{" "}
                                        {student.year || "Unassigned"}
                                      </div>
                                    </Button>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </ModalBody>
                    <ModalFooter>
                      <Button
                        variant="light"
                        onPress={() => {
                          setShowStudentDropdown(false);
                          setShowNotifYearDropdown(false);
                          setShowNotifCourseDropdown(false);
                          onClose();
                        }}
                      >
                        Done
                      </Button>
                    </ModalFooter>
                  </>
                )}
              </ModalContent>
            </Modal>

            {notifHasSpecificTarget && (
              <p className="text-xs text-campus-text-secondary">
                Year Level and Course are optional when targeting specific
                students.
              </p>
            )}
            <p className="text-xs text-campus-text-secondary">
              Current filters: Year Level - {notifYearLevelLabel}; Course -{" "}
              {notifCourseLabel}.
            </p>
            {!isEditingNotification && !notifHasSpecificTarget && (
              <p className="text-xs text-red-600">
                Choose at least one registrant to send this notification.
              </p>
            )}
            <p className="text-xs text-campus-text-secondary">
              Choose one or more specific students. You can still set Year Level
              and Course filters.
            </p>
          </div>

          {isEditingNotification && (
            <p className="text-xs text-campus-text-secondary">
              Editing this notification updates title, date/time, and message
              while keeping the same recipients.
            </p>
          )}

          <div>
            <label className="text-sm font-medium">Message</label>
            <Textarea
              aria-label="Notification message"
              value={notifMessage}
              onValueChange={setNotifMessage}
              minRows={4}
              className="w-full mt-1"
            />
          </div>

          {studentsError && (
            <p className="text-red-600 text-sm">{studentsError}</p>
          )}
          {notifError && <p className="text-red-600 text-sm">{notifError}</p>}
          {notifMsg && <p className="text-green-600 text-sm">{notifMsg}</p>}

          <Button
            color="primary"
            onPress={handleSendNotification}
            isDisabled={
              sendingNotif ||
              roleLoading ||
              !isECUser ||
              notifRecipientsRequiredMissing
            }
            className="w-full sm:w-auto"
          >
            {sendingNotif
              ? isEditingNotification
                ? "Updating..."
                : "Sending..."
              : isEditingNotification
                ? "Update Notification"
                : "Send Notification"}
          </Button>
        </div>
      )}

      {/* LIST TABS */}
      <Card
        shadow="none"
        className="border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]"
      >
        <CardBody className="p-4 sm:p-6">
        <Tabs
          aria-label="Dashboard lists"
          fullWidth
          selectedKey={listTab}
          onSelectionChange={(key) =>
            setListTab(String(key) as "events" | "notifications")
          }
          classNames={{
            tabList:
              "mb-4 grid w-full grid-cols-2 rounded-2xl bg-slate-100 p-1",
            cursor: "rounded-[14px] bg-white shadow-sm",
            tab: "min-h-11 w-full min-w-0 rounded-[14px] px-2",
            tabContent: "truncate text-xs font-medium sm:text-sm",
          }}
        >
          <Tab
            key="events"
            title={
              <span className="whitespace-nowrap">
                <span className="sm:hidden">Events</span>
                <span className="hidden sm:inline">Event List</span>
              </span>
            }
          >
            <div className="space-y-4">
              <ECFilterBar controlsClassName="grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="xl:col-span-2">
                  <Input
                    type="text"
                    label="Search"
                    placeholder="Search by title, venue, or audience"
                    value={searchText}
                    onValueChange={setSearchText}
                    size="sm"
                    className="w-full"
                  />
                </div>

                <Select
                  aria-label="Filter events by status"
                  label="Status"
                  selectedKeys={new Set([statusFilter])}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const selected = Array.from(keys)[0];
                    if (
                      selected === "all" ||
                      selected === "upcoming" ||
                      selected === "ongoing" ||
                      selected === "completed"
                    ) {
                      setStatusFilter(selected);
                    }
                  }}
                  disallowEmptySelection
                  size="sm"
                  className="w-full"
                >
                  <SelectItem key="all">All Status</SelectItem>
                  <SelectItem key="upcoming">Upcoming</SelectItem>
                  <SelectItem key="ongoing">Ongoing</SelectItem>
                  <SelectItem key="completed">Completed</SelectItem>
                </Select>

                <Input
                  aria-label="Filter events by date"
                  type="date"
                  label="Date"
                  value={eventDateFilter}
                  onValueChange={setEventDateFilter}
                  startContent={
                    <FiCalendar className="text-campus-text-secondary" />
                  }
                  size="sm"
                  className="w-full"
                />

                <Dropdown placement="bottom-start">
                  <DropdownTrigger>
                    <Button
                      variant="bordered"
                      className="min-h-12 w-full justify-between text-sm font-medium"
                    >
                      <span>Sort: {eventSortLabel}</span>
                      <FiChevronDown className="ml-1" />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu
                    aria-label="Sort events"
                    disallowEmptySelection
                    selectionMode="single"
                    selectedKeys={new Set([eventSortMode])}
                    onAction={(key) =>
                      setEventSortMode(String(key) as EventSortMode)
                    }
                  >
                    <DropdownItem key="latest_to_oldest">
                      Date, new to old
                    </DropdownItem>
                    <DropdownItem key="oldest_to_latest">
                      Date, old to new
                    </DropdownItem>
                    <DropdownItem key="alphabetical">
                      Alphabetically, A-Z
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              </ECFilterBar>

              {exportError && (
                <p className="text-sm text-red-600">{exportError}</p>
              )}
              {exportMsg && (
                <p className="text-sm text-green-600">{exportMsg}</p>
              )}

              {eventsLoading ? (
                <CampusCardListSkeleton rows={3} />
              ) : sortedFilteredEvents.length === 0 ? (
                <ECEmptyState
                  title="No events found"
                  description="Try another search term, lifecycle status, or exact event date."
                  compact
                />
              ) : (
                <div className="space-y-3">
                  {paginatedEvents.map((ev) => {
                    const liveStatus = computeStatus(ev);
                    const canEditThisEvent = canEditEventRecord(ev);
                    const hasSlots =
                      ev.isPreReg && typeof ev.preRegSlots === "number";
                    const registrations = eventRegistrations[ev.id] ?? [];
                    const preRegisteredRows = registrations.filter(
                      (row) => row.status === "PRE_REGISTERED",
                    );
                    const waitlistedRows = registrations.filter(
                      (row) => row.status === "WAITLISTED",
                    );
                    const cancelledRows = registrations.filter(
                      (row) => row.status === "CANCELLED",
                    );
                    const isEventExpanded = false;
                    const toggleEventDetails = () => {
                      setExpandedEventId(ev.id);
                      setSelectedEventTab("overview");
                      setParticipantSearch("");
                      setEventFilesTab("images");
                    };
                    const used = hasSlots
                      ? registrations.length > 0
                        ? preRegisteredRows.length
                        : typeof ev.preRegCount === "number"
                          ? ev.preRegCount
                          : 0
                      : typeof ev.preRegCount === "number"
                        ? ev.preRegCount
                        : 0;
                    const total =
                      typeof ev.preRegSlots === "number" ? ev.preRegSlots : 0;
                    const left = hasSlots ? Math.max(0, total - used) : null;

                    const imgs = eventImages[ev.id] ?? [];
                    const docs = eventDocs[ev.id] ?? [];
                    const previewImgs = imgs.slice(0, 3);
                    const previewDocs = docs.slice(0, 3);

                    return (
                      <div
                        key={ev.id}
                        className="cursor-pointer rounded-[24px] border border-border/70 bg-white/95 p-4 shadow-[var(--shadow-soft)] transition hover:bg-slate-50/80"
                        onClick={toggleEventDetails}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
                            <h4 className="font-semibold text-campus-text-primary">
                              {ev.title}
                            </h4>
                            <span
                              className={`px-3 py-1 text-xs rounded-full ${statusChip(liveStatus)}`}
                            >
                              {liveStatus}
                            </span>
                            {!canEditThisEvent && (
                              <span className="px-3 py-1 text-xs rounded-full bg-slate-100 text-slate-700">
                                Read-only
                              </span>
                            )}

                            {hasSlots && (
                              <span className="px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
                                Slots left: {left}
                              </span>
                            )}
                          </div>

                          <div className="flex w-full sm:w-auto flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="solid"
                              className="flex-1 sm:flex-none min-w-[94px] px-4 text-xs font-semibold text-white"
                              style={{
                                backgroundColor: "#A1A1AA",
                                borderColor: "#A1A1AA",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleEventDetails();
                              }}
                            >
                              {isEventExpanded ? "Hide details" : "Open event"}
                            </Button>
                            {liveStatus === "completed" ? (
                              <Button
                                size="sm"
                                color="danger"
                                variant="solid"
                                className="flex-1 sm:flex-none min-w-[94px] px-4 text-xs font-semibold"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestDeleteCompletedEvent(ev);
                                }}
                                isDisabled={!canEditThisEvent}
                              >
                                Delete
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant={
                                  liveStatus === "upcoming"
                                    ? "solid"
                                    : "bordered"
                                }
                                className={`flex-1 sm:flex-none min-w-[94px] px-4 text-xs font-semibold ${
                                  liveStatus === "upcoming" ? "text-white" : ""
                                }`}
                                style={
                                  liveStatus === "upcoming"
                                    ? {
                                        backgroundColor: "#F5A524",
                                        borderColor: "#F5A524",
                                      }
                                    : undefined
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (liveStatus !== "upcoming") return;
                                  void handleStartEditUpcomingEvent(ev);
                                }}
                                isDisabled={liveStatus !== "upcoming" || !canEditThisEvent}
                              >
                                {liveStatus === "upcoming"
                                  ? "Edit"
                                  : "Edit (later)"}
                              </Button>
                            )}
                          </div>
                        </div>

                        {ev.details && (
                          <p className="text-sm text-campus-text-secondary mt-1">
                            {ev.details}
                          </p>
                        )}

                        <ECStatusChipGroup
                          className="mt-3"
                          items={[
                            { label: "Date", value: ev.date, tone: "blue" },
                            {
                              label: "Time",
                              value: `${ev.scheduledTime || ev.timeStart || "—"}${ev.timeEnd ? ` - ${ev.timeEnd}` : ""}`,
                              tone: "amber",
                            },
                            {
                              label: "Venue",
                              value: ev.location || "—",
                              tone: "slate",
                            },
                          ]}
                        />

                        <div className="hidden mt-3 flex-col gap-2 text-sm text-campus-text-secondary sm:flex-row sm:items-center sm:gap-4">
                          <span>📅 {ev.date}</span>
                          <span>
                            ⏰ {ev.scheduledTime || ev.timeStart || "—"}
                            {ev.timeEnd ? ` - ${ev.timeEnd}` : ""}
                          </span>
                          <span>📍 {ev.location || "—"}</span>
                        </div>

                        {isEventExpanded && (
                          <div
                            className="mt-4 p-4 border rounded-lg bg-gray-50 space-y-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm text-campus-text-primary">
                                <b>Pre-Registrations:</b>{" "}
                                {preRegisteredRows.length > 0
                                  ? preRegisteredRows.length
                                  : used}
                              </p>
                              <Button
                                size="sm"
                                color="primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void exportEventAttendanceWorkbook(ev);
                                }}
                                isDisabled={exportingEventId === ev.id}
                                className="px-3 text-xs"
                              >
                                {exportingEventId === ev.id
                                  ? "Exporting..."
                                  : "Export Attendance"}
                              </Button>
                            </div>

                            <p className="text-sm text-campus-text-primary">
                              <b>Course:</b> {ev.course ?? "—"}
                            </p>
                            <p className="text-sm text-campus-text-primary">
                              <b>Year Level:</b> {ev.yearLevel ?? "—"}
                            </p>
                            {countSpecificEventAudienceSelections(ev) > 0 && (
                              <p className="text-sm text-campus-text-primary">
                                <b>Target Student:</b>{" "}
                                {getSpecificEventAudienceSummary(ev)}
                              </p>
                            )}
                            <p className="text-sm text-campus-text-primary">
                              <b>Pre-Reg:</b> {ev.isPreReg ? "Yes" : "No"} |{" "}
                              <b>With Payment:</b>{" "}
                              {ev.withPayment ? "Yes" : "No"}
                            </p>
                            {ev.isPreReg && (
                              <>
                                <p className="text-sm text-campus-text-primary">
                                  <b>Registration Window:</b>{" "}
                                  {formatDateTime(ev.registrationStartAt)} to{" "}
                                  {formatDateTime(ev.registrationEndAt)}
                                </p>
                                <p className="text-sm text-campus-text-primary">
                                  <b>Cancellation Deadline:</b>{" "}
                                  {formatDateTime(ev.cancellationDeadlineAt)}
                                </p>
                              </>
                            )}
                            {ev.isPreReg && (
                              <p className="text-sm text-campus-text-primary">
                                <b>Waitlist:</b> {ev.waitlistEnabled ? "Enabled" : "Disabled"} |{" "}
                                <b>Pre-registered:</b> {preRegisteredRows.length > 0
                                  ? preRegisteredRows.length
                                  : Math.max(0, Number(ev.preRegCount ?? 0))} |{" "}
                                <b>Waitlisted:</b> {waitlistedRows.length > 0
                                  ? waitlistedRows.length
                                  : Math.max(0, Number(ev.waitlistCount ?? 0))}
                              </p>
                            )}

                            {ev.isPreReg &&
                              typeof ev.preRegSlots === "number" && (
                                <p className="text-sm text-campus-text-primary">
                                  <b>Slots:</b> {used} / {ev.preRegSlots} (left:{" "}
                                  {Math.max(0, ev.preRegSlots - used)})
                                </p>
                              )}

                            {ev.isPreReg &&
                              preRegisteredRows.length > 0 && (
                                <div className="space-y-2">
                                  <p className="text-sm font-semibold text-campus-text-primary">
                                    Pre-registered Students
                                  </p>
                                  <div className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-3 lg:grid-cols-2">
                                    {preRegisteredRows.map((reg) => (
                                      <Card
                                        key={reg.id}
                                        shadow="none"
                                        className="border bg-gray-50"
                                      >
                                        <CardBody className="space-y-3 p-4 text-sm">
                                          <div>
                                            <p className="text-xs text-campus-text-secondary">
                                              School ID
                                            </p>
                                            <p className="font-semibold text-campus-text-primary">
                                              {reg.schoolId || "-"}
                                            </p>
                                          </div>
                                          <div className="grid grid-cols-2 gap-3">
                                            <div>
                                              <p className="text-xs text-campus-text-secondary">
                                                Name
                                              </p>
                                              <p className="text-campus-text-primary">
                                                {reg.studentName || reg.uid}
                                              </p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-campus-text-secondary">
                                                Course
                                              </p>
                                              <p className="text-campus-text-primary">
                                                {reg.course || "-"}
                                              </p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-campus-text-secondary">
                                                Year
                                              </p>
                                              <p className="text-campus-text-primary">
                                                {reg.year || "-"}
                                              </p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-campus-text-secondary">
                                                Status
                                              </p>
                                              <p className="text-campus-text-primary">
                                                {formatRegistrationStatus(reg.status)}
                                              </p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-campus-text-secondary">
                                                Registered At
                                              </p>
                                              <p className="text-campus-text-primary">
                                                {formatDateTime(
                                                  reg.registeredAt || reg.createdAt,
                                                )}
                                              </p>
                                            </div>
                                          </div>
                                        </CardBody>
                                      </Card>
                                    ))}
                                  </div>
                                </div>
                              )}

                            {ev.isPreReg && waitlistedRows.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-sm font-semibold text-campus-text-primary">
                                  Waitlisted Students
                                </p>
                                <div className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-3 lg:grid-cols-2">
                                  {waitlistedRows.map((reg) => (
                                    <Card
                                      key={reg.id}
                                      shadow="none"
                                      className="border bg-gray-50"
                                    >
                                      <CardBody className="space-y-3 p-4 text-sm">
                                        <div>
                                          <p className="text-xs text-campus-text-secondary">
                                            School ID
                                          </p>
                                          <p className="font-semibold text-campus-text-primary">
                                            {reg.schoolId || "-"}
                                          </p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                          <div>
                                            <p className="text-xs text-campus-text-secondary">
                                              Name
                                            </p>
                                            <p className="text-campus-text-primary">
                                              {reg.studentName || reg.uid}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-campus-text-secondary">
                                              Status
                                            </p>
                                            <p className="text-campus-text-primary">
                                              {formatRegistrationStatus(reg.status)}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-campus-text-secondary">
                                              Course
                                            </p>
                                            <p className="text-campus-text-primary">
                                              {reg.course || "-"}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-campus-text-secondary">
                                              Waitlisted At
                                            </p>
                                            <p className="text-campus-text-primary">
                                              {formatDateTime(
                                                reg.waitlistedAt || reg.createdAt,
                                              )}
                                            </p>
                                          </div>
                                        </div>
                                      </CardBody>
                                    </Card>
                                  ))}
                                </div>
                              </div>
                            )}

                            {ev.isPreReg && cancelledRows.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-sm font-semibold text-campus-text-primary">
                                  Cancelled Registrations
                                </p>
                                <div className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-3 lg:grid-cols-2">
                                  {cancelledRows.map((reg) => (
                                    <Card
                                      key={reg.id}
                                      shadow="none"
                                      className="border bg-gray-50"
                                    >
                                      <CardBody className="space-y-3 p-4 text-sm">
                                        <div>
                                          <p className="text-xs text-campus-text-secondary">
                                            School ID
                                          </p>
                                          <p className="font-semibold text-campus-text-primary">
                                            {reg.schoolId || "-"}
                                          </p>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                          <div>
                                            <p className="text-xs text-campus-text-secondary">
                                              Name
                                            </p>
                                            <p className="text-campus-text-primary">
                                              {reg.studentName || reg.uid}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-campus-text-secondary">
                                              Status
                                            </p>
                                            <p className="text-campus-text-primary">
                                              {formatRegistrationStatus(reg.status)}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-campus-text-secondary">
                                              Course
                                            </p>
                                            <p className="text-campus-text-primary">
                                              {reg.course || "-"}
                                            </p>
                                          </div>
                                          <div>
                                            <p className="text-xs text-campus-text-secondary">
                                              Cancelled At
                                            </p>
                                            <p className="text-campus-text-primary">
                                              {formatDateTime(
                                                reg.cancelledAt || reg.updatedAt,
                                              )}
                                            </p>
                                          </div>
                                        </div>
                                      </CardBody>
                                    </Card>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* FILES */}
                            <div className="pt-3 border-t space-y-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-semibold text-campus-text-primary">
                                  Event Files
                                </p>
                                {uploadingFor === ev.id && (
                                  <span className="text-xs text-campus-text-secondary">
                                    Uploading...
                                  </span>
                                )}
                              </div>

                              {uploadErr && (
                                <p className="text-sm text-red-600">
                                  {uploadErr}
                                </p>
                              )}
                              {uploadMsg && (
                                <p className="text-sm text-green-600">
                                  {uploadMsg}
                                </p>
                              )}

                              {/* Upload controls */}
                              {canEditThisEvent && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <label
                                    className="border rounded-lg p-3 bg-white cursor-pointer hover:bg-gray-50"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="text-sm font-semibold">
                                      Upload Images
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      Auto-compressed before upload (max 10MB
                                      final size)
                                    </div>
                                    <Input
                                      type="file"
                                      multiple
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) =>
                                        handleFileInputChange(
                                          ev.id,
                                          "images",
                                          e,
                                        )
                                      }
                                    />
                                  </label>

                                  <label
                                    className="border rounded-lg p-3 bg-white cursor-pointer hover:bg-gray-50"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="text-sm font-semibold">
                                      Upload Documents
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      PDF/DOC/DOCX (max 10MB each)
                                    </div>
                                    <Input
                                      type="file"
                                      multiple
                                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                      className="hidden"
                                      onChange={(e) =>
                                        handleFileInputChange(ev.id, "docs", e)
                                      }
                                    />
                                  </label>
                                </div>
                              )}

                              <Tabs
                                aria-label={`Event files for ${ev.title}`}
                                selectedKey={eventFilesTab}
                                onSelectionChange={(key) =>
                                  setEventFilesTab(String(key) as EventFilesTab)
                                }
                              >
                                <Tab
                                  key="images"
                                  title={`Images (${imgs.length})`}
                                >
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-sm font-semibold">
                                        Images
                                      </p>
                                      {imgs.length > 3 && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="light"
                                          color="primary"
                                          className="h-7 min-w-0 px-2 text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openViewAllFilesModal(
                                              ev.id,
                                              ev.title,
                                              "images",
                                            );
                                          }}
                                        >
                                          View all ({imgs.length})
                                        </Button>
                                      )}
                                    </div>

                                    {imgs.length === 0 ? (
                                      <p className="text-xs text-gray-500">
                                        No images uploaded yet.
                                      </p>
                                    ) : (
                                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {previewImgs.map((img) => (
                                          <div
                                            key={img.id}
                                            className="border rounded-lg bg-white p-2"
                                          >
                                            <a
                                              href={img.downloadURL}
                                              target="_blank"
                                              rel="noreferrer"
                                              onClick={(e) =>
                                                e.stopPropagation()
                                              }
                                            >
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img
                                                src={img.downloadURL}
                                                alt={img.name || "event image"}
                                                className="w-full h-28 object-cover rounded-md"
                                              />
                                            </a>

                                            <div className="mt-2 space-y-1">
                                              <p className="text-xs truncate">
                                                {img.name}
                                              </p>
                                              <div className="flex items-center justify-between gap-2">
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="light"
                                                  color="primary"
                                                  className="h-7 min-w-0 px-2 text-xs"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    downloadEventFile(
                                                      img,
                                                      img.name ||
                                                        "event-image.jpg",
                                                    );
                                                  }}
                                                >
                                                  Download
                                                </Button>

                                                {isECUser && img.path && (
                                                  <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="light"
                                                    color="danger"
                                                    className="h-7 min-w-0 px-2 text-xs"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      requestDeleteEventFile(
                                                        ev.id,
                                                        "images",
                                                        img.id,
                                                        img.path!,
                                                        img.name ||
                                                          "event-image.jpg",
                                                      );
                                                    }}
                                                  >
                                                    Delete
                                                  </Button>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </Tab>

                                <Tab
                                  key="docs"
                                  title={`Documents (${docs.length})`}
                                >
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-sm font-semibold">
                                        Documents
                                      </p>
                                      {docs.length > 3 && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="light"
                                          color="primary"
                                          className="h-7 min-w-0 px-2 text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openViewAllFilesModal(
                                              ev.id,
                                              ev.title,
                                              "docs",
                                            );
                                          }}
                                        >
                                          View all ({docs.length})
                                        </Button>
                                      )}
                                    </div>

                                    {docs.length === 0 ? (
                                      <p className="text-xs text-gray-500">
                                        No documents uploaded yet.
                                      </p>
                                    ) : (
                                      <div className="space-y-2">
                                        {previewDocs.map((f) => (
                                          <div
                                            key={f.id}
                                            className="border rounded-lg bg-white p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                                          >
                                            <div className="min-w-0">
                                              <p className="text-sm font-medium truncate">
                                                {f.name}
                                              </p>
                                            </div>

                                            <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="light"
                                                color="primary"
                                                className="h-7 min-w-0 px-2 text-xs sm:text-sm"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  downloadEventFile(
                                                    f,
                                                    f.name || "event-document",
                                                  );
                                                }}
                                              >
                                                Download
                                              </Button>

                                              {isECUser && f.path && (
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="light"
                                                  color="danger"
                                                  className="h-7 min-w-0 px-2 text-xs sm:text-sm"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    requestDeleteEventFile(
                                                      ev.id,
                                                      "docs",
                                                      f.id,
                                                      f.path!,
                                                      f.name ||
                                                        "event-document",
                                                    );
                                                  }}
                                                >
                                                  Delete
                                                </Button>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </Tab>
                              </Tabs>
                            </div>
                            {/* END FILES */}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {!eventsLoading &&
                sortedFilteredEvents.length > ITEMS_PER_PAGE && (
                  <div className="flex justify-center pt-2">
                    <Pagination
                      showControls
                      page={eventPage}
                      total={eventTotalPages}
                      onChange={(page) => setEventPage(page)}
                    />
                  </div>
                )}
            </div>
          </Tab>

          <Tab
            key="notifications"
            title={
              <span className="whitespace-nowrap">
                <span className="sm:hidden">Notifications</span>
                <span className="hidden sm:inline">Notification List</span>
              </span>
            }
          >
            <div className="space-y-4">
              <ECFilterBar controlsClassName="grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="xl:col-span-2">
                  <Input
                    type="text"
                    label="Search"
                    placeholder="Search notifications..."
                    value={notificationSearchText}
                    onValueChange={setNotificationSearchText}
                    size="sm"
                    className="w-full"
                  />
                </div>

                <Select
                  aria-label="Filter notifications by status"
                  label="Status"
                  selectedKeys={new Set([notificationStatusFilter])}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const selected = Array.from(keys)[0];
                    if (
                      selected === "all" ||
                      selected === "scheduled" ||
                      selected === "sent"
                    ) {
                      setNotificationStatusFilter(selected);
                    }
                  }}
                  disallowEmptySelection
                  size="sm"
                  className="w-full"
                >
                  <SelectItem key="all">All Status</SelectItem>
                  <SelectItem key="scheduled">Scheduled</SelectItem>
                  <SelectItem key="sent">Sent</SelectItem>
                </Select>

                <Input
                  aria-label="Filter notifications by date"
                  type="date"
                  label="Date"
                  value={notificationDateFilter}
                  onValueChange={setNotificationDateFilter}
                  startContent={
                    <FiCalendar className="text-campus-text-secondary" />
                  }
                  size="sm"
                  className="w-full"
                />

                <Dropdown placement="bottom-start">
                  <DropdownTrigger>
                    <Button
                      variant="bordered"
                      className="min-h-12 w-full justify-between text-sm font-medium"
                    >
                      <span>Sort: {notificationSortLabel}</span>
                      <FiChevronDown className="ml-1" />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu
                    aria-label="Sort notifications"
                    disallowEmptySelection
                    selectionMode="single"
                    selectedKeys={new Set([notificationSortMode])}
                    onAction={(key) =>
                      setNotificationSortMode(String(key) as EventSortMode)
                    }
                  >
                    <DropdownItem key="latest_to_oldest">
                      Date, new to old
                    </DropdownItem>
                    <DropdownItem key="oldest_to_latest">
                      Date, old to new
                    </DropdownItem>
                    <DropdownItem key="alphabetical">
                      Alphabetically, A-Z
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              </ECFilterBar>

              {notificationsLoading ? (
                <CampusCardListSkeleton rows={3} />
              ) : sortedFilteredNotifications.length === 0 ? (
                <ECEmptyState
                  title="No notifications found"
                  description="Try another search term, status filter, or exact date."
                  compact
                />
              ) : (
                <div className="space-y-3">
                  {paginatedNotifications.map((item) => {
                    const isExpanded =
                      expandedNotificationId === item.dispatchId;
                    const toggleNotificationDetails = () => {
                      setExpandedNotificationId((prev) =>
                        prev === item.dispatchId ? null : item.dispatchId,
                      );
                    };

                    return (
                      <div
                        key={item.dispatchId}
                        className="cursor-pointer rounded-[24px] border border-border/70 bg-white/95 p-4 shadow-[var(--shadow-soft)] transition hover:bg-slate-50/80"
                        onClick={toggleNotificationDetails}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <h4 className="font-semibold text-campus-text-primary">
                              {item.title || "Notification"}
                            </h4>
                            <span
                              className={`px-3 py-1 text-xs rounded-full ${notifStatusChip(item.status)}`}
                            >
                              {item.status}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <p className="text-xs text-campus-text-secondary">
                              Created: {formatDateTime(item.createdAt)}
                            </p>
                            <Button
                              size="sm"
                              variant="solid"
                              className="min-w-[94px] px-3 text-xs font-semibold text-white"
                              style={{
                                backgroundColor: "#A1A1AA",
                                borderColor: "#A1A1AA",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleNotificationDetails();
                              }}
                            >
                              {isExpanded ? "Hide details" : "Open notice"}
                            </Button>
                            <Button
                              size="sm"
                              variant="solid"
                              className="flex-1 sm:flex-none min-w-[94px] px-4 text-xs font-semibold text-white"
                              style={{
                                backgroundColor: "#F5A524",
                                borderColor: "#F5A524",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStartEditScheduledNotification(item);
                              }}
                            >
                              Edit
                            </Button>
                          </div>
                        </div>

                        {isExpanded && (
                          <>
                            <p className="text-sm text-campus-text-secondary mt-2">
                              {item.message || "-"}
                            </p>

                            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-campus-text-secondary">
                              <div>
                                <b>Date/Time:</b> {item.date || "-"}{" "}
                                {item.scheduledTime || ""}
                              </div>
                              <div>
                                <b>Target:</b> {notifTargetLabel(item)}
                              </div>
                              <div>
                                <b>Recipients:</b> {item.recipientCount}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {!notificationsLoading &&
                sortedFilteredNotifications.length > ITEMS_PER_PAGE && (
                  <div className="flex justify-center pt-2">
                    <Pagination
                      showControls
                      page={notificationPage}
                      total={notificationTotalPages}
                      onChange={(page) => setNotificationPage(page)}
                    />
                  </div>
                )}
            </div>
          </Tab>
        </Tabs>
        </CardBody>
      </Card>

      <Modal
        isOpen={Boolean(selectedEvent)}
        onOpenChange={(open) => {
          if (!open) {
            setExpandedEventId(null);
            setSelectedEventTab("overview");
            setParticipantSearch("");
          }
        }}
        size={isCompactViewport ? "full" : "5xl"}
        scrollBehavior="inside"
      >
        <ModalContent>
          {() =>
            selectedEvent ? (
              <>
                <ModalHeader className="flex flex-col gap-4 border-b border-border/70 pb-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Chip size="sm" className={statusChip(selectedEventStatus || "upcoming")}>
                          {selectedEventStatus || "upcoming"}
                        </Chip>
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-xl font-semibold text-campus-text-primary">
                          {selectedEvent.title}
                        </h3>
                        <div className="flex flex-col gap-2 text-sm font-normal text-campus-text-secondary sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                          <span className="inline-flex items-center gap-1.5">
                            <CalendarDays size={15} />
                            {selectedEvent.date}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <Clock3 size={15} />
                            {formatEventScheduleLabel(selectedEvent)}
                          </span>
                          <span className="inline-flex items-center gap-1.5">
                            <MapPin size={15} />
                            {selectedEvent.location || "TBA"}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="flat"
                        onPress={() => setExpandedEventId(null)}
                      >
                        Hide details
                      </Button>
                      {selectedEventStatus === "completed" ? (
                        <Button
                          color="danger"
                          variant="flat"
                          onPress={() => requestDeleteCompletedEvent(selectedEvent)}
                          isDisabled={!selectedEventEditable}
                        >
                          Delete
                        </Button>
                      ) : (
                        <Button
                          variant={selectedEventStatus === "upcoming" ? "solid" : "bordered"}
                          className={selectedEventStatus === "upcoming" ? "text-white" : ""}
                          style={
                            selectedEventStatus === "upcoming"
                              ? {
                                  backgroundColor: "#F5A524",
                                  borderColor: "#F5A524",
                                }
                              : undefined
                          }
                          onPress={() => {
                            if (selectedEventStatus !== "upcoming") return;
                            void handleStartEditUpcomingEvent(selectedEvent);
                          }}
                          isDisabled={selectedEventStatus !== "upcoming" || !selectedEventEditable}
                        >
                          {selectedEventStatus === "upcoming" ? "Edit event" : "Edit later"}
                        </Button>
                      )}
                    </div>
                  </div>
                </ModalHeader>

                <ModalBody className="space-y-5 pb-6">
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                    <EventDetailStat
                      label="Pre-Reg"
                      value={
                        selectedEventRegistrations.filter(
                          (row) => row.status === "PRE_REGISTERED",
                        ).length || Math.max(0, Number(selectedEvent.preRegCount ?? 0))
                      }
                      tone="blue"
                    />
                    <EventDetailStat
                      label="Present"
                      value={selectedEventPresentCount}
                      tone="green"
                    />
                    <EventDetailStat
                      label="Absent"
                      value={selectedEventAbsentCount}
                      tone="red"
                    />
                    <EventDetailStat
                      label="Not Paid"
                      value={selectedEventNotPaidCount}
                      tone="purple"
                    />
                    <EventDetailStat
                      label="Files"
                      value={selectedEventImages.length + selectedEventDocs.length}
                      tone="purple"
                    />
                  </div>

                  <Tabs
                    aria-label="EC event detail tabs"
                    selectedKey={selectedEventTab}
                    onSelectionChange={(key) =>
                      setSelectedEventTab(String(key) as EventDetailsTab)
                    }
                    fullWidth
                    classNames={eventDetailTabsClassNames}
                  >
                    <Tab key="overview" title="Overview">
                      <div className="grid grid-cols-1 gap-4 pt-3 lg:grid-cols-2">
                        <EventDetailSectionCard title="Event summary">
                          <div className="space-y-4">
                            <EventDetailInfoRow
                              label="Audience"
                              value={getEventTargetLabel(selectedEvent)}
                            />
                            <EventDetailInfoRow
                              label="Schedule"
                              value={`${selectedEvent.date} | ${formatEventScheduleLabel(selectedEvent)}`}
                            />
                            <EventDetailInfoRow
                              label="Location"
                              value={selectedEvent.location || "TBA"}
                            />
                            <EventDetailInfoRow
                              label="Payment linked"
                              value={
                                selectedEvent.withPayment ?
                                  getEventLinkedPaymentId(selectedEvent) || "Yes" :
                                  "No"
                              }
                            />
                            <EventDetailInfoRow
                              label="Pre-registration"
                              value={
                                selectedEvent.isPreReg
                                  ? `Enabled${typeof selectedEvent.preRegSlots === "number" ? ` (${selectedEvent.preRegSlots} slots)` : ""}`
                                  : "Disabled"
                              }
                            />
                          </div>
                        </EventDetailSectionCard>

                        <EventDetailSectionCard title="Event details">
                          <p className="text-sm leading-6 text-campus-text-secondary">
                            {selectedEvent.details || "No event description provided."}
                          </p>
                        </EventDetailSectionCard>

                        {selectedEvent.isPreReg ? (
                          <EventDetailSectionCard title="Registration controls">
                            <div className="space-y-4">
                              <EventDetailInfoRow
                                label="Registration window"
                                value={`${formatDateTime(selectedEvent.registrationStartAt)} to ${formatDateTime(selectedEvent.registrationEndAt)}`}
                              />
                              <EventDetailInfoRow
                                label="Cancellation deadline"
                                value={formatDateTime(selectedEvent.cancellationDeadlineAt)}
                              />
                              <EventDetailInfoRow
                                label="Waitlist"
                                value={selectedEvent.waitlistEnabled ? "Enabled" : "Disabled"}
                              />
                            </div>
                          </EventDetailSectionCard>
                        ) : null}

                        <EventDetailSectionCard title="Operational notes">
                          <div className="space-y-4">
                            <EventDetailInfoRow
                              label="Files available"
                              value={`${selectedEventImages.length} images | ${selectedEventDocs.length} documents`}
                            />
                            <EventDetailInfoRow
                              label="Target student"
                              value={
                                getSpecificEventAudienceSummary(selectedEvent) ||
                                "Not restricted to specific students"
                              }
                            />
                            {selectedEvent.isPreReg && typeof selectedEvent.preRegSlots === "number" ? (
                              <EventDetailInfoRow
                                label="Slots"
                                value={`${selectedEvent.preRegCount || 0} / ${selectedEvent.preRegSlots} used`}
                              />
                            ) : null}
                          </div>
                        </EventDetailSectionCard>
                      </div>
                    </Tab>

                    <Tab key="participants" title="Participants">
                      <div className="space-y-4 pt-3">
                        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_160px_auto]">
                          <Input
                            aria-label="Search participants"
                            value={participantSearch}
                            onValueChange={setParticipantSearch}
                            placeholder="Search participants by name, ID, course, year, or status"
                            startContent={<Search size={16} className="text-campus-text-secondary" />}
                          />

                          <Select
                            aria-label="Participant rows per page"
                            disallowEmptySelection
                            selectedKeys={new Set([participantRowsPerPage])}
                            onSelectionChange={(keys) => {
                              if (keys === "all") return;
                              const selected = Array.from(keys)[0];
                              if (typeof selected === "string") {
                                setParticipantRowsPerPage(selected);
                              }
                            }}
                          >
                            {PARTICIPANT_ROWS_PER_PAGE_OPTIONS.map((value) => (
                              <SelectItem key={value}>{value} / page</SelectItem>
                            ))}
                          </Select>

                          <Button
                            color="primary"
                            variant="flat"
                            startContent={<Download size={16} />}
                            onPress={() => void exportEventAttendanceWorkbook(selectedEvent)}
                            isDisabled={exportingEventId === selectedEvent.id}
                            isLoading={exportingEventId === selectedEvent.id}
                          >
                            {exportingEventId === selectedEvent.id
                              ? "Exporting..."
                              : "Export Attendance"}
                          </Button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <Chip size="sm" className="bg-slate-100 text-slate-700">
                            {filteredSelectedParticipantRows.length} participant
                            {filteredSelectedParticipantRows.length === 1 ? "" : "s"}
                          </Chip>
                          <Chip size="sm" className="bg-emerald-100 text-emerald-700">
                            Present: {selectedEventPresentCount}
                          </Chip>
                          <Chip size="sm" className="bg-rose-100 text-rose-700">
                            Absent: {selectedEventAbsentCount}
                          </Chip>
                          <Chip size="sm" className="bg-amber-100 text-amber-800">
                            Not Paid: {selectedEventNotPaidCount}
                          </Chip>
                        </div>

                        {filteredSelectedParticipantRows.length === 0 ? (
                          <ECEmptyState
                            title="No participants found"
                            description={
                              participantSearch
                                ? "Try a different search term to find a participant."
                                : "Registrations and attendance records will appear here once activity is recorded for this event."
                            }
                            compact
                          />
                        ) : (
                          <div className="space-y-3">
                            {paginatedSelectedParticipantRows.map((row) => (
                              <Card
                                key={`${row.uid}-${row.attendanceStatus}`}
                                shadow="none"
                                className="border border-border/70 bg-slate-50/70"
                              >
                                <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                                  <div className="min-w-0">
                                    <p className="font-semibold text-campus-text-primary">
                                      {row.studentName}
                                    </p>
                                    <p className="text-xs text-campus-text-secondary">
                                      {row.schoolId} | {row.course} | {row.year}
                                    </p>
                                    <p className="mt-1 text-xs text-campus-text-secondary">
                                      Time in: {row.attendanceTimeIn} | Time out: {row.attendanceTimeOut}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center justify-end gap-2">
                                    <Chip
                                      size="sm"
                                      className={getEventParticipantToneClasses(row.attendanceStatus)}
                                    >
                                      {row.attendanceStatus}
                                    </Chip>
                                    {selectedEvent.withPayment ? (
                                      <Chip
                                        size="sm"
                                        className={
                                          row.paymentStatus === "Paid" ?
                                            "bg-emerald-100 text-emerald-700" :
                                            row.paymentStatus === "Not Paid" ?
                                              "bg-amber-100 text-amber-800" :
                                              "bg-slate-100 text-slate-700"
                                        }
                                      >
                                        Payment: {row.paymentStatus}
                                      </Chip>
                                    ) : null}
                                  </div>
                                </CardBody>
                              </Card>
                            ))}

                            {filteredSelectedParticipantRows.length >
                            participantRowsPerPageValue ? (
                              <div className="flex justify-center sm:justify-end">
                                <Pagination
                                  showControls
                                  page={participantPage}
                                  total={selectedEventParticipantTotalPages}
                                  onChange={(nextPage) => setParticipantPage(nextPage)}
                                />
                              </div>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </Tab>

                    <Tab key="files" title="Files">
                      <div className="space-y-5 pt-3">
                        {uploadErr ? (
                          <p className="text-sm text-red-600">{uploadErr}</p>
                        ) : null}
                        {uploadMsg ? (
                          <p className="text-sm text-green-600">{uploadMsg}</p>
                        ) : null}

                        {selectedEventEditable ? (
                          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                            <Card shadow="none" className="border border-border/70 bg-slate-50/70">
                              <CardBody className="gap-2 p-4">
                                <p className="text-sm font-semibold text-campus-text-primary">
                                  Upload Images
                                </p>
                                <p className="text-xs leading-5 text-campus-text-secondary">
                                  Auto-compressed before upload with a 10MB final-size limit.
                                </p>
                                <label className="mt-2">
                                  <span className="sr-only">Upload event images</span>
                                  <Input
                                    type="file"
                                    multiple
                                    accept="image/*"
                                    onChange={(e) =>
                                      handleFileInputChange(selectedEvent.id, "images", e)
                                    }
                                  />
                                </label>
                              </CardBody>
                            </Card>

                            <Card shadow="none" className="border border-border/70 bg-slate-50/70">
                              <CardBody className="gap-2 p-4">
                                <p className="text-sm font-semibold text-campus-text-primary">
                                  Upload Documents
                                </p>
                                <p className="text-xs leading-5 text-campus-text-secondary">
                                  PDF, DOC, and DOCX files up to 10MB each.
                                </p>
                                <label className="mt-2">
                                  <span className="sr-only">Upload event documents</span>
                                  <Input
                                    type="file"
                                    multiple
                                    accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                    onChange={(e) =>
                                      handleFileInputChange(selectedEvent.id, "docs", e)
                                    }
                                  />
                                </label>
                              </CardBody>
                            </Card>
                          </div>
                        ) : null}

                        <EventFilesTabs
                          activeView={eventFilesTab === "docs" ? "documents" : "images"}
                          onViewChange={(view) =>
                            setEventFilesTab(view === "documents" ? "docs" : "images")
                          }
                          imageCount={selectedEventImages.length}
                          documentCount={selectedEventDocs.length}
                          previewImageFiles={selectedEventPreviewImages}
                          previewDocumentFiles={selectedEventPreviewDocs}
                          onOpenImages={() =>
                            openViewAllFilesModal(selectedEvent.id, selectedEvent.title, "images")
                          }
                          onOpenDocuments={() =>
                            openViewAllFilesModal(selectedEvent.id, selectedEvent.title, "docs")
                          }
                          onDownloadFile={(file) =>
                            downloadEventFile(
                              {
                                id: file.id,
                                name: file.name,
                                downloadURL: file.downloadURL,
                              },
                              file.name,
                            )
                          }
                          renderImageActions={(file) => {
                            const original = (eventImages[selectedEvent.id] ?? []).find(
                              (item) => item.id === file.id,
                            );
                            if (!selectedEventEditable || !original?.path) return null;

                            return (
                              <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                color="danger"
                                aria-label={`Delete ${file.name}`}
                                onPress={() =>
                                  requestDeleteEventFile(
                                    selectedEvent.id,
                                    "images",
                                    original.id,
                                    original.path!,
                                    original.name || file.name,
                                  )
                                }
                              >
                                <Trash2 size={16} />
                              </Button>
                            );
                          }}
                          renderDocumentActions={(file) => {
                            const original = (eventDocs[selectedEvent.id] ?? []).find(
                              (item) => item.id === file.id,
                            );
                            if (!selectedEventEditable || !original?.path) return null;

                            return (
                              <Button
                                isIconOnly
                                size="sm"
                                variant="light"
                                color="danger"
                                aria-label={`Delete ${file.name}`}
                                onPress={() =>
                                  requestDeleteEventFile(
                                    selectedEvent.id,
                                    "docs",
                                    original.id,
                                    original.path!,
                                    original.name || file.name,
                                  )
                                }
                              >
                                <Trash2 size={16} />
                              </Button>
                            );
                          }}
                          imageEmptyState={{
                            title: "No event images yet",
                            description: "Upload event images to share photo documentation with the campus community.",
                          }}
                          documentEmptyState={{
                            title: "No event documents yet",
                            description: "Upload event documents to keep supporting files attached to this event.",
                          }}
                        />
                      </div>
                    </Tab>
                  </Tabs>
                </ModalBody>
              </>
            ) : null
          }
        </ModalContent>
      </Modal>

      <AllEventImagesModal
        isOpen={viewAllFilesModal.open && viewAllFilesModal.kind === "images"}
        onOpenChange={(open) => {
          if (!open) closeViewAllFilesModal();
        }}
        files={viewAllModalImages.map((file) => toEventDetailFileItem(file, "images"))}
        eventTitle={viewAllFilesModal.eventTitle || "Event files"}
        isCompactView={isCompactViewport}
        onDownloadFile={(file) =>
          downloadEventFile(
            {
              id: file.id,
              name: file.name,
              downloadURL: file.downloadURL,
            },
            file.name,
          )
        }
        renderImageActions={(file) => {
          const original = viewAllModalImages.find((item) => item.id === file.id);
          const modalEventId = viewAllFilesModal.eventId;
          const modalEvent = events.find((item) => item.id === modalEventId) ?? null;
          if (!modalEventId || !modalEvent || !canEditEventRecord(modalEvent) || !original?.path) return null;

          return (
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="danger"
              aria-label={`Delete ${file.name}`}
              onPress={() =>
                requestDeleteEventFile(
                  modalEventId,
                  "images",
                  original.id,
                  original.path!,
                  original.name || file.name,
                )
              }
            >
              <Trash2 size={16} />
            </Button>
          );
        }}
        introText="Browse all event images and download what you need."
        emptyState={{
          title: "No images found",
          description: "Event images will appear here once uploaded.",
        }}
      />

      <AllEventDocumentsModal
        isOpen={viewAllFilesModal.open && viewAllFilesModal.kind === "docs"}
        onOpenChange={(open) => {
          if (!open) closeViewAllFilesModal();
        }}
        files={viewAllModalDocs.map((file) => toEventDetailFileItem(file, "docs"))}
        eventTitle={viewAllFilesModal.eventTitle || "Event files"}
        isCompactView={isCompactViewport}
        onDownloadFile={(file) =>
          downloadEventFile(
            {
              id: file.id,
              name: file.name,
              downloadURL: file.downloadURL,
            },
            file.name,
          )
        }
        renderDocumentActions={(file) => {
          const original = viewAllModalDocs.find((item) => item.id === file.id);
          const modalEventId = viewAllFilesModal.eventId;
          const modalEvent = events.find((item) => item.id === modalEventId) ?? null;
          if (!modalEventId || !modalEvent || !canEditEventRecord(modalEvent) || !original?.path) return null;

          return (
            <Button
              isIconOnly
              size="sm"
              variant="light"
              color="danger"
              aria-label={`Delete ${file.name}`}
              onPress={() =>
                requestDeleteEventFile(
                  modalEventId,
                  "docs",
                  original.id,
                  original.path!,
                  original.name || file.name,
                )
              }
            >
              <Trash2 size={16} />
            </Button>
          );
        }}
        emptyState={{
          title: "No documents found",
          description: "Event documents will appear here once uploaded.",
        }}
      />

      <Modal
        isOpen={Boolean(pendingDeleteFile)}
        onOpenChange={(open) => {
          if (!open && !deleteSubmitting) {
            setPendingDeleteFile(null);
          }
        }}
        size="md"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Delete File</ModalHeader>
              <ModalBody className="space-y-2">
                <p className="text-base text-campus-text-primary">
                  Are you sure you want to delete this file?
                </p>
                {pendingDeleteFile?.fileName && (
                  <p className="text-sm text-campus-text-secondary break-all">
                    {pendingDeleteFile.fileName}
                  </p>
                )}
              </ModalBody>
              <ModalFooter className="justify-between">
                <Button
                  variant="bordered"
                  onPress={() => {
                    setPendingDeleteFile(null);
                    onClose();
                  }}
                  isDisabled={deleteSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  color="warning"
                  onPress={() => {
                    void confirmDeleteEventFile();
                  }}
                  isLoading={deleteSubmitting}
                >
                  Delete
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal
        isOpen={Boolean(pendingDeleteEvent)}
        onOpenChange={(open) => {
          if (!open && !deleteEventSubmitting) {
            setPendingDeleteEvent(null);
          }
        }}
        size="md"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Delete Event</ModalHeader>
              <ModalBody className="space-y-2">
                <p className="text-base text-campus-text-primary">
                  Are you sure you want to delete this event?
                </p>
                {pendingDeleteEvent?.title && (
                  <p className="text-sm text-campus-text-secondary break-all">
                    {pendingDeleteEvent.title}
                  </p>
                )}
              </ModalBody>
              <ModalFooter className="justify-between">
                <Button
                  variant="bordered"
                  onPress={() => {
                    setPendingDeleteEvent(null);
                    onClose();
                  }}
                  isDisabled={deleteEventSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  color="danger"
                  onPress={() => {
                    void confirmDeleteCompletedEvent();
                  }}
                  isLoading={deleteEventSubmitting}
                >
                  Delete
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
