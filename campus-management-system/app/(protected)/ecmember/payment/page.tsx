"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from "@heroui/dropdown";
import { Input, Textarea } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";

type PaymentStudentStatus = "Paid" | "Unpaid";

type RemoteStudent = {
  uid?: string;
  schoolId?: string;
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
    const message = typeof maybe.message === "string" ? maybe.message : fallback;
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
  const studentName = String(data.studentName ?? "").trim();
  const fallbackName = String(data.name ?? "").trim();
  const name = studentName || fallbackName || schoolId;
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
  if (value && typeof value === "object" && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value && typeof value === "object" && typeof (value as { seconds?: number }).seconds === "number") {
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
  const [paymentSortMode, setPaymentSortMode] = useState<SortMode>("latest_to_oldest");

  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [yearLevel, setYearLevel] = useState("All Years");
  const [course, setCourse] = useState("All Courses");
  const [details, setDetails] = useState("");

  const [students, setStudents] = useState<StudentProfile[]>([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(true);
  const [expandedStudentsLoading, setExpandedStudentsLoading] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);
  const [updatingStatusKey, setUpdatingStatusKey] = useState<string | null>(null);
  const [studentSearchText, setStudentSearchText] = useState("");
  const [studentYearFilter, setStudentYearFilter] = useState<string>("");
  const [studentCourseFilter, setStudentCourseFilter] = useState<string>("");
  const [studentStatusSortMode, setStudentStatusSortMode] = useState<StudentStatusSortMode>("paid");

  const [notice, setNotice] = useState<Notice | null>(null);
  const [paymentStudents, setPaymentStudents] = useState<Record<string, PaymentStudent[]>>({});

  useEffect(() => {
    let mounted = true;

    async function loadStudents() {
      setStudentsLoading(true);

      try {
        const fn = httpsCallable<{ limit: number }, { students?: RemoteStudent[] }>(functions, "ecListStudents");
        const res = await fn({ limit: 2000 });
        if (!mounted) return;

        const list = (res.data?.students ?? [])
          .map(mapRemoteStudent)
          .filter((item) => item.uid)
          .sort((a, b) => a.name.localeCompare(b.name) || a.schoolId.localeCompare(b.schoolId));
        setStudents(list);
      } catch (error: unknown) {
        if (!mounted) return;
        setStudents([]);
        setNotice({ type: "err", msg: toErrorMessage(error, "Failed to load students.") });
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
            yearLevel: String(data.yearLevel ?? "All Years"),
            course: String(data.course ?? "All Courses"),
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
        setNotice({ type: "err", msg: toErrorMessage(error, "Failed to load payments.") });
      }
    );

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!expandedPayment) return;

    setExpandedStudentsLoading(true);
    const qy = query(collection(db, "payments", expandedPayment, "students"), orderBy("name", "asc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: PaymentStudent[] = snap.docs.map((d) => {
          const data = d.data() as Partial<PaymentStudent>;
          const rawStatus = String(data.status ?? "Unpaid");
          const status: PaymentStudentStatus = rawStatus === "Paid" ? "Paid" : "Unpaid";

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
        setNotice({ type: "err", msg: toErrorMessage(error, "Failed to load payment students.") });
      }
    );

    return () => unsub();
  }, [expandedPayment]);

  useEffect(() => {
    setStudentSearchText("");
    setStudentYearFilter("");
    setStudentCourseFilter("");
    setStudentStatusSortMode("paid");
  }, [expandedPayment]);

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
    [yearOptions]
  );

  const paymentCourseSelectItems = useMemo<SelectOption[]>(
    () => [
      { key: "All Courses", label: "All Courses" },
      ...courseOptions.map((courseName) => ({ key: courseName, label: courseName })),
    ],
    [courseOptions]
  );

  const filteredPayments = useMemo(() => {
    const search = queryText.trim().toLowerCase();

    return payments.filter((p) => {
      const matchesDate = !dateFilter || p.date === dateFilter;

      const matchesSearch =
        !search ||
        p.title.toLowerCase().includes(search) ||
        p.ref.toLowerCase().includes(search) ||
        p.course.toLowerCase().includes(search) ||
        p.yearLevel.toLowerCase().includes(search);

      return matchesDate && matchesSearch;
    });
  }, [payments, queryText, dateFilter]);

  const sortedFilteredPayments = useMemo(() => {
    const list = [...filteredPayments];
    if (paymentSortMode === "alphabetical") {
      list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
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
    [studentStatusSortMode]
  );

  const dashboardCounts = useMemo(() => {
    const pending = payments.filter((payment) => payment.totalStudents > 0 && payment.unpaidCount > 0).length;
    const completed = payments.filter((payment) => payment.totalStudents > 0 && payment.unpaidCount === 0).length;
    return { total: payments.length, pending, completed };
  }, [payments]);

  function resetForm() {
    setTitle("");
    setAmount("");
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setYearLevel("All Years");
    setCourse("All Courses");
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
      setNotice({ type: "err", msg: "Students are still loading. Please wait." });
      return;
    }

    const targets = students.filter((student) => {
      const matchesYear = yearLevel === "All Years" || student.year === yearLevel;
      const matchesCourse = course === "All Courses" || student.course === course;
      return matchesYear && matchesCourse;
    });

    if (!targets.length) {
      setNotice({
        type: "err",
        msg: "No students match the selected filters. Adjust year/course first.",
      });
      return;
    }

    const currentUser = auth.currentUser;
    if (!currentUser) {
      setNotice({ type: "err", msg: "You must be signed in to create payments." });
      return;
    }

    setSavingPayment(true);

    try {
      const paymentRef = doc(collection(db, "payments"));
      const paymentRefCode = makePaymentRef(paymentRef.id);
      const totalStudents = targets.length;

      await setDoc(paymentRef, {
        title: cleanTitle,
        ref: paymentRefCode,
        amount: amountValue,
        date: paymentDate,
        yearLevel,
        course,
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
          const studentRef = doc(db, "payments", paymentRef.id, "students", student.uid);
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
    } catch (error: unknown) {
      setNotice({ type: "err", msg: toErrorMessage(error, "Failed to save payment.") });
    } finally {
      setSavingPayment(false);
    }
  }

  async function toggleStudentStatus(paymentId: string, student: PaymentStudent) {
    const nextStatus: PaymentStudentStatus = student.status === "Paid" ? "Unpaid" : "Paid";
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
        { merge: true }
      );

      batch.set(
        doc(db, "payments", paymentId),
        {
          paidCount: increment(paidDelta),
          unpaidCount: increment(unpaidDelta),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      await batch.commit();
    } catch (error: unknown) {
      setNotice({
        type: "err",
        msg: toErrorMessage(error, "Failed to update payment status."),
      });
    } finally {
      setUpdatingStatusKey(null);
    }
  }

  function exportCsv(payment: Payment) {
    const rows = paymentStudents[payment.id] ?? [];
    if (!rows.length) {
      setNotice({ type: "err", msg: "No student rows loaded to export." });
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
        toCsvLine([item.schoolId || item.uid, item.name, item.course, item.year, item.section, item.status])
      ),
    ];

    const blob = new Blob([csvRows.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${payment.ref || payment.id}-report.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-3 sm:p-6 space-y-4 sm:space-y-6">
      <Card shadow="sm" className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#b61f1f] to-[#f09a4a] text-white">
        <CardBody className="space-y-4 p-5 sm:p-8">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">EC Payments</p>
            <h1 className="text-3xl font-black sm:text-4xl">Campus Payment Management</h1>
            <p className="max-w-2xl text-sm text-white/80 sm:text-base">Track, verify, and manage student payments with a layout that stays usable on smaller screens.</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card shadow="none" className="border border-white/20 bg-white/10"><CardBody className="p-4"><p className="text-sm text-white/70">Total Payments</p><h2 className="mt-2 text-3xl font-black text-white">{dashboardCounts.total}</h2></CardBody></Card>
            <Card shadow="none" className="border border-white/20 bg-white/10"><CardBody className="p-4"><p className="text-sm text-white/70">Pending</p><h2 className="mt-2 text-3xl font-black text-white">{dashboardCounts.pending}</h2></CardBody></Card>
            <Card shadow="none" className="border border-white/20 bg-white/10"><CardBody className="p-4"><p className="text-sm text-white/70">Completed</p><h2 className="mt-2 text-3xl font-black text-white">{dashboardCounts.completed}</h2></CardBody></Card>
          </div>
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

      <Card shadow="sm" className="border">
        <CardBody className="grid grid-cols-1 gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_190px_auto] xl:items-end">
          <Input
            aria-label="Search payments"
            type="text"
            placeholder="Search by title, reference, course, or year..."
            value={queryText}
            onValueChange={setQueryText}
            className="w-full"
          />

          <Input
            aria-label="Filter by date"
            type="date"
            value={dateFilter}
            onValueChange={setDateFilter}
            startContent={<FiCalendar />}
            className="w-full"
          />

          <div className="flex flex-col gap-3 sm:flex-row xl:justify-end">
            <Dropdown placement="bottom-start">
              <DropdownTrigger>
                <Button variant="bordered" className="justify-between font-medium">
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
                <DropdownItem key="latest_to_oldest">Date, new to old</DropdownItem>
                <DropdownItem key="oldest_to_latest">Date, old to new</DropdownItem>
                <DropdownItem key="alphabetical">Alphabetically, A-Z</DropdownItem>
              </DropdownMenu>
            </Dropdown>

            <Button onPress={() => setShowAddPaymentForm(true)} className="text-white" style={{ backgroundColor: "#7b0000" }}>
              + Add Payment
            </Button>
          </div>
        </CardBody>
      </Card>

      {showAddPaymentForm && (
        <Card shadow="sm" className="border animate-slideDown">
          <CardBody className="space-y-4 p-4 sm:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
            <h2 className="text-xl font-semibold text-primary-900">Add New Payment</h2>

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
              : "This payment will be assigned to students matching the selected course/year."}
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
            <h3 className="text-lg font-semibold text-campus-text-primary">Payment List</h3>
            <p className="text-sm text-campus-text-secondary">Each payment card expands into responsive student assignments.</p>
          </div>
        </CardHeader>
        <CardBody className="p-4 sm:p-6 pt-3">

        {paymentsLoading ? (
          <p className="text-sm text-campus-text-secondary">Loading payments...</p>
        ) : sortedFilteredPayments.length === 0 ? (
          <p className="text-sm text-campus-text-secondary">No payments found.</p>
        ) : (
          sortedFilteredPayments.map((p) => {
            const rows = paymentStudents[p.id] ?? [];
            const paid = rows.length ? rows.filter((s) => s.status === "Paid").length : p.paidCount;
            const unpaid = rows.length ? rows.filter((s) => s.status === "Unpaid").length : p.unpaidCount;
            const statusLabel = p.totalStudents === 0 ? "No Students" : unpaid > 0 ? "Pending" : "Completed";
            const statusClass =
              statusLabel === "Completed"
                ? "bg-green-100 text-green-700"
                : statusLabel === "Pending"
                  ? "bg-amber-100 text-amber-800"
                  : "bg-gray-100 text-campus-text-primary";
            const studentYearOptions = Array.from(
              new Set(rows.map((student) => student.year).filter((year) => Boolean(year) && year !== "Unassigned"))
            ).sort((a, b) => a.localeCompare(b));
            const studentCourseOptions = Array.from(
              new Set(rows.map((student) => student.course).filter((courseName) => Boolean(courseName) && courseName !== "Unassigned"))
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
                const matchesYear = !studentYearFilter || student.year === studentYearFilter;
                const matchesCourse = !studentCourseFilter || student.course === studentCourseFilter;
                return matchesSearch && matchesYear && matchesCourse;
              })
              .sort((a, b) => {
                if (a.status !== b.status) {
                  if (studentStatusSortMode === "paid") return a.status === "Paid" ? -1 : 1;
                  return a.status === "Unpaid" ? -1 : 1;
                }

                return a.name.localeCompare(b.name) || a.schoolId.localeCompare(b.schoolId);
              });

            return (
              <Card key={p.id} shadow="sm" className="mb-4 border">
                <CardBody className="space-y-4 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="font-semibold text-campus-text-primary">{p.title}</h4>
                    <p className="text-sm text-campus-text-secondary">Reference: {p.ref}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-4 text-sm text-campus-text-secondary">
                      <span>Date: {formatDate(p.date)}</span>
                      <span>Amount: {formatCurrency(p.amount)}</span>
                      <span>Target: {p.totalStudents} student(s)</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-start sm:items-end gap-2">
                    <Chip className={statusClass}>{statusLabel}</Chip>

                    <Button
                      size="sm"
                      variant="flat"
                      onPress={() => setExpandedPayment(expandedPayment === p.id ? null : p.id)}
                      className="px-4 text-xs"
                    >
                      {expandedPayment === p.id ? "Hide Info" : "Info"}
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
                      <Chip color="success" variant="flat" className="font-semibold">
                        Paid: {paid}
                      </Chip>

                      <Chip color="danger" variant="flat" className="font-semibold">
                        Unpaid: {unpaid}
                      </Chip>
                    </div>

                    <h4 className="font-semibold text-campus-text-primary mb-2">Students</h4>

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
                        selectedKeys={new Set([studentYearFilter || "__all_years__"])}
                        onSelectionChange={(keys) => {
                          if (keys === "all") return;
                          const selected = Array.from(keys)[0];
                          if (typeof selected === "string") {
                            setStudentYearFilter(selected === "__all_years__" ? "" : selected);
                          }
                        }}
                        disallowEmptySelection
                        className="w-full"
                        items={[
                          { key: "__all_years__", label: "All Years" },
                          ...studentYearOptions.map((yearName) => ({ key: yearName, label: yearName })),
                        ] satisfies SelectOption[]}
                      >
                        {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
                      </Select>

                      <Select
                        aria-label="Filter students by course"
                        selectedKeys={new Set([studentCourseFilter || "__all_courses__"])}
                        onSelectionChange={(keys) => {
                          if (keys === "all") return;
                          const selected = Array.from(keys)[0];
                          if (typeof selected === "string") {
                            setStudentCourseFilter(selected === "__all_courses__" ? "" : selected);
                          }
                        }}
                        disallowEmptySelection
                        className="w-full"
                        items={[
                          { key: "__all_courses__", label: "All Courses" },
                          ...studentCourseOptions.map((courseName) => ({ key: courseName, label: courseName })),
                        ] satisfies SelectOption[]}
                      >
                        {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
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
                          onAction={(key) => setStudentStatusSortMode(String(key) as StudentStatusSortMode)}
                        >
                          <DropdownItem key="paid">Paid</DropdownItem>
                          <DropdownItem key="unpaid">Unpaid</DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    </div>

                    {expandedStudentsLoading && rows.length === 0 ? (
                      <p className="text-sm text-campus-text-secondary">Loading student assignments...</p>
                    ) : rows.length === 0 ? (
                      <p className="text-sm text-campus-text-secondary">No student assignments yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-sm">
                          <thead className="bg-gray-100 text-campus-text-secondary">
                            <tr>
                              <th className="p-2 text-left">Student ID</th>
                              <th className="p-2 text-left">Name</th>
                              <th className="p-2 text-left">Course</th>
                              <th className="p-2 text-left">Year Level</th>
                              <th className="p-2 text-left">Section</th>
                              <th className="p-2 text-left">Status</th>
                              <th className="p-2 text-left">Action</th>
                            </tr>
                          </thead>

                          <tbody>
                            {filteredSortedStudentRows.map((student) => {
                              const actionKey = `${p.id}:${student.uid}`;
                              const nextStatusLabel = student.status === "Paid" ? "Mark Unpaid" : "Mark Paid";

                              return (
                                <tr key={student.uid} className="border-b hover:bg-gray-50">
                                  <td className="p-2">{student.schoolId || student.uid}</td>
                                  <td className="p-2">{student.name}</td>
                                  <td className="p-2">{student.course}</td>
                                  <td className="p-2">{student.year}</td>
                                  <td className="p-2">{student.section}</td>

                                  <td className="p-2">
                                    <span
                                      className={`px-2 py-1 rounded-lg text-xs ${
                                        student.status === "Paid"
                                          ? "bg-green-100 text-green-700"
                                          : "bg-red-100 text-red-700"
                                      }`}
                                    >
                                      {student.status}
                                    </span>
                                  </td>

                                  <td className="p-2">
                                    <Button
                                      size="sm"
                                      color="primary"
                                      onPress={() => toggleStudentStatus(p.id, student)}
                                      isDisabled={updatingStatusKey === actionKey}
                                      className="px-3 text-xs"
                                    >
                                      {updatingStatusKey === actionKey ? "Saving..." : nextStatusLabel}
                                    </Button>
                                  </td>
                                </tr>
                              );
                            })}
                            {filteredSortedStudentRows.length === 0 && (
                              <tr>
                                <td colSpan={7} className="p-3 text-center text-sm text-campus-text-secondary">
                                  No students match your search/filter.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
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
    </div>
  );
}
