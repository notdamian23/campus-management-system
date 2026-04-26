"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import {
  type CampusProfileDoc,
  getOnboardingRedirect,
  resolveCampusProfileName,
} from "@/lib/campus-auth";
import {
  resolveEventLifecycle,
  type EventScheduleDateInput,
} from "@/lib/eventSchedule";
import { formatStudentFullName } from "@/lib/student-name";

export type TeacherAccessState =
  | "loading"
  | "authorized"
  | "unauthenticated"
  | "forbidden"
  | "must-change-password"
  | "verification-pending";

export type TeacherProfile = {
  uid: string;
  schoolId: string;
  name: string;
  teacherName: string;
  email: string;
};

type TeacherEventDoc = {
  title?: string;
  location?: string;
  date?: string;
  scheduledTime?: string;
  timeStart?: string;
  timeEnd?: string;
  yearLevel?: string;
  course?: string;
  yearLevels?: unknown;
  courses?: unknown;
  targetStudent?: string;
  selectedStudentIds?: unknown;
  selectedSchoolIds?: unknown;
  details?: string;
  isPreReg?: boolean;
  withPayment?: boolean;
  paymentRequired?: boolean;
  preRegSlots?: number | null;
  preRegCount?: number;
  attendanceCount?: number;
  presentCount?: number;
  absentCount?: number;
  status?: string;
  cancelled?: boolean;
  startAt?: EventScheduleDateInput;
  endAt?: EventScheduleDateInput;
  imageCount?: number;
  documentCount?: number;
  createdAt?: unknown;
  createdBy?: string | null;
};

type TeacherAttendanceDoc = {
  uid?: string;
  studentUid?: string;
  schoolId?: string;
  studentName?: string;
  name?: string;
  course?: string;
  year?: string;
  status?: string;
  attendanceStatus?: string;
  present?: boolean;
  timeIn?: unknown;
  timeInIso?: string;
  timeOut?: unknown;
  timeOutIso?: string;
  timestamp?: unknown;
  deviceTimestampIso?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

type TeacherFileDoc = {
  name?: string;
  path?: string;
  downloadURL?: string;
  contentType?: string;
  size?: number;
  createdAt?: unknown;
};

export type TeacherLifecycle =
  | "upcoming"
  | "ongoing"
  | "completed"
  | "cancelled";

export type TeacherEvent = {
  id: string;
  title: string;
  location: string;
  date: string;
  scheduledTime: string;
  timeEnd: string;
  details: string;
  course: string;
  courses: string[];
  yearLevel: string;
  yearLevels: string[];
  targetStudent: string;
  selectedStudentIds: string[];
  selectedSchoolIds: string[];
  isPreReg: boolean;
  withPayment: boolean;
  paymentRequired: boolean;
  preRegSlots: number | null;
  preRegCount: number;
  lifecycle: TeacherLifecycle;
  eventDate: Date | null;
  createdAtMs: number;
  createdBy: string | null;
  registrationCount: number;
  attendanceCount: number;
  presentCount: number;
  absentCount: number;
  imageCount: number;
  documentCount: number;
};

export type TeacherAttendanceStatus =
  | "Present"
  | "Timed In"
  | "Absent"
  | "Recorded";

export type TeacherAttendance = {
  id: string;
  eventId: string;
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  status: TeacherAttendanceStatus;
  timeInMs: number;
  timeOutMs: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type TeacherFileKind = "docs" | "images";

export type TeacherFile = {
  id: string;
  eventId: string;
  kind: TeacherFileKind;
  name: string;
  path: string;
  downloadURL: string;
  contentType: string;
  size: number;
  createdAtMs: number;
};

export type TeacherStudent = {
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  trackedEventIds: string[];
  attendanceRecords: Array<{
    eventId: string;
    status: TeacherAttendanceStatus;
    timeInMs: number;
    timeOutMs: number;
    updatedAtMs: number;
  }>;
  presentCount: number;
  absentCount: number;
  recordedCount: number;
  lastActivityMs: number;
};

type TeacherPortalContextValue = {
  accessState: TeacherAccessState;
  profile: TeacherProfile | null;
  events: TeacherEvent[];
  attendance: TeacherAttendance[];
  files: TeacherFile[];
  students: TeacherStudent[];
  loading: boolean;
  loadingEvents: boolean;
  loadingActivity: boolean;
  loadingFiles: boolean;
  error: string | null;
};

type ProfileDocData = CampusProfileDoc;

const TeacherPortalContext = createContext<TeacherPortalContextValue | null>(
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

function toMillis(value: unknown) {
  if (typeof value === "object" && value !== null) {
    const maybe = value as { toMillis?: () => number; seconds?: number };
    if (typeof maybe.toMillis === "function") {
      return maybe.toMillis();
    }
    if (typeof maybe.seconds === "number") {
      return maybe.seconds * 1000;
    }
  }

  const parsed = new Date(value as string | number | Date).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

function toNonNegativeNumber(value: unknown) {
  const numericValue = Number(value ?? 0);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.trunc(numericValue)
    : 0;
}

function normalizeTeacherLifecycleStatus(rawStatus: unknown) {
  const normalized = normalizeText(rawStatus);

  if (normalized === "cancelled") {
    return "cancelled" as const;
  }

  if (
    normalized === "completed" ||
    normalized === "closed" ||
    normalized === "archived"
  ) {
    return "completed" as const;
  }

  if (
    normalized === "ongoing" ||
    normalized === "active" ||
    normalized === "live" ||
    normalized === "in progress"
  ) {
    return "ongoing" as const;
  }

  if (
    normalized === "upcoming" ||
    normalized === "scheduled" ||
    normalized === "pending"
  ) {
    return "upcoming" as const;
  }

  return null;
}

function normalizeLifecycleTimeInput(rawTime: unknown) {
  const value = String(rawTime ?? "").trim();
  const normalized = value.toLowerCase().replace(/\./g, "");

  if (
    !value ||
    normalized === "tba" ||
    normalized === "time tba" ||
    normalized === "tbd" ||
    normalized === "time tbd"
  ) {
    return "";
  }

  return value;
}

function normalizeAttendanceStatus(
  rawStatus: unknown,
  rawPresent: unknown,
): TeacherAttendanceStatus {
  const normalized = normalizeText(rawStatus);
  if (normalized === "present" || normalized === "attended") return "Present";
  if (normalized === "timed in" || normalized === "time-in") return "Timed In";
  if (normalized === "absent" || normalized === "missed") return "Absent";
  if (typeof rawPresent === "boolean") {
    return rawPresent ? "Present" : "Absent";
  }
  return "Recorded";
}

export function TeacherPortalProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const shouldLoadPortalActivity = pathname !== "/teacher/events";
  const [accessState, setAccessState] = useState<TeacherAccessState>("loading");
  const [profile, setProfile] = useState<TeacherProfile | null>(null);

  const [rawEvents, setRawEvents] = useState<
    Array<{ id: string; data: TeacherEventDoc }>
  >([]);
  const [attendance, setAttendance] = useState<TeacherAttendance[]>([]);
  const [files, setFiles] = useState<TeacherFile[]>([]);

  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAccessState("loading");
      setError(null);

      if (!user) {
        setProfile(null);
        setAccessState("unauthenticated");
        return;
      }

      try {
        const snap = await getDoc(doc(db, "profiles", user.uid));
        if (!snap.exists()) {
          setProfile(null);
          setAccessState("forbidden");
          return;
        }

        const data = snap.data() as ProfileDocData;
        const onboardingRedirect = getOnboardingRedirect(data);
        if (onboardingRedirect === "/change-password") {
          setProfile(null);
          setAccessState("must-change-password");
          return;
        }
        if (onboardingRedirect === "/verify-email-pending") {
          setProfile(null);
          setAccessState("verification-pending");
          return;
        }

        if (data.role !== "teacher") {
          setProfile(null);
          setAccessState("forbidden");
          return;
        }

        const schoolId = String(data.schoolId ?? "").trim() || user.uid;
        const name = resolveCampusProfileName(data) || "";
        const teacherName = name || schoolId;

        setProfile({
          uid: user.uid,
          schoolId,
          name,
          teacherName,
          email: String(data.email ?? "").trim() || user.email || "",
        });
        setAccessState("authorized");
      } catch (nextError: unknown) {
        setProfile(null);
        setAccessState("forbidden");
        setError(toErrorMessage(nextError, "Failed to load teacher profile."));
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (accessState !== "authorized") {
      setRawEvents([]);
      setLoadingEvents(accessState === "loading");
      return;
    }

    setLoadingEvents(true);

    const qy = query(collection(db, "events"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        setRawEvents(
          snap.docs.map((eventDoc) => ({
            id: eventDoc.id,
            data: eventDoc.data() as TeacherEventDoc,
          })),
        );
        setLoadingEvents(false);
      },
      (nextError) => {
        setRawEvents([]);
        setLoadingEvents(false);
        setError(toErrorMessage(nextError, "Failed to load events."));
      },
    );

    return () => unsub();
  }, [accessState]);

  useEffect(() => {
    if (accessState !== "authorized" || !shouldLoadPortalActivity) {
      setAttendance([]);
      setLoadingActivity(accessState === "loading" && shouldLoadPortalActivity);
      return;
    }

    const eventIds = rawEvents.map((event) => event.id).filter(Boolean);
    if (eventIds.length === 0) {
      setAttendance([]);
      setLoadingActivity(false);
      return;
    }

    setLoadingActivity(true);
    const attendanceByEvent = new Map<string, TeacherAttendance[]>();
    const ready = new Set<string>();

    const syncAttendance = () => {
      setAttendance(Array.from(attendanceByEvent.values()).flat());
      setLoadingActivity(ready.size !== eventIds.length);
    };

    const unsubs = eventIds.map((eventId) =>
      onSnapshot(
        collection(db, "events", eventId, "attendance"),
        (snap) => {
          const rows: TeacherAttendance[] = snap.docs
            .map((attendanceDoc) => {
              const data = attendanceDoc.data() as TeacherAttendanceDoc;
              const uid = String(
                data.uid ?? data.studentUid ?? attendanceDoc.id,
              ).trim();
              if (!uid) return null;

              const schoolId = String(data.schoolId ?? "").trim() || uid;
              const studentName = formatStudentFullName(
                {
                  studentName: data.studentName,
                  name: data.name,
                  schoolId,
                },
                schoolId,
              );
              const timeInMs = toMillis(
                data.timeInIso ||
                  data.timeIn ||
                  data.timestamp ||
                  data.deviceTimestampIso,
              );
              const timeOutMs = toMillis(data.timeOutIso || data.timeOut);

              return {
                id: attendanceDoc.id,
                eventId,
                uid,
                schoolId,
                studentName,
                course: String(data.course ?? "").trim() || "Unassigned",
                year: normalizeYear(data.year),
                status: normalizeAttendanceStatus(
                  data.status ?? data.attendanceStatus,
                  data.present,
                ),
                timeInMs,
                timeOutMs,
                createdAtMs: toMillis(data.createdAt),
                updatedAtMs:
                  toMillis(data.updatedAt) || toMillis(data.createdAt),
              } as TeacherAttendance;
            })
            .filter((item): item is TeacherAttendance => Boolean(item));

          attendanceByEvent.set(eventId, rows);
          ready.add(eventId);
          syncAttendance();
        },
        (nextError) => {
          attendanceByEvent.set(eventId, []);
          ready.add(eventId);
          syncAttendance();
          setError(
            toErrorMessage(nextError, "Failed to load attendance records."),
          );
        },
      ),
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [accessState, rawEvents, shouldLoadPortalActivity]);

  useEffect(() => {
    if (accessState !== "authorized" || !shouldLoadPortalActivity) {
      setFiles([]);
      setLoadingFiles(accessState === "loading" && shouldLoadPortalActivity);
      return;
    }

    const eventIds = rawEvents.map((event) => event.id).filter(Boolean);
    if (eventIds.length === 0) {
      setFiles([]);
      setLoadingFiles(false);
      return;
    }

    setLoadingFiles(true);
    const fileBuckets = new Map<string, TeacherFile[]>();
    const ready = new Set<string>();

    const syncFiles = () => {
      setFiles(Array.from(fileBuckets.values()).flat());
      setLoadingFiles(ready.size !== eventIds.length * 2);
    };

    const toFileRows = (
      eventId: string,
      kind: TeacherFileKind,
      snap: {
        docs: Array<{
          id: string;
          data: () => TeacherFileDoc;
        }>;
      },
    ) =>
      snap.docs
        .map((fileDoc) => {
          const data = fileDoc.data() as TeacherFileDoc;

          return {
            id: fileDoc.id,
            eventId,
            kind,
            name:
              String(
                data.name ??
                  (kind === "images" ? "Untitled image" : "Untitled file"),
              ).trim() ||
              (kind === "images" ? "Untitled image" : "Untitled file"),
            path: String(data.path ?? "").trim(),
            downloadURL: String(data.downloadURL ?? "").trim(),
            contentType: String(data.contentType ?? "").trim(),
            size: Number(data.size ?? 0),
            createdAtMs: toMillis(data.createdAt),
          } as TeacherFile;
        })
        .filter((item): item is TeacherFile => Boolean(item));

    const unsubs = eventIds.flatMap((eventId) => [
      onSnapshot(
        query(
          collection(db, "events", eventId, "docs"),
          orderBy("createdAt", "desc"),
        ),
        (snap) => {
          fileBuckets.set(`docs:${eventId}`, toFileRows(eventId, "docs", snap));
          ready.add(`docs:${eventId}`);
          syncFiles();
        },
        (nextError) => {
          fileBuckets.set(`docs:${eventId}`, []);
          ready.add(`docs:${eventId}`);
          syncFiles();
          setError(
            toErrorMessage(nextError, "Failed to load event documents."),
          );
        },
      ),
      onSnapshot(
        query(
          collection(db, "events", eventId, "images"),
          orderBy("createdAt", "desc"),
        ),
        (snap) => {
          fileBuckets.set(
            `images:${eventId}`,
            toFileRows(eventId, "images", snap),
          );
          ready.add(`images:${eventId}`);
          syncFiles();
        },
        (nextError) => {
          fileBuckets.set(`images:${eventId}`, []);
          ready.add(`images:${eventId}`);
          syncFiles();
          setError(toErrorMessage(nextError, "Failed to load event images."));
        },
      ),
    ]);

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [accessState, rawEvents, shouldLoadPortalActivity]);

  const events = useMemo<TeacherEvent[]>(() => {
    const attendanceCounts = new Map<string, number>();
    const presentCounts = new Map<string, number>();
    const absentCounts = new Map<string, number>();
    attendance.forEach((item) => {
      attendanceCounts.set(
        item.eventId,
        (attendanceCounts.get(item.eventId) ?? 0) + 1,
      );

      if (item.status === "Present") {
        presentCounts.set(
          item.eventId,
          (presentCounts.get(item.eventId) ?? 0) + 1,
        );
      } else if (item.status === "Absent") {
        absentCounts.set(
          item.eventId,
          (absentCounts.get(item.eventId) ?? 0) + 1,
        );
      }
    });

    const imageCounts = new Map<string, number>();
    const documentCounts = new Map<string, number>();
    files.forEach((file) => {
      if (file.kind === "images") {
        imageCounts.set(file.eventId, (imageCounts.get(file.eventId) ?? 0) + 1);
      } else {
        documentCounts.set(
          file.eventId,
          (documentCounts.get(file.eventId) ?? 0) + 1,
        );
      }
    });

    return rawEvents
      .map((eventItem) => {
        const data = eventItem.data;
        const rawScheduledTime = String(
          data.scheduledTime ?? data.timeStart ?? "",
        ).trim();
        const scheduledTime =
          rawScheduledTime || "TBA";
        const timeEnd = String(data.timeEnd ?? "").trim();
        const courseTargets = Array.isArray(data.courses)
          ? data.courses
              .map((item) => String(item ?? "").trim())
              .filter(Boolean)
          : [];
        const yearTargets = Array.isArray(data.yearLevels)
          ? data.yearLevels
              .map((item) => String(item ?? "").trim())
              .filter(Boolean)
          : [];

        const course =
          String(data.course ?? "").trim() ||
          (courseTargets.length > 0 ? courseTargets.join(", ") : "All Courses");
        const yearLevel =
          String(data.yearLevel ?? "").trim() ||
          (yearTargets.length > 0 ? yearTargets.join(", ") : "All Years");
        const selectedStudentIds = Array.isArray(data.selectedStudentIds)
          ? data.selectedStudentIds
              .map((item) => String(item ?? "").trim())
              .filter(Boolean)
          : [];
        const selectedSchoolIds = Array.isArray(data.selectedSchoolIds)
          ? data.selectedSchoolIds
              .map((item) => String(item ?? "").trim())
              .filter(Boolean)
          : [];
        const eventDateText = String(data.date ?? "").trim();
        const lifecycleDetails = resolveEventLifecycle({
          date: data.date,
          scheduledTime: normalizeLifecycleTimeInput(rawScheduledTime),
          timeStart: normalizeLifecycleTimeInput(data.timeStart),
          timeEnd: normalizeLifecycleTimeInput(data.timeEnd),
          startAt: data.startAt,
          endAt: data.endAt,
          status: data.status,
          cancelled: data.cancelled === true,
        });
        const statusLifecycle = normalizeTeacherLifecycleStatus(data.status);
        let lifecycle: TeacherLifecycle = lifecycleDetails.lifecycle;
        if (statusLifecycle === "completed" || statusLifecycle === "cancelled") {
          lifecycle = statusLifecycle;
        }
        const preRegCount = Math.max(0, Number(data.preRegCount ?? 0));
        const presentCount = shouldLoadPortalActivity
          ? (presentCounts.get(eventItem.id) ?? 0)
          : toNonNegativeNumber(data.presentCount);
        const baseAbsentCount = shouldLoadPortalActivity
          ? (absentCounts.get(eventItem.id) ?? 0)
          : toNonNegativeNumber(data.absentCount);
        const derivedAbsentCount =
          data.isPreReg === true && lifecycle === "completed"
            ? Math.max(baseAbsentCount, preRegCount - presentCount)
            : baseAbsentCount;
        const attendanceCount = shouldLoadPortalActivity
          ? (attendanceCounts.get(eventItem.id) ?? 0)
          : toNonNegativeNumber(data.attendanceCount);
        const imageCount = shouldLoadPortalActivity
          ? (imageCounts.get(eventItem.id) ?? 0)
          : toNonNegativeNumber(data.imageCount);
        const documentCount = shouldLoadPortalActivity
          ? (documentCounts.get(eventItem.id) ?? 0)
          : toNonNegativeNumber(data.documentCount);

        return {
          id: eventItem.id,
          title:
            String(data.title ?? "Untitled Event").trim() || "Untitled Event",
          location: String(data.location ?? "").trim() || "TBA",
          date: eventDateText,
          scheduledTime,
          timeEnd,
          details: String(data.details ?? "").trim(),
          course,
          courses: courseTargets,
          yearLevel,
          yearLevels: yearTargets,
          targetStudent: String(data.targetStudent ?? "").trim(),
          selectedStudentIds,
          selectedSchoolIds,
          isPreReg: data.isPreReg === true,
          withPayment: data.withPayment === true,
          paymentRequired: data.paymentRequired === true,
          preRegSlots:
            typeof data.preRegSlots === "number" ? data.preRegSlots : null,
          preRegCount,
          lifecycle,
          eventDate: lifecycleDetails.startAt,
          createdAtMs: toMillis(data.createdAt),
          createdBy: data.createdBy ?? null,
          registrationCount: preRegCount,
          attendanceCount,
          presentCount,
          absentCount: derivedAbsentCount,
          imageCount,
          documentCount,
        } as TeacherEvent;
      })
      .sort((a, b) => {
        const aMs = a.eventDate?.getTime() ?? a.createdAtMs ?? 0;
        const bMs = b.eventDate?.getTime() ?? b.createdAtMs ?? 0;
        return bMs - aMs;
      });
  }, [attendance, files, rawEvents, shouldLoadPortalActivity]);

  const students = useMemo<TeacherStudent[]>(() => {
    const byUid = new Map<string, TeacherStudent>();

    const ensureStudent = (
      uid: string,
      schoolId: string,
      studentName: string,
      course: string,
      year: string,
    ) => {
      const existing = byUid.get(uid);
      if (existing) {
        existing.schoolId = existing.schoolId || schoolId || uid;
        existing.studentName =
          existing.studentName || studentName || existing.schoolId;
        if (
          existing.course === "Unassigned" &&
          course &&
          course !== "Unassigned"
        ) {
          existing.course = course;
        }
        if (existing.year === "Unassigned" && year && year !== "Unassigned") {
          existing.year = year;
        }
        return existing;
      }

      const nextStudent: TeacherStudent = {
        uid,
        schoolId: schoolId || uid,
        studentName: studentName || schoolId || uid,
        course: course || "Unassigned",
        year: year || "Unassigned",
        trackedEventIds: [],
        attendanceRecords: [],
        presentCount: 0,
        absentCount: 0,
        recordedCount: 0,
        lastActivityMs: 0,
      };
      byUid.set(uid, nextStudent);
      return nextStudent;
    };

    attendance.forEach((item) => {
      const student = ensureStudent(
        item.uid,
        item.schoolId,
        item.studentName,
        item.course,
        item.year,
      );

      if (!student.trackedEventIds.includes(item.eventId)) {
        student.trackedEventIds.push(item.eventId);
      }

      const existingRecord = student.attendanceRecords.find(
        (record) => record.eventId === item.eventId,
      );
      if (existingRecord) {
        existingRecord.status = item.status;
        existingRecord.timeInMs = Math.max(
          existingRecord.timeInMs,
          item.timeInMs,
        );
        existingRecord.timeOutMs = Math.max(
          existingRecord.timeOutMs,
          item.timeOutMs,
        );
        existingRecord.updatedAtMs = Math.max(
          existingRecord.updatedAtMs,
          item.updatedAtMs,
        );
      } else {
        student.attendanceRecords.push({
          eventId: item.eventId,
          status: item.status,
          timeInMs: item.timeInMs,
          timeOutMs: item.timeOutMs,
          updatedAtMs: item.updatedAtMs,
        });
      }

      student.recordedCount += 1;
      if (item.status === "Present") student.presentCount += 1;
      if (item.status === "Absent") student.absentCount += 1;
      student.lastActivityMs = Math.max(
        student.lastActivityMs,
        item.updatedAtMs || item.createdAtMs,
      );
    });

    return Array.from(byUid.values()).sort((a, b) => {
      const byName = a.studentName.localeCompare(b.studentName);
      if (byName !== 0) return byName;
      return a.schoolId.localeCompare(b.schoolId);
    });
  }, [attendance]);

  const loading =
    accessState === "loading" ||
    loadingEvents ||
    (shouldLoadPortalActivity && (loadingActivity || loadingFiles));

  const value = useMemo<TeacherPortalContextValue>(
    () => ({
      accessState,
      profile,
      events,
      attendance,
      files,
      students,
      loading,
      loadingEvents,
      loadingActivity,
      loadingFiles,
      error,
    }),
    [
      accessState,
      attendance,
      error,
      events,
      files,
      loading,
      loadingActivity,
      loadingEvents,
      loadingFiles,
      profile,
      students,
    ],
  );

  return (
    <TeacherPortalContext.Provider value={value}>
      {children}
    </TeacherPortalContext.Provider>
  );
}

export function useTeacherPortal() {
  const ctx = useContext(TeacherPortalContext);
  if (!ctx) {
    throw new Error(
      "useTeacherPortal must be used within TeacherPortalProvider.",
    );
  }
  return ctx;
}
