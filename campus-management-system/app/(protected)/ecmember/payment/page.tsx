"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FiCalendar, FiChevronDown } from "react-icons/fi";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
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
import { Select, SelectItem } from "@heroui/select";
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
  createdAt?: unknown;
}

type Notice = {
  type: "ok" | "err";
  msg: string;
};

type SelectOption = {
  key: string;
  label: string;
};

type SortMode = "latest_to_oldest" | "oldest_to_latest" | "alphabetical";
type StudentStatusSortMode = "paid" | "unpaid";

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

export default function PaymentDashboard() {
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);

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
  const [updatingStatusKey, setUpdatingStatusKey] = useState<string | null>(
    null,
  );
  const [studentSearchText, setStudentSearchText] = useState("");
  const [studentYearFilter, setStudentYearFilter] = useState<string>("");
  const [studentCourseFilter, setStudentCourseFilter] = useState<string>("");
  const [studentStatusSortMode, setStudentStatusSortMode] =
    useState<StudentStatusSortMode>("paid");

  const [notice, setNotice] = useState<Notice | null>(null);
  const [paymentStudents, setPaymentStudents] = useState<
    Record<string, PaymentStudent[]>
  >({});
  const paymentStudentPickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadStudents() {
      setStudentsLoading(true);

      try {
        const fn = httpsCallable<
          { limit: number },
          { students?: RemoteStudent[] }
        >(functions, "ecListStudents");
        const res = await fn({ limit: 2000 });
        if (!mounted) return;

        const list = (res.data?.students ?? [])
          .map(mapRemoteStudent)
          .filter((item) => item.uid)
          .sort(
            (a, b) =>
              a.name.localeCompare(b.name) ||
              a.schoolId.localeCompare(b.schoolId),
          );
        setStudents(list);
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
  }, [functions]);

  useEffect(() => {
    const qy = query(collection(db, "payments"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: Payment[] = snap.docs.map((d) => {
          const data = d.data() as Partial<Payment>;
          return {
            id: d.id,
            title: String(data.title ?? "Untitled Payment"),
            ref: String(data.ref ?? makePaymentRef(d.id)),
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
            createdAt: data.createdAt,
          };
        });
        setPayments(rows);
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
  }, []);

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
        const list: PaymentStudent[] = snap.docs.map((d) => {
          const data = d.data() as Partial<PaymentStudent>;
          const rawStatus = String(data.status ?? "Unpaid");
          const status: PaymentStudentStatus =
            rawStatus === "Paid" ? "Paid" : "Unpaid";

          return {
            uid: String(data.uid ?? d.id),
            schoolId: String(data.schoolId ?? ""),
            name: String(data.name ?? String(data.schoolId ?? d.id)),
            year: normalizeYear(data.year),
            section: String(data.section ?? "-"),
            course: String(data.course ?? "Unassigned"),
            status,
          };
        });

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
  const hasCourseFilter = course !== "All Courses";

  const filteredPayments = useMemo(() => {
    const search = queryText.trim().toLowerCase();

    return payments.filter((p) => {
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
  }, [payments, queryText, dateFilter]);

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

  const studentStatusSortLabel = useMemo(
    () => (studentStatusSortMode === "paid" ? "Paid" : "Unpaid"),
    [studentStatusSortMode],
  );

  const dashboardCounts = useMemo(() => {
    const pending = payments.filter(
      (payment) => payment.totalStudents > 0 && payment.unpaidCount > 0,
    ).length;
    const completed = payments.filter(
      (payment) => payment.totalStudents > 0 && payment.unpaidCount === 0,
    ).length;
    return { total: payments.length, pending, completed };
  }, [payments]);

  const totalPaymentValue = useMemo(
    () => payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    [payments],
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

  async function handleSavePayment() {
    setNotice(null);

    const cleanTitle = title.trim();
    const amountValue = Number(amount);
    const cleanDetails = details.trim();

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

    const targetMap = new Map<string, StudentProfile>();
    const shouldApplyFilterTargets =
      !hasSpecificStudentTargets || hasYearFilter || hasCourseFilter;

    if (shouldApplyFilterTargets) {
      students.forEach((student) => {
        if (matchesPaymentFilters(student, yearLevel, course)) {
          targetMap.set(student.uid, student);
        }
      });
    }

    selectedPaymentStudents.forEach((student) => {
      targetMap.set(student.uid, student);
    });

    const targets = Array.from(targetMap.values()).sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.schoolId.localeCompare(b.schoolId),
    );

    if (!targets.length) {
      setNotice({
        type: "err",
        msg: "No students match the selected filters or specific-student selection.",
      });
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setNotice({
        type: "err",
        msg: "You must be signed in to create payments.",
      });
      return;
    }

    setSavingPayment(true);

    try {
      const paymentRef = doc(collection(db, "payments"));
      const paymentRefCode = makePaymentRef(paymentRef.id);
      const totalStudents = targets.length;
      const targetStudent = formatTargetStudentSummary(selectedPaymentStudents);

      await setDoc(paymentRef, {
        title: cleanTitle,
        ref: paymentRefCode,
        amount: amountValue,
        date: paymentDate,
        yearLevel: hasYearFilter
          ? yearLevel
          : hasSpecificStudentTargets
            ? ""
            : "All Years",
        course: hasCourseFilter
          ? course
          : hasSpecificStudentTargets
            ? ""
            : "All Courses",
        targetStudent,
        details: cleanDetails,
        totalStudents,
        paidCount: 0,
        unpaidCount: totalStudents,
        createdByUid: currentUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const chunkSize = 400;
      for (let i = 0; i < targets.length; i += chunkSize) {
        const batch = writeBatch(db);
        const chunk = targets.slice(i, i + chunkSize);

        chunk.forEach((student) => {
          const studentRef = doc(
            db,
            "payments",
            paymentRef.id,
            "students",
            student.uid,
          );
          batch.set(studentRef, {
            uid: student.uid,
            schoolId: student.schoolId,
            name: student.name,
            year: student.year,
            section: student.section,
            course: student.course,
            status: "Unpaid",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        });

        await batch.commit();
      }

      setShowAddPaymentForm(false);
      resetForm();
      setNotice({
        type: "ok",
        msg: `Payment created and assigned to ${totalStudents} student(s).`,
      });
      campusToast.success({
        title: "Payment created",
        description: `Assigned to ${totalStudents} student(s).`,
        dedupeKey: `ec-payments:create:${paymentRef.id}`,
      });
    } catch (error: unknown) {
      const message = toErrorMessage(error, "Failed to save payment.");
      setNotice({ type: "err", msg: message });
      campusToast.error({
        title: "Save payment failed",
        description: message,
        dedupeKey: "ec-payments:create-error",
      });
    } finally {
      setSavingPayment(false);
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
              {payments.length} payment records
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
            onPress={() => setShowAddPaymentForm(true)}
            className="min-h-12 w-full bg-[#7b0000] text-white"
          >
            Add Payment
          </Button>
        </div>
      </ECFilterBar>

      {showAddPaymentForm && (
      <Card shadow="sm" className="border animate-slideDown">
        <CardBody className="space-y-4 p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
              <h2 className="text-xl font-semibold text-primary-900">
                Add New Payment
              </h2>

              <Button
                variant="flat"
                onPress={() => setShowAddPaymentForm(false)}
                className="w-full sm:w-auto px-3 text-sm"
              >
                Close
              </Button>
            </div>

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
              >
                {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium">Course</label>
              <Select
                aria-label="Payment course"
                selectedKeys={new Set([course])}
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
              >
                {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
              </Select>
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
                />

                {showPaymentStudentDropdown && (
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
              {savingPayment ? "Saving..." : "Save Payment"}
            </Button>
          </CardBody>
        </Card>
      )}

      <Card shadow="sm" className="border">
        <CardHeader className="px-5 pt-5">
          <div>
            <h3 className="text-lg font-semibold text-campus-text-primary">
              Payment List
            </h3>
            <p className="text-sm text-campus-text-secondary">
              Review payment status, then open each record for assigned students
              and exportable reporting.
            </p>
          </div>
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
                          ]}
                        />
                      </div>

                      <div className="flex flex-col items-start sm:items-end gap-2">
                        <Chip className={statusClass}>{statusLabel}</Chip>

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
                            onValueChange={setStudentSearchText}
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
                              onAction={(key) =>
                                setStudentStatusSortMode(
                                  String(key) as StudentStatusSortMode,
                                )
                              }
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
                          <ECDataTable
                            ariaLabel={`Students assigned to ${p.title}`}
                            columns={paymentStudentColumns}
                            items={filteredSortedStudentRows}
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
                                    isDisabled={updatingStatusKey === actionKey}
                                    className="px-3 text-xs"
                                  >
                                    {updatingStatusKey === actionKey
                                      ? "Saving..."
                                      : nextStatusLabel}
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
    </div>
  );
}
