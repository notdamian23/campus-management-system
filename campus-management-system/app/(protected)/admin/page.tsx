"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Select, SelectItem } from "@heroui/select";
import { Tab, Tabs } from "@heroui/tabs";
import LogoutButton from "@/components/LogoutButton";
import { app, auth, db } from "@/lib/firebase";
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, updateDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const roleOptions = ["student", "teacher", "ec", "admin"] as const;
type Role = (typeof roleOptions)[number];
type AdminTab = "overview" | "users" | "logs" | "exports";
type Profile = { id: string; schoolId?: string; email?: string; role: Role };
type LogItem = { id: string; action?: string; actorUid?: string; actorSchoolId?: string; targetUid?: string; targetSchoolId?: string; createdAt?: unknown };
type EventItem = { id: string; title?: string };
type Notice = { type: "ok" | "err"; msg: string };

const roleCards = [
  { role: "Admin", summary: "Full platform control and monitoring.", route: "/admin" },
  { role: "EC Member", summary: "Runs student operations, events, payments, and docs.", route: "/ecmember" },
  { role: "Teacher", summary: "Reviews attendance, activity, and classroom-facing data.", route: "/teacher" },
  { role: "Student", summary: "Tracks events, payments, and notifications.", route: "/student" },
];

function fmtTS(ts: unknown) {
  try {
    if (!ts) return "-";
    const maybe = ts as { toDate?: () => Date };
    const d = typeof maybe.toDate === "function" ? maybe.toDate() : new Date(ts as string | number | Date);
    return d.toLocaleString();
  } catch {
    return "-";
  }
}

function toErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { code?: string; message?: string };
    if (maybe.code && maybe.message) return `${maybe.code}: ${maybe.message}`;
    if (maybe.message) return maybe.message;
  }
  return fallback;
}

function formatRole(role: Role) {
  return role === "ec" ? "EC Member" : `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

function roleColor(role: Role): "danger" | "warning" | "primary" | "success" {
  if (role === "admin") return "danger";
  if (role === "ec") return "warning";
  if (role === "teacher") return "primary";
  return "success";
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);
  const [tab, setTab] = useState<AdminTab>("overview");
  const [checking, setChecking] = useState(true);
  const [adminUid, setAdminUid] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [savingRoleUid, setSavingRoleUid] = useState<string | null>(null);
  const [newSchoolId, setNewSchoolId] = useState("");
  const [newRole, setNewRole] = useState<Role>("student");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventId, setEventId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const showOk = (msg: string) => setNotice({ type: "ok", msg });
  const showErr = (msg: string) => setNotice({ type: "err", msg });

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      try {
        setChecking(true);
        if (!user) return router.replace("/login");
        const snap = await getDoc(doc(db, "profiles", user.uid));
        if (!snap.exists() || snap.data()?.role !== "admin") return router.replace("/login");
        setAdminUid(user.uid);
      } catch {
        router.replace("/login");
      } finally {
        setChecking(false);
      }
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!adminUid) return;
    return onSnapshot(query(collection(db, "profiles"), orderBy("role", "asc"), limit(500)), (snap) => {
      setProfiles(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Profile, "id">) })));
    }, () => showErr("Failed to load profiles."));
  }, [adminUid]);

  useEffect(() => {
    if (!adminUid) return;
    setLogsLoading(true);
    return onSnapshot(query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(50)), (snap) => {
      setLogs(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LogItem, "id">) })));
      setLogsLoading(false);
    }, () => {
      setLogsLoading(false);
      showErr("Failed to load logs.");
    });
  }, [adminUid]);

  useEffect(() => {
    if (!adminUid) return;
    return onSnapshot(query(collection(db, "events"), orderBy("dateStart", "desc"), limit(200)), (snap) => {
      const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EventItem, "id">) }));
      setEvents(rows);
      setEventId((prev) => (prev && rows.some((event) => event.id === prev) ? prev : rows[0]?.id || ""));
    }, () => showErr("Failed to load events."));
  }, [adminUid]);

  const filteredProfiles = useMemo(() => {
    const s = userSearch.trim().toLowerCase();
    if (!s) return profiles;
    return profiles.filter((p) => [p.schoolId, p.email, p.role, p.id].join(" ").toLowerCase().includes(s));
  }, [profiles, userSearch]);

  const roleCounts = useMemo(() => profiles.reduce((acc, profile) => {
    acc[profile.role] += 1;
    return acc;
  }, { admin: 0, ec: 0, teacher: 0, student: 0 } as Record<Role, number>), [profiles]);

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

  async function createAccount() {
    if (!newSchoolId.trim()) return showErr("School ID is required.");
    setCreating(true);
    try {
      const fn = httpsCallable<{ schoolId: string; role: Role; email: string | null }, { uid?: string }>(functions, "adminCreateUser");
      const res = await fn({ schoolId: newSchoolId.trim(), role: newRole, email: newEmail.trim() || null });
      showOk(`Account created. UID: ${res?.data?.uid ?? "-"}`);
      setNewSchoolId("");
      setNewEmail("");
      setNewRole("student");
      setTab("users");
    } catch (error: unknown) {
      showErr(toErrorMessage(error, "Failed to create account."));
    } finally {
      setCreating(false);
    }
  }

  async function removeAccount(uid: string) {
    setDeletingUid(uid);
    try {
      await httpsCallable<{ uid: string }, unknown>(functions, "adminDeleteUser")({ uid });
      showOk("Account removed.");
    } catch (error: unknown) {
      showErr(toErrorMessage(error, "Failed to remove account."));
    } finally {
      setDeletingUid(null);
    }
  }

  async function exportAttendance() {
    if (!eventId) return showErr("Select an event first.");
    setExporting(true);
    setExportUrl(null);
    try {
      const res = await httpsCallable<{ eventId: string }, { downloadUrl?: string }>(functions, "adminExportAttendance")({ eventId });
      const url = res?.data?.downloadUrl;
      if (!url) return showErr("Export finished but no download URL returned.");
      setExportUrl(url);
      showOk("Export ready.");
    } catch (error: unknown) {
      showErr(toErrorMessage(error, "Failed to export attendance."));
    } finally {
      setExporting(false);
    }
  }

  if (checking) {
    return <div className="min-h-screen bg-[#f2f2f2] p-3 sm:p-6 lg:p-10"><Card shadow="sm" className="border"><CardBody className="p-6 text-sm text-gray-600">Checking admin access...</CardBody></Card></div>;
  }

  return (
    <div className="min-h-screen bg-[#f2f2f2] p-3 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-5">
        <Card shadow="sm" className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#991515] to-[#ef6b4a] text-white">
          <CardBody className="flex flex-col gap-5 p-5 sm:p-8 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">Admin Dashboard</p>
                <h1 className="text-3xl font-black sm:text-4xl">Campus Management Control Center</h1>
                <p className="max-w-2xl text-sm text-white/80 sm:text-base">Supervise users, logs, and exports from one mobile-friendly control room.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip variant="flat" className="bg-white/15 text-white">{profiles.length} accounts</Chip>
                <Chip variant="flat" className="bg-white/15 text-white">{logs.length} logs</Chip>
                <Chip variant="flat" className="bg-white/15 text-white">{events.length} events</Chip>
              </div>
            </div>
            <div className="flex items-center gap-3"><Button variant="flat" className="bg-white/15 font-semibold text-white data-[hover=true]:bg-white/25" onPress={() => setTab("users")}>Manage users</Button><LogoutButton className="bg-white text-[#7b0000] data-[hover=true]:bg-white/90" /></div>
          </CardBody>
        </Card>

        {notice && <Card shadow="sm" className={notice.type === "ok" ? "border border-emerald-200 bg-emerald-50" : "border border-red-200 bg-red-50"}><CardBody className={notice.type === "ok" ? "p-4 text-sm font-medium text-emerald-900" : "p-4 text-sm font-medium text-red-900"}>{notice.msg}</CardBody></Card>}

        <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key) as AdminTab)} fullWidth classNames={{ tabList: "grid w-full grid-cols-2 rounded-2xl bg-white p-1 shadow-sm sm:grid-cols-4", cursor: "bg-[#7b0000]", tab: "h-11", tabContent: "text-sm font-semibold group-data-[selected=true]:text-white", panel: "pt-5" }}>
          <Tab key="overview" title="Overview">
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[{ label: "Accounts", value: profiles.length, tone: "text-[#7b0000]" }, { label: "Logs", value: logs.length, tone: "text-amber-700" }, { label: "Events", value: events.length, tone: "text-blue-700" }, { label: "Admins", value: roleCounts.admin, tone: "text-emerald-700" }].map((item) => (
                  <Card key={item.label} shadow="sm" className="border"><CardBody className="p-5"><p className="text-sm text-gray-500">{item.label}</p><h2 className={`mt-2 text-3xl font-black ${item.tone}`}>{item.value}</h2></CardBody></Card>
                ))}
              </div>
              <Card shadow="sm" className="border"><CardHeader className="px-5 pt-5"><div><h2 className="text-xl font-bold text-gray-900">Quick actions</h2><p className="text-sm text-gray-600">Start with the tasks admins usually handle first.</p></div></CardHeader><CardBody className="grid gap-4 p-5 md:grid-cols-3">{[{ title: "Users", text: "Create accounts and change roles.", action: "Open users", onPress: () => setTab("users") }, { title: "Logs", text: "Review recent system activity.", action: "View logs", onPress: () => setTab("logs") }, { title: "Exports", text: "Generate attendance CSV files.", action: "Export data", onPress: () => setTab("exports") }].map((item) => <Card key={item.title} shadow="none" className="border bg-gray-50"><CardBody className="space-y-3 p-4"><div><h3 className="font-semibold text-gray-900">{item.title}</h3><p className="mt-1 text-sm text-gray-600">{item.text}</p></div><Button className="bg-[#7b0000] font-semibold text-white" onPress={item.onPress}>{item.action}</Button></CardBody></Card>)}</CardBody></Card>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">{roleCards.map((item) => <Card key={item.role} shadow="sm" className="border"><CardBody className="space-y-3 p-5"><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Role</p><h3 className="mt-1 text-xl font-bold text-gray-900">{item.role}</h3></div><p className="min-h-16 text-sm text-gray-600">{item.summary}</p><Chip variant="bordered" className="w-fit text-xs text-gray-700">{item.route}</Chip></CardBody></Card>)}</div>
            </div>
          </Tab>

          <Tab key="users" title="Users & Roles">
            <div className="space-y-5">
              <Card shadow="sm" className="border"><CardBody className="flex flex-col gap-4 p-5 lg:flex-row lg:items-end lg:justify-between"><div><h2 className="text-xl font-bold text-gray-900">Users and roles</h2><p className="text-sm text-gray-600">Search profiles, create accounts, and adjust access levels.</p></div><div className="w-full lg:max-w-md"><Input label="Search profiles" value={userSearch} onValueChange={setUserSearch} placeholder="School ID, email, role, or UID" /></div></CardBody></Card>
              <Card shadow="sm" className="border"><CardHeader className="px-5 pt-5"><div><h3 className="text-lg font-bold text-gray-900">Create account</h3><p className="text-sm text-gray-600">Auth creation stays on the server for security.</p></div></CardHeader><CardBody className="space-y-4 p-5"><div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><Input label="School ID" value={newSchoolId} onValueChange={setNewSchoolId} placeholder="e.g. 23209455" isRequired /><Select label="Role" selectedKeys={[newRole]} onSelectionChange={(keys) => { const selected = Array.from(keys as Set<React.Key>)[0]; if (typeof selected === "string") setNewRole(selected as Role); }} disallowEmptySelection>{roleOptions.map((role) => <SelectItem key={role}>{formatRole(role)}</SelectItem>)}</Select><Input label="Email" type="email" value={newEmail} onValueChange={setNewEmail} placeholder="optional@email.com" className="md:col-span-2" /></div><Button className="w-full bg-[#7b0000] font-semibold text-white sm:w-auto" onPress={createAccount} isLoading={creating}>Create account</Button></CardBody></Card>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">{filteredProfiles.map((profile) => <Card key={profile.id} shadow="sm" className="border"><CardBody className="space-y-4 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-lg font-semibold text-gray-900">{profile.schoolId || "No school ID"}</h3><Chip color={roleColor(profile.role)} variant="flat" className="font-semibold">{formatRole(profile.role)}</Chip></div><p className="mt-2 break-all text-sm text-gray-600">{profile.email || "No email on file"}</p><p className="mt-1 break-all text-xs text-gray-500">UID: {profile.id}</p></div></div><div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,220px)_auto] sm:items-end"><Select label="Role assignment" selectedKeys={[profile.role]} onSelectionChange={(keys) => { const selected = Array.from(keys as Set<React.Key>)[0]; if (typeof selected === "string") void updateRole(profile.id, selected as Role); }} disallowEmptySelection isDisabled={savingRoleUid === profile.id}>{roleOptions.map((role) => <SelectItem key={role}>{formatRole(role)}</SelectItem>)}</Select><Button color="danger" variant="flat" onPress={() => removeAccount(profile.id)} isLoading={deletingUid === profile.id}>Remove account</Button></div></CardBody></Card>)}{!filteredProfiles.length && <Card shadow="sm" className="border xl:col-span-2"><CardBody className="p-8 text-center text-sm text-gray-500">No users found.</CardBody></Card>}</div>
            </div>
          </Tab>

          <Tab key="logs" title="Logs">
            <div className="space-y-4">
              <Card shadow="sm" className="border"><CardBody className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="text-xl font-bold text-gray-900">System logs</h2><p className="text-sm text-gray-600">Recent activity entries written for audit and support.</p></div><Chip color="primary" variant="flat" className="w-fit font-semibold">{logs.length} entries</Chip></CardBody></Card>
              {logsLoading ? <Card shadow="sm" className="border"><CardBody className="p-6 text-sm text-gray-600">Loading logs...</CardBody></Card> : !logs.length ? <Card shadow="sm" className="border"><CardBody className="p-8 text-center text-sm text-gray-500">No logs yet.</CardBody></Card> : <div className="space-y-3">{logs.map((log) => <Card key={log.id} shadow="sm" className="border"><CardBody className="space-y-4 p-5"><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Action</p><h3 className="text-lg font-semibold text-gray-900">{log.action || "-"}</h3></div><Chip variant="bordered" className="w-fit text-xs text-gray-600">{fmtTS(log.createdAt)}</Chip></div><div className="grid gap-4 md:grid-cols-2"><div className="rounded-2xl border bg-gray-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Actor</p><p className="mt-2 text-sm font-medium text-gray-900">{log.actorSchoolId || "-"}</p><p className="mt-1 break-all text-xs text-gray-500">{log.actorUid || "-"}</p></div><div className="rounded-2xl border bg-gray-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Target</p><p className="mt-2 text-sm font-medium text-gray-900">{log.targetSchoolId || "-"}</p><p className="mt-1 break-all text-xs text-gray-500">{log.targetUid || "-"}</p></div></div></CardBody></Card>)}</div>}
            </div>
          </Tab>

          <Tab key="exports" title="Exports">
            <div className="space-y-5">
              <Card shadow="sm" className="border"><CardHeader className="px-5 pt-5"><div><h2 className="text-xl font-bold text-gray-900">Attendance exports</h2><p className="text-sm text-gray-600">Generate CSV files from event attendance using Cloud Functions.</p></div></CardHeader><CardBody className="space-y-4 p-5"><div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]"><Select label="Event" selectedKeys={eventId ? [eventId] : []} onSelectionChange={(keys) => { const selected = Array.from(keys as Set<React.Key>)[0]; if (typeof selected === "string") setEventId(selected); }} disallowEmptySelection={events.length > 0} isDisabled={!events.length}>{events.map((ev) => <SelectItem key={ev.id}>{ev.title || ev.id}</SelectItem>)}</Select><Button className="bg-[#7b0000] font-semibold text-white" onPress={exportAttendance} isLoading={exporting} isDisabled={!eventId}>Generate export</Button></div><div className="grid grid-cols-1 gap-4 md:grid-cols-3"><Card shadow="none" className="border bg-gray-50"><CardBody className="p-4"><p className="text-sm text-gray-500">Selected Event</p><p className="mt-2 font-semibold text-gray-900">{events.find((ev) => ev.id === eventId)?.title || eventId || "None selected"}</p></CardBody></Card><Card shadow="none" className="border bg-gray-50"><CardBody className="p-4"><p className="text-sm text-gray-500">Available Exports</p><p className="mt-2 text-2xl font-black text-blue-700">{events.length}</p></CardBody></Card><Card shadow="none" className="border bg-gray-50"><CardBody className="p-4"><p className="text-sm text-gray-500">Delivery</p><p className="mt-2 text-sm font-medium text-gray-900">Signed URL download</p></CardBody></Card></div></CardBody></Card>
              {exportUrl && <Card shadow="sm" className="border border-emerald-200 bg-emerald-50"><CardBody className="space-y-4 p-5"><div><p className="text-sm font-semibold text-emerald-900">Export ready</p><p className="mt-1 break-all text-sm text-emerald-900">{exportUrl}</p></div><div className="flex flex-col gap-3 sm:flex-row"><Button className="bg-white font-semibold text-emerald-900" onPress={() => window.open(exportUrl, "_blank", "noopener,noreferrer")}>Download CSV</Button><Button variant="flat" className="font-semibold text-emerald-900" onPress={() => navigator.clipboard.writeText(exportUrl)}>Copy link</Button></div></CardBody></Card>}
            </div>
          </Tab>
        </Tabs>
      </div>
    </div>
  );
}
