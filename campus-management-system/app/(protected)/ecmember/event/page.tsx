"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FiCalendar, FiChevronDown } from "react-icons/fi";

import { app, auth, db, storage } from "@/lib/firebase";
import { onAuthStateChanged } from "firebase/auth";
import {
  addDoc,
  collectionGroup,
  collection,
  deleteDoc,
  DocumentData,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  QueryDocumentSnapshot,
  query,
  setDoc,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { DatePicker } from "@heroui/date-picker";
import { TimeInput } from "@heroui/date-input";
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from "@heroui/dropdown";
import { Input, Textarea } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import { Switch } from "@heroui/switch";
import { Tab, Tabs } from "@heroui/tabs";
import { CampusCardListSkeleton } from "@/components/ui";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import {
  CalendarDate,
  getLocalTimeZone,
  Time,
  today,
} from "@internationalized/date";
import { campusToast } from "@/lib/toast";

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

const addToast = ({
  title,
  description,
  color = "primary",
  timeout,
}: {
  title: string;
  description: string;
  color?:
    | "success"
    | "danger"
    | "warning"
    | "primary"
    | "secondary"
    | "default";
  timeout?: number;
}) => {
  const tone =
    color === "success"
      ? "success"
      : color === "warning"
        ? "warning"
        : color === "danger"
          ? "error"
          : "info";

  campusToast.show({
    title,
    description,
    tone,
    timeout,
    dedupeKey: `ec-events:${color}:${title}:${description}`,
  });
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
type ImageModalSortMode = "ascending" | "descending";
type DocumentModalSortMode = "ascending" | "descending";
type PendingDeleteFile = {
  eventId: string;
  kind: "images" | "docs";
  fileDocId: string;
  path: string;
  fileName: string;
};
type PendingDeleteEvent = {
  id: string;
  title: string;
};

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
const IMAGE_COMPRESSION_QUALITY_STEPS = [
  0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42,
];
const IMAGE_COMPRESSION_SCALE_STEPS = [1, 0.9, 0.8, 0.72, 0.64];
const EVENT_DOC_EXTENSIONS = new Set(["pdf", "doc", "docx"]);
const EVENT_DOC_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const EVENT_YEAR_LEVEL_CHOICES = [
  "1st Year",
  "2nd Year",
  "3rd Year",
  "4th Year",
];
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

function minutesTo24h(totalMinutes: number) {
  const normalized = ((totalMinutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${pad2(hour)}:${pad2(minute)}`;
}

function splitCommaValues(raw: string | undefined) {
  return String(raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseTargetStudents(
  targetStudent: string | undefined,
  allStudents: StudentLookup[],
) {
  const tokens = String(targetStudent ?? "")
    .split(";")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (tokens.length === 0) return [] as StudentLookup[];

  const seen = new Set<string>();
  const selected: StudentLookup[] = [];

  tokens.forEach((token, index) => {
    const match = token.match(/^(.*)\(([^)]+)\)$/);
    const studentName = String(match?.[1] ?? token).trim();
    const schoolId = String(match?.[2] ?? "").trim();

    const fromOptions =
      (schoolId
        ? allStudents.find((student) => student.schoolId === schoolId)
        : undefined) ??
      allStudents.find(
        (student) =>
          student.studentName.toLowerCase() === studentName.toLowerCase(),
      );

    if (fromOptions) {
      const key = `uid:${fromOptions.uid}`;
      if (!seen.has(key)) {
        seen.add(key);
        selected.push(fromOptions);
      }
      return;
    }

    const fallbackName = studentName || schoolId || `Student ${index + 1}`;
    const fallbackSchoolId = schoolId || "Unknown ID";
    const fallbackKey =
      `manual:${fallbackSchoolId}|${fallbackName}`.toLowerCase();
    if (seen.has(fallbackKey)) return;

    seen.add(fallbackKey);
    selected.push({
      uid: `manual-${index}-${fallbackSchoolId}-${fallbackName}`
        .replace(/\s+/g, "-")
        .toLowerCase(),
      schoolId: fallbackSchoolId,
      studentName: fallbackName,
      course: "",
      year: "",
      searchText: `${fallbackName} ${fallbackSchoolId}`.toLowerCase(),
    });
  });

  return selected;
}

function toMillis(value: any): number {
  if (
    value &&
    typeof value === "object" &&
    typeof value.toMillis === "function"
  ) {
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

function computeNotificationStatus(
  date: string,
  scheduledTime?: string,
): NotificationListStatus {
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

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Unable to compress image."));
          return;
        }
        resolve(blob);
      },
      type,
      quality,
    );
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
  const baseRatio =
    longestEdge > MAX_IMAGE_DIMENSION ? MAX_IMAGE_DIMENSION / longestEdge : 1;
  const baseWidth = Math.max(1, Math.round(sourceWidth * baseRatio));
  const baseHeight = Math.max(1, Math.round(sourceHeight * baseRatio));

  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context)
    throw new Error("Image compression is not available in this browser.");

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
    <Card shadow="none" className="border bg-white/10 backdrop-blur">
      <CardBody className="p-4 text-center">
        <div className="text-2xl font-black leading-none text-white">
          {value}
        </div>
        <div className="mt-2 text-xs font-medium uppercase tracking-wide text-white/70">
          {label}
        </div>
      </CardBody>
    </Card>
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
  const [eventSortMode, setEventSortMode] =
    useState<EventSortMode>("latest_to_oldest");
  const [eventPage, setEventPage] = useState(1);

  const [notifTitle, setNotifTitle] = useState("");
  const [notifDate, setNotifDate] = useState<string>(() => isoDateToday());
  const [notifDateValue, setNotifDateValue] = useState<any>(() =>
    toCalendarDate(isoDateToday()),
  );
  const [notifMessage, setNotifMessage] = useState("");
  const [notifSearchName, setNotifSearchName] = useState("");
  const [notifSearchId, setNotifSearchId] = useState("");
  const [selectedNotifStudents, setSelectedNotifStudents] = useState<
    StudentLookup[]
  >([]);
  const [notifYearSearch, setNotifYearSearch] = useState("");
  const [selectedNotifYearLevels, setSelectedNotifYearLevels] = useState<
    string[]
  >([]);
  const [showNotifYearDropdown, setShowNotifYearDropdown] = useState(false);
  const [isAllNotifYearsExplicit, setIsAllNotifYearsExplicit] = useState(false);
  const [notifCourseSearch, setNotifCourseSearch] = useState("");
  const [selectedNotifCourses, setSelectedNotifCourses] = useState<string[]>(
    [],
  );
  const [showNotifCourseDropdown, setShowNotifCourseDropdown] = useState(false);
  const [isAllNotifCoursesExplicit, setIsAllNotifCoursesExplicit] =
    useState(false);
  const [notifRegistrantsModalOpen, setNotifRegistrantsModalOpen] =
    useState(false);
  const [notifScheduled24, setNotifScheduled24] = useState<string>(() =>
    now24h(),
  );
  const [notifScheduledValue, setNotifScheduledValue] = useState<Time | null>(
    () => toTimeValue(now24h()),
  );
  const [editingNotificationDispatchId, setEditingNotificationDispatchId] =
    useState<string | null>(null);
  const [sendingNotif, setSendingNotif] = useState(false);
  const [notifError, setNotifError] = useState("");
  const [notifMsg, setNotifMsg] = useState("");
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState("");
  const [studentOptions, setStudentOptions] = useState<StudentLookup[]>([]);
  const [showStudentDropdown, setShowStudentDropdown] = useState(false);
  const studentPickerRef = useRef<HTMLDivElement | null>(null);
  const notifYearPickerRef = useRef<HTMLDivElement | null>(null);
  const notifCoursePickerRef = useRef<HTMLDivElement | null>(null);
  const [eventSearchName, setEventSearchName] = useState("");
  const [selectedEventStudents, setSelectedEventStudents] = useState<
    StudentLookup[]
  >([]);
  const [showEventStudentDropdown, setShowEventStudentDropdown] =
    useState(false);
  const [eventYearSearch, setEventYearSearch] = useState("");
  const [selectedEventYearLevels, setSelectedEventYearLevels] = useState<
    string[]
  >([]);
  const [showEventYearDropdown, setShowEventYearDropdown] = useState(false);
  const [isAllYearsExplicit, setIsAllYearsExplicit] = useState(false);
  const [eventCourseSearch, setEventCourseSearch] = useState("");
  const [selectedEventCourses, setSelectedEventCourses] = useState<string[]>(
    [],
  );
  const [showEventCourseDropdown, setShowEventCourseDropdown] = useState(false);
  const [isAllCoursesExplicit, setIsAllCoursesExplicit] = useState(false);
  const [registrantsModalOpen, setRegistrantsModalOpen] = useState(false);
  const eventStudentPickerRef = useRef<HTMLDivElement | null>(null);
  const eventYearPickerRef = useRef<HTMLDivElement | null>(null);
  const eventCoursePickerRef = useRef<HTMLDivElement | null>(null);

  const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
  const [editingEventId, setEditingEventId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [date, setDate] = useState<string>(() => isoDateToday());
  const [eventDateValue, setEventDateValue] = useState<any>(() =>
    toCalendarDate(isoDateToday()),
  );
  const [details, setDetails] = useState("");
  const [isPreReg, setIsPreReg] = useState(false);
  const [withPayment, setWithPayment] = useState(false);

  const [eventScheduled24, setEventScheduled24] = useState("07:00");
  const [eventStartTimeValue, setEventStartTimeValue] = useState<Time | null>(
    () => toTimeValue("07:00"),
  );
  const [eventEnd24, setEventEnd24] = useState("08:00");
  const [eventEndTimeValue, setEventEndTimeValue] = useState<Time | null>(() =>
    toTimeValue("08:00"),
  );

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
  const [expandedNotificationId, setExpandedNotificationId] = useState<
    string | null
  >(null);
  const [notificationSearchText, setNotificationSearchText] = useState("");
  const [notificationStatusFilter, setNotificationStatusFilter] = useState<
    "all" | NotificationListStatus
  >("all");
  const [notificationDateFilter, setNotificationDateFilter] = useState("");
  const [notificationSortMode, setNotificationSortMode] =
    useState<EventSortMode>("latest_to_oldest");
  const [notificationPage, setNotificationPage] = useState(1);

  const [currentUser, setCurrentUser] = useState<any>(null);

  // Files per event (subcollections)
  const [eventImages, setEventImages] = useState<Record<string, EventFile[]>>(
    {},
  );
  const [eventDocs, setEventDocs] = useState<Record<string, EventFile[]>>({});
  const [eventRegistrations, setEventRegistrations] = useState<
    Record<string, RegistrationDoc[]>
  >({});
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
  const [imageModalSortMode, setImageModalSortMode] =
    useState<ImageModalSortMode>("ascending");
  const [documentModalSortMode, setDocumentModalSortMode] =
    useState<DocumentModalSortMode>("ascending");
  const [documentModalSearch, setDocumentModalSearch] = useState("");
  const [pendingDeleteFile, setPendingDeleteFile] =
    useState<PendingDeleteFile | null>(null);
  const [deleteSubmitting, setDeleteSubmitting] = useState(false);
  const [pendingDeleteEvent, setPendingDeleteEvent] =
    useState<PendingDeleteEvent | null>(null);
  const [deleteEventSubmitting, setDeleteEventSubmitting] = useState(false);
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
        const role = snap.exists()
          ? (snap.data()?.role as Role | undefined)
          : undefined;
        setIsECUser(role === "ec");
      } catch {
        setIsECUser(false);
      } finally {
        setRoleLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const loadStudentsForNotifications = useCallback(async (): Promise<
    StudentLookup[]
  > => {
    if (!isECUser) return [];
    if (studentsLoading) return studentOptions;

    setStudentsLoading(true);
    setStudentsError("");

    try {
      const fn = httpsCallable<
        { limit: number },
        { students?: RemoteStudent[] }
      >(functions, "ecListStudents");
      const res = await fn({ limit: 2000 });
      const rows = (res.data?.students ?? [])
        .map((s) => {
          const uid = String(s.uid ?? "").trim();
          const schoolId = String(s.schoolId ?? "").trim();
          const studentName =
            String(s.studentName ?? s.name ?? "").trim() || schoolId || uid;
          const course = String(s.course ?? "").trim();
          const year = String(s.year ?? "").trim();

          if (!uid) return null;

          const searchText =
            `${studentName} ${schoolId} ${course} ${year}`.toLowerCase();
          return {
            uid,
            schoolId,
            studentName,
            course,
            year,
            searchText,
          } as StudentLookup;
        })
        .filter((s): s is StudentLookup => Boolean(s))
        .sort(
          (a, b) =>
            a.studentName.localeCompare(b.studentName) ||
            a.schoolId.localeCompare(b.schoolId),
        );

      setStudentOptions(rows);
      return rows;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to load students.";
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
  }, [
    showNotificationForm,
    showAddEventForm,
    isECUser,
    studentOptions.length,
    loadStudentsForNotifications,
  ]);

  useEffect(() => {
    if (!showNotificationForm && !showAddEventForm) return;

    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (studentPickerRef.current?.contains(target)) return;
      if (notifYearPickerRef.current?.contains(target)) return;
      if (notifCoursePickerRef.current?.contains(target)) return;
      if (eventStudentPickerRef.current?.contains(target)) return;
      if (eventYearPickerRef.current?.contains(target)) return;
      if (eventCoursePickerRef.current?.contains(target)) return;
      setShowStudentDropdown(false);
      setShowNotifYearDropdown(false);
      setShowNotifCourseDropdown(false);
      setShowEventStudentDropdown(false);
      setShowEventYearDropdown(false);
      setShowEventCourseDropdown(false);
    };

    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [showAddEventForm, showNotificationForm]);

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
          recipientTypeRaw === "course" ||
          recipientTypeRaw === "year" ||
          recipientTypeRaw === "student"
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
            recipientCount:
              explicitRecipientCount > 0 ? explicitRecipientCount : 0,
            status: computeNotificationStatus(date, scheduledTime),
          });
        }

        const current = grouped.get(groupKey)!;
        if (explicitRecipientCount > 0) {
          current.recipientCount = Math.max(
            current.recipientCount,
            explicitRecipientCount,
          );
        } else {
          current.recipientCount += 1;
        }
        if (toMillis(data.createdAt) > toMillis(current.createdAt)) {
          current.createdAt = data.createdAt;
        }
      });

      return Array.from(grouped.values()).sort(
        (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt),
      );
    },
    [currentUser],
  );

  const refreshSentNotificationsOnce = useCallback(async () => {
    if (!currentUser || !isECUser) {
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }

    try {
      const ownQ = query(
        collection(db, "profiles", currentUser.uid, "notifications"),
        orderBy("createdAt", "desc"),
        limit(1200),
      );
      const ownSnap = await getDocs(ownQ);
      let rows = mapNotificationSummaryRows(ownSnap.docs);

      if (rows.length === 0) {
        try {
          const legacyQ = query(
            collectionGroup(db, "notifications"),
            orderBy("createdAt", "desc"),
            limit(1200),
          );
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
    const qy = query(
      collection(db, "profiles", currentUser.uid, "notifications"),
      orderBy("createdAt", "desc"),
      limit(1200),
    );
    void refreshSentNotificationsOnce();

    const unsub = onSnapshot(
      qy,
      (snap) => {
        setNotifications(mapNotificationSummaryRows(snap.docs));
        setNotificationsLoading(false);
      },
      () => {
        void refreshSentNotificationsOnce();
      },
    );

    return () => unsub();
  }, [
    currentUser,
    isECUser,
    mapNotificationSummaryRows,
    refreshSentNotificationsOnce,
  ]);

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
      },
    );
    return () => unsub();
  }, []);

  // Live files for expanded event
  useEffect(() => {
    if (!expandedEventId) return;

    const imgQ = query(
      collection(db, "events", expandedEventId, "images"),
      orderBy("createdAt", "desc"),
    );
    const docQ = query(
      collection(db, "events", expandedEventId, "docs"),
      orderBy("createdAt", "desc"),
    );

    const unsubImgs = onSnapshot(imgQ, (snap) => {
      setEventImages((prev) => ({
        ...prev,
        [expandedEventId]: snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })),
      }));
    });

    const unsubDocs = onSnapshot(docQ, (snap) => {
      setEventDocs((prev) => ({
        ...prev,
        [expandedEventId]: snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as any),
        })),
      }));
    });

    return () => {
      unsubImgs();
      unsubDocs();
    };
  }, [expandedEventId]);

  // Live registrations for pre-registration events
  useEffect(() => {
    const preRegEventIds = events
      .filter((ev) => ev.isPreReg)
      .map((ev) => ev.id);

    if (preRegEventIds.length === 0) {
      setEventRegistrations({});
      return;
    }

    const unsubs = preRegEventIds.map((eventId) =>
      onSnapshot(
        collection(db, "events", eventId, "registrations"),
        async (snap) => {
          try {
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

            const activeRows = await Promise.all(
              rows.map(async (row) => {
                const [profileSnap, studentSnap] = await Promise.all([
                  getDoc(doc(db, "profiles", row.uid)),
                  getDoc(doc(db, "students", row.uid)),
                ]);

                const profileStatus = String(profileSnap.data()?.status ?? "")
                  .trim()
                  .toLowerCase();
                const studentStatus = String(studentSnap.data()?.status ?? "")
                  .trim()
                  .toLowerCase();
                if (
                  profileStatus === "inactive" ||
                  studentStatus === "inactive"
                ) {
                  return null;
                }

                return row;
              }),
            );

            setEventRegistrations((prev) => ({
              ...prev,
              [eventId]: activeRows.filter((row): row is RegistrationDoc =>
                Boolean(row),
              ),
            }));
          } catch {
            setEventRegistrations((prev) => ({ ...prev, [eventId]: [] }));
          }
        },
        () => {
          setEventRegistrations((prev) => ({ ...prev, [eventId]: [] }));
        },
      ),
    );

    return () => {
      unsubs.forEach((unsub) => unsub());
    };
  }, [events]);

  const filteredEvents = useMemo(() => {
    const s = searchText.trim().toLowerCase();
    return events.filter((ev) => {
      const liveStatus = computeStatus(ev);
      const matchesStatus =
        statusFilter === "all" || liveStatus === statusFilter;
      const matchesDate =
        !eventDateFilter || String(ev.date ?? "") === eventDateFilter;

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
    [selectedNotifStudents],
  );
  const selectedNotifYearLevelsSet = useMemo(
    () => new Set(selectedNotifYearLevels),
    [selectedNotifYearLevels],
  );
  const selectedNotifCoursesSet = useMemo(
    () => new Set(selectedNotifCourses),
    [selectedNotifCourses],
  );
  const selectedEventStudentIds = useMemo(
    () => new Set(selectedEventStudents.map((student) => student.uid)),
    [selectedEventStudents],
  );
  const selectedEventYearLevelsSet = useMemo(
    () => new Set(selectedEventYearLevels),
    [selectedEventYearLevels],
  );
  const selectedEventCoursesSet = useMemo(
    () => new Set(selectedEventCourses),
    [selectedEventCourses],
  );

  const filteredStudentOptions = useMemo(() => {
    const nameQuery = notifSearchName.trim().toLowerCase();
    const idQuery = notifSearchId.trim().toLowerCase();

    return studentOptions
      .filter((student) => {
        if (selectedNotifStudentIds.has(student.uid)) return false;
        const matchesName =
          !nameQuery || student.studentName.toLowerCase().includes(nameQuery);
        const matchesId =
          !idQuery || student.schoolId.toLowerCase().includes(idQuery);
        return matchesName && matchesId;
      })
      .slice(0, 20);
  }, [notifSearchName, notifSearchId, studentOptions, selectedNotifStudentIds]);

  const filteredNotifYearOptions = useMemo(() => {
    const query = notifYearSearch.trim().toLowerCase();
    return EVENT_YEAR_LEVEL_CHOICES.filter((item) => {
      if (selectedNotifYearLevelsSet.has(item)) return false;
      if (!query) return true;
      return item.toLowerCase().includes(query);
    }).slice(0, 20);
  }, [notifYearSearch, selectedNotifYearLevelsSet]);

  const filteredNotifCourseOptions = useMemo(() => {
    const query = notifCourseSearch.trim().toLowerCase();
    return EVENT_COURSE_CHOICES.filter((item) => {
      if (selectedNotifCoursesSet.has(item)) return false;
      if (!query) return true;
      return item.toLowerCase().includes(query);
    }).slice(0, 20);
  }, [notifCourseSearch, selectedNotifCoursesSet]);
  const showNotifAllYearsOption = useMemo(() => {
    const query = notifYearSearch.trim().toLowerCase();
    return !query || "all years".includes(query);
  }, [notifYearSearch]);
  const showNotifAllCoursesOption = useMemo(() => {
    const query = notifCourseSearch.trim().toLowerCase();
    return !query || "all courses".includes(query);
  }, [notifCourseSearch]);

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
      const matchesStatus =
        notificationStatusFilter === "all" ||
        item.status === notificationStatusFilter;
      const matchesDate =
        !notificationDateFilter || item.date === notificationDateFilter;
      const matchesSearch =
        !s ||
        item.title.toLowerCase().includes(s) ||
        item.message.toLowerCase().includes(s) ||
        item.recipientType.toLowerCase().includes(s) ||
        item.targetStudent.toLowerCase().includes(s);

      return matchesStatus && matchesDate && matchesSearch;
    });
  }, [
    notifications,
    notificationSearchText,
    notificationStatusFilter,
    notificationDateFilter,
  ]);

  const sortedFilteredEvents = useMemo(() => {
    const list = [...filteredEvents];

    if (eventSortMode === "alphabetical") {
      list.sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
      );
      return list;
    }

    list.sort((a, b) => {
      const aMs =
        getDateTimeMs(a.date, a.scheduledTime || a.timeStart) ||
        toMillis(a.createdAt);
      const bMs =
        getDateTimeMs(b.date, b.scheduledTime || b.timeStart) ||
        toMillis(b.createdAt);
      return eventSortMode === "oldest_to_latest" ? aMs - bMs : bMs - aMs;
    });

    return list;
  }, [filteredEvents, eventSortMode]);

  const sortedFilteredNotifications = useMemo(() => {
    const list = [...filteredNotifications];

    if (notificationSortMode === "alphabetical") {
      list.sort((a, b) =>
        (a.title || "").localeCompare(b.title || "", undefined, {
          sensitivity: "base",
        }),
      );
      return list;
    }

    list.sort((a, b) => {
      const aMs =
        toMillis(a.createdAt) || getDateTimeMs(a.date, a.scheduledTime);
      const bMs =
        toMillis(b.createdAt) || getDateTimeMs(b.date, b.scheduledTime);
      return notificationSortMode === "oldest_to_latest"
        ? aMs - bMs
        : bMs - aMs;
    });

    return list;
  }, [filteredNotifications, notificationSortMode]);

  const eventTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedFilteredEvents.length / ITEMS_PER_PAGE)),
    [sortedFilteredEvents.length],
  );
  const paginatedEvents = useMemo(() => {
    const start = (eventPage - 1) * ITEMS_PER_PAGE;
    return sortedFilteredEvents.slice(start, start + ITEMS_PER_PAGE);
  }, [sortedFilteredEvents, eventPage]);

  const notificationTotalPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(sortedFilteredNotifications.length / ITEMS_PER_PAGE),
      ),
    [sortedFilteredNotifications.length],
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
    setExpandedNotificationId(null);
  }, [
    notificationSearchText,
    notificationStatusFilter,
    notificationDateFilter,
    notificationSortMode,
  ]);

  useEffect(() => {
    setEventPage((prev) => Math.min(Math.max(prev, 1), eventTotalPages));
  }, [eventTotalPages]);

  useEffect(() => {
    setNotificationPage((prev) =>
      Math.min(Math.max(prev, 1), notificationTotalPages),
    );
  }, [notificationTotalPages]);

  useEffect(() => {
    if (!expandedNotificationId) return;
    const stillExists = sortedFilteredNotifications.some(
      (item) => item.dispatchId === expandedNotificationId,
    );
    if (!stillExists) {
      setExpandedNotificationId(null);
    }
  }, [expandedNotificationId, sortedFilteredNotifications]);

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
    const upcoming = events.filter(
      (e) => computeStatus(e) === "upcoming",
    ).length;
    const ongoing = events.filter((e) => computeStatus(e) === "ongoing").length;
    const completed = events.filter(
      (e) => computeStatus(e) === "completed",
    ).length;
    return { total, upcoming, ongoing, completed };
  }, [events]);

  const totalParticipants = useMemo(
    () =>
      Object.values(eventRegistrations).reduce(
        (sum, rows) => sum + rows.length,
        0,
      ),
    [eventRegistrations],
  );
  const isEditingEvent = Boolean(editingEventId);
  const isEditingNotification = Boolean(editingNotificationDispatchId);
  const hasSpecificTarget = selectedEventStudents.length > 0;
  const hasEventYearFilter =
    isAllYearsExplicit || selectedEventYearLevels.length > 0;
  const hasEventCourseFilter =
    isAllCoursesExplicit || selectedEventCourses.length > 0;
  const hasEventRegistrantSelection =
    hasSpecificTarget || hasEventYearFilter || hasEventCourseFilter;
  const hasNotifYearFilter =
    isAllNotifYearsExplicit || selectedNotifYearLevels.length > 0;
  const hasNotifCourseFilter =
    isAllNotifCoursesExplicit || selectedNotifCourses.length > 0;
  const eventYearLevelLabel = isAllYearsExplicit
    ? "All Years"
    : selectedEventYearLevels.length > 0
      ? selectedEventYearLevels.join(", ")
      : "";
  const eventCourseLabel = isAllCoursesExplicit
    ? "All Courses"
    : selectedEventCourses.length > 0
      ? selectedEventCourses.join(", ")
      : "";
  const registrantsRequiredMissing =
    !isPreReg && !hasEventRegistrantSelection && !isEditingEvent;
  const notifHasSpecificTarget = selectedNotifStudents.length > 0;
  const notifYearLevelLabel = isAllNotifYearsExplicit
    ? "All Years"
    : selectedNotifYearLevels.length > 0
      ? selectedNotifYearLevels.join(", ")
      : "";
  const notifCourseLabel = isAllNotifCoursesExplicit
    ? "All Courses"
    : selectedNotifCourses.length > 0
      ? selectedNotifCourses.join(", ")
      : "";
  const hasNotifRecipientSelection =
    notifHasSpecificTarget || hasNotifYearFilter || hasNotifCourseFilter;
  const notifRecipientsRequiredMissing =
    !isEditingNotification && !hasNotifRecipientSelection;
  const viewAllModalImages = useMemo(() => {
    if (!viewAllFilesModal.eventId) return [];
    return eventImages[viewAllFilesModal.eventId] ?? [];
  }, [eventImages, viewAllFilesModal.eventId]);
  const viewAllModalDocs = useMemo(() => {
    if (!viewAllFilesModal.eventId) return [];
    return eventDocs[viewAllFilesModal.eventId] ?? [];
  }, [eventDocs, viewAllFilesModal.eventId]);
  const sortedViewAllModalImages = useMemo(() => {
    const list = [...viewAllModalImages];
    list.sort((a, b) => {
      const aName = String(a.name ?? a.id).toLowerCase();
      const bName = String(b.name ?? b.id).toLowerCase();
      return imageModalSortMode === "ascending"
        ? aName.localeCompare(bName)
        : bName.localeCompare(aName);
    });
    return list;
  }, [viewAllModalImages, imageModalSortMode]);
  const sortedFilteredViewAllModalDocs = useMemo(() => {
    const search = documentModalSearch.trim().toLowerCase();
    const filtered = viewAllModalDocs.filter((file) => {
      if (!search) return true;
      const name = String(file.name ?? "").toLowerCase();
      const contentType = String(file.contentType ?? "").toLowerCase();
      return name.includes(search) || contentType.includes(search);
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      const aName = String(a.name ?? a.id).toLowerCase();
      const bName = String(b.name ?? b.id).toLowerCase();
      return documentModalSortMode === "ascending"
        ? aName.localeCompare(bName)
        : bName.localeCompare(aName);
    });
    return sorted;
  }, [documentModalSearch, documentModalSortMode, viewAllModalDocs]);

  const openViewAllFilesModal = (
    eventId: string,
    eventTitle: string,
    kind: EventFilesTab,
  ) => {
    if (kind === "images") {
      setImageModalSortMode("ascending");
    }
    if (kind === "docs") {
      setDocumentModalSortMode("ascending");
      setDocumentModalSearch("");
    }
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
    const pieces: string[] = [];
    if (String(item.targetStudent ?? "").trim()) {
      pieces.push(`Students: ${item.targetStudent}`);
    }
    if (
      String(item.yearLevel ?? "").trim() &&
      String(item.yearLevel).trim() !== "All Years"
    ) {
      pieces.push(`Year: ${item.yearLevel}`);
    }
    if (
      String(item.course ?? "").trim() &&
      String(item.course).trim() !== "All Courses"
    ) {
      pieces.push(`Course: ${item.course}`);
    }

    if (pieces.length > 0) return pieces.join(" | ");
    return "All Students";
  };

  async function uploadToEvent(
    eventId: string,
    kind: "images" | "docs",
    file: File,
  ) {
    if (!currentUser) throw new Error("Not logged in");
    if (!isECUser) throw new Error("Only EC can upload");

    const safeName = file.name.replace(/[^\w.\-()+ ]/g, "_");
    const fileId = `${Date.now()}_${safeName}`;
    const path = `events/${eventId}/${kind}/${fileId}`;

    const storageRef = ref(storage, path);
    const snap = await uploadBytes(storageRef, file, {
      contentType: file.type,
    });
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
      const params = new URLSearchParams({
        url: file.downloadURL,
        name: safeName,
      });
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
    files: FileList | File[] | null,
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
    setUploadMsg(
      `Uploading ${pickedFiles.length} file${pickedFiles.length === 1 ? "" : "s"}...`,
    );
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
            compressed = await compressImageForUpload(
              file,
              MAX_EVENT_FILE_SIZE_BYTES,
            );
          } catch (e: any) {
            rejected.push(
              `${file.name}: ${e?.message || "Image compression failed."}`,
            );
            continue;
          }

          if (compressed.size > MAX_EVENT_FILE_SIZE_BYTES) {
            rejected.push(
              `${file.name}: still ${toMegabytesText(compressed.size)} after compression. Max is 10MB.`,
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
          rejected.push(
            `${file.name}: only PDF, DOC, or DOCX files are allowed.`,
          );
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
      const overflow =
        rejected.length > 2 ? ` (+${rejected.length - 2} more)` : "";
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
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const pickedFiles = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = "";

    if (pickedFiles.length > 0) {
      addToast({
        title:
          kind === "images"
            ? "Preparing image upload"
            : "Preparing document upload",
        description: `${pickedFiles.length} file${pickedFiles.length === 1 ? "" : "s"} selected.`,
        color: "success",
        timeout: 2500,
      });
    }

    void handlePickFiles(eventId, kind, pickedFiles);
  }

  async function deleteEventFile(
    eventId: string,
    kind: "images" | "docs",
    fileDocId: string,
    path: string,
  ) {
    if (!isECUser) return;
    await deleteObject(ref(storage, path));
    await deleteDoc(doc(db, "events", eventId, kind, fileDocId));
  }

  function requestDeleteEventFile(
    eventId: string,
    kind: "images" | "docs",
    fileDocId: string,
    path: string,
    fileName: string,
  ) {
    if (!isECUser) return;
    setPendingDeleteFile({
      eventId,
      kind,
      fileDocId,
      path,
      fileName,
    });
  }

  async function confirmDeleteEventFile() {
    if (!pendingDeleteFile) return;

    setDeleteSubmitting(true);
    setUploadErr("");

    try {
      await deleteEventFile(
        pendingDeleteFile.eventId,
        pendingDeleteFile.kind,
        pendingDeleteFile.fileDocId,
        pendingDeleteFile.path,
      );

      addToast({
        title: "File deleted",
        description: `${pendingDeleteFile.fileName} was removed.`,
        color: "success",
        timeout: 3500,
      });

      setPendingDeleteFile(null);
    } catch (error: any) {
      const message = error?.message || "Failed to delete file.";
      setUploadErr(message);
      addToast({
        title: "Delete failed",
        description: message,
        color: "danger",
        timeout: 5500,
      });
    } finally {
      setDeleteSubmitting(false);
    }
  }

  async function deleteDocsInChunks(
    docs: QueryDocumentSnapshot<DocumentData>[],
  ) {
    if (docs.length === 0) return;

    const chunkSize = 400;
    for (let i = 0; i < docs.length; i += chunkSize) {
      const chunk = docs.slice(i, i + chunkSize);
      const batch = writeBatch(db);
      chunk.forEach((snap) => {
        batch.delete(snap.ref);
      });
      await batch.commit();
    }
  }

  async function deleteCompletedEventById(eventId: string) {
    const [imagesSnap, docsSnap, attendanceSnap, registrationsSnap] =
      await Promise.all([
        getDocs(collection(db, "events", eventId, "images")),
        getDocs(collection(db, "events", eventId, "docs")),
        getDocs(collection(db, "events", eventId, "attendance")),
        getDocs(collection(db, "events", eventId, "registrations")),
      ]);

    const storagePaths = [...imagesSnap.docs, ...docsSnap.docs]
      .map((snap) => String(snap.data()?.path ?? "").trim())
      .filter(Boolean);

    const storageDeletionResults = await Promise.allSettled(
      storagePaths.map(async (path) => {
        try {
          await deleteObject(ref(storage, path));
        } catch (error: any) {
          const code = String(error?.code ?? "");
          if (code !== "storage/object-not-found") {
            throw error;
          }
        }
      }),
    );

    const storageDeleteFailed = storageDeletionResults.some(
      (result) => result.status === "rejected",
    );
    if (storageDeleteFailed) {
      console.warn(
        "[EC Events] Some event files could not be removed from storage.",
        { eventId },
      );
    }

    await deleteDocsInChunks([
      ...imagesSnap.docs,
      ...docsSnap.docs,
      ...attendanceSnap.docs,
      ...registrationsSnap.docs,
    ]);
    await deleteDoc(doc(db, "events", eventId));
  }

  function requestDeleteCompletedEvent(eventToDelete: EventDoc) {
    if (roleLoading) {
      addToast({
        title: "Please wait",
        description: "Role check is still in progress.",
        color: "warning",
        timeout: 4500,
      });
      return;
    }

    if (!isECUser) {
      addToast({
        title: "Access denied",
        description: "Only EC members can delete events.",
        color: "danger",
        timeout: 5000,
      });
      return;
    }

    if (computeStatus(eventToDelete) !== "completed") {
      addToast({
        title: "Delete unavailable",
        description: "Only completed events can be deleted.",
        color: "warning",
        timeout: 5000,
      });
      return;
    }

    setPendingDeleteEvent({
      id: eventToDelete.id,
      title: String(eventToDelete.title ?? "Event"),
    });
  }

  async function confirmDeleteCompletedEvent() {
    if (!pendingDeleteEvent) return;

    setDeleteEventSubmitting(true);

    try {
      const eventToDelete = events.find(
        (ev) => ev.id === pendingDeleteEvent.id,
      );
      if (!eventToDelete) {
        throw new Error("The event no longer exists.");
      }

      if (computeStatus(eventToDelete) !== "completed") {
        throw new Error("Only completed events can be deleted.");
      }

      await deleteCompletedEventById(eventToDelete.id);

      if (expandedEventId === eventToDelete.id) {
        setExpandedEventId(null);
      }

      if (editingEventId === eventToDelete.id) {
        setEditingEventId(null);
        setShowAddEventForm(false);
        resetEventComposer();
      }

      if (viewAllFilesModal.eventId === eventToDelete.id) {
        closeViewAllFilesModal();
      }

      setEventImages((prev) => {
        if (!(eventToDelete.id in prev)) return prev;
        const next = { ...prev };
        delete next[eventToDelete.id];
        return next;
      });
      setEventDocs((prev) => {
        if (!(eventToDelete.id in prev)) return prev;
        const next = { ...prev };
        delete next[eventToDelete.id];
        return next;
      });
      setEventRegistrations((prev) => {
        if (!(eventToDelete.id in prev)) return prev;
        const next = { ...prev };
        delete next[eventToDelete.id];
        return next;
      });

      setPendingDeleteEvent(null);
      addToast({
        title: "Event deleted",
        description: `${eventToDelete.title} was removed.`,
        color: "success",
        timeout: 3500,
      });
    } catch (error: any) {
      const message = error?.message || "Failed to delete event.";
      addToast({
        title: "Delete failed",
        description: message,
        color: "danger",
        timeout: 5500,
      });
    } finally {
      setDeleteEventSubmitting(false);
    }
  }

  const resetNotificationComposer = useCallback(() => {
    setNotifTitle("");
    const nextNotifDate = isoDateToday();
    const nextNotifTime = now24h();
    setNotifDate(nextNotifDate);
    setNotifDateValue(toCalendarDate(nextNotifDate));
    setNotifMessage("");
    setNotifSearchName("");
    setNotifSearchId("");
    setSelectedNotifStudents([]);
    setNotifYearSearch("");
    setSelectedNotifYearLevels([]);
    setShowNotifYearDropdown(false);
    setIsAllNotifYearsExplicit(false);
    setNotifCourseSearch("");
    setSelectedNotifCourses([]);
    setShowNotifCourseDropdown(false);
    setIsAllNotifCoursesExplicit(false);
    setNotifRegistrantsModalOpen(false);
    setShowStudentDropdown(false);
    setNotifScheduled24(nextNotifTime);
    setNotifScheduledValue(toTimeValue(nextNotifTime));
    setEditingNotificationDispatchId(null);
  }, []);

  const handleStartEditScheduledNotification = async (
    item: NotificationSummary,
  ) => {
    setNotifError("");
    setNotifMsg("");

    if (roleLoading) {
      addToast({
        title: "Please wait",
        description: "Role check is still in progress.",
        color: "warning",
        timeout: 4500,
      });
      return;
    }

    if (!isECUser) {
      addToast({
        title: "Access denied",
        description: "Only EC members can edit notifications.",
        color: "danger",
        timeout: 5000,
      });
      return;
    }

    const allStudents =
      studentOptions.length > 0
        ? studentOptions
        : await loadStudentsForNotifications();
    const parsedSelectedStudents = parseTargetStudents(
      item.targetStudent,
      allStudents,
    );
    const legacyYears = splitCommaValues(item.yearLevel);
    const legacyCourses = splitCommaValues(item.course);
    const parsedYears = legacyYears.filter((entry) =>
      EVENT_YEAR_LEVEL_CHOICES.includes(entry),
    );
    const parsedCourses = legacyCourses.filter((entry) =>
      EVENT_COURSE_CHOICES.includes(entry),
    );
    const allYearsExplicit =
      parsedYears.length === 0 &&
      legacyYears.some((entry) => entry.toLowerCase() === "all years");
    const allCoursesExplicit =
      parsedCourses.length === 0 &&
      legacyCourses.some((entry) => entry.toLowerCase() === "all courses");

    const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(String(item.date ?? ""))
      ? String(item.date)
      : isoDateToday();
    const scheduledMinutes = parseTime12ToMinutes(item.scheduledTime);
    const nextScheduled24 =
      scheduledMinutes == null ? now24h() : minutesTo24h(scheduledMinutes);

    setEditingNotificationDispatchId(item.dispatchId);
    setNotifTitle(String(item.title ?? ""));
    setNotifDate(nextDate);
    setNotifDateValue(toCalendarDate(nextDate));
    setNotifMessage(String(item.message ?? ""));
    setNotifScheduled24(nextScheduled24);
    setNotifScheduledValue(toTimeValue(nextScheduled24));
    setSelectedNotifStudents(parsedSelectedStudents);
    setSelectedNotifYearLevels(parsedYears);
    setIsAllNotifYearsExplicit(allYearsExplicit);
    setSelectedNotifCourses(parsedCourses);
    setIsAllNotifCoursesExplicit(allCoursesExplicit);
    setNotifYearSearch("");
    setNotifCourseSearch("");
    setNotifSearchName("");
    setNotifSearchId("");
    setShowStudentDropdown(false);
    setShowNotifYearDropdown(false);
    setShowNotifCourseDropdown(false);
    setNotifRegistrantsModalOpen(false);

    setShowAddEventForm(false);
    setShowNotificationForm(true);
  };

  const handleSendNotification = async () => {
    setNotifError("");
    setNotifMsg("");

    if (roleLoading) return setNotifError("Checking your role, please wait...");
    if (!isECUser)
      return setNotifError("Only EC members can send notifications.");
    if (!notifTitle.trim())
      return setNotifError("Notification title is required.");
    if (!notifDate) return setNotifError("Notification date is required.");
    if (!notifMessage.trim())
      return setNotifError("Notification message is required.");
    const title = notifTitle.trim();
    const message = notifMessage.trim();
    const scheduledTime = format12h(notifScheduled24);
    const selectedLabel = selectedNotifStudents
      .map((student) => `${student.studentName} (${student.schoolId})`)
      .join("; ");
    const hasSpecificRecipients = selectedNotifStudents.length > 0;
    const yearLevelValue = isAllNotifYearsExplicit
      ? "All Years"
      : selectedNotifYearLevels.join(", ");
    const courseValue = isAllNotifCoursesExplicit
      ? "All Courses"
      : selectedNotifCourses.join(", ");
    const derivedRecipientType: NotificationSummary["recipientType"] =
      hasSpecificRecipients
        ? "student"
        : hasNotifCourseFilter && !isAllNotifCoursesExplicit
          ? "course"
          : hasNotifYearFilter && !isAllNotifYearsExplicit
            ? "year"
            : "all";

    if (!editingNotificationDispatchId && !hasNotifRecipientSelection) {
      return setNotifError(
        "Choose at least one registrant before sending a notification.",
      );
    }

    if (editingNotificationDispatchId) {
      if (!currentUser?.uid)
        return setNotifError("Session not ready. Please sign in again.");

      const existing =
        notifications.find(
          (item) => item.dispatchId === editingNotificationDispatchId,
        ) ?? null;
      if (!existing) return setNotifError("Notification record not found.");
      const payloadTargetStudent =
        selectedNotifStudents.length > 0
          ? selectedLabel
          : String(existing.targetStudent ?? "");
      const payloadCourse = courseValue || String(existing.course ?? "");
      const payloadYearLevel =
        yearLevelValue || String(existing.yearLevel ?? "");
      const payloadRecipientType: NotificationSummary["recipientType"] =
        payloadTargetStudent
          ? "student"
          : payloadCourse === "All Courses" || payloadYearLevel === "All Years"
            ? "all"
            : payloadCourse && payloadCourse !== "All Courses"
            ? "course"
            : payloadYearLevel && payloadYearLevel !== "All Years"
              ? "year"
              : existing.recipientType;

      const payload = {
        title,
        message,
        date: notifDate,
        scheduledTime,
        recipientType: payloadRecipientType,
        course: payloadCourse,
        yearLevel: payloadYearLevel,
        targetStudent: payloadTargetStudent,
        courses: selectedNotifCourses,
        yearLevels: selectedNotifYearLevels,
        status: computeNotificationStatus(notifDate, scheduledTime),
        updatedAt: serverTimestamp(),
      };

      try {
        setSendingNotif(true);
        // Always update the EC sender summary document first.
        await setDoc(
          doc(
            db,
            "profiles",
            currentUser.uid,
            "notifications",
            `dispatch_${editingNotificationDispatchId}`,
          ),
          {
            ...payload,
            dispatchId: editingNotificationDispatchId,
            recipientCount: existing.recipientCount,
            createdByUid: currentUser.uid,
            read: true,
            type: "announcement",
          },
          { merge: true },
        );

        let bulkUpdateBlockedByPermissions = false;

        try {
          const dispatchQ = query(
            collectionGroup(db, "notifications"),
            where("dispatchId", "==", editingNotificationDispatchId),
            limit(2000),
          );
          const dispatchSnap = await getDocs(dispatchQ);
          const docsToUpdate = dispatchSnap.docs.filter(
            (d) => String(d.data()?.createdByUid ?? "") === currentUser.uid,
          );

          if (docsToUpdate.length > 0) {
            const chunkSize = 400;
            for (let i = 0; i < docsToUpdate.length; i += chunkSize) {
              const chunk = docsToUpdate.slice(i, i + chunkSize);
              const batch = writeBatch(db);
              chunk.forEach((d) => {
                batch.set(d.ref, payload, { merge: true });
              });
              await batch.commit();
            }
          }
        } catch (bulkError: any) {
          const code = String(bulkError?.code ?? "");
          const message = String(bulkError?.message ?? "");
          const permissionDenied =
            code === "permission-denied" ||
            message.toLowerCase().includes("insufficient permissions") ||
            message
              .toLowerCase()
              .includes("missing or insufficient permissions");

          if (!permissionDenied) {
            throw bulkError;
          }

          bulkUpdateBlockedByPermissions = true;
          console.warn(
            "[EC Notifications] Bulk recipient update skipped due to Firestore permissions.",
            {
              dispatchId: editingNotificationDispatchId,
              code,
              message,
            },
          );
        }

        setNotifications((prev) =>
          prev
            .map((item) =>
              item.dispatchId === editingNotificationDispatchId
                ? {
                    ...item,
                    title,
                    message,
                    date: notifDate,
                    scheduledTime,
                    recipientType: payloadRecipientType,
                    course: payloadCourse,
                    yearLevel: payloadYearLevel,
                    targetStudent: payloadTargetStudent,
                    status: computeNotificationStatus(notifDate, scheduledTime),
                  }
                : item,
            )
            .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt)),
        );

        resetNotificationComposer();
        if (bulkUpdateBlockedByPermissions) {
          setNotifMsg(
            "Notification updated in EC list. Recipient records were not updated due to Firestore permissions.",
          );
          addToast({
            title: "Updated with limits",
            description:
              "EC notification copy was updated, but recipient copies require broader Firestore update permissions.",
            color: "warning",
            timeout: 6500,
          });
        } else {
          setNotifMsg("Notification updated.");
        }
        setNotificationPage(1);
        setExpandedNotificationId(editingNotificationDispatchId);
        void refreshSentNotificationsOnce();
        return;
      } catch (error: unknown) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to update notification.";
        setNotifError(message);
        return;
      } finally {
        setSendingNotif(false);
      }
    }

    let students = studentOptions;
    if (studentsLoading && students.length === 0) {
      return setNotifError("Students are still loading. Please wait.");
    }
    if (students.length === 0) {
      students = await loadStudentsForNotifications();
    }
    if (students.length === 0)
      return setNotifError("No student records found.");

    const selectedStudentIdSet = new Set(
      selectedNotifStudents.map((student) => student.uid),
    );
    const recipients = students.filter((student) => {
      const yearMatch =
        selectedNotifYearLevels.length === 0 ||
        selectedNotifYearLevels.includes(String(student.year ?? "").trim());
      const courseMatch =
        selectedNotifCourses.length === 0 ||
        selectedNotifCourses.includes(String(student.course ?? "").trim());
      const studentMatch =
        selectedStudentIdSet.size === 0 ||
        selectedStudentIdSet.has(student.uid);
      return yearMatch && courseMatch && studentMatch;
    });

    if (recipients.length === 0) {
      return setNotifError(
        "No recipients found for the selected registrant filters.",
      );
    }

    const dispatchId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    try {
      setSendingNotif(true);
      const chunkSize = 400;

      for (let i = 0; i < recipients.length; i += chunkSize) {
        const chunk = recipients.slice(i, i + chunkSize);
        const batch = writeBatch(db);

        chunk.forEach((student) => {
          const notifRef = doc(
            collection(db, "profiles", student.uid, "notifications"),
          );
          batch.set(notifRef, {
            title,
            message,
            date: notifDate,
            scheduledTime,
            type: "announcement",
            dispatchId,
            recipientType: derivedRecipientType,
            course: courseValue,
            yearLevel: yearLevelValue,
            targetStudent: selectedLabel,
            courses: selectedNotifCourses,
            yearLevels: selectedNotifYearLevels,
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
        await setDoc(
          doc(
            db,
            "profiles",
            currentUser.uid,
            "notifications",
            `dispatch_${dispatchId}`,
          ),
          {
            title,
            message,
            date: notifDate,
            scheduledTime,
            type: "announcement",
            dispatchId,
            recipientType: derivedRecipientType,
            course: courseValue,
            yearLevel: yearLevelValue,
            targetStudent: selectedLabel,
            courses: selectedNotifCourses,
            yearLevels: selectedNotifYearLevels,
            recipientCount: recipients.length,
            createdByUid: currentUser.uid,
            createdAt: serverTimestamp(),
            read: true,
          },
        );
      }

      const optimisticCreatedAt = new Date();
      const optimisticRow: NotificationSummary = {
        id: dispatchId,
        dispatchId,
        title,
        message,
        date: notifDate,
        scheduledTime,
        recipientType: derivedRecipientType,
        course: courseValue,
        yearLevel: yearLevelValue,
        targetStudent: selectedLabel,
        createdAt: optimisticCreatedAt,
        recipientCount: recipients.length,
        status: computeNotificationStatus(notifDate, scheduledTime),
      };

      setNotifications((prev) => {
        const next = [
          optimisticRow,
          ...prev.filter((item) => item.dispatchId !== dispatchId),
        ];
        return next.sort(
          (a, b) => toMillis(b.createdAt) - toMillis(a.createdAt),
        );
      });
      setNotificationPage(1);
      void refreshSentNotificationsOnce();

      setNotifMsg(`Notification sent to ${recipients.length} student(s).`);
      resetNotificationComposer();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to send notification.";
      setNotifError(message);
    } finally {
      setSendingNotif(false);
    }
  };

  const resetEventComposer = useCallback(() => {
    const nextEventDate = isoDateToday();
    setTitle("");
    setLocation("");
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
    setRegistrantsModalOpen(false);
    setPreRegSlots(50);
    setEventScheduled24("07:00");
    setEventStartTimeValue(toTimeValue("07:00"));
    setEventEnd24("08:00");
    setEventEndTimeValue(toTimeValue("08:00"));
  }, []);

  const handleStartEditUpcomingEvent = async (eventToEdit: EventDoc) => {
    setSaveError("");
    setSaveMsg("");

    if (roleLoading) {
      addToast({
        title: "Please wait",
        description: "Role check is still in progress.",
        color: "warning",
        timeout: 4500,
      });
      return;
    }

    if (!isECUser) {
      addToast({
        title: "Access denied",
        description: "Only EC members can edit events.",
        color: "danger",
        timeout: 5000,
      });
      return;
    }

    if (computeStatus(eventToEdit) !== "upcoming") {
      addToast({
        title: "Edit unavailable",
        description: "Only upcoming events can be edited.",
        color: "warning",
        timeout: 5000,
      });
      return;
    }

    const allStudents =
      studentOptions.length > 0
        ? studentOptions
        : await loadStudentsForNotifications();

    const startMinutes = parseTime12ToMinutes(
      eventToEdit.scheduledTime || eventToEdit.timeStart,
    );
    const start24 = startMinutes == null ? "07:00" : minutesTo24h(startMinutes);
    const endMinutes = parseTime12ToMinutes(eventToEdit.timeEnd);
    const end24 =
      endMinutes == null
        ? minutesTo24h((startMinutes ?? toMinutesFrom24h(start24)) + 60)
        : minutesTo24h(endMinutes);

    const selectedYearsFromArray = Array.isArray(eventToEdit.yearLevels)
      ? eventToEdit.yearLevels
          .map((item) => String(item).trim())
          .filter(Boolean)
      : [];
    const selectedCoursesFromArray = Array.isArray(eventToEdit.courses)
      ? eventToEdit.courses.map((item) => String(item).trim()).filter(Boolean)
      : [];

    const legacyYears = splitCommaValues(eventToEdit.yearLevel);
    const legacyCourses = splitCommaValues(eventToEdit.course);

    const selectedYears = (
      selectedYearsFromArray.length > 0 ? selectedYearsFromArray : legacyYears
    ).filter((item) => EVENT_YEAR_LEVEL_CHOICES.includes(item));
    const selectedCourses = (
      selectedCoursesFromArray.length > 0
        ? selectedCoursesFromArray
        : legacyCourses
    ).filter((item) => EVENT_COURSE_CHOICES.includes(item));
    const allYearsExplicit =
      selectedYears.length === 0 &&
      legacyYears.some((item) => item.toLowerCase() === "all years");
    const allCoursesExplicit =
      selectedCourses.length === 0 &&
      legacyCourses.some((item) => item.toLowerCase() === "all courses");

    const parsedTargets = parseTargetStudents(
      eventToEdit.targetStudent,
      allStudents,
    );
    const nextDate = /^\d{4}-\d{2}-\d{2}$/.test(String(eventToEdit.date ?? ""))
      ? String(eventToEdit.date)
      : isoDateToday();

    setEditingEventId(eventToEdit.id);
    setTitle(String(eventToEdit.title ?? ""));
    setLocation(String(eventToEdit.location ?? ""));
    setDate(nextDate);
    setEventDateValue(toCalendarDate(nextDate));
    setDetails(String(eventToEdit.details ?? ""));

    const preRegEnabled = Boolean(eventToEdit.isPreReg);
    setIsPreReg(preRegEnabled);
    setWithPayment(Boolean(eventToEdit.withPayment));
    setPreRegSlots(
      typeof eventToEdit.preRegSlots === "number" &&
        eventToEdit.preRegSlots >= 0
        ? Math.trunc(eventToEdit.preRegSlots)
        : 50,
    );

    setEventScheduled24(start24);
    setEventStartTimeValue(toTimeValue(start24));
    setEventEnd24(end24);
    setEventEndTimeValue(toTimeValue(end24));

    if (preRegEnabled) {
      setSelectedEventYearLevels([]);
      setSelectedEventCourses([]);
      setIsAllYearsExplicit(false);
      setIsAllCoursesExplicit(false);
      setSelectedEventStudents([]);
    } else {
      setSelectedEventYearLevels(selectedYears);
      setSelectedEventCourses(selectedCourses);
      setIsAllYearsExplicit(allYearsExplicit);
      setIsAllCoursesExplicit(allCoursesExplicit);
      setSelectedEventStudents(parsedTargets);
    }

    setEventYearSearch("");
    setEventCourseSearch("");
    setEventSearchName("");
    setShowEventYearDropdown(false);
    setShowEventCourseDropdown(false);
    setShowEventStudentDropdown(false);
    setRegistrantsModalOpen(false);

    setShowNotificationForm(false);
    setShowAddEventForm(true);
  };

  const handleSaveEvent = async () => {
    setSaveError("");
    setSaveMsg("");

    if (roleLoading) return setSaveError("Checking your role, please wait...");
    if (!isECUser) return setSaveError("Only EC members can save events.");
    if (!title.trim()) return setSaveError("Title is required.");
    if (!date) return setSaveError("Date is required.");
    if (toMinutesFrom24h(eventEnd24) <= toMinutesFrom24h(eventScheduled24)) {
      return setSaveError("End time must be later than start time.");
    }
    if (isPreReg && (Number.isNaN(preRegSlots) || preRegSlots < 0)) {
      return setSaveError("Pre-reg slots must be at least 0.");
    }
    if (!isPreReg && !hasEventRegistrantSelection && !editingEventId) {
      return setSaveError(
        "Choose at least one registrant filter or student before creating an event.",
      );
    }

    const eventBeingEdited = editingEventId
      ? (events.find((ev) => ev.id === editingEventId) ?? null)
      : null;
    if (editingEventId && !eventBeingEdited) {
      return setSaveError("The event you are editing no longer exists.");
    }
    if (eventBeingEdited && computeStatus(eventBeingEdited) !== "upcoming") {
      return setSaveError("Only upcoming events can be edited.");
    }

    try {
      setSaving(true);
      const slots = isPreReg ? preRegSlots : null;
      const studentTarget = selectedEventStudents
        .map((student) => `${student.studentName} (${student.schoolId})`)
        .join("; ");
      const startTime = format12h(eventScheduled24);
      const endTime = format12h(eventEnd24);
      const yearLevelValue = isAllYearsExplicit
        ? "All Years"
        : selectedEventYearLevels.join(", ");
      const courseValue = isAllCoursesExplicit
        ? "All Courses"
        : selectedEventCourses.join(", ");
      const liveRegistrationCount = editingEventId
        ? eventRegistrations[editingEventId]?.length
        : undefined;
      const fallbackRegistrationCount =
        typeof eventBeingEdited?.preRegCount === "number"
          ? Math.max(0, Math.trunc(eventBeingEdited.preRegCount))
          : 0;
      const preRegCount = isPreReg
        ? (liveRegistrationCount ?? fallbackRegistrationCount)
        : 0;
      const preRegRemaining =
        isPreReg && typeof slots === "number"
          ? Math.max(0, slots - preRegCount)
          : 0;
      const savePayload = {
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
        preRegCount,
        preRegRemaining,
      };

      if (editingEventId) {
        await setDoc(
          doc(db, "events", editingEventId),
          {
            ...savePayload,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
        setSaveMsg("Event updated!");
      } else {
        await addDoc(collection(db, "events"), {
          ...savePayload,
          createdBy: currentUser ? currentUser.uid : null,
          createdAt: serverTimestamp(),
          status: "upcoming",
        });
        setSaveMsg("Event saved!");
      }

      setEditingEventId(null);
      resetEventComposer();
      setShowAddEventForm(false);
    } catch (err: any) {
      setSaveError(
        err?.message ||
          (editingEventId
            ? "Failed to update event."
            : "Failed to save event."),
      );
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
          schoolId: string;
          studentName: string;
          course: string;
          year: string;
          attendanceStatus: string;
          attendanceTimeIn: string;
          attendanceTimeOut: string;
        }
      >();

      registrationsSnap.docs.forEach((d) => {
        const data = d.data() as Partial<RegistrationDoc>;
        const uid = String(data.uid ?? d.id);
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

      attendanceSnap.docs.forEach((d) => {
        const data = d.data() as {
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
          timeIn?: any;
          timeInIso?: string;
          timeOut?: any;
          timeOutIso?: string;
          timestamp?: any;
          deviceTimestampIso?: string;
          createdAt?: any;
          updatedAt?: any;
        };

        const uid = String(data.uid ?? data.studentUid ?? d.id);
        if (!uid) return;

        const existing = rowsByUid.get(uid);
        const fallbackStatus =
          typeof data.present === "boolean"
            ? data.present
              ? "Present"
              : "Absent"
            : "";
        const timeInValue = formatDateTime(
          data.timeInIso ||
            data.timeIn ||
            data.timestamp ||
            data.updatedAt ||
            data.createdAt,
        );
        const timeOutValue = formatDateTime(data.timeOutIso || data.timeOut);
        const derivedStatus =
          timeInValue !== "-" && timeOutValue !== "-"
            ? "Present"
            : timeInValue !== "-"
              ? "Timed In"
              : "";
        const status =
          String(
            data.attendanceStatus ?? data.status ?? fallbackStatus ?? "",
          ).trim() ||
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
            timeInValue !== "-"
              ? timeInValue
              : (existing?.attendanceTimeIn ?? "-"),
          attendanceTimeOut:
            timeOutValue !== "-"
              ? timeOutValue
              : (existing?.attendanceTimeOut ?? "-"),
        });
      });

      const rows = Array.from(rowsByUid.values()).sort((a, b) => {
        const byName = a.studentName.localeCompare(b.studentName);
        if (byName !== 0) return byName;
        return a.schoolId.localeCompare(b.schoolId);
      });

      if (rows.length === 0) {
        setExportError(
          "No registration or attendance records found for this event.",
        );
        return;
      }

      const csvLines = [
        `Event Title,${csvCell(ev.title)}`,
        `Date,${csvCell(ev.date)}`,
        `Scheduled Time Start,${csvCell(ev.scheduledTime || ev.timeStart || "-")}`,
        `Scheduled Time End,${csvCell(ev.timeEnd || "-")}`,
        `Location,${csvCell(ev.location ?? "-")}`,
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
      <Card
        shadow="sm"
        className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#b81f1f] to-[#f09b4c] text-white"
      >
        <CardBody className="space-y-4 p-5 sm:p-8">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
              EC Events
            </p>
            <h1 className="text-2xl font-black leading-tight sm:text-4xl">
              Campus Event Management System
            </h1>
            <p className="max-w-2xl text-sm text-white/80 sm:text-base">
              Organize, manage, and track campus events with a layout that still
              works comfortably on a phone screen.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip variant="flat" className="bg-white/15 text-white">
              {summary.total} events tracked
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              {totalParticipants} participants
            </Chip>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatMini label="Total" value={summary.total} />
            <StatMini label="Upcoming" value={summary.upcoming} />
            <StatMini label="Ongoing" value={summary.ongoing} />
            <StatMini label="Completed" value={summary.completed} />
            <StatMini label="Participants" value={totalParticipants} />
          </div>
        </CardBody>
      </Card>

      <Card shadow="sm" className="border">
        <CardHeader className="px-5 pt-5">
          <div>
            <h2 className="text-lg font-semibold text-campus-text-primary">
              Quick Actions
            </h2>
            <p className="text-sm text-campus-text-secondary">
              Create events and notifications without losing context.
            </p>
          </div>
        </CardHeader>
        <CardBody className="p-4 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Button
              className="text-sm font-semibold text-white"
              style={{ backgroundColor: "#006FEE" }}
              onPress={() =>
                setShowNotificationForm((v) => {
                  const next = !v;
                  if (next) {
                    setNotifError("");
                    setNotifMsg("");
                    resetNotificationComposer();
                    setShowAddEventForm(false);
                    setEditingEventId(null);
                  }
                  return next;
                })
              }
            >
              Create notification
            </Button>

            <Button
              className="text-sm font-semibold text-white"
              style={{ backgroundColor: "#7b0000" }}
              onPress={() =>
                setShowAddEventForm((v) => {
                  const next = !v;
                  if (next) {
                    setEditingEventId(null);
                    setEditingNotificationDispatchId(null);
                    setSaveError("");
                    setSaveMsg("");
                    resetEventComposer();
                    setShowNotificationForm(false);
                  } else {
                    setEditingEventId(null);
                    setEditingNotificationDispatchId(null);
                  }
                  return next;
                })
              }
            >
              Create Event
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* ADD EVENT FORM */}
      {showAddEventForm && (
        <div className="bg-white p-4 sm:p-6 border rounded-xl shadow space-y-4 animate-slideDown">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <h2 className="text-xl font-semibold text-primary-900">
              {isEditingEvent ? "Edit Event" : "Add New Event"}
            </h2>

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
            <Input
              aria-label="Event title"
              value={title}
              onValueChange={setTitle}
              className="w-full mt-1"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Location</label>
            <Input
              aria-label="Event location"
              value={location}
              onValueChange={setLocation}
              className="w-full mt-1"
            />
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
                          <label className="text-xs font-medium text-campus-text-secondary">
                            Year Level
                          </label>

                          {(isAllYearsExplicit ||
                            selectedEventYearLevels.length > 0) && (
                            <div
                              className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isPreReg ? "bg-gray-100" : "bg-white"}`}
                            >
                              <div className="flex flex-wrap gap-2">
                                {isAllYearsExplicit &&
                                selectedEventYearLevels.length === 0 ? (
                                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">
                                      All Years
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      onPress={() => {
                                        setIsAllYearsExplicit(false);
                                      }}
                                      aria-label="Remove All Years"
                                    >
                                      x
                                    </Button>
                                  </span>
                                ) : (
                                  selectedEventYearLevels.map((item) => (
                                    <span
                                      key={item}
                                      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                    >
                                      <span className="font-medium">
                                        {item}
                                      </span>
                                      <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                        className="h-5 min-w-5 text-campus-text-secondary"
                                        onPress={() => {
                                          setIsAllYearsExplicit(false);
                                          setSelectedEventYearLevels((prev) =>
                                            prev.filter((x) => x !== item),
                                          );
                                        }}
                                        aria-label={`Remove ${item}`}
                                      >
                                        x
                                      </Button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          <div
                            ref={eventYearPickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={eventYearSearch}
                              onValueChange={(value) => {
                                setEventYearSearch(value);
                                setShowEventYearDropdown(true);
                              }}
                              onFocus={() => setShowEventYearDropdown(true)}
                              isDisabled={isPreReg}
                              placeholder="Search year level"
                              size="sm"
                              className="w-full"
                            />

                            {!isPreReg && showEventYearDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {!showAllYearsOption &&
                                filteredEventYearOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                    {selectedEventYearLevels.length ===
                                    EVENT_YEAR_LEVEL_CHOICES.length
                                      ? "All year levels selected."
                                      : "No matching year levels."}
                                  </p>
                                ) : (
                                  <>
                                    {showAllYearsOption && (
                                      <Button
                                        size="sm"
                                        variant="light"
                                        className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                        onPress={() => {
                                          setSelectedEventYearLevels([]);
                                          setIsAllYearsExplicit(true);
                                          setEventYearSearch("");
                                          setShowEventYearDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">
                                          All Years
                                        </div>
                                      </Button>
                                    )}

                                    {filteredEventYearOptions.map((item) => (
                                      <Button
                                        key={item}
                                        size="sm"
                                        variant="light"
                                        className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                        onPress={() => {
                                          setIsAllYearsExplicit(false);
                                          setSelectedEventYearLevels((prev) =>
                                            prev.includes(item)
                                              ? prev
                                              : [...prev, item],
                                          );
                                          setEventYearSearch("");
                                          setShowEventYearDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">
                                          {item}
                                        </div>
                                      </Button>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">
                            Course
                          </label>

                          {(isAllCoursesExplicit ||
                            selectedEventCourses.length > 0) && (
                            <div
                              className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isPreReg ? "bg-gray-100" : "bg-white"}`}
                            >
                              <div className="flex flex-wrap gap-2">
                                {isAllCoursesExplicit &&
                                selectedEventCourses.length === 0 ? (
                                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">
                                      All Courses
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      onPress={() => {
                                        setIsAllCoursesExplicit(false);
                                      }}
                                      aria-label="Remove All Courses"
                                    >
                                      x
                                    </Button>
                                  </span>
                                ) : (
                                  selectedEventCourses.map((item) => (
                                    <span
                                      key={item}
                                      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                    >
                                      <span className="font-medium">
                                        {item}
                                      </span>
                                      <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                        className="h-5 min-w-5 text-campus-text-secondary"
                                        onPress={() => {
                                          setIsAllCoursesExplicit(false);
                                          setSelectedEventCourses((prev) =>
                                            prev.filter((x) => x !== item),
                                          );
                                        }}
                                        aria-label={`Remove ${item}`}
                                      >
                                        x
                                      </Button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          <div
                            ref={eventCoursePickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={eventCourseSearch}
                              onValueChange={(value) => {
                                setEventCourseSearch(value);
                                setShowEventCourseDropdown(true);
                              }}
                              onFocus={() => setShowEventCourseDropdown(true)}
                              isDisabled={isPreReg}
                              placeholder="Search course"
                              size="sm"
                              className="w-full"
                            />

                            {!isPreReg && showEventCourseDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {!showAllCoursesOption &&
                                filteredEventCourseOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                    {selectedEventCourses.length ===
                                    EVENT_COURSE_CHOICES.length
                                      ? "All courses selected."
                                      : "No matching courses."}
                                  </p>
                                ) : (
                                  <>
                                    {showAllCoursesOption && (
                                      <Button
                                        size="sm"
                                        variant="light"
                                        className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                        onPress={() => {
                                          setSelectedEventCourses([]);
                                          setIsAllCoursesExplicit(true);
                                          setEventCourseSearch("");
                                          setShowEventCourseDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">
                                          All Courses
                                        </div>
                                      </Button>
                                    )}

                                    {filteredEventCourseOptions.map((item) => (
                                      <Button
                                        key={item}
                                        size="sm"
                                        variant="light"
                                        className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                        onPress={() => {
                                          setIsAllCoursesExplicit(false);
                                          setSelectedEventCourses((prev) =>
                                            prev.includes(item)
                                              ? prev
                                              : [...prev, item],
                                          );
                                          setEventCourseSearch("");
                                          setShowEventCourseDropdown(true);
                                        }}
                                      >
                                        <div className="text-sm font-medium text-campus-text-primary">
                                          {item}
                                        </div>
                                      </Button>
                                    ))}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">
                            To *
                          </label>

                          {selectedEventStudents.length > 0 && (
                            <div
                              className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isPreReg ? "bg-gray-100" : "bg-white"}`}
                            >
                              <div className="flex flex-wrap gap-2">
                                {selectedEventStudents.map((student) => (
                                  <span
                                    key={student.uid}
                                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                  >
                                    <span className="font-medium">
                                      {student.studentName}
                                    </span>
                                    <span className="text-campus-text-secondary">
                                      ({student.schoolId})
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      onPress={() => {
                                        setSelectedEventStudents((prev) =>
                                          prev.filter(
                                            (x) => x.uid !== student.uid,
                                          ),
                                        );
                                      }}
                                      aria-label={`Remove ${student.studentName}`}
                                    >
                                      x
                                    </Button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div
                            ref={eventStudentPickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={eventSearchName}
                              onValueChange={(value) => {
                                setEventSearchName(value);
                                setShowEventStudentDropdown(true);
                              }}
                              onFocus={() => setShowEventStudentDropdown(true)}
                              isDisabled={isPreReg}
                              placeholder="Search by name"
                              size="sm"
                              className="w-full"
                            />

                            {!isPreReg && showEventStudentDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {studentsLoading ? (
                                  <div className="p-3">
                                    <CampusCardListSkeleton rows={2} />
                                  </div>
                                ) : filteredEventStudentOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                    No matching students.
                                  </p>
                                ) : (
                                  filteredEventStudentOptions.map((student) => (
                                    <Button
                                      key={student.uid}
                                      size="sm"
                                      variant="light"
                                      className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                      onPress={() => {
                                        setSelectedEventStudents((prev) =>
                                          prev.some(
                                            (x) => x.uid === student.uid,
                                          )
                                            ? prev
                                            : [...prev, student],
                                        );
                                        setEventSearchName("");
                                        setShowEventStudentDropdown(true);
                                      }}
                                    >
                                      <div className="text-sm font-medium text-campus-text-primary">
                                        {student.studentName}
                                      </div>
                                      <div className="text-xs text-campus-text-secondary">
                                        {student.schoolId} |{" "}
                                        {student.course || "Unassigned"} |{" "}
                                        {student.year || "Unassigned"}
                                      </div>
                                    </Button>
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

            {isPreReg && (
              <p className="text-xs text-campus-text-secondary">
                Pre-Registration events are open to all year levels and courses.
              </p>
            )}
            {!isPreReg && hasSpecificTarget && (
              <p className="text-xs text-campus-text-secondary">
                Year Level and Course are optional when targeting specific
                students.
              </p>
            )}
            {!isPreReg && (
              <p className="text-xs text-campus-text-secondary">
                Current filters: Year Level - {eventYearLevelLabel}; Course -{" "}
                {eventCourseLabel}.
              </p>
            )}
            {!isPreReg && !hasEventRegistrantSelection && !isEditingEvent && (
              <p className="text-xs text-red-600">
                Choose at least one registrant filter or student to create this
                event.
              </p>
            )}
            {!isPreReg && (
              <p className="text-xs text-campus-text-secondary">
                Choose specific students, Year Level filters, Course filters, or
                a combination of them.
              </p>
            )}
          </div>

          <div>
            <label className="text-sm font-medium">Details</label>
            <Textarea
              aria-label="Event details"
              value={details}
              onValueChange={setDetails}
              minRows={4}
              className="w-full mt-1"
            />
          </div>

          {isPreReg && (
            <div>
              <label className="text-sm font-medium">
                Pre-Registration Slots
              </label>
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
              <p className="text-xs text-campus-text-secondary mt-1">
                This is the maximum number of students allowed to pre-register.
              </p>
            </div>
          )}

          {isEditingEvent && (
            <p className="text-xs text-campus-text-secondary">
              You can edit all fields for upcoming events, including
              pre-registration and payment settings.
            </p>
          )}

          {saveError && <p className="text-red-600 text-sm">{saveError}</p>}
          {saveMsg && <p className="text-green-600 text-sm">{saveMsg}</p>}

          <Button
            color="primary"
            onPress={handleSaveEvent}
            isDisabled={
              saving || roleLoading || !isECUser || registrantsRequiredMissing
            }
            className="w-full"
          >
            {roleLoading
              ? "Checking role..."
              : saving
                ? isEditingEvent
                  ? "Updating..."
                  : "Saving..."
                : isEditingEvent
                  ? "Update Event"
                  : "Save"}
          </Button>

          {!roleLoading && !isECUser && (
            <p className="text-xs text-campus-text-secondary">
              Your Firestore role is not <b>ec</b> in{" "}
              <code>profiles/{`{uid}`}</code>.
            </p>
          )}
        </div>
      )}

      {/* NOTIFICATION FORM */}
      {showNotificationForm && (
        <div className="bg-white p-4 sm:p-6 border rounded-xl shadow space-y-4 animate-slideDown">
          <h2 className="text-xl font-semibold text-blue-600">
            {isEditingNotification ? "Edit Notification" : "Create Notification"}
          </h2>

          <div>
            <label className="text-sm font-medium">Notification Title</label>
            <Input
              aria-label="Notification title"
              value={notifTitle}
              onValueChange={setNotifTitle}
              type="text"
              className="w-full mt-1"
            />
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Registrants</label>
            <Button
              variant="bordered"
              className="w-full justify-between"
              onPress={() => {
                setShowStudentDropdown(false);
                setShowNotifYearDropdown(false);
                setShowNotifCourseDropdown(false);
                setNotifRegistrantsModalOpen(true);
              }}
            >
              Registrants
            </Button>
            <Modal
              isOpen={notifRegistrantsModalOpen}
              onOpenChange={(open) => {
                setNotifRegistrantsModalOpen(open);
                if (!open) {
                  setShowStudentDropdown(false);
                  setShowNotifYearDropdown(false);
                  setShowNotifCourseDropdown(false);
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
                          <label className="text-xs font-medium text-campus-text-secondary">
                            Year Level
                          </label>

                          {(isAllNotifYearsExplicit ||
                            selectedNotifYearLevels.length > 0) && (
                            <div
                              className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isEditingNotification ? "bg-gray-100" : "bg-white"}`}
                            >
                              <div className="flex flex-wrap gap-2">
                                {isAllNotifYearsExplicit &&
                                selectedNotifYearLevels.length === 0 ? (
                                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">
                                      All Years
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      isDisabled={isEditingNotification}
                                      onPress={() => {
                                        setIsAllNotifYearsExplicit(false);
                                      }}
                                      aria-label="Remove All Years"
                                    >
                                      x
                                    </Button>
                                  </span>
                                ) : (
                                  selectedNotifYearLevels.map((item) => (
                                    <span
                                      key={item}
                                      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                    >
                                      <span className="font-medium">
                                        {item}
                                      </span>
                                      <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                        className="h-5 min-w-5 text-campus-text-secondary"
                                        isDisabled={isEditingNotification}
                                        onPress={() => {
                                          setIsAllNotifYearsExplicit(false);
                                          setSelectedNotifYearLevels((prev) =>
                                            prev.filter(
                                              (entry) => entry !== item,
                                            ),
                                          );
                                        }}
                                        aria-label={`Remove ${item}`}
                                      >
                                        x
                                      </Button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          <div
                            ref={notifYearPickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={notifYearSearch}
                              onValueChange={(value) => {
                                setNotifYearSearch(value);
                                setShowNotifYearDropdown(true);
                              }}
                              onFocus={() => setShowNotifYearDropdown(true)}
                              isDisabled={isEditingNotification}
                              placeholder="Search year level"
                              size="sm"
                              className="w-full"
                            />

                            {!isEditingNotification &&
                              showNotifYearDropdown && (
                                <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                  {!showNotifAllYearsOption &&
                                  filteredNotifYearOptions.length === 0 ? (
                                    <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                      {selectedNotifYearLevels.length ===
                                      EVENT_YEAR_LEVEL_CHOICES.length
                                        ? "All year levels selected."
                                        : "No matching year levels."}
                                    </p>
                                  ) : (
                                    <>
                                      {showNotifAllYearsOption && (
                                        <Button
                                          size="sm"
                                          variant="light"
                                          className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                          onPress={() => {
                                            setSelectedNotifYearLevels([]);
                                            setIsAllNotifYearsExplicit(true);
                                            setNotifYearSearch("");
                                            setShowNotifYearDropdown(true);
                                          }}
                                        >
                                          <div className="text-sm font-medium text-campus-text-primary">
                                            All Years
                                          </div>
                                        </Button>
                                      )}

                                      {filteredNotifYearOptions.map((item) => (
                                        <Button
                                          key={item}
                                          size="sm"
                                          variant="light"
                                          className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                          onPress={() => {
                                            setIsAllNotifYearsExplicit(false);
                                            setSelectedNotifYearLevels(
                                              (prev) =>
                                                prev.includes(item)
                                                  ? prev
                                                  : [...prev, item],
                                            );
                                            setNotifYearSearch("");
                                            setShowNotifYearDropdown(true);
                                          }}
                                        >
                                          <div className="text-sm font-medium text-campus-text-primary">
                                            {item}
                                          </div>
                                        </Button>
                                      ))}
                                    </>
                                  )}
                                </div>
                              )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">
                            Course
                          </label>

                          {(isAllNotifCoursesExplicit ||
                            selectedNotifCourses.length > 0) && (
                            <div
                              className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isEditingNotification ? "bg-gray-100" : "bg-white"}`}
                            >
                              <div className="flex flex-wrap gap-2">
                                {isAllNotifCoursesExplicit &&
                                selectedNotifCourses.length === 0 ? (
                                  <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white">
                                    <span className="font-medium">
                                      All Courses
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      isDisabled={isEditingNotification}
                                      onPress={() => {
                                        setIsAllNotifCoursesExplicit(false);
                                      }}
                                      aria-label="Remove All Courses"
                                    >
                                      x
                                    </Button>
                                  </span>
                                ) : (
                                  selectedNotifCourses.map((item) => (
                                    <span
                                      key={item}
                                      className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                    >
                                      <span className="font-medium">
                                        {item}
                                      </span>
                                      <Button
                                        isIconOnly
                                        size="sm"
                                        variant="light"
                                        className="h-5 min-w-5 text-campus-text-secondary"
                                        isDisabled={isEditingNotification}
                                        onPress={() => {
                                          setIsAllNotifCoursesExplicit(false);
                                          setSelectedNotifCourses((prev) =>
                                            prev.filter(
                                              (entry) => entry !== item,
                                            ),
                                          );
                                        }}
                                        aria-label={`Remove ${item}`}
                                      >
                                        x
                                      </Button>
                                    </span>
                                  ))
                                )}
                              </div>
                            </div>
                          )}

                          <div
                            ref={notifCoursePickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={notifCourseSearch}
                              onValueChange={(value) => {
                                setNotifCourseSearch(value);
                                setShowNotifCourseDropdown(true);
                              }}
                              onFocus={() => setShowNotifCourseDropdown(true)}
                              isDisabled={isEditingNotification}
                              placeholder="Search course"
                              size="sm"
                              className="w-full"
                            />

                            {!isEditingNotification &&
                              showNotifCourseDropdown && (
                                <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                  {!showNotifAllCoursesOption &&
                                  filteredNotifCourseOptions.length === 0 ? (
                                    <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                      {selectedNotifCourses.length ===
                                      EVENT_COURSE_CHOICES.length
                                        ? "All courses selected."
                                        : "No matching courses."}
                                    </p>
                                  ) : (
                                    <>
                                      {showNotifAllCoursesOption && (
                                        <Button
                                          size="sm"
                                          variant="light"
                                          className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                          onPress={() => {
                                            setSelectedNotifCourses([]);
                                            setIsAllNotifCoursesExplicit(true);
                                            setNotifCourseSearch("");
                                            setShowNotifCourseDropdown(true);
                                          }}
                                        >
                                          <div className="text-sm font-medium text-campus-text-primary">
                                            All Courses
                                          </div>
                                        </Button>
                                      )}

                                      {filteredNotifCourseOptions.map(
                                        (item) => (
                                          <Button
                                            key={item}
                                            size="sm"
                                            variant="light"
                                            className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                            onPress={() => {
                                              setIsAllNotifCoursesExplicit(
                                                false,
                                              );
                                              setSelectedNotifCourses((prev) =>
                                                prev.includes(item)
                                                  ? prev
                                                  : [...prev, item],
                                              );
                                              setNotifCourseSearch("");
                                              setShowNotifCourseDropdown(true);
                                            }}
                                          >
                                            <div className="text-sm font-medium text-campus-text-primary">
                                              {item}
                                            </div>
                                          </Button>
                                        ),
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                          </div>
                        </div>

                        <div>
                          <label className="text-xs font-medium text-campus-text-secondary">
                            To *
                          </label>

                          {selectedNotifStudents.length > 0 && (
                            <div
                              className={`mt-1 rounded-lg border px-3 py-2 min-h-[52px] ${isEditingNotification ? "bg-gray-100" : "bg-white"}`}
                            >
                              <div className="flex flex-wrap gap-2">
                                {selectedNotifStudents.map((student) => (
                                  <span
                                    key={student.uid}
                                    className="inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm bg-white"
                                  >
                                    <span className="font-medium">
                                      {student.studentName}
                                    </span>
                                    <span className="text-campus-text-secondary">
                                      ({student.schoolId})
                                    </span>
                                    <Button
                                      isIconOnly
                                      size="sm"
                                      variant="light"
                                      className="h-5 min-w-5 text-campus-text-secondary"
                                      isDisabled={isEditingNotification}
                                      onPress={() => {
                                        setSelectedNotifStudents((prev) =>
                                          prev.filter(
                                            (entry) =>
                                              entry.uid !== student.uid,
                                          ),
                                        );
                                      }}
                                      aria-label={`Remove ${student.studentName}`}
                                    >
                                      x
                                    </Button>
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div
                            ref={studentPickerRef}
                            className="mt-2 space-y-2"
                          >
                            <Input
                              value={notifSearchName}
                              onValueChange={(value) => {
                                setNotifSearchName(value);
                                setShowStudentDropdown(true);
                              }}
                              onFocus={() => setShowStudentDropdown(true)}
                              isDisabled={isEditingNotification}
                              placeholder="Search by name"
                              size="sm"
                              className="w-full"
                            />

                            {!isEditingNotification && showStudentDropdown && (
                              <div className="rounded-lg border bg-white shadow-lg max-h-56 overflow-y-auto">
                                {studentsLoading ? (
                                  <div className="p-3">
                                    <CampusCardListSkeleton rows={2} />
                                  </div>
                                ) : filteredStudentOptions.length === 0 ? (
                                  <p className="px-4 py-2 text-sm text-campus-text-secondary">
                                    No matching students.
                                  </p>
                                ) : (
                                  filteredStudentOptions.map((student) => (
                                    <Button
                                      key={student.uid}
                                      size="sm"
                                      variant="light"
                                      className="w-full justify-start rounded-none px-4 py-2 data-[hover=true]:bg-gray-100"
                                      onPress={() => {
                                        setSelectedNotifStudents((prev) =>
                                          prev.some(
                                            (entry) =>
                                              entry.uid === student.uid,
                                          )
                                            ? prev
                                            : [...prev, student],
                                        );
                                        setNotifSearchName("");
                                        setNotifSearchId("");
                                        setShowStudentDropdown(true);
                                      }}
                                    >
                                      <div className="text-sm font-medium text-campus-text-primary">
                                        {student.studentName}
                                      </div>
                                      <div className="text-xs text-campus-text-secondary">
                                        {student.schoolId} |{" "}
                                        {student.course || "Unassigned"} |{" "}
                                        {student.year || "Unassigned"}
                                      </div>
                                    </Button>
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
                          setShowStudentDropdown(false);
                          setShowNotifYearDropdown(false);
                          setShowNotifCourseDropdown(false);
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

            {notifHasSpecificTarget && (
              <p className="text-xs text-campus-text-secondary">
                Year Level and Course are optional when targeting specific
                students.
              </p>
            )}
            <p className="text-xs text-campus-text-secondary">
              Current filters: Year Level - {notifYearLevelLabel}; Course -{" "}
              {notifCourseLabel}.
            </p>
            {!isEditingNotification && !notifHasSpecificTarget && (
              <p className="text-xs text-red-600">
                Choose at least one registrant to send this notification.
              </p>
            )}
            <p className="text-xs text-campus-text-secondary">
              Choose one or more specific students. You can still set Year Level
              and Course filters.
            </p>
          </div>

          {isEditingNotification && (
            <p className="text-xs text-campus-text-secondary">
              Editing this notification updates title, date/time, and message
              while keeping the same recipients.
            </p>
          )}

          <div>
            <label className="text-sm font-medium">Message</label>
            <Textarea
              aria-label="Notification message"
              value={notifMessage}
              onValueChange={setNotifMessage}
              minRows={4}
              className="w-full mt-1"
            />
          </div>

          {studentsError && (
            <p className="text-red-600 text-sm">{studentsError}</p>
          )}
          {notifError && <p className="text-red-600 text-sm">{notifError}</p>}
          {notifMsg && <p className="text-green-600 text-sm">{notifMsg}</p>}

          <Button
            color="primary"
            onPress={handleSendNotification}
            isDisabled={
              sendingNotif ||
              roleLoading ||
              !isECUser ||
              notifRecipientsRequiredMissing
            }
            className="w-full sm:w-auto"
          >
            {sendingNotif
              ? isEditingNotification
                ? "Updating..."
                : "Sending..."
              : isEditingNotification
                ? "Update Notification"
                : "Send Notification"}
          </Button>
        </div>
      )}

      {/* LIST TABS */}
      <div className="bg-white border rounded-xl shadow-sm p-4 sm:p-6">
        <Tabs
          aria-label="Dashboard lists"
          fullWidth
          selectedKey={listTab}
          onSelectionChange={(key) =>
            setListTab(String(key) as "events" | "notifications")
          }
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
                <Input
                  type="text"
                  placeholder="Search events..."
                  value={searchText}
                  onValueChange={setSearchText}
                  size="sm"
                  className="w-full"
                />

                <Select
                  aria-label="Filter events by status"
                  selectedKeys={new Set([statusFilter])}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const selected = Array.from(keys)[0];
                    if (
                      selected === "all" ||
                      selected === "upcoming" ||
                      selected === "ongoing" ||
                      selected === "completed"
                    ) {
                      setStatusFilter(selected);
                    }
                  }}
                  disallowEmptySelection
                  size="sm"
                  className="w-full"
                >
                  <SelectItem key="all">All Status</SelectItem>
                  <SelectItem key="upcoming">Upcoming</SelectItem>
                  <SelectItem key="ongoing">Ongoing</SelectItem>
                  <SelectItem key="completed">Completed</SelectItem>
                </Select>

                <Input
                  aria-label="Filter events by date"
                  type="date"
                  value={eventDateFilter}
                  onValueChange={setEventDateFilter}
                  startContent={
                    <FiCalendar className="text-campus-text-secondary" />
                  }
                  size="sm"
                  className="w-full"
                />
              </div>

              <div className="flex items-center">
                <Dropdown placement="bottom-start">
                  <DropdownTrigger>
                    <Button
                      variant="light"
                      className="h-auto min-w-0 px-0 text-sm font-medium text-campus-text-primary data-[hover=true]:bg-transparent"
                    >
                      <span className="text-campus-text-secondary mr-1">
                        Sort by:
                      </span>
                      <span>{eventSortLabel}</span>
                      <FiChevronDown className="ml-1" />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu
                    aria-label="Sort events"
                    disallowEmptySelection
                    selectionMode="single"
                    selectedKeys={new Set([eventSortMode])}
                    onAction={(key) =>
                      setEventSortMode(String(key) as EventSortMode)
                    }
                  >
                    <DropdownItem key="latest_to_oldest">
                      Date, new to old
                    </DropdownItem>
                    <DropdownItem key="oldest_to_latest">
                      Date, old to new
                    </DropdownItem>
                    <DropdownItem key="alphabetical">
                      Alphabetically, A-Z
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              </div>

              {exportError && (
                <p className="text-sm text-red-600">{exportError}</p>
              )}
              {exportMsg && (
                <p className="text-sm text-green-600">{exportMsg}</p>
              )}

              {eventsLoading ? (
                <CampusCardListSkeleton rows={3} />
              ) : sortedFilteredEvents.length === 0 ? (
                <p className="text-sm text-campus-text-secondary">
                  No events match your filter/search.
                </p>
              ) : (
                <div className="space-y-3">
                  {paginatedEvents.map((ev) => {
                    const liveStatus = computeStatus(ev);
                    const hasSlots =
                      ev.isPreReg && typeof ev.preRegSlots === "number";
                    const registrations = eventRegistrations[ev.id];
                    const isEventExpanded = expandedEventId === ev.id;
                    const toggleEventDetails = () => {
                      setExpandedEventId((prev) => {
                        const next = prev === ev.id ? null : ev.id;
                        if (next) setEventFilesTab("images");
                        return next;
                      });
                    };
                    const used = hasSlots
                      ? registrations
                        ? registrations.length
                        : typeof ev.preRegCount === "number"
                          ? ev.preRegCount
                          : 0
                      : typeof ev.preRegCount === "number"
                        ? ev.preRegCount
                        : 0;
                    const total =
                      typeof ev.preRegSlots === "number" ? ev.preRegSlots : 0;
                    const left = hasSlots ? Math.max(0, total - used) : null;

                    const imgs = eventImages[ev.id] ?? [];
                    const docs = eventDocs[ev.id] ?? [];
                    const previewImgs = imgs.slice(0, 3);
                    const previewDocs = docs.slice(0, 3);

                    return (
                      <div
                        key={ev.id}
                        className="border rounded-lg p-3 sm:p-4 shadow-sm hover:bg-gray-50 transition cursor-pointer"
                        onClick={toggleEventDetails}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
                            <h4 className="font-semibold text-campus-text-primary">
                              {ev.title}
                            </h4>
                            <span
                              className={`px-3 py-1 text-xs rounded-full ${statusChip(liveStatus)}`}
                            >
                              {liveStatus}
                            </span>

                            {hasSlots && (
                              <span className="px-3 py-1 text-xs rounded-full bg-purple-100 text-purple-700">
                                Slots left: {left}
                              </span>
                            )}
                          </div>

                          <div className="flex w-full sm:w-auto flex-wrap items-center gap-2">
                            <Button
                              size="sm"
                              variant="solid"
                              className="flex-1 sm:flex-none min-w-[94px] px-4 text-xs font-semibold text-white"
                              style={{
                                backgroundColor: "#A1A1AA",
                                borderColor: "#A1A1AA",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleEventDetails();
                              }}
                            >
                              {isEventExpanded ? "Hide Info" : "Info"}
                            </Button>
                            {liveStatus === "completed" ? (
                              <Button
                                size="sm"
                                color="danger"
                                variant="solid"
                                className="flex-1 sm:flex-none min-w-[94px] px-4 text-xs font-semibold"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  requestDeleteCompletedEvent(ev);
                                }}
                              >
                                Delete
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant={
                                  liveStatus === "upcoming"
                                    ? "solid"
                                    : "bordered"
                                }
                                className={`flex-1 sm:flex-none min-w-[94px] px-4 text-xs font-semibold ${
                                  liveStatus === "upcoming" ? "text-white" : ""
                                }`}
                                style={
                                  liveStatus === "upcoming"
                                    ? {
                                        backgroundColor: "#F5A524",
                                        borderColor: "#F5A524",
                                      }
                                    : undefined
                                }
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (liveStatus !== "upcoming") return;
                                  void handleStartEditUpcomingEvent(ev);
                                }}
                                isDisabled={liveStatus !== "upcoming"}
                              >
                                {liveStatus === "upcoming"
                                  ? "Edit"
                                  : "Edit (later)"}
                              </Button>
                            )}
                          </div>
                        </div>

                        {ev.details && (
                          <p className="text-sm text-campus-text-secondary mt-1">
                            {ev.details}
                          </p>
                        )}

                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 mt-3 text-sm text-campus-text-secondary">
                          <span>📅 {ev.date}</span>
                          <span>
                            ⏰ {ev.scheduledTime || ev.timeStart || "—"}
                            {ev.timeEnd ? ` - ${ev.timeEnd}` : ""}
                          </span>
                          <span>📍 {ev.location || "—"}</span>
                        </div>

                        {isEventExpanded && (
                          <div
                            className="mt-4 p-4 border rounded-lg bg-gray-50 space-y-3"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="text-sm text-campus-text-primary">
                                <b>Pre-Registrations:</b>{" "}
                                {registrations ? registrations.length : used}
                              </p>
                              <Button
                                size="sm"
                                color="primary"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void exportEventAttendanceCSV(ev);
                                }}
                                isDisabled={exportingEventId === ev.id}
                                className="px-3 text-xs"
                              >
                                {exportingEventId === ev.id
                                  ? "Exporting..."
                                  : "Export Attendance CSV"}
                              </Button>
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
                              <b>Pre-Reg:</b> {ev.isPreReg ? "Yes" : "No"} |{" "}
                              <b>With Payment:</b>{" "}
                              {ev.withPayment ? "Yes" : "No"}
                            </p>

                            {ev.isPreReg &&
                              typeof ev.preRegSlots === "number" && (
                                <p className="text-sm text-campus-text-primary">
                                  <b>Slots:</b> {used} / {ev.preRegSlots} (left:{" "}
                                  {Math.max(0, ev.preRegSlots - used)})
                                </p>
                              )}

                            {ev.isPreReg &&
                              registrations &&
                              registrations.length > 0 && (
                                <div className="space-y-2">
                                  <p className="text-sm font-semibold text-campus-text-primary">
                                    Registered Students
                                  </p>
                                  <div className="grid grid-cols-1 gap-3 rounded-lg border bg-white p-3 lg:grid-cols-2">
                                    {registrations.map((reg) => (
                                      <Card
                                        key={reg.id}
                                        shadow="none"
                                        className="border bg-gray-50"
                                      >
                                        <CardBody className="space-y-3 p-4 text-sm">
                                          <div>
                                            <p className="text-xs text-campus-text-secondary">
                                              School ID
                                            </p>
                                            <p className="font-semibold text-campus-text-primary">
                                              {reg.schoolId || "-"}
                                            </p>
                                          </div>
                                          <div className="grid grid-cols-2 gap-3">
                                            <div>
                                              <p className="text-xs text-campus-text-secondary">
                                                Name
                                              </p>
                                              <p className="text-campus-text-primary">
                                                {reg.studentName || reg.uid}
                                              </p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-campus-text-secondary">
                                                Course
                                              </p>
                                              <p className="text-campus-text-primary">
                                                {reg.course || "-"}
                                              </p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-campus-text-secondary">
                                                Year
                                              </p>
                                              <p className="text-campus-text-primary">
                                                {reg.year || "-"}
                                              </p>
                                            </div>
                                            <div>
                                              <p className="text-xs text-campus-text-secondary">
                                                Registered At
                                              </p>
                                              <p className="text-campus-text-primary">
                                                {formatDateTime(reg.createdAt)}
                                              </p>
                                            </div>
                                          </div>
                                        </CardBody>
                                      </Card>
                                    ))}
                                  </div>
                                </div>
                              )}

                            {/* FILES */}
                            <div className="pt-3 border-t space-y-4">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-semibold text-campus-text-primary">
                                  Event Files
                                </p>
                                {uploadingFor === ev.id && (
                                  <span className="text-xs text-campus-text-secondary">
                                    Uploading...
                                  </span>
                                )}
                              </div>

                              {uploadErr && (
                                <p className="text-sm text-red-600">
                                  {uploadErr}
                                </p>
                              )}
                              {uploadMsg && (
                                <p className="text-sm text-green-600">
                                  {uploadMsg}
                                </p>
                              )}

                              {/* Upload controls (EC only) */}
                              {isECUser && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                  <label
                                    className="border rounded-lg p-3 bg-white cursor-pointer hover:bg-gray-50"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="text-sm font-semibold">
                                      Upload Images
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      Auto-compressed before upload (max 10MB
                                      final size)
                                    </div>
                                    <Input
                                      type="file"
                                      multiple
                                      accept="image/*"
                                      className="hidden"
                                      onChange={(e) =>
                                        handleFileInputChange(
                                          ev.id,
                                          "images",
                                          e,
                                        )
                                      }
                                    />
                                  </label>

                                  <label
                                    className="border rounded-lg p-3 bg-white cursor-pointer hover:bg-gray-50"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <div className="text-sm font-semibold">
                                      Upload Documents
                                    </div>
                                    <div className="text-xs text-gray-500">
                                      PDF/DOC/DOCX (max 10MB each)
                                    </div>
                                    <Input
                                      type="file"
                                      multiple
                                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                                      className="hidden"
                                      onChange={(e) =>
                                        handleFileInputChange(ev.id, "docs", e)
                                      }
                                    />
                                  </label>
                                </div>
                              )}

                              <Tabs
                                aria-label={`Event files for ${ev.title}`}
                                selectedKey={eventFilesTab}
                                onSelectionChange={(key) =>
                                  setEventFilesTab(String(key) as EventFilesTab)
                                }
                              >
                                <Tab
                                  key="images"
                                  title={`Images (${imgs.length})`}
                                >
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-sm font-semibold">
                                        Images
                                      </p>
                                      {imgs.length > 3 && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="light"
                                          color="primary"
                                          className="h-7 min-w-0 px-2 text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openViewAllFilesModal(
                                              ev.id,
                                              ev.title,
                                              "images",
                                            );
                                          }}
                                        >
                                          View all ({imgs.length})
                                        </Button>
                                      )}
                                    </div>

                                    {imgs.length === 0 ? (
                                      <p className="text-xs text-gray-500">
                                        No images uploaded yet.
                                      </p>
                                    ) : (
                                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                        {previewImgs.map((img) => (
                                          <div
                                            key={img.id}
                                            className="border rounded-lg bg-white p-2"
                                          >
                                            <a
                                              href={img.downloadURL}
                                              target="_blank"
                                              rel="noreferrer"
                                              onClick={(e) =>
                                                e.stopPropagation()
                                              }
                                            >
                                              {/* eslint-disable-next-line @next/next/no-img-element */}
                                              <img
                                                src={img.downloadURL}
                                                alt={img.name || "event image"}
                                                className="w-full h-28 object-cover rounded-md"
                                              />
                                            </a>

                                            <div className="mt-2 space-y-1">
                                              <p className="text-xs truncate">
                                                {img.name}
                                              </p>
                                              <div className="flex items-center justify-between gap-2">
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="light"
                                                  color="primary"
                                                  className="h-7 min-w-0 px-2 text-xs"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    downloadEventFile(
                                                      img,
                                                      img.name ||
                                                        "event-image.jpg",
                                                    );
                                                  }}
                                                >
                                                  Download
                                                </Button>

                                                {isECUser && img.path && (
                                                  <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="light"
                                                    color="danger"
                                                    className="h-7 min-w-0 px-2 text-xs"
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      requestDeleteEventFile(
                                                        ev.id,
                                                        "images",
                                                        img.id,
                                                        img.path!,
                                                        img.name ||
                                                          "event-image.jpg",
                                                      );
                                                    }}
                                                  >
                                                    Delete
                                                  </Button>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </Tab>

                                <Tab
                                  key="docs"
                                  title={`Documents (${docs.length})`}
                                >
                                  <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                      <p className="text-sm font-semibold">
                                        Documents
                                      </p>
                                      {docs.length > 3 && (
                                        <Button
                                          type="button"
                                          size="sm"
                                          variant="light"
                                          color="primary"
                                          className="h-7 min-w-0 px-2 text-xs"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openViewAllFilesModal(
                                              ev.id,
                                              ev.title,
                                              "docs",
                                            );
                                          }}
                                        >
                                          View all ({docs.length})
                                        </Button>
                                      )}
                                    </div>

                                    {docs.length === 0 ? (
                                      <p className="text-xs text-gray-500">
                                        No documents uploaded yet.
                                      </p>
                                    ) : (
                                      <div className="space-y-2">
                                        {previewDocs.map((f) => (
                                          <div
                                            key={f.id}
                                            className="border rounded-lg bg-white p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                                          >
                                            <div className="min-w-0">
                                              <p className="text-sm font-medium truncate">
                                                {f.name}
                                              </p>
                                            </div>

                                            <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
                                              <Button
                                                type="button"
                                                size="sm"
                                                variant="light"
                                                color="primary"
                                                className="h-7 min-w-0 px-2 text-xs sm:text-sm"
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  downloadEventFile(
                                                    f,
                                                    f.name || "event-document",
                                                  );
                                                }}
                                              >
                                                Download
                                              </Button>

                                              {isECUser && f.path && (
                                                <Button
                                                  type="button"
                                                  size="sm"
                                                  variant="light"
                                                  color="danger"
                                                  className="h-7 min-w-0 px-2 text-xs sm:text-sm"
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    requestDeleteEventFile(
                                                      ev.id,
                                                      "docs",
                                                      f.id,
                                                      f.path!,
                                                      f.name ||
                                                        "event-document",
                                                    );
                                                  }}
                                                >
                                                  Delete
                                                </Button>
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
              {!eventsLoading &&
                sortedFilteredEvents.length > ITEMS_PER_PAGE && (
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
                <Input
                  type="text"
                  placeholder="Search notifications..."
                  value={notificationSearchText}
                  onValueChange={setNotificationSearchText}
                  size="sm"
                  className="w-full"
                />

                <Select
                  aria-label="Filter notifications by status"
                  selectedKeys={new Set([notificationStatusFilter])}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const selected = Array.from(keys)[0];
                    if (
                      selected === "all" ||
                      selected === "scheduled" ||
                      selected === "sent"
                    ) {
                      setNotificationStatusFilter(selected);
                    }
                  }}
                  disallowEmptySelection
                  size="sm"
                  className="w-full"
                >
                  <SelectItem key="all">All Status</SelectItem>
                  <SelectItem key="scheduled">Scheduled</SelectItem>
                  <SelectItem key="sent">Sent</SelectItem>
                </Select>

                <Input
                  aria-label="Filter notifications by date"
                  type="date"
                  value={notificationDateFilter}
                  onValueChange={setNotificationDateFilter}
                  startContent={
                    <FiCalendar className="text-campus-text-secondary" />
                  }
                  size="sm"
                  className="w-full"
                />
              </div>

              <div className="flex items-center">
                <Dropdown placement="bottom-start">
                  <DropdownTrigger>
                    <Button
                      variant="light"
                      className="h-auto min-w-0 px-0 text-sm font-medium text-campus-text-primary data-[hover=true]:bg-transparent"
                    >
                      <span className="text-campus-text-secondary mr-1">
                        Sort by:
                      </span>
                      <span>{notificationSortLabel}</span>
                      <FiChevronDown className="ml-1" />
                    </Button>
                  </DropdownTrigger>
                  <DropdownMenu
                    aria-label="Sort notifications"
                    disallowEmptySelection
                    selectionMode="single"
                    selectedKeys={new Set([notificationSortMode])}
                    onAction={(key) =>
                      setNotificationSortMode(String(key) as EventSortMode)
                    }
                  >
                    <DropdownItem key="latest_to_oldest">
                      Date, new to old
                    </DropdownItem>
                    <DropdownItem key="oldest_to_latest">
                      Date, old to new
                    </DropdownItem>
                    <DropdownItem key="alphabetical">
                      Alphabetically, A-Z
                    </DropdownItem>
                  </DropdownMenu>
                </Dropdown>
              </div>

              {notificationsLoading ? (
                <CampusCardListSkeleton rows={3} />
              ) : sortedFilteredNotifications.length === 0 ? (
                <p className="text-sm text-campus-text-secondary">
                  No notifications match your filter/search.
                </p>
              ) : (
                <div className="space-y-3">
                  {paginatedNotifications.map((item) => {
                    const isExpanded =
                      expandedNotificationId === item.dispatchId;
                    const toggleNotificationDetails = () => {
                      setExpandedNotificationId((prev) =>
                        prev === item.dispatchId ? null : item.dispatchId,
                      );
                    };

                    return (
                      <div
                        key={item.dispatchId}
                        className="border rounded-lg p-3 sm:p-4 shadow-sm hover:bg-gray-50 transition cursor-pointer"
                        onClick={toggleNotificationDetails}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <h4 className="font-semibold text-campus-text-primary">
                              {item.title || "Notification"}
                            </h4>
                            <span
                              className={`px-3 py-1 text-xs rounded-full ${notifStatusChip(item.status)}`}
                            >
                              {item.status}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <p className="text-xs text-campus-text-secondary">
                              Created: {formatDateTime(item.createdAt)}
                            </p>
                            <Button
                              size="sm"
                              variant="solid"
                              className="min-w-[94px] px-3 text-xs font-semibold text-white"
                              style={{
                                backgroundColor: "#A1A1AA",
                                borderColor: "#A1A1AA",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleNotificationDetails();
                              }}
                            >
                              {isExpanded ? "Hide Info" : "Info"}
                            </Button>
                            <Button
                              size="sm"
                              variant="solid"
                              className="flex-1 sm:flex-none min-w-[94px] px-4 text-xs font-semibold text-white"
                              style={{
                                backgroundColor: "#F5A524",
                                borderColor: "#F5A524",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleStartEditScheduledNotification(item);
                              }}
                            >
                              Edit
                            </Button>
                          </div>
                        </div>

                        {isExpanded && (
                          <>
                            <p className="text-sm text-campus-text-secondary mt-2">
                              {item.message || "-"}
                            </p>

                            <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-xs text-campus-text-secondary">
                              <div>
                                <b>Date/Time:</b> {item.date || "-"}{" "}
                                {item.scheduledTime || ""}
                              </div>
                              <div>
                                <b>Target:</b> {notifTargetLabel(item)}
                              </div>
                              <div>
                                <b>Recipients:</b> {item.recipientCount}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {!notificationsLoading &&
                sortedFilteredNotifications.length > ITEMS_PER_PAGE && (
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
                <span>
                  {viewAllFilesModal.kind === "images"
                    ? "All Images"
                    : "All Documents"}
                </span>
                <span className="text-xs font-normal text-campus-text-secondary">
                  {viewAllFilesModal.eventTitle || "Event files"}
                </span>
              </ModalHeader>

              <ModalBody>
                {viewAllFilesModal.kind === "images" ? (
                  viewAllModalImages.length === 0 ? (
                    <p className="text-sm text-campus-text-secondary">
                      No images available.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-end">
                        <Dropdown placement="bottom-end">
                          <DropdownTrigger>
                            <Button
                              variant="bordered"
                              className="h-8 min-w-0 px-3 text-xs sm:text-sm"
                            >
                              <span>
                                Sort by:{" "}
                                {imageModalSortMode === "ascending"
                                  ? "Ascending"
                                  : "Descending"}
                              </span>
                              <FiChevronDown className="ml-2" />
                            </Button>
                          </DropdownTrigger>
                          <DropdownMenu
                            aria-label="Sort all images"
                            disallowEmptySelection
                            selectionMode="single"
                            selectedKeys={new Set([imageModalSortMode])}
                            onAction={(key) =>
                              setImageModalSortMode(
                                String(key) as ImageModalSortMode,
                              )
                            }
                          >
                            <DropdownItem key="ascending">
                              Ascending
                            </DropdownItem>
                            <DropdownItem key="descending">
                              Descending
                            </DropdownItem>
                          </DropdownMenu>
                        </Dropdown>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {sortedViewAllModalImages.map((img) => (
                          <div
                            key={img.id}
                            className="border rounded-lg bg-white p-2"
                          >
                            <a
                              href={img.downloadURL}
                              target="_blank"
                              rel="noreferrer"
                            >
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
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="light"
                                  color="primary"
                                  className="h-7 min-w-0 px-2 text-xs"
                                  onClick={() =>
                                    downloadEventFile(
                                      img,
                                      img.name || "event-image.jpg",
                                    )
                                  }
                                >
                                  Download
                                </Button>

                                {isECUser &&
                                  img.path &&
                                  viewAllFilesModal.eventId && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="light"
                                      color="danger"
                                      className="h-7 min-w-0 px-2 text-xs"
                                      onClick={() => {
                                        const modalEventId =
                                          viewAllFilesModal.eventId;
                                        if (!modalEventId) return;
                                        requestDeleteEventFile(
                                          modalEventId,
                                          "images",
                                          img.id,
                                          img.path!,
                                          img.name || "event-image.jpg",
                                        );
                                      }}
                                    >
                                      Delete
                                    </Button>
                                  )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                ) : viewAllModalDocs.length === 0 ? (
                  <p className="text-sm text-campus-text-secondary">
                    No documents available.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                      <Input
                        value={documentModalSearch}
                        onValueChange={setDocumentModalSearch}
                        placeholder="Search documents..."
                        size="sm"
                        className="w-full"
                      />

                      <Dropdown placement="bottom-end">
                        <DropdownTrigger>
                          <Button
                            variant="bordered"
                            className="h-8 min-w-0 px-3 text-xs sm:text-sm"
                          >
                            <span>
                              Sort by:{" "}
                              {documentModalSortMode === "ascending"
                                ? "Ascending"
                                : "Descending"}
                            </span>
                            <FiChevronDown className="ml-2" />
                          </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                          aria-label="Sort all documents"
                          disallowEmptySelection
                          selectionMode="single"
                          selectedKeys={new Set([documentModalSortMode])}
                          onAction={(key) =>
                            setDocumentModalSortMode(
                              String(key) as DocumentModalSortMode,
                            )
                          }
                        >
                          <DropdownItem key="ascending">Ascending</DropdownItem>
                          <DropdownItem key="descending">
                            Descending
                          </DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    </div>

                    {sortedFilteredViewAllModalDocs.length === 0 ? (
                      <p className="text-sm text-campus-text-secondary">
                        No documents match your search.
                      </p>
                    ) : (
                      sortedFilteredViewAllModalDocs.map((file) => (
                        <div
                          key={file.id}
                          className="border rounded-lg bg-white p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {file.name}
                            </p>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
                            <Button
                              type="button"
                              size="sm"
                              variant="light"
                              color="primary"
                              className="h-7 min-w-0 px-2 text-xs sm:text-sm"
                              onClick={() =>
                                downloadEventFile(
                                  file,
                                  file.name || "event-document",
                                )
                              }
                            >
                              Download
                            </Button>

                            {isECUser &&
                              file.path &&
                              viewAllFilesModal.eventId && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="light"
                                  color="danger"
                                  className="h-7 min-w-0 px-2 text-xs sm:text-sm"
                                  onClick={() => {
                                    const modalEventId =
                                      viewAllFilesModal.eventId;
                                    if (!modalEventId) return;
                                    requestDeleteEventFile(
                                      modalEventId,
                                      "docs",
                                      file.id,
                                      file.path!,
                                      file.name || "event-document",
                                    );
                                  }}
                                >
                                  Delete
                                </Button>
                              )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </ModalBody>

              <ModalFooter>
                <Button
                  variant="bordered"
                  onPress={() => {
                    onClose();
                    closeViewAllFilesModal();
                  }}
                >
                  Close
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal
        isOpen={Boolean(pendingDeleteFile)}
        onOpenChange={(open) => {
          if (!open && !deleteSubmitting) {
            setPendingDeleteFile(null);
          }
        }}
        size="md"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Delete File</ModalHeader>
              <ModalBody className="space-y-2">
                <p className="text-base text-campus-text-primary">
                  Are you sure you want to delete this file?
                </p>
                {pendingDeleteFile?.fileName && (
                  <p className="text-sm text-campus-text-secondary break-all">
                    {pendingDeleteFile.fileName}
                  </p>
                )}
              </ModalBody>
              <ModalFooter className="justify-between">
                <Button
                  variant="bordered"
                  onPress={() => {
                    setPendingDeleteFile(null);
                    onClose();
                  }}
                  isDisabled={deleteSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  color="warning"
                  onPress={() => {
                    void confirmDeleteEventFile();
                  }}
                  isLoading={deleteSubmitting}
                >
                  Delete
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal
        isOpen={Boolean(pendingDeleteEvent)}
        onOpenChange={(open) => {
          if (!open && !deleteEventSubmitting) {
            setPendingDeleteEvent(null);
          }
        }}
        size="md"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Delete Event</ModalHeader>
              <ModalBody className="space-y-2">
                <p className="text-base text-campus-text-primary">
                  Are you sure you want to delete this event?
                </p>
                {pendingDeleteEvent?.title && (
                  <p className="text-sm text-campus-text-secondary break-all">
                    {pendingDeleteEvent.title}
                  </p>
                )}
              </ModalBody>
              <ModalFooter className="justify-between">
                <Button
                  variant="bordered"
                  onPress={() => {
                    setPendingDeleteEvent(null);
                    onClose();
                  }}
                  isDisabled={deleteEventSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  color="danger"
                  onPress={() => {
                    void confirmDeleteCompletedEvent();
                  }}
                  isLoading={deleteEventSubmitting}
                >
                  Delete
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
