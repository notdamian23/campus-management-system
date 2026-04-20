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
import { Pagination } from "@heroui/pagination";
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
  Upload,
  UserPlus,
  Users2,
} from "lucide-react";
import { ScrollShadow } from "@heroui/scroll-shadow";
import BulkStudentImportModal from "@/components/admin/BulkStudentImportModal";
import {
  CampusDataTable,
  CampusSectionCard,
  CampusEmptyState,
  CampusTableBodySkeleton,
  type CampusTableColumn,
  CampusDetailSkeleton,
  CampusLayoutLoadingState,
  CampusMetricCard,
  CampusMetricSkeleton,
  CampusWorkspaceHeaderCard,
} from "@/components/ui";
import { auth, db } from "@/lib/firebase";
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
import { httpsCallable } from "firebase/functions";
import {
  type CampusProfileDoc,
  getOnboardingRedirect,
} from "@/lib/campus-auth";
import { normalizeCampusRole } from "@/lib/campus-role";
import {
  normalizeCampusUserRow,
  type CampusUserProjectionSource,
  type CampusUserRow,
  toStoredCampusRole,
} from "@/lib/campus-user-rows";
import {
  downloadCsv,
  getBulkStudentImportTemplateCsv,
} from "@/lib/bulkStudentImport";
import {
  CAMPUS_COURSE_CODE_OPTIONS,
  CAMPUS_COURSE_OPTIONS,
  normalizeCourseCode,
  resolveCourseFromCode,
} from "@/lib/courseOptions";
import {
  EC_POSITION_OPTIONS,
  formatBodPosition,
  getECPositionSelectionValue,
} from "@/lib/ec-permissions";
import {
  adminUpdateUserProfile,
  adminDeactivateAllStudents,
  adminDeleteDuplicateStudentSchoolIds,
  adminFindDuplicateStudentSchoolIds,
  type AdminDuplicateStudentSchoolIdReport,
  getCampusFunctions,
} from "@/lib/firebase-functions";
import { formatStudentFullName } from "@/lib/student-name";

const roleOptions = ["student", "teacher", "ecmember", "admin"] as const;
const yearOptions = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
  "5th Year",
] as const;
const courseOptions = CAMPUS_COURSE_OPTIONS;
type Role = (typeof roleOptions)[number];
type ECPositionOption = (typeof EC_POSITION_OPTIONS)[number];
type AdminTab = "overview" | "users" | "logs" | "exports";
type EmailFilter = "all" | "with_email" | "without_email";
type DuplicateFilter = "all" | "duplicates_only" | "non_duplicates_only";
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
  studentId?: string;
  email?: string;
  role?: string;
  ecPosition?: string | null;
  ecScope?: "all" | "course" | null;
  assignedCourse?: string | null;
  courseScope?: string | null;
  isBod?: boolean;
  name?: string;
  fullName?: string;
  displayName?: string;
  studentName?: string;
  teacherName?: string;
  course?: string;
  year?: string;
  yearLevel?: string;
  createdAt?: unknown;
  status?: string;
  readyForClearance?: boolean;
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
  profile: CampusUserRow;
  nextRole: Role;
};

const USER_PAGE_SIZE_OPTIONS = [10, 15, 25] as const;

const roleCards = [
  {
    key: "admin" as Role,
    role: "Admin",
    summary: "Full platform control and monitoring.",
    route: "/admin",
  },
  {
    key: "ecmember" as Role,
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

const userColumns: CampusTableColumn<CampusUserRow>[] = [
  {
    key: "name",
    label: "Name",
    className: "min-w-[280px]",
    cellClassName: "align-top min-w-[280px]",
  },
  {
    key: "schoolId",
    label: "School ID",
    className: "min-w-[170px]",
    cellClassName: "align-top min-w-[170px]",
  },
  {
    key: "studentId",
    label: "Student ID",
    className: "min-w-[150px]",
    cellClassName: "align-top min-w-[150px]",
  },
  {
    key: "email",
    label: "Email",
    className: "min-w-[260px]",
    cellClassName: "align-top min-w-[260px]",
  },
  {
    key: "course",
    label: "Course",
    className: "min-w-[210px]",
    cellClassName: "align-top min-w-[210px]",
  },
  {
    key: "yearLevel",
    label: "Year Level",
    className: "min-w-[140px]",
    cellClassName: "align-top min-w-[140px]",
  },
  {
    key: "role",
    label: "Role",
    className: "min-w-[130px]",
    cellClassName: "align-top min-w-[130px]",
  },
  {
    key: "roleAssignment",
    label: "Role Assignment",
    className: "min-w-[220px]",
    cellClassName: "align-top min-w-[220px]",
  },
  {
    key: "ecPosition",
    label: "EC Position",
    className: "min-w-[170px]",
    cellClassName: "align-top min-w-[170px]",
  },
  {
    key: "ecScope",
    label: "EC Scope",
    className: "min-w-[150px]",
    cellClassName: "align-top min-w-[150px]",
  },
  {
    key: "assignedCourse",
    label: "Assigned Course",
    className: "min-w-[200px]",
    cellClassName: "align-top min-w-[200px]",
  },
  {
    key: "actions",
    label: "Actions",
    align: "end",
    className: "min-w-[120px] text-right",
    cellClassName: "align-top min-w-[120px]",
  },
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

function buildDuplicateSchoolIdAuditCsv(
  report: AdminDuplicateStudentSchoolIdReport,
) {
  const lines = [
    [
      "SchoolId",
      "DuplicateCount",
      "PrimaryRecord",
      "UID",
      "Name",
      "Email",
      "Status",
      "Role",
      "Source",
    ].join(","),
  ];

  report.duplicates.forEach((group) => {
    group.entries.forEach((entry) => {
      lines.push(
        [
          csvCell(group.schoolId),
          csvCell(group.count),
          csvCell(entry.isPrimary ? "Yes" : "No"),
          csvCell(entry.uid),
          csvCell(entry.name),
          csvCell(entry.email),
          csvCell(entry.status),
          csvCell(entry.role),
          csvCell(entry.source),
        ].join(","),
      );
    });
  });

  return lines.join("\r\n");
}

function formatRole(role: Role) {
  return role === "ecmember"
    ? "EC Member"
    : `${role.charAt(0).toUpperCase()}${role.slice(1)}`;
}

function roleColor(role: Role): "danger" | "warning" | "primary" | "success" {
  if (role === "admin") return "danger";
  if (role === "ecmember") return "warning";
  if (role === "teacher") return "primary";
  return "success";
}

function roleRank(role: Role) {
  if (role === "admin") return 0;
  if (role === "ecmember") return 1;
  if (role === "teacher") return 2;
  return 3;
}

function formatECScope(scope: CampusUserRow["ecScope"]) {
  if (scope === "course") return "Course-limited";
  if (scope === "all") return "All access";
  return "-";
}

function buildECProfileFields(
  role: Role,
  ecPosition: string,
  assignedCourse: string,
) {
  if (role !== "ecmember") {
    return {
      ecPosition: null,
      ecScope: null,
      assignedCourse: null,
      courseScope: null,
      isBod: false,
    };
  }

  const normalizedPosition = getECPositionSelectionValue(ecPosition);
  if (normalizedPosition === "B.O.D.") {
    const normalizedAssignedCourse = normalizeCourseCode(assignedCourse);
    return {
      ecPosition: normalizedAssignedCourse
        ? formatBodPosition(normalizedAssignedCourse)
        : "B.O.D.",
      ecScope: "course" as const,
      assignedCourse: normalizedAssignedCourse || null,
      courseScope: resolveCourseFromCode(normalizedAssignedCourse) || null,
      isBod: Boolean(normalizedAssignedCourse),
    };
  }

  return {
    ecPosition: normalizedPosition || null,
    ecScope: "all" as const,
    assignedCourse: null,
    courseScope: null,
    isBod: false,
  };
}

function hasEmail(profile: Pick<CampusUserRow, "email">) {
  return Boolean(String(profile.email ?? "").trim());
}

function getRoleDescription(role: Role) {
  if (role === "admin") return "Full control over users, logs, and exports.";
  if (role === "ecmember")
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
          <CampusTableBodySkeleton rows={6} columns={12} />
        </CardBody>
      </Card>
    </div>
  );
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const [tab, setTab] = useState<AdminTab>("overview");
  const [checking, setChecking] = useState(true);
  const [adminUid, setAdminUid] = useState<string | null>(null);
  const [profileDocs, setProfileDocs] = useState<Profile[]>([]);
  const [studentProjections, setStudentProjections] = useState<
    Record<string, CampusUserProjectionSource>
  >({});
  const [profilesLoading, setProfilesLoading] = useState(true);
  const [userSearch, setUserSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [emailFilter, setEmailFilter] = useState<EmailFilter>("all");
  const [duplicateFilter, setDuplicateFilter] =
    useState<DuplicateFilter>("all");
  const [userSortMode, setUserSortMode] =
    useState<UserSortMode>("school_id_asc");
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] =
    useState<(typeof USER_PAGE_SIZE_OPTIONS)[number]>(10);
  const [savingRoleUid, setSavingRoleUid] = useState<string | null>(null);
  const [savingProfileUid, setSavingProfileUid] = useState<string | null>(null);
  const [newSchoolId, setNewSchoolId] = useState("");
  const [newRole, setNewRole] = useState<Role>("student");
  const [newEcName, setNewEcName] = useState("");
  const [newEcPosition, setNewEcPosition] = useState<ECPositionOption | "">("");
  const [newBodCourse, setNewBodCourse] = useState("");
  const [newTeacherName, setNewTeacherName] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newCourse, setNewCourse] = useState("");
  const [newYear, setNewYear] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [isBulkImportOpen, setIsBulkImportOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [pendingRoleChange, setPendingRoleChange] =
    useState<PendingRoleChange | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] =
    useState<CampusUserRow | null>(null);
  const [showDeactivateStudentsModal, setShowDeactivateStudentsModal] =
    useState(false);
  const [deactivatingStudents, setDeactivatingStudents] = useState(false);
  const [duplicateAuditReport, setDuplicateAuditReport] =
    useState<AdminDuplicateStudentSchoolIdReport | null>(null);
  const [duplicateAuditLoading, setDuplicateAuditLoading] = useState(false);
  const [checkingDuplicateSchoolIds, setCheckingDuplicateSchoolIds] =
    useState(false);
  const [showDeleteDuplicateSchoolIdsModal, setShowDeleteDuplicateSchoolIdsModal] =
    useState(false);
  const [deletingDuplicateSchoolIds, setDeletingDuplicateSchoolIds] =
    useState(false);
  const [editingProfile, setEditingProfile] = useState<CampusUserRow | null>(
    null,
  );
  const [editProfileName, setEditProfileName] = useState("");
  const [editProfileEmail, setEditProfileEmail] = useState("");
  const [editProfileSchoolId, setEditProfileSchoolId] = useState("");
  const [editProfileRole, setEditProfileRole] = useState<Role>("student");
  const [editProfileCourse, setEditProfileCourse] = useState("");
  const [editProfileYearLevel, setEditProfileYearLevel] = useState("");
  const [editProfileEcPosition, setEditProfileEcPosition] = useState<
    ECPositionOption | ""
  >("");
  const [editProfileBodCourse, setEditProfileBodCourse] = useState("");
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

        if (normalizeCampusRole(profile.role) !== "admin")
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
      // Load the full admin directory so the count, search, filters, and
      // pagination operate on the real account set instead of a capped slice.
      query(collection(db, "profiles"), orderBy("role", "asc")),
      (snap) => {
        setProfileDocs(
          snap.docs.map((profileDoc) => ({
            id: profileDoc.id,
            ...(profileDoc.data() as Omit<Profile, "id">),
          })),
        );
        setProfilesLoading(false);
      },
      () => {
        setProfileDocs([]);
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
    return onSnapshot(
      collection(db, "students"),
      (snap) => {
        const next: Record<string, CampusUserProjectionSource> = {};
        snap.docs.forEach((studentDoc) => {
          next[studentDoc.id] = {
            uid: studentDoc.id,
            ...(studentDoc.data() as CampusUserProjectionSource),
          };
        });
        setStudentProjections(next);
      },
      () => {
        setStudentProjections({});
        campusToast.error({
          title: "Student roster unavailable",
          description:
            "Student roster projections could not be loaded for admin review.",
          dedupeKey: "admin:students-load-error",
        });
      },
    );
  }, [adminUid]);

  useEffect(() => {
    if (!adminUid) return;
    setLogsLoading(true);
    let mounted = true;

    async function loadLogs() {
      try {
        const snap = await getDocs(
          query(collection(db, "logs"), orderBy("createdAt", "desc"), limit(50)),
        );
        if (!mounted) return;

        setLogs(
          snap.docs.map((logDoc) => ({
            id: logDoc.id,
            ...(logDoc.data() as Omit<LogItem, "id">),
          })),
        );
        setLogsLoading(false);
      } catch {
        if (!mounted) return;
        setLogs([]);
        setLogsLoading(false);
        campusToast.error({
          title: "Logs unavailable",
          description: "Failed to load logs.",
          dedupeKey: "admin:logs-load-error",
        });
      }
    }

    void loadLogs();
    return () => {
      mounted = false;
    };
  }, [adminUid]);

  useEffect(() => {
    if (!adminUid) return;
    setEventsLoading(true);
    let mounted = true;

    async function loadEvents() {
      try {
        const snap = await getDocs(collection(db, "events"));
        if (!mounted) return;

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
      } catch {
        if (!mounted) return;
        setEvents([]);
        setEventsLoading(false);
        campusToast.error({
          title: "Events unavailable",
          description: "Failed to load events.",
          dedupeKey: "admin:events-load-error",
        });
      }
    }

    void loadEvents();
    return () => {
      mounted = false;
    };
  }, [adminUid]);

  useEffect(() => {
    if (!adminUid) {
      setDuplicateAuditReport(null);
      return;
    }

    void refreshDuplicateSchoolIdReport().catch(() => undefined);
  }, [adminUid]);

  const profiles = useMemo(
    () =>
      profileDocs.map((profile) =>
        normalizeCampusUserRow(
          profile.id,
          profile,
          studentProjections[profile.id],
          { fallbackSchoolIdToStudentId: true },
        ),
      ),
    [profileDocs, studentProjections],
  );

  const duplicateRowsByUid = useMemo(() => {
    const lookup = new Map<
      string,
      {
        schoolId: string;
        count: number;
        cleanupCandidateCount: number;
        isPrimary: boolean;
      }
    >();

    duplicateAuditReport?.duplicates.forEach((group) => {
      group.entries.forEach((entry) => {
        lookup.set(entry.uid, {
          schoolId: group.schoolId,
          count: group.count,
          cleanupCandidateCount: group.cleanupCandidateCount,
          isPrimary: entry.isPrimary,
        });
      });
    });

    return lookup;
  }, [duplicateAuditReport]);

  const filteredProfiles = useMemo(() => {
    const search = userSearch.trim().toLowerCase();
    return profiles.filter((profile) => {
      const duplicateMeta = duplicateRowsByUid.get(profile.uid);
      const matchesSearch =
        !search ||
        [
          profile.schoolId,
          profile.fullName,
          profile.rawFullName,
          profile.firstName,
          profile.lastName,
          profile.studentId,
          profile.email,
          profile.role,
          profile.ecPosition,
          profile.ecScope,
          profile.assignedCourse,
          profile.assignedCourseLabel,
          profile.course,
          profile.yearLevel,
          profile.uid,
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
      const matchesDuplicateFilter =
        duplicateFilter === "all"
          ? true
          : duplicateFilter === "duplicates_only"
            ? Boolean(duplicateMeta)
            : !duplicateMeta;

      return matchesSearch && matchesRole && matchesEmail && matchesDuplicateFilter;
    });
  }, [profiles, userSearch, roleFilter, emailFilter, duplicateFilter, duplicateRowsByUid]);

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
          left.fullName.localeCompare(right.fullName) ||
          String(left.schoolId ?? "").localeCompare(String(right.schoolId ?? ""))
        );
      }
      if (userSortMode === "name_desc") {
        return (
          right.fullName.localeCompare(left.fullName) ||
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
  const totalUserPages = useMemo(
    () => Math.max(1, Math.ceil(sortedProfiles.length / userPageSize)),
    [sortedProfiles.length, userPageSize],
  );
  const safeUserPage = Math.min(Math.max(userPage, 1), totalUserPages);
  const paginatedProfiles = useMemo(() => {
    const startIndex = (safeUserPage - 1) * userPageSize;
    return sortedProfiles.slice(startIndex, startIndex + userPageSize);
  }, [safeUserPage, sortedProfiles, userPageSize]);
  const currentPageStart = sortedProfiles.length === 0
    ? 0
    : (safeUserPage - 1) * userPageSize + 1;
  const currentPageEnd = Math.min(
    safeUserPage * userPageSize,
    sortedProfiles.length,
  );

  const roleCounts = useMemo(
    () =>
      profiles.reduce(
        (accumulator, profile) => {
          accumulator[profile.role] += 1;
          return accumulator;
        },
        { admin: 0, ecmember: 0, teacher: 0, student: 0 } as Record<Role, number>,
      ),
    [profiles],
  );

  const existingSchoolIds = useMemo(() => {
    return new Set(profiles.map((profile) => profile.schoolId).filter(Boolean));
  }, [profiles]);
  const totalStudentAccounts = useMemo(
    () => profiles.filter((profile) => profile.role === "student").length,
    [profiles],
  );
  const duplicateGroupCount = duplicateAuditReport?.duplicateGroupCount ?? 0;
  const duplicateEntryCount = duplicateAuditReport?.duplicateEntryCount ?? 0;
  const duplicateCleanupCandidateCount =
    duplicateAuditReport?.cleanupCandidateCount ?? 0;
  const activeStudentAccounts = useMemo(
    () =>
      profiles.filter(
        (profile) =>
          profile.role === "student" && profile.accountStatus === "Active",
      ).length,
    [profiles],
  );

  const usersWithEmailCount = useMemo(
    () => profiles.filter((profile) => hasEmail(profile)).length,
    [profiles],
  );

  const usersWithoutEmailCount = profiles.length - usersWithEmailCount;
  const isStudentCreateRole = newRole === "student";
  const isTeacherCreateRole = newRole === "teacher";
  const isEcCreateRole = newRole === "ecmember";
  const isNewBodRole = isEcCreateRole && newEcPosition === "B.O.D.";
  const createAccountHelperText = isStudentCreateRole
    ? "Student accounts need a name, course, and year level so roster, preregistration, and payment rules work correctly."
    : isTeacherCreateRole
      ? "Teacher accounts need a saved name so directory results and classroom-facing views stay easy to identify."
      : isEcCreateRole
        ? "EC member accounts also need an EC position. B.O.D. entries require a course assignment so course-limited permissions work correctly."
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
    Boolean(userSearch.trim()) ||
    roleFilter !== "all" ||
    emailFilter !== "all" ||
    duplicateFilter !== "all";
  const canResetCreateForm =
    Boolean(newSchoolId.trim()) ||
    Boolean(newEcName.trim()) ||
    Boolean(newEcPosition) ||
    Boolean(newBodCourse.trim()) ||
    Boolean(newTeacherName.trim()) ||
    Boolean(newStudentName.trim()) ||
    Boolean(newCourse.trim()) ||
    Boolean(newYear.trim()) ||
    Boolean(newEmail.trim()) ||
    newRole !== "student";

  useEffect(() => {
    setUserPage(1);
  }, [userSearch, roleFilter, emailFilter, duplicateFilter, userSortMode]);

  useEffect(() => {
    setUserPage((previous) => Math.min(Math.max(previous, 1), totalUserPages));
  }, [totalUserPages]);

  const resetCreateForm = () => {
    setNewSchoolId("");
    setNewEmail("");
    setNewEcName("");
    setNewEcPosition("");
    setNewBodCourse("");
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
    setDuplicateFilter("all");
    setUserSortMode("school_id_asc");
    setUserPage(1);
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

  const renderEcPositionField = (
    key: string,
    value: string,
    onChange: (value: ECPositionOption | "") => void,
    className?: string,
  ) => (
    <div key={key} className={className}>
      <Select
        label="EC Position"
        selectedKeys={value ? [value] : []}
        onSelectionChange={(keys) => {
          const selected = Array.from(keys as Set<React.Key>)[0];
          if (typeof selected === "string") {
            onChange(selected as ECPositionOption);
          }
        }}
        placeholder="Select EC position"
        isRequired
      >
        {EC_POSITION_OPTIONS.map((position) => (
          <SelectItem key={position}>{position}</SelectItem>
        ))}
      </Select>
    </div>
  );

  const renderBodCourseField = (
    key: string,
    value: string,
    onChange: (value: string) => void,
    className?: string,
  ) => (
    <div key={key} className={className}>
      <Select
        label="B.O.D. Course"
        selectedKeys={value ? [value] : []}
        onSelectionChange={(keys) => {
          const selected = Array.from(keys as Set<React.Key>)[0];
          if (typeof selected === "string") {
            onChange(selected);
          }
        }}
        placeholder="Select B.O.D. course"
        isRequired
      >
        {CAMPUS_COURSE_CODE_OPTIONS.map((option) => (
          <SelectItem key={option.code}>{option.label}</SelectItem>
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
            renderEcPositionField("ecPosition", newEcPosition, (value) => {
              setNewEcPosition(value);
              if (value !== "B.O.D.") {
                setNewBodCourse("");
              }
            }),
            ...(isNewBodRole
              ? [
                  renderBodCourseField(
                    "ecBodCourse",
                    newBodCourse,
                    setNewBodCourse,
                  ),
                ]
              : []),
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

    if (!duplicateAuditLoading && duplicateGroupCount > 0) {
      items.push({
        id: "duplicate-school-ids",
        color: "danger",
        title: "Duplicate School IDs detected",
        description: `${duplicateGroupCount} duplicate School ID group${duplicateGroupCount === 1 ? "" : "s"} are still present across ${duplicateEntryCount} student record${duplicateEntryCount === 1 ? "" : "s"}.`,
        actionLabel: "Review duplicates",
        onPress: () => {
          setTab("users");
          setDuplicateFilter("duplicates_only");
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
    duplicateAuditLoading,
    duplicateEntryCount,
    duplicateGroupCount,
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

  async function updateRole(profile: CampusUserRow, role: Role) {
    try {
      setSavingRoleUid(profile.uid);
      const rolePatch =
        role === "ecmember"
          ? { role: toStoredCampusRole(role) }
          : {
              role: toStoredCampusRole(role),
              ecPosition: null,
              ecScope: null,
              assignedCourse: null,
              courseScope: null,
              isBod: false,
            };
      await updateDoc(doc(db, "profiles", profile.uid), rolePatch);
      campusToast.success({
        title: "Role updated",
        description: `${profile.schoolId || profile.uid} is now ${formatRole(role)}.`,
        dedupeKey: `admin:role-updated:${profile.uid}:${role}`,
      });
    } catch {
      campusToast.error({
        title: "Role update failed",
        description: "Failed to update role.",
        dedupeKey: `admin:role-update-error:${profile.uid}`,
      });
    } finally {
      setSavingRoleUid(null);
    }
  }

  async function createAccount() {
    const schoolId = newSchoolId.trim();
    const email = newEmail.trim();
    const ecName = newEcName.trim();
    const ecPosition = newEcPosition.trim();
    const bodCourse = newBodCourse.trim();
    const teacherName = newTeacherName.trim();
    const studentName = newStudentName.trim();
    const course = newCourse.trim();
    const year = newYear.trim();
    const isStudentRole = newRole === "student";
    const isTeacherRole = newRole === "teacher";
    const isEcRole = newRole === "ecmember";
    const requiresCourse = isStudentRole || isEcRole;
    const requiresYear = isStudentRole || isEcRole;
    const name = isStudentRole
      ? studentName
      : isTeacherRole
        ? teacherName
        : isEcRole
          ? ecName
          : "";
    const ecProfileFields = buildECProfileFields(
      newRole,
      ecPosition,
      bodCourse,
    );

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

    if (isEcRole && !ecPosition) {
      campusToast.error({
        title: "Missing EC position",
        description: "Choose an EC position before saving an EC member account.",
        dedupeKey: "admin:create-account:missing-ec-position",
      });
      return;
    }

    if (isNewBodRole && !bodCourse) {
      campusToast.error({
        title: "Missing B.O.D. course",
        description: "Choose the handled course before saving a B.O.D. member.",
        dedupeKey: "admin:create-account:missing-bod-course",
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
          course?: string | null;
          yearLevel?: string | null;
          ecPosition?: string | null;
          ecScope?: "all" | "course" | null;
          assignedCourse?: string | null;
        },
        { uid?: string }
      >(getCampusFunctions(), "adminCreateUser");
      const result = await fn({
        schoolId,
        role: newRole,
        email: email || null,
        name: name || null,
        course: requiresCourse ? course : null,
        yearLevel: requiresYear ? year : null,
        ecPosition: ecProfileFields.ecPosition,
        ecScope: ecProfileFields.ecScope,
        assignedCourse: ecProfileFields.assignedCourse,
      });
      campusToast.success({
        title: "Account created",
        description: `UID: ${result?.data?.uid ?? "-"}`,
        dedupeKey: `admin:create-account:${result?.data?.uid ?? schoolId}`,
      });
      await refreshDuplicateSchoolIdReport().catch(() => undefined);
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
        getCampusFunctions(),
        "adminDeleteUser",
      )({ uid });
      campusToast.success({
        title: "Account removed",
        description: `${uid} was removed successfully.`,
        dedupeKey: `admin:remove-account:${uid}`,
      });
      await refreshDuplicateSchoolIdReport().catch(() => undefined);
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

  function requestRoleChange(profile: CampusUserRow, nextRole: Role) {
    if (nextRole === profile.role) return;

    if (nextRole === "ecmember" && profile.role !== "ecmember") {
      openEditProfileModal(profile, "ecmember");
      campusToast.info({
        title: "Finish EC assignment",
        description:
          "Set the EC position, and choose a B.O.D. course when needed, before saving.",
        dedupeKey: `admin:role-change:open-ec-editor:${profile.uid}`,
      });
      return;
    }

    const isSensitiveChange =
      nextRole === "admin" || profile.role === "admin" || profile.uid === adminUid;

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

  function requestRemoveAccount(profile: CampusUserRow) {
    if (profile.uid === adminUid) {
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
    await removeAccount(target.uid);
    setPendingDeleteProfile(null);
  }

  function openEditProfileModal(profile: CampusUserRow, nextRole?: Role) {
    const resolvedRole = nextRole ?? profile.role;
    setEditingProfile(profile);
    setEditProfileRole(resolvedRole);
    setEditProfileName(profile.fullName);
    setEditProfileEmail(
      String(profile.email ?? "").trim() ||
        `${String(profile.schoolId ?? "").trim()}@campus.local`,
    );
    setEditProfileSchoolId(profile.schoolId);
    setEditProfileCourse(
      profile.course === "-" ? "" : String(profile.course ?? "").trim(),
    );
    setEditProfileYearLevel(
      profile.yearLevel === "-" ? "" : String(profile.yearLevel ?? "").trim(),
    );
    setEditProfileEcPosition(
      resolvedRole === "ecmember"
        ? ((profile.role === "ecmember"
            ? getECPositionSelectionValue(profile.ecPosition)
            : "") as ECPositionOption | "")
        : "",
    );
    setEditProfileBodCourse(
      resolvedRole === "ecmember" && profile.role === "ecmember"
        ? String(profile.assignedCourse ?? "").trim()
        : "",
    );
  }

  async function confirmDeactivateAllStudents() {
    setDeactivatingStudents(true);

    try {
      const result = await adminDeactivateAllStudents(getCampusFunctions());
      const updatedCount = Number(result.updatedCount ?? 0);
      const totalCount = Number(result.totalStudentCount ?? 0);

      if (updatedCount > 0) {
        campusToast.success({
          title: "Student accounts updated",
          description: `${updatedCount} student account${updatedCount === 1 ? "" : "s"} were set to inactive.`,
          dedupeKey: `admin:deactivate-all-students:success:${updatedCount}:${totalCount}`,
        });
      } else {
        campusToast.info({
          title: "No active students found",
          description: "All student accounts are already inactive.",
          dedupeKey: `admin:deactivate-all-students:no-change:${totalCount}`,
        });
      }

      setShowDeactivateStudentsModal(false);
    } catch (error: unknown) {
      campusToast.error({
        title: "Bulk update failed",
        description: toErrorMessage(
          error,
          "Failed to update student account statuses.",
        ),
        dedupeKey: "admin:deactivate-all-students:error",
      });
    } finally {
      setDeactivatingStudents(false);
    }
  }

  async function refreshDuplicateSchoolIdReport() {
    setDuplicateAuditLoading(true);

    try {
      const report = await adminFindDuplicateStudentSchoolIds(
        getCampusFunctions(),
        5000,
      );
      setDuplicateAuditReport(report);
      return report;
    } catch (error: unknown) {
      setDuplicateAuditReport(null);
      throw error;
    } finally {
      setDuplicateAuditLoading(false);
    }
  }

  async function checkDuplicateStudentSchoolIds() {
    setCheckingDuplicateSchoolIds(true);

    try {
      const report = await refreshDuplicateSchoolIdReport();

      if (report.duplicateGroupCount === 0) {
        campusToast.success({
          title: "No duplicate School IDs found",
          description: "All scanned student School IDs are unique.",
          dedupeKey: "admin:duplicate-school-id-audit:clean",
        });
        return;
      }

      const csv = buildDuplicateSchoolIdAuditCsv(report);
      downloadCsv("campus-duplicate-student-schoolids.csv", csv);
      campusToast.warning({
        title: "Duplicate student School IDs found",
        description: `${report.duplicateGroupCount} duplicate School ID group${report.duplicateGroupCount === 1 ? "" : "s"} were found across ${report.duplicateEntryCount} record${report.duplicateEntryCount === 1 ? "" : "s"}. A cleanup CSV was downloaded.`,
        dedupeKey: `admin:duplicate-school-id-audit:${report.duplicateGroupCount}:${report.duplicateEntryCount}`,
      });
    } catch (error: unknown) {
      campusToast.error({
        title: "Duplicate check failed",
        description: toErrorMessage(
          error,
          "Failed to scan for duplicate student School IDs.",
        ),
        dedupeKey: "admin:duplicate-school-id-audit:error",
      });
    } finally {
      setCheckingDuplicateSchoolIds(false);
    }
  }

  async function openDeleteDuplicateSchoolIdsModal() {
    try {
      const report = await refreshDuplicateSchoolIdReport();
      if (report.cleanupCandidateCount === 0) {
        campusToast.info({
          title: "No duplicate School IDs to delete",
          description: "Student School IDs are already clean.",
          dedupeKey: "admin:duplicate-school-id-cleanup:none",
        });
        return;
      }

      setShowDeleteDuplicateSchoolIdsModal(true);
    } catch (error: unknown) {
      campusToast.error({
        title: "Duplicate check failed",
        description: toErrorMessage(
          error,
          "Failed to prepare duplicate School ID cleanup.",
        ),
        dedupeKey: "admin:duplicate-school-id-cleanup:prepare-error",
      });
    }
  }

  async function confirmDeleteDuplicateSchoolIds() {
    setDeletingDuplicateSchoolIds(true);

    try {
      const result = await adminDeleteDuplicateStudentSchoolIds(
        getCampusFunctions(),
      );

      if (result.deletedCount > 0 && result.failedCount === 0) {
        campusToast.success({
          title: "Duplicate School IDs cleaned",
          description: `${result.deletedCount} duplicate student account${result.deletedCount === 1 ? "" : "s"} were deleted while keeping ${result.keptCount} primary record${result.keptCount === 1 ? "" : "s"}.`,
          dedupeKey: `admin:duplicate-school-id-cleanup:success:${result.deletedCount}:${result.keptCount}`,
        });
      } else if (result.deletedCount > 0) {
        const detailPreview = result.failureDetails[0];
        campusToast.warning({
          title: "Duplicate cleanup completed with issues",
          description: `${result.deletedCount} duplicate account${result.deletedCount === 1 ? "" : "s"} were deleted, but ${result.failedCount} record${result.failedCount === 1 ? "" : "s"} still need review.${detailPreview ? ` ${detailPreview}` : ""}`,
          dedupeKey: `admin:duplicate-school-id-cleanup:partial:${result.deletedCount}:${result.failedCount}`,
        });
      } else {
        const detailPreview = result.failureDetails[0];
        campusToast.info({
          title: "No duplicate accounts were deleted",
          description: detailPreview || "No duplicate student accounts needed cleanup.",
          dedupeKey: `admin:duplicate-school-id-cleanup:no-change:${result.failedCount}`,
        });
      }

      setShowDeleteDuplicateSchoolIdsModal(false);
      await refreshDuplicateSchoolIdReport().catch(() => undefined);
    } catch (error: unknown) {
      campusToast.error({
        title: "Duplicate cleanup failed",
        description: toErrorMessage(
          error,
          "Failed to delete duplicate student School IDs.",
        ),
        dedupeKey: "admin:duplicate-school-id-cleanup:error",
      });
    } finally {
      setDeletingDuplicateSchoolIds(false);
    }
  }

  async function saveProfileChanges() {
    if (!editingProfile) return;

    const submittedName = editProfileName.trim();
    const email = editProfileEmail.trim().toLowerCase();
    const schoolId = editProfileSchoolId.trim();
    const course = editProfileCourse.trim();
    const yearLevel = editProfileYearLevel.trim();
    const ecPosition = editProfileEcPosition.trim();
    const bodCourse = editProfileBodCourse.trim();
    const allowsBlankAcademicFields =
      editProfileRole === "teacher" || editProfileRole === "admin";
    const ecProfileFields = buildECProfileFields(
      editProfileRole,
      ecPosition,
      bodCourse,
    );
    const originalRawName = String(editingProfile.rawFullName ?? "").trim();
    const originalDisplayName = formatStudentFullName(
      {
        name: originalRawName,
        schoolId: editingProfile.schoolId,
      },
      editingProfile.schoolId,
    );
    const name =
      submittedName === originalDisplayName && originalRawName
        ? originalRawName
        : submittedName;

    if (!submittedName) {
      campusToast.warning({
        title: "Missing name",
        description: "Name is required before you can save this profile.",
        dedupeKey: "admin:edit-profile:missing-name",
      });
      return;
    }

    if (!schoolId) {
      campusToast.warning({
        title: "Missing school ID",
        description: "School ID is required before you can save this profile.",
        dedupeKey: "admin:edit-profile:missing-school-id",
      });
      return;
    }

    if (!email) {
      campusToast.warning({
        title: "Missing email",
        description: "Email is required before you can save this profile.",
        dedupeKey: "admin:edit-profile:missing-email",
      });
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      campusToast.warning({
        title: "Invalid email",
        description: "Please provide a valid email address.",
        dedupeKey: `admin:edit-profile:invalid-email:${editingProfile.uid}`,
      });
      return;
    }

    if (!allowsBlankAcademicFields && !course) {
      campusToast.warning({
        title: "Missing course",
        description: `${formatRole(editProfileRole)} accounts require a course.`,
        dedupeKey: `admin:edit-profile:missing-course:${editingProfile.uid}`,
      });
      return;
    }

    if (!allowsBlankAcademicFields && !yearLevel) {
      campusToast.warning({
        title: "Missing year level",
        description: `${formatRole(editProfileRole)} accounts require a year level.`,
        dedupeKey: `admin:edit-profile:missing-year:${editingProfile.uid}`,
      });
      return;
    }

    if (editProfileRole === "ecmember" && !ecPosition) {
      campusToast.error({
        title: "Missing EC position",
        description: "Choose an EC position before saving this EC member.",
        dedupeKey: `admin:edit-profile:missing-ec-position:${editingProfile.uid}`,
      });
      return;
    }

    if (
      editProfileRole === "ecmember" &&
      ecPosition === "B.O.D." &&
      !bodCourse
    ) {
      campusToast.error({
        title: "Missing B.O.D. course",
        description: "Choose the handled course before saving this B.O.D. member.",
        dedupeKey: `admin:edit-profile:missing-bod-course:${editingProfile.uid}`,
      });
      return;
    }

    setSavingProfileUid(editingProfile.uid);

    try {
      await adminUpdateUserProfile(getCampusFunctions(), {
        targetUid: editingProfile.uid,
        email,
        name,
        schoolId,
        role: editProfileRole,
        course,
        yearLevel,
        ecPosition: editProfileRole === "ecmember" ? ecPosition : null,
        assignedCourse:
          editProfileRole === "ecmember" ? ecProfileFields.assignedCourse : null,
      });

      campusToast.success({
        title: "Profile updated",
        description: "Profile updated successfully.",
        dedupeKey: `admin:edit-profile:success:${editingProfile.uid}`,
      });
      setEditingProfile(null);
    } catch (error: unknown) {
      const errorCode =
        typeof error === "object" &&
        error !== null &&
        typeof (error as { code?: unknown }).code === "string"
          ? String((error as { code: string }).code).replace(/^functions\//, "")
          : "";
      const errorMessage =
        typeof error === "object" &&
        error !== null &&
        typeof (error as { message?: unknown }).message === "string"
          ? String((error as { message: string }).message)
          : "";
      let description = toErrorMessage(
        error,
        "Failed to update the selected profile.",
      );

      if (errorCode === "already-exists" && /email/i.test(errorMessage)) {
        description = "Email address is already in use.";
      } else if (errorCode === "invalid-argument" && /email/i.test(errorMessage)) {
        description = "Please provide a valid email address.";
      } else if (errorCode === "permission-denied") {
        description = "You do not have permission to update this profile.";
      }

      campusToast.error({
        title: "Profile update failed",
        description,
        dedupeKey: `admin:edit-profile:error:${editingProfile.uid}`,
      });
    } finally {
      setSavingProfileUid(null);
    }
  }

  const roleChangeModalCopy = useMemo(() => {
    if (!pendingRoleChange) return null;

    const { profile, nextRole } = pendingRoleChange;
    const profileLabel = profile.schoolId || profile.uid;
    const isSelfChange = profile.uid === adminUid;

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
    {
      id: "fingerprint-cleanup",
      title: "Fingerprint cleanup",
      description:
        "Review stale or duplicate fingerprint mappings and queue safe module cleanup actions.",
      helper: "Admin only",
      icon: ShieldAlert,
      onPress: () => router.push("/admin/fingerprint-cleanup"),
    },
  ];

  const openRoleView = (role: Role) => {
    setRoleFilter(role);
    setEmailFilter("all");
    setUserSearch("");
    setUserSortMode("school_id_asc");
    setUserPage(1);
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
        <CampusWorkspaceHeaderCard
          variant="hero"
          eyebrow="Admin Dashboard"
          title="Campus Management Control Center"
          description="Supervise users, logs, and attendance exports from one mobile-friendly control room."
          surfaceClassName="border-0 bg-gradient-to-br from-[#7b0000] via-[#991515] to-[#ef6b4a] text-white"
          meta={
            <>
              <Chip variant="flat" className="bg-white/15 text-white">
                {profiles.length} accounts
              </Chip>
              <Chip variant="flat" className="bg-white/15 text-white">
                {logs.length} logs
              </Chip>
              <Chip variant="flat" className="bg-white/15 text-white">
                {events.length} events
              </Chip>
            </>
          }
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="flat"
                className="bg-white/15 font-semibold text-white data-[hover=true]:bg-white/25"
                onPress={() => setTab("users")}
                startContent={<Users2 size={16} />}
              >
                Manage users
              </Button>
              <Button
                variant="flat"
                className="bg-white text-[#7b0000] font-semibold data-[hover=true]:bg-white/90"
                onPress={() => router.push("/admin/fingerprint-cleanup")}
                startContent={<ShieldAlert size={16} />}
              >
                Fingerprint Cleanup
              </Button>
            </div>
          }
        />

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
                      <CampusMetricCard
                        key={item.id}
                        label={item.label}
                        description={item.description}
                        value={item.value}
                        icon={Icon}
                        surfaceClassName="border-white/70 bg-white/90"
                        iconClassName={item.iconClassName}
                        valueClassName={item.tone}
                        badge={
                          <Chip variant="flat" className="font-medium">
                            Live
                          </Chip>
                        }
                      />
                    );
                  })}
                </div>

                <CampusSectionCard
                  title="Quick actions"
                  description="Start with the operational tasks admins reach for most often."
                  className="border-white/70 bg-white/95"
                  bodyClassName="grid gap-4 p-5 pt-4 sm:p-6 sm:pt-4 md:grid-cols-3"
                >
                    {quickActions.map((item) => {
                      const Icon = item.icon;
                      return (
                        <CampusSectionCard
                          key={item.id}
                          title={item.title}
                          description={item.description}
                          icon={Icon}
                          action={
                            <Chip variant="flat" className="font-medium">
                              {item.helper}
                            </Chip>
                          }
                          className="border-[#efe7e4] bg-[#fcfbfa] shadow-none"
                          iconClassName="bg-[#7b0000]/10 text-[#7b0000]"
                          bodyClassName="space-y-4 p-5 pt-4"
                        >
                          <Button
                            className="w-full bg-[#7b0000] font-semibold text-white sm:w-auto"
                            onPress={item.onPress}
                            endContent={<ArrowRight size={16} />}
                          >
                            {item.title}
                          </Button>
                        </CampusSectionCard>
                      );
                    })}
                </CampusSectionCard>

                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
                  <CampusSectionCard
                    title="Recent activity"
                    description="Live admin-facing events from the current CAMPUS log stream."
                    icon={Activity}
                    action={
                      <Button
                        variant="light"
                        className="px-0 font-semibold text-[#7b0000] data-[hover=true]:bg-transparent"
                        onPress={() => setTab("logs")}
                      >
                        Open logs
                      </Button>
                    }
                    className="border-white/70 bg-white/95"
                    iconClassName="bg-[#7b0000]/10 text-[#7b0000]"
                  >
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
                  </CampusSectionCard>

                  <CampusSectionCard
                    title="Attention needed"
                    description="Signals pulled from current dashboard data to help admins spot follow-up items quickly."
                    icon={TriangleAlert}
                    className="border-white/70 bg-white/95"
                    iconClassName="bg-amber-100 text-amber-700"
                  >
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
                  </CampusSectionCard>
                </div>

                <CampusSectionCard
                  title="Role overview"
                  description="Review how access is distributed, then jump directly into the filtered Users & Roles workspace."
                  className="border-white/70 bg-white/95"
                  bodyClassName="grid gap-4 p-5 pt-4 sm:p-6 sm:pt-4 md:grid-cols-2 xl:grid-cols-4"
                >
                    {roleCards.map((item) => (
                      <CampusSectionCard
                        key={item.role}
                        title={item.role}
                        description={item.summary}
                        action={<Chip variant="flat" className="font-semibold">{roleCounts[item.key]}</Chip>}
                        className="border-[#efe7e4] bg-[#fcfbfa] shadow-none"
                        bodyClassName="space-y-4 p-5 pt-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <UserRoleChip role={item.key} />
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
                      </CampusSectionCard>
                    ))}
                </CampusSectionCard>
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
                <CampusSectionCard
                  title="Users and roles"
                  description="Search profiles, filter access levels, and manage sensitive role assignments from one admin workspace."
                  action={
                    <div className="flex flex-wrap gap-2">
                      <Chip color="primary" variant="flat" className="font-semibold">
                        {profiles.length} total user{profiles.length === 1 ? "" : "s"}
                      </Chip>
                      <Chip variant="flat">{sortedProfiles.length} matching</Chip>
                      <Chip variant="flat">{usersWithEmailCount} with email</Chip>
                      <Chip variant="flat">{usersWithoutEmailCount} without email</Chip>
                      <Chip
                        color={duplicateGroupCount > 0 ? "warning" : "success"}
                        variant="flat"
                      >
                        {duplicateGroupCount} duplicate School ID group
                        {duplicateGroupCount === 1 ? "" : "s"}
                      </Chip>
                    </div>
                  }
                >
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_220px_220px_220px_220px]">
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
                        label="Duplicate status"
                        selectedKeys={[duplicateFilter]}
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys as Set<React.Key>)[0];
                          if (typeof selected === "string") {
                            setDuplicateFilter(selected as DuplicateFilter);
                          }
                        }}
                        disallowEmptySelection
                      >
                        <SelectItem key="all">All accounts</SelectItem>
                        <SelectItem key="duplicates_only">Duplicates only</SelectItem>
                        <SelectItem key="non_duplicates_only">
                          Non-duplicates only
                        </SelectItem>
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
                      <div className="space-y-1">
                        <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                          Filters and sorting help admins review high-risk access changes quickly.
                        </p>
                        <p className="text-xs text-campus-text-secondary">
                          Duplicate cleanup keeps one primary student record per normalized School ID and deletes only the extra student accounts.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="bordered"
                          onPress={checkDuplicateStudentSchoolIds}
                          isLoading={checkingDuplicateSchoolIds}
                          startContent={
                            !checkingDuplicateSchoolIds ? (
                              <ShieldAlert size={16} />
                            ) : undefined
                          }
                        >
                          Check duplicate School IDs
                        </Button>
                        <Button
                          color="danger"
                          variant="flat"
                          onPress={openDeleteDuplicateSchoolIdsModal}
                          isLoading={deletingDuplicateSchoolIds}
                          startContent={
                            !deletingDuplicateSchoolIds ? (
                              <ShieldAlert size={16} />
                            ) : undefined
                          }
                        >
                          Delete duplicate School IDs
                        </Button>
                        <Button
                          color="warning"
                          variant="flat"
                          onPress={() => setShowDeactivateStudentsModal(true)}
                          isDisabled={profilesLoading || activeStudentAccounts === 0}
                          startContent={<TriangleAlert size={16} />}
                        >
                          Make all students inactive
                        </Button>
                        <Button
                          variant="bordered"
                          onPress={resetUserFilters}
                          isDisabled={!hasActiveUserFilters && userSortMode === "school_id_asc"}
                          startContent={<RefreshCcw size={16} />}
                        >
                          Reset filters
                        </Button>
                      </div>
                    </div>
                </CampusSectionCard>

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
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Button
                          variant="flat"
                          startContent={<Upload size={16} />}
                          onPress={() => setIsBulkImportOpen(true)}
                        >
                          Upload CSV
                        </Button>
                        <Button
                          variant="bordered"
                          startContent={<Download size={16} />}
                          onPress={() => {
                            const csv = getBulkStudentImportTemplateCsv();
                            downloadCsv("campus-student-import-template.csv", csv);
                          }}
                        >
                          Download CSV Template
                        </Button>
                      </div>
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
                        description="Optional. If provided, the student can verify this email after first login."
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

                <Card shadow="sm" className="border">
                  <CardHeader className="flex flex-col gap-3 px-5 pb-0 pt-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-1">
                      <h3 className="text-lg font-bold text-gray-900">
                        Account directory
                      </h3>
                      <p className="text-sm text-gray-600">
                        Wider columns, smoother scanning, and paginated results keep role reviews manageable on both desktop and mobile.
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip variant="flat" className="font-semibold">
                        Showing {currentPageStart}-{currentPageEnd} of {sortedProfiles.length} matching
                      </Chip>
                      <Chip variant="flat">
                        {profiles.length} total accounts
                      </Chip>
                      <Chip variant="flat">
                        Page {safeUserPage} of {totalUserPages}
                      </Chip>
                    </div>
                  </CardHeader>
                  <CardBody className="space-y-4 p-5 pt-4">
                    <CampusDataTable
                      ariaLabel="Admin user accounts"
                      columns={userColumns}
                      items={paginatedProfiles}
                      isLoading={profilesLoading}
                      isHeaderSticky
                      loadingContent={
                        <CampusTableBodySkeleton rows={userPageSize} columns={12} />
                      }
                      emptyContent={
                        <CampusEmptyState
                          title="No users match the current filters"
                          description="Try another search term, adjust the role, email, or duplicate filters, or clear the filters to see the full CAMPUS directory."
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
                      tableClassName="min-w-[1880px]"
                      renderCell={(profile, columnKey) => {
                        const isSelf = profile.uid === adminUid;
                        const duplicateMeta = duplicateRowsByUid.get(profile.uid);

                        if (columnKey === "schoolId")
                          return (
                            <div className="space-y-1.5">
                              <p className="font-semibold text-campus-text-primary">
                                {profile.schoolId || "No school ID"}
                              </p>
                              {duplicateMeta ? (
                                <p className="text-xs font-medium text-danger">
                                  Duplicate group of {duplicateMeta.count}
                                </p>
                              ) : null}
                              <p className="break-all font-mono text-xs text-campus-text-secondary">
                                UID: {profile.uid}
                              </p>
                            </div>
                          );

                        if (columnKey === "name")
                          return (
                            <div className="space-y-3">
                              <div className="space-y-1">
                                <p className="text-sm font-semibold text-campus-text-primary">
                                  {profile.fullName}
                                </p>
                                <p className="text-xs text-campus-text-secondary">
                                  {profile.role === "student"
                                    ? "Student profile"
                                    : profile.role === "teacher"
                                      ? "Teacher profile"
                                      : profile.role === "ecmember"
                                        ? "EC member profile"
                                        : "Admin profile"}
                                </p>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <Chip
                                  color={
                                    profile.accountStatus === "Active"
                                      ? "success"
                                      : "default"
                                  }
                                  variant="flat"
                                  size="sm"
                                  className="whitespace-nowrap"
                                >
                                  Account: {profile.accountStatus}
                                </Chip>
                                <Chip
                                  color={
                                    profile.fingerprintStatus === "Active"
                                      ? "primary"
                                      : "default"
                                  }
                                  variant="flat"
                                  size="sm"
                                  className="whitespace-nowrap"
                                >
                                  Fingerprint: {profile.fingerprintStatus}
                                </Chip>
                                <Chip
                                  color={
                                    profile.clearanceReady ? "success" : "default"
                                  }
                                  variant="flat"
                                  size="sm"
                                  className="whitespace-nowrap"
                                >
                                  Clearance:{" "}
                                  {profile.clearanceReady ? "Ready" : "Pending"}
                                </Chip>
                                {duplicateMeta ? (
                                  <Chip
                                    color={duplicateMeta.isPrimary ? "warning" : "danger"}
                                    variant="flat"
                                    size="sm"
                                    className="whitespace-nowrap"
                                  >
                                    {duplicateMeta.isPrimary
                                      ? `Duplicate School ID: Primary (${duplicateMeta.count})`
                                      : `Duplicate School ID: Extra record (${duplicateMeta.count})`}
                                  </Chip>
                                ) : null}
                              </div>
                            </div>
                          );

                        if (columnKey === "studentId")
                          return (
                            <Chip
                              variant="flat"
                              color={profile.studentId === "-" ? "default" : "primary"}
                              className="font-medium"
                            >
                              {profile.studentId}
                            </Chip>
                          );

                        if (columnKey === "email")
                          return hasEmail(profile) ? (
                            <div className="space-y-1.5">
                              <Tooltip content={profile.email} delay={300}>
                                <p className="max-w-[280px] truncate text-sm text-campus-text-primary">
                                  {profile.email}
                                </p>
                              </Tooltip>
                              <p className="text-xs text-campus-text-secondary">
                                Contact-ready account
                              </p>
                            </div>
                          ) : (
                            <Chip variant="flat" color="warning" className="font-medium">
                              No email on file
                            </Chip>
                          );

                        if (columnKey === "course")
                          return (
                            <Chip
                              variant="flat"
                              color={profile.course === "-" ? "default" : "secondary"}
                              className="max-w-full font-medium"
                            >
                              {profile.course}
                            </Chip>
                          );

                        if (columnKey === "yearLevel")
                          return (
                            <Chip
                              variant="flat"
                              color={profile.yearLevel === "-" ? "default" : "warning"}
                              className="font-medium whitespace-nowrap"
                            >
                              {profile.yearLevel}
                            </Chip>
                          );

                        if (columnKey === "role") {
                          return <UserRoleChip role={profile.role} />;
                        }

                        if (columnKey === "roleAssignment") {
                          const roleSelect = (
                            <Select
                              aria-label={`Assign role for ${profile.schoolId || profile.uid}`}
                              selectedKeys={[profile.role]}
                              onSelectionChange={(keys) => {
                                const selected = Array.from(keys as Set<React.Key>)[0];
                                if (typeof selected === "string") {
                                  requestRoleChange(profile, selected as Role);
                                }
                              }}
                              disallowEmptySelection
                              isDisabled={savingRoleUid === profile.uid}
                              size="sm"
                              className="min-w-[190px]"
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

                        if (columnKey === "ecPosition")
                          return profile.role === "ecmember" ? (
                            <Chip
                              variant="flat"
                              color={profile.ecPosition ? "warning" : "danger"}
                              className="max-w-full font-medium"
                            >
                              {profile.ecPosition || "Not set"}
                            </Chip>
                          ) : (
                            <Chip variant="flat" color="default">
                              -
                            </Chip>
                          );

                        if (columnKey === "ecScope")
                          return profile.role === "ecmember" ? (
                            <Chip
                              variant="flat"
                              color={
                                profile.ecScope === "course" ? "secondary" : "success"
                              }
                              className="font-medium whitespace-nowrap"
                            >
                              {formatECScope(profile.ecScope)}
                            </Chip>
                          ) : (
                            <Chip variant="flat" color="default">
                              -
                            </Chip>
                          );

                        if (columnKey === "assignedCourse")
                          return profile.role === "ecmember" ? (
                            <Chip
                              variant="flat"
                              color={profile.assignedCourse ? "secondary" : "default"}
                              className="max-w-full font-medium"
                            >
                              {profile.assignedCourse
                                ? profile.assignedCourseLabel || profile.assignedCourse
                                : "-"}
                            </Chip>
                          ) : (
                            <Chip variant="flat" color="default">
                              -
                            </Chip>
                          );

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
                                      aria-label={`Actions for ${profile.schoolId || profile.uid}`}
                                    >
                                      <MoreHorizontal size={16} />
                                    </Button>
                                  </DropdownTrigger>
                                  <DropdownMenu aria-label="User actions">
                                    <DropdownItem
                                      key="edit"
                                      onPress={() => openEditProfileModal(profile)}
                                    >
                                      Edit profile
                                    </DropdownItem>
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

                    <div className="flex flex-col gap-3 border-t border-[#e5e7eb] pt-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-campus-text-primary">
                          Showing {currentPageStart}-{currentPageEnd} of {sortedProfiles.length} matching user{sortedProfiles.length === 1 ? "" : "s"}
                        </p>
                        <p className="text-xs text-campus-text-secondary">
                          {profiles.length} total account{profiles.length === 1 ? "" : "s"} are loaded. Horizontal scrolling is enabled when the full directory needs more room.
                        </p>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
                        <Select
                          label="Rows per page"
                          size="sm"
                          selectedKeys={[String(userPageSize)]}
                          onSelectionChange={(keys) => {
                            const selected = Array.from(keys as Set<React.Key>)[0];
                            if (typeof selected === "string") {
                              const nextPageSize = Number.parseInt(selected, 10);
                              if (
                                USER_PAGE_SIZE_OPTIONS.includes(
                                  nextPageSize as (typeof USER_PAGE_SIZE_OPTIONS)[number],
                                )
                              ) {
                                setUserPageSize(
                                  nextPageSize as (typeof USER_PAGE_SIZE_OPTIONS)[number],
                                );
                                setUserPage(1);
                              }
                            }
                          }}
                          disallowEmptySelection
                          className="w-full sm:w-40"
                        >
                          {USER_PAGE_SIZE_OPTIONS.map((size) => (
                            <SelectItem key={String(size)}>{size} rows</SelectItem>
                          ))}
                        </Select>

                        {sortedProfiles.length > 0 ? (
                          <div className="flex flex-col items-start gap-1 sm:items-end">
                            <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                              Page {safeUserPage} of {totalUserPages}
                            </p>
                            <Pagination
                              showControls
                              page={safeUserPage}
                              total={totalUserPages}
                              onChange={(nextPage) => setUserPage(nextPage)}
                            />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </CardBody>
                </Card>
              </div>
            )}
            <BulkStudentImportModal
              open={isBulkImportOpen}
              onClose={() => setIsBulkImportOpen(false)}
              existingSchoolIds={existingSchoolIds}
            />
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
          isOpen={showDeactivateStudentsModal}
          onOpenChange={(open) => {
            if (!open && !deactivatingStudents) {
              setShowDeactivateStudentsModal(false);
            }
          }}
          size="md"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader>Make all students inactive</ModalHeader>
                <ModalBody className="space-y-3">
                  <p className="text-base font-semibold text-campus-text-primary">
                    This affects every account whose role is currently set to student.
                  </p>
                  <p className="text-sm text-campus-text-secondary">
                    This action does not delete accounts. It only changes student account status to inactive and leaves admin, teacher, EC member, and other privileged accounts untouched.
                  </p>
                  <div className="rounded-2xl border bg-amber-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-amber-700">
                      Impact summary
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Chip color="warning" variant="flat">
                        {activeStudentAccounts} active student account{activeStudentAccounts === 1 ? "" : "s"}
                      </Chip>
                      <Chip variant="bordered">
                        {totalStudentAccounts} total student account{totalStudentAccounts === 1 ? "" : "s"}
                      </Chip>
                    </div>
                  </div>
                </ModalBody>
                <ModalFooter className="justify-between">
                  <Button
                    variant="bordered"
                    onPress={() => {
                      setShowDeactivateStudentsModal(false);
                      onClose();
                    }}
                    isDisabled={deactivatingStudents}
                  >
                    Cancel
                  </Button>
                  <Button
                    color="warning"
                    onPress={() => {
                      void confirmDeactivateAllStudents();
                    }}
                    isLoading={deactivatingStudents}
                    isDisabled={activeStudentAccounts === 0}
                  >
                    Make students inactive
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        <Modal
          isOpen={showDeleteDuplicateSchoolIdsModal}
          onOpenChange={(open) => {
            if (!open && !deletingDuplicateSchoolIds) {
              setShowDeleteDuplicateSchoolIdsModal(false);
            }
          }}
          size="lg"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader>Delete duplicate School IDs</ModalHeader>
                <ModalBody className="space-y-3">
                  <p className="text-base font-semibold text-campus-text-primary">
                    This cleanup targets duplicate student accounts only and keeps exactly one primary record per normalized School ID.
                  </p>
                  <p className="text-sm text-campus-text-secondary">
                    Extra duplicate student profiles, matching student projections, and matching Auth users are deleted. Admin, teacher, and EC member accounts are not part of this cleanup.
                  </p>
                  <div className="rounded-2xl border bg-rose-50 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-rose-700">
                      Cleanup summary
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Chip color="danger" variant="flat">
                        {duplicateCleanupCandidateCount} duplicate account
                        {duplicateCleanupCandidateCount === 1 ? "" : "s"} to delete
                      </Chip>
                      <Chip color="warning" variant="flat">
                        {duplicateGroupCount} duplicate School ID group
                        {duplicateGroupCount === 1 ? "" : "s"}
                      </Chip>
                      <Chip variant="bordered">
                        {duplicateGroupCount} primary record
                        {duplicateGroupCount === 1 ? "" : "s"} kept
                      </Chip>
                    </div>
                  </div>
                  {duplicateAuditReport?.duplicates?.length ? (
                    <div className="rounded-2xl border bg-[#faf7f3] px-4 py-3">
                      <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
                        Sample affected School IDs
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {duplicateAuditReport.duplicates.slice(0, 6).map((group) => (
                          <Chip key={group.schoolIdKey} variant="flat" color="warning">
                            {group.schoolId} ({group.cleanupCandidateCount})
                          </Chip>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </ModalBody>
                <ModalFooter className="justify-between">
                  <Button
                    variant="bordered"
                    onPress={() => {
                      setShowDeleteDuplicateSchoolIdsModal(false);
                      onClose();
                    }}
                    isDisabled={deletingDuplicateSchoolIds}
                  >
                    Cancel
                  </Button>
                  <Button
                    color="danger"
                    onPress={() => {
                      void confirmDeleteDuplicateSchoolIds();
                    }}
                    isLoading={deletingDuplicateSchoolIds}
                    isDisabled={duplicateCleanupCandidateCount === 0}
                  >
                    Delete duplicate accounts
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

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
                            pendingRoleChange.profile.uid}
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
                        savingRoleUid === pendingRoleChange.profile.uid,
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
                        {pendingDeleteProfile.schoolId || pendingDeleteProfile.uid}
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
                        deletingUid === pendingDeleteProfile.uid,
                    )}
                  >
                    Delete account
                  </Button>
                </ModalFooter>
              </>
            )}
          </ModalContent>
        </Modal>

        <Modal
          isOpen={Boolean(editingProfile)}
          onOpenChange={(open) => {
            if (!open && !savingProfileUid) setEditingProfile(null);
          }}
          size="lg"
        >
          <ModalContent>
            {(onClose) => (
              <>
                <ModalHeader>Edit profile</ModalHeader>
                <ModalBody className="space-y-4">
                  <Select
                    label="Role"
                    selectedKeys={[editProfileRole]}
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys as Set<React.Key>)[0];
                      if (typeof selected === "string") {
                        const nextRole = selected as Role;
                        setEditProfileRole(nextRole);
                        if (nextRole !== "ecmember") {
                          setEditProfileEcPosition("");
                          setEditProfileBodCourse("");
                        }
                      }
                    }}
                    disallowEmptySelection
                  >
                    {roleOptions.map((role) => (
                      <SelectItem key={role}>{formatRole(role)}</SelectItem>
                    ))}
                  </Select>
                  <Input
                    label="Name"
                    value={editProfileName}
                    onValueChange={setEditProfileName}
                    placeholder="Enter full name"
                    isRequired
                  />
                  <Input
                    label="School ID"
                    value={editProfileSchoolId}
                    onValueChange={setEditProfileSchoolId}
                    placeholder="Enter school ID"
                    isRequired
                  />
                  <Input
                    label="Email"
                    type="email"
                    value={editProfileEmail}
                    onValueChange={setEditProfileEmail}
                    placeholder="Enter email address"
                    autoComplete="email"
                    isRequired
                  />
                  <Select
                    label="Course"
                    selectedKeys={editProfileCourse ? [editProfileCourse] : []}
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys as Set<React.Key>)[0];
                      if (typeof selected === "string") {
                        setEditProfileCourse(selected);
                      }
                    }}
                    placeholder="Select course"
                    isRequired={
                      editProfileRole !== "teacher" &&
                      editProfileRole !== "admin"
                    }
                  >
                    {courseOptions.map((course) => (
                      <SelectItem key={course}>{course}</SelectItem>
                    ))}
                  </Select>
                  <Select
                    label="Year Level"
                    selectedKeys={
                      editProfileYearLevel ? [editProfileYearLevel] : []
                    }
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys as Set<React.Key>)[0];
                      if (typeof selected === "string") {
                        setEditProfileYearLevel(selected);
                      }
                    }}
                    placeholder="Select year level"
                    isRequired={
                      editProfileRole !== "teacher" &&
                      editProfileRole !== "admin"
                    }
                  >
                    {yearOptions.map((year) => (
                      <SelectItem key={year}>{year}</SelectItem>
                    ))}
                  </Select>
                  {editProfileRole === "ecmember" ? (
                    <>
                      <Select
                        label="EC Position"
                        selectedKeys={
                          editProfileEcPosition ? [editProfileEcPosition] : []
                        }
                        onSelectionChange={(keys) => {
                          const selected = Array.from(keys as Set<React.Key>)[0];
                          if (typeof selected === "string") {
                            const nextPosition = selected as ECPositionOption;
                            setEditProfileEcPosition(nextPosition);
                            if (nextPosition !== "B.O.D.") {
                              setEditProfileBodCourse("");
                            }
                          }
                        }}
                        placeholder="Select EC position"
                        isRequired
                      >
                        {EC_POSITION_OPTIONS.map((position) => (
                          <SelectItem key={position}>{position}</SelectItem>
                        ))}
                      </Select>
                      {editProfileEcPosition === "B.O.D." ? (
                        <Select
                          label="B.O.D. Course"
                          selectedKeys={
                            editProfileBodCourse ? [editProfileBodCourse] : []
                          }
                          onSelectionChange={(keys) => {
                            const selected = Array.from(keys as Set<React.Key>)[0];
                            if (typeof selected === "string") {
                              setEditProfileBodCourse(selected);
                            }
                          }}
                          placeholder="Select B.O.D. course"
                          isRequired
                        >
                          {CAMPUS_COURSE_CODE_OPTIONS.map((option) => (
                            <SelectItem key={option.code}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </Select>
                      ) : null}
                    </>
                  ) : null}
                </ModalBody>
                <ModalFooter className="justify-between">
                  <Button
                    variant="bordered"
                    onPress={() => {
                      setEditingProfile(null);
                      onClose();
                    }}
                    isDisabled={Boolean(savingProfileUid)}
                  >
                    Cancel
                  </Button>
                  <Button
                    className="bg-[#7b0000] font-semibold text-white"
                    onPress={() => {
                      void saveProfileChanges();
                    }}
                    isLoading={Boolean(
                      editingProfile &&
                        savingProfileUid === editingProfile.uid,
                    )}
                    isDisabled={Boolean(
                      editingProfile &&
                        savingProfileUid === editingProfile.uid,
                    )}
                  >
                    Save Changes
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
