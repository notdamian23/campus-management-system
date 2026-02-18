"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FiChevronDown, FiChevronUp, FiPlus } from "react-icons/fi";
import { Card, CardBody } from "@heroui/card";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";

type TimestampLike = {
  toDate: () => Date;
};

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

function hasToDate(value: unknown): value is TimestampLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  );
}

function fmtTS(ts: unknown) {
  try {
    if (!ts) return "-";
    const d = hasToDate(ts) ? ts.toDate() : new Date(ts as string | number | Date);
    if (Number.isNaN(d.getTime())) return "-";
    return d.toLocaleString();
  } catch {
    return "-";
  }
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

export default function ECStudentLookup() {
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [queryText, setQueryText] = useState<string>("");
  const [courseFilter, setCourseFilter] = useState<string>("");
  const [yearFilter, setYearFilter] = useState<string>("");

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

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const clearFilters = () => {
    setQueryText("");
    setCourseFilter("");
    setYearFilter("");
    setExpandedId(null);
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
    <div className="p-6 space-y-6">
      <Card shadow="sm">
        <CardBody className="flex flex-row justify-between items-center px-6 py-4">
          <h1 className="text-xl font-bold text-primary-900">Engineering Student Management System</h1>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        {summaryCards.map((item) => (
          <div key={item.label} className="bg-white rounded-lg shadow p-4 text-center border">
            <div className="text-2xl font-bold">{item.count}</div>
            <p className="text-sm text-campus-text-secondary">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <input
          type="text"
          placeholder="Search student name, student ID, or email..."
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          className="flex-1 min-w-[220px] px-4 py-3 border rounded-lg shadow-sm"
        />

        <select
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="px-4 py-3 border rounded-lg shadow-sm min-w-[220px]"
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
          className="px-4 py-3 border rounded-lg shadow-sm min-w-[170px]"
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
          className="px-4 py-3 rounded-lg border bg-white hover:bg-gray-50 text-sm font-medium"
        >
          Clear Filters
        </button>

        <button
          type="button"
          onClick={() => setShowAddForm((prev) => !prev)}
          className={[
            "flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium text-white",
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
        <table className="w-full text-left">
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
              filtered.map((student) => (
                <React.Fragment key={student.uid}>
                  <tr className="border-b hover:bg-gray-50">
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
                        onClick={() => toggleExpand(student.uid)}
                        className="p-2 bg-transparent hover:bg-gray-100 text-gray-600 hover:text-gray-900 rounded-lg transition-colors"
                        aria-label={expandedId === student.uid ? "Collapse details" : "Expand details"}
                      >
                        {expandedId === student.uid ? <FiChevronUp size={20} /> : <FiChevronDown size={20} />}
                      </button>
                    </td>
                  </tr>

                  {expandedId === student.uid && (
                    <tr>
                      <td colSpan={6} className="bg-gray-50 p-6">
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-sm">
                          <div>
                            <p className="text-gray-500">Student ID</p>
                            <p className="font-semibold text-gray-900">{student.id}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">UID</p>
                            <p className="font-semibold text-gray-900 break-all">{student.uid}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Email</p>
                            <p className="font-semibold text-gray-900">{student.email ?? "-"}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Course</p>
                            <p className="font-semibold text-gray-900">{student.course}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Year Level</p>
                            <p className="font-semibold text-gray-900">{student.year}</p>
                          </div>
                          <div>
                            <p className="text-gray-500">Created At</p>
                            <p className="font-semibold text-gray-900">{fmtTS(student.createdAt)}</p>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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
    </div>
  );
}
