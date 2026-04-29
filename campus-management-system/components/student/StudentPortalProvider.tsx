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
import {
  resolveEventLifecycle,
  type EventLifecycle,
  type EventLifecycleDetails,
  type EventScheduleDateInput,
} from "@/lib/eventSchedule";
import { listStudentPayments } from "@/lib/firebase-functions";
import { app, auth, db } from "@/lib/firebase";
import { formatStudentFullName } from "@/lib/student-name";

export type StudentEventLifecycle = EventLifecycle;
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
  date: Date | string | null;
  scheduledTime: string;
  timeStart: string;
  timeEnd: string;
  location: string;
  course: string;
  yearLevel: string;
  isPreReg: boolean;
  withPayment: boolean;
  paymentRequired: boolean;
  lifecycle: StudentEventLifecycle;
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
  date: EventScheduleDateInput;
  scheduledTime: string;
  timeStart: string;
  timeEnd: string;
  startAt: EventScheduleDateInput;
  endAt: EventScheduleDateInput;
  storedStatus: string;
  cancelled: boolean;
  location: string;
  yearLevel: string;
  course: string;
  yearLevels: string[];
  courses: string[];
  targetStudent: string;
  selectedStudentIds: string[];
  selectedSchoolIds: string[];
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

type StudentLoaderName =
  | "profile listener"
  | "students/{uid} projection listener"
  | "events listener"
  | "event images listener"
  | "payments loader"
  | "profile notifications listener"
  | "attendance loader"
  | "registrations loader";

type StudentLoaderDebugSource = {
  uid?: string;
  role?: string;
  campusRole?: string;
  course?: string;
  year?: string;
  yearLevel?: string;
  isStudent?: boolean;
  viewerIsBod?: boolean;
};

const StudentPortalContext = createContext<StudentPortalContextValue | null>(
  null,
);

const STUDENT_LOADER_DEBUG = process.env.NODE_ENV !== "production";

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

function toLoaderErrorCode(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { code?: unknown };
    if (typeof maybe.code === "string" && maybe.code.trim()) {
      return maybe.code;
    }
  }

  return "";
}

function toLoaderErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { message?: unknown };
    if (typeof maybe.message === "string" && maybe.message.trim()) {
      return maybe.message;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "";
}

function logStudentLoaderDebug(
  loader: StudentLoaderName,
  source?: StudentLoaderDebugSource | null,
  options?: {
    phase?: "start" | "success" | "error";
    error?: unknown;
    extra?: Record<string, unknown>;
  },
) {
  if (!STUDENT_LOADER_DEBUG) {
    return;
  }

  const phase = options?.phase ?? "start";
  const role = String(source?.campusRole ?? source?.role ?? "").trim();
  const course = String(source?.course ?? "").trim();
  const year = String(source?.year ?? source?.yearLevel ?? "").trim();
  const payload = {
    loader,
    phase,
    uid: String(source?.uid ?? "").trim(),
    role,
    course,
    year,
    isStudent:
      source?.isStudent === true || normalizeCampusRole(role) === "student",
    isBod: source?.viewerIsBod === true,
    errorCode: toLoaderErrorCode(options?.error),
    errorMessage: toLoaderErrorMessage(options?.error),
    ...(options?.extra ?? {}),
  };

  if (phase === "error") {
    console.warn("[STUDENT][LOADER]", payload);
    return;
  }

  console.info("[STUDENT][LOADER]", payload);
}

function logStudentEventLifecycleDebug(
  event: Pick<
    RawEventDoc,
    "id" | "title" | "date" | "scheduledTime" | "timeStart" | "timeEnd" | "storedStatus"
  >,
  resolution: EventLifecycleDetails,
) {
  if (!STUDENT_LOADER_DEBUG) {
    return;
  }

  console.info("[STUDENT][EVENT_LIFECYCLE]", {
    eventId: event.id,
    title: event.title,
    rawDate: event.date,
    rawScheduledTime: event.scheduledTime,
    rawTimeStart: event.timeStart,
    rawTimeEnd: event.timeEnd,
    parsedStartDateTime: formatLifecycleDebugDateTime(resolution.startAt),
    parsedEndDateTime: formatLifecycleDebugDateTime(resolution.endAt),
    now: formatDateTime(resolution.now),
    computedLifecycle: resolution.lifecycle,
    storedStatus: event.storedStatus || null,
    statusFallbackUsed: resolution.statusFallbackUsed,
  });
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

function formatDateTime(d: Date) {
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLifecycleDebugDateTime(value: Date | null) {
  return value ? formatDateTime(value) : null;
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

function matchesEventAudience(event: RawEventDoc, profile: StudentProfile) {
  const selectedStudentIds = event.selectedStudentIds.map(normalizeText);
  const selectedSchoolIds = event.selectedSchoolIds.map(normalizeText);
  const hasSelectedAudience =
    selectedStudentIds.length > 0 || selectedSchoolIds.length > 0;
  const selectedMatch =
    selectedStudentIds.includes(normalizeText(profile.uid)) ||
    selectedSchoolIds.includes(normalizeText(profile.schoolId));
  const courseValue = event.courses.length > 0 ? event.courses : event.course;
  const yearValue = event.yearLevels.length > 0 ? event.yearLevels : event.yearLevel;
  const hasCourseYearAudience =
    event.courses.length > 0 ||
    event.yearLevels.length > 0 ||
    toTargetList(event.course).some(
      (value) => normalizeText(value) !== "all courses",
    ) ||
    toTargetList(event.yearLevel).some((value) => {
      const normalized = normalizeText(normalizeYear(value));
      return normalized && normalized !== "all years" && normalized !== "unassigned";
    });

  if (selectedMatch) {
    return true;
  }

  if (hasSelectedAudience && !hasCourseYearAudience) {
    return false;
  }

  const courseMatch = matchesTarget(courseValue, profile.course, "All Courses");
  const yearMatch = matchesTarget(yearValue, profile.year, "All Years");
  const studentMatch = hasSelectedAudience
    ? true
    : matchesSpecificStudentTarget(
        event.targetStudent,
        profile.schoolId,
        profile.studentName,
      );

  return courseMatch && yearMatch && studentMatch;
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
  const [lifecycleNowMs, setLifecycleNowMs] = useState(() => Date.now());

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingEventImages, setLoadingEventImages] = useState(true);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [loadingProfileNotifications, setLoadingProfileNotifications] =
    useState(true);
  const [portalError, setPortalError] = useState<string | null>(null);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setLifecycleNowMs(Date.now());
    }, 30_000);

    return () => window.clearInterval(intervalId);
  }, []);

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
        setPortalError("Student profile not found.");
        setLoadingProfile(false);
        return;
      }

      if (!canAccessStudentPortal(latestProfileData)) {
        setProfile(null);
        setPortalError("Student access is not enabled for this account.");
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
        setPortalError("Student profile not linked");
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
      setPortalError(null);
      setLoadingProfile(false);
    };

    const unsub = onAuthStateChanged(auth, (user) => {
      stopProfileListeners();
      setLoadingProfile(true);
      setPortalError(null);

      if (!user) {
        setProfile(null);
        setLoadingProfile(false);
        return;
      }

      logStudentLoaderDebug(
        "profile listener",
        { uid: user.uid },
        { phase: "start" },
      );
      logStudentLoaderDebug(
        "students/{uid} projection listener",
        { uid: user.uid },
        { phase: "start" },
      );

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
          setPortalError(toErrorMessage(e, "Failed to load student profile."));
          setLoadingProfile(false);
          logStudentLoaderDebug(
            "profile listener",
            { uid: user.uid },
            { phase: "error", error: e },
          );
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
          logStudentLoaderDebug(
            "students/{uid} projection listener",
            {
              uid: user.uid,
              role: latestProfileData?.role,
              course: String(latestProfileData?.course ?? "").trim(),
              year: String(
                latestProfileData?.year ?? latestProfileData?.yearLevel ?? "",
              ).trim(),
              isStudent: latestProfileData?.isStudent === true,
              viewerIsBod: isBOD(latestProfileData ?? {}),
            },
            { phase: "error", error: e },
          );
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

    logStudentLoaderDebug("events listener", profile, { phase: "start" });
    setLoadingEvents(true);

    const mapEventRows = (
      docs: Array<{
        id: string;
        data: () => Partial<RawEventDoc> & {
          yearLevels?: unknown;
          courses?: unknown;
          selectedStudentIds?: unknown;
          selectedSchoolIds?: unknown;
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
          const rawDate =
            (data as { date?: EventScheduleDateInput }).date ?? null;

          return {
            id: d.id,
            title: String(data.title ?? "Untitled Event"),
            date: rawDate,
            scheduledTime: String(data.scheduledTime ?? data.timeStart ?? ""),
            timeStart: String(data.timeStart ?? ""),
            timeEnd: String(data.timeEnd ?? ""),
            startAt:
              (data as { startAt?: EventScheduleDateInput }).startAt ?? null,
            endAt:
              (data as { endAt?: EventScheduleDateInput }).endAt ?? null,
            storedStatus: String(
              (data as { status?: unknown }).status ?? "",
            ).trim(),
            cancelled: data.cancelled === true,
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
            selectedStudentIds: toTargetList(data.selectedStudentIds),
            selectedSchoolIds: toTargetList(data.selectedSchoolIds),
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
        .filter((event) => matchesEventAudience(event, profile));

    const handleEventLoadError = (
      error: unknown,
      queryName: "all" | "ec" | "scoped-course",
    ) => {
      logStudentLoaderDebug("events listener", profile, {
        phase: "error",
        error,
        extra: {
          queryName,
          viewerCourseScope,
        },
      });
      setRawEvents([]);
      setLoadingEvents(false);
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

    logStudentLoaderDebug("event images listener", profile, {
      phase: "start",
      extra: { eventCount: eventIds.length },
    });
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
          logStudentLoaderDebug("event images listener", profile, {
            phase: "error",
            error: e,
            extra: { eventId },
          });
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

    const authCurrentUserUid = String(auth.currentUser?.uid ?? "").trim();
    const profileUid = profile.uid;
    logStudentLoaderDebug("payments loader", profile, {
      phase: "start",
      extra: {
        authCurrentUserUid,
        profileUid,
        authMatchesProfileUid: !authCurrentUserUid || authCurrentUserUid === profileUid,
      },
    });
    setLoadingPayments(true);
    let active = true;

    async function loadPayments() {
      try {
        const rows = await listStudentPayments();
        if (!active) return;

        const cleaned: StudentPayment[] = rows
          .map((row) => ({
            paymentId: row.paymentId,
            title: row.title,
            ref: row.ref,
            amount: Number(row.amount ?? 0),
            date: String(row.date ?? ""),
            details: String(row.details ?? ""),
            status: row.status === "PAID" ? "PAID" : "UNPAID",
            linkedEventId: String(row.linkedEventId ?? "").trim(),
            source: row.source === "event" ? "event" : "manual",
            createdAtMs: Number(row.createdAtMs ?? 0),
            updatedAtMs: Number(row.updatedAtMs ?? 0),
          }) satisfies StudentPayment)
          .sort((a, b) => {
            const da = parseDateOnly(a.date)?.getTime() ?? 0;
            const dbv = parseDateOnly(b.date)?.getTime() ?? 0;
            if (dbv !== da) {
              return dbv - da;
            }

            return (b.updatedAtMs || b.createdAtMs) -
              (a.updatedAtMs || a.createdAtMs);
          });
        setPayments(cleaned);
        logStudentLoaderDebug("payments loader", profile, {
          phase: "success",
          extra: {
            authCurrentUserUid: String(auth.currentUser?.uid ?? "").trim(),
            profileUid,
            authMatchesProfileUid:
              !auth.currentUser?.uid || auth.currentUser.uid === profileUid,
            paymentCount: cleaned.length,
            paymentIds: cleaned.map((payment) => payment.paymentId),
          },
        });
      } catch (e: unknown) {
        if (!active) return;
        setPayments([]);
        logStudentLoaderDebug("payments loader", profile, {
          phase: "error",
          error: e,
          extra: {
            authCurrentUserUid: String(auth.currentUser?.uid ?? "").trim(),
            profileUid,
            authMatchesProfileUid:
              !auth.currentUser?.uid || auth.currentUser.uid === profileUid,
          },
        });
      } finally {
        if (active) setLoadingPayments(false);
      }
    }

    void loadPayments();

    return () => {
      active = false;
    };
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setProfileNotifications([]);
      setLoadingProfileNotifications(false);
      return;
    }

    logStudentLoaderDebug("profile notifications listener", profile, {
      phase: "start",
    });
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
        setLoadingProfileNotifications(false);
      },
      (e) => {
        setProfileNotifications([]);
        setLoadingProfileNotifications(false);
        logStudentLoaderDebug("profile notifications listener", profile, {
          phase: "error",
          error: e,
        });
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

    logStudentLoaderDebug("attendance loader", profile, {
      phase: "start",
      extra: { eventCount: rawEvents.length },
    });
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
        logStudentLoaderDebug("attendance loader", profile, {
          phase: "error",
          error: e,
          extra: { eventCount: rawEvents.length },
        });
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

    logStudentLoaderDebug("registrations loader", profile, {
      phase: "start",
      extra: { eventCount: rawEvents.length },
    });
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
      } catch (e: unknown) {
        if (!active) return;
        setRegisteredEventIds([]);
        setRegistrationsByEvent({});
        logStudentLoaderDebug("registrations loader", profile, {
          phase: "error",
          error: e,
          extra: { eventCount: rawEvents.length },
        });
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

    const now = new Date(lifecycleNowMs);

    return rawEvents
      .map((raw) => {
        const scheduledTime = raw.scheduledTime || raw.timeStart;
        const lifecycleDetails = resolveEventLifecycle(
          {
            date: raw.date,
            scheduledTime: raw.scheduledTime,
            timeStart: raw.timeStart,
            timeEnd: raw.timeEnd,
            startAt: raw.startAt,
            endAt: raw.endAt,
            status: raw.storedStatus,
            cancelled: raw.cancelled,
          },
          now,
        );
        const eventDate = lifecycleDetails.startAt;
        const lifecycle = lifecycleDetails.lifecycle;

        logStudentEventLifecycleDebug(raw, lifecycleDetails);

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

        if (lifecycle === "cancelled") {
          status = "Cancelled";
        } else if (attendanceRaw === "present" || attendanceRaw === "attended") {
          status = "Attended";
        } else if (registration?.status === "CANCELLED") {
          status = "Cancelled";
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
        } else if (paymentOutstanding) {
          status = "Payment Due";
        } else {
          status = "Upcoming";
        }

        return {
          id: raw.id,
          title: raw.title,
          description: raw.details || "No description provided.",
          details: raw.details || "",
          date: eventDate ?? (typeof raw.date === "string" ? raw.date : null),
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
    lifecycleNowMs,
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
      const scheduledDate = resolveEventLifecycle({
        date: note.date,
        scheduledTime: note.scheduledTime,
      }).startAt;
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

      if (ev.status === "Cancelled" || ev.lifecycle === "cancelled") {
        return;
      }

      if (ev.status === "Upcoming" && ev.lifecycle === "upcoming") {
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
      error: portalError,
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
      portalError,
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
