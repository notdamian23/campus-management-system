"use client";

import { useEffect, useMemo, useState } from "react";
import { FiCalendar } from "react-icons/fi";
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
    <div className="p-6 space-y-6">
      <div className="bg-white p-6 shadow rounded-xl border">
        <h1 className="text-2xl font-bold text-primary-900">Campus Payment Management</h1>
        <p className="text-campus-text-secondary text-sm mt-1">Track, verify, and manage student payments.</p>
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

      <div className="flex flex-wrap items-center justify-between gap-4">
        <input
          type="text"
          placeholder="Search by title, reference, course, or year..."
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          className="flex-1 min-w-[260px] px-4 py-3 border rounded-lg shadow-sm"
        />

        <div className="flex items-center gap-2 px-4 py-3 border rounded-lg shadow-sm bg-white">
          <FiCalendar />
          <input
            type="date"
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            className="outline-none"
            aria-label="Filter by date"
          />
        </div>

        <button
          onClick={() => setShowAddPaymentForm(true)}
          className="bg-primary-500 text-white px-4 py-3 rounded-lg shadow hover:bg-primary-600 transition"
        >
          + Add Payment
        </button>
      </div>

      {showAddPaymentForm && (
        <div className="bg-white p-6 border rounded-xl shadow space-y-4 animate-slideDown">
          <div className="flex items-start justify-between">
            <h2 className="text-xl font-semibold text-primary-900">Add New Payment</h2>

            <button
              onClick={() => setShowAddPaymentForm(false)}
              className="px-3 py-1 bg-gray-200 hover:bg-gray-300 rounded text-sm"
            >
              Close
            </button>
          </div>

          <div>
            <label className="text-sm font-medium">Payment Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm"
              placeholder="e.g., Acquaintance Party"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Amount</label>
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm"
              placeholder="Enter amount"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Date</label>
            <input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Year Level</label>
            <select
              value={yearLevel}
              onChange={(e) => setYearLevel(e.target.value)}
              className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm"
            >
              <option value="All Years">All Years</option>
              {yearOptions.map((yearName) => (
                <option key={yearName} value={yearName}>
                  {yearName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Course</label>
            <select
              value={course}
              onChange={(e) => setCourse(e.target.value)}
              className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm"
            >
              <option value="All Courses">All Courses</option>
              {courseOptions.map((courseName) => (
                <option key={courseName} value={courseName}>
                  {courseName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-sm font-medium">Details</label>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              className="w-full h-28 mt-1 px-4 py-3 border rounded-lg shadow-sm"
              placeholder="Additional notes..."
            ></textarea>
          </div>

          <p className="text-xs text-campus-text-secondary">
            {studentsLoading
              ? "Loading student roster..."
              : "This payment will be assigned to students matching the selected course/year."}
          </p>

          <button
            onClick={handleSavePayment}
            disabled={savingPayment || studentsLoading}
            className="w-full px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-60"
          >
            {savingPayment ? "Saving..." : "Save Payment"}
          </button>
        </div>
      )}

      <div className="bg-white border shadow rounded-lg p-6">
        <h3 className="text-lg font-semibold mb-4">Payment List</h3>

        {paymentsLoading ? (
          <p className="text-sm text-campus-text-secondary">Loading payments...</p>
        ) : filteredPayments.length === 0 ? (
          <p className="text-sm text-campus-text-secondary">No payments found.</p>
        ) : (
          filteredPayments.map((p) => {
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

            return (
              <div key={p.id} className="border rounded-lg p-4 shadow-sm hover:bg-gray-50 transition mb-4">
                <div className="flex justify-between items-center gap-4">
                  <div>
                    <h4 className="font-semibold text-campus-text-primary">{p.title}</h4>
                    <p className="text-sm text-campus-text-secondary">Reference: {p.ref}</p>

                    <div className="flex gap-4 items-center mt-2 text-sm text-campus-text-secondary flex-wrap">
                      <span>Date: {formatDate(p.date)}</span>
                      <span>Amount: {formatCurrency(p.amount)}</span>
                      <span>Target: {p.totalStudents} student(s)</span>
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className={`px-3 py-1 rounded-full text-xs ${statusClass}`}>{statusLabel}</span>

                    <button
                      onClick={() => setExpandedPayment(expandedPayment === p.id ? null : p.id)}
                      className="px-4 py-1 bg-gray-200 text-campus-text-primary text-xs rounded-lg hover:bg-gray-300 transition"
                    >
                      {expandedPayment === p.id ? "Hide Info" : "Info"}
                    </button>
                  </div>
                </div>

                {expandedPayment === p.id && (
                  <div className="mt-4 border-t pt-3">
                    <div className="flex justify-end mb-3">
                      <button
                        onClick={() => exportCsv(p)}
                        className="px-4 py-2 bg-primary-100 hover:bg-primary-200 text-primary-700 font-semibold rounded-lg shadow"
                      >
                        Export Report
                      </button>
                    </div>

                    <div className="flex gap-4 mb-4">
                      <span className="px-4 py-1 bg-green-100 text-green-700 rounded-full font-semibold text-sm">
                        Paid: {paid}
                      </span>

                      <span className="px-4 py-1 bg-red-100 text-red-700 rounded-full font-semibold text-sm">
                        Unpaid: {unpaid}
                      </span>
                    </div>

                    <h4 className="font-semibold text-campus-text-primary mb-2">Students</h4>

                    {expandedStudentsLoading && rows.length === 0 ? (
                      <p className="text-sm text-campus-text-secondary">Loading student assignments...</p>
                    ) : rows.length === 0 ? (
                      <p className="text-sm text-campus-text-secondary">No student assignments yet.</p>
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
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
                            {rows.map((student) => {
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
                                    <button
                                      onClick={() => toggleStudentStatus(p.id, student)}
                                      disabled={updatingStatusKey === actionKey}
                                      className="px-3 py-1 bg-primary-500 hover:bg-primary-600 text-white rounded text-xs disabled:opacity-60"
                                    >
                                      {updatingStatusKey === actionKey ? "Saving..." : nextStatusLabel}
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
