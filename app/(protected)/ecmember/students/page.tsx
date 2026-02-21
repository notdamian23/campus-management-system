"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FiChevronDown, FiPlus } from "react-icons/fi";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from "@heroui/dropdown";
import { Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { Tab, Tabs } from "@heroui/tabs";
import { getFunctions, httpsCallable } from "firebase/functions";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { app, db } from "@/lib/firebase";

type Student = {
  uid: string;
  id: string;
  name: string;
  course: string;
  year: string;
  status: string;
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

type Role = "admin" | "ec" | "teacher" | "student";

type Notice = {
  type: "ok" | "err";
  msg: string;
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

const DEFAULT_COURSES = [
  "Computer Engineering",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Industrial Engineering",
  "Electronics Engineering",
];

const DEFAULT_YEARS = ["1st Year", "2nd Year", "3rd Year", "4th Year", "5th Year"];
const STUDENTS_PER_PAGE = 25;
const STATUS_ITEMS_PER_PAGE = 4;

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
  return String(value ?? "").trim().toLowerCase();
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

function computeLifecycle(date: string, scheduledTime: string, timeEnd: string) {
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
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  const raw = String(value ?? "").trim();
  if (!raw) return [];

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesTarget(eventValue: unknown, studentValue: string, allLabel: string) {
  const eventTargets = toTargetList(eventValue);
  const studentTarget = String(studentValue ?? "").trim();

  if (eventTargets.length === 0) return true;
  if (eventTargets.some((item) => normalizeText(item) === normalizeText(allLabel))) return true;
  return eventTargets.some((item) => normalizeText(item) === normalizeText(studentTarget));
}

function matchesSpecificStudentTarget(targetValue: string, schoolId: string, studentName: string) {
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
    if (withoutParens && (withoutParens === name || name.includes(withoutParens) || withoutParens.includes(name))) {
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

function mapRemoteStudent(data: RemoteStudent): Student {
  const uid = String(data.uid ?? "").trim();
  const schoolId = String(data.schoolId ?? "").trim() || uid;
  const studentName = String(data.studentName ?? "").trim();
  const fallbackName = String(data.name ?? "").trim();
  const name = studentName || fallbackName || schoolId;
  const status = String(data.status ?? "").trim() || "Active";

  return {
    uid,
    id: schoolId,
    name,
    course: normalizeCourse(data.course),
    year: normalizeYear(data.year),
    status,
    email: String(data.email ?? "").trim() || undefined,
    createdAt: typeof data.createdAtMs === "number" ? data.createdAtMs : undefined,
  };
}

function toErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { code?: unknown; message?: unknown };
    const message = typeof maybe.message === "string" ? maybe.message : fallback;
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

  const [showAddForm, setShowAddForm] = useState(false);
  const [newSchoolId, setNewSchoolId] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newRole] = useState<Role>("student");
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
  const [statusTab, setStatusTab] = useState<StudentStatusTab>("attended");
  const [attendedSearch, setAttendedSearch] = useState("");
  const [missedSearch, setMissedSearch] = useState("");
  const [paymentsSearch, setPaymentsSearch] = useState("");
  const [attendedPage, setAttendedPage] = useState(1);
  const [missedPage, setMissedPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const [paymentSortMode, setPaymentSortMode] = useState<PaymentSortMode>("paid");
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusEvents, setStatusEvents] = useState<StudentStatusEvent[]>([]);
  const [statusPayments, setStatusPayments] = useState<StudentStatusPayment[]>([]);

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const fn = httpsCallable<{ limit: number }, { students?: RemoteStudent[] }>(functions, "ecListStudents");
      const res = await fn({ limit: 2000 });
      const rows = (res.data?.students ?? []).map(mapRemoteStudent);
      rows.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
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
    () => Math.max(1, Math.ceil(filtered.length / STUDENTS_PER_PAGE)),
    [filtered.length]
  );

  const paginatedStudents = useMemo(() => {
    const start = (studentPage - 1) * STUDENTS_PER_PAGE;
    return filtered.slice(start, start + STUDENTS_PER_PAGE);
  }, [filtered, studentPage]);

  const attendedEvents = useMemo(
    () =>
      statusEvents
        .filter((event) => event.status === "Attended")
        .sort((a, b) => (b.eventDate?.getTime() ?? 0) - (a.eventDate?.getTime() ?? 0)),
    [statusEvents]
  );

  const missedEvents = useMemo(
    () =>
      statusEvents
        .filter((event) => event.status === "Missed")
        .sort((a, b) => (b.eventDate?.getTime() ?? 0) - (a.eventDate?.getTime() ?? 0)),
    [statusEvents]
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
    [paymentSortMode]
  );

  const attendedTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredAttendedEvents.length / STATUS_ITEMS_PER_PAGE)),
    [filteredAttendedEvents.length]
  );

  const paginatedAttendedEvents = useMemo(() => {
    const start = (attendedPage - 1) * STATUS_ITEMS_PER_PAGE;
    return filteredAttendedEvents.slice(start, start + STATUS_ITEMS_PER_PAGE);
  }, [filteredAttendedEvents, attendedPage]);

  const missedTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredMissedEvents.length / STATUS_ITEMS_PER_PAGE)),
    [filteredMissedEvents.length]
  );

  const paginatedMissedEvents = useMemo(() => {
    const start = (missedPage - 1) * STATUS_ITEMS_PER_PAGE;
    return filteredMissedEvents.slice(start, start + STATUS_ITEMS_PER_PAGE);
  }, [filteredMissedEvents, missedPage]);

  const paymentsTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedStatusPayments.length / STATUS_ITEMS_PER_PAGE)),
    [sortedStatusPayments.length]
  );

  const paginatedStatusPayments = useMemo(() => {
    const start = (paymentsPage - 1) * STATUS_ITEMS_PER_PAGE;
    return sortedStatusPayments.slice(start, start + STATUS_ITEMS_PER_PAGE);
  }, [sortedStatusPayments, paymentsPage]);

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
    if (!statusModalOpen || !selectedStudent) return;
    const currentStudent = selectedStudent;

    let active = true;

    async function loadStudentStatus() {
      setStatusLoading(true);
      setStatusError(null);

      try {
        const eventsSnap = await getDocs(query(collection(db, "events"), orderBy("createdAt", "desc")));
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
            yearLevel: String(data.yearLevel ?? "").trim() || (yearLevels.length > 0 ? yearLevels.join(", ") : "All Years"),
            course: String(data.course ?? "").trim() || (courses.length > 0 ? courses.join(", ") : "All Courses"),
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
            "All Courses"
          );
          const yearMatch = matchesTarget(
            event.yearLevels.length > 0 ? event.yearLevels : event.yearLevel,
            currentStudent.year,
            "All Years"
          );
          const studentMatch = matchesSpecificStudentTarget(event.targetStudent, currentStudent.id, currentStudent.name);
          return courseMatch && yearMatch && studentMatch;
        });

        const eventRows = await Promise.all(
          targetedEvents.map(async (event): Promise<StudentStatusEvent | null> => {
            const scheduledTime = event.scheduledTime || event.timeStart;
            const lifecycle = computeLifecycle(event.date, scheduledTime, event.timeEnd);
            if (lifecycle !== "completed") return null;

            const attendanceSnap = await getDoc(doc(db, "events", event.id, "attendance", currentStudent.uid));
            const attendanceData = attendanceSnap.exists() ? (attendanceSnap.data() as AttendanceDocData) : {};
            const attendanceRaw = normalizeText(attendanceData.status ?? attendanceData.attendanceStatus ?? "");

            const status: AttendanceStatus = attendanceRaw === "present" || attendanceRaw === "attended" ? "Attended" : "Missed";

            return {
              id: event.id,
              title: event.title,
              date: event.date,
              scheduledTime: scheduledTime || "TBA",
              location: event.location || "TBA",
              eventDate: toEventDate(event.date, scheduledTime),
              status,
            };
          })
        );

        const paymentSnap = await getDocs(query(collection(db, "payments"), orderBy("createdAt", "desc")));
        const paymentRows = await Promise.all(
          paymentSnap.docs.map(async (paymentDoc): Promise<StudentStatusPayment | null> => {
            const assignmentSnap = await getDoc(doc(db, "payments", paymentDoc.id, "students", currentStudent.uid));
            if (!assignmentSnap.exists()) return null;

            const paymentData = paymentDoc.data() as PaymentDocData;
            const assignmentData = assignmentSnap.data() as PaymentAssignmentData;
            const status = normalizeText(assignmentData.status) === "paid" ? "PAID" : "UNPAID";
            const createdAtMs = toMillis(assignmentData.createdAt);
            const updatedAtMs = toMillis(assignmentData.updatedAt) || createdAtMs;

            return {
              paymentId: paymentDoc.id,
              title: String(paymentData.title ?? "Untitled Payment"),
              ref: String(paymentData.ref ?? paymentDoc.id),
              date: String(paymentData.date ?? ""),
              status,
              updatedAtMs,
            };
          })
        );

        if (!active) return;
        setStatusEvents(eventRows.filter((row): row is StudentStatusEvent => Boolean(row)));
        setStatusPayments(paymentRows.filter((row): row is StudentStatusPayment => Boolean(row)));
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
  }, [selectedStudent, statusModalOpen]);

  const summaryCards = useMemo(
    () => [
      { label: "Total Students", count: students.length },
      { label: "Mechanical", count: students.filter((s) => s.course === "Mechanical Engineering").length },
      { label: "Electrical", count: students.filter((s) => s.course === "Electrical Engineering").length },
      { label: "Electronics", count: students.filter((s) => s.course === "Electronics Engineering").length },
      { label: "Computer", count: students.filter((s) => s.course === "Computer Engineering").length },
      { label: "Industrial", count: students.filter((s) => s.course === "Industrial Engineering").length },
    ],
    [students]
  );

  const clearFilters = () => {
    setQueryText("");
    setCourseFilter("");
    setYearFilter("");
  };

  const openStudentStatusModal = (student: Student) => {
    setSelectedStudent(student);
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

  async function createStudentAccount() {
    const schoolId = newSchoolId.trim();
    const studentName = newStudentName.trim();
    const course = newCourse.trim();
    const year = newYear.trim();
    const email = newEmail.trim();

    if (!schoolId) return setNotice({ type: "err", msg: "School ID is required." });
    if (!studentName) return setNotice({ type: "err", msg: "Student name is required." });
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
      await loadStudents();
    } catch (error: unknown) {
      setNotice({ type: "err", msg: toErrorMessage(error, "Failed to create student account.") });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <Card shadow="sm">
        <CardBody className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 px-4 sm:px-6 py-4">
          <h1 className="text-xl font-bold text-primary-900">Engineering Student Management System</h1>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {summaryCards.map((item) => (
          <div key={item.label} className="bg-white rounded-lg shadow p-4 text-center border">
            <div className="text-2xl font-bold">{item.count}</div>
            <p className="text-sm text-campus-text-secondary">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 sm:gap-4 items-stretch sm:items-center">
        <input
          type="text"
          placeholder="Search student name, student ID, or email..."
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          className="w-full sm:flex-1 sm:min-w-[220px] px-4 py-3 border rounded-lg shadow-sm"
        />

        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="w-full sm:w-auto px-4 py-3 border rounded-lg shadow-sm sm:min-w-[220px]"
        >
          <option value="">All Courses</option>
          {courseOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="w-full sm:w-auto px-4 py-3 border rounded-lg shadow-sm sm:min-w-[170px]"
        >
          <option value="">All Years</option>
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={clearFilters}
          className="w-full sm:w-auto px-4 py-3 rounded-lg border bg-white hover:bg-gray-50 text-sm font-medium"
        >
          Clear Filters
        </button>

        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className={[
            "w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-white",
            showAddForm ? "bg-gray-600 hover:bg-gray-700" : "bg-[#7b0000] hover:opacity-95",
          ].join(" ")}
        >
          <FiPlus size={16} />
          {showAddForm ? "Cancel Add Student" : "Add Student"}
        </button>
      </div>

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
            <h2 className="text-lg font-semibold text-gray-900">Add Student Account</h2>
            <p className="text-sm text-gray-600 mt-1">
              Role is fixed to <span className="font-semibold">{newRole}</span>. EC can add students only.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600">School ID *</label>
              <input
                value={newSchoolId}
                onChange={(e) => setNewSchoolId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
                placeholder="e.g. 23209455"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">Student Name *</label>
              <input
                value={newStudentName}
                onChange={(e) => setNewStudentName(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
                placeholder="e.g. Juan Dela Cruz"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">Role</label>
              <input
                value={newRole}
                readOnly
                className="mt-1 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">Course *</label>
              <select
                value={newCourse}
                onChange={(e) => setNewCourse(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
              >
                <option value="">Select course</option>
                {DEFAULT_COURSES.map((courseName) => (
                  <option key={courseName} value={courseName}>
                    {courseName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-600">Year *</label>
              <select
                value={newYear}
                onChange={(e) => setNewYear(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
              >
                <option value="">Select year</option>
                {DEFAULT_YEARS.map((yearName) => (
                  <option key={yearName} value={yearName}>
                    {yearName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-600">Email (optional)</label>
              <input
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
                placeholder="optional@email.com"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={createStudentAccount}
            disabled={creating}
            className={[
              "inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold",
              creating ? "bg-gray-300 text-gray-700" : "bg-[#7b0000] text-white hover:opacity-95",
            ].join(" ")}
          >
            {creating ? "Creating..." : "Create Student"}
          </button>
        </div>
      )}

      <div className="bg-white rounded-lg shadow border overflow-x-auto">
        <table className="w-full min-w-[760px] text-left">
          <thead>
            <tr className="border-b bg-gray-50 text-sm text-campus-text-secondary">
              <th className="p-3">Student ID</th>
              <th className="p-3">Name</th>
              <th className="p-3">Course</th>
              <th className="p-3">Year Level</th>
              <th className="p-3">Status</th>
              <th className="p-3"></th>
            </tr>
          </thead>

          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-gray-500">
                  Loading students...
                </td>
              </tr>
            )}

            {!loading && loadError && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-red-700">
                  {loadError}
                </td>
              </tr>
            )}

            {!loading &&
              !loadError &&
              paginatedStudents.map((student) => (
                <tr key={student.uid} className="border-b hover:bg-gray-50">
                  <td className="p-3">{student.id}</td>
                  <td className="p-3">{student.name}</td>
                  <td className="p-3">
                    <span className="px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-700">{student.course}</span>
                  </td>
                  <td className="p-3">{student.year}</td>
                  <td className="p-3">
                    <span
                      className={[
                        "px-3 py-1 text-xs rounded-full",
                        student.status.toLowerCase() === "active"
                          ? "bg-green-100 text-green-700"
                          : "bg-gray-200 text-gray-700",
                      ].join(" ")}
                    >
                      {student.status}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    <button
                      type="button"
                      onClick={() => openStudentStatusModal(student)}
                      className="px-4 py-1 bg-gray-200 text-campus-text-primary text-xs rounded-lg hover:bg-gray-300 transition"
                      aria-label={`Open status for ${student.name}`}
                    >
                      Info
                    </button>
                  </td>
                </tr>
              ))}

            {!loading && !loadError && filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="p-6 text-center text-sm text-gray-500">
                  No students found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {!loading && !loadError && filtered.length > STUDENTS_PER_PAGE && (
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
            setStatusTab("attended");
            setAttendedSearch("");
            setMissedSearch("");
            setPaymentsSearch("");
            setAttendedPage(1);
            setMissedPage(1);
            setPaymentsPage(1);
            setPaymentSortMode("paid");
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
                    <h2 className="text-xl sm:text-2xl font-bold text-campus-text-primary">Student Status</h2>
                    <p className="text-sm text-campus-text-secondary">Overview of attendance and payments</p>
                    {selectedStudent && (
                      <p className="text-xs text-campus-text-secondary mt-1">
                        {selectedStudent.name} ({selectedStudent.id}) | {selectedStudent.course} | {selectedStudent.year}
                      </p>
                    )}
                  </div>
                </div>
              </ModalHeader>

              <ModalBody className="pb-6 space-y-6">
                {statusError && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                    {statusError}
                  </div>
                )}

                <Tabs
                  aria-label="Student status tabs"
                  selectedKey={statusTab}
                  onSelectionChange={(key) => setStatusTab(String(key) as StudentStatusTab)}
                  fullWidth
                  classNames={{
                    tabList: "w-full grid grid-cols-3",
                    tab: "w-full min-w-0 px-2",
                    tabContent: "truncate text-xs sm:text-sm",
                  }}
                >
                  <Tab key="attended" title="Events Attended">
                    <div className="space-y-3 pt-2">
                      <input
                        type="text"
                        value={attendedSearch}
                        onChange={(e) => setAttendedSearch(e.target.value)}
                        placeholder="Search attended events..."
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />

                      {statusLoading ? (
                        <p className="text-sm text-campus-text-secondary">Loading attended events...</p>
                      ) : filteredAttendedEvents.length === 0 ? (
                        <p className="text-sm text-campus-text-secondary">No attended events found.</p>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {paginatedAttendedEvents.map((event) => (
                              <Card key={event.id} shadow="sm">
                                <CardBody>
                                  <h4 className="font-semibold text-campus-text-primary">{event.title}</h4>
                                  <p className="text-sm text-campus-text-secondary">
                                    {formatEventDate(event.eventDate, event.date)} | {event.scheduledTime}
                                  </p>
                                  <p className="text-xs text-campus-text-secondary">{event.location || "TBA"}</p>
                                </CardBody>
                              </Card>
                            ))}
                          </div>
                          {filteredAttendedEvents.length > STATUS_ITEMS_PER_PAGE && (
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
                      <input
                        type="text"
                        value={missedSearch}
                        onChange={(e) => setMissedSearch(e.target.value)}
                        placeholder="Search missed events..."
                        className="w-full px-3 py-2 border rounded-lg text-sm"
                      />

                      {statusLoading ? (
                        <p className="text-sm text-campus-text-secondary">Loading missed events...</p>
                      ) : filteredMissedEvents.length === 0 ? (
                        <p className="text-sm text-campus-text-secondary">No missed events found.</p>
                      ) : (
                        <>
                          <div className="space-y-3">
                            {paginatedMissedEvents.map((event) => (
                              <Card key={event.id} shadow="sm" className="bg-red-50 border-red-100">
                                <CardBody>
                                  <h4 className="font-semibold text-campus-text-primary">{event.title}</h4>
                                  <p className="text-sm text-campus-text-secondary">
                                    {formatEventDate(event.eventDate, event.date)} | {event.scheduledTime}
                                  </p>
                                  <p className="text-xs text-campus-text-secondary">{event.location || "TBA"}</p>
                                </CardBody>
                              </Card>
                            ))}
                          </div>
                          {filteredMissedEvents.length > STATUS_ITEMS_PER_PAGE && (
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
                        <input
                          type="text"
                          value={paymentsSearch}
                          onChange={(e) => setPaymentsSearch(e.target.value)}
                          placeholder="Search payments..."
                          className="w-full px-3 py-2 border rounded-lg text-sm"
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
                            onAction={(key) => setPaymentSortMode(String(key) as PaymentSortMode)}
                          >
                            <DropdownItem key="paid">Paid</DropdownItem>
                            <DropdownItem key="unpaid">Unpaid</DropdownItem>
                          </DropdownMenu>
                        </Dropdown>
                      </div>

                      {statusLoading ? (
                        <p className="text-sm text-campus-text-secondary">Loading payments...</p>
                      ) : sortedStatusPayments.length === 0 ? (
                        <p className="text-sm text-campus-text-secondary">No payment records found for this student.</p>
                      ) : (
                        <>
                          <div className="space-y-3">
                            {paginatedStatusPayments.map((payment) => (
                              <Card
                                key={payment.paymentId}
                                shadow="sm"
                                className={payment.status === "PAID" ? "bg-green-50 border-green-100" : "bg-red-50 border-red-100"}
                              >
                                <CardBody className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                  <div>
                                    <p className="font-medium text-campus-text-primary">{payment.title}</p>
                                    <p className="text-xs text-campus-text-secondary">
                                      Ref: {payment.ref} | Date: {payment.date || "-"}
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
                          {sortedStatusPayments.length > STATUS_ITEMS_PER_PAGE && (
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
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-lg border bg-white hover:bg-gray-50 text-sm font-medium"
                  >
                    Close
                  </button>
                </div>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
