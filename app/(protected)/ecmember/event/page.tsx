"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FiCalendar, FiChevronDown } from "react-icons/fi";

import { app, auth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collectionGroup,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Button } from "@heroui/button";
import { DatePicker } from "@heroui/date-picker";
import { TimeInput } from "@heroui/date-input";
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from "@heroui/dropdown";
import { Input } from "@heroui/input";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { Switch } from "@heroui/switch";
import { Tab, Tabs } from "@heroui/tabs";
import { addToast } from "@heroui/toast";
import { deleteObject, getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { CalendarDate, getLocalTimeZone, Time, today } from "@internationalized/date";

type Role = "teacher" | "student" | "ec";
type EventStatus = "upcoming" | "ongoing" | "completed";

type EventDoc = {
  id: string;
  title: string;
  location?: string;
  date: string;
  scheduledTime?: string;
  // Legacy fields kept for older records
  timeStart?: string;
  timeEnd?: string;
  yearLevel?: string;
  course?: string;
  yearLevels?: string[];
  courses?: string[];
  targetStudent?: string;
  details?: string;
  isPreReg?: boolean;
  withPayment?: boolean;

  preRegSlots?: number | null;
  preRegCount?: number;

  status?: EventStatus;
  createdBy?: string | null;
  createdAt?: any;
};

type EventFile = {
  id: string;
  name?: string;
  path?: string;
  downloadURL?: string;
  contentType?: string;
  size?: number;
  createdAt?: any;
  uploadedByUid?: string;
};

type RegistrationDoc = {
  id: string;
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  createdAt?: any;
};

type RemoteStudent = {
  uid?: string;
  schoolId?: string;
  studentName?: string;
  name?: string;
  course?: string;
  year?: string;
};

type StudentLookup = {
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  searchText: string;
};

type NotificationListStatus = "scheduled" | "sent";
type EventFilesTab = "images" | "docs";
type EventSortMode = "latest_to_oldest" | "oldest_to_latest" | "alphabetical";

type NotificationSummary = {
  id: string;
  dispatchId: string;
  title: string;
  message: string;
  date: string;
  scheduledTime: string;
  recipientType: "all" | "course" | "year" | "student";
  course: string;
  yearLevel: string;
  targetStudent: string;
  createdAt?: any;
  recipientCount: number;
  status: NotificationListStatus;
};

const ONE_MB_IN_BYTES = 1024 * 1024;
const MAX_EVENT_FILE_SIZE_BYTES = 10 * ONE_MB_IN_BYTES;
const MAX_IMAGE_DIMENSION = 2048;
const IMAGE_COMPRESSION_QUALITY_STEPS = [0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42];
const IMAGE_COMPRESSION_SCALE_STEPS = [1, 0.9, 0.8, 0.72, 0.64];
const EVENT_DOC_EXTENSIONS = new Set(["pdf", "doc", "docx"]);
const EVENT_DOC_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const EVENT_YEAR_LEVEL_CHOICES = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const EVENT_COURSE_CHOICES = [
  "Computer Engineering",
  "Mechanical Engineering",
  "Electrical Engineering",
  "Electronics Engineering",
  "Industrial Engineering",
];
const ITEMS_PER_PAGE = 5;

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function clamp(val: number, min: number, max: number) {
  return Math.max(min, Math.min(max, val));
}

function parseTime12ToMinutes(t?: string) {
  if (!t) return null;
  const m = t.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;

  let hour = Number(m[1]);
  const min = Number(m[2]);
  const ap = m[3].toUpperCase();

  if (hour === 12) hour = 0;
  if (ap === "PM") hour += 12;

  return hour * 60 + min;
}

function computeStatus(ev: {
  date: string;
  scheduledTime?: string;
  timeStart?: string;
  timeEnd?: string;
}): EventStatus {
  const startM = parseTime12ToMinutes(ev.scheduledTime || ev.timeStart);
  const endM = parseTime12ToMinutes(ev.timeEnd);
  if (startM == null) return "upcoming";

  const now = new Date();
  const [y, mo, d] = ev.date.split("-").map(Number);
  if (!y || !mo || !d) return "upcoming";

  const eventDate = new Date(y, mo - 1, d);

  const start = new Date(eventDate);
  start.setHours(Math.floor(startM / 60), startM % 60, 0, 0);

  if (endM == null) {
    return now < start ? "upcoming" : "completed";
  }

  const safeEnd = endM >= startM ? endM : startM + 60;
  const end = new Date(eventDate);
  end.setHours(Math.floor(safeEnd / 60), safeEnd % 60, 0, 0);

  if (now < start) return "upcoming";
  if (now >= start && now <= end) return "ongoing";
  return "completed";
}

type TimeParts = { hour: number; minute: number; ampm: "AM" | "PM" };

function to12hParts(time24: string): TimeParts {
  const [hStr, mStr] = (time24 || "07:00").split(":");
  const h = Number(hStr);
  const minute = Number(mStr);

  const ampm: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  let hour = h % 12;
  if (hour === 0) hour = 12;

  return { hour, minute: clamp(minute || 0, 0, 59), ampm };
}

function format12h(time24: string) {
  const p = to12hParts(time24);
  return `${p.hour}:${pad2(p.minute)} ${p.ampm}`;
}

function isoDateToday() {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

function toIsoDate(value: { year: number; month: number; day: number } | null) {
  if (!value) return "";
  return `${value.year}-${pad2(value.month)}-${pad2(value.day)}`;
}

function toCalendarDate(isoDate: string) {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) {
    return today(getLocalTimeZone());
  }
  return new CalendarDate(y, m, d);
}

function now24h() {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

function parse24h(time24: string) {
  const [hourRaw, minuteRaw] = String(time24 || "").split(":");
  const hour = clamp(Number(hourRaw) || 0, 0, 23);
  const minute = clamp(Number(minuteRaw) || 0, 0, 59);
  return { hour, minute };
}

function to24hStringFromValue(value: { hour: number; minute: number } | null) {
  if (!value) return "00:00";
  return `${pad2(value.hour)}:${pad2(value.minute)}`;
}

function toTimeValue(time24: string) {
  const { hour, minute } = parse24h(time24);
  return new Time(hour, minute);
}

function toMinutesFrom24h(time24: string) {
  const { hour, minute } = parse24h(time24);
  return hour * 60 + minute;
}

function toMillis(value: any): number {
  if (value && typeof value === "object" && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  if (value && typeof value === "object" && typeof value.seconds === "number") {
    return Number(value.seconds) * 1000;
  }
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function formatDateTime(value: any): string {
  const ms = toMillis(value);
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function getDateTimeMs(date: string, time12?: string) {
  const raw = String(date ?? "").trim();
  if (!raw) return 0;

  const [y, m, d] = raw.split("-").map(Number);
  if (!y || !m || !d) return 0;

  const out = new Date(y, m - 1, d);
  const mins = parseTime12ToMinutes(time12);
  if (mins != null) {
    out.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
  } else {
    out.setHours(0, 0, 0, 0);
  }
  return out.getTime();
}

function computeNotificationStatus(date: string, scheduledTime?: string): NotificationListStatus {
  const when = getDateTimeMs(date, scheduledTime);
  if (!when) return "sent";
  return when > Date.now() ? "scheduled" : "sent";
}

function csvCell(value: string | number) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

function getFileExtension(filename: string) {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

function isAllowedEventDocument(file: File) {
  const ext = getFileExtension(file.name);
  if (EVENT_DOC_EXTENSIONS.has(ext)) return true;
  return EVENT_DOC_MIME_TYPES.has(file.type);
}

function toMegabytesText(bytes: number) {
  return `${(bytes / ONE_MB_IN_BYTES).toFixed(2)}MB`;
}

function toCompressedImageName(filename: string) {
  const i = filename.lastIndexOf(".");
  const stem = i >= 0 ? filename.slice(0, i) : filename;
  return `${stem}.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to compress image."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };

    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`"${file.name}" is not a readable image.`));
    };

    image.src = objectUrl;
  });
}

async function compressImageForUpload(file: File, maxBytes: number) {
  const image = await loadImage(file);
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error(`"${file.name}" has invalid image dimensions.`);
  }

  const longestEdge = Math.max(sourceWidth, sourceHeight);
  const baseRatio = longestEdge > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / longestEdge : 1;
  const baseWidth = Math.max(1, Math.round(sourceWidth * baseRatio));
  const baseHeight = Math.max(1, Math.round(sourceHeight * baseRatio));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image compression is not available in this browser.");

  let smallestBlob: Blob | null = null;

  for (const scale of IMAGE_COMPRESSION_SCALE_STEPS) {
    canvas.width = Math.max(1, Math.round(baseWidth * scale));
    canvas.height = Math.max(1, Math.round(baseHeight * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of IMAGE_COMPRESSION_QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!smallestBlob || blob.size < smallestBlob.size) smallestBlob = blob;

      if (blob.size <= maxBytes) {
        return new File([blob], toCompressedImageName(file.name), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      }
    }
  }

  if (!smallestBlob) {
    throw new Error(`Unable to compress "${file.name}".`);
  }

  return new File([smallestBlob], toCompressedImageName(file.name), {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}

function StatMini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-white px-2 py-2 text-center">
      <div className="text-base font-bold leading-none">{value}</div>
      <div className="text-[11px] text-campus-text-secondary mt-1 leading-none">{label}</div>
    </div>
  );
}

export default function EventDashboard() {
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);
  const [showAddEventForm, setShowAddEventForm] = useState(false);
  const [showNotificationForm, setShowNotificationForm] = useState(false);
  const [listTab, setListTab] = useState<"events" | "notifications">("events");

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | EventStatus>("all");
  const [eventDateFilter, setEventDateFilter] = useState("");
  const [eventSortMode, setEventSortMode] = useState<EventSortMode>("latest_to_oldest");
  const [eventPage, setEventPage] = useState(1);
  const [recipientType, setRecipientType] = useState<"all" | "course" | "year" | "student">("all");

  const [notifTitle, setNotifTitle] = useState("");
  const [notifDate, setNotifDate] = useState<string>(() => isoDateToday());
  const [notifDateValue, setNotifDateValue] = useState<any>(() => toCalendarDate(isoDateToday()));
  const [notifMessage, setNotifMessage] = useState("");
  const [notifCourse, setNotifCourse] = useState("Computer Engineering");
  const [notifYear, setNotifYear] = useState("1st Year");
  const [notifSearchName, setNotifSearchName] = useState("");
  const [notifSearchId, setNotifSearchId] = useState("");
  const [selectedNotifStudents, setSelectedNotifStudents] = useState<StudentLookup[]>([]);
  const [notifScheduled24, setNotifScheduled24] = useState<string>(() => now24h());
  const [notifScheduledValue, setNotifScheduledValue] = useState<Time | null>(() => toTimeValue(now24h()));
  const [sendingNotif, setSendingNotif] = useState(false);
  const [notifError, setNotifError] = useState("");
  const [notifMsg, setNotifMsg] = useState("");
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState("");
  const [studentOptions, setStudentOptions] = useState<StudentLookup[]>([]);
  const [showStudentDropdown, setShowStudentDropdown] = useState(false);
  const studentPickerRef = useRef<HTMLDivElement | null>(null);
  const [eventSearchName, setEventSearchName] = useState("");
  const [selectedEventStudents, setSelectedEventStudents] = useState<StudentLookup[]>([]);
  const [showEventStudentDropdown, setShowEventStudentDropdown] = useState(false);
  const [eventYearSearch, setEventYearSearch] = useState("");
  const [selectedEventYearLevels, setSelectedEventYearLevels] = useState<string[]>([]);
  const [showEventYearDropdown, setShowEventYearDropdown] = useState(false);
  const [isAllYearsExplicit, setIsAllYearsExplicit] = useState(false);
  const [eventCourseSearch, setEventCourseSearch] = useState("");
  const [selectedEventCourses, setSelectedEventCourses] = useState<string[]>([]);
  const [showEventCourseDropdown, setShowEventCourseDropdown] = useState(false);
  const [isAllCoursesExplicit, setIsAllCoursesExplicit] = useState(false);
  const [registrantsModalOpen, setRegistrantsModalOpen] = useState(false);
  const eventStudentPickerRef = useRef<HTMLDivElement | null>(null);
  const eventYearPickerRef = useRef<HTMLDivElement | null>(null);
  const eventCoursePickerRef = useRef<HTMLDivElement | null>(null);

  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState<string>(() => isoDateToday());
  const [eventDateValue, setEventDateValue] = useState<any>(() => toCalendarDate(isoDateToday()));
  const [details, setDetails] = useState("");
  const [isPreReg, setIsPreReg] = useState(false);
  const [withPayment, setWithPayment] = useState(false);

  const [eventScheduled24, setEventScheduled24] = useState("07:00");
  const [eventStartTimeValue, setEventStartTimeValue] = useState<Time | null>(() => toTimeValue("07:00"));
  const [eventEnd24, setEventEnd24] = useState("08:00");
  const [eventEndTimeValue, setEventEndTimeValue] = useState<Time | null>(() => toTimeValue("08:00"));

  const [preRegSlots, setPreRegSlots] = useState<number>(50);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [saveMsg, setSaveMsg] = useState("");

  const [isECUser, setIsECUser] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);

  const [events, setEvents] = useState<EventDoc[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [notifications, setNotifications] = useState<NotificationSummary[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [notificationSearchText, setNotificationSearchText] = useState("");
  const [notificationStatusFilter, setNotificationStatusFilter] = useState<"all" | NotificationListStatus>("all");
  const [notificationDateFilter, setNotificationDateFilter] = useState("");
  const [notificationSortMode, setNotificationSortMode] = useState<EventSortMode>("latest_to_oldest");
  const [notificationPage, setNotificationPage] = useState(1);

  const [currentUser, setCurrentUser] = useState<any>(null);

  // Files per event (subcollections)
  const [eventImages, setEventImages] = useState<Record<string, EventFile[]>>({});
  const [eventDocs, setEventDocs] = useState<Record<string, EventFile[]>>({});
  const [eventRegistrations, setEventRegistrations] = useState<Record<string, RegistrationDoc[]>>({});
  const [eventFilesTab, setEventFilesTab] = useState<EventFilesTab>("images");
  const [viewAllFilesModal, setViewAllFilesModal] = useState<{
    open: boolean;
    eventId: string | null;
    eventTitle: string;
    kind: EventFilesTab;
  }>({
    open: false,
    eventId: null,
    eventTitle: "",
    kind: "images",
  });
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [uploadErr, setUploadErr] = useState<string>("");
  const [uploadMsg, setUploadMsg] = useState<string>("");
  const [exportingEventId, setExportingEventId] = useState<string | null>(null);
  const [exportMsg, setExportMsg] = useState<string>("");
  const [exportError, setExportError] = useState<string>("");

  // Role check
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setRoleLoading(true);
      setCurrentUser(user);

      if (!user) {
        setIsECUser(false);
        setCurrentUser(null);
        setRoleLoading(false);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "profiles", user.uid));
        const role = snap.exists() ? (snap.data()?.role as Role | undefined) : undefined;
        setIsECUser(role === "ec");
      } catch {
        setIsECUser(false);
      } finally {
        setRoleLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const loadStudentsForNotifications = useCallback(async (): Promise<StudentLookup[]> => {
    if (!isECUser) return [];
    if (studentsLoading) return studentOptions;

    setStudentsLoading(true);
    setStudentsError("");

    try {
      const fn = httpsCallable<{ limit: number }, { students?: RemoteStudent[] }>(functions, "ecListStudents");
      const res = await fn({ limit: 2000 });
      const rows = (res.data?.students ?? [])
        .map((s) => {
          const uid = String(s.uid ?? "").trim();
          const schoolId = String(s.schoolId ?? "").trim();
          const studentName = String(s.studentName ?? s.name ?? "").trim() || schoolId || uid;
          const course = String(s.course ?? "").trim();
          const year = String(s.year ?? "").trim();

          if (!uid) return null;

          const searchText = `${studentName} ${schoolId} ${course} ${year}`.toLowerCase();
          return { uid, schoolId, studentName, course, year, searchText } as StudentLookup;
        })
        .filter((s): s is StudentLookup => Boolean(s))
        .sort((a, b) => a.studentName.localeCompare(b.studentName) || a.schoolId.localeCompare(b.schoolId));

      setStudentOptions(rows);
      return rows;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to load students.";
      setStudentsError(message);
      setStudentOptions([]);
      return [];
    } finally {
      setStudentsLoading(false);
    }
  }, [functions, isECUser, studentsLoading, studentOptions]);

  useEffect(() => {
    if (!showNotificationForm && !showAddEventForm) return;
    if (!isECUser) return;
    if (studentOptions.length > 0) return;
    void loadStudentsForNotifications();
  }, [showNotificationForm, showAddEventForm, isECUser, studentOptions.length, loadStudentsForNotifications]);

  useEffect(() => {
    if (recipientType !== "student" && !showAddEventForm) return;

    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (studentPickerRef.current?.contains(target)) return;
      if (eventStudentPickerRef.current?.contains(target)) return;
      if (eventYearPickerRef.current?.contains(target)) return;
      if (eventCoursePickerRef.current?.contains(target)) return;
      setShowStudentDropdown(false);
      setShowEventStudentDropdown(false);
      setShowEventYearDropdown(false);
      setShowEventCourseDropdown(false);
    };

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [recipientType, showAddEventForm]);

  const mapNotificationSummaryRows = useCallback(
    (docs: Array<{ id: string; data: () => any }>): NotificationSummary[] => {
      if (!currentUser) return [];

      const grouped = new Map<string, NotificationSummary>();

      docs.forEach((d) => {
        const data = d.data() as {
          dispatchId?: string;
          title?: string;
          message?: string;
          date?: string;
          scheduledTime?: string;
          recipientType?: string;
          course?: string;
          yearLevel?: string;
          targetStudent?: string;
          recipientCount?: number;
          createdAt?: any;
          createdByUid?: string;
        };

        const createdByUid = String(data.createdByUid ?? "");
        if (createdByUid && createdByUid !== currentUser.uid) return;

        const title = String(data.title ?? "Notification");
        const message = String(data.message ?? "");
        const date = String(data.date ?? "");
        const scheduledTime = String(data.scheduledTime ?? "");
        const createdAtMs = toMillis(data.createdAt);
        const recipientTypeRaw = String(data.recipientType ?? "all");
        const recipientType: NotificationSummary["recipientType"] =
          recipientTypeRaw === "course" || recipientTypeRaw === "year" || recipientTypeRaw === "student"
            ? recipientTypeRaw
            : "all";
        const explicitRecipientCount = Number(data.recipientCount ?? 0);

        const dispatchId = String(data.dispatchId ?? "").trim();
        const fallbackGroupKey = [
          createdByUid || currentUser.uid,
          title,
          message,
          date,
          scheduledTime,
          String(createdAtMs ? Math.floor(createdAtMs / 60000) : 0),
        ].join("|");
        const groupKey = dispatchId || fallbackGroupKey;

        if (!grouped.has(groupKey)) {
          grouped.set(groupKey, {
            id: d.id,
            dispatchId: groupKey,
            title,
            message,
            date,
            scheduledTime,
            recipientType,
            course: String(data.course ?? ""),
            yearLevel: String(data.yearLevel ?? ""),
            targetStudent: String(data.targetStudent ?? ""),
            createdAt: data.createdAt,
            recipientCount: explicitRecipientCount > 0 ? explicitRecipientCount : 0,
            status: computeNotificationStatus(date, scheduledTime),
          });
        }

        const current = grouped.get(groupKey)!;
        if (explicitRecipientCount > 0) {
          current.recipientCount = Math.max(current.recipientCount, explicitRecipientCount);
        } else {
          current.recipientCount += 1;
        }
        if (toMillis(data.createdAt) > toMillis(current.createdAt)) {
          current.createdAt = data.createdAt;
        }
      });

      return Array.from(grouped.values()).sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
    },
    [currentUser]
  );

  const refreshSentNotificationsOnce = useCallback(async () => {
    if (!currentUser || !isECUser) {
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }

    try {
      const ownQ = query(collection(db, "profiles", currentUser.uid, "notifications"), orderBy("createdAt", "desc"), limit(1200));
      const ownSnap = await getDocs(ownQ);
      let rows = mapNotificationSummaryRows(ownSnap.docs);

      if (rows.length === 0) {
        try {
          const legacyQ = query(collectionGroup(db, "notifications"), orderBy("createdAt", "desc"), limit(1200));
          const legacySnap = await getDocs(legacyQ);
          rows = mapNotificationSummaryRows(legacySnap.docs);
        } catch {
          // Ignore legacy fallback errors and keep rows from own profile query.
        }
      }

      setNotifications(rows);
    } catch {
      setNotifications((prev) => prev);
    } finally {
      setNotificationsLoading(false);
    }
  }, [currentUser, isECUser, mapNotificationSummaryRows]);

  // Live sent notifications (grouped by dispatchId)
  useEffect(() => {
    if (!currentUser || !isECUser) {
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }

    setNotificationsLoading(true);
    const qy = query(collection(db, "profiles", currentUser.uid, "notifications"), orderBy("createdAt", "desc"), limit(1200));
    void refreshSentNotificationsOnce();

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setNotifications(mapNotificationSummaryRows(snap.docs));
        setNotificationsLoading(false);
      },
      () => {
        void refreshSentNotificationsOnce();
      }
    );

    return () => unsub();
  }, [currentUser, isECUser, mapNotificationSummaryRows, refreshSentNotificationsOnce]);

  // Live events
  useEffect(() => {
    const qy = query(collection(db, "events"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      qy,
      (snap) => {
        const list: EventDoc[] = snap.docs.map((d) => {
          const data = d.data() as Omit<EventDoc, "id">;
          return { id: d.id, ...data };
        });
        setEvents(list);
        setEventsLoading(false);
      },
      () => {
        setEvents([]);
        setEventsLoading(false);
      }
    );
    return () => unsub();
  }, []);

  // Live files for expanded event
  useEffect(() => {
    if (!expandedEventId) return;

    const imgQ = query(collection(db, "events", expandedEventId, "images"), orderBy("createdAt", "desc"));
    const docQ = query(collection(db, "events", expandedEventId, "docs"), orderBy("createdAt", "desc"));

    const unsubImgs = onSnapshot(imgQ, (snap) => {
      setEventImages((prev) => ({
        ...prev,
        [expandedEventId]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
      }));
    });

    const unsubDocs = onSnapshot(docQ, (snap) => {
      setEventDocs((prev) => ({
        ...prev,
        [expandedEventId]: snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })),
      }));
    });

    return () => {
      unsubImgs();
      unsubDocs();
    };
  }, [expandedEventId]);

  // Live registrations for pre-registration events
  useEffect(() => {
    const preRegEventIds = events.filter((ev) => ev.isPreReg).map((ev) => ev.id);

    if (preRegEventIds.length === 0) {
      setEventRegistrations({});
      return;
    }

    const unsubs = preRegEventIds.map((eventId) =>
      onSnapshot(
        collection(db, "events", eventId, "registrations"),
        (snap) => {
          const rows: RegistrationDoc[] = snap.docs
            .map((d) => {
              const data = d.data() as Partial<RegistrationDoc>;
              return {
                id: d.id,
                uid: String(data.uid ?? d.id),
                schoolId: String(data.schoolId ?? ""),
                studentName: String(data.studentName ?? ""),
                course: String(data.course ?? ""),
                year: String(data.year ?? ""),
                createdAt: data.createdAt,
              };
            })
            .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));

          setEventRegistrations((prev) => ({ ...prev, [eventId]: rows }));
        },
        () => {
          setEventRegistrations((prev) => ({ ...prev, [eventId]: [] }));
        }
      )
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [events]);

  const filteredEvents = useMemo(() => {
    const s = searchText.trim().toLowerCase();
    return events.filter((ev) => {
      const liveStatus = computeStatus(ev);
      const matchesStatus = statusFilter === "all" || liveStatus === statusFilter;
      const matchesDate = !eventDateFilter || String(ev.date ?? "") === eventDateFilter;

      const matchesSearch =
        !s ||
        ev.title.toLowerCase().includes(s) ||
        (ev.location ?? "").toLowerCase().includes(s) ||
        (ev.targetStudent ?? "").toLowerCase().includes(s) ||
        (ev.details ?? "").toLowerCase().includes(s);

      return matchesStatus && matchesSearch && matchesDate;
    });
  }, [events, searchText, statusFilter, eventDateFilter]);

  const selectedNotifStudentIds = useMemo(
    () => new Set(selectedNotifStudents.map((student) => student.uid)),
    [selectedNotifStudents]
  );
  const selectedEventStudentIds = useMemo(
    () => new Set(selectedEventStudents.map((student) => student.uid)),
    [selectedEventStudents]
  );
  const selectedEventYearLevelsSet = useMemo(
    () => new Set(selectedEventYearLevels),
    [selectedEventYearLevels]
  );
  const selectedEventCoursesSet = useMemo(
    () => new Set(selectedEventCourses),
    [selectedEventCourses]
  );

  const filteredStudentOptions = useMemo(() => {
    if (recipientType !== "student") return [];

    const nameQuery = notifSearchName.trim().toLowerCase();
    const idQuery = notifSearchId.trim().toLowerCase();

    return studentOptions
      .filter((student) => {
        if (selectedNotifStudentIds.has(student.uid)) return false;
        const matchesName = !nameQuery || student.studentName.toLowerCase().includes(nameQuery);
        const matchesId = !idQuery || student.schoolId.toLowerCase().includes(idQuery);
        return matchesName && matchesId;
      })
      .slice(0, 20);
  }, [recipientType, notifSearchName, notifSearchId, studentOptions, selectedNotifStudentIds]);

  const filteredEventStudentOptions = useMemo(() => {
    const query = eventSearchName.trim().toLowerCase();
    return studentOptions
      .filter((student) => {
        if (selectedEventStudentIds.has(student.uid)) return false;
        if (!query) return true;
        return student.searchText.includes(query);
      })
      .slice(0, 20);
  }, [eventSearchName, studentOptions, selectedEventStudentIds]);

  const filteredEventYearOptions = useMemo(() => {
    const query = eventYearSearch.trim().toLowerCase();
    return EVENT_YEAR_LEVEL_CHOICES.filter((item) => {
      if (selectedEventYearLevelsSet.has(item)) return false;
      if (!query) return true;
      return item.toLowerCase().includes(query);
    }).slice(0, 20);
  }, [eventYearSearch, selectedEventYearLevelsSet]);

  const filteredEventCourseOptions = useMemo(() => {
    const query = eventCourseSearch.trim().toLowerCase();
    return EVENT_COURSE_CHOICES.filter((item) => {
      if (selectedEventCoursesSet.has(item)) return false;
      if (!query) return true;
      return item.toLowerCase().includes(query);
    }).slice(0, 20);
  }, [eventCourseSearch, selectedEventCoursesSet]);
  const showAllYearsOption = useMemo(() => {
    const query = eventYearSearch.trim().toLowerCase();
    return !query || "all years".includes(query);
  }, [eventYearSearch]);
  const showAllCoursesOption = useMemo(() => {
    const query = eventCourseSearch.trim().toLowerCase();
    return !query || "all courses".includes(query);
  }, [eventCourseSearch]);

  const filteredNotifications = useMemo(() => {
    const s = notificationSearchText.trim().toLowerCase();
    return notifications.filter((item) => {
      const matchesStatus = notificationStatusFilter === "all" || item.status === notificationStatusFilter;
      const matchesDate = !notificationDateFilter || item.date === notificationDateFilter;
      const matchesSearch =
        !s ||
        item.title.toLowerCase().includes(s) ||
        item.message.toLowerCase().includes(s) ||
        item.recipientType.toLowerCase().includes(s) ||
        item.targetStudent.toLowerCase().includes(s);

      return matchesStatus && matchesDate && matchesSearch;
    });
  }, [notifications, notificationSearchText, notificationStatusFilter, notificationDateFilter]);

  const sortedFilteredEvents = useMemo(() => {
    const list = [...filteredEvents];

    if (eventSortMode === "alphabetical") {
      list.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
      return list;
    }

    list.sort((a, b) => {
      const aMs = getDateTimeMs(a.date, a.scheduledTime || a.timeStart) || toMillis(a.createdAt);
      const bMs = getDateTimeMs(b.date, b.scheduledTime || b.timeStart) || toMillis(b.createdAt);
      return eventSortMode === "oldest_to_latest" ? aMs - bMs : bMs - aMs;
    });

    return list;
  }, [filteredEvents, eventSortMode]);

  const sortedFilteredNotifications = useMemo(() => {
    const list = [...filteredNotifications];

    if (notificationSortMode === "alphabetical") {
      list.sort((a, b) => (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" }));
      return list;
    }

    list.sort((a, b) => {
      const aMs = toMillis(a.createdAt) || getDateTimeMs(a.date, a.scheduledTime);
      const bMs = toMillis(b.createdAt) || getDateTimeMs(b.date, b.scheduledTime);
      return notificationSortMode === "oldest_to_latest" ? aMs - bMs : bMs - aMs;
    });

    return list;
  }, [filteredNotifications, notificationSortMode]);

  const eventTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedFilteredEvents.length / ITEMS_PER_PAGE)),
    [sortedFilteredEvents.length]
  );
  const paginatedEvents = useMemo(() => {
    const start = (eventPage - 1) * ITEMS_PER_PAGE;
    return sortedFilteredEvents.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedFilteredEvents, eventPage]);

  const notificationTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedFilteredNotifications.length / ITEMS_PER_PAGE)),
    [sortedFilteredNotifications.length]
  );
  const paginatedNotifications = useMemo(() => {
    const start = (notificationPage - 1) * ITEMS_PER_PAGE;
    return sortedFilteredNotifications.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedFilteredNotifications, notificationPage]);

  useEffect(() => {
    setEventPage(1);
  }, [searchText, statusFilter, eventDateFilter, eventSortMode]);

  useEffect(() => {
    setNotificationPage(1);
  }, [notificationSearchText, notificationStatusFilter, notificationDateFilter, notificationSortMode]);

  useEffect(() => {
    setEventPage((prev) => Math.min(Math.max(prev, 1), eventTotalPages));
  }, [eventTotalPages]);

  useEffect(() => {
    setNotificationPage((prev) => Math.min(Math.max(prev, 1), notificationTotalPages));
  }, [notificationTotalPages]);

  const eventSortLabel = useMemo(() => {
    if (eventSortMode === "oldest_to_latest") return "Date, old to new";
    if (eventSortMode === "alphabetical") return "Alphabetically, A-Z";
    return "Date, new to old";
  }, [eventSortMode]);

  const notificationSortLabel = useMemo(() => {
    if (notificationSortMode === "oldest_to_latest") return "Date, old to new";
    if (notificationSortMode === "alphabetical") return "Alphabetically, A-Z";
    return "Date, new to old";
  }, [notificationSortMode]);

  const summary = useMemo(() => {
    const total = events.length;
    const upcoming = events.filter((e) => computeStatus(e) === "upcoming").length;
    const ongoing = events.filter((e) => computeStatus(e) === "ongoing").length;
    const completed = events.filter((e) => computeStatus(e) === "completed").length;
    return { total, upcoming, ongoing, completed };
  }, [events]);

  const totalParticipants = useMemo(
    () => Object.values(eventRegistrations).reduce((sum, rows) => sum + rows.length, 0),
    [eventRegistrations]
  );
  const hasSpecificTarget = selectedEventStudents.length > 0;
  const eventYearLevelLabel = selectedEventYearLevels.length > 0 ? selectedEventYearLevels.join(", ") : "All Years";
  const eventCourseLabel = selectedEventCourses.length > 0 ? selectedEventCourses.join(", ") : "All Courses";
  const viewAllModalImages = viewAllFilesModal.eventId ? eventImages[viewAllFilesModal.eventId] ?? [] : [];
  const viewAllModalDocs = viewAllFilesModal.eventId ? eventDocs[viewAllFilesModal.eventId] ?? [] : [];

  const openViewAllFilesModal = (eventId: string, eventTitle: string, kind: EventFilesTab) => {
    setViewAllFilesModal({
      open: true,
      eventId,
      eventTitle,
      kind,
    });
  };

  const closeViewAllFilesModal = () => {
    setViewAllFilesModal((prev) => ({ ...prev, open: false }));
  };

  const statusChip = (status: EventStatus) => {
    if (status === "completed") return "bg-green-100 text-green-700";
    if (status === "ongoing") return "bg-orange-100 text-orange-700";
    return "bg-blue-100 text-blue-700";
  };

  const notifStatusChip = (status: NotificationListStatus) => {
    if (status === "scheduled") return "bg-blue-100 text-blue-700";
    return "bg-green-100 text-green-700";
  };

  const notifTargetLabel = (item: NotificationSummary) => {
    if (item.recipientType === "course") return `Course: ${item.course || "-"}`;
    if (item.recipientType === "year") return `Year: ${item.yearLevel || "-"}`;
    if (item.recipientType === "student") return `Students: ${item.targetStudent || "-"}`;
    return "All Students";
  };

  async function uploadToEvent(eventId: string, kind: "images" | "docs", file: File) {
    if (!currentUser) throw new Error("Not logged in");
    if (!isECUser) throw new Error("Only EC can upload");

    const safeName = file.name.replace(/[^\w.\-()+ ]/g, "_");
    const fileId = `${Date.now()}_${safeName}`;
    const path = `events/${eventId}/${kind}/${fileId}`;

    const storageRef = ref(storage, path);
    const snap = await uploadBytes(storageRef, file, { contentType: file.type });
    const downloadURL = await getDownloadURL(snap.ref);

    await addDoc(collection(db, "events", eventId, kind), {
      path,
      name: file.name,
      contentType: file.type,
      size: file.size,
      downloadURL,
      uploadedByUid: currentUser.uid,
      createdAt: serverTimestamp(),
    });

    return downloadURL;
  }

  function downloadEventFile(file: EventFile, fallbackName: string) {
    setUploadErr("");
    if (!file.downloadURL) {
      setUploadErr(`"${file.name || fallbackName}" has no download URL.`);
      return;
    }

    try {
      const safeName = String(file.name || fallbackName).trim() || fallbackName;
      const params = new URLSearchParams({ url: file.downloadURL, name: safeName });
      const anchor = document.createElement("a");
      anchor.href = `/api/download?${params.toString()}`;
      anchor.download = safeName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (e: any) {
      setUploadErr(e?.message || "Failed to start download.");
    }
  }

  async function handlePickFiles(
    eventId: string,
    kind: "images" | "docs",
    files: FileList | File[] | null
  ) {
    if (!files || files.length === 0) {
      const msg = "No files were selected.";
      setUploadErr(msg);
      addToast({
        title: "No files selected",
        description: msg,
        color: "warning",
        timeout: 4500,
      });
      return;
    }

    const pickedFiles = Array.isArray(files) ? files : Array.from(files);
    if (pickedFiles.length === 0) {
      const msg = "No files were selected.";
      setUploadErr(msg);
      addToast({
        title: "No files selected",
        description: msg,
        color: "warning",
        timeout: 4500,
      });
      return;
    }

    setUploadErr("");
    setUploadMsg(`Uploading ${pickedFiles.length} file${pickedFiles.length === 1 ? "" : "s"}...`);
    setUploadingFor(eventId);
    let uploaded = 0;
    const rejected: string[] = [];

    try {
      for (const file of pickedFiles) {
        if (kind === "images") {
          if (!file.type.startsWith("image/")) {
            rejected.push(`${file.name}: only image files are allowed.`);
            continue;
          }

          let compressed: File;
          try {
            compressed = await compressImageForUpload(file, MAX_EVENT_FILE_SIZE_BYTES);
          } catch (e: any) {
            rejected.push(`${file.name}: ${e?.message || "Image compression failed."}`);
            continue;
          }

          if (compressed.size > MAX_EVENT_FILE_SIZE_BYTES) {
            rejected.push(
              `${file.name}: still ${toMegabytesText(compressed.size)} after compression. Max is 10MB.`
            );
            continue;
          }

          try {
            await uploadToEvent(eventId, kind, compressed);
            uploaded += 1;
          } catch (e: any) {
            rejected.push(`${file.name}: ${e?.message || "Upload failed."}`);
          }
          continue;
        }

        if (!isAllowedEventDocument(file)) {
          rejected.push(`${file.name}: only PDF, DOC, or DOCX files are allowed.`);
          continue;
        }

        if (file.size > MAX_EVENT_FILE_SIZE_BYTES) {
          rejected.push(`${file.name}: exceeds 10MB.`);
          continue;
        }

        try {
          await uploadToEvent(eventId, kind, file);
          uploaded += 1;
        } catch (e: any) {
          rejected.push(`${file.name}: ${e?.message || "Upload failed."}`);
        }
      }
    } catch (e: any) {
      const msg = e?.message || "Unexpected upload error.";
      rejected.push(msg);
    } finally {
      setUploadingFor(null);
    }

    if (uploaded > 0) {
      const successMsg = `Uploaded ${uploaded} file${uploaded === 1 ? "" : "s"}${kind === "images" ? " (auto-compressed)." : "."}`;
      setUploadMsg(successMsg);
      addToast({
        title: "Upload complete",
        description: successMsg,
        color: "success",
        timeout: 4500,
      });
    }

    if (rejected.length > 0) {
      const preview = rejected.slice(0, 2).join(" ");
      const overflow = rejected.length > 2 ? ` (+${rejected.length - 2} more)` : "";
      const errorMsg = `${preview}${overflow}`;
      setUploadErr(errorMsg);
      addToast({
        title: uploaded > 0 ? "Some files were not uploaded" : "Upload failed",
        description: errorMsg,
        color: uploaded > 0 ? "warning" : "danger",
        timeout: 7000,
      });
    }

    if (uploaded === 0 && rejected.length === 0) {
      const msg = "No files were uploaded.";
      setUploadErr(msg);
      addToast({
        title: "Upload failed",
        description: msg,
        color: "danger",
        timeout: 5000,
      });
    }
  }

  function handleFileInputChange(
    eventId: string,
    kind: "images" | "docs",
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const pickedFiles = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";

    if (pickedFiles.length > 0) {
      addToast({
        title: kind === "images" ? "Preparing image upload" : "Preparing document upload",
        description: `${pickedFiles.length} file${pickedFiles.length === 1 ? "" : "s"} selected.`,
        color: "success",
        timeout: 2500,
      });
    }

    void handlePickFiles(eventId, kind, pickedFiles);
  }

  async function deleteEventFile(eventId: string, kind: "images" | "docs", fileDocId: string, path: string) {
    if (!isECUser) return;
    await deleteObject(ref(storage, path));
    await deleteDoc(doc(db, "events", eventId, kind, fileDocId));
  }

  const handleSendNotification = async () => {
    setNotifError("");
    setNotifMsg("");

    if (roleLoading) return setNotifError("Checking your role, please wait...");
    if (!isECUser) return setNotifError("Only EC members can send notifications.");
    if (!notifTitle.trim()) return setNotifError("Notification title is required.");
    if (!notifDate) return setNotifError("Notification date is required.");
    if (!notifMessage.trim()) return setNotifError("Notification message is required.");

    let students = studentOptions;
    if (studentsLoading && students.length === 0) {
      return setNotifError("Students are still loading. Please wait.");
    }
    if (students.length === 0) {
      students = await loadStudentsForNotifications();
    }
    if (students.length === 0) return setNotifError("No student records found.");

    let recipients: StudentLookup[] = [];

    if (recipientType === "all") {
      recipients = students;
    } else if (recipientType === "course") {
      recipients = students.filter((s) => s.course === notifCourse);
    } else if (recipientType === "year") {
      recipients = students.filter((s) => s.year === notifYear);
    } else {
      if (selectedNotifStudents.length === 0) {
        return setNotifError("Choose at least one student from the dropdown list.");
      }
      recipients = selectedNotifStudents;
    }

    if (recipients.length === 0) {
      if (recipientType === "course") return setNotifError(`No students found in ${notifCourse}.`);
      if (recipientType === "year") return setNotifError(`No students found in ${notifYear}.`);
      return setNotifError("No recipients found.");
    }

    const title = notifTitle.trim();
    const message = notifMessage.trim();
    const scheduledTime = format12h(notifScheduled24);
    const dispatchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const selectedLabel =
      recipientType === "student"
        ? recipients.map((student) => `${student.studentName} (${student.schoolId})`).join("; ")
        : "";

    try {
      setSendingNotif(true);
      const chunkSize = 400;

      for (let i = 0; i < recipients.length; i += chunkSize) {
        const chunk = recipients.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        chunk.forEach((student) => {
          const notifRef = doc(collection(db, "profiles", student.uid, "notifications"));
          batch.set(notifRef, {
            title,
            message,
            date: notifDate,
            scheduledTime,
            type: "announcement",
            dispatchId,
            recipientType,
            course: recipientType === "course" ? notifCourse : "",
            yearLevel: recipientType === "year" ? notifYear : "",
            targetStudent: recipientType === "student" ? selectedLabel : "",
            studentUid: student.uid,
            studentName: student.studentName,
            schoolId: student.schoolId,
            createdByUid: currentUser ? currentUser.uid : null,
            createdAt: serverTimestamp(),
            read: false,
          });
        });

        await batch.commit();
      }

      if (currentUser?.uid) {
        await setDoc(doc(db, "profiles", currentUser.uid, "notifications", `dispatch_${dispatchId}`), {
          title,
          message,
          date: notifDate,
          scheduledTime,
          type: "announcement",
          dispatchId,
          recipientType,
          course: recipientType === "course" ? notifCourse : "",
          yearLevel: recipientType === "year" ? notifYear : "",
          targetStudent: recipientType === "student" ? selectedLabel : "",
          recipientCount: recipients.length,
          createdByUid: currentUser.uid,
          createdAt: serverTimestamp(),
          read: true,
        });
      }

      const optimisticCreatedAt = new Date();
      const optimisticRow: NotificationSummary = {
        id: dispatchId,
        dispatchId,
        title,
        message,
        date: notifDate,
        scheduledTime,
        recipientType,
        course: recipientType === "course" ? notifCourse : "",
        yearLevel: recipientType === "year" ? notifYear : "",
        targetStudent: recipientType === "student" ? selectedLabel : "",
        createdAt: optimisticCreatedAt,
        recipientCount: recipients.length,
        status: computeNotificationStatus(notifDate, scheduledTime),
      };

      setNotifications((prev) => {
        const next = [optimisticRow, ...prev.filter((item) => item.dispatchId !== dispatchId)];
        return next.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      });
      setNotificationPage(1);
      void refreshSentNotificationsOnce();

      setNotifMsg(`Notification sent to ${recipients.length} student(s).`);
      setNotifTitle("");
      const nextNotifDate = isoDateToday();
      const nextNotifTime = now24h();
      setNotifDate(nextNotifDate);
      setNotifDateValue(toCalendarDate(nextNotifDate));
      setNotifMessage("");
      setNotifSearchName("");
      setNotifSearchId("");
      setSelectedNotifStudents([]);
      setShowStudentDropdown(false);
      setNotifScheduled24(nextNotifTime);
      setNotifScheduledValue(toTimeValue(nextNotifTime));
      setRecipientType("all");
      setNotifCourse("Computer Engineering");
      setNotifYear("1st Year");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to send notification.";
      setNotifError(message);
    } finally {
      setSendingNotif(false);
    }
  };

  const handleSaveEvent = async () => {
    setSaveError("");
    setSaveMsg("");

    if (roleLoading) return setSaveError("Checking your role, please wait...");
    if (!isECUser) return setSaveError("Only EC members can create events.");
    if (!title.trim()) return setSaveError("Title is required.");
    if (!date) return setSaveError("Date is required.");
    if (toMinutesFrom24h(eventEnd24) <= toMinutesFrom24h(eventScheduled24)) {
      return setSaveError("End time must be later than start time.");
    }
    if (isPreReg && (Number.isNaN(preRegSlots) || preRegSlots < 0)) {
      return setSaveError("Pre-reg slots must be at least 0.");
    }

    try {
      setSaving(true);
      const slots = isPreReg ? preRegSlots : null;
      const studentTarget = selectedEventStudents
        .map((student) => `${student.studentName} (${student.schoolId})`)
        .join("; ");
      const startTime = format12h(eventScheduled24);
      const endTime = format12h(eventEnd24);
      const yearLevelValue = selectedEventYearLevels.length > 0 ? selectedEventYearLevels.join(", ") : "All Years";
      const courseValue = selectedEventCourses.length > 0 ? selectedEventCourses.join(", ") : "All Courses";

      await addDoc(collection(db, "events"), {
        title: title.trim(),
        location: location.trim(),
        date,
        scheduledTime: startTime,
        timeStart: startTime,
        timeEnd: endTime,

        yearLevel: isPreReg ? "All Years" : yearLevelValue,
        course: isPreReg ? "All Courses" : courseValue,
        yearLevels: isPreReg ? [] : selectedEventYearLevels,
        courses: isPreReg ? [] : selectedEventCourses,
        targetStudent: isPreReg ? "" : studentTarget,

        details: details.trim(),
        isPreReg,
        withPayment,

        preRegSlots: slots,
        preRegCount: 0,
        preRegRemaining: isPreReg ? slots : 0,

        createdBy: currentUser ? currentUser.uid : null,
        createdAt: serverTimestamp(),
        status: "upcoming",
      });

      setSaveMsg("Event saved!");

      setTitle("");
      setLocation("");
      const nextEventDate = isoDateToday();
      setDate(nextEventDate);
      setEventDateValue(toCalendarDate(nextEventDate));
      setSelectedEventYearLevels([]);
      setSelectedEventCourses([]);
      setIsAllYearsExplicit(false);
      setIsAllCoursesExplicit(false);
      setDetails("");
      setIsPreReg(false);
      setWithPayment(false);
      setSelectedEventStudents([]);
      setEventYearSearch("");
      setEventCourseSearch("");
      setEventSearchName("");
      setShowEventYearDropdown(false);
      setShowEventCourseDropdown(false);
      setShowEventStudentDropdown(false);
      setPreRegSlots(50);
      setEventScheduled24("07:00");
      setEventStartTimeValue(toTimeValue("07:00"));
      setEventEnd24("08:00");
      setEventEndTimeValue(toTimeValue("08:00"));
      setShowAddEventForm(false);
    } catch (err: any) {
      setSaveError(err?.message || "Failed to save event.");
    } finally {
      setSaving(false);
    }
  };

  const exportEventAttendanceCSV = async (ev: EventDoc) => {
    setExportMsg("");
    setExportError("");
    setExportingEventId(ev.id);

    try {
      const [attendanceSnap, registrationsSnap] = await Promise.all([
        getDocs(collection(db, "events", ev.id, "attendance")),
        getDocs(collection(db, "events", ev.id, "registrations")),
      ]);

      const rowsByUid = new Map<
        string,
        {
          uid: string;
          schoolId: string;
          studentName: string;
          course: string;
          year: string;
          registrationTime: string;
          attendanceStatus: string;
          attendanceTime: string;
        }
      >();

      registrationsSnap.docs.forEach((d) => {
        const data = d.data() as Partial<RegistrationDoc>;
        const uid = String(data.uid ?? d.id);
        if (!uid) return;

        rowsByUid.set(uid, {
          uid,
          schoolId: String(data.schoolId ?? ""),
          studentName: String(data.studentName ?? ""),
          course: String(data.course ?? ""),
          year: String(data.year ?? ""),
          registrationTime: formatDateTime(data.createdAt),
          attendanceStatus: "Registered",
          attendanceTime: "-",
        });
      });

      attendanceSnap.docs.forEach((d) => {
        const data = d.data() as {
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
          createdAt?: any;
          updatedAt?: any;
        };

        const uid = String(data.uid ?? data.studentUid ?? d.id);
        if (!uid) return;

        const existing = rowsByUid.get(uid);
        const fallbackStatus = typeof data.present === "boolean" ? (data.present ? "Present" : "Absent") : "";
        const status = String(data.status ?? data.attendanceStatus ?? fallbackStatus ?? "").trim() || "Recorded";

        rowsByUid.set(uid, {
          uid,
          schoolId: String(data.schoolId ?? existing?.schoolId ?? ""),
          studentName: String(data.studentName ?? data.name ?? existing?.studentName ?? ""),
          course: String(data.course ?? existing?.course ?? ""),
          year: String(data.year ?? existing?.year ?? ""),
          registrationTime: existing?.registrationTime ?? "-",
          attendanceStatus: status,
          attendanceTime: formatDateTime(data.updatedAt ?? data.createdAt),
        });
      });

      const rows = Array.from(rowsByUid.values()).sort((a, b) => {
        const byName = a.studentName.localeCompare(b.studentName);
        if (byName !== 0) return byName;
        return a.uid.localeCompare(b.uid);
      });

      if (rows.length === 0) {
        setExportError("No registration or attendance records found for this event.");
        return;
      }

      const csvLines = [
        `Event Title,${csvCell(ev.title)}`,
        `Date,${csvCell(ev.date)}`,
        `Scheduled Time,${csvCell(ev.scheduledTime || ev.timeStart || "-")}`,
        `Location,${csvCell(ev.location ?? "-")}`,
        `Target Student,${csvCell(ev.targetStudent || "-")}`,
        `Generated At,${csvCell(new Date().toLocaleString())}`,
        "",
        "UID,School ID,Student Name,Course,Year,Registration Time,Attendance Status,Attendance Time",
        ...rows.map((row) =>
          [
            csvCell(row.uid),
            csvCell(row.schoolId),
            csvCell(row.studentName),
            csvCell(row.course),
            csvCell(row.year),
            csvCell(row.registrationTime),
            csvCell(row.attendanceStatus),
            csvCell(row.attendanceTime),
          ].join(",")
        ),
      ];

      const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = (ev.title || ev.id)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      a.href = url;
      a.download = `${slug || ev.id}-attendance.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setExportMsg(`Exported ${rows.length} row(s) for "${ev.title}".`);
    } catch (err: any) {
      setExportError(err?.message || "Failed to export attendance.");
    } finally {
      setExportingEventId(null);
    }
  };

  return (
    <div className="px-3 py-4 sm:p-6 space-y-4 sm:space-y-6">
      {/* HEADER */}
      <div className="bg-white sm:bg-transparent border sm:border-0 rounded-xl sm:rounded-none shadow-sm sm:shadow-none p-4 sm:p-0">
        <h1 className="text-lg sm:text-2xl font-bold text-primary-900 leading-tight">Campus Event Management System</h1>
        <p className="text-campus-text-secondary text-xs sm:text-sm mt-1">
          Organize, manage, and track all campus events in one centralized dashboard.
        </p>
      </div>

      {/* SUMMARY */}
      <div className="bg-white border rounded-xl shadow-sm p-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <StatMini label="Total" value={summary.total} />
          <StatMini label="Upcoming" value={summary.upcoming} />
          <StatMini label="Ongoing" value={summary.ongoing} />
          <StatMini label="Completed" value={summary.completed} />
          <StatMini label="Participants" value={totalParticipants} />
        </div>
      </div>

      {/* ACTIONS */}
      <div className="bg-white border rounded-xl shadow-sm p-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            color="primary"
            className="text-sm font-semibold"
            onPress={() =>
              setShowNotificationForm((v) => {
                const next = !v;
                if (next) {
                  const nextNotifDate = isoDateToday();
                  const nextNotifTime = now24h();
                  setNotifDate(nextNotifDate);
                  setNotifDateValue(toCalendarDate(nextNotifDate));
                  setNotifScheduled24(nextNotifTime);
                  setNotifScheduledValue(toTimeValue(nextNotifTime));
                  setShowAddEventForm(false);
                }
                return next;
              })
            }
          >
            Create notification
          </Button>

          <Button
            color="primary"
            className="text-sm font-semibold"
            onPress={() =>
              setShowAddEventForm((v) => {
                const next = !v;
                if (next) {
                  const nextEventDate = isoDateToday();
                  setDate(nextEventDate);
                  setEventDateValue(toCalendarDate(nextEventDate));
                  setShowNotificationForm(false);
                }
                return next;
              })
            }
          >
            Create Event
          </Button>
        </div>
      </div>

      {/* ADD EVENT FORM */}
      {showAddEventForm && (
        <div className="bg-white p-4 sm:p-6 border rounded-xl shadow space-y-4 animate-slideDown">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <h2 className="text-xl font-semibold text-primary-900">Add New Event</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Switch
                isSelected={isPreReg}
                onValueChange={(checked) => {
                  setIsPreReg(checked);
                  if (checked) {
                    setRegistrantsModalOpen(false);
                    setSelectedEventYearLevels([]);
                    setSelectedEventCourses([]);
                    setIsAllYearsExplicit(false);
                    setIsAllCoursesExplicit(false);
                    setSelectedEventStudents([]);
                    setEventYearSearch("");
                    setEventCourseSearch("");
                    setEventSearchName("");
                    setShowEventYearDropdown(false);
                    setShowEventCourseDropdown(false);
                    setShowEventStudentDropdown(false);
                  }
                }}
              >
                Pre-Registration
              </Switch>

              <Switch
                isSelected={withPayment}
                onValueChange={(checked) => setWithPayment(checked)}
              >
                With Payment
              </Switch>
            </div>
          </div>
          
          <div>
            <label className="text-sm font-medium">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm" />
          </div>

          <div>
            <label className="text-sm font-medium">Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm" />
          </div>

          <div>
            <label className="text-sm font-medium">Date</label>
            <DatePicker
              aria-label="Event date"
              className="w-full mt-1"
              value={eventDateValue}
              onChange={(value) => {
                setEventDateValue(value);
                setDate(toIsoDate(value));
              }}
              granularity="day"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium">Start Time</label>
              <TimeInput
                aria-label="Event start time"
                className="w-full mt-1"
                value={eventStartTimeValue}
                onChange={(value) => {
                  setEventStartTimeValue(value);
                  setEventScheduled24(to24hStringFromValue(value));
                }}
                granularity="minute"
              />
            </div>

            <div>
              <label className="text-sm font-medium">End Time</label>
              <TimeInput
                aria-label="Event end time"
                className="w-full mt-1"
                value={eventEndTimeValue}
                onChange={(value) => {
                  setEventEndTimeValue(value);
                  setEventEnd24(to24hStringFromValue(value));
                }}
                granularity="minute"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Registrants</label>
            <Button
              variant="bordered"
              className="w-full justify-between"
              isDisabled={isPreReg}
              onPress={() => {
                setShowEventYearDropdown(false);
                setShowEventCourseDropdown(false);
                setShowEventStudentDropdown(false);
                setRegistrantsModalOpen(true);
              }}
            >
              Registrants
            </Button>
            <Modal
              isOpen={registrantsModalOpen}
              onOpenChange={(open) => {
                setRegistrantsModalOpen(open);
                if (!open) {
                  setShowEventYearDropdown(false);
                  setShowEventCourseDropdown(false);
                  setShowEventStudentDropdown(false);
                }
              }}
              size="2xl"
              scrollBehavior="inside"
            >
              <ModalContent>
                {(onClose) => (
                  <>
                    <ModalHeader>Registrants</ModalHeader>
                    <ModalBody>
                      <div className="space-y-3">
                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">Year Level</label>

                          {(isAllYearsExplicit || selectedEventYearLevels.length > 0) && (
                            <div className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isPreReg ? "bg-gray-100" : "bg-white"}`}>
                              <div className="flex flex-wrap gap-2">
                                {isAllYearsExplicit && selectedEventYearLevels.length === 0 ? (
                                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">All Years</span>
                                    <button
                                      type="button"
                                      className="text-campus-text-secondary hover:text-campus-text-primary"
                                      onClick={() => {
                                        setIsAllYearsExplicit(false);
                                      }}
                                      aria-label="Remove All Years"
                                    >
                                      x
                                    </button>
                                  </span>
                                ) : (
                                  selectedEventYearLevels.map((item) => (
                                    <span key={item} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                      <span className="font-medium">{item}</span>
                                      <button
                                        type="button"
                                        className="text-campus-text-secondary hover:text-campus-text-primary"
                                        onClick={() => {
                                          setIsAllYearsExplicit(false);
                                          setSelectedEventYearLevels((prev) => prev.filter((x) => x !== item));
                                        }}
                                        aria-label={`Remove ${item}`}
                                      >
                                        x
                                      </button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          <div ref={eventYearPickerRef} className="mt-2 space-y-2">
                            <input
                              value={eventYearSearch}
                              onChange={(e) => {
                                setEventYearSearch(e.target.value);
                                setShowEventYearDropdown(true);
                              }}
                              onFocus={() => setShowEventYearDropdown(true)}
                              disabled={isPreReg}
                              placeholder="Search year level"
                              className={`w-full px-3 py-2 border rounded-lg text-sm ${
                                isPreReg ? "bg-gray-100 text-campus-text-secondary cursor-not-allowed" : ""
                              }`}
                            />

                            {!isPreReg && showEventYearDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {!showAllYearsOption && filteredEventYearOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                    {selectedEventYearLevels.length === EVENT_YEAR_LEVEL_CHOICES.length
                                      ? "All year levels selected."
                                      : "No matching year levels."}
                                  </p>
                                ) : (
                                  <>
                                    {showAllYearsOption && (
                                      <button
                                        type="button"
                                        className="w-full text-left px-4 py-2 hover:bg-gray-100"
                                        onClick={() => {
                                          setSelectedEventYearLevels([]);
                                          setIsAllYearsExplicit(true);
                                          setEventYearSearch("");
                                          setShowEventYearDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">All Years</div>
                                      </button>
                                    )}

                                    {filteredEventYearOptions.map((item) => (
                                      <button
                                        key={item}
                                        type="button"
                                        className="w-full text-left px-4 py-2 hover:bg-gray-100"
                                        onClick={() => {
                                          setIsAllYearsExplicit(false);
                                          setSelectedEventYearLevels((prev) => (prev.includes(item) ? prev : [...prev, item]));
                                          setEventYearSearch("");
                                          setShowEventYearDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">{item}</div>
                                      </button>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">Course</label>

                          {(isAllCoursesExplicit || selectedEventCourses.length > 0) && (
                            <div className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isPreReg ? "bg-gray-100" : "bg-white"}`}>
                              <div className="flex flex-wrap gap-2">
                                {isAllCoursesExplicit && selectedEventCourses.length === 0 ? (
                                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">All Courses</span>
                                    <button
                                      type="button"
                                      className="text-campus-text-secondary hover:text-campus-text-primary"
                                      onClick={() => {
                                        setIsAllCoursesExplicit(false);
                                      }}
                                      aria-label="Remove All Courses"
                                    >
                                      x
                                    </button>
                                  </span>
                                ) : (
                                  selectedEventCourses.map((item) => (
                                    <span key={item} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                      <span className="font-medium">{item}</span>
                                      <button
                                        type="button"
                                        className="text-campus-text-secondary hover:text-campus-text-primary"
                                        onClick={() => {
                                          setIsAllCoursesExplicit(false);
                                          setSelectedEventCourses((prev) => prev.filter((x) => x !== item));
                                        }}
                                        aria-label={`Remove ${item}`}
                                      >
                                        x
                                      </button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          <div ref={eventCoursePickerRef} className="mt-2 space-y-2">
                            <input
                              value={eventCourseSearch}
                              onChange={(e) => {
                                setEventCourseSearch(e.target.value);
                                setShowEventCourseDropdown(true);
                              }}
                              onFocus={() => setShowEventCourseDropdown(true)}
                              disabled={isPreReg}
                              placeholder="Search course"
                              className={`w-full px-3 py-2 border rounded-lg text-sm ${
                                isPreReg ? "bg-gray-100 text-campus-text-secondary cursor-not-allowed" : ""
                              }`}
                            />

                            {!isPreReg && showEventCourseDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {!showAllCoursesOption && filteredEventCourseOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                    {selectedEventCourses.length === EVENT_COURSE_CHOICES.length
                                      ? "All courses selected."
                                      : "No matching courses."}
                                  </p>
                                ) : (
                                  <>
                                    {showAllCoursesOption && (
                                      <button
                                        type="button"
                                        className="w-full text-left px-4 py-2 hover:bg-gray-100"
                                        onClick={() => {
                                          setSelectedEventCourses([]);
                                          setIsAllCoursesExplicit(true);
                                          setEventCourseSearch("");
                                          setShowEventCourseDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">All Courses</div>
                                      </button>
                                    )}

                                    {filteredEventCourseOptions.map((item) => (
                                      <button
                                        key={item}
                                        type="button"
                                        className="w-full text-left px-4 py-2 hover:bg-gray-100"
                                        onClick={() => {
                                          setIsAllCoursesExplicit(false);
                                          setSelectedEventCourses((prev) => (prev.includes(item) ? prev : [...prev, item]));
                                          setEventCourseSearch("");
                                          setShowEventCourseDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">{item}</div>
                                      </button>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">To *</label>

                          {selectedEventStudents.length > 0 && (
                            <div className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isPreReg ? "bg-gray-100" : "bg-white"}`}>
                              <div className="flex flex-wrap gap-2">
                                {selectedEventStudents.map((student) => (
                                  <span key={student.uid} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">{student.studentName}</span>
                                    <span className="text-campus-text-secondary">({student.schoolId})</span>
                                    <button
                                      type="button"
                                      className="text-campus-text-secondary hover:text-campus-text-primary"
                                      onClick={() => {
                                        setSelectedEventStudents((prev) => prev.filter((x) => x.uid !== student.uid));
                                      }}
                                      aria-label={`Remove ${student.studentName}`}
                                    >
                                      x
                                    </button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div ref={eventStudentPickerRef} className="mt-2 space-y-2">
                            <input
                              value={eventSearchName}
                              onChange={(e) => {
                                setEventSearchName(e.target.value);
                                setShowEventStudentDropdown(true);
                              }}
                              onFocus={() => setShowEventStudentDropdown(true)}
                              disabled={isPreReg}
                              placeholder="Search by name"
                              className={`w-full px-3 py-2 border rounded-lg text-sm ${isPreReg ? "bg-gray-100 text-campus-text-secondary cursor-not-allowed" : ""}`}
                            />

                            {!isPreReg && showEventStudentDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {studentsLoading ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">Loading students...</p>
                                ) : filteredEventStudentOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">No matching students.</p>
                                ) : (
                                  filteredEventStudentOptions.map((student) => (
                                    <button
                                      key={student.uid}
                                      type="button"
                                      className="w-full text-left px-4 py-2 hover:bg-gray-100"
                                      onClick={() => {
                                        setSelectedEventStudents((prev) =>
                                          prev.some((x) => x.uid === student.uid) ? prev : [...prev, student]
                                        );
                                        setEventSearchName("");
                                        setShowEventStudentDropdown(true);
                                      }}
                                    >
                                      <div className="text-sm font-medium text-campus-text-primary">{student.studentName}</div>
                                      <div className="text-xs text-campus-text-secondary">
                                        {student.schoolId} | {student.course || "Unassigned"} | {student.year || "Unassigned"}
                                      </div>
                                    </button>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </ModalBody>
                    <ModalFooter>
                      <Button
                        variant="light"
                        onPress={() => {
                          setShowEventYearDropdown(false);
                          setShowEventCourseDropdown(false);
                          setShowEventStudentDropdown(false);
                          onClose();
                        }}
                      >
                        Done
                      </Button>
                    </ModalFooter>
                  </>
                )}
              </ModalContent>
            </Modal>

            {isPreReg && <p className="text-xs text-campus-text-secondary">Pre-Registration events are open to all year levels and courses.</p>}
            {!isPreReg && hasSpecificTarget && (
              <p className="text-xs text-campus-text-secondary">Year Level and Course are optional when targeting specific students.</p>
            )}
            {!isPreReg && (
              <p className="text-xs text-campus-text-secondary">
                Current filters: Year Level - {eventYearLevelLabel}; Course - {eventCourseLabel}.
              </p>
            )}
            <p className="text-xs text-campus-text-secondary">
              Choose one or more specific students if needed. You can still set Year Level and Course filters.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Details</label>
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} className="w-full h-28 mt-1 px-4 py-3 border rounded-lg shadow-sm" />
          </div>

          {isPreReg && (
            <div>
              <label className="text-sm font-medium">Pre-Registration Slots</label>
              <Input
                aria-label="Pre-registration slots"
                type="number"
                min={0}
                step={1}
                value={String(preRegSlots)}
                onValueChange={(value) => {
                  const parsed = Number(value);
                  if (Number.isNaN(parsed)) {
                    setPreRegSlots(0);
                    return;
                  }

                  setPreRegSlots(Math.max(0, Math.trunc(parsed)));
                }}
                className="w-full mt-1"
                placeholder="e.g. 100"
              />
              <p className="text-xs text-campus-text-secondary mt-1">This is the maximum number of students allowed to pre-register.</p>
            </div>
          )}

          {saveError && <p className="text-red-600 text-sm">{saveError}</p>}
          {saveMsg && <p className="text-green-600 text-sm">{saveMsg}</p>}

          <button
            onClick={handleSaveEvent}
            disabled={saving || roleLoading || !isECUser}
            className="w-full px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-60"
          >
            {roleLoading ? "Checking role..." : saving ? "Saving..." : "Save"}
          </button>

          {!roleLoading && !isECUser && (
            <p className="text-xs text-campus-text-secondary">
              Your Firestore role is not <b>ec</b> in <code>profiles/{`{uid}`}</code>.
            </p>
          )}
        </div>
      )}

      {/* NOTIFICATION FORM */}
      {showNotificationForm && (
        <div className="bg-white p-4 sm:p-6 border rounded-xl shadow space-y-4 animate-slideDown">
          <h2 className="text-xl font-semibold text-blue-600">Create Notification</h2>

          <div>
            <label className="text-sm font-medium">Notification Title</label>
            <input value={notifTitle} onChange={(e) => setNotifTitle(e.target.value)} type="text" className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm" />
          </div>

          <div>
            <label className="text-sm font-medium">Date</label>
            <DatePicker
              aria-label="Notification date"
              className="w-full mt-1"
              value={notifDateValue}
              onChange={(value) => {
                setNotifDateValue(value);
                setNotifDate(toIsoDate(value));
              }}
              granularity="day"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Scheduled Time</label>
            <TimeInput
              aria-label="Notification scheduled time"
              className="w-full mt-1"
              value={notifScheduledValue}
              onChange={(value) => {
                setNotifScheduledValue(value);
                setNotifScheduled24(to24hStringFromValue(value));
              }}
              granularity="minute"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Send To</label>
            <select
              className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm"
              value={recipientType}
              onChange={(e) => {
                setRecipientType(e.target.value as any);
                setNotifSearchName("");
                setNotifSearchId("");
                setSelectedNotifStudents([]);
                setShowStudentDropdown(false);
              }}
            >
              <option value="all">All Students</option>
              <option value="course">By Course</option>
              <option value="year">By Year Level</option>
              <option value="student">Specific Student (ID/Name)</option>
            </select>
          </div>

          {recipientType === "course" && (
            <div>
              <label className="text-sm font-medium">Select Course</label>
              <select value={notifCourse} onChange={(e) => setNotifCourse(e.target.value)} className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm">
                <option>Computer Engineering</option>
                <option>Mechanical Engineering</option>
                <option>Electrical Engineering</option>
                <option>Electronics Engineering</option>
                <option>Industrial Engineering</option>
              </select>
            </div>
          )}

          {recipientType === "year" && (
            <div>
              <label className="text-sm font-medium">Select Year Level</label>
              <select value={notifYear} onChange={(e) => setNotifYear(e.target.value)} className="w-full mt-1 px-4 py-3 border rounded-lg shadow-sm">
                <option>1st Year</option>
                <option>2nd Year</option>
                <option>3rd Year</option>
                <option>4th Year</option>
              </select>
            </div>
          )}

          {recipientType === "student" && (
            <div>
              <label className="text-sm font-medium">To *</label>

              <div className="mt-1 rounded-lg border px-3 py-2 shadow-sm min-h-[52px]">
                <div className="flex flex-wrap gap-2">
                  {selectedNotifStudents.length === 0 ? (
                    <span className="text-sm text-campus-text-secondary">No student selected yet.</span>
                  ) : (
                    selectedNotifStudents.map((student) => (
                      <span key={student.uid} className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                        <span className="font-medium">{student.studentName}</span>
                        <span className="text-campus-text-secondary">({student.schoolId})</span>
                        <button
                          type="button"
                          className="text-campus-text-secondary hover:text-campus-text-primary"
                          onClick={() => {
                            setSelectedNotifStudents((prev) => prev.filter((x) => x.uid !== student.uid));
                          }}
                          aria-label={`Remove ${student.studentName}`}
                        >
                          x
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div ref={studentPickerRef} className="mt-2 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <input
                    value={notifSearchName}
                    onChange={(e) => {
                      setNotifSearchName(e.target.value);
                      setShowStudentDropdown(true);
                    }}
                    onFocus={() => setShowStudentDropdown(true)}
                    placeholder="Search by name"
                    className="w-full px-4 py-3 border rounded-lg shadow-sm"
                  />

                  <input
                    value={notifSearchId}
                    onChange={(e) => {
                      setNotifSearchId(e.target.value);
                      setShowStudentDropdown(true);
                    }}
                    onFocus={() => setShowStudentDropdown(true)}
                    placeholder="Search by ID number"
                    className="w-full px-4 py-3 border rounded-lg shadow-sm"
                  />
                </div>

                {showStudentDropdown && (
                  <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                    {studentsLoading ? (
                      <p className="px-4 py-2 text-sm text-campus-text-secondary">Loading students...</p>
                    ) : filteredStudentOptions.length === 0 ? (
                      <p className="px-4 py-2 text-sm text-campus-text-secondary">No matching students.</p>
                    ) : (
                      filteredStudentOptions.map((student) => (
                        <button
                          key={student.uid}
                          type="button"
                          className="w-full text-left px-4 py-2 hover:bg-gray-100"
                          onClick={() => {
                            setSelectedNotifStudents((prev) =>
                              prev.some((x) => x.uid === student.uid) ? prev : [...prev, student]
                            );
                            setNotifSearchName("");
                            setNotifSearchId("");
                            setShowStudentDropdown(true);
                          }}
                        >
                          <div className="text-sm font-medium text-campus-text-primary">{student.studentName}</div>
                          <div className="text-xs text-campus-text-secondary">
                            {student.schoolId} | {student.course || "Unassigned"} | {student.year || "Unassigned"}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Message</label>
            <textarea value={notifMessage} onChange={(e) => setNotifMessage(e.target.value)} className="w-full h-28 mt-1 px-4 py-3 border rounded-lg shadow-sm" />
          </div>

          {studentsError && <p className="text-red-600 text-sm">{studentsError}</p>}
          {notifError && <p className="text-red-600 text-sm">{notifError}</p>}
          {notifMsg && <p className="text-green-600 text-sm">{notifMsg}</p>}

          <button
            type="button"
            onClick={handleSendNotification}
            disabled={sendingNotif || roleLoading || !isECUser}
            className="w-full sm:w-auto px-6 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 disabled:opacity-60"
          >
            {sendingNotif ? "Sending..." : "Send Notification"}
          </button>
        </div>
      )}

      {/* LIST TABS */}
      <div className="bg-white border rounded-xl shadow-sm p-4 sm:p-6">
        <Tabs
          aria-label="Dashboard lists"
          fullWidth
          selectedKey={listTab}
          onSelectionChange={(key) => setListTab(String(key) as "events" | "notifications")}
          classNames={{
            tabList: "mb-4 w-full grid grid-cols-2",
            tab: "w-full min-w-0 px-2",
            tabContent: "truncate text-xs sm:text-sm",
          }}
        >
          <Tab
            key="events"
            title={
              <span className="whitespace-nowrap">
                <span className="sm:hidden">Events</span>
                <span className="hidden sm:inline">Event List</span>
              </span>
            }
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Search events..."
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />

                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="all">All Status</option>
                  <option value="upcoming">Upcoming</option>
                  <option value="ongoing">Ongoing</option>
                  <option value="completed">Completed</option>
                </select>

                <div className="flex items-center gap-2 px-3 py-2 border rounded-lg bg-white text-sm">
                  <FiCalendar />
                  <input type="date" value={eventDateFilter} onChange={(e) => setEventDateFilter(e.target.value)} className="outline-none w-full" />
                </div>
              </div>

              <div className="flex items-center">
                <Dropdown placement="bottom-start">
                  <DropdownTrigger>
                    <Button
                      variant="light"
                      className="h-auto min-w-0 px-0 text-sm font-medium text-campus-text-primary data-[hover=true]:bg-transparent"
                    >
                      <span className="text-campus-text-secondary mr-1">Sort by:</span>
                      <span>{eventSortLabel}</span>
                      <FiChevronDown className="ml-1" />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu
                    aria-label="Sort events"
                    disallowEmptySelection
                    selectionMode="single"
                    selectedKeys={new Set([eventSortMode])}
                    onAction={(key) => setEventSortMode(String(key) as EventSortMode)}
                  >
                    <DropdownItem key="latest_to_oldest">Date, new to old</DropdownItem>
                    <DropdownItem key="oldest_to_latest">Date, old to new</DropdownItem>
                    <DropdownItem key="alphabetical">Alphabetically, A-Z</DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              </div>

              {exportError && <p className="text-sm text-red-600">{exportError}</p>}
              {exportMsg && <p className="text-sm text-green-600">{exportMsg}</p>}

        {eventsLoading ? (
          <p className="text-sm text-campus-text-secondary">Loading events...</p>
        ) : sortedFilteredEvents.length === 0 ? (
          <p className="text-sm text-campus-text-secondary">No events match your filter/search.</p>
        ) : (
          <div className="space-y-3">
            {paginatedEvents.map((ev) => {
              const liveStatus = computeStatus(ev);
              const hasSlots = ev.isPreReg && typeof ev.preRegSlots === "number";
              const registrations = eventRegistrations[ev.id];
              const used = hasSlots
                ? registrations
                  ? registrations.length
                  : typeof ev.preRegCount === "number"
                    ? ev.preRegCount
                    : 0
                : typeof ev.preRegCount === "number"
                  ? ev.preRegCount
                  : 0;
              const total = typeof ev.preRegSlots === "number" ? ev.preRegSlots : 0;
              const left = hasSlots ? Math.max(0, total - used) : null;

              const imgs = eventImages[ev.id] ?? [];
              const docs = eventDocs[ev.id] ?? [];
              const previewImgs = imgs.slice(0, 3);
              const previewDocs = docs.slice(0, 3);

              return (
                <div
                  key={ev.id}
                  className="border rounded-lg p-3 sm:p-4 shadow-sm hover:bg-gray-50 transition cursor-pointer"
                  onClick={() => {
                    const nextExpanded = expandedEventId === ev.id ? null : ev.id;
                    setExpandedEventId(nextExpanded);
                    if (nextExpanded) setEventFilesTab("images");
                  }}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
                      <h4 className="font-semibold text-campus-text-primary">{ev.title}</h4>
                      <span className={`px-3 py-1 text-xs rounded-full ${statusChip(liveStatus)}`}>{liveStatus}</span>

                      {hasSlots && (
                        <span className="px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">Slots left: {left}</span>
                      )}
                    </div>

                    <div className="flex w-full sm:w-auto flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="flex-1 sm:flex-none px-4 py-1 bg-gray-200 text-campus-text-primary text-xs rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Info ▼
                      </button>
                      <button
                        type="button"
                        className="flex-1 sm:flex-none px-4 py-1 bg-primary-500 text-white text-xs rounded-lg"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Edit (later)
                      </button>
                    </div>
                  </div>

                  {ev.details && <p className="text-sm text-campus-text-secondary mt-1">{ev.details}</p>}

                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-3 text-sm text-campus-text-secondary">
                    <span>📅 {ev.date}</span>
                    <span>
                      ⏰ {ev.scheduledTime || ev.timeStart || "—"}
                      {ev.timeEnd ? ` - ${ev.timeEnd}` : ""}
                    </span>
                    <span>📍 {ev.location || "—"}</span>
                  </div>

                  {expandedEventId === ev.id && (
                    <div className="mt-4 p-4 border rounded-lg bg-gray-50 space-y-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm text-campus-text-primary">
                          <b>Pre-Registrations:</b> {registrations ? registrations.length : used}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void exportEventAttendanceCSV(ev);
                          }}
                          disabled={exportingEventId === ev.id}
                          className="px-3 py-1.5 text-xs rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-60"
                        >
                          {exportingEventId === ev.id ? "Exporting..." : "Export Attendance CSV"}
                        </button>
                      </div>

                      <p className="text-sm text-campus-text-primary">
                        <b>Course:</b> {ev.course ?? "—"}
                      </p>
                      <p className="text-sm text-campus-text-primary">
                        <b>Year Level:</b> {ev.yearLevel ?? "—"}
                      </p>
                      {ev.targetStudent && (
                        <p className="text-sm text-campus-text-primary">
                          <b>Target Student:</b> {ev.targetStudent}
                        </p>
                      )}
                      <p className="text-sm text-campus-text-primary">
                        <b>Pre-Reg:</b> {ev.isPreReg ? "Yes" : "No"} | <b>With Payment:</b> {ev.withPayment ? "Yes" : "No"}
                      </p>

                      {ev.isPreReg && typeof ev.preRegSlots === "number" && (
                        <p className="text-sm text-campus-text-primary">
                          <b>Slots:</b> {used} / {ev.preRegSlots} (left: {Math.max(0, ev.preRegSlots - used)})
                        </p>
                      )}

                      {ev.isPreReg && registrations && registrations.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-sm font-semibold text-campus-text-primary">Registered Students</p>
                          <div className="overflow-x-auto rounded-lg border bg-white">
                            <table className="w-full text-xs sm:text-sm">
                              <thead className="bg-gray-100 text-campus-text-secondary">
                                <tr>
                                  <th className="p-2 text-left">School ID</th>
                                  <th className="p-2 text-left">Name</th>
                                  <th className="p-2 text-left">Course</th>
                                  <th className="p-2 text-left">Year</th>
                                  <th className="p-2 text-left">Registered At</th>
                                </tr>
                              </thead>
                              <tbody>
                                {registrations.map((reg) => (
                                  <tr key={reg.id} className="border-t">
                                    <td className="p-2">{reg.schoolId || "-"}</td>
                                    <td className="p-2">{reg.studentName || reg.uid}</td>
                                    <td className="p-2">{reg.course || "-"}</td>
                                    <td className="p-2">{reg.year || "-"}</td>
                                    <td className="p-2">{formatDateTime(reg.createdAt)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* FILES */}
                      <div className="pt-3 border-t space-y-4">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-campus-text-primary">Event Files</p>
                          {uploadingFor === ev.id && <span className="text-xs text-campus-text-secondary">Uploading...</span>}
                        </div>

                        {uploadErr && <p className="text-sm text-red-600">{uploadErr}</p>}
                        {uploadMsg && <p className="text-sm text-green-600">{uploadMsg}</p>}

                        {/* Upload controls (EC only) */}
                        {isECUser && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label
                              className="border rounded-lg p-3 bg-white cursor-pointer hover:bg-gray-50"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="text-sm font-semibold">Upload Images</div>
                              <div className="text-xs text-gray-500">Auto-compressed before upload (max 10MB final size)</div>
                              <input
                                type="file"
                                multiple
                                accept="image/*"
                                className="hidden"
                                onChange={(e) => handleFileInputChange(ev.id, "images", e)}
                              />
                            </label>

                            <label
                              className="border rounded-lg p-3 bg-white cursor-pointer hover:bg-gray-50"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="text-sm font-semibold">Upload Documents</div>
                              <div className="text-xs text-gray-500">PDF/DOC/DOCX (max 10MB each)</div>
                              <input
                                type="file"
                                multiple
                                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                className="hidden"
                                onChange={(e) => handleFileInputChange(ev.id, "docs", e)}
                              />
                            </label>
                          </div>
                        )}

                        <Tabs
                          aria-label={`Event files for ${ev.title}`}
                          selectedKey={eventFilesTab}
                          onSelectionChange={(key) => setEventFilesTab(String(key) as EventFilesTab)}
                        >
                          <Tab key="images" title={`Images (${imgs.length})`}>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold">Images</p>
                                {imgs.length > 3 && (
                                  <button
                                    type="button"
                                    className="text-xs text-primary-600 hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openViewAllFilesModal(ev.id, ev.title, "images");
                                    }}
                                  >
                                    View all ({imgs.length})
                                  </button>
                                )}
                              </div>

                              {imgs.length === 0 ? (
                                <p className="text-xs text-gray-500">No images uploaded yet.</p>
                              ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                  {previewImgs.map((img) => (
                                    <div key={img.id} className="border rounded-lg bg-white p-2">
                                      <a href={img.downloadURL} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                          src={img.downloadURL}
                                          alt={img.name || "event image"}
                                          className="w-full h-28 object-cover rounded-md"
                                        />
                                      </a>

                                      <div className="mt-2 space-y-1">
                                        <p className="text-xs truncate">{img.name}</p>
                                        <div className="flex items-center justify-between gap-2">
                                          <button
                                            type="button"
                                            className="text-xs text-primary-600 hover:underline"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              downloadEventFile(img, img.name || "event-image.jpg");
                                            }}
                                          >
                                            Download
                                          </button>

                                          {isECUser && img.path && (
                                            <button
                                              type="button"
                                              className="text-xs text-red-600 hover:underline"
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                deleteEventFile(ev.id, "images", img.id, img.path!);
                                              }}
                                            >
                                              Delete
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </Tab>

                          <Tab key="docs" title={`Documents (${docs.length})`}>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="text-sm font-semibold">Documents</p>
                                {docs.length > 3 && (
                                  <button
                                    type="button"
                                    className="text-xs text-primary-600 hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openViewAllFilesModal(ev.id, ev.title, "docs");
                                    }}
                                  >
                                    View all ({docs.length})
                                  </button>
                                )}
                              </div>

                              {docs.length === 0 ? (
                                <p className="text-xs text-gray-500">No documents uploaded yet.</p>
                              ) : (
                                <div className="space-y-2">
                                  {previewDocs.map((f) => (
                                    <div key={f.id} className="border rounded-lg bg-white p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium truncate">{f.name}</p>
                                        <p className="text-xs text-gray-500">{f.contentType || "file"}</p>
                                      </div>

                                      <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
                                        <button
                                          type="button"
                                          className="text-sm text-primary-600 hover:underline"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            downloadEventFile(f, f.name || "event-document");
                                          }}
                                        >
                                          Download
                                        </button>

                                        {isECUser && f.path && (
                                          <button
                                            type="button"
                                            className="text-sm text-red-600 hover:underline"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              deleteEventFile(ev.id, "docs", f.id, f.path!);
                                            }}
                                          >
                                            Delete
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </Tab>
                        </Tabs>
                      </div>
                      {/* END FILES */}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
              {!eventsLoading && sortedFilteredEvents.length > ITEMS_PER_PAGE && (
                <div className="flex justify-center pt-2">
                  <Pagination
                    showControls
                    page={eventPage}
                    total={eventTotalPages}
                    onChange={(page) => setEventPage(page)}
                  />
                </div>
              )}
            </div>
          </Tab>

          <Tab
            key="notifications"
            title={
              <span className="whitespace-nowrap">
                <span className="sm:hidden">Notifications</span>
                <span className="hidden sm:inline">Notification List</span>
              </span>
            }
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                <input
                  type="text"
                  placeholder="Search notifications..."
                  value={notificationSearchText}
                  onChange={(e) => setNotificationSearchText(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />

                <select
                  value={notificationStatusFilter}
                  onChange={(e) => setNotificationStatusFilter(e.target.value as any)}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                >
                  <option value="all">All Status</option>
                  <option value="scheduled">Scheduled</option>
                  <option value="sent">Sent</option>
                </select>

                <div className="flex items-center gap-2 px-3 py-2 border rounded-lg bg-white text-sm">
                  <FiCalendar />
                  <input
                    type="date"
                    value={notificationDateFilter}
                    onChange={(e) => setNotificationDateFilter(e.target.value)}
                    className="outline-none w-full"
                  />
                </div>
              </div>

              <div className="flex items-center">
                <Dropdown placement="bottom-start">
                  <DropdownTrigger>
                    <Button
                      variant="light"
                      className="h-auto min-w-0 px-0 text-sm font-medium text-campus-text-primary data-[hover=true]:bg-transparent"
                    >
                      <span className="text-campus-text-secondary mr-1">Sort by:</span>
                      <span>{notificationSortLabel}</span>
                      <FiChevronDown className="ml-1" />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu
                    aria-label="Sort notifications"
                    disallowEmptySelection
                    selectionMode="single"
                    selectedKeys={new Set([notificationSortMode])}
                    onAction={(key) => setNotificationSortMode(String(key) as EventSortMode)}
                  >
                    <DropdownItem key="latest_to_oldest">Date, new to old</DropdownItem>
                    <DropdownItem key="oldest_to_latest">Date, old to new</DropdownItem>
                    <DropdownItem key="alphabetical">Alphabetically, A-Z</DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              </div>

              {notificationsLoading ? (
                <p className="text-sm text-campus-text-secondary">Loading notifications...</p>
              ) : sortedFilteredNotifications.length === 0 ? (
                <p className="text-sm text-campus-text-secondary">No notifications match your filter/search.</p>
              ) : (
                <div className="space-y-3">
                  {paginatedNotifications.map((item) => (
                    <div key={item.dispatchId} className="border rounded-lg p-3 sm:p-4 shadow-sm">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-3">
                          <h4 className="font-semibold text-campus-text-primary">{item.title || "Notification"}</h4>
                          <span className={`px-3 py-1 text-xs rounded-full ${notifStatusChip(item.status)}`}>{item.status}</span>
                        </div>
                        <p className="text-xs text-campus-text-secondary">Created: {formatDateTime(item.createdAt)}</p>
                      </div>

                      <p className="text-sm text-campus-text-secondary mt-2">{item.message || "-"}</p>

                      <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-campus-text-secondary">
                        <div>
                          <b>Date/Time:</b> {item.date || "-"} {item.scheduledTime || ""}
                        </div>
                        <div>
                          <b>Target:</b> {notifTargetLabel(item)}
                        </div>
                        <div>
                          <b>Recipients:</b> {item.recipientCount}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {!notificationsLoading && sortedFilteredNotifications.length > ITEMS_PER_PAGE && (
                <div className="flex justify-center pt-2">
                  <Pagination
                    showControls
                    page={notificationPage}
                    total={notificationTotalPages}
                    onChange={(page) => setNotificationPage(page)}
                  />
                </div>
              )}
            </div>
          </Tab>
        </Tabs>
      </div>

      <Modal
        isOpen={viewAllFilesModal.open}
        onOpenChange={(open) => {
          if (!open) closeViewAllFilesModal();
        }}
        size="5xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <span>{viewAllFilesModal.kind === "images" ? "All Images" : "All Documents"}</span>
                <span className="text-xs font-normal text-campus-text-secondary">
                  {viewAllFilesModal.eventTitle || "Event files"}
                </span>
              </ModalHeader>

              <ModalBody>
                {viewAllFilesModal.kind === "images" ? (
                  viewAllModalImages.length === 0 ? (
                    <p className="text-sm text-campus-text-secondary">No images available.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {viewAllModalImages.map((img) => (
                        <div key={img.id} className="border rounded-lg bg-white p-2">
                          <a href={img.downloadURL} target="_blank" rel="noreferrer">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.downloadURL}
                              alt={img.name || "event image"}
                              className="w-full h-32 object-cover rounded-md"
                            />
                          </a>

                          <div className="mt-2 space-y-1">
                            <p className="text-xs truncate">{img.name}</p>
                            <div className="flex items-center justify-between gap-2">
                              <button
                                type="button"
                                className="text-xs text-primary-600 hover:underline"
                                onClick={() => downloadEventFile(img, img.name || "event-image.jpg")}
                              >
                                Download
                              </button>

                              {isECUser && img.path && viewAllFilesModal.eventId && (
                                <button
                                  type="button"
                                  className="text-xs text-red-600 hover:underline"
                                  onClick={() => {
                                    const modalEventId = viewAllFilesModal.eventId;
                                    if (!modalEventId) return;
                                    deleteEventFile(modalEventId, "images", img.id, img.path!);
                                  }}
                                >
                                  Delete
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : viewAllModalDocs.length === 0 ? (
                  <p className="text-sm text-campus-text-secondary">No documents available.</p>
                ) : (
                  <div className="space-y-2">
                    {viewAllModalDocs.map((file) => (
                      <div key={file.id} className="border rounded-lg bg-white p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{file.name}</p>
                          <p className="text-xs text-gray-500">{file.contentType || "file"}</p>
                        </div>

                        <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
                          <button
                            type="button"
                            className="text-sm text-primary-600 hover:underline"
                            onClick={() => downloadEventFile(file, file.name || "event-document")}
                          >
                            Download
                          </button>

                          {isECUser && file.path && viewAllFilesModal.eventId && (
                            <button
                              type="button"
                              className="text-sm text-red-600 hover:underline"
                              onClick={() => {
                                const modalEventId = viewAllFilesModal.eventId;
                                if (!modalEventId) return;
                                deleteEventFile(modalEventId, "docs", file.id, file.path!);
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ModalBody>

              <ModalFooter>
                <button
                  type="button"
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-100"
                  onClick={() => {
                    onClose();
                    closeViewAllFilesModal();
                  }}
                >
                  Close
                </button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

