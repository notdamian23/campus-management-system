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
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type LifecycleStatus = "upcoming" | "ongoing" | "completed";

export type StudentEventStatus =
  | "Upcoming"
  | "Payment Due"
  | "Pre-registration"
  | "Attended"
  | "Missed";

export type StudentNotificationType =
  | "upcoming"
  | "payment"
  | "missed"
  | "preregister"
  | "announcement";

export type StudentProfile = {
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
};

export type StudentPayment = {
  paymentId: string;
  title: string;
  ref: string;
  amount: number;
  date: string;
  details: string;
  status: "PAID" | "UNPAID";
  createdAtMs: number;
  updatedAtMs: number;
};

export type StudentEvent = {
  id: string;
  title: string;
  description: string;
  details: string;
  date: string;
  scheduledTime: string;
  location: string;
  course: string;
  yearLevel: string;
  isPreReg: boolean;
  withPayment: boolean;
  lifecycle: LifecycleStatus;
  status: StudentEventStatus;
  eventDate: Date | null;
  attendanceStatus: string | null;
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
  registeredEventIds: string[];
  loading: boolean;
  loadingProfile: boolean;
  loadingEvents: boolean;
  loadingPayments: boolean;
  error: string | null;
  registerForEvent: (eventId: string) => Promise<{ ok: boolean; msg: string }>;
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
};

type PaymentDocData = {
  title?: string;
  ref?: string;
  amount?: number | string;
  date?: string;
  details?: string;
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

type ProfileDocData = {
  role?: string;
  schoolId?: string;
  studentName?: string;
  name?: string;
  course?: string;
  year?: string;
};

const StudentPortalContext = createContext<StudentPortalContextValue | null>(
  null
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
  return String(value ?? "").trim().toLowerCase();
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

function computeLifecycle(date: string, scheduledTime: string, timeEnd: string) {
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

function toTargetList(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter(Boolean);
  }

  const eventTarget = String(value ?? "").trim();
  if (!eventTarget) return [];

  return eventTarget
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesTarget(eventValue: unknown, studentValue: string, allLabel: string) {
  const eventTargets = toTargetList(eventValue);
  const studentTarget = String(studentValue ?? "").trim();

  if (eventTargets.length === 0) return true;
  if (eventTargets.some((item) => normalizeText(item) === normalizeText(allLabel))) {
    return true;
  }
  return eventTargets.some((item) => normalizeText(item) === normalizeText(studentTarget));
}

function matchesSpecificStudentTarget(
  targetValue: string,
  schoolId: string,
  studentName: string
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
    if (withoutParens && (withoutParens === name || name.includes(withoutParens) || withoutParens.includes(name))) return true;

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
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [rawEvents, setRawEvents] = useState<RawEventDoc[]>([]);
  const [payments, setPayments] = useState<StudentPayment[]>([]);
  const [profileNotifications, setProfileNotifications] = useState<
    ProfileNotificationDoc[]
  >([]);
  const [attendanceByEvent, setAttendanceByEvent] = useState<
    Record<string, string | null>
  >({});
  const [registeredEventIds, setRegisteredEventIds] = useState<string[]>([]);

  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [loadingProfileNotifications, setLoadingProfileNotifications] =
    useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setLoadingProfile(true);

      if (!user) {
        setProfile(null);
        setLoadingProfile(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "profiles", user.uid));
        if (!snap.exists()) {
          setProfile(null);
          setLoadingProfile(false);
          return;
        }

        const data = snap.data() as ProfileDocData;
        setProfile({
          uid: user.uid,
          schoolId: String(data.schoolId ?? "").trim(),
          studentName:
            String(data.studentName ?? "").trim() ||
            String(data.name ?? "").trim() ||
            String(data.schoolId ?? "").trim() ||
            user.uid,
          course: String(data.course ?? "").trim() || "Unassigned",
          year: normalizeYear(data.year),
        });
      } catch (e: unknown) {
        setProfile(null);
        setError(toErrorMessage(e, "Failed to load student profile."));
      } finally {
        setLoadingProfile(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!profile) {
      setRawEvents([]);
      setLoadingEvents(false);
      return;
    }

    setLoadingEvents(true);
    const qy = query(collection(db, "events"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      qy,
      (snap) => {
        const mapped: RawEventDoc[] = snap.docs
          .map((d) => {
            const data = d.data() as Partial<RawEventDoc> & {
              yearLevels?: unknown;
              courses?: unknown;
            };
            const yearLevels = toTargetList(data.yearLevels);
            const courses = toTargetList(data.courses);
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
              withPayment: data.withPayment === true,
            };
          })
          .filter((event) => {
            const courseMatch = matchesTarget(
              event.courses.length > 0 ? event.courses : event.course,
              profile.course,
              "All Courses"
            );
            const yearMatch = matchesTarget(
              event.yearLevels.length > 0 ? event.yearLevels : event.yearLevel,
              profile.year,
              "All Years"
            );
            const studentMatch = matchesSpecificStudentTarget(
              event.targetStudent,
              profile.schoolId,
              profile.studentName
            );
            return courseMatch && yearMatch && studentMatch;
          });

        setRawEvents(mapped);
        setLoadingEvents(false);
      },
      (e) => {
        setRawEvents([]);
        setLoadingEvents(false);
        setError(toErrorMessage(e, "Failed to load events."));
      }
    );

    return () => unsub();
  }, [profile]);

  useEffect(() => {
    if (!profile) {
      setPayments([]);
      setLoadingPayments(false);
      return;
    }
    const uid = profile.uid;

    setLoadingPayments(true);
    let active = true;

    const qy = query(collection(db, "payments"), orderBy("createdAt", "desc"));

    const unsub = onSnapshot(
      qy,
      async (snap) => {
        try {
          const rows = await Promise.all(
            snap.docs.map(async (paymentDoc) => {
              const paymentData = paymentDoc.data() as PaymentDocData;
              const assignmentSnap = await getDoc(
                doc(db, "payments", paymentDoc.id, "students", uid)
              );
              if (!assignmentSnap.exists()) return null;

              const assignment = assignmentSnap.data() as PaymentAssignmentData;
              const status =
                normalizeText(assignment.status) === "paid"
                  ? "PAID"
                  : "UNPAID";

              const createdAtMs = assignment.createdAt?.toMillis
                ? assignment.createdAt.toMillis()
                : 0;
              const updatedAtMs = assignment.updatedAt?.toMillis
                ? assignment.updatedAt.toMillis()
                : createdAtMs;

              return {
                paymentId: paymentDoc.id,
                title: String(paymentData.title ?? "Untitled Payment"),
                ref: String(paymentData.ref ?? paymentDoc.id),
                amount: Number(paymentData.amount ?? 0),
                date: String(paymentData.date ?? ""),
                details: String(paymentData.details ?? ""),
                status,
                createdAtMs,
                updatedAtMs,
              } as StudentPayment;
            })
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
      }
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
      orderBy("createdAt", "desc")
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
        setError(toErrorMessage(e, "Failed to load notifications."));
      }
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
            const snap = await getDoc(doc(db, "events", ev.id, "attendance", uid));

            if (!snap.exists()) {
              return [ev.id, null] as const;
            }

            const data = snap.data() as AttendanceDocData;
            const raw = String(
              data.status ?? data.attendanceStatus ?? ""
            ).toLowerCase();
            return [ev.id, raw || null] as const;
          })
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
      return;
    }
    const uid = profile.uid;

    if (rawEvents.length === 0) {
      setRegisteredEventIds([]);
      return;
    }

    let active = true;

    async function loadRegistrations() {
      try {
        const checks = await Promise.all(
          rawEvents.map(async (ev) => {
            const snap = await getDoc(doc(db, "events", ev.id, "registrations", uid));
            return snap.exists() ? ev.id : null;
          })
        );

        if (!active) return;
        setRegisteredEventIds(
          checks.filter((id): id is string => Boolean(id))
        );
      } catch {
        if (!active) return;
        setRegisteredEventIds([]);
      }
    }

    void loadRegistrations();

    return () => {
      active = false;
    };
  }, [profile, rawEvents]);

  const events = useMemo(() => {
    const paymentByTitle = new Map<string, StudentPayment>();
    payments.forEach((p) => {
      const key = normalizeText(p.title);
      if (!key) return;
      if (!paymentByTitle.has(key)) {
        paymentByTitle.set(key, p);
      }
    });

    return rawEvents
      .map((raw) => {
        const scheduledTime = raw.scheduledTime || raw.timeStart;
        const eventDate = toEventDate(raw.date, scheduledTime);
        const lifecycle = computeLifecycle(raw.date, scheduledTime, raw.timeEnd);
        const attendanceRaw = normalizeText(attendanceByEvent[raw.id] ?? "");
        const paymentMatch = paymentByTitle.get(normalizeText(raw.title));

        let status: StudentEventStatus = "Upcoming";

        if (lifecycle === "completed") {
          if (attendanceRaw === "present" || attendanceRaw === "attended") {
            status = "Attended";
          } else {
            status = "Missed";
          }
        } else if (
          raw.withPayment &&
          (!paymentMatch || paymentMatch.status === "UNPAID")
        ) {
          status = "Payment Due";
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
          location: raw.location || "TBA",
          course: raw.course || "All Courses",
          yearLevel: raw.yearLevel || "All Years",
          isPreReg: raw.isPreReg,
          withPayment: raw.withPayment,
          lifecycle,
          status,
          eventDate,
          attendanceStatus: attendanceRaw || null,
        } as StudentEvent;
      })
      .sort((a, b) => {
        const aMs = a.eventDate?.getTime() ?? 0;
        const bMs = b.eventDate?.getTime() ?? 0;
        return aMs - bMs;
      });
  }, [rawEvents, attendanceByEvent, payments]);

  const notifications = useMemo(() => {
    const items: StudentNotification[] = [];
    const dedupe = new Set<string>();

    const pushItem = (
      key: string,
      item: Omit<StudentNotification, "displayDate">
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
      const when = scheduledDate ?? (createdAtMs ? new Date(createdAtMs) : new Date());

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
        pushItem(`payment:${normalizeText(ev.title)}`, {
          id: `event-payment:${ev.id}`,
          title: `Payment Due: ${ev.title}`,
          description: ev.description,
          type: "payment",
          date,
        });
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
      pushItem(`payment:${normalizeText(payment.title)}`, {
        id: `payment:${payment.paymentId}`,
        title: `Payment Due: ${payment.title}`,
        description: `Reference ${payment.ref} | Amount ${payment.amount.toFixed(
          2
        )}`,
        type: "payment",
        date: paymentDate,
      });
    });

    return items.sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [profileNotifications, events, payments]);

  const registerForEvent = useCallback(
    async (eventId: string) => {
      if (!profile?.uid) {
        return { ok: false, msg: "You need to be logged in first." };
      }
      const uid = profile.uid;

      try {
        await setDoc(
          doc(db, "events", eventId, "registrations", uid),
          {
            uid,
            schoolId: profile.schoolId,
            studentName: profile.studentName,
            course: profile.course,
            year: profile.year,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        setRegisteredEventIds((prev) =>
          prev.includes(eventId) ? prev : [...prev, eventId]
        );

        return { ok: true, msg: "Registered successfully." };
      } catch (e: unknown) {
        return {
          ok: false,
          msg: toErrorMessage(e, "Failed to register for this event."),
        };
      }
    },
    [profile]
  );

  const loading =
    loadingProfile ||
    loadingEvents ||
    loadingPayments ||
    loadingProfileNotifications;

  const value = useMemo<StudentPortalContextValue>(
    () => ({
      profile,
      events,
      payments,
      notifications,
      registeredEventIds,
      loading,
      loadingProfile,
      loadingEvents,
      loadingPayments,
      error,
      registerForEvent,
    }),
    [
      profile,
      events,
      payments,
      notifications,
      registeredEventIds,
      loading,
      loadingProfile,
      loadingEvents,
      loadingPayments,
      error,
      registerForEvent,
    ]
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
      "useStudentPortal must be used within StudentPortalProvider."
    );
  }
  return ctx;
}
