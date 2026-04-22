"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { FiChevronDown, FiPlus } from "react-icons/fi";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from "@heroui/dropdown";
import { Input } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import { Tab, Tabs } from "@heroui/tabs";
import {
  BookMarked,
  BookOpenText,
  Fingerprint,
  GraduationCap,
  ShieldCheck,
  UserRoundSearch,
  Users,
} from "lucide-react";
import {
  CampusCardListSkeleton,
  type CampusTableColumn,
} from "@/components/ui";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import {
  ECDataTable,
  ECEmptyState,
  ECFilterBar,
  ECPageHeader,
  ECStatsGrid,
  type ECStatItem,
  FingerprintEnrollmentManager,
  useECPageErrorToast,
  useIsBelowBreakpoint,
} from "@/components/ecmember";
import { auth, db } from "@/lib/firebase";
import type { CampusProfileDoc } from "@/lib/campus-auth";
import {
  type CampusNormalizedRole,
  normalizeCampusUserRow,
  type CampusUserProfileSource,
  type CampusUserProjectionSource,
} from "@/lib/campus-user-rows";
import {
  canManageStudentActions,
  canViewStudentLookupRow,
  getCourseScope,
  isBOD,
} from "@/lib/ec-permissions";
import { normalizeCourse } from "@/lib/courseOptions";
import {
  createCampusStudent,
  ecListStudents,
  type EcListStudentItem,
  listCampusPayments,
  logPermissionDeniedAttemptForCurrentUser,
  updateCampusStudentProfile,
  updateStudentAccountStatus,
  updateStudentClearanceStatus,
} from "@/lib/firebase-functions";
import {
  hasStudentIdentityProfile,
  isStudentAudienceProfile,
} from "@/lib/student-audience";
import { campusToast } from "@/lib/toast";
import { formatStudentFullName } from "@/lib/student-name";

type StudentAccountStatus = "Active" | "Inactive";
type StudentFingerprintStatus = "Active" | "Inactive";

type Student = {
  uid: string;
  role: CampusNormalizedRole;
  rawRole: string;
  isStudent: boolean;
  isBod: boolean;
  ecPosition: string;
  assignedCourse: string | null;
  courseScope: string | null;
  id: string;
  studentId: string;
  name: string;
  rawName: string;
  fullName: string;
  studentName: string;
  course: string;
  year: string;
  yearLevel: string;
  status: StudentAccountStatus;
  fingerprintStatus: StudentFingerprintStatus;
  readyForClearance: boolean;
  email?: string;
  createdAt?: unknown;
};

type ViewerProfile = CampusProfileDoc & {
  uid: string;
};

type AttendanceStatus = "Attended" | "Missed";

type StudentStatusEvent = {
  id: string;
  title: string;
  date: string;
  scheduledTime: string;
  location: string;
  eventDate: Date | null;
  status: AttendanceStatus;
};

type StudentStatusPayment = {
  paymentId: string;
  title: string;
  ref: string;
  date: string;
  status: "PAID" | "UNPAID";
  updatedAtMs: number;
};

type StudentStatusTab = "attended" | "missed" | "payments";

type PaymentSortMode = "paid" | "unpaid";

type RawEventDoc = {
  id: string;
  title: string;
  date: string;
  scheduledTime: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  yearLevel: string;
  course: string;
  yearLevels: string[];
  courses: string[];
  targetStudent: string;
  details: string;
};

type PaymentDocData = {
  title?: string;
  ref?: string;
  date?: string;
};

type PaymentAssignmentData = {
  status?: string;
  createdAt?: { toMillis?: () => number };
  updatedAt?: { toMillis?: () => number };
};

type AttendanceDocData = {
  status?: string;
  attendanceStatus?: string;
};

type Notice = {
  type: "ok" | "warn" | "err";
  msg: string;
};

type SelectOption = {
  key: string;
  label: string;
};

type RemoteStudent = EcListStudentItem;

type StudentDirectoryProjection = {
  uid?: string;
  role?: string;
  isStudent?: boolean;
  isBod?: boolean;
  studentId?: string;
  schoolId?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  name?: string;
  studentName?: string;
  ecPosition?: string | null;
  assignedCourse?: string | null;
  courseScope?: string | null;
  course?: string;
  year?: string;
  yearLevel?: string;
  status?: string;
  readyForClearance?: boolean;
  fingerprintStatus?: string;
  fingerprintTemplateId?: number | string;
  templateId?: number | string;
};

type StudentPatch = Partial<Omit<Student, "uid">>;

const DEFAULT_COURSES = [
  "Computer Engineering",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Industrial Engineering",
  "Electronics Engineering",
];

const DEFAULT_YEARS = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
  "5th Year",
];
const STUDENT_SUMMARY_CARD_CONFIG = [
  {
    label: "Mechanical",
    course: "Mechanical Engineering",
    tone: "amber" as const,
    icon: BookMarked,
  },
  {
    label: "Electrical",
    course: "Electrical Engineering",
    tone: "green" as const,
    icon: ShieldCheck,
  },
  {
    label: "Electronics",
    course: "Electronics Engineering",
    tone: "purple" as const,
    icon: Fingerprint,
  },
  {
    label: "Computer",
    course: "Computer Engineering",
    tone: "blue" as const,
    icon: BookOpenText,
  },
  {
    label: "Industrial",
    course: "Industrial Engineering",
    tone: "slate" as const,
    icon: GraduationCap,
  },
] as const;
const BOD_SCOPE_MISSING_ERROR = "Course scope missing for B.O.D account";
const STUDENTS_PER_PAGE_DESKTOP = 10;
const STUDENTS_PER_PAGE_PHONE = 5;
const PHONE_BREAKPOINT_PX = 768;
const STATUS_ITEMS_PER_PAGE = 4;

const studentColumns: CampusTableColumn<Student>[] = [
  { key: "name", label: "Name" },
  { key: "id", label: "Student ID" },
  { key: "course", label: "Course" },
  { key: "year", label: "Year Level" },
  { key: "status", label: "Status" },
  { key: "actions", label: "Actions", align: "end", className: "text-right" },
];

function initialsFromName(name: string) {
  const parts = name
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);

  if (parts.length === 0) return "ST";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function toMillis(value: unknown) {
  if (typeof value === "object" && value !== null) {
    const maybe = value as { toMillis?: () => number; seconds?: number };
    if (typeof maybe.toMillis === "function") return maybe.toMillis();
    if (typeof maybe.seconds === "number") return maybe.seconds * 1000;
  }

  if (!value) return 0;
  const parsed = new Date(value as string | number | Date).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseDateOnly(input: string): Date | null {
  const value = String(input ?? "").trim();
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTime12ToMinutes(timeValue: string): number | null {
  const value = String(timeValue ?? "").trim();
  if (!value) return null;

  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;

  return hour * 60 + minute;
}

function toDateWithMinutes(baseDate: Date, minutes: number) {
  const date = new Date(baseDate);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function computeLifecycle(
  date: string,
  scheduledTime: string,
  timeEnd: string,
) {
  const baseDate = parseDateOnly(date);
  if (!baseDate) return "upcoming" as const;

  const now = new Date();
  const startMin = parseTime12ToMinutes(scheduledTime);
  const endMin = parseTime12ToMinutes(timeEnd);

  if (startMin == null) {
    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(baseDate);
    end.setHours(23, 59, 59, 999);

    if (now < start) return "upcoming" as const;
    if (now > end) return "completed" as const;
    return "ongoing" as const;
  }

  const start = toDateWithMinutes(baseDate, startMin);
  if (endMin == null) {
    if (now < start) return "upcoming" as const;
    return "completed" as const;
  }

  const safeEndMin = endMin >= startMin ? endMin : startMin + 60;
  const end = toDateWithMinutes(baseDate, safeEndMin);

  if (now < start) return "upcoming" as const;
  if (now > end) return "completed" as const;
  return "ongoing" as const;
}

function toEventDate(date: string, scheduledTime: string) {
  const baseDate = parseDateOnly(date);
  if (!baseDate) return null;

  const startMin = parseTime12ToMinutes(scheduledTime);
  if (startMin == null) return baseDate;

  return toDateWithMinutes(baseDate, startMin);
}

function toTargetList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  const raw = String(value ?? "").trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesTarget(
  eventValue: unknown,
  studentValue: string,
  allLabel: string,
) {
  const eventTargets = toTargetList(eventValue);
  const studentTarget = String(studentValue ?? "").trim();

  if (eventTargets.length === 0) return true;
  if (
    eventTargets.some((item) => normalizeText(item) === normalizeText(allLabel))
  )
    return true;
  return eventTargets.some(
    (item) => normalizeText(item) === normalizeText(studentTarget),
  );
}

function matchesSpecificStudentTarget(
  targetValue: string,
  schoolId: string,
  studentName: string,
) {
  const rawTarget = String(targetValue ?? "").trim();
  if (!rawTarget) return true;

  const sid = normalizeText(schoolId);
  const name = normalizeText(studentName);
  if (!sid && !name) return false;

  const parts = rawTarget
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts.length ? parts : [rawTarget]) {
    const normalized = normalizeText(part);
    const withoutParens = normalizeText(part.replace(/\([^)]*\)/g, " ").trim());
    const parenMatch = part.match(/\(([^)]+)\)/);
    const insideParen = normalizeText(parenMatch?.[1] ?? "");

    if (normalized === sid || normalized === name) return true;
    if (insideParen && insideParen === sid) return true;
    if (
      withoutParens &&
      (withoutParens === name ||
        name.includes(withoutParens) ||
        withoutParens.includes(name))
    ) {
      return true;
    }

    if (sid && normalized.includes(sid)) return true;
    if (name && normalized.includes(name)) return true;

    if (normalized.length >= 3) {
      if (sid && sid.includes(normalized)) return true;
      if (name && name.includes(normalized)) return true;
    }
  }

  return false;
}

function normalizeStudentAccountStatus(raw: unknown): StudentAccountStatus {
  return normalizeText(raw) === "inactive" ? "Inactive" : "Active";
}

function normalizeReadyForClearance(raw: unknown) {
  return raw === true;
}

function trimValue(value: unknown) {
  return String(value ?? "").trim();
}

function toPositiveNumber(raw: unknown) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function getFingerprintStatus(
  raw: StudentDirectoryProjection | null | undefined,
): StudentFingerprintStatus {
  const fingerprintState = normalizeText(raw?.fingerprintStatus);
  const templateId = toPositiveNumber(
    raw?.fingerprintTemplateId ?? raw?.templateId,
  );

  return fingerprintState === "enrolled" ||
    fingerprintState === "active" ||
    templateId > 0
    ? "Active"
    : "Inactive";
}

function mapNormalizedRowToStudent(
  row: ReturnType<typeof normalizeCampusUserRow>,
  data: RemoteStudent,
  projection?: StudentDirectoryProjection,
): Student {
  const rawRole = trimValue(data.role) || row.rawRole;
  const fullName =
    trimValue(data.fullName) ||
    trimValue(projection?.fullName) ||
    row.fullName;
  const studentName =
    trimValue(data.studentName) ||
    trimValue(projection?.studentName) ||
    trimValue(data.name) ||
    trimValue(projection?.name) ||
    fullName;

  return {
    uid: row.uid,
    role: row.role,
    rawRole,
    isStudent: row.isStudent,
    isBod: row.isBod,
    ecPosition: row.ecPosition,
    assignedCourse: row.assignedCourse,
    courseScope: row.courseScope,
    id: row.schoolId,
    studentId: row.studentId,
    name: row.fullName,
    rawName: row.rawFullName,
    fullName,
    studentName,
    course: row.course,
    year: row.yearLevel,
    yearLevel: row.yearLevel,
    status: row.accountStatus,
    fingerprintStatus: row.fingerprintStatus,
    readyForClearance: row.clearanceReady,
    email: row.email || undefined,
    createdAt: row.createdAt,
  };
}

function mapRemoteStudent(
  data: RemoteStudent,
  projection?: StudentDirectoryProjection,
): Student {
  const uid = String(data.uid ?? "").trim();
  const normalizedProjection = {
    uid,
    role: projection?.role,
    isStudent: projection?.isStudent ?? data.isStudent,
    isBod: projection?.isBod ?? data.isBod,
    studentId: projection?.studentId ?? data.studentId,
    schoolId: projection?.schoolId ?? data.schoolId,
    firstName: projection?.firstName ?? data.firstName,
    lastName: projection?.lastName ?? data.lastName,
    fullName: projection?.fullName ?? data.fullName,
    name: projection?.name ?? data.name,
    studentName: projection?.studentName ?? data.studentName,
    ecPosition: projection?.ecPosition ?? data.ecPosition,
    assignedCourse: projection?.assignedCourse ?? data.assignedCourse,
    courseScope: projection?.courseScope ?? data.courseScope,
    course: projection?.course ?? data.course,
    year: projection?.year ?? data.year,
    yearLevel: projection?.yearLevel ?? data.yearLevel,
    status: projection?.status ?? data.status,
    readyForClearance:
      projection?.readyForClearance ?? data.readyForClearance,
    fingerprintStatus:
      projection?.fingerprintStatus ?? data.fingerprintStatus,
    fingerprintTemplateId:
      projection?.fingerprintTemplateId ??
      data.fingerprintTemplateId ??
      undefined,
    templateId:
      projection?.templateId ??
      data.fingerprintTemplateId ??
      undefined,
  } satisfies CampusUserProjectionSource;
  const normalizedRow = normalizeCampusUserRow(
    uid,
    {
      uid,
      role: data.role,
      isStudent: data.isStudent,
      schoolId: data.schoolId,
      studentId: data.studentId,
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName,
      fullName: data.fullName,
      name: data.name,
      studentName: data.studentName,
      ecPosition: data.ecPosition,
      assignedCourse: data.assignedCourse,
      courseScope: data.courseScope,
      isBod: data.isBod,
      course: data.course,
      year: data.year,
      yearLevel: data.yearLevel,
      status: data.status,
      readyForClearance: data.readyForClearance,
      createdAt:
        typeof data.createdAtMs === "number" ? data.createdAtMs : undefined,
    } satisfies CampusUserProfileSource,
    normalizedProjection,
    {
      missingCourseLabel: "Unassigned",
      missingYearLevelLabel: "Unassigned",
    },
  );

  return mapNormalizedRowToStudent(normalizedRow, data, projection);
}

function applyStudentPatch(student: Student, patch: StudentPatch) {
  const patchKeys = Object.keys(patch) as Array<keyof StudentPatch>;
  if (patchKeys.length === 0) {
    return student;
  }

  const changed = patchKeys.some((key) => !Object.is(student[key], patch[key]));
  return changed ? { ...student, ...patch } : student;
}

function countStudentsByCourse(rows: Student[]) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const normalizedCourse = normalizeCourse(row.course);
    if (!normalizedCourse) {
      return counts;
    }

    counts[normalizedCourse] = (counts[normalizedCourse] ?? 0) + 1;
    return counts;
  }, {});
}

function getIncludedRoles(rows: Student[]) {
  return Array.from(
    new Set(
      rows.map((row) => row.role || row.rawRole || "unknown"),
    ),
  ).sort();
}

function buildStudentSearchHaystack(student: Student) {
  return [
    student.name,
    student.rawName,
    student.fullName,
    student.studentName,
    student.id,
    student.studentId,
    student.email,
    student.course,
    student.year,
    student.yearLevel,
    student.role,
    student.rawRole,
    student.ecPosition,
  ]
    .map((value) => trimValue(value).toLowerCase())
    .filter(Boolean)
    .join(" ");
}

function logStudentLookupDebug(
  event: string,
  payload: Record<string, unknown>,
) {
  console.info(`[ecmember/students] ${event}`, payload);
}

function toErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { code?: unknown; message?: unknown };
    const message =
      typeof maybe.message === "string" ? maybe.message : fallback;
    if (typeof maybe.code === "string" && maybe.code) {
      return `${maybe.code}: ${message}`;
    }
    return message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function toScopedStudentErrorMessage(
  error: unknown,
  fallback: string,
  viewerCourseScope: string | null,
  viewerIsBod: boolean,
) {
  if (!viewerIsBod) {
    return toErrorMessage(error, fallback);
  }

  if (!viewerCourseScope) {
    return "B.O.D course scope is missing. Ask admin to update your account.";
  }

  const message = toErrorMessage(error, fallback);
  const lowered = message.toLowerCase();
  if (
    lowered.includes("permission-denied") ||
    lowered.includes("missing or insufficient permissions")
  ) {
    return `This B.O.D account can only manage student-identity rows under ${viewerCourseScope}.`;
  }

  return message;
}

async function logStudentPermissionDeniedAttempt(
  action: string,
  targetId: string,
  error: unknown,
) {
  const message = toErrorMessage(error, "");
  if (!message.toLowerCase().includes("permission-denied")) {
    return;
  }

  try {
    await logPermissionDeniedAttemptForCurrentUser({
      action,
      targetType: "student",
      targetId,
      reason: message,
    });
  } catch {
    // Audit logging should not block the user-facing failure state.
  }
}

function toEditableFieldValue(value: unknown) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized === "-" || normalized === "Unassigned") {
    return "";
  }
  return normalized;
}

function formatEventDate(date: Date | null, fallback: string) {
  if (!date) return fallback || "No date";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ECStudentLookup() {
  const isCompactViewport = useIsBelowBreakpoint(1024);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(null);
  const [viewerProfileReady, setViewerProfileReady] = useState(false);

  const [queryText, setQueryText] = useState<string>("");
  const [courseFilter, setCourseFilter] = useState<string>("");
  const [yearFilter, setYearFilter] = useState<string>("");
  const [studentPage, setStudentPage] = useState(1);
  const [studentsPerPage, setStudentsPerPage] = useState<number>(
    STUDENTS_PER_PAGE_DESKTOP,
  );

  const [showAddForm, setShowAddForm] = useState(false);
  const [newSchoolId, setNewSchoolId] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [newYear, setNewYear] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);

  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [statusModalOpen, setStatusModalOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [editProfileModalOpen, setEditProfileModalOpen] = useState(false);
  const [editProfileName, setEditProfileName] = useState("");
  const [editProfileSchoolId, setEditProfileSchoolId] = useState("");
  const [editProfileCourse, setEditProfileCourse] = useState("");
  const [editProfileYearLevel, setEditProfileYearLevel] = useState("");
  const [updatingStudentUid, setUpdatingStudentUid] = useState<string | null>(
    null,
  );
  const [markingClearanceStudentUid, setMarkingClearanceStudentUid] = useState<
    string | null
  >(null);
  const [savingProfileUid, setSavingProfileUid] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<Notice | null>(null);
  const [statusTab, setStatusTab] = useState<StudentStatusTab>("attended");
  const [attendedSearch, setAttendedSearch] = useState("");
  const [missedSearch, setMissedSearch] = useState("");
  const [paymentsSearch, setPaymentsSearch] = useState("");
  const [attendedPage, setAttendedPage] = useState(1);
  const [missedPage, setMissedPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentSortMode, setPaymentSortMode] =
    useState<PaymentSortMode>("paid");
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusEvents, setStatusEvents] = useState<StudentStatusEvent[]>([]);
  const [statusPayments, setStatusPayments] = useState<StudentStatusPayment[]>(
    [],
  );

  const viewerIsBod = useMemo(
    () => isBOD(viewerProfile),
    [viewerProfile],
  );
  const viewerCourseScope = useMemo(
    () => getCourseScope(viewerProfile),
    [viewerProfile],
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setViewerProfile(null);
        setViewerProfileReady(true);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "profiles", user.uid));
        if (!snap.exists()) {
          setViewerProfile({ uid: user.uid });
          return;
        }

        setViewerProfile({
          uid: user.uid,
          ...(snap.data() as CampusProfileDoc),
        });
      } catch {
        setViewerProfile({ uid: user.uid });
      } finally {
        setViewerProfileReady(true);
      }
    });

    return () => unsub();
  }, []);

  const loadStudents = useCallback(async () => {
    if (!viewerProfileReady) {
      return;
    }

    if (viewerIsBod && !viewerCourseScope) {
      setStudents([]);
      setLoading(false);
      setLoadError(BOD_SCOPE_MISSING_ERROR);
      return;
    }

    setLoading(true);
    setLoadError(null);

    try {
      const rawCallableRows = await ecListStudents({
        limit: 2000,
        includeEcMembers: true,
      });

      const projectionByUid = new Map<string, StudentDirectoryProjection>();
      try {
        const projectionRef =
          viewerIsBod && viewerCourseScope
            ? query(
                collection(db, "students"),
                where("course", "==", viewerCourseScope),
              )
            : collection(db, "students");
        const projectionSnap = await getDocs(projectionRef);
        projectionSnap.docs.forEach((snapshot) => {
          projectionByUid.set(
            snapshot.id,
            snapshot.data() as StudentDirectoryProjection,
          );
        });
      } catch {
        // Student status controls should still load even if the portable projection is unavailable.
      }

      const studentIdentityRows = rawCallableRows.filter(
        (remoteStudent) =>
          isStudentAudienceProfile(remoteStudent) &&
          hasStudentIdentityProfile(remoteStudent),
      );
      const mappedStudentRows = studentIdentityRows
        .map((remoteStudent) =>
          mapRemoteStudent(
            remoteStudent,
            projectionByUid.get(String(remoteStudent.uid ?? "").trim()),
          ),
        );
      const visibleRows = mappedStudentRows.filter((student) =>
        canViewStudentLookupRow(viewerProfile, student),
      );
      const excludedByCourseScopeCount =
        mappedStudentRows.length - visibleRows.length;

      visibleRows.sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      );
      logStudentLookupDebug("loadStudents", {
        rawCallableRowsCount: rawCallableRows.length,
        studentIdentityRowsCount: studentIdentityRows.length,
        excludedByMissingStudentIdentityCount:
          rawCallableRows.length - studentIdentityRows.length,
        excludedByCourseScopeCount,
        visibleStudentRowsCount: visibleRows.length,
        includedRoles: getIncludedRoles(visibleRows),
        courseCounts: countStudentsByCourse(visibleRows),
        sampleEcBodStudentIdentityRows: visibleRows
          .filter(
            (student) =>
              student.role === "bod" ||
              student.role === "ecmember" ||
              student.isBod,
          )
          .slice(0, 5)
          .map((student) => ({
            uid: student.uid,
            role: student.role,
            rawRole: student.rawRole,
            isStudent: student.isStudent,
            isBod: student.isBod,
            name: student.name,
            studentId: student.studentId,
            schoolId: student.id,
            course: student.course,
            yearLevel: student.yearLevel,
            ecPosition: student.ecPosition,
            assignedCourse: student.assignedCourse,
            courseScope: student.courseScope,
          })),
      });
      setStudents(visibleRows);
    } catch (error: unknown) {
      setLoadError(toErrorMessage(error, "Failed to load students."));
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, [viewerCourseScope, viewerIsBod, viewerProfile, viewerProfileReady]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

  useEffect(() => {
    if (!viewerIsBod || !viewerCourseScope) {
      return;
    }

    setCourseFilter(viewerCourseScope);
    setNewCourse(viewerCourseScope);
  }, [viewerCourseScope, viewerIsBod]);

  useEffect(() => {
    const syncStudentsPerPage = () => {
      setStudentsPerPage(
        window.innerWidth < PHONE_BREAKPOINT_PX
          ? STUDENTS_PER_PAGE_PHONE
          : STUDENTS_PER_PAGE_DESKTOP,
      );
    };

    syncStudentsPerPage();
    window.addEventListener("resize", syncStudentsPerPage);
    return () => window.removeEventListener("resize", syncStudentsPerPage);
  }, []);

  const visibleStudentRows = students;

  const courseOptions = useMemo(() => {
    if (viewerIsBod && viewerCourseScope) {
      return [viewerCourseScope];
    }

    const set = new Set(DEFAULT_COURSES);
    visibleStudentRows.forEach((s) => {
      if (s.course && s.course !== "Unassigned") set.add(s.course);
    });
    return Array.from(set);
  }, [viewerCourseScope, viewerIsBod, visibleStudentRows]);

  const yearOptions = useMemo(() => {
    const set = new Set(DEFAULT_YEARS);
    visibleStudentRows.forEach((s) => {
      if (s.year && s.year !== "Unassigned") set.add(s.year);
    });
    return Array.from(set);
  }, [visibleStudentRows]);

  const courseFilterItems = useMemo<SelectOption[]>(
    () =>
      viewerIsBod && viewerCourseScope
        ? [{ key: viewerCourseScope, label: viewerCourseScope }]
        : [
            { key: "__all_courses__", label: "All Courses" },
            ...courseOptions.map((courseName) => ({
              key: courseName,
              label: courseName,
            })),
          ],
    [courseOptions, viewerCourseScope, viewerIsBod],
  );

  const yearFilterItems = useMemo<SelectOption[]>(
    () => [
      { key: "__all_years__", label: "All Years" },
      ...yearOptions.map((yearName) => ({ key: yearName, label: yearName })),
    ],
    [yearOptions],
  );

  const addCourseItems = useMemo<SelectOption[]>(
    () =>
      viewerIsBod && viewerCourseScope
        ? [{ key: viewerCourseScope, label: viewerCourseScope }]
        : [
            { key: "__select_course__", label: "Select course" },
            ...DEFAULT_COURSES.map((courseName) => ({
              key: courseName,
              label: courseName,
            })),
          ],
    [viewerCourseScope, viewerIsBod],
  );

  const addYearItems = useMemo<SelectOption[]>(
    () => [
      { key: "__select_year__", label: "Select year" },
      ...DEFAULT_YEARS.map((yearName) => ({ key: yearName, label: yearName })),
    ],
    [],
  );

  const filteredRows = useMemo(() => {
    const search = queryText.trim().toLowerCase();

    return visibleStudentRows.filter((s) => {
      const matchQuery =
        !search || buildStudentSearchHaystack(s).includes(search);

      const matchCourse = courseFilter
        ? normalizeCourse(s.course) === normalizeCourse(courseFilter)
        : true;
      const matchYear = yearFilter ? s.yearLevel === yearFilter : true;

      return matchQuery && matchCourse && matchYear;
    });
  }, [courseFilter, queryText, visibleStudentRows, yearFilter]);

  const studentTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredRows.length / studentsPerPage)),
    [filteredRows.length, studentsPerPage],
  );

  const paginatedStudents = useMemo(() => {
    const start = (studentPage - 1) * studentsPerPage;
    return filteredRows.slice(start, start + studentsPerPage);
  }, [filteredRows, studentPage, studentsPerPage]);

  useEffect(() => {
    logStudentLookupDebug("filterStudents", {
      visibleStudentRowsCount: visibleStudentRows.length,
      filteredRowsCount: filteredRows.length,
      queryText: queryText.trim(),
      courseFilter: normalizeCourse(courseFilter) || "",
      yearFilter,
    });
  }, [courseFilter, filteredRows.length, queryText, visibleStudentRows.length, yearFilter]);

  const attendedEvents = useMemo(
    () =>
      statusEvents
        .filter((event) => event.status === "Attended")
        .sort(
          (a, b) =>
            (b.eventDate?.getTime() ?? 0) - (a.eventDate?.getTime() ?? 0),
        ),
    [statusEvents],
  );

  const missedEvents = useMemo(
    () =>
      statusEvents
        .filter((event) => event.status === "Missed")
        .sort(
          (a, b) =>
            (b.eventDate?.getTime() ?? 0) - (a.eventDate?.getTime() ?? 0),
        ),
    [statusEvents],
  );

  const filteredAttendedEvents = useMemo(() => {
    const search = attendedSearch.trim().toLowerCase();
    if (!search) return attendedEvents;
    return attendedEvents.filter((event) => {
      return (
        event.title.toLowerCase().includes(search) ||
        event.location.toLowerCase().includes(search) ||
        event.date.toLowerCase().includes(search) ||
        event.scheduledTime.toLowerCase().includes(search)
      );
    });
  }, [attendedEvents, attendedSearch]);

  const filteredMissedEvents = useMemo(() => {
    const search = missedSearch.trim().toLowerCase();
    if (!search) return missedEvents;
    return missedEvents.filter((event) => {
      return (
        event.title.toLowerCase().includes(search) ||
        event.location.toLowerCase().includes(search) ||
        event.date.toLowerCase().includes(search) ||
        event.scheduledTime.toLowerCase().includes(search)
      );
    });
  }, [missedEvents, missedSearch]);

  const filteredStatusPayments = useMemo(() => {
    const search = paymentsSearch.trim().toLowerCase();
    if (!search) return statusPayments;
    return statusPayments.filter((payment) => {
      return (
        payment.title.toLowerCase().includes(search) ||
        payment.ref.toLowerCase().includes(search) ||
        payment.date.toLowerCase().includes(search) ||
        payment.status.toLowerCase().includes(search)
      );
    });
  }, [statusPayments, paymentsSearch]);

  const sortedStatusPayments = useMemo(() => {
    const rows = [...filteredStatusPayments];
    rows.sort((a, b) => {
      if (a.status !== b.status) {
        if (paymentSortMode === "paid") return a.status === "PAID" ? -1 : 1;
        return a.status === "UNPAID" ? -1 : 1;
      }
      return b.updatedAtMs - a.updatedAtMs;
    });
    return rows;
  }, [filteredStatusPayments, paymentSortMode]);

  const paymentSortLabel = useMemo(
    () => (paymentSortMode === "paid" ? "Paid" : "Unpaid"),
    [paymentSortMode],
  );

  const attendedTotalPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(filteredAttendedEvents.length / STATUS_ITEMS_PER_PAGE),
      ),
    [filteredAttendedEvents.length],
  );

  const paginatedAttendedEvents = useMemo(() => {
    const start = (attendedPage - 1) * STATUS_ITEMS_PER_PAGE;
    return filteredAttendedEvents.slice(start, start + STATUS_ITEMS_PER_PAGE);
  }, [filteredAttendedEvents, attendedPage]);

  const missedTotalPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(filteredMissedEvents.length / STATUS_ITEMS_PER_PAGE),
      ),
    [filteredMissedEvents.length],
  );

  const paginatedMissedEvents = useMemo(() => {
    const start = (missedPage - 1) * STATUS_ITEMS_PER_PAGE;
    return filteredMissedEvents.slice(start, start + STATUS_ITEMS_PER_PAGE);
  }, [filteredMissedEvents, missedPage]);

  const paymentsTotalPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(sortedStatusPayments.length / STATUS_ITEMS_PER_PAGE),
      ),
    [sortedStatusPayments.length],
  );

  const paginatedStatusPayments = useMemo(() => {
    const start = (paymentsPage - 1) * STATUS_ITEMS_PER_PAGE;
    return sortedStatusPayments.slice(start, start + STATUS_ITEMS_PER_PAGE);
  }, [sortedStatusPayments, paymentsPage]);

  const selectedStudentUid = selectedStudent?.uid ?? "";
  const selectedStudentId = selectedStudent?.id ?? "";
  const selectedStudentName = selectedStudent?.name ?? "";
  const selectedStudentRole = selectedStudent?.role ?? "student";
  const selectedStudentCourse = selectedStudent?.course ?? "";
  const selectedStudentYear = selectedStudent?.year ?? "";
  const selectedStudentStatus = selectedStudent?.status ?? "Active";
  const selectedStudentReadyForClearance =
    selectedStudent?.readyForClearance ?? false;
  const selectedStudentHasStudentIdentity = selectedStudent
    ? hasStudentIdentityProfile(selectedStudent)
    : false;
  const selectedStudentCanManageActions = selectedStudent
    ? canManageStudentActions(viewerProfile, selectedStudent)
    : false;
  const studentActionBlockedError = viewerIsBod
    ? viewerCourseScope
      ? `This B.O.D account can only manage student-identity rows under ${viewerCourseScope}. Admin, teacher, and cross-course accounts stay read-only.`
      : "B.O.D course scope is missing. Ask admin to update your account."
    : "This student record is read-only for the current account.";

  const updateStudentState = useCallback(
    (studentUid: string, patch: StudentPatch) => {
      setStudents((prev) => {
        let changed = false;
        const next = prev.map((student) => {
          if (student.uid !== studentUid) return student;

          const patchedStudent = applyStudentPatch(student, patch);
          if (patchedStudent !== student) {
            changed = true;
          }

          return patchedStudent;
        });

        return changed ? next : prev;
      });

      setSelectedStudent((prev) => {
        if (!prev || prev.uid !== studentUid) return prev;
        return applyStudentPatch(prev, patch);
      });
    },
    [],
  );

  useEffect(() => {
    setStudentPage(1);
  }, [queryText, courseFilter, yearFilter]);

  useEffect(() => {
    setStudentPage((prev) => Math.min(Math.max(prev, 1), studentTotalPages));
  }, [studentTotalPages]);

  useEffect(() => {
    setAttendedPage(1);
  }, [attendedSearch, selectedStudent?.uid]);

  useEffect(() => {
    setMissedPage(1);
  }, [missedSearch, selectedStudent?.uid]);

  useEffect(() => {
    setPaymentsPage(1);
  }, [paymentsSearch, paymentSortMode, selectedStudent?.uid]);

  useEffect(() => {
    setAttendedPage((prev) => Math.min(Math.max(prev, 1), attendedTotalPages));
  }, [attendedTotalPages]);

  useEffect(() => {
    setMissedPage((prev) => Math.min(Math.max(prev, 1), missedTotalPages));
  }, [missedTotalPages]);

  useEffect(() => {
    setPaymentsPage((prev) => Math.min(Math.max(prev, 1), paymentsTotalPages));
  }, [paymentsTotalPages]);

  useEffect(() => {
    if (!statusModalOpen || !selectedStudentUid) return;
    const currentStudent = {
      uid: selectedStudentUid,
      id: selectedStudentId,
      name: selectedStudentName,
      course: selectedStudentCourse,
      year: selectedStudentYear,
      status: selectedStudentStatus,
      readyForClearance: selectedStudentReadyForClearance,
    };

    let active = true;

    async function loadStudentStatus() {
      setStatusLoading(true);
      setStatusError(null);

      try {
        let rawEvents: RawEventDoc[] = [];
        let paymentDocs: PaymentDocData[] = [];
        let paymentDocIds: string[] = [];

        if (viewerIsBod && viewerCourseScope) {
          const [ecEventsSnap, scopedEventsSnap, scopedPayments] =
            await Promise.all([
              getDocs(
                query(collection(db, "events"), where("ownerType", "==", "ec")),
              ),
              getDocs(
                query(
                  collection(db, "events"),
                  where("courseScope", "==", viewerCourseScope),
                ),
              ),
              listCampusPayments(),
            ]);

          const mergedEvents = new Map<string, RawEventDoc>();
          [...ecEventsSnap.docs, ...scopedEventsSnap.docs].forEach((eventDoc) => {
            const data = eventDoc.data() as Partial<RawEventDoc>;
            const yearLevels = toTargetList(data.yearLevels);
            const courses = toTargetList(data.courses);

            mergedEvents.set(eventDoc.id, {
              id: eventDoc.id,
              title: String(data.title ?? "Untitled Event"),
              date: String(data.date ?? ""),
              scheduledTime: String(data.scheduledTime ?? data.timeStart ?? ""),
              timeStart: String(data.timeStart ?? ""),
              timeEnd: String(data.timeEnd ?? ""),
              location: String(data.location ?? ""),
              yearLevel:
                String(data.yearLevel ?? "").trim() ||
                (yearLevels.length > 0 ? yearLevels.join(", ") : "All Years"),
              course:
                String(data.course ?? "").trim() ||
                (courses.length > 0 ? courses.join(", ") : "All Courses"),
              yearLevels,
              courses,
              targetStudent: String(data.targetStudent ?? ""),
              details: String(data.details ?? ""),
            });
          });

          rawEvents = Array.from(mergedEvents.values());
          paymentDocs = scopedPayments.map((payment) => ({
            title: payment.title,
            ref: payment.ref,
            date: payment.date,
          }));
          paymentDocIds = scopedPayments.map((payment) => payment.id);
        } else {
          const [eventsSnap, paymentSnap] = await Promise.all([
            getDocs(
              query(collection(db, "events"), orderBy("createdAt", "desc")),
            ),
            getDocs(
              query(collection(db, "payments"), orderBy("createdAt", "desc")),
            ),
          ]);

          rawEvents = eventsSnap.docs.map((eventDoc) => {
            const data = eventDoc.data() as Partial<RawEventDoc>;
            const yearLevels = toTargetList(data.yearLevels);
            const courses = toTargetList(data.courses);

            return {
              id: eventDoc.id,
              title: String(data.title ?? "Untitled Event"),
              date: String(data.date ?? ""),
              scheduledTime: String(data.scheduledTime ?? data.timeStart ?? ""),
              timeStart: String(data.timeStart ?? ""),
              timeEnd: String(data.timeEnd ?? ""),
              location: String(data.location ?? ""),
              yearLevel:
                String(data.yearLevel ?? "").trim() ||
                (yearLevels.length > 0 ? yearLevels.join(", ") : "All Years"),
              course:
                String(data.course ?? "").trim() ||
                (courses.length > 0 ? courses.join(", ") : "All Courses"),
              yearLevels,
              courses,
              targetStudent: String(data.targetStudent ?? ""),
              details: String(data.details ?? ""),
            };
          });
          paymentDocs = paymentSnap.docs.map(
            (paymentDoc) => paymentDoc.data() as PaymentDocData,
          );
          paymentDocIds = paymentSnap.docs.map((paymentDoc) => paymentDoc.id);
        }

        try {
          const studentProjectionSnap = await getDoc(
            doc(db, "students", currentStudent.uid),
          );
          const studentProjection = studentProjectionSnap.exists()
            ? (studentProjectionSnap.data() as StudentDirectoryProjection)
            : null;

          updateStudentState(currentStudent.uid, {
            status: normalizeStudentAccountStatus(
              studentProjection?.status ?? currentStudent.status,
            ),
            readyForClearance: normalizeReadyForClearance(
              studentProjection?.readyForClearance ??
                currentStudent.readyForClearance,
            ),
            fingerprintStatus: getFingerprintStatus(studentProjection),
          });
        } catch {
          // Keep the modal usable even if the fingerprint projection cannot be read.
        }

        const targetedEvents = rawEvents.filter((event) => {
          const courseMatch = matchesTarget(
            event.courses.length > 0 ? event.courses : event.course,
            currentStudent.course,
            "All Courses",
          );
          const yearMatch = matchesTarget(
            event.yearLevels.length > 0 ? event.yearLevels : event.yearLevel,
            currentStudent.year,
            "All Years",
          );
          const studentMatch = matchesSpecificStudentTarget(
            event.targetStudent,
            currentStudent.id,
            currentStudent.name,
          );
          return courseMatch && yearMatch && studentMatch;
        });

        const eventRows = await Promise.all(
          targetedEvents.map(
            async (event): Promise<StudentStatusEvent | null> => {
              const scheduledTime = event.scheduledTime || event.timeStart;
              const lifecycle = computeLifecycle(
                event.date,
                scheduledTime,
                event.timeEnd,
              );
              if (lifecycle !== "completed") return null;

              let attendanceData: AttendanceDocData = {};
              try {
                const attendanceSnap = await getDoc(
                  doc(db, "events", event.id, "attendance", currentStudent.uid),
                );
                attendanceData = attendanceSnap.exists()
                  ? (attendanceSnap.data() as AttendanceDocData)
                  : {};
              } catch {
                return null;
              }
              const attendanceRaw = normalizeText(
                attendanceData.status ?? attendanceData.attendanceStatus ?? "",
              );

              const status: AttendanceStatus =
                attendanceRaw === "present" || attendanceRaw === "attended"
                  ? "Attended"
                  : "Missed";

              return {
                id: event.id,
                title: event.title,
                date: event.date,
                scheduledTime: scheduledTime || "TBA",
                location: event.location || "TBA",
                eventDate: toEventDate(event.date, scheduledTime),
                status,
              };
            },
          ),
        );

        const paymentRows = await Promise.all(
          paymentDocIds.map(
            async (paymentId, index): Promise<StudentStatusPayment | null> => {
              let assignmentData: PaymentAssignmentData | null = null;
              try {
                const assignmentSnap = await getDoc(
                  doc(
                    db,
                    "payments",
                    paymentId,
                    "students",
                    currentStudent.uid,
                  ),
                );
                if (!assignmentSnap.exists()) return null;
                assignmentData = assignmentSnap.data() as PaymentAssignmentData;
              } catch {
                return null;
              }

              const paymentData = paymentDocs[index] ?? {};
              const assignmentRecord = assignmentData ?? {};
              const status =
                normalizeText(assignmentRecord.status) === "paid"
                  ? "PAID"
                  : "UNPAID";
              const createdAtMs = toMillis(assignmentRecord.createdAt);
              const updatedAtMs =
                toMillis(assignmentRecord.updatedAt) || createdAtMs;

              return {
                paymentId,
                title: String(paymentData.title ?? "Untitled Payment"),
                ref: String(paymentData.ref ?? paymentId),
                date: String(paymentData.date ?? ""),
                status,
                updatedAtMs,
              };
            },
          ),
        );

        if (!active) return;
        setStatusEvents(
          eventRows.filter((row): row is StudentStatusEvent => Boolean(row)),
        );
        setStatusPayments(
          paymentRows.filter((row): row is StudentStatusPayment =>
            Boolean(row),
          ),
        );
      } catch (error: unknown) {
        if (!active) return;
        setStatusEvents([]);
        setStatusPayments([]);
        setStatusError(toErrorMessage(error, "Failed to load student status."));
      } finally {
        if (active) setStatusLoading(false);
      }
    }

    void loadStudentStatus();

    return () => {
      active = false;
    };
  }, [
    selectedStudentUid,
    selectedStudentId,
    selectedStudentName,
    selectedStudentCourse,
    selectedStudentYear,
    selectedStudentStatus,
    selectedStudentReadyForClearance,
    statusModalOpen,
    updateStudentState,
    viewerCourseScope,
    viewerIsBod,
  ]);

  useECPageErrorToast(loadError, "student lookup");

  const summaryItems = useMemo<ECStatItem[]>(
    () => {
      const normalizedViewerCourseScope = normalizeCourse(
        viewerCourseScope ?? "",
      );
      const scopedSummaryCards =
        viewerIsBod ?
          normalizedViewerCourseScope ?
            STUDENT_SUMMARY_CARD_CONFIG.filter(
              (item) =>
                normalizeCourse(item.course) === normalizedViewerCourseScope,
            ) :
            [] :
          STUDENT_SUMMARY_CARD_CONFIG;

      return [
        {
          label: "Total Students",
          value: visibleStudentRows.length,
          description:
            viewerIsBod && !viewerCourseScope ?
              BOD_SCOPE_MISSING_ERROR :
              "Engineering roster visibility",
          tone: "blue",
          icon: Users,
        },
        ...scopedSummaryCards.map((item) => ({
          label: item.label,
          value: visibleStudentRows.filter(
            (student) =>
              normalizeCourse(student.course) === normalizeCourse(item.course),
          ).length,
          description: "Visible roster count",
          tone: item.tone,
          icon: item.icon,
        })),
      ];
    },
    [viewerCourseScope, viewerIsBod, visibleStudentRows],
  );

  const clearFilters = () => {
    setQueryText("");
    setCourseFilter(viewerIsBod && viewerCourseScope ? viewerCourseScope : "");
    setYearFilter("");
  };

  const openStudentStatusModal = (student: Student) => {
    setSelectedStudent(student);
    setStatusNotice(null);
    setStatusTab("attended");
    setAttendedSearch("");
    setMissedSearch("");
    setPaymentsSearch("");
    setAttendedPage(1);
    setMissedPage(1);
    setPaymentsPage(1);
    setPaymentSortMode("paid");
    setStatusError(null);
    setStatusModalOpen(true);
  };

  const openEditProfileModal = (student: Student) => {
    if (!canManageStudentActions(viewerProfile, student)) {
      setStatusNotice({
        type: "err",
        msg: studentActionBlockedError,
      });
      return;
    }

    setEditProfileName(student.name);
    setEditProfileSchoolId(student.id);
    setEditProfileCourse(
      viewerIsBod && viewerCourseScope
        ? viewerCourseScope
        : toEditableFieldValue(student.course),
    );
    setEditProfileYearLevel(toEditableFieldValue(student.year));
    setStatusNotice(null);
    setEditProfileModalOpen(true);
  };

  async function toggleStudentStatus(student: Student) {
    if (!student.uid) {
      setStatusNotice({
        type: "err",
        msg: "This student record is missing a UID.",
      });
      campusToast.error({
        title: "Student record incomplete",
        description: "This student record is missing a UID.",
        dedupeKey: "ec-students:missing-uid",
      });
      return;
    }

    if (!canManageStudentActions(viewerProfile, student)) {
      setStatusNotice({
        type: "err",
        msg: studentActionBlockedError,
      });
      campusToast.error({
        title: "Status update unavailable",
        description: studentActionBlockedError,
        dedupeKey: `ec-students:status-role-blocked:${student.uid}`,
      });
      return;
    }

    const nextStatus: StudentAccountStatus =
      student.status === "Active" ? "Inactive" : "Active";
    setUpdatingStudentUid(student.uid);
    setStatusNotice(null);

    try {
      const result = await updateStudentAccountStatus({
        uid: student.uid,
        status: nextStatus,
      });

      const resolvedStatus = result.status || nextStatus;
      updateStudentState(student.uid, { status: resolvedStatus });

      if (result.cleanupFailed) {
        setStatusNotice({
          type: "warn",
          msg: "Student status was updated, but cleanup had a warning.",
        });
        campusToast.warning({
          title: "Student status updated with warning",
          description: result.cleanupError
            ? `Student status was updated, but cleanup had a warning. ${result.cleanupError}`
            : "Student status was updated, but cleanup had a warning.",
          dedupeKey: `ec-students:status-warning:${student.uid}:${resolvedStatus}`,
        });
      } else {
        setStatusNotice({
          type: "ok",
          msg: `${student.name} is now ${resolvedStatus}.`,
        });
        campusToast.success({
          title: "Student status updated",
          description: `${student.name} is now ${resolvedStatus}.`,
          dedupeKey: `ec-students:status:${student.uid}:${resolvedStatus}`,
        });
      }
    } catch (error: unknown) {
      await logStudentPermissionDeniedAttempt(
        "toggle_account_status",
        student.uid,
        error,
      );
      const message = toScopedStudentErrorMessage(
        error,
        "Failed to update student status.",
        viewerCourseScope,
        viewerIsBod,
      );
      setStatusNotice({
        type: "err",
        msg: message,
      });
      campusToast.error({
        title: "Status update failed",
        description: message,
        dedupeKey: `ec-students:status-error:${student.uid}`,
      });
    } finally {
      setUpdatingStudentUid(null);
    }
  }

  async function setStudentClearanceReady(student: Student, nextReady: boolean) {
    if (!student.uid) {
      setStatusNotice({
        type: "err",
        msg: "This student record is missing a UID.",
      });
      campusToast.error({
        title: "Student record incomplete",
        description: "This student record is missing a UID.",
        dedupeKey: "ec-students:clearance:missing-uid",
      });
      return;
    }

    if (!canManageStudentActions(viewerProfile, student)) {
      setStatusNotice({
        type: "err",
        msg: studentActionBlockedError,
      });
      campusToast.error({
        title: "Clearance update unavailable",
        description: studentActionBlockedError,
        dedupeKey: `ec-students:clearance-role-blocked:${student.uid}`,
      });
      return;
    }

    if (student.readyForClearance === nextReady) {
      campusToast.info({
        title: nextReady ? "Already ready for clearance" : "Already removed",
        description: nextReady
          ? `${student.name} is already marked ready for clearance signing.`
          : `${student.name} is already removed from clearance-ready status.`,
        dedupeKey: `ec-students:clearance:no-change:${student.uid}:${nextReady}`,
      });
      return;
    }

    setMarkingClearanceStudentUid(student.uid);
    setStatusNotice(null);

    try {
      const result = await updateStudentClearanceStatus({
        uid: student.uid,
        readyForClearance: nextReady,
      });

      updateStudentState(student.uid, { readyForClearance: nextReady });

      const notificationFailed = nextReady && result.notificationSent === false;
      const successMessage = notificationFailed
        ? `${student.name} is ready for clearance signing, but the notification could not be sent.`
        : nextReady
          ? "Student marked ready for clearance."
          : "Clearance-ready status removed.";

      setStatusNotice({
        type: "ok",
        msg: successMessage,
      });

      if (notificationFailed) {
        campusToast.warning({
          title: "Ready for clearance saved",
          description:
            "The readiness update was saved, but the notification could not be sent.",
          dedupeKey: `ec-students:clearance:notification-warning:${student.uid}`,
        });
      } else {
        campusToast.success({
          title: nextReady ? "Clearance ready" : "Clearance ready removed",
          description: successMessage,
          dedupeKey: `ec-students:clearance:${student.uid}:${nextReady}`,
        });
      }
    } catch (error: unknown) {
      await logStudentPermissionDeniedAttempt(
        nextReady ? "mark_ready_for_clearance" : "remove_ready_for_clearance",
        student.uid,
        error,
      );
      const message = toScopedStudentErrorMessage(
        error,
        "Failed to mark this student ready for clearance.",
        viewerCourseScope,
        viewerIsBod,
      );
      setStatusNotice({
        type: "err",
        msg: message,
      });
      campusToast.error({
        title: "Clearance update failed",
        description: message,
        dedupeKey: `ec-students:clearance-error:${student.uid}`,
      });
    } finally {
      setMarkingClearanceStudentUid(null);
    }
  }

  async function saveStudentProfileChanges() {
    if (!selectedStudent?.uid) {
      campusToast.error({
        title: "Profile unavailable",
        description: "Select a student record before editing the profile.",
        dedupeKey: "ec-students:edit-profile:no-student",
      });
      return;
    }

    if (!selectedStudentCanManageActions) {
      campusToast.error({
        title: "Profile update unavailable",
        description: studentActionBlockedError,
        dedupeKey: "ec-students:edit-profile:role-blocked",
      });
      return;
    }

    const submittedName = editProfileName.trim();
    const schoolId = editProfileSchoolId.trim();
    const course = viewerIsBod && viewerCourseScope
      ? viewerCourseScope
      : editProfileCourse.trim();
    const yearLevel = editProfileYearLevel.trim();
    const allowsBlankAcademicFields =
      selectedStudentRole === "teacher" &&
      !selectedStudentHasStudentIdentity;
    const originalRawName = String(selectedStudent.rawName ?? "").trim();
    const originalDisplayName = formatStudentFullName(
      {
        name: originalRawName,
        schoolId: selectedStudent.id,
      },
      selectedStudent.id,
    );
    const name =
      submittedName === originalDisplayName && originalRawName
        ? originalRawName
        : submittedName;

    if (!submittedName) {
      campusToast.warning({
        title: "Missing name",
        description: "Name is required before you can save this profile.",
        dedupeKey: "ec-students:edit-profile:missing-name",
      });
      return;
    }

    if (!schoolId) {
      campusToast.warning({
        title: "Missing school ID",
        description: "School ID is required before you can save this profile.",
        dedupeKey: "ec-students:edit-profile:missing-school-id",
      });
      return;
    }

    if (!allowsBlankAcademicFields && !course) {
      campusToast.warning({
        title: "Missing course",
        description: "Course is required for student and EC member profiles.",
        dedupeKey: "ec-students:edit-profile:missing-course",
      });
      return;
    }

    if (!allowsBlankAcademicFields && !yearLevel) {
      campusToast.warning({
        title: "Missing year level",
        description: "Year level is required for student and EC member profiles.",
        dedupeKey: "ec-students:edit-profile:missing-year",
      });
      return;
    }

    setSavingProfileUid(selectedStudent.uid);
    setStatusNotice(null);

    try {
      const result = await updateCampusStudentProfile({
        uid: selectedStudent.uid,
        name,
        schoolId,
        course,
        yearLevel,
      });

      const updatedStudent = mapRemoteStudent(
        {
          uid: result.uid,
          role: selectedStudentRole,
          isStudent: selectedStudent.isStudent,
          isBod: selectedStudent.isBod,
          schoolId: result.schoolId,
          studentId: selectedStudent.studentId,
          fullName: result.name,
          name: result.name,
          studentName: result.name,
          ecPosition: selectedStudent.ecPosition,
          assignedCourse: selectedStudent.assignedCourse,
          courseScope: selectedStudent.courseScope,
          course: result.course,
          yearLevel: result.yearLevel,
          status: selectedStudent.status,
          readyForClearance: selectedStudent.readyForClearance,
          fingerprintStatus:
            selectedStudent.fingerprintStatus === "Active"
              ? "active"
              : "inactive",
          email: selectedStudent.email,
          createdAtMs:
            typeof selectedStudent.createdAt === "number"
              ? selectedStudent.createdAt
              : null,
        },
        {
          role: selectedStudent.rawRole,
          isStudent: selectedStudent.isStudent,
          isBod: selectedStudent.isBod,
          studentId: selectedStudent.studentId,
          schoolId: result.schoolId,
          fullName: result.name,
          name: result.name,
          studentName: result.name,
          ecPosition: selectedStudent.ecPosition,
          assignedCourse: selectedStudent.assignedCourse,
          courseScope: selectedStudent.courseScope,
          course: result.course,
          yearLevel: result.yearLevel,
          status: selectedStudent.status,
          readyForClearance: selectedStudent.readyForClearance,
          fingerprintStatus:
            selectedStudent.fingerprintStatus === "Active"
              ? "active"
              : "inactive",
        },
      );

      updateStudentState(selectedStudent.uid, {
        rawRole: updatedStudent.rawRole,
        isStudent: updatedStudent.isStudent,
        isBod: updatedStudent.isBod,
        ecPosition: updatedStudent.ecPosition,
        assignedCourse: updatedStudent.assignedCourse,
        courseScope: updatedStudent.courseScope,
        id: updatedStudent.id,
        studentId: updatedStudent.studentId,
        name: updatedStudent.name,
        rawName: updatedStudent.rawName,
        fullName: updatedStudent.fullName,
        studentName: updatedStudent.studentName,
        course: updatedStudent.course,
        year: updatedStudent.year,
        yearLevel: updatedStudent.yearLevel,
        email: updatedStudent.email,
        role: updatedStudent.role,
      });

      setEditProfileModalOpen(false);
      setStatusNotice({
        type: "ok",
        msg: `${updatedStudent.name} profile updated successfully.`,
      });
      campusToast.success({
        title: "Profile updated",
        description: `${updatedStudent.name} now shows ${updatedStudent.id} in the roster.`,
        dedupeKey: `ec-students:edit-profile:${selectedStudent.uid}`,
      });
    } catch (error: unknown) {
      await logStudentPermissionDeniedAttempt(
        "edit_student_profile",
        selectedStudent.uid,
        error,
      );
      const message = toScopedStudentErrorMessage(
        error,
        "Failed to save profile changes.",
        viewerCourseScope,
        viewerIsBod,
      );
      campusToast.error({
        title: "Profile update failed",
        description: message,
        dedupeKey: `ec-students:edit-profile-error:${selectedStudent.uid}`,
      });
    } finally {
      setSavingProfileUid(null);
    }
  }

  async function createStudentAccount() {
    const schoolId = newSchoolId.trim();
    const studentName = newStudentName.trim();
    const course = newCourse.trim();
    const year = newYear.trim();
    const email = newEmail.trim();

    if (!schoolId)
      return setNotice({ type: "err", msg: "School ID is required." });
    if (!studentName)
      return setNotice({ type: "err", msg: "Student name is required." });
    if (!course) return setNotice({ type: "err", msg: "Course is required." });
    if (!year) return setNotice({ type: "err", msg: "Year is required." });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return setNotice({ type: "err", msg: "Please provide a valid email address." });
    }

    setCreating(true);
    setNotice(null);

    try {
      const res = await createCampusStudent({
        schoolId,
        studentName,
        course,
        year,
        email: email || null,
      });

      setNotice({
        type: "ok",
        msg: `Student account created. UID: ${res.uid ?? "-"}`,
      });
      setNewSchoolId("");
      setNewStudentName("");
      setNewCourse(viewerIsBod && viewerCourseScope ? viewerCourseScope : "");
      setNewYear("");
      setNewEmail("");
      setShowAddForm(false);
      campusToast.success({
        title: "Student account created",
        description: `UID: ${res.uid ?? "-"}`,
        dedupeKey: `ec-students:create:${res.uid ?? schoolId}`,
      });
      await loadStudents();
    } catch (error: unknown) {
      await logStudentPermissionDeniedAttempt(
        "create_student",
        schoolId,
        error,
      );
      const message = toScopedStudentErrorMessage(
        error,
        "Failed to create student account.",
        viewerCourseScope,
        viewerIsBod,
      );
      setNotice({ type: "err", msg: message });
      campusToast.error({
        title: "Create student failed",
        description: message,
        dedupeKey: "ec-students:create-error",
      });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <ECPageHeader
        title="Engineering Student Management System"
        description="Search the roster, narrow the view by course or year, and open each student record from a layout that stays readable on desktop and mobile."
        eyebrow="EC Students"
        icon={UserRoundSearch}
        variant="hero"
        meta={
          <>
            <Chip variant="flat" className="bg-white/15 text-white">
              {visibleStudentRows.length} students loaded
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              {filteredRows.length} matching filters
            </Chip>
            {viewerIsBod && viewerCourseScope && (
              <Chip variant="flat" className="bg-white/15 text-white">
                Course scope: {viewerCourseScope}
              </Chip>
            )}
            {viewerIsBod && !viewerCourseScope && viewerProfileReady && (
              <Chip variant="flat" className="bg-amber-100 text-amber-900">
                Scope missing
              </Chip>
            )}
          </>
        }
      />

      <ECStatsGrid items={summaryItems} />

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-campus-text-primary">
            Roster Filters
          </h2>
          <p className="text-sm text-campus-text-secondary">
            Search is kept visually primary, while course and year filters stay
            touch-friendly on smaller screens.
          </p>
        </div>

        <ECFilterBar
          controlsClassName="grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1.5fr)_220px_200px_minmax(0,1.2fr)]"
        >
          <div>
            <Input
              aria-label="Search students"
              type="text"
              label="Search"
              placeholder="Search name, ID, course, role, EC position, or email"
              value={queryText}
              onValueChange={setQueryText}
              className="w-full"
            />
          </div>

          <Select
            aria-label="Filter by course"
            label="Course"
            selectedKeys={
              new Set([
                viewerIsBod && viewerCourseScope
                  ? viewerCourseScope
                  : courseFilter || "__all_courses__",
              ])
            }
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0];
              if (typeof selected === "string") {
                setCourseFilter(selected === "__all_courses__" ? "" : selected);
              }
            }}
            disallowEmptySelection
            isDisabled={viewerIsBod}
            className="w-full"
            items={courseFilterItems}
          >
            {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
          </Select>

          <Select
            aria-label="Filter by year"
            label="Year Level"
            selectedKeys={new Set([yearFilter || "__all_years__"])}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0];
              if (typeof selected === "string") {
                setYearFilter(selected === "__all_years__" ? "" : selected);
              }
            }}
            disallowEmptySelection
            className="w-full"
            items={yearFilterItems}
          >
            {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
          </Select>

          <div className="grid grid-cols-1 gap-3 md:col-span-2 sm:grid-cols-2 xl:col-span-1 xl:grid-cols-3 xl:items-end">
            <Button
              variant="bordered"
              onPress={clearFilters}
              className="min-h-12 w-full font-medium"
            >
              Clear Filters
            </Button>

            <FingerprintEnrollmentManager
              students={filteredRows}
              buttonClassName="w-full"
            />

            <Button
              onPress={() => setShowAddForm((prev) => !prev)}
              isDisabled={viewerProfileReady && viewerIsBod && !viewerCourseScope}
              className={[
                "min-h-12 w-full justify-center gap-2 text-sm font-medium text-white",
                showAddForm
                  ? "bg-gray-600 hover:bg-gray-700"
                  : "bg-[#7b0000] hover:opacity-95",
              ].join(" ")}
            >
              <FiPlus size={16} />
              {showAddForm ? "Cancel Add Student" : "Add Student"}
            </Button>
          </div>
        </ECFilterBar>
      </section>

      {notice && (
        <div
          className={[
            "rounded-lg border px-4 py-3 text-sm",
            notice.type === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-900",
          ].join(" ")}
        >
          {notice.msg}
        </div>
      )}

      {showAddForm && (
        <Card
          shadow="none"
          className="border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]"
        >
          <CardBody className="space-y-4 p-5">
          <div>
              <h2 className="text-lg font-semibold text-gray-900">
              Add Student Account
              </h2>
              <p className="mt-1 text-sm text-campus-text-secondary">
                Create a new student profile without leaving the roster view.
              </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600">
                School ID *
              </label>
              <Input
                aria-label="New student school ID"
                value={newSchoolId}
                onValueChange={setNewSchoolId}
                className="mt-1 w-full"
                placeholder="e.g. 23209455"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">
                Student Name *
              </label>
              <Input
                aria-label="New student name"
                value={newStudentName}
                onValueChange={setNewStudentName}
                className="mt-1 w-full"
                placeholder="e.g. Juan Dela Cruz"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">
                Course *
              </label>
              <Select
                aria-label="New student course"
                selectedKeys={
                  new Set([
                    viewerIsBod && viewerCourseScope
                      ? viewerCourseScope
                      : newCourse || "__select_course__",
                  ])
                }
                onSelectionChange={(keys) => {
                  if (keys === "all") return;
                  const selected = Array.from(keys)[0];
                  if (typeof selected === "string") {
                    setNewCourse(
                      selected === "__select_course__" ? "" : selected,
                    );
                  }
                }}
                disallowEmptySelection
                isDisabled={viewerIsBod}
                className="mt-1 w-full"
                items={addCourseItems}
              >
                {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
              </Select>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">
                Year *
              </label>
              <Select
                aria-label="New student year"
                selectedKeys={new Set([newYear || "__select_year__"])}
                onSelectionChange={(keys) => {
                  if (keys === "all") return;
                  const selected = Array.from(keys)[0];
                  if (typeof selected === "string") {
                    setNewYear(selected === "__select_year__" ? "" : selected);
                  }
                }}
                disallowEmptySelection
                className="mt-1 w-full"
                items={addYearItems}
              >
                {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600">
                Email (optional)
              </label>
              <Input
                aria-label="New student email"
                value={newEmail}
                onValueChange={setNewEmail}
                className="mt-1 w-full"
                placeholder="optional@email.com"
              />
              <p className="mt-1 text-xs text-campus-text-secondary">
                If provided, the student can verify this email after first login.
              </p>
            </div>
          </div>

          <Button
            onPress={createStudentAccount}
            isDisabled={creating}
            className={[
                "inline-flex items-center justify-center rounded-lg px-4 text-sm font-semibold",
              creating
                ? "bg-gray-300 text-gray-700"
                : "bg-[#7b0000] text-white hover:opacity-95",
            ].join(" ")}
          >
            {creating ? "Creating..." : "Create Student"}
          </Button>
          </CardBody>
        </Card>
      )}

      <div className="space-y-3 md:hidden">
        {loading && <CampusCardListSkeleton rows={3} />}

        {!loading && loadError && (
          <Card shadow="none" className="border border-red-100 bg-red-50/80">
            <CardBody className="p-4">
              <ECEmptyState
                title="Unable to load students"
                description={loadError}
                tone="red"
                compact
              />
            </CardBody>
          </Card>
        )}

        {!loading &&
          !loadError &&
          paginatedStudents.map((student) => (
            <Card
              key={student.uid}
              shadow="none"
              className="border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]"
            >
              <CardBody className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-campus-text-primary break-words">
                      {student.name}
                    </p>
                    {(student.role === "ecmember" || student.role === "bod") && (
                      <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-campus-text-secondary">
                        {student.role === "bod" ? "B.O.D. profile" : "EC member profile"}
                      </p>
                    )}
                    <p className="text-xs text-campus-text-secondary break-all">
                      {student.id}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => openStudentStatusModal(student)}
                    className="px-4 text-xs shrink-0"
                    aria-label={`Open status for ${student.name}`}
                  >
                    Open profile
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-campus-text-secondary">Course</p>
                    <p className="text-sm text-campus-text-primary truncate">
                      {student.course}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-campus-text-secondary">Year Level</p>
                    <p className="text-sm text-campus-text-primary">
                      {student.year}
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <Chip
                    color="primary"
                    variant="flat"
                    className="max-w-full truncate"
                  >
                    {student.course}
                  </Chip>
                  <Chip
                    color={
                      student.status.toLowerCase() === "active"
                        ? "success"
                        : "default"
                    }
                    variant="flat"
                  >
                    {student.status}
                  </Chip>
                </div>
              </CardBody>
            </Card>
          ))}

        {!loading && !loadError && filteredRows.length === 0 && (
          <Card shadow="none" className="border border-border/70 bg-white/95">
            <CardBody className="p-4">
              <ECEmptyState
                title="No students found"
                description="Try another keyword, course, or year filter."
                compact
              />
            </CardBody>
          </Card>
        )}
      </div>

      <div className="hidden md:block">
        <ECDataTable
          ariaLabel="Engineering student roster"
          columns={studentColumns}
          items={loadError ? [] : paginatedStudents}
          isLoading={loading}
          emptyTitle={
            loadError ? "Unable to load students" : "No students found"
          }
          emptyDescription={
            loadError || "No students match the current filters."
          }
          renderCell={(student, columnKey) => {
            if (columnKey === "name") {
              return (
                <div className="space-y-1">
                  <p className="font-semibold text-campus-text-primary">
                    {student.name}
                  </p>
                  {(student.role === "ecmember" || student.role === "bod") && (
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-campus-text-secondary">
                      {student.role === "bod" ? "B.O.D. profile" : "EC member profile"}
                    </p>
                  )}
                  <p className="text-xs text-campus-text-secondary">
                    {student.email || "No email on record"}
                  </p>
                </div>
              );
            }

            if (columnKey === "id") {
              return (
                <span className="text-sm text-campus-text-secondary">
                  {student.id}
                </span>
              );
            }

            if (columnKey === "course") {
              return (
                <Chip
                  color="primary"
                  variant="flat"
                  className="max-w-full truncate"
                >
                  {student.course}
                </Chip>
              );
            }

            if (columnKey === "status") {
              return (
                <Chip
                  color={
                    student.status.toLowerCase() === "active"
                      ? "success"
                      : "default"
                  }
                  variant="flat"
                >
                  {student.status}
                </Chip>
              );
            }

            if (columnKey === "actions") {
              return (
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="flat"
                    onPress={() => openStudentStatusModal(student)}
                    className="px-4 text-xs"
                    aria-label={`Open status for ${student.name}`}
                  >
                    Open profile
                  </Button>
                </div>
              );
            }

            return student[columnKey as keyof Student] as string;
          }}
        />
      </div>

      {!loading && !loadError && filteredRows.length > studentsPerPage && (
        <div className="flex justify-center">
          <Pagination
            showControls
            page={studentPage}
            total={studentTotalPages}
            onChange={(page) => setStudentPage(page)}
          />
        </div>
      )}

      <Modal
        isOpen={statusModalOpen}
        onOpenChange={(open) => {
          setStatusModalOpen(open);
          if (!open) {
            setSelectedStudent(null);
            setEditProfileModalOpen(false);
            setEditProfileName("");
            setEditProfileSchoolId("");
            setEditProfileCourse("");
            setEditProfileYearLevel("");
            setStatusEvents([]);
            setStatusPayments([]);
            setStatusError(null);
            setStatusNotice(null);
            setStatusTab("attended");
            setAttendedSearch("");
            setMissedSearch("");
            setPaymentsSearch("");
            setAttendedPage(1);
            setMissedPage(1);
            setPaymentsPage(1);
            setPaymentSortMode("paid");
            setUpdatingStudentUid(null);
            setMarkingClearanceStudentUid(null);
            setSavingProfileUid(null);
          }
        }}
        size={isCompactViewport ? "full" : "5xl"}
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 flex items-center justify-center rounded-full bg-primary-500 text-white font-bold">
                    {initialsFromName(selectedStudent?.name ?? "")}
                  </div>

                  <div>
                    <h2 className="text-xl sm:text-2xl font-bold text-campus-text-primary">
                      Student Status
                    </h2>
                    <p className="text-sm text-campus-text-secondary">
                      Overview of attendance and payments
                    </p>
                    {selectedStudent && (
                      <p className="text-xs text-campus-text-secondary mt-1">
                        {selectedStudent.name} ({selectedStudent.id}) |{" "}
                        {selectedStudent.course} | {selectedStudent.year} |
                        {" "}Fingerprint: {selectedStudent.fingerprintStatus}
                      </p>
                    )}
                    {selectedStudent && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Chip
                          color={
                            selectedStudent.status === "Active"
                              ? "success"
                              : "default"
                          }
                          variant="flat"
                        >
                          Account: {selectedStudent.status}
                        </Chip>
                        <Chip
                          color={
                            selectedStudent.fingerprintStatus === "Active"
                              ? "success"
                              : "default"
                          }
                          variant="flat"
                        >
                          Fingerprint: {selectedStudent.fingerprintStatus}
                        </Chip>
                        <Chip
                          color={
                            selectedStudent.readyForClearance
                              ? "success"
                              : "danger"
                          }
                          variant="flat"
                        >
                          Clearance:{" "}
                          {selectedStudent.readyForClearance
                            ? "Ready"
                            : "Not ready"}
                        </Chip>
                        <Button
                          size="sm"
                          className="bg-[#7b0000] text-white"
                          onPress={() =>
                            void toggleStudentStatus(selectedStudent)
                          }
                          isLoading={updatingStudentUid === selectedStudent.uid}
                          isDisabled={
                            !selectedStudentCanManageActions ||
                            markingClearanceStudentUid === selectedStudent.uid ||
                            savingProfileUid === selectedStudent.uid
                          }
                        >
                          Set account{" "}
                          {selectedStudent.status === "Active"
                            ? "Inactive"
                            : "Active"}
                        </Button>
                        <Button
                          size="sm"
                          color={
                            selectedStudent.readyForClearance
                              ? "warning"
                              : "success"
                          }
                          variant={
                            selectedStudent.readyForClearance
                              ? "flat"
                              : "solid"
                          }
                          onPress={() =>
                            void setStudentClearanceReady(
                              selectedStudent,
                              !selectedStudent.readyForClearance,
                            )
                          }
                          isLoading={
                            markingClearanceStudentUid === selectedStudent.uid
                          }
                          isDisabled={
                            !selectedStudentCanManageActions ||
                            updatingStudentUid === selectedStudent.uid ||
                            savingProfileUid === selectedStudent.uid
                          }
                        >
                          {selectedStudent.readyForClearance
                            ? "Remove clearance ready"
                            : "Mark ready for clearance"}
                        </Button>
                        <Button
                          size="sm"
                          variant="bordered"
                          onPress={() => openEditProfileModal(selectedStudent)}
                          isDisabled={
                            !selectedStudentCanManageActions ||
                            updatingStudentUid === selectedStudent.uid ||
                            markingClearanceStudentUid === selectedStudent.uid
                          }
                        >
                          Edit Profile
                        </Button>
                      </div>
                    )}
                    {selectedStudent &&
                      viewerIsBod &&
                      !selectedStudentCanManageActions && (
                        <p className="mt-2 text-xs text-amber-700">
                          B.O.D actions stay limited to student-identity rows within
                          {` ${viewerCourseScope ?? "your assigned course"}.`}
                        </p>
                      )}
                  </div>
                </div>
              </ModalHeader>

              <ModalBody className="pb-6 space-y-6">
                {statusNotice && (
                  <div
                    className={[
                      "rounded-lg border px-4 py-3 text-sm",
                      statusNotice.type === "ok"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : statusNotice.type === "warn"
                          ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-red-200 bg-red-50 text-red-900",
                    ].join(" ")}
                  >
                    {statusNotice.msg}
                  </div>
                )}

                {statusError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {statusError}
                  </div>
                )}

                <Tabs
                  aria-label="Student status tabs"
                  selectedKey={statusTab}
                  onSelectionChange={(key) =>
                    setStatusTab(String(key) as StudentStatusTab)
                  }
                  fullWidth
                  classNames={{
                    tabList:
                      "grid w-full grid-cols-3 rounded-2xl bg-slate-100 p-1",
                    cursor: "rounded-[14px] bg-white shadow-sm",
                    tab: "min-h-11 w-full min-w-0 rounded-[14px] px-2",
                    tabContent: "truncate text-xs font-medium sm:text-sm",
                  }}
                >
                  <Tab key="attended" title="Events Attended">
                    <div className="space-y-3 pt-2">
                      <Input
                        aria-label="Search attended events"
                        type="text"
                        value={attendedSearch}
                        onValueChange={setAttendedSearch}
                        placeholder="Search attended events..."
                        className="w-full"
                      />

                      {statusLoading ? (
                        <CampusCardListSkeleton rows={2} />
                      ) : filteredAttendedEvents.length === 0 ? (
                        <p className="text-sm text-campus-text-secondary">
                          No attended events found.
                        </p>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {paginatedAttendedEvents.map((event) => (
                              <Card key={event.id} shadow="sm">
                                <CardBody>
                                  <h4 className="font-semibold text-campus-text-primary">
                                    {event.title}
                                  </h4>
                                  <p className="text-sm text-campus-text-secondary">
                                    {formatEventDate(
                                      event.eventDate,
                                      event.date,
                                    )}{" "}
                                    | {event.scheduledTime}
                                  </p>
                                  <p className="text-xs text-campus-text-secondary">
                                    {event.location || "TBA"}
                                  </p>
                                </CardBody>
                              </Card>
                            ))}
                          </div>
                          {filteredAttendedEvents.length >
                            STATUS_ITEMS_PER_PAGE && (
                            <div className="flex justify-center pt-2">
                              <Pagination
                                showControls
                                page={attendedPage}
                                total={attendedTotalPages}
                                onChange={(page) => setAttendedPage(page)}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </Tab>

                  <Tab key="missed" title="Events Missed">
                    <div className="space-y-3 pt-2">
                      <Input
                        aria-label="Search missed events"
                        type="text"
                        value={missedSearch}
                        onValueChange={setMissedSearch}
                        placeholder="Search missed events..."
                        className="w-full"
                      />

                      {statusLoading ? (
                        <CampusCardListSkeleton rows={2} />
                      ) : filteredMissedEvents.length === 0 ? (
                        <p className="text-sm text-campus-text-secondary">
                          No missed events found.
                        </p>
                      ) : (
                        <>
                          <div className="space-y-3">
                            {paginatedMissedEvents.map((event) => (
                              <Card
                                key={event.id}
                                shadow="sm"
                                className="bg-red-50 border-red-100"
                              >
                                <CardBody>
                                  <h4 className="font-semibold text-campus-text-primary">
                                    {event.title}
                                  </h4>
                                  <p className="text-sm text-campus-text-secondary">
                                    {formatEventDate(
                                      event.eventDate,
                                      event.date,
                                    )}{" "}
                                    | {event.scheduledTime}
                                  </p>
                                  <p className="text-xs text-campus-text-secondary">
                                    {event.location || "TBA"}
                                  </p>
                                </CardBody>
                              </Card>
                            ))}
                          </div>
                          {filteredMissedEvents.length >
                            STATUS_ITEMS_PER_PAGE && (
                            <div className="flex justify-center pt-2">
                              <Pagination
                                showControls
                                page={missedPage}
                                total={missedTotalPages}
                                onChange={(page) => setMissedPage(page)}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </Tab>

                  <Tab key="payments" title="Payments">
                    <div className="space-y-3 pt-2">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                        <Input
                          aria-label="Search payments"
                          type="text"
                          value={paymentsSearch}
                          onValueChange={setPaymentsSearch}
                          placeholder="Search payments..."
                          className="w-full"
                        />

                        <Dropdown placement="bottom-end">
                          <DropdownTrigger>
                            <Button
                              variant="bordered"
                              className="w-full sm:w-auto justify-between min-w-[140px]"
                            >
                              <span>Sort by: {paymentSortLabel}</span>
                              <FiChevronDown className="ml-2" />
                            </Button>
                          </DropdownTrigger>
                          <DropdownMenu
                            aria-label="Sort payments by status"
                            disallowEmptySelection
                            selectionMode="single"
                            selectedKeys={new Set([paymentSortMode])}
                            onAction={(key) =>
                              setPaymentSortMode(String(key) as PaymentSortMode)
                            }
                          >
                            <DropdownItem key="paid">Paid</DropdownItem>
                            <DropdownItem key="unpaid">Unpaid</DropdownItem>
                          </DropdownMenu>
                        </Dropdown>
                      </div>

                      {statusLoading ? (
                        <CampusCardListSkeleton rows={2} />
                      ) : sortedStatusPayments.length === 0 ? (
                        <p className="text-sm text-campus-text-secondary">
                          No payment records found for this student.
                        </p>
                      ) : (
                        <>
                          <div className="space-y-3">
                            {paginatedStatusPayments.map((payment) => (
                              <Card
                                key={payment.paymentId}
                                shadow="sm"
                                className={
                                  payment.status === "PAID"
                                    ? "bg-green-50 border-green-100"
                                    : "bg-red-50 border-red-100"
                                }
                              >
                                <CardBody className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                  <div>
                                    <p className="font-medium text-campus-text-primary">
                                      {payment.title}
                                    </p>
                                    <p className="text-xs text-campus-text-secondary">
                                      Ref: {payment.ref} | Date:{" "}
                                      {payment.date || "-"}
                                    </p>
                                  </div>

                                  <span
                                    className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                                      payment.status === "PAID"
                                        ? "bg-green-600 text-white"
                                        : "bg-red-600 text-white"
                                    }`}
                                  >
                                    {payment.status}
                                  </span>
                                </CardBody>
                              </Card>
                            ))}
                          </div>
                          {sortedStatusPayments.length >
                            STATUS_ITEMS_PER_PAGE && (
                            <div className="flex justify-center pt-2">
                              <Pagination
                                showControls
                                page={paymentsPage}
                                total={paymentsTotalPages}
                                onChange={(page) => setPaymentsPage(page)}
                              />
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </Tab>
                </Tabs>

                <div className="flex justify-end">
                  <Button variant="bordered" onPress={onClose} className="px-4">
                    Close
                  </Button>
                </div>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal
        isOpen={editProfileModalOpen}
        onOpenChange={(open) => {
          if (!open && savingProfileUid !== selectedStudentUid) {
            setEditProfileModalOpen(false);
          } else if (open) {
            setEditProfileModalOpen(true);
          }
        }}
        size={isCompactViewport ? "full" : "2xl"}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Edit Profile</ModalHeader>
              <ModalBody className="space-y-4 pb-2">
                <Input
                  label="Name"
                  value={editProfileName}
                  onValueChange={setEditProfileName}
                  placeholder="Enter full name"
                  isRequired
                />
                <Input
                  label="School ID"
                  value={editProfileSchoolId}
                  onValueChange={setEditProfileSchoolId}
                  placeholder="Enter school ID"
                  isRequired
                />
                <Select
                  label="Course"
                  selectedKeys={
                    viewerIsBod && viewerCourseScope
                      ? [viewerCourseScope]
                      : editProfileCourse
                        ? [editProfileCourse]
                        : []
                  }
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0];
                    if (typeof selected === "string") {
                      setEditProfileCourse(selected);
                    }
                  }}
                  placeholder="Select course"
                  isRequired={
                    selectedStudentHasStudentIdentity ||
                    selectedStudentRole !== "teacher"
                  }
                  isDisabled={viewerIsBod}
                >
                  {courseOptions.map((course) => (
                    <SelectItem key={course}>{course}</SelectItem>
                  ))}
                </Select>
                <Select
                  label="Year Level"
                  selectedKeys={
                    editProfileYearLevel ? [editProfileYearLevel] : []
                  }
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0];
                    if (typeof selected === "string") {
                      setEditProfileYearLevel(selected);
                    }
                  }}
                  placeholder="Select year level"
                  isRequired={
                    selectedStudentHasStudentIdentity ||
                    selectedStudentRole !== "teacher"
                  }
                >
                  {yearOptions.map((yearLevel) => (
                    <SelectItem key={yearLevel}>{yearLevel}</SelectItem>
                  ))}
                </Select>
              </ModalBody>
              <ModalFooter className="justify-between">
                <Button
                  variant="bordered"
                  onPress={() => {
                    if (savingProfileUid === selectedStudentUid) return;
                    setEditProfileModalOpen(false);
                    onClose();
                  }}
                  isDisabled={savingProfileUid === selectedStudentUid}
                >
                  Cancel
                </Button>
                <Button
                  className="bg-[#7b0000] font-semibold text-white"
                  onPress={() => {
                    void saveStudentProfileChanges();
                  }}
                  isLoading={savingProfileUid === selectedStudentUid}
                  isDisabled={savingProfileUid === selectedStudentUid}
                >
                  Save Changes
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
