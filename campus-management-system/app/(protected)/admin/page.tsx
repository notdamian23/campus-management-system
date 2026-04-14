"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import { Select, SelectItem } from "@heroui/select";
import { Skeleton } from "@heroui/skeleton";
import { Tab, Tabs } from "@heroui/tabs";
import { Tooltip } from "@heroui/tooltip";
import {
  Download,
  Activity,
  ArrowRight,
  CalendarDays,
  History,
  IdCard,
  LayoutDashboard,
  Mail,
  MoreHorizontal,
  RefreshCcw,
  Search,
  ShieldAlert,
  TriangleAlert,
  UserPlus,
  Users2,
} from "lucide-react";
import { ScrollShadow } from "@heroui/scroll-shadow";
import LogoutButton from "@/components/LogoutButton";
import {
  CampusDataTable,
  CampusEmptyState,
  CampusTableBodySkeleton,
  type CampusTableColumn,
  CampusDetailSkeleton,
  CampusLayoutLoadingState,
  CampusMetricSkeleton,
} from "@/components/ui";
import { app, auth, db } from "@/lib/firebase";
import { campusToast } from "@/lib/toast";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  type CampusProfileDoc,
  getOnboardingRedirect,
} from "@/lib/campus-auth";

const roleOptions = ["student", "teacher", "ec", "admin"] as const;
const yearOptions = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
  "5th Year",
] as const;
const courseOptions = [
  "Computer Engineering",
  "Industrial Engineering",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Electronics Engineering",
] as const;
type Role = (typeof roleOptions)[number];
type AdminTab = "overview" | "users" | "logs" | "exports";
type EmailFilter = "all" | "with_email" | "without_email";
type UserSortMode =
  | "school_id_asc"
  | "school_id_desc"
  | "name_asc"
  | "name_desc"
  | "role_asc"
  | "role_desc"
  | "newest"
  | "oldest";
type Profile = {
  id: string;
  schoolId?: string;
  email?: string;
  role: Role;
  name?: string;
  studentName?: string;
  teacherName?: string;
  course?: string;
  year?: string;
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
};
type EventItem = {
  id: string;
  title?: string;
  date?: string;
  scheduledTime?: string;
  timeStart?: string;
  timeEnd?: string;
  location?: string;
  createdAt?: unknown;
};

type ExportSummary = {
  eventId: string;
  eventTitle: string;
  rowCount: number;
  fileName: string;
  downloadUrl: string;
};
type PendingRoleChange = {
  profile: Profile;
  nextRole: Role;
};

const roleCards = [
  {
    key: "admin" as Role,
    role: "Admin",
    summary: "Full platform control and monitoring.",
    route: "/admin",
  },
  {
    key: "ec" as Role,
    role: "EC Member",
    summary: "Runs student operations, events, payments, and docs.",
    route: "/ecmember",
  },
  {
    key: "teacher" as Role,
    role: "Teacher",
    summary: "Reviews attendance, activity, and classroom-facing data.",
    route: "/teacher",
  },
  {
    key: "student" as Role,
    role: "Student",
    summary: "Tracks events, payments, and notifications.",
    route: "/student",
  },
];

const userColumns: CampusTableColumn<Profile>[] = [
  { key: "schoolId", label: "School ID" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "role", label: "Role" },
  { key: "roleAssignment", label: "Role Assignment" },
  { key: "actions", label: "Actions", align: "end", className: "text-right" },
];

const createAccountFormGridClassName =
  "grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)]";
const createAccountSingleFieldClassName = "md:col-span-2 xl:col-span-2";

const logColumns: CampusTableColumn<LogItem>[] = [
  { key: "action", label: "Action" },
  { key: "actor", label: "Actor" },
  { key: "target", label: "Target" },
  { key: "createdAt", label: "Created" },
];

function fmtTS(ts: unknown) {
  try {
    if (!ts) return "-";
    const maybe = ts as { toDate?: () => Date };
    const date =
      typeof maybe.toDate === "function"
        ? maybe.toDate()
        : new Date(ts as string | number | Date);
    return date.toLocaleString();
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

function toMillis(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }

  if (
    value &&
    typeof value === "object" &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return Number((value as { seconds: number }).seconds) * 1000;
  }

  const parsed = new Date(value as string | number | Date).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function parseTime12ToMinutes(raw: string | undefined) {
  if (!raw) return null;
  const value = raw.trim();
  const twelveHourMatch = value.match(/^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/);
  if (twelveHourMatch) {
    let hours = Number.parseInt(twelveHourMatch[1], 10) % 12;
    const minutes = Number.parseInt(twelveHourMatch[2], 10);
    if (twelveHourMatch[3].toUpperCase() === "PM") hours += 12;
    return hours * 60 + minutes;
  }

  const twentyFourHourMatch = value.match(/^(\d{1,2}):(\d{2})$/);
  if (twentyFourHourMatch) {
    return (
      Number.parseInt(twentyFourHourMatch[1], 10) * 60 +
      Number.parseInt(twentyFourHourMatch[2], 10)
    );
  }

  return null;
}

function getEventSortMs(event: EventItem) {
  const rawDate = String(event.date ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
    const [year, month, day] = rawDate.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    const minutes = parseTime12ToMinutes(event.scheduledTime || event.timeStart);
    if (minutes != null) {
      date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    } else {
      date.setHours(0, 0, 0, 0);
    }
    return date.getTime();
  }

  return toMillis(event.createdAt);
}

function csvCell(value: string | number) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function formatRole(role: Role) {
  return role === "ec"
    ? "EC Member"
    : `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

function roleColor(role: Role): "danger" | "warning" | "primary" | "success" {
  if (role === "admin") return "danger";
  if (role === "ec") return "warning";
  if (role === "teacher") return "primary";
  return "success";
}

function roleRank(role: Role) {
  if (role === "admin") return 0;
  if (role === "ec") return 1;
  if (role === "teacher") return 2;
  return 3;
}

function hasEmail(profile: Profile) {
  return Boolean(String(profile.email ?? "").trim());
}

function resolveProfileName(profile: Pick<Profile, "name" | "studentName" | "teacherName">) {
  const values = [profile.name, profile.studentName, profile.teacherName];
  return values
    .map((value) => String(value ?? "").trim())
    .find(Boolean) ?? "";
}

function compareResolvedNames(left: Profile, right: Profile) {
  const leftName = resolveProfileName(left);
  const rightName = resolveProfileName(right);

  if (leftName && rightName) return leftName.localeCompare(rightName);
  if (leftName) return -1;
  if (rightName) return 1;
  return 0;
}

function getRoleDescription(role: Role) {
  if (role === "admin") return "Full control over users, logs, and exports.";
  if (role === "ec")
    return "Manages student operations, events, payments, and documents.";
  if (role === "teacher")
    return "Reviews classroom-facing activity and attendance data.";
  return "Accesses student-facing events, notifications, and payment data.";
}

function UserRoleChip({ role }: { role: Role }) {
  return (
    <Tooltip content={getRoleDescription(role)} delay={300}>
      <Chip
        color={roleColor(role)}
        variant="flat"
        className="cursor-default font-semibold"
      >
        {formatRole(role)}
      </Chip>
    </Tooltip>
  );
}

function formatLogAction(action?: string) {
  const normalized = String(action ?? "").trim().toLowerCase();
  if (normalized === "admin_create_user") return "User created";
  if (normalized === "delete_user") return "User deleted";
  if (!normalized) return "System activity";
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function logActionColor(
  action?: string,
): "success" | "danger" | "warning" | "default" {
  const normalized = String(action ?? "").trim().toLowerCase();
  if (normalized === "admin_create_user") return "success";
  if (normalized === "delete_user") return "danger";
  if (!normalized) return "default";
  return "warning";
}

function AdminOverviewSkeleton() {
  return (
    <div className="space-y-5">
      <CampusMetricSkeleton />
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} shadow="sm" className="border">
            <CardBody className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-32 rounded-xl" />
                  <Skeleton className="h-4 w-48 rounded-lg" />
                </div>
                <Skeleton className="h-11 w-11 rounded-2xl" />
              </div>
              <Skeleton className="h-10 w-28 rounded-xl" />
            </CardBody>
          </Card>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
        <Card shadow="sm" className="border">
          <CardBody className="space-y-4 p-5">
            <Skeleton className="h-6 w-40 rounded-xl" />
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-2xl border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-36 rounded-lg" />
                    <Skeleton className="h-4 w-52 rounded-lg" />
                    <Skeleton className="h-3 w-28 rounded-lg" />
                  </div>
                  <Skeleton className="h-7 w-20 rounded-full" />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
        <Card shadow="sm" className="border">
          <CardBody className="space-y-4 p-5">
            <Skeleton className="h-6 w-36 rounded-xl" />
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="rounded-2xl border p-4">
                <Skeleton className="h-4 w-28 rounded-lg" />
                <Skeleton className="mt-2 h-4 w-full rounded-lg" />
                <Skeleton className="mt-2 h-9 w-28 rounded-xl" />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} shadow="sm" className="border">
            <CardBody className="space-y-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <Skeleton className="h-8 w-24 rounded-full" />
                <Skeleton className="h-8 w-16 rounded-full" />
              </div>
              <Skeleton className="h-6 w-28 rounded-xl" />
              <Skeleton className="h-12 w-full rounded-xl" />
              <div className="flex items-center justify-between">
                <Skeleton className="h-7 w-20 rounded-full" />
                <Skeleton className="h-9 w-28 rounded-xl" />
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}

function UsersRolesSkeleton() {
  return (
    <div className="space-y-5">
      <Card shadow="sm" className="border">
        <CardBody className="space-y-4 p-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_220px_220px_220px]">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
            <Skeleton className="h-8 w-28 rounded-full" />
          </div>
        </CardBody>
      </Card>
      <Card shadow="sm" className="border">
        <CardHeader className="px-5 pt-5">
          <div className="space-y-2">
            <Skeleton className="h-6 w-40 rounded-xl" />
            <Skeleton className="h-4 w-72 rounded-lg" />
          </div>
        </CardHeader>
        <CardBody className="space-y-4 p-5 pt-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
          <div className="flex flex-wrap gap-3">
            <Skeleton className="h-11 w-40 rounded-xl" />
            <Skeleton className="h-11 w-28 rounded-xl" />
          </div>
        </CardBody>
      </Card>
      <Card shadow="sm" className="border">
        <CardBody className="p-0">
          <CampusTableBodySkeleton rows={6} columns={6} />
        </CardBody>
      </Card>
    </div>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);
  const [tab, setTab] = useState<AdminTab>("overview");
  const [checking, setChecking] = useState(true);
  const [adminUid, setAdminUid] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const [userSortMode, setUserSortMode] =
    useState<UserSortMode>("school_id_asc");
  const [savingRoleUid, setSavingRoleUid] = useState<string | null>(null);
  const [newSchoolId, setNewSchoolId] = useState("");
  const [newRole, setNewRole] = useState<Role>("student");
  const [newEcName, setNewEcName] = useState("");
  const [newTeacherName, setNewTeacherName] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [newYear, setNewYear] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [pendingRoleChange, setPendingRoleChange] =
    useState<PendingRoleChange | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] =
    useState<Profile | null>(null);
  const [logs, setLogs] = useState<LogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventId, setEventId] = useState("");
  const [exporting, setExporting] = useState(false);
  const [lastExport, setLastExport] = useState<ExportSummary | null>(null);

  useEffect(() => {
    return () => {
      if (lastExport?.downloadUrl) {
        URL.revokeObjectURL(lastExport.downloadUrl);
      }
    };
  }, [lastExport]);

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (user) => {
      try {
        setChecking(true);
        if (!user) return router.replace("/login");
        const snap = await getDoc(doc(db, "profiles", user.uid));
        if (!snap.exists()) return router.replace("/login");

        const profile = snap.data() as CampusProfileDoc;
        const onboardingRedirect = getOnboardingRedirect(profile);
        if (onboardingRedirect) return router.replace(onboardingRedirect);

        if (profile.role !== "admin")
          return router.replace("/login");
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
    setProfilesLoading(true);
    return onSnapshot(
      query(collection(db, "profiles"), orderBy("role", "asc"), limit(500)),
      (snap) => {
        setProfiles(
          snap.docs.map((profileDoc) => ({
            id: profileDoc.id,
            ...(profileDoc.data() as Omit<Profile, "id">),
          })),
        );
        setProfilesLoading(false);
      },
      () => {
        setProfiles([]);
        setProfilesLoading(false);
        campusToast.error({
          title: "Profiles unavailable",
          description: "Failed to load profiles.",
          dedupeKey: "admin:profiles-load-error",
        });
      },
    );
  }, [adminUid]);

  useEffect(() => {
    if (!adminUid) return;
    setLogsLoading(true);
    return onSnapshot(
      query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(50)),
      (snap) => {
        setLogs(
          snap.docs.map((logDoc) => ({
            id: logDoc.id,
            ...(logDoc.data() as Omit<LogItem, "id">),
          })),
        );
        setLogsLoading(false);
      },
      () => {
        setLogs([]);
        setLogsLoading(false);
        campusToast.error({
          title: "Logs unavailable",
          description: "Failed to load logs.",
          dedupeKey: "admin:logs-load-error",
        });
      },
    );
  }, [adminUid]);

  useEffect(() => {
    if (!adminUid) return;
    setEventsLoading(true);
    return onSnapshot(
      collection(db, "events"),
      (snap) => {
        const rows = snap.docs
          .map((eventDoc) => ({
            id: eventDoc.id,
            ...(eventDoc.data() as Omit<EventItem, "id">),
          }))
          .sort((left, right) => getEventSortMs(right) - getEventSortMs(left));
        setEvents(rows);
        setEventId((previous) =>
          previous && rows.some((event) => event.id === previous)
            ? previous
            : rows[0]?.id || "",
        );
        setEventsLoading(false);
      },
      () => {
        setEvents([]);
        setEventsLoading(false);
        campusToast.error({
          title: "Events unavailable",
          description: "Failed to load events.",
          dedupeKey: "admin:events-load-error",
        });
      },
    );
  }, [adminUid]);

  const filteredProfiles = useMemo(() => {
    const search = userSearch.trim().toLowerCase();
    return profiles.filter((profile) => {
      const matchesSearch =
        !search ||
        [
          profile.schoolId,
          resolveProfileName(profile),
          profile.email,
          profile.role,
          profile.id,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search);
      const matchesRole =
        roleFilter === "all" ? true : profile.role === roleFilter;
      const matchesEmail =
        emailFilter === "all"
          ? true
          : emailFilter === "with_email"
            ? hasEmail(profile)
            : !hasEmail(profile);

      return matchesSearch && matchesRole && matchesEmail;
    });
  }, [profiles, userSearch, roleFilter, emailFilter]);

  const sortedProfiles = useMemo(() => {
    const next = [...filteredProfiles];
    next.sort((left, right) => {
      if (userSortMode === "school_id_asc") {
        return String(left.schoolId ?? "").localeCompare(
          String(right.schoolId ?? ""),
        );
      }
      if (userSortMode === "school_id_desc") {
        return String(right.schoolId ?? "").localeCompare(
          String(left.schoolId ?? ""),
        );
      }
      if (userSortMode === "name_asc") {
        return (
          compareResolvedNames(left, right) ||
          String(left.schoolId ?? "").localeCompare(String(right.schoolId ?? ""))
        );
      }
      if (userSortMode === "name_desc") {
        return (
          compareResolvedNames(right, left) ||
          String(left.schoolId ?? "").localeCompare(String(right.schoolId ?? ""))
        );
      }
      if (userSortMode === "role_asc") {
        return (
          roleRank(left.role) - roleRank(right.role) ||
          String(left.schoolId ?? "").localeCompare(String(right.schoolId ?? ""))
        );
      }
      if (userSortMode === "role_desc") {
        return (
          roleRank(right.role) - roleRank(left.role) ||
          String(left.schoolId ?? "").localeCompare(String(right.schoolId ?? ""))
        );
      }
      if (userSortMode === "newest") {
        return toMillis(right.createdAt) - toMillis(left.createdAt);
      }
      return toMillis(left.createdAt) - toMillis(right.createdAt);
    });
    return next;
  }, [filteredProfiles, userSortMode]);

  const roleCounts = useMemo(
    () =>
      profiles.reduce(
        (accumulator, profile) => {
          accumulator[profile.role] += 1;
          return accumulator;
        },
        { admin: 0, ec: 0, teacher: 0, student: 0 } as Record<Role, number>,
      ),
    [profiles],
  );

  const usersWithEmailCount = useMemo(
    () => profiles.filter((profile) => hasEmail(profile)).length,
    [profiles],
  );

  const usersWithoutEmailCount = profiles.length - usersWithEmailCount;
  const isStudentCreateRole = newRole === "student";
  const isTeacherCreateRole = newRole === "teacher";
  const isEcCreateRole = newRole === "ec";
  const createAccountHelperText = isStudentCreateRole
    ? "Student accounts need a name, course, and year level so roster, preregistration, and payment rules work correctly."
    : isTeacherCreateRole
      ? "Teacher accounts need a saved name so directory results and classroom-facing views stay easy to identify."
      : isEcCreateRole
        ? "EC Member accounts need a name, course, and year level so admin and operations views stay aligned."
        : "Required fields are marked automatically. Optional email helps users receive verification and recovery messages.";
  const recentActivityItems = useMemo(
    () =>
      logs.slice(0, 6).map((log) => ({
        id: log.id,
        title: formatLogAction(log.action),
        actor: log.actorSchoolId || log.actorUid || "System",
        target: log.targetSchoolId || log.targetUid || "No target",
        createdAtLabel: fmtTS(log.createdAt),
        color: logActionColor(log.action),
      })),
    [logs],
  );
  const usersInitialLoading = profilesLoading && profiles.length === 0;
  const hasActiveUserFilters =
    Boolean(userSearch.trim()) || roleFilter !== "all" || emailFilter !== "all";
  const canResetCreateForm =
    Boolean(newSchoolId.trim()) ||
    Boolean(newEcName.trim()) ||
    Boolean(newTeacherName.trim()) ||
    Boolean(newStudentName.trim()) ||
    Boolean(newCourse.trim()) ||
    Boolean(newYear.trim()) ||
    Boolean(newEmail.trim()) ||
    newRole !== "student";

  const resetCreateForm = () => {
    setNewSchoolId("");
    setNewEmail("");
    setNewEcName("");
    setNewTeacherName("");
    setNewStudentName("");
    setNewCourse("");
    setNewYear("");
    setNewRole("student");
  };

  const resetUserFilters = () => {
    setUserSearch("");
    setRoleFilter("all");
    setEmailFilter("all");
    setUserSortMode("school_id_asc");
  };

  const renderCourseField = (key: string, className?: string) => (
    <div key={key} className={className}>
      <Select
        label="Course"
        selectedKeys={newCourse ? [newCourse] : []}
        onSelectionChange={(keys) => {
          const selected = Array.from(keys as Set<React.Key>)[0];
          if (typeof selected === "string") setNewCourse(selected);
        }}
        placeholder="Select course"
        isRequired
      >
        {courseOptions.map((course) => (
          <SelectItem key={course}>{course}</SelectItem>
        ))}
      </Select>
    </div>
  );

  const renderYearField = (key: string, className?: string) => (
    <div key={key} className={className}>
      <Select
        label="Year Level"
        selectedKeys={newYear ? [newYear] : []}
        onSelectionChange={(keys) => {
          const selected = Array.from(keys as Set<React.Key>)[0];
          if (typeof selected === "string") setNewYear(selected);
        }}
        placeholder="Select year"
        isRequired
      >
        {yearOptions.map((year) => (
          <SelectItem key={year}>{year}</SelectItem>
        ))}
      </Select>
    </div>
  );

  const createAccountDetailFields = isStudentCreateRole
    ? [
        <div key="studentName">
          <Input
            label="Student Name"
            value={newStudentName}
            onValueChange={setNewStudentName}
            placeholder="e.g. Juan Dela Cruz"
            isRequired
          />
        </div>,
        renderCourseField("studentCourse"),
        renderYearField("studentYear"),
      ]
    : isTeacherCreateRole
      ? [
          <div key="teacherName" className={createAccountSingleFieldClassName}>
            <Input
              label="Teacher Name"
              value={newTeacherName}
              onValueChange={setNewTeacherName}
              placeholder="e.g. Juan Dela Cruz"
              isRequired
            />
          </div>,
        ]
      : isEcCreateRole
        ? [
            <div key="ecName">
              <Input
                label="EC Member Name"
                value={newEcName}
                onValueChange={setNewEcName}
                placeholder="e.g. Juan Dela Cruz"
                isRequired
              />
            </div>,
            renderCourseField("ecCourse"),
            renderYearField("ecYear"),
          ]
        : [];

  const attentionItems = useMemo(() => {
    const items: Array<{
      id: string;
      color: "warning" | "danger" | "primary";
      title: string;
      description: string;
      actionLabel: string;
      onPress: () => void;
    }> = [];

    if (!profilesLoading && usersWithoutEmailCount > 0) {
      items.push({
        id: "missing-email",
        color: "warning",
        title: "Accounts missing email",
        description: `${usersWithoutEmailCount} account(s) cannot receive email-based verification or recovery messages.`,
        actionLabel: "Review users",
        onPress: () => {
          setTab("users");
          setEmailFilter("without_email");
        },
      });
    }

    if (!logsLoading && logs.length === 0) {
      items.push({
        id: "no-logs",
        color: "danger",
        title: "Audit trail is empty",
        description:
          "No recent admin logs are available. Create or remove an account to verify logging is active.",
        actionLabel: "Open logs",
        onPress: () => setTab("logs"),
      });
    }

    if (!eventsLoading && events.length === 0) {
      items.push({
        id: "no-events",
        color: "warning",
        title: "Exports have no source events",
        description:
          "Attendance exports need event records before admins can generate CSV files.",
        actionLabel: "Open exports",
        onPress: () => setTab("exports"),
      });
    }

    if (!profilesLoading && profiles.length > 0 && roleCounts.admin <= 1) {
      items.push({
        id: "single-admin",
        color: "primary",
        title: "Single admin account",
        description:
          "Only one account currently has admin access. Review role coverage if operational redundancy is needed.",
        actionLabel: "View admins",
        onPress: () => {
          setTab("users");
          setRoleFilter("admin");
        },
      });
    }

    return items;
  }, [
    events.length,
    eventsLoading,
    logs.length,
    logsLoading,
    profiles.length,
    profilesLoading,
    roleCounts.admin,
    usersWithoutEmailCount,
  ]);

  const overviewStats = useMemo(
    () => [
      {
        id: "accounts",
        label: "Accounts",
        value: profiles.length,
        description: "Total registered CAMPUS accounts",
        tone: "text-[#7b0000]",
        icon: Users2,
        iconClassName: "bg-[#7b0000]/10 text-[#7b0000]",
      },
      {
        id: "logs",
        label: "Logs",
        value: logs.length,
        description: "Recent recorded admin actions",
        tone: "text-amber-700",
        icon: History,
        iconClassName: "bg-amber-100 text-amber-700",
      },
      {
        id: "events",
        label: "Events",
        value: events.length,
        description: "Event records available for export",
        tone: "text-blue-700",
        icon: CalendarDays,
        iconClassName: "bg-blue-100 text-blue-700",
      },
      {
        id: "admins",
        label: "Admins",
        value: roleCounts.admin,
        description: "Users with full administrative access",
        tone: "text-emerald-700",
        icon: ShieldAlert,
        iconClassName: "bg-emerald-100 text-emerald-700",
      },
    ],
    [events.length, logs.length, profiles.length, roleCounts.admin],
  );

  async function updateRole(profile: Profile, role: Role) {
    try {
      setSavingRoleUid(profile.id);
      await updateDoc(doc(db, "profiles", profile.id), { role });
      campusToast.success({
        title: "Role updated",
        description: `${profile.schoolId || profile.id} is now ${formatRole(role)}.`,
        dedupeKey: `admin:role-updated:${profile.id}:${role}`,
      });
    } catch {
      campusToast.error({
        title: "Role update failed",
        description: "Failed to update role.",
        dedupeKey: `admin:role-update-error:${profile.id}`,
      });
    } finally {
      setSavingRoleUid(null);
    }
  }

  async function createAccount() {
    const schoolId = newSchoolId.trim();
    const email = newEmail.trim();
    const ecName = newEcName.trim();
    const teacherName = newTeacherName.trim();
    const studentName = newStudentName.trim();
    const course = newCourse.trim();
    const year = newYear.trim();
    const isStudentRole = newRole === "student";
    const isTeacherRole = newRole === "teacher";
    const isEcRole = newRole === "ec";
    const requiresCourse = isStudentRole || isEcRole;
    const requiresYear = isStudentRole || isEcRole;
    const name = isStudentRole
      ? studentName
      : isTeacherRole
        ? teacherName
        : isEcRole
          ? ecName
          : "";

    if (!schoolId) {
      campusToast.warning({
        title: "Missing school ID",
        description: "School ID is required.",
        dedupeKey: "admin:create-account:missing-school-id",
      });
      return;
    }

    if (
      email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      campusToast.warning({
        title: "Invalid email",
        description: "Enter a valid email address or leave it blank.",
        dedupeKey: "admin:create-account:invalid-email",
      });
      return;
    }

    if (isEcRole && !ecName) {
      campusToast.warning({
        title: "Missing EC Member name",
        description: "EC Member name is required for EC Member accounts.",
        dedupeKey: "admin:create-account:missing-ec-name",
      });
      return;
    }

    if (isTeacherRole && !teacherName) {
      campusToast.warning({
        title: "Missing teacher name",
        description: "Teacher name is required for teacher accounts.",
        dedupeKey: "admin:create-account:missing-teacher-name",
      });
      return;
    }

    if (isStudentRole && !studentName) {
      campusToast.warning({
        title: "Missing student name",
        description: "Student name is required for student accounts.",
        dedupeKey: "admin:create-account:missing-student-name",
      });
      return;
    }

    if (requiresCourse && !course) {
      campusToast.warning({
        title: "Missing course",
        description: `${formatRole(newRole)} accounts require a course selection.`,
        dedupeKey: `admin:create-account:missing-course:${newRole}`,
      });
      return;
    }

    if (requiresYear && !year) {
      campusToast.warning({
        title: "Missing year level",
        description: `${formatRole(newRole)} accounts require a year level.`,
        dedupeKey: `admin:create-account:missing-year:${newRole}`,
      });
      return;
    }

    setCreating(true);
    try {
      const fn = httpsCallable<
        {
          schoolId: string;
          role: Role;
          email: string | null;
          name?: string | null;
          teacherName?: string | null;
          studentName?: string | null;
          course?: string | null;
          year?: string | null;
        },
        { uid?: string }
      >(functions, "adminCreateUser");
      const result = await fn({
        schoolId,
        role: newRole,
        email: email || null,
        name: name || null,
        teacherName: isTeacherRole ? teacherName : null,
        studentName: isStudentRole ? studentName : null,
        course: requiresCourse ? course : null,
        year: requiresYear ? year : null,
      });
      campusToast.success({
        title: "Account created",
        description: `UID: ${result?.data?.uid ?? "-"}`,
        dedupeKey: `admin:create-account:${result?.data?.uid ?? schoolId}`,
      });
      resetCreateForm();
      setTab("users");
    } catch (error: unknown) {
      campusToast.error({
        title: "Create account failed",
        description: toErrorMessage(error, "Failed to create account."),
        dedupeKey: "admin:create-account:error",
      });
    } finally {
      setCreating(false);
    }
  }

  async function removeAccount(uid: string) {
    setDeletingUid(uid);
    try {
      await httpsCallable<{ uid: string }, unknown>(
        functions,
        "adminDeleteUser",
      )({ uid });
      campusToast.success({
        title: "Account removed",
        description: `${uid} was removed successfully.`,
        dedupeKey: `admin:remove-account:${uid}`,
      });
    } catch (error: unknown) {
      campusToast.error({
        title: "Remove account failed",
        description: toErrorMessage(error, "Failed to remove account."),
        dedupeKey: `admin:remove-account:error:${uid}`,
      });
    } finally {
      setDeletingUid(null);
    }
  }

  function requestRoleChange(profile: Profile, nextRole: Role) {
    if (nextRole === profile.role) return;

    const isSensitiveChange =
      nextRole === "admin" || profile.role === "admin" || profile.id === adminUid;

    if (isSensitiveChange) {
      setPendingRoleChange({ profile, nextRole });
      return;
    }

    void updateRole(profile, nextRole);
  }

  async function confirmRoleChange() {
    if (!pendingRoleChange) return;
    const change = pendingRoleChange;
    await updateRole(change.profile, change.nextRole);
    setPendingRoleChange(null);
  }

  function requestRemoveAccount(profile: Profile) {
    if (profile.id === adminUid) {
      campusToast.warning({
        title: "Account protected",
        description: "You cannot remove your own admin account.",
        dedupeKey: "admin:remove-account:self-blocked",
      });
      return;
    }
    setPendingDeleteProfile(profile);
  }

  async function confirmRemoveAccount() {
    if (!pendingDeleteProfile) return;
    const target = pendingDeleteProfile;
    await removeAccount(target.id);
    setPendingDeleteProfile(null);
  }

  const roleChangeModalCopy = useMemo(() => {
    if (!pendingRoleChange) return null;

    const { profile, nextRole } = pendingRoleChange;
    const profileLabel = profile.schoolId || profile.id;
    const isSelfChange = profile.id === adminUid;

    if (isSelfChange) {
      return {
        title: "Confirm your access change",
        description: `You are about to change your own role to ${formatRole(nextRole)}. This can change what you can access after the next auth refresh.`,
        confirmLabel: "Change my role",
      };
    }

    if (nextRole === "admin") {
      return {
        title: "Grant admin access?",
        description: `${profileLabel} will receive full administrative control over CAMPUS, including user management, logs, and exports.`,
        confirmLabel: "Grant admin access",
      };
    }

    return {
      title: "Confirm admin role change",
      description: `${profileLabel} currently has admin access. Changing this role will reduce their permissions.`,
      confirmLabel: "Apply role change",
    };
  }, [adminUid, pendingRoleChange]);

  const quickActions = [
    {
      id: "users",
      title: "Open users",
      description:
        "Create accounts, assign roles, and review protected access changes.",
      helper: `${profiles.length} total accounts`,
      icon: Users2,
      onPress: () => setTab("users"),
    },
    {
      id: "logs",
      title: "View logs",
      description:
        "Inspect the latest admin activity trail and confirm sensitive actions were recorded.",
      helper: `${logs.length} recent records`,
      icon: History,
      onPress: () => setTab("logs"),
    },
    {
      id: "exports",
      title: "Export data",
      description:
        "Generate attendance CSV files from current event registration and attendance data.",
      helper: `${events.length} events ready`,
      icon: Download,
      onPress: () => setTab("exports"),
    },
  ];

  const openRoleView = (role: Role) => {
    setRoleFilter(role);
    setEmailFilter("all");
    setUserSearch("");
    setUserSortMode("school_id_asc");
    setTab("users");
  };

  async function exportAttendance() {
    if (!eventId) {
      campusToast.warning({
        title: "Select an event",
        description: "Choose an event before generating an export.",
        dedupeKey: "admin:export:no-event",
      });
      return;
    }

    const eventToExport = events.find((event) => event.id === eventId) ?? null;
    if (!eventToExport) {
      campusToast.warning({
        title: "Event unavailable",
        description: "The selected event could not be found.",
        dedupeKey: `admin:export:event-missing:${eventId}`,
      });
      return;
    }

    setExporting(true);
    setLastExport((previous) => {
      if (previous?.downloadUrl) {
        URL.revokeObjectURL(previous.downloadUrl);
      }
      return null;
    });
    try {
      const [attendanceSnap, registrationsSnap] = await Promise.all([
        getDocs(collection(db, "events", eventId, "attendance")),
        getDocs(collection(db, "events", eventId, "registrations")),
      ]);

      const rowsByUid = new Map<
        string,
        {
          schoolId: string;
          studentName: string;
          course: string;
          year: string;
          attendanceStatus: string;
          attendanceTimeIn: string;
          attendanceTimeOut: string;
        }
      >();

      registrationsSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as {
          uid?: string;
          schoolId?: string;
          studentName?: string;
          course?: string;
          year?: string;
        };
        const uid = String(data.uid ?? docSnap.id);
        if (!uid) return;

        rowsByUid.set(uid, {
          schoolId: String(data.schoolId ?? ""),
          studentName: String(data.studentName ?? ""),
          course: String(data.course ?? ""),
          year: String(data.year ?? ""),
          attendanceStatus: "Registered",
          attendanceTimeIn: "-",
          attendanceTimeOut: "-",
        });
      });

      attendanceSnap.docs.forEach((docSnap) => {
        const data = docSnap.data() as {
          uid?: string;
          studentUid?: string;
          schoolId?: string;
          studentName?: string;
          name?: string;
          course?: string;
          yearLevel?: string;
          year?: string;
          status?: string;
          attendanceStatus?: string;
          present?: boolean;
          timeIn?: unknown;
          timeInIso?: string;
          timeOut?: unknown;
          timeOutIso?: string;
          timestamp?: unknown;
          createdAt?: unknown;
          updatedAt?: unknown;
        };

        const uid = String(data.uid ?? data.studentUid ?? docSnap.id);
        if (!uid) return;

        const existing = rowsByUid.get(uid);
        const fallbackStatus =
          typeof data.present === "boolean"
            ? data.present
              ? "Present"
              : "Absent"
            : "";
        const timeInRaw =
          data.timeInIso ??
          data.timeIn ??
          data.timestamp ??
          data.updatedAt ??
          data.createdAt;
        const timeOutRaw = data.timeOutIso ?? data.timeOut;
        const timeInValue = fmtTS(timeInRaw);
        const timeOutValue = fmtTS(timeOutRaw);
        const derivedStatus =
          timeInValue !== "-" && timeOutValue !== "-"
            ? "Present"
            : timeInValue !== "-"
              ? "Timed In"
              : "";
        const status =
          String(data.attendanceStatus ?? data.status ?? fallbackStatus ?? "")
            .trim() ||
          derivedStatus ||
          existing?.attendanceStatus ||
          "Recorded";

        rowsByUid.set(uid, {
          schoolId: String(data.schoolId ?? existing?.schoolId ?? ""),
          studentName: String(
            data.studentName ?? data.name ?? existing?.studentName ?? "",
          ),
          course: String(data.course ?? existing?.course ?? ""),
          year: String(data.yearLevel ?? data.year ?? existing?.year ?? ""),
          attendanceStatus: status,
          attendanceTimeIn:
            timeInValue !== "-" ? timeInValue : existing?.attendanceTimeIn ?? "-",
          attendanceTimeOut:
            timeOutValue !== "-"
              ? timeOutValue
              : existing?.attendanceTimeOut ?? "-",
        });
      });

      const rows = Array.from(rowsByUid.values()).sort((left, right) => {
        const byName = left.studentName.localeCompare(right.studentName);
        if (byName !== 0) return byName;
        return left.schoolId.localeCompare(right.schoolId);
      });

      if (rows.length === 0) {
        campusToast.warning({
          title: "Nothing to export",
          description:
            "No registration or attendance records were found for this event.",
          dedupeKey: `admin:export:no-records:${eventId}`,
        });
        return;
      }

      const csvLines = [
        `Event Title,${csvCell(eventToExport.title || eventToExport.id)}`,
        `Date,${csvCell(eventToExport.date || "-")}`,
        `Scheduled Time Start,${csvCell(eventToExport.scheduledTime || eventToExport.timeStart || "-")}`,
        `Scheduled Time End,${csvCell(eventToExport.timeEnd || "-")}`,
        `Location,${csvCell(eventToExport.location || "-")}`,
        `Generated At,${csvCell(new Date().toLocaleString())}`,
        "",
        "School ID,Student Name,Course,Year,Attendance Status,Attendance Time In,Attendance Time Out",
        ...rows.map((row) =>
          [
            csvCell(row.schoolId),
            csvCell(row.studentName),
            csvCell(row.course),
            csvCell(row.year),
            csvCell(row.attendanceStatus),
            csvCell(row.attendanceTimeIn),
            csvCell(row.attendanceTimeOut),
          ].join(","),
        ),
      ];

      const blob = new Blob([csvLines.join("\n")], {
        type: "text/csv;charset=utf-8;",
      });
      const downloadUrl = URL.createObjectURL(blob);
      const slug = (eventToExport.title || eventToExport.id)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      const fileName = `${slug || eventToExport.id}-attendance.csv`;

      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      setLastExport({
        eventId,
        eventTitle: eventToExport.title || eventToExport.id,
        rowCount: rows.length,
        fileName,
        downloadUrl,
      });
      campusToast.success({
        title: "Export ready",
        description: `Attendance CSV for "${eventToExport.title || eventToExport.id}" was downloaded.`,
        dedupeKey: `admin:export-ready:${eventId}`,
      });
    } catch (error: unknown) {
      campusToast.error({
        title: "Export failed",
        description: toErrorMessage(error, "Failed to export attendance."),
        dedupeKey: `admin:export-error:${eventId}`,
      });
    } finally {
      setExporting(false);
    }
  }

  if (checking) {
    return (
      <CampusLayoutLoadingState
        title="Loading admin portal"
        description="Verifying access and preparing live dashboard data."
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f2f2f2] p-3 sm:p-6 lg:p-10">
      <div className="mx-auto max-w-7xl space-y-5">
        <Card
          shadow="sm"
          className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#991515] to-[#ef6b4a] text-white"
        >
          <CardBody className="flex flex-col gap-4 p-4 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
                  Admin Dashboard
                </p>
                <h1 className="text-2xl font-black sm:text-3xl">
                  Campus Management Control Center
                </h1>
                <p className="max-w-2xl text-sm text-white/80">
                  Supervise users, logs, and attendance exports from one
                  mobile-friendly control room.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Chip variant="flat" className="bg-white/15 text-white">
                  {profiles.length} accounts
                </Chip>
                <Chip variant="flat" className="bg-white/15 text-white">
                  {logs.length} logs
                </Chip>
                <Chip variant="flat" className="bg-white/15 text-white">
                  {events.length} events
                </Chip>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="flat"
                className="bg-white/15 font-semibold text-white data-[hover=true]:bg-white/25"
                onPress={() => setTab("users")}
                startContent={<Users2 size={16} />}
              >
                Manage users
              </Button>
              <LogoutButton className="bg-white text-[#7b0000] data-[hover=true]:bg-white/90" />
            </div>
          </CardBody>
        </Card>

        <Tabs
          selectedKey={tab}
          onSelectionChange={(key) => setTab(String(key) as AdminTab)}
          fullWidth
          classNames={{
            tabList:
              "grid w-full grid-cols-2 gap-1 rounded-2xl bg-white p-1 shadow-sm sm:grid-cols-4",
            cursor: "bg-[#7b0000] shadow-sm",
            tab: "h-12 rounded-xl data-[hover-unselected=true]:bg-[#f9ece8]",
            tabContent:
              "flex items-center gap-2 text-sm font-semibold text-campus-text-secondary group-data-[selected=true]:text-white",
            panel: "pt-5",
          }}
        >
          <Tab
            key="overview"
            title={
              <>
                <LayoutDashboard size={16} />
                <span>Overview</span>
              </>
            }
          >
            {profilesLoading || logsLoading || eventsLoading ? (
              <AdminOverviewSkeleton />
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {overviewStats.map((item) => {
                    const Icon = item.icon;
                    return (
                      <Card
                        key={item.id}
                        shadow="sm"
                        className="border border-white/70 bg-white/90"
                      >
                        <CardBody className="space-y-4 p-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="space-y-1">
                              <p className="text-sm font-semibold text-campus-text-primary">
                                {item.label}
                              </p>
                              <p className="text-xs text-campus-text-secondary">
                                {item.description}
                              </p>
                            </div>
                            <div
                              className={`flex h-11 w-11 items-center justify-center rounded-2xl ${item.iconClassName}`}
                            >
                              <Icon size={18} />
                            </div>
                          </div>
                          <div className="flex items-end justify-between gap-3">
                            <h2 className={`text-3xl font-black ${item.tone}`}>
                              {item.value}
                            </h2>
                            <Chip variant="flat" className="font-medium">
                              Live
                            </Chip>
                          </div>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>

                <Card shadow="sm" className="border border-white/70 bg-white/95">
                  <CardHeader className="px-5 pt-5">
                    <div className="space-y-1">
                      <h2 className="text-xl font-bold text-gray-900">
                        Quick actions
                      </h2>
                      <p className="text-sm text-gray-600">
                        Start with the operational tasks admins reach for most
                        often.
                      </p>
                    </div>
                  </CardHeader>
                  <CardBody className="grid gap-4 p-5 pt-3 md:grid-cols-3">
                    {quickActions.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Card
                          key={item.id}
                          shadow="none"
                          className="border border-[#efe7e4] bg-[#fcfbfa]"
                        >
                          <CardBody className="space-y-4 p-5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#7b0000]/10 text-[#7b0000]">
                                <Icon size={20} />
                              </div>
                              <Chip variant="flat" className="font-medium">
                                {item.helper}
                              </Chip>
                            </div>
                            <div className="space-y-2">
                              <h3 className="text-lg font-semibold text-campus-text-primary">
                                {item.title}
                              </h3>
                              <p className="text-sm text-campus-text-secondary">
                                {item.description}
                              </p>
                            </div>
                            <Button
                              className="w-full bg-[#7b0000] font-semibold text-white sm:w-auto"
                              onPress={item.onPress}
                              endContent={<ArrowRight size={16} />}
                            >
                              {item.title}
                            </Button>
                          </CardBody>
                        </Card>
                      );
                    })}
                  </CardBody>
                </Card>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
                  <Card
                    shadow="sm"
                    className="border border-white/70 bg-white/95"
                  >
                    <CardHeader className="flex items-center justify-between gap-4 px-5 pt-5">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Activity size={18} className="text-[#7b0000]" />
                          <h2 className="text-xl font-bold text-gray-900">
                            Recent activity
                          </h2>
                        </div>
                        <p className="text-sm text-gray-600">
                          Live admin-facing events from the current CAMPUS log
                          stream.
                        </p>
                      </div>
                      <Button
                        variant="light"
                        className="px-0 font-semibold text-[#7b0000] data-[hover=true]:bg-transparent"
                        onPress={() => setTab("logs")}
                      >
                        Open logs
                      </Button>
                    </CardHeader>
                    <CardBody className="p-5 pt-3">
                      {recentActivityItems.length ? (
                        <ScrollShadow className="max-h-[340px] space-y-3 pr-2">
                          {recentActivityItems.map((item) => (
                            <div
                              key={item.id}
                              className="rounded-2xl border border-[#efe7e4] bg-[#fcfbfa] p-4"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div className="space-y-1">
                                  <p className="font-semibold text-campus-text-primary">
                                    {item.title}
                                  </p>
                                  <p className="text-sm text-campus-text-secondary">
                                    {item.actor} {"->"} {item.target}
                                  </p>
                                </div>
                                <Chip color={item.color} variant="flat">
                                  {item.createdAtLabel}
                                </Chip>
                              </div>
                            </div>
                          ))}
                        </ScrollShadow>
                      ) : (
                        <CampusEmptyState
                          title="No recent activity yet"
                          description="Admin log entries will appear here once create, delete, or other audited actions are recorded."
                          compact
                          className="border-none bg-transparent px-0 py-6"
                        />
                      )}
                    </CardBody>
                  </Card>

                  <Card
                    shadow="sm"
                    className="border border-white/70 bg-white/95"
                  >
                    <CardHeader className="px-5 pt-5">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <TriangleAlert size={18} className="text-amber-600" />
                          <h2 className="text-xl font-bold text-gray-900">
                            Attention needed
                          </h2>
                        </div>
                        <p className="text-sm text-gray-600">
                          Signals pulled from current dashboard data to help
                          admins spot follow-up items quickly.
                        </p>
                      </div>
                    </CardHeader>
                    <CardBody className="space-y-3 p-5 pt-3">
                      {attentionItems.length ? (
                        attentionItems.map((item) => (
                          <div
                            key={item.id}
                            className="rounded-2xl border border-[#efe7e4] bg-[#fcfbfa] p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="space-y-2">
                                <Chip color={item.color} variant="flat">
                                  {item.title}
                                </Chip>
                                <p className="text-sm text-campus-text-secondary">
                                  {item.description}
                                </p>
                              </div>
                              <Button
                                size="sm"
                                variant="flat"
                                color={
                                  item.color === "danger"
                                    ? "danger"
                                    : item.color === "warning"
                                      ? "warning"
                                      : "primary"
                                }
                                onPress={item.onPress}
                              >
                                {item.actionLabel}
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <CampusEmptyState
                          title="No immediate alerts"
                          description="The current overview data does not show any missing-email, empty-log, or export-readiness issues."
                          compact
                          className="border-none bg-transparent px-0 py-6"
                        />
                      )}
                    </CardBody>
                  </Card>
                </div>

                <Card shadow="sm" className="border border-white/70 bg-white/95">
                  <CardHeader className="px-5 pt-5">
                    <div className="space-y-1">
                      <h2 className="text-xl font-bold text-gray-900">
                        Role overview
                      </h2>
                      <p className="text-sm text-gray-600">
                        Review how access is distributed, then jump directly
                        into the filtered Users & Roles workspace.
                      </p>
                    </div>
                  </CardHeader>
                  <CardBody className="grid gap-4 p-5 pt-3 md:grid-cols-2 xl:grid-cols-4">
                    {roleCards.map((item) => (
                      <Card
                        key={item.role}
                        shadow="none"
                        className="border border-[#efe7e4] bg-[#fcfbfa]"
                      >
                        <CardBody className="space-y-4 p-5">
                          <div className="flex items-center justify-between gap-3">
                            <UserRoleChip role={item.key} />
                            <Chip variant="flat" className="font-semibold">
                              {roleCounts[item.key]}
                            </Chip>
                          </div>
                          <div className="space-y-2">
                            <h3 className="text-lg font-semibold text-campus-text-primary">
                              {item.role}
                            </h3>
                            <p className="min-h-16 text-sm text-campus-text-secondary">
                              {item.summary}
                            </p>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <Tooltip content={`Primary route: ${item.route}`} delay={300}>
                              <Chip variant="bordered" className="w-fit text-xs text-gray-700">
                                {item.route}
                              </Chip>
                            </Tooltip>
                            <Button
                              size="sm"
                              variant="light"
                              className="px-0 font-semibold text-[#7b0000] data-[hover=true]:bg-transparent"
                              onPress={() => openRoleView(item.key)}
                              endContent={<ArrowRight size={14} />}
                            >
                              View users
                            </Button>
                          </div>
                        </CardBody>
                      </Card>
                    ))}
                  </CardBody>
                </Card>
              </div>
            )}
          </Tab>
          <Tab
            key="users"
            title={
              <>
                <Users2 size={16} />
                <span>Users & Roles</span>
              </>
            }
          >
            {usersInitialLoading ? (
              <UsersRolesSkeleton />
            ) : (
              <div className="space-y-5">
                <Card shadow="sm" className="border">
                  <CardBody className="space-y-4 p-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-1">
                        <h2 className="text-xl font-bold text-gray-900">
                          Users and roles
                        </h2>
                        <p className="text-sm text-gray-600">
                          Search profiles, filter access levels, and manage
                          sensitive role assignments from one admin workspace.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Chip color="primary" variant="flat" className="font-semibold">
                          {sortedProfiles.length} of {profiles.length} users
                        </Chip>
                        <Chip variant="flat">
                          {usersWithEmailCount} with email
                        </Chip>
                        <Chip variant="flat">
                          {usersWithoutEmailCount} without email
                        </Chip>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_220px_220px_220px]">
                      <Input
                        label="Search profiles"
                        value={userSearch}
                        onValueChange={setUserSearch}
                        placeholder="School ID, name, email, role, or UID"
                        startContent={
                          <Search size={16} className="text-campus-text-secondary" />
                        }
                      />
                      <Select
                        label="Role filter"
                        selectedKeys={[roleFilter]}
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys as Set<React.Key>)[0];
                          if (typeof selected === "string") {
                            setRoleFilter(selected as "all" | Role);
                          }
                        }}
                        disallowEmptySelection
                      >
                        {(["all", ...roleOptions] as const).map((role) => (
                          <SelectItem key={role}>
                            {role === "all" ? "All roles" : formatRole(role)}
                          </SelectItem>
                        ))}
                      </Select>
                      <Select
                        label="Email status"
                        selectedKeys={[emailFilter]}
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys as Set<React.Key>)[0];
                          if (typeof selected === "string") {
                            setEmailFilter(selected as EmailFilter);
                          }
                        }}
                        disallowEmptySelection
                      >
                        <SelectItem key="all">All accounts</SelectItem>
                        <SelectItem key="with_email">Has email</SelectItem>
                        <SelectItem key="without_email">No email</SelectItem>
                      </Select>
                      <Select
                        label="Sort by"
                        selectedKeys={[userSortMode]}
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys as Set<React.Key>)[0];
                          if (typeof selected === "string") {
                            setUserSortMode(selected as UserSortMode);
                          }
                        }}
                        disallowEmptySelection
                      >
                        <SelectItem key="school_id_asc">School ID, A-Z</SelectItem>
                        <SelectItem key="school_id_desc">School ID, Z-A</SelectItem>
                        <SelectItem key="name_asc">Name, A-Z</SelectItem>
                        <SelectItem key="name_desc">Name, Z-A</SelectItem>
                        <SelectItem key="role_asc">Role priority</SelectItem>
                        <SelectItem key="role_desc">Role reverse</SelectItem>
                        <SelectItem key="newest">Newest created</SelectItem>
                        <SelectItem key="oldest">Oldest created</SelectItem>
                      </Select>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                        Filters and sorting help admins review high-risk access changes quickly.
                      </p>
                      <Button
                        variant="bordered"
                        onPress={resetUserFilters}
                        isDisabled={!hasActiveUserFilters && userSortMode === "school_id_asc"}
                        startContent={<RefreshCcw size={16} />}
                      >
                        Reset filters
                      </Button>
                    </div>
                  </CardBody>
                </Card>

                <Card shadow="sm" className="border">
                  <CardHeader className="px-5 pt-5">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-bold text-gray-900">
                          Create account
                        </h3>
                        <Chip color="warning" variant="flat">
                          Server-secured
                        </Chip>
                      </div>
                      <p className="text-sm text-gray-600">
                        New accounts are created through Cloud Functions. The
                        default password remains the school ID and the user
                        will be prompted to change it on first sign in.
                      </p>
                    </div>
                  </CardHeader>
                  <CardBody className="space-y-4 p-5 pt-3">
                    <div className={createAccountFormGridClassName}>
                      <Input
                        label="School ID"
                        value={newSchoolId}
                        onValueChange={setNewSchoolId}
                        placeholder="e.g. 23209455"
                        isRequired
                        startContent={
                          <IdCard size={16} className="text-campus-text-secondary" />
                        }
                      />
                      <Select
                        label="Role"
                        selectedKeys={[newRole]}
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys as Set<React.Key>)[0];
                          if (typeof selected === "string")
                            setNewRole(selected as Role);
                        }}
                        disallowEmptySelection
                        startContent={
                          <ShieldAlert size={16} className="text-campus-text-secondary" />
                        }
                      >
                        {roleOptions.map((role) => (
                          <SelectItem key={role}>{formatRole(role)}</SelectItem>
                        ))}
                      </Select>
                      <Input
                        label="Email"
                        type="email"
                        value={newEmail}
                        onValueChange={setNewEmail}
                        placeholder="optional@email.com"
                        description="Optional. Leave blank to use the generated CAMPUS login address."
                        startContent={
                          <Mail size={16} className="text-campus-text-secondary" />
                        }
                      />
                    </div>
                    {createAccountDetailFields.length > 0 ? (
                      <div className={createAccountFormGridClassName}>
                        {createAccountDetailFields}
                      </div>
                    ) : null}
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-campus-text-secondary">
                        {createAccountHelperText}
                      </p>
                      <div className="flex flex-col gap-3 sm:flex-row">
                        <Button
                          variant="bordered"
                          onPress={resetCreateForm}
                          isDisabled={!canResetCreateForm || creating}
                        >
                          Clear
                        </Button>
                        <Button
                          className="bg-[#7b0000] font-semibold text-white"
                          onPress={createAccount}
                          isLoading={creating}
                          startContent={!creating ? <UserPlus size={16} /> : undefined}
                        >
                          Create account
                        </Button>
                      </div>
                    </div>
                  </CardBody>
                </Card>

                <CampusDataTable
                  ariaLabel="Admin user accounts"
                  columns={userColumns}
                  items={sortedProfiles}
                  isLoading={profilesLoading}
                  loadingContent={<CampusTableBodySkeleton rows={6} columns={6} />}
                  emptyContent={
                    <CampusEmptyState
                      title="No users match the current filters"
                      description="Try another search term, adjust the role or email filters, or clear the filters to see the full CAMPUS directory."
                      compact
                      action={
                        <Button
                          variant="bordered"
                          onPress={resetUserFilters}
                          isDisabled={!hasActiveUserFilters && userSortMode === "school_id_asc"}
                          startContent={<RefreshCcw size={16} />}
                        >
                          Clear filters
                        </Button>
                      }
                      className="mx-auto my-8 max-w-lg border-none bg-transparent"
                    />
                  }
                  wrapperClassName="border-[#e5e7eb]"
                  renderCell={(profile, columnKey) => {
                    const isSelf = profile.id === adminUid;

                    if (columnKey === "schoolId")
                      return (
                        <div className="space-y-1">
                          <p className="font-semibold text-campus-text-primary">
                            {profile.schoolId || "No school ID"}
                          </p>
                          <p className="text-xs text-campus-text-secondary">
                            UID: {profile.id}
                          </p>
                        </div>
                      );

                    if (columnKey === "name") {
                      const profileName = resolveProfileName(profile);

                      return profileName ? (
                        <p className="text-sm font-medium text-campus-text-primary">
                          {profileName}
                        </p>
                      ) : (
                        <p className="text-sm text-campus-text-secondary">
                          No name on file
                        </p>
                      );
                    }

                    if (columnKey === "email")
                      return hasEmail(profile) ? (
                        <div className="space-y-1">
                          <p className="break-all text-sm text-campus-text-primary">
                            {profile.email}
                          </p>
                          <p className="text-xs text-campus-text-secondary">
                            Contact-ready account
                          </p>
                        </div>
                      ) : (
                        <Chip variant="flat" color="warning" className="font-medium">
                          No email on file
                        </Chip>
                      );

                    if (columnKey === "role") return <UserRoleChip role={profile.role} />;

                    if (columnKey === "roleAssignment") {
                      const roleSelect = (
                        <Select
                          aria-label={`Assign role for ${profile.schoolId || profile.id}`}
                          selectedKeys={[profile.role]}
                          onSelectionChange={(keys) => {
                            const selected = Array.from(keys as Set<React.Key>)[0];
                            if (typeof selected === "string") {
                              requestRoleChange(profile, selected as Role);
                            }
                          }}
                          disallowEmptySelection
                          isDisabled={savingRoleUid === profile.id}
                          size="sm"
                        >
                          {roleOptions.map((role) => (
                            <SelectItem key={role}>{formatRole(role)}</SelectItem>
                          ))}
                        </Select>
                      );

                      if (isSelf) {
                        return (
                          <Tooltip
                            content="Changing your own role can affect your admin access after refresh."
                            delay={300}
                          >
                            <div>{roleSelect}</div>
                          </Tooltip>
                        );
                      }

                      return roleSelect;
                    }

                    if (columnKey === "actions")
                      return (
                        <div className="flex justify-end">
                          {isSelf ? (
                            <Tooltip
                              content="Your own admin account cannot be removed from this screen."
                              delay={300}
                            >
                              <div>
                                <Chip color="warning" variant="flat">
                                  Protected
                                </Chip>
                              </div>
                            </Tooltip>
                          ) : (
                            <Dropdown placement="bottom-end">
                              <DropdownTrigger>
                                <Button
                                  isIconOnly
                                  size="sm"
                                  variant="light"
                                  aria-label={`Actions for ${profile.schoolId || profile.id}`}
                                >
                                  <MoreHorizontal size={16} />
                                </Button>
                              </DropdownTrigger>
                              <DropdownMenu aria-label="User actions">
                                <DropdownItem
                                  key="remove"
                                  color="danger"
                                  className="text-danger"
                                  onPress={() => requestRemoveAccount(profile)}
                                >
                                  Remove account
                                </DropdownItem>
                              </DropdownMenu>
                            </Dropdown>
                          )}
                        </div>
                      );
                    return null;
                  }}
                />
              </div>
            )}
          </Tab>
          <Tab
            key="logs"
            title={
              <>
                <History size={16} />
                <span>Logs</span>
              </>
            }
          >
            <div className="space-y-4">
              <Card shadow="sm" className="border">
                <CardBody className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">
                      System logs
                    </h2>
                    <p className="text-sm text-gray-600">
                      Recent activity entries written for audit and support.
                    </p>
                  </div>
                  <Chip
                    color="primary"
                    variant="flat"
                    className="w-fit font-semibold"
                  >
                    {logs.length} entries
                  </Chip>
                </CardBody>
              </Card>
              <CampusDataTable
                ariaLabel="System logs"
                columns={logColumns}
                items={logs}
                isLoading={logsLoading}
                emptyTitle="No logs yet"
                emptyDescription="Activity logs will appear here as admin actions are recorded."
                renderCell={(log, columnKey) => {
                  if (columnKey === "action")
                    return (
                      <div className="space-y-1">
                        <p className="font-semibold text-campus-text-primary">
                          {log.action || "-"}
                        </p>
                        <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
                          Activity record
                        </p>
                      </div>
                    );
                  if (columnKey === "actor")
                    return (
                      <div className="space-y-1">
                        <p className="font-medium text-campus-text-primary">
                          {log.actorSchoolId || "-"}
                        </p>
                        <p className="break-all text-xs text-campus-text-secondary">
                          {log.actorUid || "-"}
                        </p>
                      </div>
                    );
                  if (columnKey === "target")
                    return (
                      <div className="space-y-1">
                        <p className="font-medium text-campus-text-primary">
                          {log.targetSchoolId || "-"}
                        </p>
                        <p className="break-all text-xs text-campus-text-secondary">
                          {log.targetUid || "-"}
                        </p>
                      </div>
                    );
                  if (columnKey === "createdAt")
                    return (
                      <Chip
                        variant="bordered"
                        className="w-fit text-xs text-gray-600"
                      >
                        {fmtTS(log.createdAt)}
                      </Chip>
                    );
                  return null;
                }}
              />
            </div>
          </Tab>
          <Tab
            key="exports"
            title={
              <>
                <Download size={16} />
                <span>Exports</span>
              </>
            }
          >
            <div className="space-y-5">
              <Card shadow="sm" className="border">
                <CardHeader className="px-5 pt-5">
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">
                      Attendance exports
                    </h2>
                    <p className="text-sm text-gray-600">
                      Generate CSV files from the attendance and registration
                      records already stored for each event.
                    </p>
                  </div>
                </CardHeader>
                <CardBody className="space-y-4 p-5">
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
                    <Select
                      label="Event"
                      selectedKeys={eventId ? [eventId] : []}
                      onSelectionChange={(keys) => {
                        const selected = Array.from(keys as Set<React.Key>)[0];
                        if (typeof selected === "string") setEventId(selected);
                      }}
                      disallowEmptySelection={events.length > 0}
                      isDisabled={!events.length || eventsLoading}
                    >
                      {events.map((event) => (
                        <SelectItem key={event.id}>
                          {event.title || event.id}
                        </SelectItem>
                      ))}
                    </Select>
                    <Button
                      className="bg-[#7b0000] font-semibold text-white"
                      onPress={exportAttendance}
                      isLoading={exporting}
                      isDisabled={!eventId || eventsLoading}
                    >
                      Generate export
                    </Button>
                  </div>
                  {eventsLoading ? (
                    <CampusDetailSkeleton rows={3} />
                  ) : (
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <Card shadow="none" className="border bg-gray-50">
                        <CardBody className="p-4">
                          <p className="text-sm text-gray-500">
                            Selected Event
                          </p>
                          <p className="mt-2 font-semibold text-gray-900">
                            {events.find((event) => event.id === eventId)
                              ?.title ||
                              eventId ||
                              "None selected"}
                          </p>
                        </CardBody>
                      </Card>
                      <Card shadow="none" className="border bg-gray-50">
                        <CardBody className="p-4">
                          <p className="text-sm text-gray-500">
                            Exportable Events
                          </p>
                          <p className="mt-2 text-2xl font-black text-blue-700">
                            {events.length}
                          </p>
                        </CardBody>
                      </Card>
                      <Card shadow="none" className="border bg-gray-50">
                        <CardBody className="p-4">
                          <p className="text-sm text-gray-500">Delivery</p>
                          <p className="mt-2 text-sm font-medium text-gray-900">
                            Direct browser download
                          </p>
                        </CardBody>
                      </Card>
                    </div>
                  )}
                </CardBody>
              </Card>
              {lastExport ? (
                <Card
                  shadow="sm"
                  className="border border-emerald-200 bg-emerald-50"
                >
                  <CardBody className="space-y-4 p-5">
                    <div>
                      <p className="text-sm font-semibold text-emerald-900">
                        Latest export completed
                      </p>
                      <p className="mt-1 text-sm text-emerald-900">
                        {lastExport.eventTitle} produced {lastExport.rowCount}{" "}
                        row{lastExport.rowCount === 1 ? "" : "s"}.
                      </p>
                      <p className="mt-1 break-all text-sm text-emerald-900">
                        {lastExport.fileName}
                      </p>
                    </div>
                    <div className="flex flex-col gap-3 sm:flex-row">
                      <Button
                        className="bg-white font-semibold text-emerald-900"
                        onPress={() =>
                          window.open(
                            lastExport.downloadUrl,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        Download Again
                      </Button>
                      <Button
                        variant="flat"
                        className="font-semibold text-emerald-900"
                        onPress={async () => {
                          await navigator.clipboard.writeText(
                            lastExport.fileName,
                          );
                          campusToast.success({
                            title: "Filename copied",
                            description:
                              "The exported CSV filename was copied to your clipboard.",
                            dedupeKey: "admin:export-filename-copied",
                          });
                        }}
                      >
                        Copy filename
                      </Button>
                    </div>
                  </CardBody>
                </Card>
              ) : null}
            </div>
          </Tab>
        </Tabs>

        <Modal
          isOpen={Boolean(pendingRoleChange)}
          onOpenChange={(open) => {
            if (!open && !savingRoleUid) setPendingRoleChange(null);
          }}
          size="md"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader>Confirm role change</ModalHeader>
                <ModalBody className="space-y-3">
                  <p className="text-base font-semibold text-campus-text-primary">
                    {roleChangeModalCopy?.title}
                  </p>
                  <p className="text-sm text-campus-text-secondary">
                    {roleChangeModalCopy?.description}
                  </p>
                  {pendingRoleChange ? (
                    <div className="rounded-2xl border bg-[#faf7f3] px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
                        Pending update
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Chip variant="bordered">
                          {pendingRoleChange.profile.schoolId ||
                            pendingRoleChange.profile.id}
                        </Chip>
                        <span className="text-sm text-campus-text-secondary">
                          to
                        </span>
                        <UserRoleChip role={pendingRoleChange.nextRole} />
                      </div>
                    </div>
                  ) : null}
                </ModalBody>
                <ModalFooter className="justify-between">
                  <Button
                    variant="bordered"
                    onPress={() => {
                      setPendingRoleChange(null);
                      onClose();
                    }}
                    isDisabled={Boolean(savingRoleUid)}
                  >
                    Cancel
                  </Button>
                  <Button
                    color="warning"
                    onPress={() => {
                      void confirmRoleChange();
                    }}
                    isLoading={Boolean(
                      pendingRoleChange &&
                        savingRoleUid === pendingRoleChange.profile.id,
                    )}
                  >
                    {roleChangeModalCopy?.confirmLabel || "Confirm"}
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        <Modal
          isOpen={Boolean(pendingDeleteProfile)}
          onOpenChange={(open) => {
            if (!open && !deletingUid) setPendingDeleteProfile(null);
          }}
          size="md"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader>Remove account</ModalHeader>
                <ModalBody className="space-y-3">
                  <p className="text-base font-semibold text-campus-text-primary">
                    This action permanently removes the account from CAMPUS.
                  </p>
                  <p className="text-sm text-campus-text-secondary">
                    The user will lose access after deletion. This does not
                    change any existing audit log entries.
                  </p>
                  {pendingDeleteProfile ? (
                    <div className="rounded-2xl border bg-danger-50 px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-danger-700">
                        Account to remove
                      </p>
                      <p className="mt-2 font-semibold text-danger-900">
                        {pendingDeleteProfile.schoolId || pendingDeleteProfile.id}
                      </p>
                      <p className="mt-1 break-all text-sm text-danger-800">
                        {pendingDeleteProfile.email || "No email on file"}
                      </p>
                    </div>
                  ) : null}
                </ModalBody>
                <ModalFooter className="justify-between">
                  <Button
                    variant="bordered"
                    onPress={() => {
                      setPendingDeleteProfile(null);
                      onClose();
                    }}
                    isDisabled={Boolean(deletingUid)}
                  >
                    Cancel
                  </Button>
                  <Button
                    color="danger"
                    onPress={() => {
                      void confirmRemoveAccount();
                    }}
                    isLoading={Boolean(
                      pendingDeleteProfile &&
                        deletingUid === pendingDeleteProfile.id,
                    )}
                  >
                    Delete account
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>
      </div>
    </div>
  );
}
