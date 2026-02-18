"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import LogoutButton from "@/components/LogoutButton";
import { app } from "@/lib/firebase"; // you must export `app` from your firebase.ts

import { auth, db } from "@/lib/firebase";
import {
  collection,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { httpsCallable, getFunctions } from "firebase/functions";

type Role = "admin" | "ec" | "teacher" | "student";
type Tab = "overview" | "users" | "logs" | "exports";

type TimestampLike = {
  toDate: () => Date;
};

type Profile = {
  id: string; // uid
  schoolId?: string;
  email?: string;
  role: Role;
  studentName?: string;
  course?: string;
  year?: string;
  mustChangePassword?: boolean;
  createdAt?: unknown;
};

type LogItem = {
  id: string;
  action?: string;
  actorUid?: string;
  actorSchoolId?: string;
  targetUid?: string;
  targetSchoolId?: string;
  createdAt?: unknown;
  meta?: unknown;
};

type EventItem = {
  id: string;
  title?: string;
  dateStart?: unknown;
  dateEnd?: unknown;
};

const roleCards = [
  { role: "Admin", summary: "Full access to platform configuration and monitoring.", route: "/admin" },
  { role: "EC Member", summary: "Manages events, payments, and student engineering activities.", route: "/ecmember" },
  { role: "Teacher", summary: "Handles class-related views, student monitoring, and events.", route: "/teacher" },
  { role: "Student", summary: "Tracks status, notifications, and event participation.", route: "/student" },
];

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "ec" || value === "teacher" || value === "student";
}

function hasToDate(value: unknown): value is TimestampLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as { toDate?: unknown }).toDate === "function"
  );
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

function badge(role: Role) {
  const base = "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold border";
  switch (role) {
    case "admin":
      return `${base} bg-red-50 text-[#7b0000] border-red-200`;
    case "ec":
      return `${base} bg-amber-50 text-amber-800 border-amber-200`;
    case "teacher":
      return `${base} bg-blue-50 text-blue-800 border-blue-200`;
    case "student":
      return `${base} bg-emerald-50 text-emerald-800 border-emerald-200`;
    default:
      return `${base} bg-gray-50 text-gray-700 border-gray-200`;
  }
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);

  // Tabs
  const [tab, setTab] = useState<Tab>("overview");
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: "overview", label: "Overview" },
    { key: "users", label: "Users & Roles" },
    { key: "logs", label: "Logs" },
    { key: "exports", label: "Exports" },
  ];

  // Guard / auth state
  const [checking, setChecking] = useState(true);
  const [adminUid, setAdminUid] = useState<string | null>(null);

  // Users
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [savingRoleUid, setSavingRoleUid] = useState<string | null>(null);

  // Create user
  const [newSchoolId, setNewSchoolId] = useState("");
  const [newRole, setNewRole] = useState<Role>("student");
  const [newStudentName, setNewStudentName] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [newYear, setNewYear] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);

  // Delete user
  const [deletingUid, setDeletingUid] = useState<string | null>(null);

  // Logs
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  // Exports
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);

  // Toast-ish feedback
  const [notice, setNotice] = useState<{ type: "ok" | "err"; msg: string } | null>(null);
  const showOk = (msg: string) => setNotice({ type: "ok", msg });
  const showErr = (msg: string) => setNotice({ type: "err", msg });

  // ---------------------------
  // Admin guard: must be admin
  // ---------------------------
  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      try {
        setChecking(true);

        if (!user) {
          router.replace("/login");
          return;
        }

        const pRef = doc(db, "profiles", user.uid);
        const pSnap = await getDoc(pRef);

        if (!pSnap.exists()) {
          router.replace("/login");
          return;
        }

        const role = (pSnap.data()?.role ?? "") as Role;
        if (role !== "admin") {
          router.replace("/login");
          return;
        }

        setAdminUid(user.uid);
      } catch {
        router.replace("/login");
      } finally {
        setChecking(false);
      }
    });

    return () => unsub();
  }, [router]);

  // ---------------------------
  // Live users (profiles)
  // ---------------------------
  useEffect(() => {
    if (!adminUid) return;

    // If your profiles count is big later, switch to pagination.
    const qy = query(collection(db, "profiles"), orderBy("role", "asc"), limit(500));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: Profile[] = snap.docs.map((d) => {
          const data = d.data() as Partial<Profile>;
          return {
            id: d.id,
            schoolId: data.schoolId,
            email: data.email,
            role: isRole(data.role) ? data.role : "student",
            studentName: typeof data.studentName === "string" ? data.studentName : undefined,
            course: typeof data.course === "string" ? data.course : undefined,
            year: typeof data.year === "string" ? data.year : undefined,
            mustChangePassword: data.mustChangePassword,
            createdAt: data.createdAt,
          };
        });
        setProfiles(rows);
      },
      () => showErr("Failed to load profiles.")
    );

    return () => unsub();
  }, [adminUid]);

  // ---------------------------
  // Live logs (read-only)
  // ---------------------------
  useEffect(() => {
    if (!adminUid) return;

    setLogsLoading(true);
    const qy = query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(50));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: LogItem[] = snap.docs.map((d) => {
          const data = d.data() as Partial<LogItem>;
          return {
            id: d.id,
            action: data.action,
            actorUid: data.actorUid,
            actorSchoolId: data.actorSchoolId,
            targetUid: data.targetUid,
            targetSchoolId: data.targetSchoolId,
            createdAt: data.createdAt,
            meta: data.meta,
          };
        });
        setLogs(rows);
        setLogsLoading(false);
      },
      () => {
        setLogsLoading(false);
        showErr("Failed to load logs.");
      }
    );

    return () => unsub();
  }, [adminUid]);

  // ---------------------------
  // Events for export dropdown
  // ---------------------------
  useEffect(() => {
    if (!adminUid) return;

    const qy = query(collection(db, "events"), orderBy("dateStart", "desc"), limit(200));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: EventItem[] = snap.docs.map((d) => {
          const data = d.data() as Partial<EventItem>;
          return {
            id: d.id,
            title: data.title,
            dateStart: data.dateStart,
            dateEnd: data.dateEnd,
          };
        });
        setEvents(rows);
        if (!eventId && rows.length) setEventId(rows[0].id);
      },
      () => showErr("Failed to load events.")
    );

    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminUid]);

  const filteredProfiles = useMemo(() => {
    const s = userSearch.trim().toLowerCase();
    if (!s) return profiles;
    return profiles.filter((p) => {
      const a = (p.schoolId ?? "").toLowerCase();
      const b = (p.email ?? "").toLowerCase();
      const c = (p.role ?? "").toLowerCase();
      const d = (p.id ?? "").toLowerCase();
      const e = (p.studentName ?? "").toLowerCase();
      const f = (p.course ?? "").toLowerCase();
      const g = (p.year ?? "").toLowerCase();
      return a.includes(s) || b.includes(s) || c.includes(s) || d.includes(s) || e.includes(s) || f.includes(s) || g.includes(s);
    });
  }, [profiles, userSearch]);

  async function updateRole(uid: string, role: Role) {
    try {
      setSavingRoleUid(uid);
      await updateDoc(doc(db, "profiles", uid), { role });
      showOk("Role updated.");
    } catch {
      showErr("Failed to update role.");
    } finally {
      setSavingRoleUid(null);
    }
  }

  // IMPORTANT: Auth user creation/deletion must be done on server (Cloud Function Admin SDK)
  async function createAccount() {
    const schoolId = newSchoolId.trim();
    const email = newEmail.trim();
    const studentName = newStudentName.trim();
    const course = newCourse.trim();
    const year = newYear.trim();

    if (!schoolId) return showErr("School ID is required.");
    if (!["admin", "ec", "teacher", "student"].includes(newRole)) return showErr("Invalid role.");
    if (newRole === "student" && !studentName) return showErr("Student name is required for student role.");
    if (newRole === "student" && !course) return showErr("Course is required for student role.");
    if (newRole === "student" && !year) return showErr("Year is required for student role.");

    setCreating(true);
    setExportUrl(null);

    try {
      // Callable function name suggestion: adminCreateUser
      // Server should:
      // - create auth user (email optional)
      // - set default password = schoolId (or your choice)
      // - create /profiles/{uid} with { schoolId, role, studentName?, course?, year?, mustChangePassword:true, email }
      const fn = httpsCallable<{
        schoolId: string;
        role: Role;
        email: string | null;
        studentName: string | null;
        course: string | null;
        year: string | null;
      }, { uid?: string }>(
        functions,
        "adminCreateUser"
      );
      const res = await fn({
        schoolId,
        role: newRole,
        email: email || null,
        studentName: newRole === "student" ? studentName : null,
        course: newRole === "student" ? course : null,
        year: newRole === "student" ? year : null,
      });

      showOk(`Account created. UID: ${res.data?.uid ?? "-"}`);

      setNewSchoolId("");
      setNewStudentName("");
      setNewCourse("");
      setNewYear("");
      setNewEmail("");
      setNewRole("student");
      setTab("users");
    } catch (e: unknown) {
      console.error("adminCreateUser error:", e);
      showErr(toErrorMessage(e, "Failed to create account."));
    } finally {
      setCreating(false);
    }
  }

  async function removeAccount(uid: string) {
    if (!uid) return;
    setDeletingUid(uid);

    try {
      // Callable function name suggestion: adminDeleteUser
      // Server should:
      // - delete auth user
      // - delete /profiles/{uid}
      // - optionally delete related subcollections safely
      const fn = httpsCallable(functions, "adminDeleteUser");
      await fn({ uid });

      showOk("Account removed.");
    } catch (e: unknown) {
      showErr(toErrorMessage(e, "Failed to remove account."));
    } finally {
      setDeletingUid(null);
    }
  }

  async function exportAttendance() {
    if (!eventId) return showErr("Select an event first.");
    setExporting(true);
    setExportUrl(null);

    try {
      // Callable function name suggestion: adminExportAttendance
      // Server should:
      // - read attendance records for eventId
      // - generate CSV
      // - upload to Storage
      // - return a signed download URL (or a Storage path)
      const fn = httpsCallable<{ eventId: string }, { downloadUrl?: string }>(functions, "adminExportAttendance");
      const res = await fn({ eventId });

      const url = res.data?.downloadUrl;
      if (!url) {
        showErr("Export finished but no download URL returned.");
      } else {
        setExportUrl(url);
        showOk("Export ready.");
      }
    } catch (e: unknown) {
      showErr(toErrorMessage(e, "Failed to export attendance."));
    } finally {
      setExporting(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-[#f2f2f2] p-6 sm:p-8 lg:p-10">
        <div className="bg-white border shadow-sm rounded-2xl p-6">
          <p className="text-sm text-gray-600">Checking admin access...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f2f2f2] p-6 sm:p-8 lg:p-10 space-y-6">
      {/* Header */}
      <section className="bg-white border shadow-sm rounded-2xl p-6 sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#7b0000] uppercase tracking-wide">Admin Dashboard</p>
            <h1 className="text-3xl sm:text-4xl font-black text-gray-900 mt-1">Campus Management Control Center</h1>
            <p className="text-gray-600 mt-3 max-w-2xl">
              Supervise users, roles, logs, and exports. Account creation/removal & exports are handled by Cloud Functions
              for security.
            </p>
          </div>

          <div className="shrink-0 flex items-center gap-3">
            <LogoutButton />
          </div>
        </div>

        {/* Tabs */}
        <div className="mt-6 flex flex-wrap gap-2">
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={[
                  "px-4 py-2 rounded-xl text-sm font-semibold border transition",
                  active
                    ? "bg-[#7b0000] text-white border-[#7b0000]"
                    : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
                ].join(" ")}
              >
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Notice */}
        {notice && (
          <div
            className={[
              "mt-4 rounded-xl border px-4 py-3 text-sm font-medium",
              notice.type === "ok"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-red-50 border-red-200 text-red-900",
            ].join(" ")}
          >
            {notice.msg}
          </div>
        )}
      </section>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <>
          <section className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
            {roleCards.map((item) => (
              <article key={item.role} className="bg-white border rounded-xl p-5 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Role</p>
                <h2 className="text-xl font-bold text-[#7b0000] mt-1">{item.role}</h2>
                <p className="text-sm text-gray-600 mt-3 min-h-16">{item.summary}</p>
                <p className="text-xs text-gray-500 mt-3">Default route: {item.route}</p>
              </article>
            ))}
          </section>

          <section className="bg-white border rounded-2xl p-6 shadow-sm">
            <h2 className="text-xl font-bold text-gray-900">Quick Actions</h2>
            <p className="text-sm text-gray-600 mt-1">Common admin actions to start with.</p>

            <div className="mt-5 grid grid-cols-1 lg:grid-cols-3 gap-4">
              <article className="border rounded-xl p-5 bg-gray-50">
                <h3 className="font-semibold text-gray-800">User & Role Management</h3>
                <p className="text-sm text-gray-600 mt-2">Create accounts, change roles, remove accounts.</p>
                <button
                  onClick={() => setTab("users")}
                  className="mt-4 inline-flex rounded-xl bg-[#7b0000] text-white px-4 py-2 text-sm font-semibold"
                >
                  Open Users
                </button>
              </article>

              <article className="border rounded-xl p-5 bg-gray-50">
                <h3 className="font-semibold text-gray-800">System Activity</h3>
                <p className="text-sm text-gray-600 mt-2">Review recent log entries (access, admin actions).</p>
                <button
                  onClick={() => setTab("logs")}
                  className="mt-4 inline-flex rounded-xl bg-white border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-100"
                >
                  View Logs
                </button>
              </article>

              <article className="border rounded-xl p-5 bg-gray-50">
                <h3 className="font-semibold text-gray-800">Attendance Exports</h3>
                <p className="text-sm text-gray-600 mt-2">Generate CSV exports for event attendance records.</p>
                <button
                  onClick={() => setTab("exports")}
                  className="mt-4 inline-flex rounded-xl bg-white border border-gray-200 px-4 py-2 text-sm font-semibold hover:bg-gray-100"
                >
                  Export Attendance
                </button>
              </article>
            </div>
          </section>
        </>
      )}

      {/* USERS */}
      {tab === "users" && (
        <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Users & Roles</h2>
              <p className="text-sm text-gray-600 mt-1">
                Create accounts via Cloud Function. Roles are stored in <span className="font-semibold">/profiles</span>.
              </p>
            </div>

            <div className="w-full sm:w-[320px]">
              <label className="text-xs font-semibold text-gray-600">Search</label>
              <input
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                placeholder="Search schoolId, email, role, uid..."
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
              />
            </div>
          </div>

          {/* Create account */}
          <div className="border rounded-2xl p-5 bg-gray-50">
            <h3 className="font-semibold text-gray-900">Create Account</h3>
            <p className="text-sm text-gray-600 mt-1">
              Recommended: default password = School ID, then force change password on first login.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Student Name, Course, and Year are required when Role is set to student.
            </p>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600">School ID *</label>
                <input
                  value={newSchoolId}
                  onChange={(e) => setNewSchoolId(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
                  placeholder="e.g. 23209455"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600">Student Name</label>
                <input
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
                  placeholder="e.g. Juan Dela Cruz"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600">Role</label>
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as Role)}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
                >
                  <option value="student">student</option>
                  <option value="teacher">teacher</option>
                  <option value="ec">ec</option>
                  <option value="admin">admin</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600">Course</label>
                <select
                  value={newCourse}
                  onChange={(e) => setNewCourse(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
                >
                  <option value="">Select course</option>
                  <option value="Computer Engineering">Computer Engineering</option>
                  <option value="Electrical Engineering">Electrical Engineering</option>
                  <option value="Mechanical Engineering">Mechanical Engineering</option>
                  <option value="Industrial Engineering">Industrial Engineering</option>
                  <option value="Electronics Engineering">Electronics Engineering</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-600">Year</label>
                <select
                  value={newYear}
                  onChange={(e) => setNewYear(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
                >
                  <option value="">Select year</option>
                  <option value="1st Year">1st Year</option>
                  <option value="2nd Year">2nd Year</option>
                  <option value="3rd Year">3rd Year</option>
                  <option value="4th Year">4th Year</option>
                  <option value="5th Year">5th Year</option>
                </select>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-600">Email (optional)</label>
                <input
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
                  placeholder="optional@email.com"
                />
              </div>
            </div>

            <button
              onClick={createAccount}
              disabled={creating}
              className={[
                "mt-4 inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold",
                creating ? "bg-gray-300 text-gray-700" : "bg-[#7b0000] text-white hover:opacity-95",
              ].join(" ")}
            >
              {creating ? "Creating..." : "Create Account"}
            </button>


          </div>

          {/* Users table */}
          <div className="overflow-x-auto border rounded-2xl">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr className="text-left text-gray-600">
                  <th className="px-4 py-3 font-semibold">School ID</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">UID</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredProfiles.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="px-4 py-3 font-medium text-gray-900">{p.schoolId ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-700">{p.email ?? "-"}</td>
                    <td className="px-4 py-3 text-gray-500">{p.id}</td>
                    <td className="px-4 py-3">
                      <span className={badge(p.role)}>{p.role}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2 items-center">
                        <select
                          value={p.role}
                          disabled={savingRoleUid === p.id}
                          onChange={(e) => updateRole(p.id, e.target.value as Role)}
                          className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-semibold outline-none"
                        >
                          <option value="student">student</option>
                          <option value="teacher">teacher</option>
                          <option value="ec">ec</option>
                          <option value="admin">admin</option>
                        </select>

                        <button
                          onClick={() => removeAccount(p.id)}
                          disabled={deletingUid === p.id}
                          className={[
                            "rounded-xl px-3 py-2 text-xs font-semibold border",
                            deletingUid === p.id
                              ? "bg-gray-100 text-gray-500 border-gray-200"
                              : "bg-white text-red-700 border-red-200 hover:bg-red-50",
                          ].join(" ")}
                        >
                          {deletingUid === p.id ? "Removing..." : "Remove"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {!filteredProfiles.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-gray-600">
                      No users found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          
        </section>
      )}

      {/* LOGS */}
      {tab === "logs" && (
        <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-4">
          <div>
            <h2 className="text-xl font-bold text-gray-900">System Logs</h2>
            <p className="text-sm text-gray-600 mt-1">Recent activity entries (recommended: server-written only).</p>
          </div>

          {logsLoading ? (
            <div className="text-sm text-gray-600">Loading logs...</div>
          ) : (
            <div className="overflow-x-auto border rounded-2xl">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-gray-600">
                    <th className="px-4 py-3 font-semibold">Time</th>
                    <th className="px-4 py-3 font-semibold">Action</th>
                    <th className="px-4 py-3 font-semibold">Actor</th>
                    <th className="px-4 py-3 font-semibold">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="px-4 py-3 text-gray-700">{fmtTS(l.createdAt)}</td>
                      <td className="px-4 py-3 font-medium text-gray-900">{l.action ?? "-"}</td>
                      <td className="px-4 py-3 text-gray-700">
                        {l.actorSchoolId ?? "-"}
                        <div className="text-xs text-gray-500">{l.actorUid ?? ""}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {l.targetSchoolId ?? "-"}
                        <div className="text-xs text-gray-500">{l.targetUid ?? ""}</div>
                      </td>
                    </tr>
                  ))}

                  {!logs.length && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-gray-600">
                        No logs yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* EXPORTS */}
      {tab === "exports" && (
        <section className="bg-white border rounded-2xl p-6 shadow-sm space-y-5">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Export Attendance</h2>
            <p className="text-sm text-gray-600 mt-1">Select an event and generate a CSV file (server-generated).</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-gray-600">Event</label>
              <select
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#7b0000]/20"
              >
                {events.map((ev) => (
                  <option key={ev.id} value={ev.id}>
                    {ev.title ?? ev.id}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-1 flex items-end">
              <button
                onClick={exportAttendance}
                disabled={exporting || !eventId}
                className={[
                  "w-full inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold",
                  exporting ? "bg-gray-300 text-gray-700" : "bg-[#7b0000] text-white hover:opacity-95",
                ].join(" ")}
              >
                {exporting ? "Exporting..." : "Generate Export"}
              </button>
            </div>
          </div>

          {exportUrl && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm font-semibold text-emerald-900">Export ready</p>
              <p className="text-sm text-emerald-900 mt-1 break-all">{exportUrl}</p>
              <a
                href={exportUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex rounded-xl bg-white border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100"
              >
                Download CSV
              </a>
            </div>
          )}

          <div className="text-xs text-gray-500">
            If you want &quot;Export by date range&quot; or &quot;Export all events&quot;, the export function can accept extra
            parameters.
          </div>
        </section>
      )}
    </div>
  );
}

