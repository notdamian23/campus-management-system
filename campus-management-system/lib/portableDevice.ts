import {
  isEcWorkspaceRole,
  normalizeCampusRole,
} from "@/lib/campus-role";

export const PORTABLE_DEVICE_COLLECTIONS = {
  devices: "devices",
  devicePairings: "devicePairings",
  enrollmentSessions: "enrollmentSessions",
  students: "students",
  enrollmentQueue: "enrollmentQueue",
  syncLogs: "syncLogs",
  events: "events",
  attendance: "attendance",
} as const;

export type PortableDeviceEnrollmentStatus =
  | "pending"
  | "assigned"
  | "enrolled"
  | "cancelled";

export type PortableDeviceSyncStatus = "uploaded" | "duplicate" | "failed";

export type PortableDeviceEnrollmentSessionStatus =
  | "pending"
  | "paired"
  | "downloading"
  | "enrolling"
  | "completed"
  | "partially-completed"
  | "closed";

export type PortableDeviceEnrollmentStudentStatus =
  | "pending"
  | "downloaded"
  | "enrolled"
  | "synced"
  | "failed";

export type PortableDeviceEventSummary = {
  eventId: string;
  title: string;
  date: string;
  scheduledTime: string;
  location: string;
  status: string;
};

export type PortableDeviceRosterStudent = {
  studentId: string;
  studentUid: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  fingerprintTemplateId: number;
  fingerprintStatus: string;
  fingerprintDeviceId: string;
  queueId?: string;
};

export type PortableDevicePairingDoc = {
  deviceId: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  eventScheduledTime: string;
  eventLocation: string;
  status: "paired" | "unpaired";
  source: "portable-device";
  rosterCount?: number;
  attendanceCount?: number;
  pairedAt?: unknown;
  updatedAt?: unknown;
  lastContextRefreshAt?: unknown;
  lastAttendanceSyncAt?: unknown;
  lastEnrollmentSyncAt?: unknown;
};

export type PortableDeviceStudentDoc = {
  uid: string;
  studentId: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  fingerprintTemplateId: number;
  fingerprintStatus: "pending" | "enrolled";
  fingerprintDeviceId: string;
  fingerprintEnrolledAt?: unknown;
  queueId?: string;
  updatedAt?: unknown;
};

export type PortableDeviceEnrollmentQueueDoc = {
  queueId?: string;
  eventId?: string;
  studentId: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  status: PortableDeviceEnrollmentStatus;
  assignedDeviceId?: string;
  fingerprintTemplateId?: number;
  fingerprintDeviceId?: string;
  requestedAt?: unknown;
  enrolledAt?: unknown;
  updatedAt?: unknown;
};

export type PortableDeviceAttendanceDoc = {
  eventId: string;
  eventTitle?: string;
  studentId: string;
  uid: string;
  studentUid: string;
  schoolId: string;
  studentName: string;
  course: string;
  yearLevel: string;
  year: string;
  timestamp: unknown;
  recordedAt: unknown;
  recordedByDevice: boolean;
  recordedByDeviceId: string;
  deviceId: string;
  syncedAt: unknown;
  syncStatus: "synced";
  fingerprintTemplateId: number;
  templateId: number;
  source: "portable-device";
  deviceRecordId: string;
  deviceTimestampEpoch: number;
  deviceTimestampIso: string;
  timeSource: string;
  status: "Present";
  createdAt: unknown;
  updatedAt: unknown;
};

export type PortableDeviceSyncLogDoc = {
  recordId: string;
  eventId?: string;
  studentId?: string;
  schoolId?: string;
  studentName?: string;
  deviceId: string;
  syncStatus: PortableDeviceSyncStatus;
  message: string;
  attemptedAt: unknown;
  processedAt: unknown;
  source: "portable-device";
};

export type PortableDeviceEnrollmentSessionDoc = {
  sessionId: string;
  createdBy: string;
  createdByName?: string;
  createdBySchoolId?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  status: PortableDeviceEnrollmentSessionStatus;
  pairedDeviceId?: string;
  targetDeviceId?: string;
  totalStudents: number;
  pendingCount: number;
  downloadedCount: number;
  enrolledCount: number;
  syncedCount: number;
  failedCount: number;
  selectedStudentIds?: string[];
  closedAt?: unknown;
  lastDownloadedAt?: unknown;
  lastEnrollmentSyncAt?: unknown;
  completedAt?: unknown;
};

export type PortableDeviceEnrollmentSessionStudentDoc = {
  enrollmentSessionId: string;
  studentId: string;
  studentUid?: string;
  schoolId: string;
  fullName: string;
  course: string;
  yearLevel: string;
  status: PortableDeviceEnrollmentStudentStatus;
  syncStatus: "pending" | "synced" | "failed";
  fingerprintTemplateId?: number;
  enrolledAt?: unknown;
  downloadedAt?: unknown;
  syncedAt?: unknown;
  enrolledByDevice?: string;
  assignedDeviceId?: string;
  remarks?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type PortableDeviceSessionResponse = {
  sessionToken: string;
  expiresAtMs: number;
  authMode: "bearer";
  device: {
    deviceId: string;
    label: string;
  };
  pairing: {
    eventId: string;
    eventTitle: string;
    status: string;
  } | null;
};

export function isEngineeringCouncilRole(role: unknown): boolean {
  const normalizedRole = normalizeCampusRole(role);
  return normalizedRole === "admin" || isEcWorkspaceRole(role);
}

export function normalizePortableYearLevel(value: unknown): string {
  const raw = String(value ?? "").trim();
  const lower = raw.toLowerCase();
  if (!raw) return "";
  if (lower === "1" || lower === "1st year") return "1st Year";
  if (lower === "2" || lower === "2nd year") return "2nd Year";
  if (lower === "3" || lower === "3rd year") return "3rd Year";
  if (lower === "4" || lower === "4th year") return "4th Year";
  if (lower === "5" || lower === "5th year") return "5th Year";
  return raw;
}

export function portableAttendancePath(eventId: string, studentId: string) {
  return [
    PORTABLE_DEVICE_COLLECTIONS.events,
    eventId,
    PORTABLE_DEVICE_COLLECTIONS.attendance,
    studentId,
  ] as const;
}

export function portableEnrollmentSessionStudentsPath(sessionId: string) {
  return [
    PORTABLE_DEVICE_COLLECTIONS.enrollmentSessions,
    sessionId,
    PORTABLE_DEVICE_COLLECTIONS.students,
  ] as const;
}

export function createEnrollmentQueueDraft(
  input: Omit<PortableDeviceEnrollmentQueueDoc, "status">,
): PortableDeviceEnrollmentQueueDoc {
  return {
    ...input,
    yearLevel: normalizePortableYearLevel(input.yearLevel),
    status: "pending",
  };
}

export function normalizePortableEnrollmentSessionStatus(
  value: unknown,
): PortableDeviceEnrollmentSessionStatus {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "paired") return "paired";
  if (raw === "downloading") return "downloading";
  if (raw === "enrolling") return "enrolling";
  if (raw === "completed") return "completed";
  if (raw === "partially-completed" || raw === "partially completed") {
    return "partially-completed";
  }
  if (raw === "closed") return "closed";
  return "pending";
}

export function normalizePortableEnrollmentStudentStatus(
  value: unknown,
): PortableDeviceEnrollmentStudentStatus {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "downloaded") return "downloaded";
  if (raw === "enrolled") return "enrolled";
  if (raw === "synced") return "synced";
  if (raw === "failed") return "failed";
  return "pending";
}
