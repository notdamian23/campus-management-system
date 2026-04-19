"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FiCalendar, FiChevronDown } from "react-icons/fi";
import { getFunctions, httpsCallable } from "firebase/functions";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  type DocumentData,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  type QueryDocumentSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { app, auth, db } from "@/lib/firebase";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
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
import { Tooltip } from "@heroui/tooltip";
import {
  CampusCardListSkeleton,
  type CampusTableColumn,
} from "@/components/ui";
import {
  CircleDollarSign,
  CreditCard,
  Hourglass,
  ReceiptText,
} from "lucide-react";
import {
  ECDataTable,
  ECEmptyState,
  ECFilterBar,
  ECPageHeader,
  ECStatsGrid,
  ECStatusChipGroup,
  type ECStatItem,
} from "@/components/ecmember";
import { campusToast } from "@/lib/toast";
import type { CampusProfileDoc } from "@/lib/campus-auth";
import {
  exportPaymentWorkbook,
  filterRowsByCourseScope,
} from "@/lib/ec-payment-export";
import {
  canEditPayment,
  canManagePayment,
  getCourseScope,
  isBOD,
} from "@/lib/ec-permissions";
import { normalizeCourse } from "@/lib/courseOptions";
import {
  formatStudentFullName,
  formatStudentReferenceList,
} from "@/lib/student-name";

type PaymentStudentStatus = "Paid" | "Unpaid";

type RemoteStudent = {
  uid?: string;
  schoolId?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  studentName?: string;
  name?: string;
  course?: string;
  year?: string;
  section?: string;
};

type StudentProfile = {
  uid: string;
  schoolId: string;
  name: string;
  year: string;
  section: string;
  course: string;
};

interface PaymentStudent extends StudentProfile {
  status: PaymentStudentStatus;
  paidDate?: unknown;
  referenceNumber?: string;
  remarks?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

interface Payment {
  id: string;
  title: string;
  ref: string;
  amount: number;
  date: string;
  yearLevel: string;
  course: string;
  targetStudent: string;
  details: string;
  totalStudents: number;
  paidCount: number;
  unpaidCount: number;
  linkedEventId?: string;
  linkedEventTitle?: string;
  source?: string;
  status?: string;
  createdByUid?: string;
  createdByCourseScope?: string | null;
  courseScope?: string | null;
  createdAt?: unknown;
}

type ViewerProfile = CampusProfileDoc & {
  uid: string;
};

type Notice = {
  type: "ok" | "err";
  msg: string;
};

type SelectOption = {
  key: string;
  label: string;
};

type PaymentStudentPaginationState = {
  page: number;
  rowsPerPage: number;
};

type PaymentEditorMode = "create" | "edit";

type PaymentStudentDocData = {
  uid?: unknown;
  schoolId?: unknown;
  name?: unknown;
  studentName?: unknown;
  fullName?: unknown;
  year?: unknown;
  yearLevel?: unknown;
  section?: unknown;
  course?: unknown;
  status?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
  paidAt?: unknown;
  paidDate?: unknown;
  paidOn?: unknown;
  referenceNumber?: unknown;
  referenceNo?: unknown;
  reference?: unknown;
  refNumber?: unknown;
  remarks?: unknown;
  note?: unknown;
  notes?: unknown;
};

type SortMode = "latest_to_oldest" | "oldest_to_latest" | "alphabetical";
type StudentStatusSortMode = "paid" | "unpaid";

const DEFAULT_STUDENT_ROWS_PER_PAGE = 10;
const STUDENT_ROWS_PER_PAGE_OPTIONS = ["10", "25", "50", "100"] as const;

const paymentStudentColumns: CampusTableColumn<PaymentStudent>[] = [
  { key: "schoolId", label: "Student ID" },
  { key: "name", label: "Name" },
  { key: "course", label: "Course" },
  { key: "year", label: "Year Level" },
  { key: "section", label: "Section" },
  { key: "status", label: "Status" },
  { key: "actions", label: "Action" },
];

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

function mapRemoteStudent(data: RemoteStudent): StudentProfile {
  const uid = String(data.uid ?? "").trim();
  const schoolId = String(data.schoolId ?? "").trim() || uid;
  const name = formatStudentFullName(
    {
      firstName: data.firstName,
      lastName: data.lastName,
      fullName: data.fullName,
      studentName: data.studentName,
      name: data.name,
      schoolId,
    },
    schoolId,
  );
  const course = String(data.course ?? "").trim() || "Unassigned";
  const year = normalizeYear(data.year);
  const section = String(data.section ?? "").trim() || "-";

  return {
    uid,
    schoolId,
    name,
    year,
    section,
    course,
  };
}

function getFirstFilledText(...values: unknown[]) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function normalizePaymentStudentStatus(value: unknown): PaymentStudentStatus {
  return getFirstFilledText(value).toLowerCase() === "paid" ? "Paid" : "Unpaid";
}

function sortStudentsByNameAndId(
  left: Pick<StudentProfile, "name" | "schoolId">,
  right: Pick<StudentProfile, "name" | "schoolId">,
) {
  return (
    left.name.localeCompare(right.name) ||
    left.schoolId.localeCompare(right.schoolId)
  );
}

function mapPaymentStudentRecord(
  studentId: string,
  data: PaymentStudentDocData,
): PaymentStudent {
  const uid = getFirstFilledText(data.uid, studentId) || studentId;
  const schoolId = getFirstFilledText(data.schoolId, uid) || uid;
  const status = normalizePaymentStudentStatus(data.status);

  return {
    uid,
    schoolId,
    name:
      getFirstFilledText(data.name, data.studentName, data.fullName, schoolId) ||
      schoolId,
    year: normalizeYear(data.year ?? data.yearLevel),
    section: getFirstFilledText(data.section, "-") || "-",
    course: getFirstFilledText(data.course, "Unassigned") || "Unassigned",
    status,
    paidDate:
      data.paidDate ??
      data.paidAt ??
      data.paidOn ??
      (status === "Paid" ? data.updatedAt : null),
    referenceNumber: getFirstFilledText(
      data.referenceNumber,
      data.referenceNo,
      data.refNumber,
      data.reference,
    ),
    remarks: getFirstFilledText(data.remarks, data.note, data.notes),
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
  };
}

function mapPaymentRecord(
  paymentDoc: QueryDocumentSnapshot<DocumentData>,
): Payment | null {
  const data = paymentDoc.data() as Partial<Payment>;
  if (String(data.status ?? "").trim().toLowerCase() === "archived") {
    return null;
  }

  return {
    id: paymentDoc.id,
    title: String(data.title ?? "Untitled Payment"),
    ref: String(data.ref ?? makePaymentRef(paymentDoc.id)),
    amount: Number(data.amount ?? 0),
    date: String(data.date ?? ""),
    yearLevel:
      typeof data.yearLevel === "string"
        ? data.yearLevel
        : "All Years",
    course:
      typeof data.course === "string" ? data.course : "All Courses",
    targetStudent: String(data.targetStudent ?? ""),
    details: String(data.details ?? ""),
    totalStudents: Number(data.totalStudents ?? 0),
    paidCount: Number(data.paidCount ?? 0),
    unpaidCount: Number(data.unpaidCount ?? 0),
    linkedEventId: String(data.linkedEventId ?? "").trim(),
    linkedEventTitle: String(data.linkedEventTitle ?? "").trim(),
    source: String(data.source ?? "").trim(),
    status: String(data.status ?? "").trim(),
    createdByUid: String(data.createdByUid ?? "").trim(),
    createdByCourseScope:
      typeof data.createdByCourseScope === "string"
        ? data.createdByCourseScope
        : null,
    courseScope:
      typeof data.courseScope === "string" ? data.courseScope : null,
    createdAt: data.createdAt,
  };
}

function matchesPaymentFilters(
  student: StudentProfile,
  yearLevel: string,
  course: string,
) {
  const matchesYear = yearLevel === "All Years" || student.year === yearLevel;
  const matchesCourse = course === "All Courses" || student.course === course;
  return matchesYear && matchesCourse;
}

function getStudentSearchText(student: StudentProfile) {
  return [
    student.name,
    student.schoolId,
    student.course,
    student.year,
    student.section,
  ]
    .join(" ")
    .toLowerCase();
}

function formatTargetStudentSummary(students: StudentProfile[]) {
  return students
    .map((student) => `${student.name} (${student.schoolId})`)
    .join("; ");
}

function parsePaymentSpecificStudents(
  targetStudent: string | undefined,
  allStudents: StudentProfile[],
) {
  const tokens = String(targetStudent ?? "")
    .split(";")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return [] as StudentProfile[];
  }

  const seen = new Set<string>();
  const selected: StudentProfile[] = [];

  tokens.forEach((token) => {
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
        (student) => student.name.toLowerCase() === studentName.toLowerCase(),
      );

    if (!fromOptions || seen.has(fromOptions.uid)) {
      return;
    }

    seen.add(fromOptions.uid);
    selected.push(fromOptions);
  });

  return selected.sort(sortStudentsByNameAndId);
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string) {
  if (!value) return "-";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString();
}

function toMillis(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toMillis?: () => number }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { seconds?: number }).seconds === "number"
  ) {
    return Number((value as { seconds: number }).seconds) * 1000;
  }
  const parsed = new Date(value as string | number | Date).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toPaymentDateMs(payment: Payment) {
  const rawDate = String(payment.date ?? "").trim();
  if (rawDate) {
    const parsed = new Date(`${rawDate}T00:00:00`).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return toMillis(payment.createdAt);
}

function makePaymentRef(paymentId: string) {
  const year = new Date().getFullYear();
  return `PMT-${year}-${paymentId.slice(0, 6).toUpperCase()}`;
}

function toCsvLine(values: Array<string | number>) {
  return values
    .map((value) => {
      const safe = String(value ?? "");
      if (safe.includes(",") || safe.includes('"') || safe.includes("\n")) {
        return `"${safe.replace(/"/g, '""')}"`;
      }
      return safe;
    })
    .join(",");
}

function getDefaultPaymentStudentPagination(): PaymentStudentPaginationState {
  return {
    page: 1,
    rowsPerPage: DEFAULT_STUDENT_ROWS_PER_PAGE,
  };
}

function formatStudentRangeSummary(
  pageStartIndex: number,
  visibleCount: number,
  totalCount: number,
) {
  if (totalCount <= 0 || visibleCount <= 0) {
    return "Showing 0 of 0 students";
  }

  const start = pageStartIndex + 1;
  const end = pageStartIndex + visibleCount;
  return `Showing ${start}-${end} of ${totalCount} students`;
}

export default function PaymentDashboard() {
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);
  const [authUid, setAuthUid] = useState("");
  const [viewerProfile, setViewerProfile] = useState<CampusProfileDoc | null>(null);
  const [viewerProfileLoading, setViewerProfileLoading] = useState(true);

  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);
  const [showAddPaymentForm, setShowAddPaymentForm] = useState(false);

  const [queryText, setQueryText] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [paymentSortMode, setPaymentSortMode] =
    useState<SortMode>("latest_to_oldest");

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [yearLevel, setYearLevel] = useState("All Years");
  const [course, setCourse] = useState("All Courses");
  const [paymentTargetSearchText, setPaymentTargetSearchText] = useState("");
  const [selectedPaymentStudents, setSelectedPaymentStudents] = useState<
    StudentProfile[]
  >([]);
  const [showPaymentStudentDropdown, setShowPaymentStudentDropdown] =
    useState(false);
  const [details, setDetails] = useState("");

  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [expandedStudentsLoading, setExpandedStudentsLoading] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [exportingAllPayments, setExportingAllPayments] = useState(false);
  const [deletingPaymentId, setDeletingPaymentId] = useState<string | null>(null);
  const [updatingStatusKey, setUpdatingStatusKey] = useState<string | null>(
    null,
  );
  const [studentSearchText, setStudentSearchText] = useState("");
  const [studentYearFilter, setStudentYearFilter] = useState<string>("");
  const [studentCourseFilter, setStudentCourseFilter] = useState<string>("");
  const [studentStatusSortMode, setStudentStatusSortMode] =
    useState<StudentStatusSortMode>("paid");
  const [paymentStudentPagination, setPaymentStudentPagination] = useState<
    Record<string, PaymentStudentPaginationState>
  >({});

  const [notice, setNotice] = useState<Notice | null>(null);
  const [paymentStudents, setPaymentStudents] = useState<
    Record<string, PaymentStudent[]>
  >({});
  const paymentStudentPickerRef = useRef<HTMLDivElement | null>(null);
  const paymentEditorRef = useRef<HTMLDivElement | null>(null);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [paymentPendingDelete, setPaymentPendingDelete] = useState<Payment | null>(
    null,
  );

  const viewerProfileWithUid = useMemo(
    () =>
      authUid ?
        ({uid: authUid, ...(viewerProfile ?? {})} as ViewerProfile) :
        null,
    [authUid, viewerProfile],
  );
  const viewerIsBod = useMemo(
    () => isBOD(viewerProfileWithUid),
    [viewerProfileWithUid],
  );
  const viewerCourseScope = useMemo(
    () => getCourseScope(viewerProfileWithUid),
    [viewerProfileWithUid],
  );
  const selectedPaymentCourse =
    viewerIsBod && viewerCourseScope ? viewerCourseScope : course;

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setAuthUid("");
        setViewerProfile(null);
        setViewerProfileLoading(false);
        return;
      }

      setAuthUid(user.uid);
      setViewerProfileLoading(true);
      try {
        const profileSnap = await getDoc(doc(db, "profiles", user.uid));
        setViewerProfile(
          profileSnap.exists() ?
            (profileSnap.data() as CampusProfileDoc) :
            null,
        );
      } catch {
        setViewerProfile(null);
      } finally {
        setViewerProfileLoading(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (viewerIsBod && viewerCourseScope) {
      setCourse(viewerCourseScope);
    }
  }, [viewerCourseScope, viewerIsBod]);

  useEffect(() => {
    let mounted = true;

    async function loadStudents() {
      if (viewerProfileLoading) {
        return;
      }

      if (viewerIsBod && !viewerCourseScope) {
        if (mounted) {
          setStudents([]);
          setStudentsLoading(false);
        }
        return;
      }

      setStudentsLoading(true);

      try {
        const fn = httpsCallable<
          { limit: number; includeEcMembers?: boolean },
          { students?: RemoteStudent[] }
        >(functions, "ecListStudents");
        const res = await fn({ limit: 2000, includeEcMembers: true });
        if (!mounted) return;

        const list = (res.data?.students ?? [])
          .map(mapRemoteStudent)
          .filter((item) => item.uid)
          .sort(sortStudentsByNameAndId);
        const scopedList =
          viewerIsBod && viewerCourseScope ?
            list.filter(
              (student) =>
                normalizeCourse(student.course) === viewerCourseScope,
            ) :
            list;
        setStudents(scopedList);
      } catch (error: unknown) {
        if (!mounted) return;
        setStudents([]);
        setNotice({
          type: "err",
          msg: toErrorMessage(error, "Failed to load students."),
        });
      } finally {
        if (mounted) setStudentsLoading(false);
      }
    }

    void loadStudents();
    return () => {
      mounted = false;
    };
  }, [functions, viewerCourseScope, viewerIsBod, viewerProfileLoading]);

  useEffect(() => {
    if (viewerProfileLoading) {
      return;
    }

    if (viewerIsBod && !viewerCourseScope) {
      setPayments([]);
      setPaymentsLoading(false);
      return;
    }

    setPaymentsLoading(true);
    const sortRows = (rows: Payment[]) =>
      [...rows].sort((left, right) => toMillis(right.createdAt) - toMillis(left.createdAt));

    if (viewerIsBod && viewerCourseScope) {
      let courseRows: Payment[] = [];
      let courseScopeRows: Payment[] = [];
      let createdByCourseScopeRows: Payment[] = [];

      const syncRows = () => {
        const merged = new Map<string, Payment>();
        [...courseRows, ...courseScopeRows, ...createdByCourseScopeRows].forEach(
          (payment) => {
            merged.set(payment.id, payment);
          },
        );
        setPayments(sortRows(Array.from(merged.values())));
        setPaymentsLoading(false);
      };

      const handleLoadError = (error: unknown) => {
        setNotice({
          type: "err",
          msg: toErrorMessage(error, "Failed to load payments."),
        });
      };

      const unsubCourse = onSnapshot(
        query(collection(db, "payments"), where("course", "==", viewerCourseScope)),
        (snap) => {
          courseRows = snap.docs
            .map(mapPaymentRecord)
            .filter((payment): payment is Payment => payment !== null);
          syncRows();
        },
        (error) => {
          courseRows = [];
          syncRows();
          handleLoadError(error);
        },
      );

      const unsubCourseScope = onSnapshot(
        query(
          collection(db, "payments"),
          where("courseScope", "==", viewerCourseScope),
        ),
        (snap) => {
          courseScopeRows = snap.docs
            .map(mapPaymentRecord)
            .filter((payment): payment is Payment => payment !== null);
          syncRows();
        },
        (error) => {
          courseScopeRows = [];
          syncRows();
          handleLoadError(error);
        },
      );

      const unsubCreatedByCourseScope = onSnapshot(
        query(
          collection(db, "payments"),
          where("createdByCourseScope", "==", viewerCourseScope),
        ),
        (snap) => {
          createdByCourseScopeRows = snap.docs
            .map(mapPaymentRecord)
            .filter((payment): payment is Payment => payment !== null);
          syncRows();
        },
        (error) => {
          createdByCourseScopeRows = [];
          syncRows();
          handleLoadError(error);
        },
      );

      return () => {
        unsubCourse();
        unsubCourseScope();
        unsubCreatedByCourseScope();
      };
    }

    const unsub = onSnapshot(
      query(collection(db, "payments"), orderBy("createdAt", "desc")),
      (snap) => {
        setPayments(
          snap.docs
            .map(mapPaymentRecord)
            .filter((payment): payment is Payment => payment !== null),
        );
        setPaymentsLoading(false);
      },
      (error) => {
        setPayments([]);
        setPaymentsLoading(false);
        setNotice({
          type: "err",
          msg: toErrorMessage(error, "Failed to load payments."),
        });
      },
    );

    return () => unsub();
  }, [viewerCourseScope, viewerIsBod, viewerProfileLoading]);

  useEffect(() => {
    if (!expandedPayment) return;

    setExpandedStudentsLoading(true);
    const qy = query(
      collection(db, "payments", expandedPayment, "students"),
      orderBy("name", "asc"),
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: PaymentStudent[] = snap.docs.map((d) =>
          mapPaymentStudentRecord(d.id, d.data() as PaymentStudentDocData),
        );

        setPaymentStudents((prev) => ({ ...prev, [expandedPayment]: list }));
        setExpandedStudentsLoading(false);
      },
      (error) => {
        setExpandedStudentsLoading(false);
        setNotice({
          type: "err",
          msg: toErrorMessage(error, "Failed to load payment students."),
        });
      },
    );

    return () => unsub();
  }, [expandedPayment]);

  useEffect(() => {
    setStudentSearchText("");
    setStudentYearFilter("");
    setStudentCourseFilter("");
    setStudentStatusSortMode("paid");
  }, [expandedPayment]);

  useEffect(() => {
    if (!showAddPaymentForm) {
      setShowPaymentStudentDropdown(false);
      return;
    }

    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (paymentStudentPickerRef.current?.contains(target)) return;
      setShowPaymentStudentDropdown(false);
    };

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [showAddPaymentForm]);

  useEffect(() => {
    if (!showAddPaymentForm || !editingPaymentId || students.length === 0) {
      return;
    }

    const currentEditingPayment =
      payments.find((payment) => payment.id === editingPaymentId) ?? null;
    if (!currentEditingPayment) {
      return;
    }
    if (
      viewerIsBod &&
      !(
        canManagePayment(viewerProfileWithUid, {
          course: currentEditingPayment.course,
          courseScope: currentEditingPayment.courseScope,
          createdByCourseScope: currentEditingPayment.createdByCourseScope,
        }) ||
        canEditPayment(viewerProfileWithUid, {
          course: currentEditingPayment.course,
          courseScope: currentEditingPayment.courseScope,
          createdByUid: currentEditingPayment.createdByUid,
          createdByCourseScope: currentEditingPayment.createdByCourseScope,
        })
      )
    ) {
      return;
    }

    setSelectedPaymentStudents((prev) =>
      prev.length > 0 ?
        prev :
        parsePaymentSpecificStudents(
          currentEditingPayment.targetStudent,
          students,
        ),
    );
  }, [
    editingPaymentId,
    payments,
    showAddPaymentForm,
    students,
    viewerIsBod,
    viewerProfileWithUid,
  ]);

  const courseOptions = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.course && s.course !== "Unassigned") set.add(s.course);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const yearOptions = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => {
      if (s.year && s.year !== "Unassigned") set.add(s.year);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [students]);

  const paymentYearSelectItems = useMemo<SelectOption[]>(
    () => [
      { key: "All Years", label: "All Years" },
      ...yearOptions.map((yearName) => ({ key: yearName, label: yearName })),
    ],
    [yearOptions],
  );

  const paymentCourseSelectItems = useMemo<SelectOption[]>(
    () => [
      { key: "All Courses", label: "All Courses" },
      ...courseOptions.map((courseName) => ({
        key: courseName,
        label: courseName,
      })),
    ],
    [courseOptions],
  );
  const selectedPaymentStudentIds = useMemo(
    () => new Set(selectedPaymentStudents.map((student) => student.uid)),
    [selectedPaymentStudents],
  );
  const filteredPaymentStudentOptions = useMemo(() => {
    const search = paymentTargetSearchText.trim().toLowerCase();

    return students
      .filter((student) => {
        if (selectedPaymentStudentIds.has(student.uid)) return false;
        if (!search) return true;
        return getStudentSearchText(student).includes(search);
      })
      .slice(0, 20);
  }, [paymentTargetSearchText, selectedPaymentStudentIds, students]);
  const hasSpecificStudentTargets = selectedPaymentStudents.length > 0;
  const hasYearFilter = yearLevel !== "All Years";
  const hasCourseFilter = selectedPaymentCourse !== "All Courses";

  const canManagePaymentRecord = useMemo(
    () =>
      (payment: Payment) =>
        canManagePayment(viewerProfileWithUid, {
          course: payment.course,
          courseScope: payment.courseScope,
          createdByCourseScope: payment.createdByCourseScope,
        }),
    [viewerProfileWithUid],
  );
  const canEditPaymentRecord = useMemo(
    () =>
      (payment: Payment) =>
        canEditPayment(viewerProfileWithUid, {
          course: payment.course,
          courseScope: payment.courseScope,
          createdByUid: payment.createdByUid,
          createdByCourseScope: payment.createdByCourseScope,
        }),
    [viewerProfileWithUid],
  );
  const visiblePayments = useMemo(
    () =>
      viewerIsBod
        ? payments.filter(
            (payment) =>
              canManagePaymentRecord(payment) || canEditPaymentRecord(payment),
          )
        : payments,
    [canEditPaymentRecord, canManagePaymentRecord, payments, viewerIsBod],
  );
  const filteredPayments = useMemo(() => {
    const search = queryText.trim().toLowerCase();

    return visiblePayments.filter((p) => {
      const matchesDate = !dateFilter || p.date === dateFilter;

      const matchesSearch =
        !search ||
        p.title.toLowerCase().includes(search) ||
        p.ref.toLowerCase().includes(search) ||
        p.course.toLowerCase().includes(search) ||
        p.yearLevel.toLowerCase().includes(search) ||
        p.targetStudent.toLowerCase().includes(search);

      return matchesDate && matchesSearch;
    });
  }, [dateFilter, queryText, visiblePayments]);

  const sortedFilteredPayments = useMemo(() => {
    const list = [...filteredPayments];
    if (paymentSortMode === "alphabetical") {
      list.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      );
      return list;
    }

    list.sort((a, b) => {
      const aMs = toPaymentDateMs(a);
      const bMs = toPaymentDateMs(b);
      return paymentSortMode === "oldest_to_latest" ? aMs - bMs : bMs - aMs;
    });
    return list;
  }, [filteredPayments, paymentSortMode]);

  const paymentSortLabel = useMemo(() => {
    if (paymentSortMode === "oldest_to_latest") return "Date, old to new";
    if (paymentSortMode === "alphabetical") return "Alphabetically, A-Z";
    return "Date, new to old";
  }, [paymentSortMode]);
  const editingPayment = useMemo(
    () =>
      visiblePayments.find((payment) => payment.id === editingPaymentId) ?? null,
    [editingPaymentId, visiblePayments],
  );
  const paymentEditorMode: PaymentEditorMode =
    editingPayment ? "edit" : "create";
  const editingLinkedPayment = Boolean(
    editingPayment?.source === "event" || editingPayment?.linkedEventId,
  );

  const studentStatusSortLabel = useMemo(
    () => (studentStatusSortMode === "paid" ? "Paid" : "Unpaid"),
    [studentStatusSortMode],
  );
  const studentRowsPerPageItems = useMemo<SelectOption[]>(
    () =>
      STUDENT_ROWS_PER_PAGE_OPTIONS.map((value) => ({
        key: value,
        label: value,
      })),
    [],
  );

  const dashboardCounts = useMemo(() => {
    const pending = visiblePayments.filter(
      (payment) => payment.totalStudents > 0 && payment.unpaidCount > 0,
    ).length;
    const completed = visiblePayments.filter(
      (payment) => payment.totalStudents > 0 && payment.unpaidCount === 0,
    ).length;
    return { total: visiblePayments.length, pending, completed };
  }, [visiblePayments]);

  const totalPaymentValue = useMemo(
    () =>
      visiblePayments.reduce(
        (sum, payment) => sum + Number(payment.amount || 0),
        0,
      ),
    [visiblePayments],
  );

  const paymentSummaryItems = useMemo<ECStatItem[]>(
    () => [
      {
        label: "Total Payments",
        value: dashboardCounts.total,
        description: "All payment records in view",
        tone: "blue",
        icon: CreditCard,
      },
      {
        label: "Pending",
        value: dashboardCounts.pending,
        description: "Still waiting on unpaid assignments",
        tone: "amber",
        icon: Hourglass,
      },
      {
        label: "Completed",
        value: dashboardCounts.completed,
        description: "Fully settled payment records",
        tone: "green",
        icon: ReceiptText,
      },
      {
        label: "Total Value",
        value: formatCurrency(totalPaymentValue),
        description: "Sum of configured payment amounts",
        tone: "purple",
        icon: CircleDollarSign,
      },
    ],
    [dashboardCounts.completed, dashboardCounts.pending, dashboardCounts.total, totalPaymentValue],
  );

  function resetForm() {
    setTitle("");
    setAmount("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setYearLevel("All Years");
    setCourse("All Courses");
    setPaymentTargetSearchText("");
    setSelectedPaymentStudents([]);
    setShowPaymentStudentDropdown(false);
    setDetails("");
  }

  function scrollPaymentEditorIntoView() {
    requestAnimationFrame(() => {
      paymentEditorRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function closePaymentEditor() {
    setShowAddPaymentForm(false);
    setEditingPaymentId(null);
    resetForm();
  }

  function openCreatePaymentEditor() {
    setNotice(null);
    setEditingPaymentId(null);
    resetForm();
    setShowAddPaymentForm(true);
    scrollPaymentEditorIntoView();
  }

  function openEditPaymentEditor(payment: Payment) {
    if (!canEditPaymentRecord(payment)) {
      campusToast.warning({
        title: "You do not have permission to edit this payment.",
        preventDuplicate: false,
      });
      return;
    }

    setNotice(null);
    setEditingPaymentId(payment.id);
    setTitle(payment.title);
    setAmount(String(payment.amount || ""));
    setPaymentDate(
      payment.date || new Date().toISOString().slice(0, 10),
    );
    setYearLevel(payment.yearLevel || "All Years");
    setCourse(payment.course || "All Courses");
    setPaymentTargetSearchText("");
    setSelectedPaymentStudents(
      parsePaymentSpecificStudents(payment.targetStudent, students),
    );
    setShowPaymentStudentDropdown(false);
    setDetails(payment.details);
    setShowAddPaymentForm(true);
    scrollPaymentEditorIntoView();
  }

  function resolvePaymentTargets() {
    const targetMap = new Map<string, StudentProfile>();
    const shouldApplyFilterTargets =
      !hasSpecificStudentTargets || hasYearFilter || hasCourseFilter;

    if (shouldApplyFilterTargets) {
      students.forEach((student) => {
        if (matchesPaymentFilters(student, yearLevel, selectedPaymentCourse)) {
          targetMap.set(student.uid, student);
        }
      });
    }

    selectedPaymentStudents.forEach((student) => {
      targetMap.set(student.uid, student);
    });

    const targets = Array.from(targetMap.values()).sort(sortStudentsByNameAndId);

    if (!targets.length) {
      throw new Error(
        "No students match the selected filters or specific-student selection.",
      );
    }

    return {
      targets,
      targetStudent: formatTargetStudentSummary(selectedPaymentStudents),
      resolvedYearLevel: hasYearFilter
        ? yearLevel
        : hasSpecificStudentTargets
          ? ""
          : "All Years",
      resolvedCourse: hasCourseFilter
        ? selectedPaymentCourse
        : hasSpecificStudentTargets
          ? ""
          : "All Courses",
      resolvedCourseScope:
        hasCourseFilter && selectedPaymentCourse !== "All Courses"
          ? selectedPaymentCourse
          : viewerIsBod && viewerCourseScope
            ? viewerCourseScope
            : null,
    };
  }

  async function loadPaymentStudentsForAssignmentSync(paymentId: string) {
    const hasCachedRows = Object.prototype.hasOwnProperty.call(
      paymentStudents,
      paymentId,
    );

    if (hasCachedRows) {
      return [...(paymentStudents[paymentId] ?? [])];
    }

    const studentSnap = await getDocs(collection(db, "payments", paymentId, "students"));
    return studentSnap.docs
      .map((studentDoc) =>
        mapPaymentStudentRecord(
          studentDoc.id,
          studentDoc.data() as PaymentStudentDocData,
        ),
      )
      .sort(sortStudentsByNameAndId);
  }

  async function syncPaymentAssignments(
    paymentId: string,
    targets: StudentProfile[],
  ) {
    const existingAssignments = new Map<string, PaymentStudent>();
    (await loadPaymentStudentsForAssignmentSync(paymentId)).forEach((student) => {
      existingAssignments.set(student.uid, student);
    });

    const writesPerBatch = 350;
    const nextTargetIds = new Set(targets.map((student) => student.uid));
    let paidCount = 0;

    const upsertRows = targets.map((student) => {
      const existingStatus = existingAssignments.get(student.uid)?.status ?? "Unpaid";
      if (existingStatus === "Paid") {
        paidCount += 1;
      }

      return {
        student,
        status: existingStatus,
      };
    });

    for (let index = 0; index < upsertRows.length; index += writesPerBatch) {
      const batch = writeBatch(db);
      const chunk = upsertRows.slice(index, index + writesPerBatch);

      chunk.forEach(({ student, status }) => {
        batch.set(
          doc(db, "payments", paymentId, "students", student.uid),
          {
            uid: student.uid,
            schoolId: student.schoolId,
            name: student.name,
            year: student.year,
            section: student.section,
            course: student.course,
            status,
            updatedAt: serverTimestamp(),
            ...(existingAssignments.has(student.uid)
              ? {}
              : { createdAt: serverTimestamp() }),
          },
          { merge: true },
        );
      });

      await batch.commit();
    }

    const removedAssignmentIds = Array.from(existingAssignments.keys()).filter(
      (uid) => !nextTargetIds.has(uid),
    );

    for (
      let index = 0;
      index < removedAssignmentIds.length;
      index += writesPerBatch
    ) {
      const batch = writeBatch(db);
      removedAssignmentIds
        .slice(index, index + writesPerBatch)
        .forEach((uid) => {
          batch.delete(doc(db, "payments", paymentId, "students", uid));
        });
      await batch.commit();
    }

    return {
      totalStudents: targets.length,
      paidCount,
      unpaidCount: Math.max(0, targets.length - paidCount),
    };
  }

  function getPaymentStudentPaginationState(paymentId: string) {
    return paymentStudentPagination[paymentId] ?? getDefaultPaymentStudentPagination();
  }

  function setPaymentStudentPage(paymentId: string, page: number) {
    setPaymentStudentPagination((prev) => {
      const current = prev[paymentId] ?? getDefaultPaymentStudentPagination();
      if (current.page === page) {
        return prev;
      }

      return {
        ...prev,
        [paymentId]: {
          ...current,
          page,
        },
      };
    });
  }

  function resetPaymentStudentPage(paymentId: string) {
    setPaymentStudentPagination((prev) => {
      const current = prev[paymentId] ?? getDefaultPaymentStudentPagination();
      if (current.page === 1) {
        return prev;
      }

      return {
        ...prev,
        [paymentId]: {
          ...current,
          page: 1,
        },
      };
    });
  }

  function setPaymentStudentRowsPerPage(
    paymentId: string,
    rowsPerPage: number,
  ) {
    setPaymentStudentPagination((prev) => {
      const current = prev[paymentId] ?? getDefaultPaymentStudentPagination();
      if (current.rowsPerPage === rowsPerPage && current.page === 1) {
        return prev;
      }

      return {
        ...prev,
        [paymentId]: {
          ...current,
          rowsPerPage,
          page: 1,
        },
      };
    });
  }

  async function loadPaymentStudentsForExport(paymentId: string) {
    const hasCachedRows = Object.prototype.hasOwnProperty.call(
      paymentStudents,
      paymentId,
    );

    if (hasCachedRows) {
      return filterRowsByCourseScope(
        [...(paymentStudents[paymentId] ?? [])].sort(sortStudentsByNameAndId),
        viewerIsBod ? viewerCourseScope : null,
      );
    }

    const studentSnap = await getDocs(collection(db, "payments", paymentId, "students"));
    const rows = studentSnap.docs
      .map((studentDoc) =>
        mapPaymentStudentRecord(
          studentDoc.id,
          studentDoc.data() as PaymentStudentDocData,
        ),
      )
      .sort(sortStudentsByNameAndId);

    return filterRowsByCourseScope(
      rows,
      viewerIsBod ? viewerCourseScope : null,
    );
  }

  async function handleExportAllPaymentReport() {
    const exportablePayments = [...visiblePayments.filter((payment) =>
      canManagePaymentRecord(payment),
    )];

    if (paymentSortMode === "alphabetical") {
      exportablePayments.sort((left, right) =>
        left.title.localeCompare(right.title, undefined, {
          sensitivity: "base",
        }),
      );
    } else {
      exportablePayments.sort((left, right) => {
        const leftMs = toPaymentDateMs(left);
        const rightMs = toPaymentDateMs(right);
        return paymentSortMode === "oldest_to_latest"
          ? leftMs - rightMs
          : rightMs - leftMs;
      });
    }

    if (!exportablePayments.length) {
      campusToast.warning({
        title: "No payment records to export.",
        preventDuplicate: false,
      });
      return;
    }

    setExportingAllPayments(true);

    try {
      const workbookPayments = await Promise.all(
        exportablePayments.map(async (payment) => {
          const rows = await loadPaymentStudentsForExport(payment.id);

          return {
            id: payment.id,
            title: payment.title,
            amount: payment.amount,
            description: payment.details,
            dueDate: payment.date,
            linkedEventTitle: payment.linkedEventTitle,
            createdAt: payment.createdAt,
            students: rows.map((row) => ({
              schoolId: row.schoolId || row.uid,
              fullName: row.name,
              course: row.course,
              yearLevel: row.year,
              status: row.status,
              paidDate: row.paidDate,
              referenceNumber: row.referenceNumber,
              remarks: row.remarks,
            })),
          };
        }),
      );

      await exportPaymentWorkbook(workbookPayments);
      campusToast.success({
        title: "Payment report exported successfully.",
        preventDuplicate: false,
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error, "Failed to export payment report.");

      campusToast.error({
        title: "Failed to export payment report.",
        description:
          message !== "Failed to export payment report." ? message : undefined,
        preventDuplicate: false,
      });
    } finally {
      setExportingAllPayments(false);
    }
  }

  async function handleSavePayment() {
    setNotice(null);

    const cleanTitle = title.trim();
    const amountValue = Number(amount);
    const cleanDetails = details.trim();
    const editingCurrentPayment = editingPayment;
    const isEditing = Boolean(editingCurrentPayment);

    if (!cleanTitle) {
      setNotice({ type: "err", msg: "Payment title is required." });
      return;
    }

    if (!Number.isFinite(amountValue) || amountValue <= 0) {
      setNotice({ type: "err", msg: "Amount must be greater than 0." });
      return;
    }

    if (!paymentDate) {
      setNotice({ type: "err", msg: "Date is required." });
      return;
    }

    if (studentsLoading) {
      setNotice({
        type: "err",
        msg: "Students are still loading. Please wait.",
      });
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setNotice({
        type: "err",
        msg: `You must be signed in to ${isEditing ? "update" : "create"} payments.`,
      });
      return;
    }

    setSavingPayment(true);

    try {
      if (
        isEditing &&
        editingCurrentPayment &&
        !canEditPaymentRecord(editingCurrentPayment)
      ) {
        throw new Error("You do not have permission to edit this payment.");
      }

      const paymentRef = isEditing && editingCurrentPayment
        ? doc(db, "payments", editingCurrentPayment.id)
        : doc(collection(db, "payments"));
      const paymentRefCode =
        editingCurrentPayment?.ref || makePaymentRef(paymentRef.id);

      if (isEditing && editingCurrentPayment && editingLinkedPayment) {
        await setDoc(
          paymentRef,
          {
            title: cleanTitle,
            amount: amountValue,
            date: paymentDate,
            details: cleanDetails,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );

        closePaymentEditor();
        setNotice({
          type: "ok",
          msg: "Payment updated successfully.",
        });
        campusToast.success({
          title: "Payment updated successfully.",
          preventDuplicate: false,
        });
        return;
      }

      const {
        targets,
        targetStudent,
        resolvedYearLevel,
        resolvedCourse,
        resolvedCourseScope,
      } = resolvePaymentTargets();
      const basePaymentPayload = {
        title: cleanTitle,
        ref: paymentRefCode,
        amount: amountValue,
        date: paymentDate,
        yearLevel: resolvedYearLevel,
        course: resolvedCourse,
        targetStudent,
        details: cleanDetails,
        createdByUid: editingCurrentPayment?.createdByUid || currentUser.uid,
        createdByRole: "ecmember",
        createdByCourseScope:
          editingCurrentPayment?.createdByCourseScope ?? viewerCourseScope ?? null,
        courseScope:
          editingCurrentPayment?.source === "event"
            ? editingCurrentPayment.courseScope ?? null
            : resolvedCourseScope,
        linkedEventId: editingCurrentPayment?.linkedEventId ?? null,
        linkedEventTitle: editingCurrentPayment?.linkedEventTitle ?? "",
        source: editingCurrentPayment?.source || "manual",
        status: editingCurrentPayment?.status || "active",
      };

      if (!isEditing) {
        await setDoc(
          paymentRef,
          {
            ...basePaymentPayload,
            totalStudents: targets.length,
            paidCount: 0,
            unpaidCount: targets.length,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      }

      const assignmentSummary = await syncPaymentAssignments(paymentRef.id, targets);

      await setDoc(
        paymentRef,
        {
          ...basePaymentPayload,
          totalStudents: assignmentSummary.totalStudents,
          paidCount: assignmentSummary.paidCount,
          unpaidCount: assignmentSummary.unpaidCount,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      setPaymentStudents((prev) => {
        const next = { ...prev };
        delete next[paymentRef.id];
        return next;
      });
      closePaymentEditor();
      setNotice({
        type: "ok",
        msg: isEditing
          ? "Payment updated successfully."
          : `Payment created and assigned to ${assignmentSummary.totalStudents} student(s).`,
      });
      if (isEditing) {
        campusToast.success({
          title: "Payment updated successfully.",
          preventDuplicate: false,
        });
      } else {
        campusToast.success({
          title: "Payment created",
          description: `Assigned to ${assignmentSummary.totalStudents} student(s).`,
          dedupeKey: `ec-payments:create:${paymentRef.id}`,
        });
      }
    } catch (error: unknown) {
      const message = toErrorMessage(
        error,
        isEditing ? "Failed to update payment." : "Failed to save payment.",
      );
      setNotice({ type: "err", msg: message });
      campusToast.error({
        title: isEditing
          ? "Failed to update payment."
          : "Save payment failed",
        description:
          !isEditing && message ? message : undefined,
        dedupeKey: isEditing ? "ec-payments:update-error" : "ec-payments:create-error",
        preventDuplicate: false,
      });
    } finally {
      setSavingPayment(false);
    }
  }

  function promptDeletePayment(payment: Payment) {
    if (!canEditPaymentRecord(payment)) {
      campusToast.warning({
        title: "You do not have permission to delete this payment.",
        preventDuplicate: false,
      });
      return;
    }

    setPaymentPendingDelete(payment);
  }

  async function handleConfirmDeletePayment() {
    const payment = paymentPendingDelete;
    if (!payment) {
      return;
    }

    if (!canEditPaymentRecord(payment)) {
      campusToast.warning({
        title: "You do not have permission to delete this payment.",
        preventDuplicate: false,
      });
      setPaymentPendingDelete(null);
      return;
    }

    setDeletingPaymentId(payment.id);
    setNotice(null);

    try {
      const paymentStudentSnap = await getDocs(
        collection(db, "payments", payment.id, "students"),
      );
      const linkedEventRef = payment.linkedEventId
        ? doc(db, "events", payment.linkedEventId)
        : null;
      const linkedEventSnap =
        linkedEventRef ? await getDoc(linkedEventRef) : null;
      const paymentStudentIds = paymentStudentSnap.docs.map((docSnap) => docSnap.id);
      const writesPerBatch = 350;

      if (paymentStudentIds.length === 0) {
        const batch = writeBatch(db);

        if (linkedEventRef && linkedEventSnap?.exists()) {
          batch.set(
            linkedEventRef,
            {
              withPayment: false,
              paymentRequired: false,
              requiredPaymentId: "",
              linkedPaymentId: null,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }

        batch.delete(doc(db, "payments", payment.id));
        await batch.commit();
      } else {
        for (
          let index = 0;
          index < paymentStudentIds.length;
          index += writesPerBatch
        ) {
          const batch = writeBatch(db);
          const chunk = paymentStudentIds.slice(index, index + writesPerBatch);

          chunk.forEach((studentUid) => {
            batch.delete(doc(db, "payments", payment.id, "students", studentUid));
          });

          if (index + writesPerBatch >= paymentStudentIds.length) {
            if (linkedEventRef && linkedEventSnap?.exists()) {
              batch.set(
                linkedEventRef,
                {
                  withPayment: false,
                  paymentRequired: false,
                  requiredPaymentId: "",
                  linkedPaymentId: null,
                  updatedAt: serverTimestamp(),
                },
                { merge: true },
              );
            }

            batch.delete(doc(db, "payments", payment.id));
          }

          await batch.commit();
        }
      }

      setPaymentStudents((prev) => {
        const next = { ...prev };
        delete next[payment.id];
        return next;
      });

      if (expandedPayment === payment.id) {
        setExpandedPayment(null);
      }

      if (editingPaymentId === payment.id) {
        closePaymentEditor();
      }

      setPaymentPendingDelete(null);
      setNotice({
        type: "ok",
        msg: "Payment deleted successfully.",
      });
      campusToast.success({
        title: "Payment deleted successfully.",
        preventDuplicate: false,
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error, "Failed to delete payment.");
      setNotice({
        type: "err",
        msg: message,
      });
      campusToast.error({
        title: "Failed to delete payment.",
        description:
          message !== "Failed to delete payment." ? message : undefined,
        preventDuplicate: false,
      });
    } finally {
      setDeletingPaymentId(null);
    }
  }

  async function toggleStudentStatus(
    paymentId: string,
    student: PaymentStudent,
  ) {
    const nextStatus: PaymentStudentStatus =
      student.status === "Paid" ? "Unpaid" : "Paid";
    const paidDelta = nextStatus === "Paid" ? 1 : -1;
    const unpaidDelta = nextStatus === "Unpaid" ? 1 : -1;
    const key = `${paymentId}:${student.uid}`;

    setUpdatingStatusKey(key);
    setNotice(null);

    try {
      const batch = writeBatch(db);

      batch.set(
        doc(db, "payments", paymentId, "students", student.uid),
        {
          status: nextStatus,
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      batch.set(
        doc(db, "payments", paymentId),
        {
          paidCount: increment(paidDelta),
          unpaidCount: increment(unpaidDelta),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );

      await batch.commit();
      campusToast.success({
        title: "Payment status updated",
        description: `${student.name} marked ${nextStatus}.`,
        dedupeKey: `ec-payments:status:${paymentId}:${student.uid}:${nextStatus}`,
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error, "Failed to update payment status.");
      setNotice({
        type: "err",
        msg: message,
      });
      campusToast.error({
        title: "Status update failed",
        description: message,
        dedupeKey: `ec-payments:status-error:${paymentId}:${student.uid}`,
      });
    } finally {
      setUpdatingStatusKey(null);
    }
  }

  function exportCsv(payment: Payment) {
    const rows = paymentStudents[payment.id] ?? [];
    if (!rows.length) {
      setNotice({ type: "err", msg: "No student rows loaded to export." });
      campusToast.warning({
        title: "Nothing to export",
        description: "No student rows are loaded for this payment yet.",
        dedupeKey: `ec-payments:export-empty:${payment.id}`,
      });
      return;
    }

    const csvRows = [
      toCsvLine(["Reference", payment.ref]),
      toCsvLine(["Title", payment.title]),
      toCsvLine(["Date", payment.date]),
      toCsvLine(["Amount", formatCurrency(payment.amount)]),
      "",
      toCsvLine(["Student ID", "Name", "Course", "Year", "Section", "Status"]),
      ...rows.map((item) =>
        toCsvLine([
          item.schoolId || item.uid,
          item.name,
          item.course,
          item.year,
          item.section,
          item.status,
        ]),
      ),
    ];

    const blob = new Blob([csvRows.join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${payment.ref || payment.id}-report.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    campusToast.success({
      title: "Export started",
      description: `${payment.ref || payment.id}-report.csv is being downloaded.`,
      dedupeKey: `ec-payments:export:${payment.id}`,
    });
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <ECPageHeader
        title="Campus Payment Management"
        description="Track, verify, and manage student payments from one EC view that keeps search, filters, and payment actions reachable on smaller screens."
        eyebrow="EC Payments"
        icon={CreditCard}
        variant="hero"
        meta={
          <>
            <Chip variant="flat" className="bg-white/15 text-white">
              {visiblePayments.length} payment records
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              {students.length} students in roster scope
            </Chip>
          </>
        }
      />

      <ECStatsGrid items={paymentSummaryItems} />

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

      <ECFilterBar controlsClassName="grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <div className="xl:col-span-2">
          <Input
            aria-label="Search payments"
            type="text"
            label="Search"
            placeholder="Search by title, reference, course, year, or student"
            value={queryText}
            onValueChange={setQueryText}
            className="w-full"
          />
        </div>

        <Input
          aria-label="Filter by date"
          type="date"
          label="Date"
          value={dateFilter}
          onValueChange={setDateFilter}
          startContent={<FiCalendar />}
          className="w-full"
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Dropdown placement="bottom-start">
            <DropdownTrigger>
              <Button
                variant="bordered"
                className="min-h-12 w-full justify-between font-medium"
              >
                <span>Sort: {paymentSortLabel}</span>
                <FiChevronDown className="ml-1" />
              </Button>
            </DropdownTrigger>
            <DropdownMenu
              aria-label="Sort payments"
              disallowEmptySelection
              selectionMode="single"
              selectedKeys={new Set([paymentSortMode])}
              onAction={(key) => setPaymentSortMode(String(key) as SortMode)}
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

          <Button
            onPress={openCreatePaymentEditor}
            className="min-h-12 w-full bg-[#7b0000] text-white"
            isDisabled={viewerProfileLoading || (viewerIsBod && !viewerCourseScope)}
          >
            Add Payment
          </Button>
        </div>
      </ECFilterBar>

      {showAddPaymentForm && (
      <div ref={paymentEditorRef}>
        <Card shadow="sm" className="border animate-slideDown">
          <CardBody className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <h2 className="text-xl font-semibold text-primary-900">
                {paymentEditorMode === "edit" ? "Edit Payment" : "Add New Payment"}
              </h2>

              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                {editingLinkedPayment ? (
                  <Chip size="sm" color="warning" variant="flat">
                    Linked to event
                  </Chip>
                ) : null}
                <Button
                  variant="flat"
                  onPress={closePaymentEditor}
                  className="w-full sm:w-auto px-3 text-sm"
                >
                  Close
                </Button>
              </div>
            </div>

            {editingLinkedPayment ? (
              <p className="text-sm text-campus-text-secondary">
                Audience fields are managed by the linked event. You can safely
                update the title, amount, due date, and description here.
              </p>
            ) : null}

            <div>
              <label className="text-sm font-medium">Payment Title</label>
              <Input
                aria-label="Payment title"
                type="text"
                value={title}
                onValueChange={setTitle}
                className="w-full mt-1"
                placeholder="e.g., Acquaintance Party"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Amount</label>
              <Input
                aria-label="Payment amount"
                type="number"
                min={0}
                step="0.01"
                value={amount}
                onValueChange={setAmount}
                className="w-full mt-1"
                placeholder="Enter amount"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Date</label>
              <Input
                aria-label="Payment date"
                type="date"
                value={paymentDate}
                onValueChange={setPaymentDate}
                className="w-full mt-1"
              />
            </div>

            <div>
              <label className="text-sm font-medium">Year Level</label>
              <Select
                aria-label="Payment year level"
                selectedKeys={new Set([yearLevel])}
                onSelectionChange={(keys) => {
                  if (keys === "all") return;
                  const selected = Array.from(keys)[0];
                  if (typeof selected === "string") {
                    setYearLevel(selected);
                  }
                }}
                disallowEmptySelection
                className="w-full mt-1"
                items={paymentYearSelectItems}
                isDisabled={editingLinkedPayment}
              >
                {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Course</label>
              <Select
                aria-label="Payment course"
                selectedKeys={new Set([selectedPaymentCourse])}
                onSelectionChange={(keys) => {
                  if (keys === "all") return;
                  const selected = Array.from(keys)[0];
                  if (typeof selected === "string") {
                    setCourse(selected);
                  }
                }}
                disallowEmptySelection
                className="w-full mt-1"
                items={paymentCourseSelectItems}
                isDisabled={
                  editingLinkedPayment || (viewerIsBod && Boolean(viewerCourseScope))
                }
              >
                {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
              </Select>
              {viewerIsBod && viewerCourseScope ? (
                <p className="mt-1 text-xs text-campus-text-secondary">
                  B.O.D. payments stay scoped to {viewerCourseScope}.
                </p>
              ) : null}
            </div>

            <div>
              <label className="text-sm font-medium">Specific Students</label>

              {selectedPaymentStudents.length > 0 && (
                <div className="mt-2 rounded-lg border bg-white px-3 py-2">
                  <div className="flex flex-wrap gap-2">
                    {selectedPaymentStudents.map((student) => (
                      <span
                        key={student.uid}
                        className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-sm"
                      >
                        <span className="font-medium">{student.name}</span>
                        <span className="text-campus-text-secondary">
                          ({student.schoolId})
                        </span>
                        <Button
                          isIconOnly
                          size="sm"
                          variant="light"
                          className="h-5 min-w-5 text-campus-text-secondary"
                          isDisabled={editingLinkedPayment}
                          onPress={() => {
                            setSelectedPaymentStudents((prev) =>
                              prev.filter((item) => item.uid !== student.uid),
                            );
                          }}
                          aria-label={`Remove ${student.name}`}
                        >
                          x
                        </Button>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div ref={paymentStudentPickerRef} className="mt-2 space-y-2">
                <Input
                  aria-label="Payment specific students"
                  value={paymentTargetSearchText}
                  onValueChange={(value) => {
                    setPaymentTargetSearchText(value);
                    setShowPaymentStudentDropdown(true);
                  }}
                  onFocus={() => setShowPaymentStudentDropdown(true)}
                  placeholder="Search by name, ID, course, or year"
                  className="w-full"
                  isDisabled={editingLinkedPayment}
                />

                {showPaymentStudentDropdown && !editingLinkedPayment && (
                  <div className="max-h-56 overflow-y-auto rounded-lg border bg-white shadow-lg">
                    {studentsLoading ? (
                      <div className="p-3">
                        <CampusCardListSkeleton rows={2} />
                      </div>
                    ) : filteredPaymentStudentOptions.length === 0 ? (
                      <p className="px-4 py-2 text-sm text-campus-text-secondary">
                        No matching students.
                      </p>
                    ) : (
                      filteredPaymentStudentOptions.map((student) => (
                        <Button
                          key={student.uid}
                          size="sm"
                          variant="light"
                          className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                          onPress={() => {
                            setSelectedPaymentStudents((prev) =>
                              prev.some((item) => item.uid === student.uid)
                                ? prev
                                : [...prev, student],
                            );
                            setPaymentTargetSearchText("");
                            setShowPaymentStudentDropdown(true);
                          }}
                        >
                          <div className="text-left">
                            <div className="text-sm font-medium text-campus-text-primary">
                              {student.name}
                            </div>
                            <div className="text-xs text-campus-text-secondary">
                              {student.schoolId} | {student.course} |{" "}
                              {student.year}
                            </div>
                          </div>
                        </Button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium">Details</label>
              <Textarea
                aria-label="Payment details"
                value={details}
                onValueChange={setDetails}
                minRows={4}
                className="w-full mt-1"
                placeholder="Additional notes..."
              />
            </div>

            <p className="text-xs text-campus-text-secondary">
              {studentsLoading
                ? "Loading student roster..."
                : hasSpecificStudentTargets && !hasYearFilter && !hasCourseFilter
                  ? "This payment will be assigned only to the selected students."
                  : "This payment will be assigned to students matching the selected course/year, plus any specific students you added."}
            </p>

            <p className="text-xs text-campus-text-secondary">
              Specific students are optional. Leave Year Level and Course on All
              to assign only the selected students.
            </p>

            <Button
              color="primary"
              onPress={handleSavePayment}
              isDisabled={savingPayment || studentsLoading}
              className="w-full"
            >
              {savingPayment
                ? paymentEditorMode === "edit"
                  ? "Updating..."
                  : "Saving..."
                : paymentEditorMode === "edit"
                  ? "Update Payment"
                  : "Save Payment"}
            </Button>
          </CardBody>
        </Card>
      </div>
      )}

      <Card shadow="sm" className="border">
        <CardHeader className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-lg font-semibold text-campus-text-primary">
              Payment List
            </h3>
            <p className="text-sm text-campus-text-secondary">
              Review payment status, then open each record for assigned students
              and exportable reporting.
            </p>
          </div>
          <Button
            color="primary"
            variant="flat"
            onPress={() => void handleExportAllPaymentReport()}
            isLoading={exportingAllPayments}
            isDisabled={paymentsLoading || viewerProfileLoading}
            className="w-full sm:ml-auto sm:w-auto"
          >
            Export All Payment Report
          </Button>
        </CardHeader>
        <CardBody className="p-4 sm:p-6 pt-3">
          {paymentsLoading ? (
            <CampusCardListSkeleton rows={3} />
          ) : sortedFilteredPayments.length === 0 ? (
            <ECEmptyState
              title="No payments found"
              description="Try another keyword or date filter, or create a new payment record."
              compact
            />
          ) : (
            sortedFilteredPayments.map((p) => {
              const rows = paymentStudents[p.id] ?? [];
              const paginationState = getPaymentStudentPaginationState(p.id);
              const paid = rows.length
                ? rows.filter((s) => s.status === "Paid").length
                : p.paidCount;
              const unpaid = rows.length
                ? rows.filter((s) => s.status === "Unpaid").length
                : p.unpaidCount;
              const statusLabel =
                p.totalStudents === 0
                  ? "No Students"
                  : unpaid > 0
                    ? "Pending"
                    : "Completed";
              const canManageThisPayment = canManagePaymentRecord(p);
              const canEditThisPayment = canEditPaymentRecord(p);
              const statusClass =
                statusLabel === "Completed"
                  ? "bg-green-100 text-green-700"
                  : statusLabel === "Pending"
                    ? "bg-amber-100 text-amber-800"
                    : "bg-gray-100 text-campus-text-primary";
              const studentYearOptions = Array.from(
                new Set(
                  rows
                    .map((student) => student.year)
                    .filter((year) => Boolean(year) && year !== "Unassigned"),
                ),
              ).sort((a, b) => a.localeCompare(b));
              const studentCourseOptions = Array.from(
                new Set(
                  rows
                    .map((student) => student.course)
                    .filter(
                      (courseName) =>
                        Boolean(courseName) && courseName !== "Unassigned",
                    ),
                ),
              ).sort((a, b) => a.localeCompare(b));
              const filteredSortedStudentRows = rows
                .filter((student) => {
                  const search = studentSearchText.trim().toLowerCase();
                  const matchesSearch =
                    !search ||
                    student.schoolId.toLowerCase().includes(search) ||
                    student.name.toLowerCase().includes(search) ||
                    student.course.toLowerCase().includes(search) ||
                    student.year.toLowerCase().includes(search) ||
                    student.section.toLowerCase().includes(search);
                  const matchesYear =
                    !studentYearFilter || student.year === studentYearFilter;
                  const matchesCourse =
                    !studentCourseFilter ||
                    student.course === studentCourseFilter;
                  return matchesSearch && matchesYear && matchesCourse;
                })
                .sort((a, b) => {
                  if (a.status !== b.status) {
                    if (studentStatusSortMode === "paid")
                      return a.status === "Paid" ? -1 : 1;
                    return a.status === "Unpaid" ? -1 : 1;
                  }

                  return (
                    a.name.localeCompare(b.name) ||
                    a.schoolId.localeCompare(b.schoolId)
                  );
                });
              const studentRowsPerPage = paginationState.rowsPerPage;
              const studentTotalPages = Math.max(
                1,
                Math.ceil(filteredSortedStudentRows.length / studentRowsPerPage),
              );
              const studentPage = Math.min(
                paginationState.page,
                studentTotalPages,
              );
              const studentStartIndex =
                filteredSortedStudentRows.length > 0
                  ? (studentPage - 1) * studentRowsPerPage
                  : 0;
              const paginatedStudentRows = filteredSortedStudentRows.slice(
                studentStartIndex,
                studentStartIndex + studentRowsPerPage,
              );
              const studentRangeSummary = formatStudentRangeSummary(
                studentStartIndex,
                paginatedStudentRows.length,
                filteredSortedStudentRows.length,
              );

              return (
                <Card
                  key={p.id}
                  shadow="none"
                  className="mb-4 border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]"
                >
                  <CardBody className="space-y-4 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h4 className="text-lg font-semibold text-campus-text-primary">
                          {p.title}
                        </h4>
                        <p className="text-sm text-campus-text-secondary">
                          Reference: {p.ref}
                        </p>
                        {p.source === "event" ? (
                          <p className="mt-1 text-sm text-campus-text-secondary">
                            Linked event: {p.linkedEventTitle || p.linkedEventId || "Event payment"}
                          </p>
                        ) : null}

                        <ECStatusChipGroup
                          className="mt-3"
                          items={[
                            {
                              label: "Date",
                              value: formatDate(p.date),
                              tone: "blue",
                            },
                            {
                              label: "Amount",
                              value: formatCurrency(p.amount),
                              tone: "purple",
                            },
                            {
                              label: "Targets",
                              value: `${p.totalStudents} student(s)`,
                              tone: "slate",
                            },
                            ...(p.source === "event" ?
                              [{
                                label: "Source",
                                value: "Event",
                                tone: "blue" as const,
                              }] :
                              []),
                          ]}
                        />
                      </div>

                      <div className="flex flex-col items-start gap-2 sm:items-end">
                        <Chip className={statusClass}>{statusLabel}</Chip>

                        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                          <Button
                            size="sm"
                            variant="flat"
                            onPress={() =>
                              setExpandedPayment(
                                expandedPayment === p.id ? null : p.id,
                              )
                            }
                            className="px-4 text-xs"
                          >
                            {expandedPayment === p.id
                              ? "Hide details"
                              : "Open payment"}
                          </Button>

                          {canEditThisPayment ? (
                            <Button
                              size="sm"
                              variant="bordered"
                              onPress={() => openEditPaymentEditor(p)}
                              className="px-4 text-xs"
                            >
                              Edit
                            </Button>
                          ) : (
                            <Tooltip content="You do not have permission to edit this payment.">
                              <span className="inline-flex">
                                <Button
                                  size="sm"
                                  variant="bordered"
                                  isDisabled
                                  className="pointer-events-none px-4 text-xs"
                                >
                                  Edit
                                </Button>
                              </span>
                            </Tooltip>
                          )}

                          {canEditThisPayment ? (
                            <Button
                              size="sm"
                              color="danger"
                              variant="flat"
                              onPress={() => promptDeletePayment(p)}
                              className="px-4 text-xs"
                            >
                              Delete
                            </Button>
                          ) : (
                            <Tooltip content="You do not have permission to delete this payment.">
                              <span className="inline-flex">
                                <Button
                                  size="sm"
                                  color="danger"
                                  variant="flat"
                                  isDisabled
                                  className="pointer-events-none px-4 text-xs"
                                >
                                  Delete
                                </Button>
                              </span>
                            </Tooltip>
                          )}
                        </div>
                      </div>
                    </div>

                    {expandedPayment === p.id && (
                      <div className="mt-4 border-t pt-3">
                        <div className="flex justify-start sm:justify-end mb-3">
                          <Button
                            variant="flat"
                            color="primary"
                            onPress={() => exportCsv(p)}
                            className="px-4 font-semibold"
                          >
                            Export Report
                          </Button>
                        </div>

                        <div className="flex flex-wrap gap-2 sm:gap-4 mb-4">
                          <Chip
                            color="success"
                            variant="flat"
                            className="font-semibold"
                          >
                            Paid: {paid}
                          </Chip>

                          <Chip
                            color="danger"
                            variant="flat"
                            className="font-semibold"
                          >
                            Unpaid: {unpaid}
                          </Chip>
                        </div>

                        {(p.targetStudent || p.yearLevel || p.course) && (
                          <div className="mb-4 space-y-1 text-sm text-campus-text-secondary">
                            {p.targetStudent && (
                              <p>
                                Specific students:{" "}
                                {formatStudentReferenceList(p.targetStudent)}
                              </p>
                            )}
                            {(p.yearLevel || p.course) && (
                              <p>
                                Filters: Year Level - {p.yearLevel || "Any"} |
                                {" "}Course - {p.course || "Any"}
                              </p>
                            )}
                          </div>
                        )}

                        <h4 className="font-semibold text-campus-text-primary mb-2">
                          Students
                        </h4>

                        <div className="mb-3 grid grid-cols-1 md:grid-cols-4 gap-2">
                          <Input
                            aria-label="Search students in payment"
                            type="text"
                            placeholder="Search students..."
                            value={studentSearchText}
                            onValueChange={(value) => {
                              setStudentSearchText(value);
                              resetPaymentStudentPage(p.id);
                            }}
                            className="w-full md:col-span-2"
                          />

                          <Select
                            aria-label="Filter students by year"
                            selectedKeys={
                              new Set([studentYearFilter || "__all_years__"])
                            }
                            onSelectionChange={(keys) => {
                              if (keys === "all") return;
                              const selected = Array.from(keys)[0];
                              if (typeof selected === "string") {
                                setStudentYearFilter(
                                  selected === "__all_years__" ? "" : selected,
                                );
                                resetPaymentStudentPage(p.id);
                              }
                            }}
                            disallowEmptySelection
                            className="w-full"
                            items={
                              [
                                { key: "__all_years__", label: "All Years" },
                                ...studentYearOptions.map((yearName) => ({
                                  key: yearName,
                                  label: yearName,
                                })),
                              ] satisfies SelectOption[]
                            }
                          >
                            {(item) => (
                              <SelectItem key={item.key}>
                                {item.label}
                              </SelectItem>
                            )}
                          </Select>

                          <Select
                            aria-label="Filter students by course"
                            selectedKeys={
                              new Set([
                                studentCourseFilter || "__all_courses__",
                              ])
                            }
                            onSelectionChange={(keys) => {
                              if (keys === "all") return;
                              const selected = Array.from(keys)[0];
                              if (typeof selected === "string") {
                                setStudentCourseFilter(
                                  selected === "__all_courses__"
                                    ? ""
                                    : selected,
                                );
                                resetPaymentStudentPage(p.id);
                              }
                            }}
                            disallowEmptySelection
                            className="w-full"
                            items={
                              [
                                {
                                  key: "__all_courses__",
                                  label: "All Courses",
                                },
                                ...studentCourseOptions.map((courseName) => ({
                                  key: courseName,
                                  label: courseName,
                                })),
                              ] satisfies SelectOption[]
                            }
                          >
                            {(item) => (
                              <SelectItem key={item.key}>
                                {item.label}
                              </SelectItem>
                            )}
                          </Select>
                        </div>

                        <div className="mb-3 flex justify-start sm:justify-end">
                          <Dropdown placement="bottom-end">
                            <DropdownTrigger>
                              <Button
                                variant="bordered"
                                className="w-full sm:w-auto justify-between min-w-[150px]"
                              >
                                <span>Sort by: {studentStatusSortLabel}</span>
                                <FiChevronDown className="ml-2" />
                              </Button>
                            </DropdownTrigger>
                            <DropdownMenu
                              aria-label="Sort students by payment status"
                              disallowEmptySelection
                              selectionMode="single"
                              selectedKeys={new Set([studentStatusSortMode])}
                              onAction={(key) => {
                                setStudentStatusSortMode(
                                  String(key) as StudentStatusSortMode,
                                );
                                resetPaymentStudentPage(p.id);
                              }}
                            >
                              <DropdownItem key="paid">Paid</DropdownItem>
                              <DropdownItem key="unpaid">Unpaid</DropdownItem>
                            </DropdownMenu>
                          </Dropdown>
                        </div>

                        {expandedStudentsLoading && rows.length === 0 ? (
                          <CampusCardListSkeleton rows={2} />
                        ) : rows.length === 0 ? (
                          <ECEmptyState
                            title="No student assignments yet"
                            description="This payment currently has no matching students under the selected filters."
                            compact
                          />
                        ) : (
                          <div className="space-y-3">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-xs text-campus-text-secondary">
                                {studentRangeSummary}
                              </p>

                              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                                <span className="text-xs font-medium text-campus-text-secondary">
                                  Rows per page
                                </span>
                                <Select
                                  aria-label={`Rows per page for ${p.title}`}
                                  disallowEmptySelection
                                  selectedKeys={new Set([String(studentRowsPerPage)])}
                                  onSelectionChange={(keys) => {
                                    if (keys === "all") return;
                                    const selected = Array.from(keys)[0];
                                    if (typeof selected === "string") {
                                      setPaymentStudentRowsPerPage(
                                        p.id,
                                        Number(selected),
                                      );
                                    }
                                  }}
                                  className="w-full sm:w-32"
                                  items={studentRowsPerPageItems}
                                >
                                  {(item) => (
                                    <SelectItem key={item.key}>
                                      {item.label}
                                    </SelectItem>
                                  )}
                                </Select>
                              </div>
                            </div>

                            <ECDataTable
                              ariaLabel={`Students assigned to ${p.title}`}
                              columns={paymentStudentColumns}
                              items={paginatedStudentRows}
                              emptyTitle="No students match your search"
                              emptyDescription="Adjust the filters or search query to see assigned students."
                              renderCell={(student, columnKey) => {
                                if (columnKey === "status") {
                                  return (
                                    <Chip
                                      color={
                                        student.status === "Paid"
                                          ? "success"
                                          : "danger"
                                      }
                                      variant="flat"
                                    >
                                      {student.status}
                                    </Chip>
                                  );
                                }

                                if (columnKey === "actions") {
                                  const actionKey = `${p.id}:${student.uid}`;
                                  const nextStatusLabel =
                                    student.status === "Paid"
                                      ? "Mark Unpaid"
                                      : "Mark Paid";

                                  return (
                                    <Button
                                      size="sm"
                                      color="primary"
                                      onPress={() =>
                                        toggleStudentStatus(p.id, student)
                                      }
                                      isDisabled={
                                        updatingStatusKey === actionKey ||
                                        !canManageThisPayment
                                      }
                                      className="px-3 text-xs"
                                    >
                                      {updatingStatusKey === actionKey ?
                                        "Saving..." :
                                        !canManageThisPayment ?
                                          "View only" :
                                          nextStatusLabel}
                                    </Button>
                                  );
                                }

                                if (columnKey === "schoolId") {
                                  return student.schoolId || student.uid;
                                }

                                return student[
                                  columnKey as keyof PaymentStudent
                                ] as string;
                              }}
                            />

                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                              <div className="flex w-full gap-2 sm:w-auto">
                                <Button
                                  variant="bordered"
                                  onPress={() =>
                                    setPaymentStudentPage(p.id, studentPage - 1)
                                  }
                                  isDisabled={studentPage <= 1}
                                  className="flex-1 sm:flex-none"
                                >
                                  Previous
                                </Button>
                                <Button
                                  variant="bordered"
                                  onPress={() =>
                                    setPaymentStudentPage(p.id, studentPage + 1)
                                  }
                                  isDisabled={studentPage >= studentTotalPages}
                                  className="flex-1 sm:hidden"
                                >
                                  Next
                                </Button>
                              </div>

                              <div className="flex justify-center">
                                <Pagination
                                  page={studentPage}
                                  total={studentTotalPages}
                                  onChange={(page) =>
                                    setPaymentStudentPage(p.id, page)
                                  }
                                />
                              </div>

                              <Button
                                variant="bordered"
                                onPress={() =>
                                  setPaymentStudentPage(p.id, studentPage + 1)
                                }
                                isDisabled={studentPage >= studentTotalPages}
                                className="hidden sm:inline-flex"
                              >
                                Next
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </CardBody>
                </Card>
              );
            })
          )}
        </CardBody>
      </Card>

      <Modal
        isOpen={Boolean(paymentPendingDelete)}
        onOpenChange={(open) => {
          if (!open && !deletingPaymentId) {
            setPaymentPendingDelete(null);
          }
        }}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader>Delete Payment</ModalHeader>
              <ModalBody className="space-y-3">
                <p className="text-sm text-campus-text-secondary">
                  Are you sure you want to delete this payment record? This
                  action cannot be undone.
                </p>

                {paymentPendingDelete?.linkedEventId ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    This payment is linked to an event. Deleting it may affect
                    event payment validation.
                  </div>
                ) : null}

                {paymentPendingDelete ? (
                  <div className="rounded-lg border border-border/70 bg-slate-50 px-4 py-3 text-sm text-campus-text-secondary">
                    <p className="font-medium text-campus-text-primary">
                      {paymentPendingDelete.title}
                    </p>
                    <p>Reference: {paymentPendingDelete.ref}</p>
                    <p>Amount: {formatCurrency(paymentPendingDelete.amount)}</p>
                  </div>
                ) : null}
              </ModalBody>
              <ModalFooter className="justify-between">
                <Button
                  variant="bordered"
                  onPress={() => setPaymentPendingDelete(null)}
                  isDisabled={Boolean(deletingPaymentId)}
                >
                  Cancel
                </Button>
                <Button
                  color="danger"
                  onPress={() => void handleConfirmDeletePayment()}
                  isLoading={Boolean(
                    deletingPaymentId &&
                      paymentPendingDelete &&
                      deletingPaymentId === paymentPendingDelete.id,
                  )}
                >
                  Delete Payment
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
