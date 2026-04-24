import { normalizeCourse } from "@/lib/courseOptions";
import { formatStudentFullName } from "@/lib/student-name";

export type AttendanceExportEvent = {
  id: string;
  title?: unknown;
  location?: unknown;
  date?: unknown;
  scheduledTime?: unknown;
  timeStart?: unknown;
  timeEnd?: unknown;
  yearLevel?: unknown;
  course?: unknown;
  yearLevels?: unknown;
  courses?: unknown;
  targetStudent?: unknown;
  selectedStudentIds?: unknown;
  selectedSchoolIds?: unknown;
  isPreReg?: unknown;
  withPayment?: unknown;
  paymentRequired?: unknown;
};

export type AttendanceExportAttendanceDoc = {
  id: string;
  uid?: unknown;
  studentUid?: unknown;
  schoolId?: unknown;
  studentName?: unknown;
  name?: unknown;
  course?: unknown;
  yearLevel?: unknown;
  year?: unknown;
  status?: unknown;
  attendanceStatus?: unknown;
  present?: unknown;
  timeIn?: unknown;
  timeInIso?: unknown;
  timeOut?: unknown;
  timeOutIso?: unknown;
  timestamp?: unknown;
  deviceTimestampIso?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type AttendanceExportRegistrationDoc = {
  id: string;
  uid?: unknown;
  schoolId?: unknown;
  studentName?: unknown;
  course?: unknown;
  year?: unknown;
  status?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  registeredAt?: unknown;
  waitlistedAt?: unknown;
  cancelledAt?: unknown;
};

export type AttendanceExportPaymentAssignmentDoc = {
  id: string;
  uid?: unknown;
  schoolId?: unknown;
  course?: unknown;
  status?: unknown;
};

export type AttendanceExportStudent = {
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  status: string;
  role?: string;
  searchText?: string;
};

export type AttendanceExportRow = {
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  attendanceStatus: string;
  attendanceTimeIn: string;
  attendanceTimeOut: string;
};

export type AttendanceParticipantStatus = "Present" | "Timed In" | "Absent";

export type AttendanceParticipantRow = {
  studentId: string;
  uid: string;
  schoolId: string;
  fullName: string;
  studentName: string;
  course: string;
  yearLevel: string;
  year: string;
  attendanceStatus: AttendanceParticipantStatus;
  timeIn: string;
  timeOut: string;
  attendanceTimeIn: string;
  attendanceTimeOut: string;
  sortMs: number;
};

type RegistrationStatus = "PRE_REGISTERED" | "WAITLISTED" | "CANCELLED";
type AttendanceExportStatus = "upcoming" | "ongoing" | "completed";

type EventParticipantRow = AttendanceExportRow & {
  uid: string;
  paymentStatus: "Paid" | "Not Paid" | "Not Required";
  sortMs: number;
};

type StudentLookupIndexes = {
  byUid: Map<string, AttendanceExportStudent>;
  bySchoolId: Map<string, AttendanceExportStudent>;
};

type AttendanceExportCandidate = {
  uid: string;
  schoolId: string;
  row: AttendanceExportRow;
  priority: number;
  sortMs: number;
  completeness: number;
};

type AttendanceExportCandidateCollection = {
  rowsByKey: Map<string, AttendanceExportCandidate>;
  keysByUid: Map<string, string>;
  keysBySchoolId: Map<string, string>;
};

type AttendanceExportBuildOptions = {
  event: AttendanceExportEvent;
  attendanceRows: AttendanceExportAttendanceDoc[];
  registrations?: AttendanceExportRegistrationDoc[];
  students?: AttendanceExportStudent[];
  paymentAssignments?: AttendanceExportPaymentAssignmentDoc[];
  respectPaymentStatus?: boolean;
};

export type AttendanceExportBuildResult = {
  presentRows: AttendanceExportRow[];
  absentRows: AttendanceExportRow[];
  notPaidRows: AttendanceExportRow[];
  audienceResolved: boolean;
};

export type AttendanceParticipantBuildResult = {
  rows: AttendanceParticipantRow[];
  audienceResolved: boolean;
};

type AttendanceWorkbookDownloadOptions = {
  absentRows?: AttendanceExportRow[];
  notPaidRows?: AttendanceExportRow[];
  includeNotPaidSheet?: boolean;
  absentSheetTimeColumns?: boolean;
  notPaidSheetTimeColumns?: boolean;
  metadataTimeLabels?: {
    timeIn: string;
    timeOut: string;
  };
};

function parseTime12ToMinutes(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;

  return hour * 60 + minute;
}

function parseDateOnly(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDateWithMinutes(baseDate: Date, minutes: number) {
  const date = new Date(baseDate);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function computeEventStatus(event: AttendanceExportEvent): AttendanceExportStatus {
  const baseDate = parseDateOnly(event.date);
  if (!baseDate) return "upcoming";

  const now = new Date();
  const startMin = parseTime12ToMinutes(event.scheduledTime ?? event.timeStart);
  const endMin = parseTime12ToMinutes(event.timeEnd);

  if (startMin == null) {
    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(baseDate);
    end.setHours(23, 59, 59, 999);

    if (now < start) return "upcoming";
    if (now > end) return "completed";
    return "ongoing";
  }

  const start = toDateWithMinutes(baseDate, startMin);
  if (endMin == null) {
    return now < start ? "upcoming" : "completed";
  }

  const safeEndMin = endMin >= startMin ? endMin : startMin + 60;
  const end = toDateWithMinutes(baseDate, safeEndMin);

  if (now < start) return "upcoming";
  if (now > end) return "completed";
  return "ongoing";
}

function splitCommaValues(value: unknown) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

  return splitCommaValues(value);
}

function normalizeEventIdentifierList(value: unknown) {
  return toEventTargetList(value).map((item) => normalizeLookupText(item)).filter(Boolean);
}

function toMillis(value: unknown): number {
  if (typeof value === "object" && value !== null) {
    const maybe = value as { toMillis?: () => number; seconds?: number };
    if (typeof maybe.toMillis === "function") {
      return maybe.toMillis();
    }
    if (typeof maybe.seconds === "number") {
      return maybe.seconds * 1000;
    }
  }

  const parsed = new Date(value as string | number | Date).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatDateTime(value: unknown) {
  const ms = toMillis(value);
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function parseRegistrationStatus(raw: unknown): RegistrationStatus {
  const normalized = String(raw ?? "").trim().toUpperCase();
  if (normalized === "WAITLISTED") return "WAITLISTED";
  if (normalized === "CANCELLED") return "CANCELLED";
  return "PRE_REGISTERED";
}

function formatRegistrationStatus(status: RegistrationStatus) {
  if (status === "WAITLISTED") return "Waitlisted";
  if (status === "CANCELLED") return "Cancelled";
  return "Pre-registered";
}

function registrationSortMillis(row: AttendanceExportRegistrationDoc): number {
  return (
    toMillis(row.registeredAt) ||
    toMillis(row.waitlistedAt) ||
    toMillis(row.cancelledAt) ||
    toMillis(row.updatedAt) ||
    toMillis(row.createdAt)
  );
}

function isPresentAttendanceStatus(status: string) {
  const normalized = normalizeLowerLookupText(status);
  return (
    normalized === "present" ||
    normalized === "timed in" ||
    normalized === "completed" ||
    normalized === "attended"
  );
}

function hasExplicitSelectedEventAudience(event: AttendanceExportEvent) {
  return (
    normalizeEventIdentifierList(event.selectedStudentIds).length > 0 ||
    normalizeEventIdentifierList(event.selectedSchoolIds).length > 0
  );
}

function matchesSelectedEventAudience(
  event: AttendanceExportEvent,
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

function sortStudentLookups(rows: AttendanceExportStudent[]) {
  return [...rows].sort(
    (left, right) =>
      left.studentName.localeCompare(right.studentName) ||
      left.schoolId.localeCompare(right.schoolId),
  );
}

function isActiveStudentStatus(status: string) {
  const normalized = normalizeLowerLookupText(status);
  return normalized === "" || normalized === "active";
}

function resolveRequiredEventAudience(
  event: AttendanceExportEvent,
  students: AttendanceExportStudent[],
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
      students: [] as AttendanceExportStudent[],
    };
  }

  const activeStudents = students.filter((student) =>
    isActiveStudentStatus(student.status),
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

function buildPaymentAssignmentIndexes(
  paymentAssignments: AttendanceExportPaymentAssignmentDoc[],
) {
  const byUid = new Map<string, "Paid" | "Unpaid">();
  const bySchoolId = new Map<string, "Paid" | "Unpaid">();

  paymentAssignments.forEach((assignment) => {
    const uid = String(assignment.uid ?? assignment.id).trim();
    const schoolId = String(assignment.schoolId ?? "").trim();
    const status =
      normalizeLowerLookupText(assignment.status) === "paid" ? "Paid" : "Unpaid";

    if (uid) {
      byUid.set(uid, status);
    }
    if (schoolId) {
      bySchoolId.set(schoolId, status);
    }
  });

  return {
    byUid,
    bySchoolId,
  };
}

function getPaymentStatusByStudent(
  event: AttendanceExportEvent,
  paymentAssignmentsByUid: Map<string, "Paid" | "Unpaid">,
  paymentAssignmentsBySchoolId: Map<string, "Paid" | "Unpaid">,
  uid: string,
  schoolId: string,
  respectPaymentStatus: boolean,
): EventParticipantRow["paymentStatus"] {
  if (!respectPaymentStatus) {
    return "Not Required";
  }

  const paymentRequired =
    event.withPayment === true || event.paymentRequired === true;
  if (!paymentRequired) {
    return "Not Required";
  }

  const normalizedUid = String(uid ?? "").trim();
  const normalizedSchoolId = String(schoolId ?? "").trim();
  const status =
    (normalizedUid ? paymentAssignmentsByUid.get(normalizedUid) : undefined) ??
    (normalizedSchoolId
      ? paymentAssignmentsBySchoolId.get(normalizedSchoolId)
      : undefined);

  return status === "Paid" ? "Paid" : "Not Paid";
}

function participantStatusSortRank(status: string) {
  const normalized = normalizeLowerLookupText(status);
  if (isPresentAttendanceStatus(status)) return 0;
  if (normalized === "absent" || normalized === "missed") return 1;
  if (normalized === "not paid") return 2;
  if (normalized === "pre-registered") return 3;
  if (normalized === "waitlisted") return 4;
  if (normalized === "cancelled") return 5;
  return 6;
}

function buildEventParticipantRows(
  event: AttendanceExportEvent,
  registrations: AttendanceExportRegistrationDoc[],
  attendanceRows: AttendanceExportAttendanceDoc[],
  paymentAssignments: AttendanceExportPaymentAssignmentDoc[],
  audienceStudents: AttendanceExportStudent[],
  respectPaymentStatus: boolean,
) {
  const rowsByUid = new Map<string, EventParticipantRow>();
  const preRegisteredByUid = new Set<string>();
  const preRegisteredBySchoolId = new Set<string>();
  const {
    byUid: paymentAssignmentsByUid,
    bySchoolId: paymentAssignmentsBySchoolId,
  } = buildPaymentAssignmentIndexes(paymentAssignments);

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
      respectPaymentStatus,
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
      respectPaymentStatus,
    );

    rowsByUid.set(uid, {
      uid,
      schoolId: schoolId || uid,
      studentName,
      course,
      year,
      attendanceStatus:
        paymentStatus === "Not Paid"
          ? "Not Paid"
          : formatRegistrationStatus(parseRegistrationStatus(registration.status)),
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
        rowDoc.deviceTimestampIso ||
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
      respectPaymentStatus,
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

  const eventCompleted = computeEventStatus(event) === "completed";
  rowsByUid.forEach((row) => {
    const paymentStatus = getPaymentStatusByStudent(
      event,
      paymentAssignmentsByUid,
      paymentAssignmentsBySchoolId,
      row.uid,
      row.schoolId,
      respectPaymentStatus,
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

function buildStudentLookupIndexes(
  students: AttendanceExportStudent[],
): StudentLookupIndexes {
  const byUid = new Map<string, AttendanceExportStudent>();
  const bySchoolId = new Map<string, AttendanceExportStudent>();

  students.forEach((student) => {
    const uid = String(student.uid ?? "").trim();
    const schoolId = String(student.schoolId ?? "").trim();

    if (uid) {
      byUid.set(uid, student);
    }
    if (schoolId) {
      bySchoolId.set(schoolId, student);
    }
  });

  return {
    byUid,
    bySchoolId,
  };
}

function resolveStudentLookupByIdentity(
  studentLookupIndexes: StudentLookupIndexes,
  uid: string,
  schoolId: string,
) {
  const normalizedUid = String(uid ?? "").trim();
  const normalizedSchoolId = String(schoolId ?? "").trim();

  return (
    (normalizedUid ? studentLookupIndexes.byUid.get(normalizedUid) : undefined) ??
    (normalizedSchoolId
      ? studentLookupIndexes.bySchoolId.get(normalizedSchoolId)
      : undefined)
  );
}

function resolveParticipantRowByIdentity(
  participantRowsByUid: Map<string, EventParticipantRow>,
  participantRowsBySchoolId: Map<string, EventParticipantRow>,
  uid: string,
  schoolId: string,
) {
  const normalizedUid = String(uid ?? "").trim();
  const normalizedSchoolId = String(schoolId ?? "").trim();

  return (
    (normalizedUid ? participantRowsByUid.get(normalizedUid) : undefined) ??
    (normalizedSchoolId
      ? participantRowsBySchoolId.get(normalizedSchoolId)
      : undefined)
  );
}

function enrichAttendanceRowsWithStudentLookup(
  attendanceRows: AttendanceExportAttendanceDoc[],
  studentLookupIndexes: StudentLookupIndexes,
) {
  return attendanceRows.map((rowDoc) => {
    const uid = String(rowDoc.uid ?? rowDoc.studentUid ?? rowDoc.id).trim();
    const schoolId = String(rowDoc.schoolId ?? "").trim();
    const matchedStudent =
      (uid ? studentLookupIndexes.byUid.get(uid) : undefined) ??
      (schoolId ? studentLookupIndexes.bySchoolId.get(schoolId) : undefined);

    if (!matchedStudent) {
      return rowDoc;
    }

    const matchedYear = String(matchedStudent.year ?? "").trim();
    const resolvedUid = String(matchedStudent.uid ?? "").trim() || uid;
    return {
      ...rowDoc,
      uid: resolvedUid,
      studentUid: resolvedUid,
      schoolId: schoolId || matchedStudent.schoolId,
      studentName:
        String(rowDoc.studentName ?? "").trim() || matchedStudent.studentName,
      name: String(rowDoc.name ?? "").trim() || matchedStudent.studentName,
      course:
        normalizeCourse(String(rowDoc.course ?? "").trim()) ||
        String(rowDoc.course ?? "").trim() ||
        matchedStudent.course,
      yearLevel:
        String(rowDoc.yearLevel ?? "").trim() ||
        String(rowDoc.year ?? "").trim() ||
        matchedYear,
      year:
        String(rowDoc.year ?? "").trim() ||
        String(rowDoc.yearLevel ?? "").trim() ||
        matchedYear,
    } satisfies AttendanceExportAttendanceDoc;
  });
}

function normalizeAttendanceExportIdentityValue(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function countAttendanceExportRowCompleteness(row: AttendanceExportRow) {
  const values = [
    row.schoolId,
    row.studentName,
    row.course,
    row.year,
    row.attendanceTimeIn,
    row.attendanceTimeOut,
  ];

  return values.filter((value) => {
    const normalized = String(value ?? "").trim();
    return normalized !== "" && normalized !== "-";
  }).length;
}

function resolveAttendanceExportCandidateKey(uid: string, schoolId: string) {
  const normalizedUid = normalizeAttendanceExportIdentityValue(uid);
  if (normalizedUid) {
    return `uid:${normalizedUid}`;
  }

  const normalizedSchoolId = normalizeAttendanceExportIdentityValue(schoolId);
  if (normalizedSchoolId) {
    return `school:${normalizedSchoolId}`;
  }

  return "";
}

function createAttendanceExportCandidateCollection(): AttendanceExportCandidateCollection {
  return {
    rowsByKey: new Map<string, AttendanceExportCandidate>(),
    keysByUid: new Map<string, string>(),
    keysBySchoolId: new Map<string, string>(),
  };
}

function shouldReplaceAttendanceExportCandidate(
  existing: AttendanceExportCandidate,
  next: AttendanceExportCandidate,
) {
  if (next.priority !== existing.priority) {
    return next.priority > existing.priority;
  }

  if (next.sortMs !== existing.sortMs) {
    return next.sortMs > existing.sortMs;
  }

  return next.completeness >= existing.completeness;
}

function addAttendanceExportCandidate(
  collection: AttendanceExportCandidateCollection,
  candidate: Omit<AttendanceExportCandidate, "completeness">,
) {
  const normalizedUid = normalizeAttendanceExportIdentityValue(candidate.uid);
  const normalizedSchoolId = normalizeAttendanceExportIdentityValue(
    candidate.schoolId,
  );
  const existingKey =
    (normalizedUid ? collection.keysByUid.get(normalizedUid) : undefined) ??
    (normalizedSchoolId
      ? collection.keysBySchoolId.get(normalizedSchoolId)
      : undefined);
  const key =
    existingKey ?? resolveAttendanceExportCandidateKey(candidate.uid, candidate.schoolId);

  if (!key) {
    return;
  }

  const nextCandidate: AttendanceExportCandidate = {
    ...candidate,
    completeness: countAttendanceExportRowCompleteness(candidate.row),
  };
  const existingCandidate = collection.rowsByKey.get(key);

  if (
    !existingCandidate ||
    shouldReplaceAttendanceExportCandidate(existingCandidate, nextCandidate)
  ) {
    collection.rowsByKey.set(key, nextCandidate);
  }

  if (normalizedUid) {
    collection.keysByUid.set(normalizedUid, key);
  }
  if (normalizedSchoolId) {
    collection.keysBySchoolId.set(normalizedSchoolId, key);
  }
}

function hasAttendanceExportCandidateIdentity(
  collection: AttendanceExportCandidateCollection,
  uid: string,
  schoolId: string,
) {
  const normalizedUid = normalizeAttendanceExportIdentityValue(uid);
  if (normalizedUid && collection.keysByUid.has(normalizedUid)) {
    return true;
  }

  const normalizedSchoolId = normalizeAttendanceExportIdentityValue(schoolId);
  return Boolean(
    normalizedSchoolId && collection.keysBySchoolId.has(normalizedSchoolId),
  );
}

function buildPresentAttendanceExportCandidates(
  attendanceRows: AttendanceExportAttendanceDoc[],
  studentLookupIndexes: StudentLookupIndexes,
) {
  const candidates: Array<Omit<AttendanceExportCandidate, "completeness">> = [];

  attendanceRows.forEach((rowDoc) => {
    const uid = String(rowDoc.uid ?? rowDoc.studentUid ?? rowDoc.id).trim();
    const attendanceSchoolId = String(rowDoc.schoolId ?? "").trim();
    const matchedStudent =
      (uid ? studentLookupIndexes.byUid.get(uid) : undefined) ??
      (attendanceSchoolId
        ? studentLookupIndexes.bySchoolId.get(attendanceSchoolId)
        : undefined);
    const schoolId = attendanceSchoolId || matchedStudent?.schoolId || uid;

    if (!schoolId) {
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
        rowDoc.deviceTimestampIso ||
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
      "Recorded";

    if (!isPresentAttendanceStatus(status)) {
      return;
    }

    const studentName = formatStudentFullName(
      {
        studentName: rowDoc.studentName ?? matchedStudent?.studentName,
        name: rowDoc.name ?? matchedStudent?.studentName,
        schoolId,
      },
      schoolId,
    );
    const normalizedStatus = normalizeLowerLookupText(status);

    candidates.push({
      uid,
      schoolId,
      priority: 2,
      sortMs: toMillis(
        rowDoc.updatedAt ||
          rowDoc.createdAt ||
          rowDoc.timestamp ||
          rowDoc.timeInIso ||
          rowDoc.timeOutIso,
      ),
      row: {
        schoolId,
        studentName,
        course: String(rowDoc.course ?? matchedStudent?.course ?? "").trim() || "-",
        year:
          String(
            rowDoc.yearLevel ?? rowDoc.year ?? matchedStudent?.year ?? "",
          ).trim() || "-",
        attendanceStatus: normalizedStatus === "timed in" ? "Timed In" : "Present",
        attendanceTimeIn: timeInValue,
        attendanceTimeOut: timeOutValue,
      },
    });
  });

  return candidates;
}

function attendanceExportRowsFromCollection(
  collection: AttendanceExportCandidateCollection,
) {
  return sortAttendanceExportRows(
    Array.from(collection.rowsByKey.values()).map((candidate) => candidate.row),
  );
}

function hasAttendanceTimeValue(value: string) {
  const normalized = String(value ?? "").trim();
  return normalized !== "" && normalized !== "-";
}

function normalizeAttendanceParticipantStatus(
  row: EventParticipantRow,
): AttendanceParticipantStatus {
  const normalizedStatus = normalizeLowerLookupText(row.attendanceStatus);
  const hasTimeIn = hasAttendanceTimeValue(row.attendanceTimeIn);
  const hasTimeOut = hasAttendanceTimeValue(row.attendanceTimeOut);

  if (normalizedStatus === "timed in") {
    return "Timed In";
  }

  if (isPresentAttendanceStatus(row.attendanceStatus)) {
    return "Present";
  }

  if (
    hasTimeIn &&
    !hasTimeOut &&
    normalizedStatus !== "absent" &&
    normalizedStatus !== "missed"
  ) {
    return "Timed In";
  }

  if (normalizedStatus === "absent" || normalizedStatus === "missed") {
    return "Absent";
  }

  if (hasTimeIn && hasTimeOut) {
    return "Present";
  }

  return "Absent";
}

function attendanceParticipantStatusRank(status: AttendanceParticipantStatus) {
  if (status === "Present") return 0;
  if (status === "Timed In") return 1;
  return 2;
}

function countAttendanceParticipantCompleteness(row: AttendanceParticipantRow) {
  const values = [
    row.schoolId,
    row.fullName,
    row.course,
    row.yearLevel,
    row.timeIn,
    row.timeOut,
  ];

  return values.filter((value) => hasAttendanceTimeValue(value)).length;
}

function shouldReplaceAttendanceParticipantRow(
  existing: AttendanceParticipantRow,
  next: AttendanceParticipantRow,
) {
  const existingStatusRank = attendanceParticipantStatusRank(
    existing.attendanceStatus,
  );
  const nextStatusRank = attendanceParticipantStatusRank(next.attendanceStatus);

  if (nextStatusRank !== existingStatusRank) {
    return nextStatusRank < existingStatusRank;
  }

  if (next.sortMs !== existing.sortMs) {
    return next.sortMs > existing.sortMs;
  }

  return (
    countAttendanceParticipantCompleteness(next) >=
    countAttendanceParticipantCompleteness(existing)
  );
}

function toAttendanceParticipantRow(
  row: EventParticipantRow,
): AttendanceParticipantRow {
  const schoolId = String(row.schoolId ?? "").trim() || row.uid;
  const fullName = String(row.studentName ?? "").trim() || schoolId;
  const yearLevel = String(row.year ?? "").trim() || "-";
  const timeIn = String(row.attendanceTimeIn ?? "").trim() || "-";
  const timeOut = String(row.attendanceTimeOut ?? "").trim() || "-";

  return {
    studentId: row.uid,
    uid: row.uid,
    schoolId,
    fullName,
    studentName: fullName,
    course: String(row.course ?? "").trim() || "-",
    yearLevel,
    year: yearLevel,
    attendanceStatus: normalizeAttendanceParticipantStatus(row),
    timeIn,
    timeOut,
    attendanceTimeIn: timeIn,
    attendanceTimeOut: timeOut,
    sortMs: row.sortMs,
  };
}

function attendanceParticipantIdentityKey(uid: string, schoolId: string) {
  const normalizedSchoolId = normalizeAttendanceExportIdentityValue(schoolId);
  if (normalizedSchoolId) {
    return `school:${normalizedSchoolId}`;
  }

  const normalizedUid = normalizeAttendanceExportIdentityValue(uid);
  if (normalizedUid) {
    return `uid:${normalizedUid}`;
  }

  return "";
}

function sortAttendanceParticipantRows(rows: AttendanceParticipantRow[]) {
  return [...rows].sort((left, right) => {
    const byStatus =
      attendanceParticipantStatusRank(left.attendanceStatus) -
      attendanceParticipantStatusRank(right.attendanceStatus);
    if (byStatus !== 0) return byStatus;

    const byName = left.fullName.localeCompare(right.fullName);
    if (byName !== 0) return byName;

    return left.schoolId.localeCompare(right.schoolId);
  });
}

export function buildAttendanceParticipantRows({
  event,
  attendanceRows,
  registrations = [],
  students = [],
  paymentAssignments = [],
  respectPaymentStatus = false,
}: AttendanceExportBuildOptions): AttendanceParticipantBuildResult {
  const audience = resolveRequiredEventAudience(event, students);
  const studentLookupIndexes = buildStudentLookupIndexes(students);
  const enrichedAttendanceRows = enrichAttendanceRowsWithStudentLookup(
    attendanceRows,
    studentLookupIndexes,
  );
  const participantRows = buildEventParticipantRows(
    event,
    registrations,
    enrichedAttendanceRows,
    paymentAssignments,
    audience.resolved ? audience.students : [],
    respectPaymentStatus,
  );
  const rowsByIdentity = new Map<string, AttendanceParticipantRow>();

  participantRows.forEach((row) => {
    const participant = toAttendanceParticipantRow(row);
    const key = attendanceParticipantIdentityKey(
      participant.uid,
      participant.schoolId,
    );

    if (!key) {
      return;
    }

    const existing = rowsByIdentity.get(key);
    if (!existing || shouldReplaceAttendanceParticipantRow(existing, participant)) {
      rowsByIdentity.set(key, participant);
    }
  });

  return {
    rows: sortAttendanceParticipantRows(Array.from(rowsByIdentity.values())),
    audienceResolved: audience.resolved,
  };
}

function toPresentAttendanceExportRow(
  student: AttendanceExportStudent,
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

function toAbsentAttendanceExportRow(student: AttendanceExportStudent): AttendanceExportRow {
  return {
    schoolId: student.schoolId,
    studentName: student.studentName,
    course: student.course || "-",
    year: student.year || "-",
    attendanceStatus: "Absent",
    attendanceTimeIn: "-",
    attendanceTimeOut: "-",
  };
}

function toNotPaidAttendanceExportRow(
  student: AttendanceExportStudent,
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

function toFallbackNotPaidAttendanceExportRow(
  fallbackRow: AttendanceExportRow,
  participantRow?: EventParticipantRow | null,
  student?: AttendanceExportStudent | null,
): AttendanceExportRow {
  return {
    schoolId: participantRow?.schoolId || student?.schoolId || fallbackRow.schoolId,
    studentName:
      participantRow?.studentName || student?.studentName || fallbackRow.studentName,
    course: participantRow?.course || student?.course || fallbackRow.course || "-",
    year: participantRow?.year || student?.year || fallbackRow.year || "-",
    attendanceStatus: "Not Paid",
    attendanceTimeIn: "",
    attendanceTimeOut: "",
  };
}

export function buildAttendanceExportRows({
  event,
  attendanceRows,
  registrations = [],
  students = [],
  paymentAssignments = [],
  respectPaymentStatus = true,
}: AttendanceExportBuildOptions): AttendanceExportBuildResult {
  const audience = resolveRequiredEventAudience(event, students);
  const studentLookupIndexes = buildStudentLookupIndexes(students);
  const enrichedAttendanceRows = enrichAttendanceRowsWithStudentLookup(
    attendanceRows,
    studentLookupIndexes,
  );
  const participantRows = buildEventParticipantRows(
    event,
    registrations,
    enrichedAttendanceRows,
    paymentAssignments,
    audience.resolved ? audience.students : [],
    respectPaymentStatus,
  );
  const participantRowsByUid = new Map<string, EventParticipantRow>();
  const participantRowsBySchoolId = new Map<string, EventParticipantRow>();
  const {
    byUid: paymentAssignmentsByUid,
    bySchoolId: paymentAssignmentsBySchoolId,
  } = buildPaymentAssignmentIndexes(paymentAssignments);

  participantRows.forEach((row) => {
    participantRowsByUid.set(row.uid, row);
    const schoolId = String(row.schoolId ?? "").trim();
    if (schoolId) {
      participantRowsBySchoolId.set(schoolId, row);
    }
  });

  const directPresentCandidates = buildPresentAttendanceExportCandidates(
    enrichedAttendanceRows,
    studentLookupIndexes,
  );
  const presentRowCollection = createAttendanceExportCandidateCollection();
  const absentRowCollection = createAttendanceExportCandidateCollection();
  const notPaidRowCollection = createAttendanceExportCandidateCollection();

  directPresentCandidates.forEach((candidate) => {
    const participantRow = resolveParticipantRowByIdentity(
      participantRowsByUid,
      participantRowsBySchoolId,
      candidate.uid,
      candidate.schoolId,
    );
    const matchedStudent = resolveStudentLookupByIdentity(
      studentLookupIndexes,
      candidate.uid,
      candidate.schoolId,
    );
    const resolvedUid = participantRow?.uid || matchedStudent?.uid || candidate.uid;
    const resolvedSchoolId =
      participantRow?.schoolId || matchedStudent?.schoolId || candidate.schoolId;
    const paymentStatus = getPaymentStatusByStudent(
      event,
      paymentAssignmentsByUid,
      paymentAssignmentsBySchoolId,
      resolvedUid,
      resolvedSchoolId,
      respectPaymentStatus,
    );

    if (paymentStatus === "Not Paid") {
      addAttendanceExportCandidate(notPaidRowCollection, {
        uid: resolvedUid,
        schoolId: resolvedSchoolId,
        priority: 3,
        sortMs: Math.max(candidate.sortMs, participantRow?.sortMs ?? 0),
        row: toFallbackNotPaidAttendanceExportRow(
          candidate.row,
          participantRow,
          matchedStudent,
        ),
      });
      return;
    }

    addAttendanceExportCandidate(presentRowCollection, {
      ...candidate,
      uid: resolvedUid,
      schoolId: resolvedSchoolId,
      row: {
        ...candidate.row,
        schoolId: resolvedSchoolId,
        studentName:
          participantRow?.studentName ||
          matchedStudent?.studentName ||
          candidate.row.studentName,
        course:
          participantRow?.course ||
          matchedStudent?.course ||
          candidate.row.course ||
          "-",
        year:
          participantRow?.year || matchedStudent?.year || candidate.row.year || "-",
      },
    });
  });

  if (audience.resolved) {
    audience.students.forEach((student) => {
      const participantRow = resolveParticipantRowByIdentity(
        participantRowsByUid,
        participantRowsBySchoolId,
        student.uid,
        student.schoolId,
      );
      const resolvedUid = participantRow?.uid || student.uid;
      const resolvedSchoolId = participantRow?.schoolId || student.schoolId;

      if (
        hasAttendanceExportCandidateIdentity(
          presentRowCollection,
          resolvedUid,
          resolvedSchoolId,
        ) ||
        hasAttendanceExportCandidateIdentity(
          notPaidRowCollection,
          resolvedUid,
          resolvedSchoolId,
        )
      ) {
        return;
      }

      if (
        participantRow?.attendanceStatus === "Not Paid" ||
        participantRow?.paymentStatus === "Not Paid"
      ) {
        addAttendanceExportCandidate(notPaidRowCollection, {
          uid: resolvedUid,
          schoolId: resolvedSchoolId,
          priority: 1,
          sortMs: participantRow?.sortMs ?? 0,
          row: toNotPaidAttendanceExportRow(student, participantRow),
        });
        return;
      }

      if (participantRow && isPresentAttendanceStatus(participantRow.attendanceStatus)) {
        addAttendanceExportCandidate(presentRowCollection, {
          uid: resolvedUid,
          schoolId: resolvedSchoolId,
          priority: 1,
          sortMs: participantRow.sortMs,
          row: toPresentAttendanceExportRow(student, participantRow),
        });
        return;
      }

      addAttendanceExportCandidate(absentRowCollection, {
        uid: student.uid,
        schoolId: student.schoolId,
        priority: 1,
        sortMs: 0,
        row: toAbsentAttendanceExportRow(student),
      });
    });
  } else {
    participantRows
      .filter((row) => row.attendanceStatus === "Absent")
      .forEach((row) => {
        if (
          hasAttendanceExportCandidateIdentity(
            presentRowCollection,
            row.uid,
            row.schoolId,
          ) ||
          hasAttendanceExportCandidateIdentity(
            notPaidRowCollection,
            row.uid,
            row.schoolId,
          )
        ) {
          return;
        }

        addAttendanceExportCandidate(absentRowCollection, {
          uid: row.uid,
          schoolId: row.schoolId,
          priority: 1,
          sortMs: row.sortMs,
          row: {
            schoolId: row.schoolId,
            studentName: row.studentName,
            course: row.course,
            year: row.year,
            attendanceStatus: "Absent",
            attendanceTimeIn: "-",
            attendanceTimeOut: "-",
          },
        });
      });

    participantRows
      .filter((row) => row.attendanceStatus === "Not Paid")
      .forEach((row) => {
        if (
          hasAttendanceExportCandidateIdentity(
            presentRowCollection,
            row.uid,
            row.schoolId,
          ) ||
          hasAttendanceExportCandidateIdentity(
            notPaidRowCollection,
            row.uid,
            row.schoolId,
          )
        ) {
          return;
        }

        addAttendanceExportCandidate(notPaidRowCollection, {
          uid: row.uid,
          schoolId: row.schoolId,
          priority: 1,
          sortMs: row.sortMs,
          row: {
            schoolId: row.schoolId,
            studentName: row.studentName,
            course: row.course,
            year: row.year,
            attendanceStatus: row.attendanceStatus,
            attendanceTimeIn: "",
            attendanceTimeOut: "",
          },
        });
      });
  }

  return {
    presentRows: attendanceExportRowsFromCollection(presentRowCollection),
    absentRows: attendanceExportRowsFromCollection(absentRowCollection),
    notPaidRows: attendanceExportRowsFromCollection(notPaidRowCollection),
    audienceResolved: audience.resolved,
  };
}

function stringOrDash(value: unknown) {
  return String(value ?? "").trim() || "-";
}

function buildAttendanceMetadataRows(
  event: AttendanceExportEvent,
  generatedAt: string,
  labels: { timeIn: string; timeOut: string },
) {
  return [
    ["Event Title", stringOrDash(event.title)],
    ["Date", stringOrDash(event.date)],
    [
      labels.timeIn,
      stringOrDash(event.scheduledTime || event.timeStart),
    ],
    [labels.timeOut, stringOrDash(event.timeEnd)],
    ["Location", stringOrDash(event.location)],
    ["Generated At", generatedAt],
    [],
  ];
}

function buildAttendanceSheetRows(
  event: AttendanceExportEvent,
  rows: AttendanceExportRow[],
  generatedAt: string,
  includeTimeColumns: boolean,
  labels: { timeIn: string; timeOut: string },
) {
  const metadataRows = buildAttendanceMetadataRows(event, generatedAt, labels);
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
          stringOrDash(row.schoolId),
          stringOrDash(row.studentName),
          stringOrDash(row.course),
          stringOrDash(row.year),
          stringOrDash(row.attendanceStatus),
          stringOrDash(row.attendanceTimeIn),
          stringOrDash(row.attendanceTimeOut),
        ]
      : [
          stringOrDash(row.schoolId),
          stringOrDash(row.studentName),
          stringOrDash(row.course),
          stringOrDash(row.year),
          stringOrDash(row.attendanceStatus),
        ],
  );

  return {
    data: [...metadataRows, headerRow, ...bodyRows],
    headerRowNumber: metadataRows.length + 1,
  };
}

function applyAttendanceSheetLayout(
  sheet: import("xlsx").WorkSheet,
  includeTimeColumns: boolean,
  headerRowNumber: number,
) {
  sheet["!cols"] = includeTimeColumns
    ? [
        { wch: 16 },
        { wch: 30 },
        { wch: 24 },
        { wch: 10 },
        { wch: 18 },
        { wch: 24 },
        { wch: 24 },
      ]
    : [
        { wch: 16 },
        { wch: 30 },
        { wch: 24 },
        { wch: 10 },
        { wch: 18 },
      ];

  const freezableSheet = sheet as import("xlsx").WorkSheet & {
    "!freeze"?: { xSplit: number; ySplit: number };
  };
  freezableSheet["!freeze"] = {
    xSplit: 0,
    ySplit: headerRowNumber,
  };
}

function attendanceFileSlug(event: AttendanceExportEvent) {
  const source = String(event.title ?? event.id ?? "").trim() || "attendance";
  return (
    source
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || String(event.id ?? "attendance").trim()
  );
}

export async function downloadAttendanceWorkbook(
  event: AttendanceExportEvent,
  presentRows: AttendanceExportRow[],
  {
    absentRows = [],
    notPaidRows = [],
    includeNotPaidSheet = false,
    absentSheetTimeColumns = false,
    notPaidSheetTimeColumns = false,
    metadataTimeLabels = {
      timeIn: "Scheduled Time In / Start Time",
      timeOut: "Scheduled Time Out / End Time",
    },
  }: AttendanceWorkbookDownloadOptions = {},
) {
  const generatedAt = new Date().toLocaleString();
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const presentSheetRows = buildAttendanceSheetRows(
    event,
    presentRows,
    generatedAt,
    true,
    metadataTimeLabels,
  );
  const absentSheetRows = buildAttendanceSheetRows(
    event,
    absentRows,
    generatedAt,
    absentSheetTimeColumns,
    metadataTimeLabels,
  );
  const presentSheet = XLSX.utils.aoa_to_sheet(presentSheetRows.data);
  const absentsSheet = XLSX.utils.aoa_to_sheet(absentSheetRows.data);

  applyAttendanceSheetLayout(presentSheet, true, presentSheetRows.headerRowNumber);
  applyAttendanceSheetLayout(
    absentsSheet,
    absentSheetTimeColumns,
    absentSheetRows.headerRowNumber,
  );

  XLSX.utils.book_append_sheet(workbook, presentSheet, "Present");
  XLSX.utils.book_append_sheet(workbook, absentsSheet, "Absents");

  if (includeNotPaidSheet) {
    const notPaidSheetRows = buildAttendanceSheetRows(
      event,
      notPaidRows,
      generatedAt,
      notPaidSheetTimeColumns,
      metadataTimeLabels,
    );
    const notPaidSheet = XLSX.utils.aoa_to_sheet(notPaidSheetRows.data);
    applyAttendanceSheetLayout(
      notPaidSheet,
      notPaidSheetTimeColumns,
      notPaidSheetRows.headerRowNumber,
    );
    XLSX.utils.book_append_sheet(workbook, notPaidSheet, "Not Paid");
  }

  XLSX.writeFile(workbook, `${attendanceFileSlug(event)}-attendance.xlsx`);
}
