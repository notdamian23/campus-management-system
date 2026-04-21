"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
  canAccessStudentPortal,
  resolveCampusProfileName,
} from "@/lib/campus-auth";
import { normalizeCampusRole } from "@/lib/campus-role";
import { normalizeCourse } from "@/lib/courseOptions";
import { getCourseScope, isBOD } from "@/lib/ec-permissions";
import { app, auth, db } from "@/lib/firebase";
import { formatStudentFullName } from "@/lib/student-name";

type LifecycleStatus = "upcoming" | "ongoing" | "completed";
export type StudentAccountStatus = "Active" | "Inactive";

export type StudentEventStatus =
  | "Upcoming"
  | "Payment Due"
  | "Pre-registration"
  | "Pre-registered"
  | "Waitlisted"
  | "Cancelled"
  | "Attended"
  | "Missed";

export type StudentRegistrationStatus =
  | "PRE_REGISTERED"
  | "WAITLISTED"
  | "CANCELLED";

export type StudentRegistrationRecord = {
  eventId: string;
  status: StudentRegistrationStatus;
  createdAtMs: number;
  updatedAtMs: number;
  registeredAtMs: number;
  waitlistedAtMs: number;
  cancelledAtMs: number;
};

export type StudentNotificationType =
  | "upcoming"
  | "payment"
  | "missed"
  | "preregister"
  | "announcement";

export type StudentProfile = {
  uid: string;
  schoolId: string;
  name: string;
  studentName: string;
  course: string;
  year: string;
  accountStatus: StudentAccountStatus;
  readyForClearance: boolean;
  campusRole: string;
  viewerIsBod: boolean;
  viewerCourseScope: string | null;
};

export type StudentPayment = {
  paymentId: string;
  title: string;
  ref: string;
  amount: number;
  date: string;
  details: string;
  status: "PAID" | "UNPAID";
  linkedEventId: string;
  source: "event" | "manual";
  createdAtMs: number;
  updatedAtMs: number;
};

export type StudentEventImageFile = {
  id: string;
  kind: "images";
  name: string;
  downloadURL: string;
  contentType: string;
  size: number;
  createdAtMs: number;
};

export type StudentEvent = {
  id: string;
  title: string;
  description: string;
  details: string;
  date: string;
  scheduledTime: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  course: string;
  yearLevel: string;
  isPreReg: boolean;
  withPayment: boolean;
  paymentRequired: boolean;
  lifecycle: LifecycleStatus;
  status: StudentEventStatus;
  eventDate: Date | null;
  attendanceStatus: string | null;
  registrationStatus: StudentRegistrationStatus | null;
  requiredPaymentId: string;
  linkedPaymentId: string;
  registrationStartAtMs: number;
  registrationEndAtMs: number;
  cancellationDeadlineAtMs: number;
  waitlistEnabled: boolean;
  preRegSlots: number | null;
  preRegCount: number;
  waitlistCount: number;
  preRegRemaining: number | null;
  imageFiles: StudentEventImageFile[];
  imageCount: number;
};

export type StudentNotification = {
  id: string;
  title: string;
  description: string;
  type: StudentNotificationType;
  date: Date;
  displayDate: string;
};

type StudentPortalContextValue = {
  profile: StudentProfile | null;
  events: StudentEvent[];
  payments: StudentPayment[];
  notifications: StudentNotification[];
  readNotificationIds: string[];
  unreadNotificationsCount: number;
  registeredEventIds: string[];
  registrationsByEvent: Record<string, StudentRegistrationRecord>;
  loading: boolean;
  loadingProfile: boolean;
  loadingEvents: boolean;
  loadingPayments: boolean;
  error: string | null;
  markNotificationRead: (notificationId: string) => void;
  markAllNotificationsRead: () => void;
  registerForEvent: (eventId: string) => Promise<{ ok: boolean; msg: string }>;
  cancelEventRegistration: (
    eventId: string,
  ) => Promise<{ ok: boolean; msg: string }>;
};

type RawEventDoc = {
  id: string;
  title: string;
  date: string;
  scheduledTime: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  yearLevel: string;
  course: string;
  yearLevels: string[];
  courses: string[];
  targetStudent: string;
  details: string;
  isPreReg: boolean;
  withPayment: boolean;
  paymentRequired: boolean;
  waitlistEnabled: boolean;
  requiredPaymentId: string;
  linkedPaymentId: string;
  registrationStartAtMs: number;
  registrationEndAtMs: number;
  cancellationDeadlineAtMs: number;
  preRegSlots: number | null;
  preRegCount: number;
  waitlistCount: number;
  preRegRemaining: number | null;
};

type PaymentDocData = {
  title?: string;
  ref?: string;
  amount?: number | string;
  date?: string;
  details?: string;
  linkedEventId?: string;
  source?: string;
  status?: string;
};

type PaymentAssignmentData = {
  uid?: string;
  status?: string;
  createdAt?: { toMillis?: () => number };
  updatedAt?: { toMillis?: () => number };
};

type ProfileNotificationDocData = {
  title?: string;
  message?: string;
  date?: string;
  scheduledTime?: string;
  type?: string;
  createdAt?: { toMillis?: () => number };
};

type ProfileNotificationDoc = {
  id: string;
  title: string;
  message: string;
  date: string;
  scheduledTime: string;
  type: StudentNotificationType;
  createdAt?: { toMillis?: () => number };
};

type AttendanceDocData = {
  status?: string;
  attendanceStatus?: string;
};

type RegistrationDocData = {
  status?: string;
  createdAt?: { toMillis?: () => number };
  updatedAt?: { toMillis?: () => number };
  registeredAt?: { toMillis?: () => number };
  waitlistedAt?: { toMillis?: () => number };
  cancelledAt?: { toMillis?: () => number };
};

type EventImageDocData = {
  name?: string;
  downloadURL?: string;
  contentType?: string;
  size?: number;
  createdAt?: unknown;
};

type ManagePreRegistrationResult = {
  status?: StudentRegistrationStatus;
  message?: string;
  preRegCount?: number;
  waitlistCount?: number;
};

type ProfileDocData = {
  role?: string;
  isStudent?: boolean;
  schoolId?: string;
  schoolIdKey?: string;
  studentId?: string;
  firstName?: string;
  lastName?: string;
  studentName?: string;
  name?: string;
  fullName?: string;
  displayName?: string;
  course?: string;
  year?: string;
  yearLevel?: string;
  status?: string;
  readyForClearance?: boolean;
};

type StudentProjectionDocData = {
  status?: string;
  schoolId?: string;
  schoolIdKey?: string;
  studentId?: string;
  firstName?: string;
  lastName?: string;
  studentName?: string;
  name?: string;
  fullName?: string;
  course?: string;
  year?: string;
  yearLevel?: string;
  readyForClearance?: boolean;
};

const StudentPortalContext = createContext<StudentPortalContextValue | null>(
  null,
);

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

function normalizeText(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function getLinkedPaymentId(raw: {
  linkedPaymentId?: string;
  requiredPaymentId?: string;
} | null | undefined) {
  return String(raw?.linkedPaymentId ?? raw?.requiredPaymentId ?? "").trim();
}

function normalizeYear(raw: unknown) {
  const value = String(raw ?? "").trim();
  const lowered = value.toLowerCase();

  if (!value) return "Unassigned";
  if (value === "1" || lowered === "1st year") return "1st Year";
  if (value === "2" || lowered === "2nd year") return "2nd Year";
  if (value === "3" || lowered === "3rd year") return "3rd Year";
  if (value === "4" || lowered === "4th year") return "4th Year";
  if (value === "5" || lowered === "5th year") return "5th Year";

  return value;
}

function normalizeStudentAccountStatus(raw: unknown): StudentAccountStatus {
  return normalizeText(raw) === "inactive" ? "Inactive" : "Active";
}

function normalizeReadyForClearance(raw: unknown) {
  return raw === true;
}

function parseDateOnly(input: string): Date | null {
  const value = String(input ?? "").trim();
  if (!value) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseTime12ToMinutes(timeValue: string): number | null {
  const value = String(timeValue ?? "").trim();
  if (!value) return null;

  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;

  return hour * 60 + minute;
}

function toDateWithMinutes(baseDate: Date, minutes: number) {
  const date = new Date(baseDate);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function computeLifecycle(
  date: string,
  scheduledTime: string,
  timeEnd: string,
) {
  const baseDate = parseDateOnly(date);
  if (!baseDate) return "upcoming" as LifecycleStatus;

  const now = new Date();
  const startMin = parseTime12ToMinutes(scheduledTime);
  const endMin = parseTime12ToMinutes(timeEnd);

  if (startMin == null) {
    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(baseDate);
    end.setHours(23, 59, 59, 999);

    if (now < start) return "upcoming";
    if (now > end) return "completed";
    return "ongoing";
  }

  const start = toDateWithMinutes(baseDate, startMin);
  if (endMin == null) {
    if (now < start) return "upcoming";
    return "completed";
  }

  const safeEndMin = endMin >= startMin ? endMin : startMin + 60;
  const end = toDateWithMinutes(baseDate, safeEndMin);

  if (now < start) return "upcoming";
  if (now > end) return "completed";
  return "ongoing";
}

function toEventDate(date: string, scheduledTime: string) {
  const baseDate = parseDateOnly(date);
  if (!baseDate) return null;

  const startMin = parseTime12ToMinutes(scheduledTime);
  if (startMin == null) return baseDate;

  return toDateWithMinutes(baseDate, startMin);
}

function formatDateTime(d: Date) {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toMillis(value: unknown) {
  if (typeof value === "object" && value !== null) {
    const maybe = value as { toMillis?: () => number };
    if (typeof maybe.toMillis === "function") {
      return maybe.toMillis();
    }
  }
  return 0;
}

function parseRegistrationStatus(
  raw: unknown,
): StudentRegistrationStatus {
  const normalized = String(raw ?? "").trim().toUpperCase();
  if (normalized === "WAITLISTED") return "WAITLISTED";
  if (normalized === "CANCELLED") return "CANCELLED";
  return "PRE_REGISTERED";
}

function toTargetList(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  }

  const eventTarget = String(value ?? "").trim();
  if (!eventTarget) return [];

  return eventTarget
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesTarget(
  eventValue: unknown,
  studentValue: string,
  allLabel: string,
) {
  const eventTargets = toTargetList(eventValue);
  const studentTarget = String(studentValue ?? "").trim();
  const normalizedStudentCourse = normalizeCourse(studentTarget);

  if (eventTargets.length === 0) return true;
  if (
    eventTargets.some((item) => normalizeText(item) === normalizeText(allLabel))
  ) {
    return true;
  }
  return eventTargets.some((item) => {
    const normalizedItem = String(item ?? "").trim();
    const normalizedEventCourse = normalizeCourse(normalizedItem);
    return (
      normalizeText(normalizedItem) === normalizeText(studentTarget) ||
      (
        Boolean(normalizedEventCourse) &&
        Boolean(normalizedStudentCourse) &&
        normalizedEventCourse === normalizedStudentCourse
      )
    );
  });
}

function matchesSpecificStudentTarget(
  targetValue: string,
  schoolId: string,
  studentName: string,
) {
  const rawTarget = String(targetValue ?? "").trim();
  if (!rawTarget) return true;
  const sid = normalizeText(schoolId);
  const name = normalizeText(studentName);
  if (!sid && !name) return false;

  const parts = rawTarget
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts.length ? parts : [rawTarget]) {
    const normalized = normalizeText(part);
    const withoutParens = normalizeText(part.replace(/\([^)]*\)/g, " ").trim());
    const parenMatch = part.match(/\(([^)]+)\)/);
    const insideParen = normalizeText(parenMatch?.[1] ?? "");

    if (normalized === sid || normalized === name) return true;
    if (insideParen && insideParen === sid) return true;
    if (
      withoutParens &&
      (withoutParens === name ||
        name.includes(withoutParens) ||
        withoutParens.includes(name))
    )
      return true;

    if (sid && normalized.includes(sid)) return true;
    if (name && normalized.includes(name)) return true;

    if (normalized.length >= 3) {
      if (sid && sid.includes(normalized)) return true;
      if (name && name.includes(normalized)) return true;
    }
  }

  return false;
}

export function StudentPortalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [rawEvents, setRawEvents] = useState<RawEventDoc[]>([]);
  const [payments, setPayments] = useState<StudentPayment[]>([]);
  const [profileNotifications, setProfileNotifications] = useState<
    ProfileNotificationDoc[]
  >([]);
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>([]);
  const [attendanceByEvent, setAttendanceByEvent] = useState<
    Record<string, string | null>
  >({});
  const [registeredEventIds, setRegisteredEventIds] = useState<string[]>([]);
  const [registrationsByEvent, setRegistrationsByEvent] = useState<
    Record<string, StudentRegistrationRecord>
  >({});
  const [eventImagesByEvent, setEventImagesByEvent] = useState<
    Record<string, StudentEventImageFile[]>
  >({});

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingEventImages, setLoadingEventImages] = useState(true);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [loadingProfileNotifications, setLoadingProfileNotifications] =
    useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unsubscribeProfileDoc: (() => void) | null = null;
    let unsubscribeStudentDoc: (() => void) | null = null;
    let latestProfileData: ProfileDocData | null = null;
    let latestStudentData: StudentProjectionDocData | null = null;
    let hasProfileSnapshot = false;

    const stopProfileListeners = () => {
      unsubscribeProfileDoc?.();
      unsubscribeProfileDoc = null;
      unsubscribeStudentDoc?.();
      unsubscribeStudentDoc = null;
      latestProfileData = null;
      latestStudentData = null;
      hasProfileSnapshot = false;
    };

    const syncProfileState = (uid: string) => {
      if (!hasProfileSnapshot) return;

      if (!latestProfileData) {
        setProfile(null);
        setLoadingProfile(false);
        return;
      }

      if (!canAccessStudentPortal(latestProfileData)) {
        setProfile(null);
        setError("Student access is not enabled for this account.");
        setLoadingProfile(false);
        return;
      }

      const schoolId = String(
        latestProfileData.schoolId ??
          latestProfileData.schoolIdKey ??
          latestStudentData?.schoolId ??
          latestStudentData?.schoolIdKey ??
          latestProfileData.studentId ??
          latestStudentData?.studentId ??
          "",
      ).trim();
      if (!schoolId) {
        setProfile(null);
        setError("Student profile not linked");
        setLoadingProfile(false);
        return;
      }
      const name = formatStudentFullName(
        {
          firstName:
            latestProfileData.firstName ?? latestStudentData?.firstName,
          lastName:
            latestProfileData.lastName ?? latestStudentData?.lastName,
          name:
            resolveCampusProfileName(latestProfileData) ||
            latestStudentData?.name,
          fullName:
            latestProfileData.fullName ?? latestStudentData?.fullName,
          studentName:
            latestStudentData?.studentName ?? latestProfileData.studentName,
          schoolId,
        },
        schoolId,
      );
      const studentName = name || schoolId;
      const normalizedCourse =
        normalizeCourse(
          String(
            latestProfileData.course ?? latestStudentData?.course ?? "",
          ).trim(),
        ) ||
        String(
          latestProfileData.course ?? latestStudentData?.course ?? "",
        ).trim() ||
        "Unassigned";
      const campusRole = normalizeCampusRole(latestProfileData.role) || "";
      const viewerIsBod = isBOD(latestProfileData);
      const viewerCourseScope = getCourseScope(latestProfileData);

      setProfile({
        uid,
        schoolId,
        name,
        studentName,
        course: normalizedCourse,
        year: normalizeYear(
          latestProfileData.year ??
            latestProfileData.yearLevel ??
            latestStudentData?.year ??
            latestStudentData?.yearLevel,
        ),
        accountStatus: normalizeStudentAccountStatus(
          latestStudentData?.status ?? latestProfileData.status,
        ),
        readyForClearance: normalizeReadyForClearance(
          latestStudentData?.readyForClearance ??
            latestProfileData.readyForClearance,
        ),
        campusRole,
        viewerIsBod,
        viewerCourseScope,
      });
      setError(null);
      setLoadingProfile(false);
    };

    const unsub = onAuthStateChanged(auth, (user) => {
      stopProfileListeners();
      setLoadingProfile(true);

      if (!user) {
        setProfile(null);
        setLoadingProfile(false);
        return;
      }

      unsubscribeProfileDoc = onSnapshot(
        doc(db, "profiles", user.uid),
        (profileSnap) => {
          hasProfileSnapshot = true;
          latestProfileData = profileSnap.exists()
            ? (profileSnap.data() as ProfileDocData)
            : null;
          syncProfileState(user.uid);
        },
        (e) => {
          latestProfileData = null;
          hasProfileSnapshot = true;
          setProfile(null);
          setError(toErrorMessage(e, "Failed to load student profile."));
          setLoadingProfile(false);
        },
      );

      unsubscribeStudentDoc = onSnapshot(
        doc(db, "students", user.uid),
        (studentSnap) => {
          latestStudentData = studentSnap.exists()
            ? (studentSnap.data() as StudentProjectionDocData)
            : null;
          syncProfileState(user.uid);
        },
        (e) => {
          latestStudentData = null;
          syncProfileState(user.uid);
          setError(toErrorMessage(e, "Failed to load student status details."));
        },
      );
    });

    return () => {
      stopProfileListeners();
      unsub();
    };
  }, []);

  useEffect(() => {
    if (!profile) {
      setRawEvents([]);
      setLoadingEvents(false);
      return;
    }

    const viewerIsBod = profile.viewerIsBod === true;
    const viewerCourseScope =
      normalizeCourse(profile.viewerCourseScope ?? "") || null;

    if (viewerIsBod && !viewerCourseScope) {
      setRawEvents([]);
      setLoadingEvents(false);
      return;
    }

    setLoadingEvents(true);

    const mapEventRows = (
      docs: Array<{
        id: string;
        data: () => Partial<RawEventDoc> & {
          yearLevels?: unknown;
          courses?: unknown;
          paymentRequired?: unknown;
          linkedPaymentId?: unknown;
        };
      }>,
    ) =>
      docs
        .map((d) => {
          const data = d.data();
          const yearLevels = toTargetList(data.yearLevels);
          const courses = toTargetList(data.courses);
          const linkedPaymentId = getLinkedPaymentId({
            linkedPaymentId: String(
              (data as { linkedPaymentId?: unknown }).linkedPaymentId ?? "",
            ).trim(),
            requiredPaymentId: String(data.requiredPaymentId ?? "").trim(),
          });
          const paymentRequired =
            data.paymentRequired === true ||
            data.withPayment === true ||
            linkedPaymentId.length > 0;
          return {
            id: d.id,
            title: String(data.title ?? "Untitled Event"),
            date: String(data.date ?? ""),
            scheduledTime: String(data.scheduledTime ?? data.timeStart ?? ""),
            timeStart: String(data.timeStart ?? ""),
            timeEnd: String(data.timeEnd ?? ""),
            location: String(data.location ?? ""),
            yearLevel:
              String(data.yearLevel ?? "").trim() ||
              (yearLevels.length > 0 ? yearLevels.join(", ") : "All Years"),
            course:
              String(data.course ?? "").trim() ||
              (courses.length > 0 ? courses.join(", ") : "All Courses"),
            yearLevels,
            courses,
            targetStudent: String(data.targetStudent ?? ""),
            details: String(data.details ?? ""),
            isPreReg: data.isPreReg === true,
            withPayment: paymentRequired,
            paymentRequired,
            waitlistEnabled: data.waitlistEnabled === true,
            requiredPaymentId: linkedPaymentId,
            linkedPaymentId,
            registrationStartAtMs: toMillis(
              (data as { registrationStartAt?: unknown }).registrationStartAt,
            ),
            registrationEndAtMs: toMillis(
              (data as { registrationEndAt?: unknown }).registrationEndAt,
            ),
            cancellationDeadlineAtMs: toMillis(
              (data as { cancellationDeadlineAt?: unknown })
                .cancellationDeadlineAt,
            ),
            preRegSlots:
              typeof data.preRegSlots === "number"
                ? Math.max(0, Math.trunc(data.preRegSlots))
                : null,
            preRegCount: Math.max(0, Number(data.preRegCount ?? 0)),
            waitlistCount: Math.max(0, Number(data.waitlistCount ?? 0)),
            preRegRemaining:
              typeof data.preRegRemaining === "number"
                ? Math.max(0, Math.trunc(data.preRegRemaining))
                : null,
          };
        })
        .filter((event) => {
          const courseMatch = matchesTarget(
            event.courses.length > 0 ? event.courses : event.course,
            profile.course,
            "All Courses",
          );
          const yearMatch = matchesTarget(
            event.yearLevels.length > 0 ? event.yearLevels : event.yearLevel,
            profile.year,
            "All Years",
          );
          const studentMatch = matchesSpecificStudentTarget(
            event.targetStudent,
            profile.schoolId,
            profile.studentName,
          );
          return courseMatch && yearMatch && studentMatch;
        });

    const handleEventLoadError = (
      error: unknown,
      queryName: "all" | "ec" | "scoped-course",
    ) => {
      console.error("[STUDENT][EVENTS]", {
        queryName,
        campusRole: profile.campusRole,
        viewerIsBod,
        viewerCourseScope,
        error,
      });
      setRawEvents([]);
      setLoadingEvents(false);
      setError(toErrorMessage(error, "Failed to load events."));
    };

    if (viewerIsBod && viewerCourseScope) {
      const ecRows = new Map<string, RawEventDoc>();
      const scopedRows = new Map<string, RawEventDoc>();

      const syncScopedRows = () => {
        const merged = new Map<string, RawEventDoc>();
        Array.from(ecRows.values()).forEach((event) => merged.set(event.id, event));
        Array.from(scopedRows.values()).forEach((event) =>
          merged.set(event.id, event),
        );
        setRawEvents(Array.from(merged.values()));
        setError(null);
        setLoadingEvents(false);
      };

      const unsubEc = onSnapshot(
        query(collection(db, "events"), where("ownerType", "==", "ec")),
        (snap) => {
          ecRows.clear();
          mapEventRows(snap.docs).forEach((event) => ecRows.set(event.id, event));
          syncScopedRows();
        },
        (e) => handleEventLoadError(e, "ec"),
      );

      const unsubScoped = onSnapshot(
        query(collection(db, "events"), where("courseScope", "==", viewerCourseScope)),
        (snap) => {
          scopedRows.clear();
          mapEventRows(snap.docs).forEach((event) =>
            scopedRows.set(event.id, event),
          );
          syncScopedRows();
        },
        (e) => handleEventLoadError(e, "scoped-course"),
      );

      return () => {
        unsubEc();
        unsubScoped();
      };
    }

    const unsub = onSnapshot(
      query(collection(db, "events"), orderBy("createdAt", "desc")),
      (snap) => {
        setRawEvents(mapEventRows(snap.docs));
        setError(null);
        setLoadingEvents(false);
      },
      (e) => handleEventLoadError(e, "all"),
    );

    return () => unsub();
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setEventImagesByEvent({});
      setLoadingEventImages(false);
      return;
    }

    const eventIds = rawEvents.map((event) => event.id).filter(Boolean);
    if (eventIds.length === 0) {
      setEventImagesByEvent({});
      setLoadingEventImages(false);
      return;
    }

    setLoadingEventImages(true);
    const imageBuckets = new Map<string, StudentEventImageFile[]>();
    const ready = new Set<string>();

    const syncImages = () => {
      setEventImagesByEvent(Object.fromEntries(imageBuckets));
      setLoadingEventImages(ready.size !== eventIds.length);
    };

    const toImageRows = (
      eventId: string,
      snap: {
        docs: Array<{
          id: string;
          data: () => EventImageDocData;
        }>;
      },
    ) =>
      snap.docs
        .map((imageDoc) => {
          const data = imageDoc.data() as EventImageDocData;

          return {
            id: imageDoc.id,
            kind: "images" as const,
            name:
              String(data.name ?? "Untitled image").trim() || "Untitled image",
            downloadURL: String(data.downloadURL ?? "").trim(),
            contentType: String(data.contentType ?? "").trim(),
            size: Number(data.size ?? 0),
            createdAtMs: toMillis(data.createdAt),
          } satisfies StudentEventImageFile;
        })
        .sort((left, right) => right.createdAtMs - left.createdAtMs);

    const unsubs = eventIds.map((eventId) =>
      onSnapshot(
        query(
          collection(db, "events", eventId, "images"),
          orderBy("createdAt", "desc"),
        ),
        (snap) => {
          imageBuckets.set(eventId, toImageRows(eventId, snap));
          ready.add(eventId);
          syncImages();
        },
        (e) => {
          imageBuckets.set(eventId, []);
          ready.add(eventId);
          syncImages();
          setError(toErrorMessage(e, "Failed to load event images."));
        },
      ),
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [profile, rawEvents]);

  useEffect(() => {
    if (!profile) {
      setPayments([]);
      setLoadingPayments(false);
      return;
    }
    const uid = profile.uid;

    setLoadingPayments(true);
    let active = true;

    const qy = query(
      collectionGroup(db, "students"),
      where("uid", "==", uid),
    );

    const unsub = onSnapshot(
      qy,
      async (snap) => {
        try {
          const rows = await Promise.all(
            snap.docs.map(async (assignmentDoc) => {
              const paymentRef = assignmentDoc.ref.parent.parent;
              if (!paymentRef) {
                return null;
              }
              const paymentSnap = await getDoc(paymentRef);
              if (!paymentSnap.exists()) {
                return null;
              }

              const paymentData = paymentSnap.data() as PaymentDocData;
              if (normalizeText(paymentData.status) === "archived") {
                return null;
              }

              const assignment = assignmentDoc.data() as PaymentAssignmentData;
              const status =
                normalizeText(assignment.status) === "paid" ? "PAID" : "UNPAID";

              const createdAtMs = assignment.createdAt?.toMillis
                ? assignment.createdAt.toMillis()
                : 0;
              const updatedAtMs = assignment.updatedAt?.toMillis
                ? assignment.updatedAt.toMillis()
                : createdAtMs;

              return {
                paymentId: paymentRef.id,
                title: String(paymentData.title ?? "Untitled Payment"),
                ref: String(paymentData.ref ?? paymentRef.id),
                amount: Number(paymentData.amount ?? 0),
                date: String(paymentData.date ?? ""),
                details: String(paymentData.details ?? ""),
                status,
                linkedEventId: String(paymentData.linkedEventId ?? "").trim(),
                source:
                  normalizeText(paymentData.source) === "event" ? "event" : "manual",
                createdAtMs,
                updatedAtMs,
              } as StudentPayment;
            }),
          );

          if (!active) return;

          const cleaned = rows
            .filter((item): item is StudentPayment => Boolean(item))
            .sort((a, b) => {
              const da = parseDateOnly(a.date)?.getTime() ?? 0;
              const dbv = parseDateOnly(b.date)?.getTime() ?? 0;
              return dbv - da;
            });
          setPayments(cleaned);
          setError(null);
        } catch (e: unknown) {
          if (!active) return;
          setPayments([]);
          setError(toErrorMessage(e, "Failed to load student payments."));
        } finally {
          if (active) setLoadingPayments(false);
        }
      },
      (e) => {
        if (!active) return;
        setPayments([]);
        setLoadingPayments(false);
        setError(toErrorMessage(e, "Failed to load student payments."));
      },
    );

    return () => {
      active = false;
      unsub();
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setProfileNotifications([]);
      setLoadingProfileNotifications(false);
      return;
    }

    setLoadingProfileNotifications(true);
    const qy = query(
      collection(db, "profiles", profile.uid, "notifications"),
      orderBy("createdAt", "desc"),
    );

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const rows: ProfileNotificationDoc[] = snap.docs.map((d) => {
          const data = d.data() as ProfileNotificationDocData;
          const rawType = normalizeText(data.type);
          const type: StudentNotificationType =
            rawType === "announcement"
              ? "announcement"
              : rawType === "payment"
                ? "payment"
                : rawType === "missed"
                  ? "missed"
                  : rawType === "preregister"
                    ? "preregister"
                    : "upcoming";

          return {
            id: d.id,
            title: String(data.title ?? "Notification"),
            message: String(data.message ?? ""),
            date: String(data.date ?? ""),
            scheduledTime: String(data.scheduledTime ?? ""),
            type,
            createdAt: data.createdAt,
          };
        });

        setProfileNotifications(rows);
        setError(null);
        setLoadingProfileNotifications(false);
      },
      (e) => {
        setProfileNotifications([]);
        setLoadingProfileNotifications(false);
        setError(toErrorMessage(e, "Failed to load notifications."));
      },
    );

    return () => unsub();
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setAttendanceByEvent({});
      return;
    }
    const uid = profile.uid;

    if (rawEvents.length === 0) {
      setAttendanceByEvent({});
      return;
    }

    let active = true;

    async function loadAttendance() {
      try {
        const entries = await Promise.all(
          rawEvents.map(async (ev) => {
            const snap = await getDoc(
              doc(db, "events", ev.id, "attendance", uid),
            );

            if (!snap.exists()) {
              return [ev.id, null] as const;
            }

            const data = snap.data() as AttendanceDocData;
            const raw = String(
              data.status ?? data.attendanceStatus ?? "",
            ).toLowerCase();
            return [ev.id, raw || null] as const;
          }),
        );

        if (!active) return;
        setAttendanceByEvent(Object.fromEntries(entries));
      } catch (e: unknown) {
        if (!active) return;
        setAttendanceByEvent({});
        setError(toErrorMessage(e, "Failed to load attendance records."));
      }
    }

    void loadAttendance();

    return () => {
      active = false;
    };
  }, [profile, rawEvents]);

  useEffect(() => {
    if (!profile) {
      setRegisteredEventIds([]);
      setRegistrationsByEvent({});
      return;
    }
    const uid = profile.uid;

    if (rawEvents.length === 0) {
      setRegisteredEventIds([]);
      setRegistrationsByEvent({});
      return;
    }

    let active = true;

    async function loadRegistrations() {
      try {
        const entries = await Promise.all(
          rawEvents.map(async (ev) => {
            const snap = await getDoc(
              doc(db, "events", ev.id, "registrations", uid),
            );
            if (!snap.exists()) {
              return [ev.id, null] as const;
            }

            const data = snap.data() as RegistrationDocData;
            return [
              ev.id,
              {
                eventId: ev.id,
                status: parseRegistrationStatus(data.status),
                createdAtMs: toMillis(data.createdAt),
                updatedAtMs: toMillis(data.updatedAt),
                registeredAtMs: toMillis(data.registeredAt),
                waitlistedAtMs: toMillis(data.waitlistedAt),
                cancelledAtMs: toMillis(data.cancelledAt),
              } as StudentRegistrationRecord,
            ] as const;
          }),
        );

        if (!active) return;
        const nextRegistrations = Object.fromEntries(
          entries.filter(
            (
              entry,
            ): entry is readonly [string, StudentRegistrationRecord] =>
              Boolean(entry[1]),
          ),
        );
        setRegistrationsByEvent(nextRegistrations);
        setRegisteredEventIds(
          Object.values(nextRegistrations)
            .filter(
              (registration) => registration.status !== "CANCELLED",
            )
            .map((registration) => registration.eventId),
        );
      } catch {
        if (!active) return;
        setRegisteredEventIds([]);
        setRegistrationsByEvent({});
      }
    }

    void loadRegistrations();

    return () => {
      active = false;
    };
  }, [profile, rawEvents]);

  const events = useMemo(() => {
    const paymentById = new Map<string, StudentPayment>();
    payments.forEach((p) => {
      const key = normalizeText(p.paymentId);
      if (!key) return;
      if (!paymentById.has(key)) {
        paymentById.set(key, p);
      }
    });

    return rawEvents
      .map((raw) => {
        const scheduledTime = raw.scheduledTime || raw.timeStart;
        const eventDate = toEventDate(raw.date, scheduledTime);
        const lifecycle = computeLifecycle(
          raw.date,
          scheduledTime,
          raw.timeEnd,
        );
        const attendanceRaw = normalizeText(attendanceByEvent[raw.id] ?? "");
        const registration = registrationsByEvent[raw.id] ?? null;
        const linkedPaymentId = getLinkedPaymentId(raw)
          ? getLinkedPaymentId(raw)
          : "";
        const paymentMatch = linkedPaymentId
          ? paymentById.get(normalizeText(linkedPaymentId))
          : null;
        const paymentRequired = raw.paymentRequired || raw.withPayment;
        const paymentOutstanding =
          paymentRequired &&
          (!paymentMatch || paymentMatch.status === "UNPAID");

        let status: StudentEventStatus = "Upcoming";

        if (attendanceRaw === "present" || attendanceRaw === "attended") {
          status = "Attended";
        } else if (registration?.status === "CANCELLED") {
          status = "Cancelled";
        } else if (paymentOutstanding) {
          status = "Payment Due";
        } else if (lifecycle === "completed") {
          if (registration?.status === "WAITLISTED") {
            status = "Waitlisted";
          } else if (raw.isPreReg && registration?.status === "PRE_REGISTERED") {
            status = "Missed";
          } else if (!raw.isPreReg) {
            status = "Missed";
          } else {
            status = "Upcoming";
          }
        } else if (registration?.status === "PRE_REGISTERED") {
          status = "Pre-registered";
        } else if (registration?.status === "WAITLISTED") {
          status = "Waitlisted";
        } else if (raw.isPreReg) {
          status = "Pre-registration";
        } else {
          status = "Upcoming";
        }

        return {
          id: raw.id,
          title: raw.title,
          description: raw.details || "No description provided.",
          details: raw.details || "",
          date: raw.date,
          scheduledTime: scheduledTime || "TBA",
          timeStart: raw.timeStart || scheduledTime || "",
          timeEnd: raw.timeEnd || "",
          location: raw.location || "TBA",
          course: raw.course || "All Courses",
          yearLevel: raw.yearLevel || "All Years",
          isPreReg: raw.isPreReg,
          withPayment: raw.withPayment,
          paymentRequired,
          lifecycle,
          status,
          eventDate,
          attendanceStatus: attendanceRaw || null,
          registrationStatus: registration?.status ?? null,
          requiredPaymentId: linkedPaymentId,
          linkedPaymentId,
          registrationStartAtMs: raw.registrationStartAtMs,
          registrationEndAtMs: raw.registrationEndAtMs,
          cancellationDeadlineAtMs: raw.cancellationDeadlineAtMs,
          waitlistEnabled: raw.waitlistEnabled,
          preRegSlots: raw.preRegSlots,
          preRegCount: raw.preRegCount,
          waitlistCount: raw.waitlistCount,
          preRegRemaining: raw.preRegRemaining,
          imageFiles: eventImagesByEvent[raw.id] ?? [],
          imageCount: (eventImagesByEvent[raw.id] ?? []).length,
        } as StudentEvent;
      })
      .sort((a, b) => {
        const aMs = a.eventDate?.getTime() ?? 0;
        const bMs = b.eventDate?.getTime() ?? 0;
        return aMs - bMs;
      });
  }, [
    attendanceByEvent,
    eventImagesByEvent,
    payments,
    rawEvents,
    registrationsByEvent,
  ]);

  const notifications = useMemo(() => {
    const items: StudentNotification[] = [];
    const dedupe = new Set<string>();

    const pushItem = (
      key: string,
      item: Omit<StudentNotification, "displayDate">,
    ) => {
      if (dedupe.has(key)) return;
      dedupe.add(key);
      items.push({
        ...item,
        displayDate: formatDateTime(item.date),
      });
    };

    profileNotifications.forEach((note) => {
      const scheduledDate = toEventDate(note.date, note.scheduledTime);
      const createdAtMs = toMillis(note.createdAt);
      const when =
        scheduledDate ?? (createdAtMs ? new Date(createdAtMs) : new Date());

      pushItem(`profile-notification:${note.id}`, {
        id: `profile-notification:${note.id}`,
        title: note.title || "Notification",
        description: note.message || "No message provided.",
        type: note.type,
        date: when,
      });
    });

    events.forEach((ev) => {
      const date = ev.eventDate ?? new Date();

      if (ev.status === "Upcoming") {
        pushItem(`event-upcoming:${ev.id}`, {
          id: `event-upcoming:${ev.id}`,
          title: `Upcoming: ${ev.title}`,
          description: ev.description,
          type: "upcoming",
          date,
        });
      } else if (ev.status === "Pre-registration") {
        pushItem(`event-prereg:${ev.id}`, {
          id: `event-prereg:${ev.id}`,
          title: `Pre-Register: ${ev.title}`,
          description: ev.description,
          type: "preregister",
          date,
        });
      } else if (ev.status === "Payment Due") {
        pushItem(
          `payment:${normalizeText(ev.linkedPaymentId || ev.requiredPaymentId || ev.title)}`,
          {
          id: `event-payment:${ev.id}`,
          title: `Payment Due: ${ev.title}`,
          description: ev.description,
          type: "payment",
          date,
        },
        );
      } else if (ev.status === "Missed") {
        pushItem(`event-missed:${ev.id}`, {
          id: `event-missed:${ev.id}`,
          title: `Missed Event: ${ev.title}`,
          description: ev.description,
          type: "missed",
          date,
        });
      }
    });

    payments.forEach((payment) => {
      if (payment.status !== "UNPAID") return;

      const paymentDate = parseDateOnly(payment.date) ?? new Date();
      pushItem(`payment:${normalizeText(payment.paymentId)}`, {
        id: `payment:${payment.paymentId}`,
        title: `Payment Due: ${payment.title}`,
        description: `Reference ${payment.ref} | Amount ${payment.amount.toFixed(
          2,
        )}`,
        type: "payment",
        date: paymentDate,
      });
    });

    return items.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [profileNotifications, events, payments]);

  const notificationReadStorageKey = useMemo(
    () =>
      profile?.uid ? `campus_student_read_notifications:${profile.uid}` : "",
    [profile?.uid],
  );

  useEffect(() => {
    if (!notificationReadStorageKey) {
      setReadNotificationIds([]);
      return;
    }

    try {
      const raw = window.localStorage.getItem(notificationReadStorageKey);
      if (!raw) {
        setReadNotificationIds([]);
        return;
      }

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setReadNotificationIds([]);
        return;
      }

      const normalized = Array.from(
        new Set(
          parsed
            .map((item) => String(item ?? "").trim())
            .filter((item) => item.length > 0),
        ),
      );
      setReadNotificationIds(normalized);
    } catch {
      setReadNotificationIds([]);
    }
  }, [notificationReadStorageKey]);

  useEffect(() => {
    if (!notificationReadStorageKey) return;

    try {
      window.localStorage.setItem(
        notificationReadStorageKey,
        JSON.stringify(readNotificationIds),
      );
    } catch {
      // Ignore storage quota/private mode errors.
    }
  }, [notificationReadStorageKey, readNotificationIds]);

  useEffect(() => {
    if (notifications.length === 0) return;

    const validIds = new Set(notifications.map((item) => item.id));
    setReadNotificationIds((prev) => {
      const next = prev.filter((id) => validIds.has(id));
      return next.length === prev.length ? prev : next;
    });
  }, [notifications]);

  const readNotificationSet = useMemo(
    () => new Set(readNotificationIds),
    [readNotificationIds],
  );

  const unreadNotificationsCount = useMemo(
    () =>
      notifications.reduce(
        (total, item) => total + (readNotificationSet.has(item.id) ? 0 : 1),
        0,
      ),
    [notifications, readNotificationSet],
  );

  const markNotificationRead = useCallback((notificationId: string) => {
    const normalized = String(notificationId ?? "").trim();
    if (!normalized) return;

    setReadNotificationIds((prev) =>
      prev.includes(normalized) ? prev : [...prev, normalized],
    );
  }, []);

  const markAllNotificationsRead = useCallback(() => {
    if (notifications.length === 0) return;

    setReadNotificationIds((prev) => {
      const next = new Set(prev);
      notifications.forEach((item) => {
        if (item.id) next.add(item.id);
      });
      const merged = Array.from(next);
      return merged.length === prev.length ? prev : merged;
    });
  }, [notifications]);

  const managePreRegistration = useMemo(
    () =>
      httpsCallable<
        { eventId: string; action: "register" | "cancel" },
        ManagePreRegistrationResult
      >(functions, "studentManagePreRegistration"),
    [functions],
  );

  const applyRegistrationResult = useCallback(
    (eventId: string, nextStatus: StudentRegistrationStatus) => {
      const nowMs = Date.now();

      setRegistrationsByEvent((prev) => {
        const existing = prev[eventId];
        return {
          ...prev,
          [eventId]: {
            eventId,
            status: nextStatus,
            createdAtMs: existing?.createdAtMs ?? nowMs,
            updatedAtMs: nowMs,
            registeredAtMs:
              nextStatus === "PRE_REGISTERED"
                ? nowMs
                : (existing?.registeredAtMs ?? 0),
            waitlistedAtMs:
              nextStatus === "WAITLISTED"
                ? nowMs
                : (existing?.waitlistedAtMs ?? 0),
            cancelledAtMs:
              nextStatus === "CANCELLED"
                ? nowMs
                : (existing?.cancelledAtMs ?? 0),
          },
        };
      });

      setRegisteredEventIds((prev) => {
        if (nextStatus === "CANCELLED") {
          return prev.filter((id) => id !== eventId);
        }
        return prev.includes(eventId) ? prev : [...prev, eventId];
      });
    },
    [],
  );

  const registerForEvent = useCallback(
    async (eventId: string) => {
      if (!profile?.uid) {
        return { ok: false, msg: "You need to be logged in first." };
      }

      if (profile.accountStatus === "Inactive") {
        return {
          ok: false,
          msg: "Approach ec member to make account active.",
        };
      }

      try {
        const result = await managePreRegistration({
          eventId,
          action: "register",
        });
        const nextStatus = result.data?.status;
        if (
          nextStatus !== "PRE_REGISTERED" &&
          nextStatus !== "WAITLISTED" &&
          nextStatus !== "CANCELLED"
        ) {
          throw new Error("Registration status was not returned by the server.");
        }

        applyRegistrationResult(eventId, nextStatus);

        return {
          ok: true,
          msg: result.data?.message || "Registration updated successfully.",
        };
      } catch (e: unknown) {
        return {
          ok: false,
          msg: toErrorMessage(e, "Failed to register for this event."),
        };
      }
    },
    [applyRegistrationResult, managePreRegistration, profile],
  );

  const cancelEventRegistration = useCallback(
    async (eventId: string) => {
      if (!profile?.uid) {
        return { ok: false, msg: "You need to be logged in first." };
      }

      try {
        const result = await managePreRegistration({
          eventId,
          action: "cancel",
        });
        applyRegistrationResult(eventId, "CANCELLED");

        return {
          ok: true,
          msg:
            result.data?.message || "Your event registration was cancelled.",
        };
      } catch (e: unknown) {
        return {
          ok: false,
          msg: toErrorMessage(e, "Failed to cancel this event registration."),
        };
      }
    },
    [applyRegistrationResult, managePreRegistration, profile],
  );

  const loading =
    loadingProfile ||
    loadingEvents ||
    loadingEventImages ||
    loadingPayments ||
    loadingProfileNotifications;

  const value = useMemo<StudentPortalContextValue>(
    () => ({
      profile,
      events,
      payments,
      notifications,
      readNotificationIds,
      unreadNotificationsCount,
      registeredEventIds,
      registrationsByEvent,
      loading,
      loadingProfile,
      loadingEvents,
      loadingPayments,
      error,
      markNotificationRead,
      markAllNotificationsRead,
      registerForEvent,
      cancelEventRegistration,
    }),
    [
      profile,
      events,
      payments,
      notifications,
      readNotificationIds,
      unreadNotificationsCount,
      registeredEventIds,
      registrationsByEvent,
      loading,
      loadingProfile,
      loadingEvents,
      loadingPayments,
      error,
      markNotificationRead,
      markAllNotificationsRead,
      registerForEvent,
      cancelEventRegistration,
    ],
  );

  return (
    <StudentPortalContext.Provider value={value}>
      {children}
    </StudentPortalContext.Provider>
  );
}

export function useStudentPortal() {
  const ctx = useContext(StudentPortalContext);
  if (!ctx) {
    throw new Error(
      "useStudentPortal must be used within StudentPortalProvider.",
    );
  }
  return ctx;
}
