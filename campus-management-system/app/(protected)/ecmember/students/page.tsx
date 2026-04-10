"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiChevronDown, FiPlus } from "react-icons/fi";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from "@heroui/dropdown";
import { Input } from "@heroui/input";
import { Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import { Tab, Tabs } from "@heroui/tabs";
import {
  CampusCardListSkeleton,
  CampusDataTable,
  type CampusTableColumn,
} from "@/components/ui";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { FingerprintEnrollmentManager } from "@/components/ecmember/FingerprintEnrollmentManager";
import { app, db } from "@/lib/firebase";
import { campusToast } from "@/lib/toast";

type StudentAccountStatus = "Active" | "Inactive";
type StudentFingerprintStatus = "Active" | "Inactive";

type Student = {
  uid: string;
  id: string;
  name: string;
  course: string;
  year: string;
  status: StudentAccountStatus;
  fingerprintStatus: StudentFingerprintStatus;
  email?: string;
  createdAt?: unknown;
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
  type: "ok" | "err";
  msg: string;
};

type SelectOption = {
  key: string;
  label: string;
};

type RemoteStudent = {
  uid?: string;
  schoolId?: string;
  studentName?: string;
  name?: string;
  course?: string;
  year?: string;
  status?: string;
  email?: string;
  createdAtMs?: number | null;
};

type StudentDirectoryProjection = {
  uid?: string;
  studentId?: string;
  schoolId?: string;
  studentName?: string;
  course?: string;
  year?: string;
  yearLevel?: string;
  status?: string;
  fingerprintStatus?: string;
  fingerprintTemplateId?: number | string;
  templateId?: number | string;
};

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
const STUDENTS_PER_PAGE_DESKTOP = 10;
const STUDENTS_PER_PAGE_PHONE = 5;
const PHONE_BREAKPOINT_PX = 768;
const STATUS_ITEMS_PER_PAGE = 4;

const studentColumns: CampusTableColumn<Student>[] = [
  { key: "id", label: "Student ID" },
  { key: "name", label: "Name" },
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

function normalizeYear(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!value) return "Unassigned";

  if (value === "1" || value.toLowerCase() === "1st year") return "1st Year";
  if (value === "2" || value.toLowerCase() === "2nd year") return "2nd Year";
  if (value === "3" || value.toLowerCase() === "3rd year") return "3rd Year";
  if (value === "4" || value.toLowerCase() === "4th year") return "4th Year";
  if (value === "5" || value.toLowerCase() === "5th year") return "5th Year";

  return value;
}

function normalizeCourse(raw: unknown) {
  const value = String(raw ?? "").trim();
  return value || "Unassigned";
}

function normalizeStudentAccountStatus(raw: unknown): StudentAccountStatus {
  return normalizeText(raw) === "inactive" ? "Inactive" : "Active";
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

function mapRemoteStudent(data: RemoteStudent): Student {
  const uid = String(data.uid ?? "").trim();
  const schoolId = String(data.schoolId ?? "").trim() || uid;
  const studentName = String(data.studentName ?? "").trim();
  const fallbackName = String(data.name ?? "").trim();
  const name = studentName || fallbackName || schoolId;
  const status = normalizeStudentAccountStatus(data.status);

  return {
    uid,
    id: schoolId,
    name,
    course: normalizeCourse(data.course),
    year: normalizeYear(data.year),
    status,
    fingerprintStatus: "Inactive",
    email: String(data.email ?? "").trim() || undefined,
    createdAt:
      typeof data.createdAtMs === "number" ? data.createdAtMs : undefined,
  };
}

function mergeStudentProjection(
  student: Student,
  projection?: StudentDirectoryProjection,
) {
  if (!projection) return student;

  return {
    ...student,
    status: normalizeStudentAccountStatus(projection.status ?? student.status),
    fingerprintStatus: getFingerprintStatus(projection),
  };
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
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);

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
  const [updatingStudentUid, setUpdatingStudentUid] = useState<string | null>(
    null,
  );
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

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const fn = httpsCallable<
        { limit: number },
        { students?: RemoteStudent[] }
      >(functions, "ecListStudents");
      const res = await fn({ limit: 2000 });

      const projectionByUid = new Map<string, StudentDirectoryProjection>();
      try {
        const projectionSnap = await getDocs(collection(db, "students"));
        projectionSnap.docs.forEach((snapshot) => {
          projectionByUid.set(
            snapshot.id,
            snapshot.data() as StudentDirectoryProjection,
          );
        });
      } catch {
        // Student status controls should still load even if the portable projection is unavailable.
      }

      const rows = (res.data?.students ?? []).map((remoteStudent) => {
        const student = mapRemoteStudent(remoteStudent);
        return mergeStudentProjection(
          student,
          projectionByUid.get(student.uid),
        );
      });

      rows.sort(
        (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
      );
      setStudents(rows);
    } catch (error: unknown) {
      setLoadError(toErrorMessage(error, "Failed to load students."));
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, [functions]);

  useEffect(() => {
    void loadStudents();
  }, [loadStudents]);

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

  const courseOptions = useMemo(() => {
    const set = new Set(DEFAULT_COURSES);
    students.forEach((s) => {
      if (s.course && s.course !== "Unassigned") set.add(s.course);
    });
    return Array.from(set);
  }, [students]);

  const yearOptions = useMemo(() => {
    const set = new Set(DEFAULT_YEARS);
    students.forEach((s) => {
      if (s.year && s.year !== "Unassigned") set.add(s.year);
    });
    return Array.from(set);
  }, [students]);

  const courseFilterItems = useMemo<SelectOption[]>(
    () => [
      { key: "__all_courses__", label: "All Courses" },
      ...courseOptions.map((courseName) => ({
        key: courseName,
        label: courseName,
      })),
    ],
    [courseOptions],
  );

  const yearFilterItems = useMemo<SelectOption[]>(
    () => [
      { key: "__all_years__", label: "All Years" },
      ...yearOptions.map((yearName) => ({ key: yearName, label: yearName })),
    ],
    [yearOptions],
  );

  const addCourseItems = useMemo<SelectOption[]>(
    () => [
      { key: "__select_course__", label: "Select course" },
      ...DEFAULT_COURSES.map((courseName) => ({
        key: courseName,
        label: courseName,
      })),
    ],
    [],
  );

  const addYearItems = useMemo<SelectOption[]>(
    () => [
      { key: "__select_year__", label: "Select year" },
      ...DEFAULT_YEARS.map((yearName) => ({ key: yearName, label: yearName })),
    ],
    [],
  );

  const filtered = useMemo(() => {
    const search = queryText.trim().toLowerCase();

    return students.filter((s) => {
      const matchQuery =
        !search ||
        s.name.toLowerCase().includes(search) ||
        s.id.toLowerCase().includes(search) ||
        (s.email ?? "").toLowerCase().includes(search);

      const matchCourse = courseFilter ? s.course === courseFilter : true;
      const matchYear = yearFilter ? s.year === yearFilter : true;

      return matchQuery && matchCourse && matchYear;
    });
  }, [students, queryText, courseFilter, yearFilter]);

  const studentTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filtered.length / studentsPerPage)),
    [filtered.length, studentsPerPage],
  );

  const paginatedStudents = useMemo(() => {
    const start = (studentPage - 1) * studentsPerPage;
    return filtered.slice(start, start + studentsPerPage);
  }, [filtered, studentPage, studentsPerPage]);

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
  const selectedStudentCourse = selectedStudent?.course ?? "";
  const selectedStudentYear = selectedStudent?.year ?? "";
  const selectedStudentStatus = selectedStudent?.status ?? "Active";

  const updateStudentState = useCallback(
    (
      studentUid: string,
      patch: Partial<Pick<Student, "status" | "fingerprintStatus">>,
    ) => {
      setStudents((prev) => {
        let changed = false;
        const next = prev.map((student) => {
          if (student.uid !== studentUid) return student;

          const nextStatus = patch.status ?? student.status;
          const nextFingerprintStatus =
            patch.fingerprintStatus ?? student.fingerprintStatus;
          if (
            nextStatus === student.status &&
            nextFingerprintStatus === student.fingerprintStatus
          ) {
            return student;
          }

          changed = true;
          return {
            ...student,
            status: nextStatus,
            fingerprintStatus: nextFingerprintStatus,
          };
        });

        return changed ? next : prev;
      });

      setSelectedStudent((prev) => {
        if (!prev || prev.uid !== studentUid) return prev;

        const nextStatus = patch.status ?? prev.status;
        const nextFingerprintStatus =
          patch.fingerprintStatus ?? prev.fingerprintStatus;
        if (
          nextStatus === prev.status &&
          nextFingerprintStatus === prev.fingerprintStatus
        ) {
          return prev;
        }

        return {
          ...prev,
          status: nextStatus,
          fingerprintStatus: nextFingerprintStatus,
        };
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
    };

    let active = true;

    async function loadStudentStatus() {
      setStatusLoading(true);
      setStatusError(null);

      try {
        const [eventsSnap, paymentSnap] = await Promise.all([
          getDocs(
            query(collection(db, "events"), orderBy("createdAt", "desc")),
          ),
          getDocs(
            query(collection(db, "payments"), orderBy("createdAt", "desc")),
          ),
        ]);

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
            fingerprintStatus: getFingerprintStatus(studentProjection),
          });
        } catch {
          // Keep the modal usable even if the fingerprint projection cannot be read.
        }

        const rawEvents: RawEventDoc[] = eventsSnap.docs.map((eventDoc) => {
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

              const attendanceSnap = await getDoc(
                doc(db, "events", event.id, "attendance", currentStudent.uid),
              );
              const attendanceData = attendanceSnap.exists()
                ? (attendanceSnap.data() as AttendanceDocData)
                : {};
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
          paymentSnap.docs.map(
            async (paymentDoc): Promise<StudentStatusPayment | null> => {
              const assignmentSnap = await getDoc(
                doc(
                  db,
                  "payments",
                  paymentDoc.id,
                  "students",
                  currentStudent.uid,
                ),
              );
              if (!assignmentSnap.exists()) return null;

              const paymentData = paymentDoc.data() as PaymentDocData;
              const assignmentData =
                assignmentSnap.data() as PaymentAssignmentData;
              const status =
                normalizeText(assignmentData.status) === "paid"
                  ? "PAID"
                  : "UNPAID";
              const createdAtMs = toMillis(assignmentData.createdAt);
              const updatedAtMs =
                toMillis(assignmentData.updatedAt) || createdAtMs;

              return {
                paymentId: paymentDoc.id,
                title: String(paymentData.title ?? "Untitled Payment"),
                ref: String(paymentData.ref ?? paymentDoc.id),
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
    statusModalOpen,
    updateStudentState,
  ]);

  const summaryCards = useMemo(
    () => [
      { label: "Total Students", count: students.length },
      {
        label: "Mechanical",
        count: students.filter((s) => s.course === "Mechanical Engineering")
          .length,
      },
      {
        label: "Electrical",
        count: students.filter((s) => s.course === "Electrical Engineering")
          .length,
      },
      {
        label: "Electronics",
        count: students.filter((s) => s.course === "Electronics Engineering")
          .length,
      },
      {
        label: "Computer",
        count: students.filter((s) => s.course === "Computer Engineering")
          .length,
      },
      {
        label: "Industrial",
        count: students.filter((s) => s.course === "Industrial Engineering")
          .length,
      },
    ],
    [students],
  );

  const clearFilters = () => {
    setQueryText("");
    setCourseFilter("");
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

    const nextStatus: StudentAccountStatus =
      student.status === "Active" ? "Inactive" : "Active";
    setUpdatingStudentUid(student.uid);
    setStatusNotice(null);

    try {
      const timestamp = serverTimestamp();

      await setDoc(
        doc(db, "students", student.uid),
        {
          uid: student.uid,
          studentId: student.uid,
          schoolId: student.id,
          studentName: student.name,
          course: student.course,
          year: student.year,
          yearLevel: student.year,
          status: nextStatus,
          updatedAt: timestamp,
        },
        { merge: true },
      );

      try {
        await setDoc(
          doc(db, "profiles", student.uid),
          {
            status: nextStatus,
            updatedAt: timestamp,
          },
          { merge: true },
        );
      } catch (error: unknown) {
        const message = toErrorMessage(error, "");
        if (!message.toLowerCase().includes("permission-denied")) {
          throw error;
        }
      }

      if (nextStatus === "Inactive") {
        const registrationsSnap = await getDocs(
          query(
            collectionGroup(db, "registrations"),
            where("uid", "==", student.uid),
          ),
        );

        await Promise.all(
          registrationsSnap.docs.map((snapshot) => deleteDoc(snapshot.ref)),
        );
      }

      updateStudentState(student.uid, { status: nextStatus });
      setStatusNotice({
        type: "ok",
        msg: `${student.name} is now ${nextStatus}.`,
      });
      campusToast.success({
        title: "Student status updated",
        description: `${student.name} is now ${nextStatus}.`,
        dedupeKey: `ec-students:status:${student.uid}:${nextStatus}`,
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error, "Failed to update student status.");
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

    setCreating(true);
    setNotice(null);

    try {
      const fn = httpsCallable<
        {
          schoolId: string;
          studentName: string;
          course: string;
          year: string;
          email: string | null;
        },
        { uid?: string }
      >(functions, "ecCreateStudent");

      const res = await fn({
        schoolId,
        studentName,
        course,
        year,
        email: email || null,
      });

      setNotice({
        type: "ok",
        msg: `Student account created. UID: ${res.data?.uid ?? "-"}`,
      });
      setNewSchoolId("");
      setNewStudentName("");
      setNewCourse("");
      setNewYear("");
      setNewEmail("");
      setShowAddForm(false);
      campusToast.success({
        title: "Student account created",
        description: `UID: ${res.data?.uid ?? "-"}`,
        dedupeKey: `ec-students:create:${res.data?.uid ?? schoolId}`,
      });
      await loadStudents();
    } catch (error: unknown) {
      const message = toErrorMessage(
        error,
        "Failed to create student account.",
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
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <Card
        shadow="sm"
        className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#b71f1f] to-[#f09a4a] text-white"
      >
        <CardBody className="space-y-4 p-5 sm:p-8">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
              EC Students
            </p>
            <h1 className="text-3xl font-black sm:text-4xl">
              Engineering Student Management System
            </h1>
            <p className="max-w-2xl text-sm text-white/80 sm:text-base">
              Search the roster, filter by program or year, and open each
              student profile without losing mobile usability.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip variant="flat" className="bg-white/15 text-white">
              {students.length} students loaded
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              {filtered.length} matching current filters
            </Chip>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {summaryCards.map((item) => (
          <Card key={item.label} shadow="sm" className="border">
            <CardBody className="p-4 text-center">
              <div className="text-2xl font-black text-campus-text-primary">
                {item.count}
              </div>
              <p className="text-sm text-campus-text-secondary">{item.label}</p>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card shadow="sm" className="border">
        <CardHeader className="px-5 pt-5">
          <div>
            <h2 className="text-lg font-semibold text-campus-text-primary">
              Roster Filters
            </h2>
            <p className="text-sm text-campus-text-secondary">
              Built to stay readable on both desktop and phone screens.
            </p>
          </div>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 p-5 pt-3 xl:grid-cols-[minmax(0,1.3fr)_220px_180px_auto_auto_auto] xl:items-end">
          <Input
            aria-label="Search students"
            type="text"
            placeholder="Search student name, student ID, or email..."
            value={queryText}
            onValueChange={setQueryText}
            className="w-full"
          />

          <Select
            aria-label="Filter by course"
            selectedKeys={new Set([courseFilter || "__all_courses__"])}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0];
              if (typeof selected === "string") {
                setCourseFilter(selected === "__all_courses__" ? "" : selected);
              }
            }}
            disallowEmptySelection
            className="w-full"
            items={courseFilterItems}
          >
            {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
          </Select>

          <Select
            aria-label="Filter by year"
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

          <Button
            variant="bordered"
            onPress={clearFilters}
            className="w-full xl:w-auto"
          >
            Clear Filters
          </Button>

          <FingerprintEnrollmentManager students={students} />

          <Button
            onPress={() => setShowAddForm((prev) => !prev)}
            className={[
              "w-full justify-center gap-2 text-sm font-medium text-white xl:w-auto",
              showAddForm
                ? "bg-gray-600 hover:bg-gray-700"
                : "bg-[#7b0000] hover:opacity-95",
            ].join(" ")}
          >
            <FiPlus size={16} />
            {showAddForm ? "Cancel Add Student" : "Add Student"}
          </Button>
        </CardBody>
      </Card>

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
        <div className="bg-white rounded-lg shadow border p-5 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Add Student Account
            </h2>
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
                selectedKeys={new Set([newCourse || "__select_course__"])}
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
        </div>
      )}

      <div className="space-y-3 md:hidden">
        {loading && <CampusCardListSkeleton rows={3} />}

        {!loading && loadError && (
          <Card shadow="sm" className="border border-red-200 bg-red-50">
            <CardBody className="p-4 text-center text-sm text-red-700">
              {loadError}
            </CardBody>
          </Card>
        )}

        {!loading &&
          !loadError &&
          paginatedStudents.map((student) => (
            <Card key={student.uid} shadow="sm" className="border">
              <CardBody className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-campus-text-secondary">
                      Student ID
                    </p>
                    <p className="text-sm font-semibold text-campus-text-primary break-all">
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
                    Info
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-campus-text-secondary">Name</p>
                    <p className="text-sm text-campus-text-primary truncate">
                      {student.name}
                    </p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-campus-text-secondary">
                      Year Level
                    </p>
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

        {!loading && !loadError && filtered.length === 0 && (
          <Card shadow="sm" className="border">
            <CardBody className="p-4 text-center text-sm text-gray-500">
              No students found.
            </CardBody>
          </Card>
        )}
      </div>

      <div className="hidden md:block">
        <CampusDataTable
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
                    Info
                  </Button>
                </div>
              );
            }

            return student[columnKey as keyof Student] as string;
          }}
        />
      </div>

      {!loading && !loadError && filtered.length > studentsPerPage && (
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
          }
        }}
        size="5xl"
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
                        Fingerprint: {selectedStudent.fingerprintStatus}
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
                        <Button
                          size="sm"
                          className="bg-[#7b0000] text-white"
                          onPress={() =>
                            void toggleStudentStatus(selectedStudent)
                          }
                          isLoading={updatingStudentUid === selectedStudent.uid}
                        >
                          Set{" "}
                          {selectedStudent.status === "Active"
                            ? "Inactive"
                            : "Active"}
                        </Button>
                      </div>
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
                    tabList: "w-full grid grid-cols-3",
                    tab: "w-full min-w-0 px-2",
                    tabContent: "truncate text-xs sm:text-sm",
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
    </div>
  );
}
