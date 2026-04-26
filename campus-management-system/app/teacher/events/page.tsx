"use client";

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  type DocumentData,
  type QuerySnapshot,
} from "firebase/firestore";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
} from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import { Spinner } from "@heroui/spinner";
import { Tab, Tabs } from "@heroui/tabs";
import {
  Upload,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Download,
  FileStack,
  MapPin,
  Search,
} from "lucide-react";
import {
  AllEventDocumentsModal,
  AllEventImagesModal,
  EventDetailInfoRow,
  EventDetailStat,
  EventFilesTabs,
  eventDetailTabsClassNames,
} from "@/components/events/EventDetailsShared";
import type { CampusTableColumn } from "@/components/ui";
import { CampusMetricSkeleton } from "@/components/ui";
import {
  buildAttendanceParticipantRows,
  downloadAttendanceWorkbook,
  type AttendanceExportAttendanceDoc,
  type AttendanceExportEvent,
  type AttendanceExportRegistrationDoc,
  type AttendanceExportStudent,
  type AttendanceParticipantRow,
  type AttendanceParticipantStatus,
} from "@/lib/attendance-export";
import { normalizeCourse } from "@/lib/courseOptions";
import { formatEventScheduleDisplay } from "@/lib/eventSchedule";
import { auth, db, storage } from "@/lib/firebase";
import {
  cleanupPendingEventDocumentUpload,
  cleanupPendingEventImageUpload,
  createEventDocumentDownloadUrl,
  createEventDocumentUploadTarget,
  createEventImageUploadTarget,
  finalizeEventDocumentUpload,
  finalizeEventImageUpload,
} from "@/lib/firebase-functions";
import { formatStudentFullName } from "@/lib/student-name";
import { campusToast } from "@/lib/toast";
import {
  TeacherDataTable,
  TeacherEmptyState,
  TeacherFilterBar,
  TeacherFilterBarSkeleton,
  TeacherPageHeader,
  TeacherStatsGrid,
  capitalizeTeacherLabel,
  downloadTeacherFile,
  getTeacherLifecycleTone,
  getTeacherToneClasses,
  teacherAudienceLabel,
  useIsBelowBreakpoint,
  useTeacherPageErrorToast,
  useTeacherPortal,
} from "@/components/teacher";
import type {
  TeacherEvent,
  TeacherFile,
  TeacherFileKind,
} from "@/components/teacher/TeacherPortalProvider";
import {
  ref,
  uploadBytesResumable,
  type UploadMetadata,
  type StorageReference,
  type UploadTaskSnapshot,
} from "firebase/storage";

const EVENTS_PER_PAGE = 6;
const FILE_PREVIEW_LIMIT = 3;
const DESKTOP_PARTICIPANTS_PER_PAGE = 10;
const MOBILE_PARTICIPANTS_PER_PAGE = 5;

const teacherEventColumns: CampusTableColumn<{
  id: string;
  title: string;
  location: string;
  lifecycle: "upcoming" | "ongoing" | "completed" | "cancelled";
  schedule: string;
  audience: string;
}>[] = [
  { key: "event", label: "Event" },
  { key: "status", label: "Status" },
  { key: "schedule", label: "Schedule" },
  { key: "audience", label: "Audience" },
  { key: "actions", label: "Actions", align: "end", className: "text-right" },
];

type EventTabKey = "overview" | "participants" | "files";
type EventFilesView = "images" | "documents";
type ParticipantStatusFilter = "all" | AttendanceParticipantStatus;

type TeacherFileDoc = {
  name?: string;
  path?: string;
  storagePath?: string;
  downloadURL?: string;
  contentType?: string;
  size?: number;
  createdAt?: unknown;
  status?: unknown;
};

type SelectOption = {
  key: string;
  label: string;
};

const participantStatusOptions: SelectOption[] = [
  { key: "all", label: "All" },
  { key: "Present", label: "Present" },
  { key: "Timed In", label: "Timed In" },
  { key: "Absent", label: "Absent" },
];

const ONE_MB_IN_BYTES = 1024 * 1024;
const MAX_EVENT_FILE_SIZE_BYTES = 10 * ONE_MB_IN_BYTES;
const MAX_IMAGE_DIMENSION = 2048;
const IMAGE_COMPRESSION_QUALITY_STEPS = [
  0.9, 0.82, 0.74, 0.66, 0.58, 0.5, 0.42,
];
const IMAGE_COMPRESSION_SCALE_STEPS = [1, 0.9, 0.8, 0.72, 0.64];
const ALLOWED_EVENT_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);
const ALLOWED_EVENT_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const EVENT_DOC_EXTENSIONS = new Set(["pdf", "doc", "docx"]);
const EVENT_DOC_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);
const IMAGE_UPLOAD_ACCEPT =
  "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp";
const DOCUMENT_UPLOAD_ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function getFileExtension(filename: string) {
  const index = filename.lastIndexOf(".");
  return index >= 0 ? filename.slice(index + 1).toLowerCase() : "";
}

function isTeacherEventFileActive(data: TeacherFileDoc) {
  return String(data.status ?? "").trim().toLowerCase() !== "pending-upload";
}

function isAllowedTeacherEventImage(file: File) {
  const ext = getFileExtension(file.name);
  const contentType = String(file.type ?? "").trim().toLowerCase();

  return (
    contentType.startsWith("image/") &&
    ALLOWED_EVENT_IMAGE_MIME_TYPES.has(contentType) &&
    ALLOWED_EVENT_IMAGE_EXTENSIONS.has(ext)
  );
}

function isAllowedEventDocument(file: File) {
  const ext = getFileExtension(file.name);
  if (EVENT_DOC_EXTENSIONS.has(ext)) return true;
  return EVENT_DOC_MIME_TYPES.has(String(file.type ?? "").trim().toLowerCase());
}

function getEventDocumentContentType(file: Pick<File, "name" | "type">) {
  const normalizedType = String(file.type ?? "").trim().toLowerCase();
  if (EVENT_DOC_MIME_TYPES.has(normalizedType)) {
    return normalizedType;
  }

  const ext = getFileExtension(file.name);
  if (ext === "pdf") return "application/pdf";
  if (ext === "doc") return "application/msword";
  if (ext === "docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return normalizedType;
}

function toMegabytesText(bytes: number) {
  return `${(bytes / ONE_MB_IN_BYTES).toFixed(2)}MB`;
}

function toCompressedImageName(filename: string) {
  const index = filename.lastIndexOf(".");
  const stem = index >= 0 ? filename.slice(0, index) : filename;
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
  if (!context) {
    throw new Error("Image compression is not available in this browser.");
  }

  let smallestBlob: Blob | null = null;

  for (const scale of IMAGE_COMPRESSION_SCALE_STEPS) {
    canvas.width = Math.max(1, Math.round(baseWidth * scale));
    canvas.height = Math.max(1, Math.round(baseHeight * scale));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of IMAGE_COMPRESSION_QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (!smallestBlob || blob.size < smallestBlob.size) {
        smallestBlob = blob;
      }

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

async function uploadEventDocumentWithResumable(
  storageRef: StorageReference,
  file: File,
  metadata: UploadMetadata,
): Promise<UploadTaskSnapshot> {
  return await new Promise<UploadTaskSnapshot>((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file, metadata);

    task.on(
      "state_changed",
      undefined,
      (error) => reject(error),
      () => resolve(task.snapshot),
    );
  });
}

function normalizeTeacherUploadError(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const message = (error as {message?: unknown}).message;
    if (typeof message === "string" && message.trim()) {
      return message.trim();
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}

function toMillis(value: unknown): number {
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

function mapFileSnapshot(
  eventId: string,
  kind: TeacherFileKind,
  snap: QuerySnapshot<DocumentData>,
): TeacherFile[] {
  return snap.docs
    .map((fileDoc) => {
      const data = fileDoc.data() as TeacherFileDoc;
      if (!isTeacherEventFileActive(data)) {
        return null;
      }
      const fallbackName = kind === "images" ? "Untitled image" : "Untitled file";

      return {
        id: fileDoc.id,
        eventId,
        kind,
        name: String(data.name ?? fallbackName).trim() || fallbackName,
        path: String(data.storagePath ?? data.path ?? "").trim(),
        downloadURL: String(data.downloadURL ?? "").trim(),
        contentType: String(data.contentType ?? "").trim(),
        size: Number(data.size ?? 0),
        createdAtMs: toMillis(data.createdAt),
      };
    })
    .filter((item): item is TeacherFile => Boolean(item));
}

type TeacherAttendanceExportEventDoc = {
  title?: unknown;
  location?: unknown;
  date?: unknown;
  scheduledTime?: unknown;
  timeStart?: unknown;
  timeEnd?: unknown;
  course?: unknown;
  courses?: unknown;
  yearLevel?: unknown;
  yearLevels?: unknown;
  targetStudent?: unknown;
  selectedStudentIds?: unknown;
  selectedSchoolIds?: unknown;
  isPreReg?: unknown;
  withPayment?: unknown;
  paymentRequired?: unknown;
};

type TeacherAttendanceExportStudentDoc = {
  uid?: unknown;
  schoolId?: unknown;
  studentId?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  fullName?: unknown;
  studentName?: unknown;
  name?: unknown;
  course?: unknown;
  year?: unknown;
  yearLevel?: unknown;
  status?: unknown;
  role?: unknown;
};

async function loadTeacherAttendanceExportEvent(
  ev: TeacherEvent,
): Promise<AttendanceExportEvent> {
  const eventSnap = await getDoc(doc(db, "events", ev.id)).catch(() => null);
  const data: TeacherAttendanceExportEventDoc =
    eventSnap?.exists() ?
      (eventSnap.data() as TeacherAttendanceExportEventDoc) :
      {};

  return {
    id: ev.id,
    title: data.title ?? ev.title,
    location: data.location ?? ev.location,
    date: data.date ?? ev.date,
    scheduledTime: data.scheduledTime ?? ev.scheduledTime,
    timeStart: data.timeStart,
    timeEnd: data.timeEnd ?? ev.timeEnd,
    course: data.course,
    courses: data.courses,
    yearLevel: data.yearLevel,
    yearLevels: data.yearLevels,
    targetStudent: data.targetStudent,
    selectedStudentIds: data.selectedStudentIds,
    selectedSchoolIds: data.selectedSchoolIds,
    isPreReg: data.isPreReg ?? ev.isPreReg,
    withPayment: data.withPayment ?? ev.withPayment,
    paymentRequired: data.paymentRequired,
  };
}

async function loadTeacherAttendanceExportRegistrations(eventId: string) {
  try {
    const registrationsSnap = await getDocs(
      collection(db, "events", eventId, "registrations"),
    );

    return registrationsSnap.docs.map((registrationDoc) => {
      const data = registrationDoc.data() as Omit<
        AttendanceExportRegistrationDoc,
        "id"
      >;

      return {
        id: registrationDoc.id,
        uid: data.uid ?? registrationDoc.id,
        schoolId: data.schoolId,
        studentName: data.studentName,
        course: data.course,
        year: data.year,
        status: data.status,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        registeredAt: data.registeredAt,
        waitlistedAt: data.waitlistedAt,
        cancelledAt: data.cancelledAt,
      } satisfies AttendanceExportRegistrationDoc;
    });
  } catch {
    return [] as AttendanceExportRegistrationDoc[];
  }
}

function mapTeacherAttendanceExportStudent(
  studentDoc: { id: string; data: () => DocumentData },
): AttendanceExportStudent | null {
  const data = studentDoc.data() as TeacherAttendanceExportStudentDoc;
  const uid = String(data.uid ?? studentDoc.id).trim();
  if (!uid) return null;

  const schoolId =
    String(data.schoolId ?? data.studentId ?? "").trim() || uid;
  const studentName = formatStudentFullName(
    {
      firstName: data.firstName,
      lastName: data.lastName,
      fullName: data.fullName,
      studentName: data.studentName,
      name: data.name,
      schoolId,
    },
    schoolId,
  );
  const rawCourse = String(data.course ?? "").trim();
  const course = normalizeCourse(rawCourse) || rawCourse;
  const year = normalizeYear(data.yearLevel ?? data.year);
  const status = String(data.status ?? "").trim() || "Active";

  return {
    uid,
    schoolId,
    studentName,
    course,
    year,
    status,
    role: String(data.role ?? "").trim(),
    searchText: `${studentName} ${schoolId} ${course} ${year}`.toLowerCase(),
  };
}

async function loadTeacherAttendanceExportStudents() {
  try {
    const studentsSnap = await getDocs(collection(db, "students"));
    return studentsSnap.docs
      .map(mapTeacherAttendanceExportStudent)
      .filter((student): student is AttendanceExportStudent => Boolean(student))
      .sort(
        (left, right) =>
          left.studentName.localeCompare(right.studentName) ||
          left.schoolId.localeCompare(right.schoolId),
      );
  } catch {
    return [] as AttendanceExportStudent[];
  }
}

function isAttendedParticipantStatus(status: AttendanceParticipantStatus) {
  return status === "Present" || status === "Timed In";
}

function attendanceParticipantToExportRow(
  participant: AttendanceParticipantRow,
) {
  return {
    schoolId: participant.schoolId,
    studentName: participant.fullName,
    course: participant.course,
    year: participant.yearLevel,
    attendanceStatus: participant.attendanceStatus,
    attendanceTimeIn: participant.timeIn,
    attendanceTimeOut: participant.timeOut,
  };
}

function buildParticipantFilterOptions(
  participants: AttendanceParticipantRow[],
  field: "course" | "yearLevel",
  allLabel: string,
) {
  const options = Array.from(
    new Set(
      participants
        .map((participant) => String(participant[field] ?? "").trim())
        .filter(Boolean),
    ),
  ).sort((left, right) => left.localeCompare(right));

  return [
    { key: "all", label: allLabel },
    ...options.map((option) => ({ key: option, label: option })),
  ] satisfies SelectOption[];
}

function getTeacherEventSchedule(
  event: {
    date: string;
    eventDate: Date | null;
    scheduledTime: string;
    timeEnd: string;
  },
) {
  return formatEventScheduleDisplay({
    date: event.eventDate ?? event.date,
    scheduledTime: event.scheduledTime,
    timeEnd: event.timeEnd,
  });
}

export default function TeacherEventsPage() {
  const { events, loadingEvents, error, profile } = useTeacherPortal();
  const loading = loadingEvents;
  const isCompactView = useIsBelowBreakpoint(1024);
  const isMobileView = useIsBelowBreakpoint(640);

  useTeacherPageErrorToast(error, "teacher event records");

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<EventTabKey>("overview");
  const [exportingEventId, setExportingEventId] = useState<string | null>(null);
  const [participantsSearch, setParticipantsSearch] = useState("");
  const [participantsStatusFilter, setParticipantsStatusFilter] =
    useState<ParticipantStatusFilter>("all");
  const [participantsCourseFilter, setParticipantsCourseFilter] = useState("all");
  const [participantsYearFilter, setParticipantsYearFilter] = useState("all");
  const [participantsPage, setParticipantsPage] = useState(1);
  const [filesView, setFilesView] = useState<EventFilesView>("images");
  const [imagesModalOpen, setImagesModalOpen] = useState(false);
  const [documentsModalOpen, setDocumentsModalOpen] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [selectedEventFiles, setSelectedEventFiles] = useState<TeacherFile[]>(
    [],
  );
  const [selectedEventAttendanceRows, setSelectedEventAttendanceRows] =
    useState<AttendanceExportAttendanceDoc[]>([]);
  const [selectedEventExportEvent, setSelectedEventExportEvent] =
    useState<AttendanceExportEvent | null>(null);
  const [selectedEventRegistrations, setSelectedEventRegistrations] = useState<
    AttendanceExportRegistrationDoc[]
  >([]);
  const [selectedEventStudents, setSelectedEventStudents] = useState<
    AttendanceExportStudent[]
  >([]);
  const [selectedEventRosterLoading, setSelectedEventRosterLoading] =
    useState(false);
  const [selectedEventAttendanceLoading, setSelectedEventAttendanceLoading] =
    useState(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const documentInputRef = useRef<HTMLInputElement | null>(null);

  const statusOptions: SelectOption[] = [
    { key: "__all_status__", label: "All status" },
    { key: "upcoming", label: "Upcoming" },
    { key: "ongoing", label: "Ongoing" },
    { key: "cancelled", label: "Cancelled" },
    { key: "completed", label: "Completed" },
  ];

  const filteredEvents = useMemo(() => {
    const search = searchText.trim().toLowerCase();

    return events.filter((event) => {
      const audience = teacherAudienceLabel(event).toLowerCase();
      const matchesSearch =
        !search ||
        event.title.toLowerCase().includes(search) ||
        event.location.toLowerCase().includes(search) ||
        audience.includes(search);
      const matchesStatus = statusFilter
        ? event.lifecycle === statusFilter
        : true;
      const matchesDate = dateFilter ? event.date === dateFilter : true;
      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [dateFilter, events, searchText, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredEvents.length / EVENTS_PER_PAGE));

  const paginatedEvents = useMemo(() => {
    const start = (page - 1) * EVENTS_PER_PAGE;
    return filteredEvents.slice(start, start + EVENTS_PER_PAGE);
  }, [filteredEvents, page]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );
  const selectedEventLiveId = selectedEvent?.id ?? "";
  const selectedEventSchedule = useMemo(
    () => (selectedEvent ? getTeacherEventSchedule(selectedEvent) : null),
    [selectedEvent],
  );
  const selectedEventUploadsAllowed = Boolean(
    profile &&
      selectedEvent &&
      selectedEvent.lifecycle !== "cancelled",
  );
  const selectedEventUploadDisabledReason = useMemo(() => {
    if (!selectedEvent) {
      return "The selected event is no longer available.";
    }

    if (!profile) {
      return "Your teacher profile is not available right now.";
    }

    if (selectedEvent.lifecycle === "cancelled") {
      return "Uploads are disabled for cancelled events.";
    }

    return "";
  }, [profile, selectedEvent]);

  const selectedParticipantBuild = useMemo(() => {
    if (!selectedEventExportEvent) {
      return {
        rows: [] as AttendanceParticipantRow[],
        audienceResolved: false,
      };
    }

    return buildAttendanceParticipantRows({
      event: selectedEventExportEvent,
      attendanceRows: selectedEventAttendanceRows,
      registrations: selectedEventRegistrations,
      students: selectedEventStudents,
      respectPaymentStatus: false,
    });
  }, [
    selectedEventAttendanceRows,
    selectedEventExportEvent,
    selectedEventRegistrations,
    selectedEventStudents,
  ]);

  const selectedParticipants = selectedParticipantBuild.rows;
  const selectedEventParticipantsLoading =
    selectedEventRosterLoading || selectedEventAttendanceLoading;
  const participantsRowsPerPageValue = isMobileView
    ? MOBILE_PARTICIPANTS_PER_PAGE
    : DESKTOP_PARTICIPANTS_PER_PAGE;
  const participantCourseOptions = useMemo(
    () => buildParticipantFilterOptions(
      selectedParticipants,
      "course",
      "All Courses",
    ),
    [selectedParticipants],
  );
  const participantYearOptions = useMemo(
    () => buildParticipantFilterOptions(
      selectedParticipants,
      "yearLevel",
      "All Years",
    ),
    [selectedParticipants],
  );

  const selectedEventReview = useMemo(() => {
    if (!selectedEvent) return null;

    const presentCount = selectedParticipants.filter((participant) =>
      isAttendedParticipantStatus(participant.attendanceStatus),
    ).length;
    const absentCount = selectedParticipants.filter(
      (participant) => participant.attendanceStatus === "Absent",
    ).length;
    const imageCount = selectedEventFiles.filter(
      (file) => file.kind === "images",
    ).length;
    const documentCount = selectedEventFiles.filter(
      (file) => file.kind === "docs",
    ).length;

    return {
      ...selectedEvent,
      attendanceCount: selectedParticipants.length,
      presentCount,
      absentCount,
      imageCount,
      documentCount,
    };
  }, [
    selectedEvent,
    selectedEventFiles,
    selectedParticipants,
  ]);

  const filteredParticipants = useMemo(() => {
    const search = participantsSearch.trim().toLowerCase();

    return selectedParticipants.filter((participant) => {
      const matchesSearch =
        !search ||
        participant.fullName.toLowerCase().includes(search) ||
        participant.schoolId.toLowerCase().includes(search);
      const matchesStatus =
        participantsStatusFilter === "all"
          ? true
          : participant.attendanceStatus === participantsStatusFilter;
      const matchesCourse =
        participantsCourseFilter === "all"
          ? true
          : participant.course === participantsCourseFilter;
      const matchesYear =
        participantsYearFilter === "all"
          ? true
          : participant.yearLevel === participantsYearFilter;

      return matchesSearch && matchesStatus && matchesCourse && matchesYear;
    });
  }, [
    participantsCourseFilter,
    participantsSearch,
    participantsStatusFilter,
    participantsYearFilter,
    selectedParticipants,
  ]);
  const participantsTotalPages = Math.max(
    1,
    Math.ceil(filteredParticipants.length / participantsRowsPerPageValue),
  );
  const paginatedParticipants = useMemo(() => {
    const start = (participantsPage - 1) * participantsRowsPerPageValue;
    return filteredParticipants.slice(start, start + participantsRowsPerPageValue);
  }, [filteredParticipants, participantsPage, participantsRowsPerPageValue]);
  const participantResultStart =
    filteredParticipants.length === 0
      ? 0
      : (participantsPage - 1) * participantsRowsPerPageValue + 1;
  const participantResultEnd = Math.min(
    participantsPage * participantsRowsPerPageValue,
    filteredParticipants.length,
  );

  const selectedFiles = useMemo(() => {
    if (!selectedEvent) return [];
    return selectedEventFiles
      .filter((file) => file.eventId === selectedEvent.id)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [selectedEvent, selectedEventFiles]);

  const selectedDocuments = useMemo(
    () => selectedFiles.filter((file) => file.kind === "docs"),
    [selectedFiles],
  );
  const selectedImages = useMemo(
    () => selectedFiles.filter((file) => file.kind === "images"),
    [selectedFiles],
  );
  const previewImageFiles = useMemo(
    () => selectedImages.slice(0, FILE_PREVIEW_LIMIT),
    [selectedImages],
  );
  const previewDocumentFiles = useMemo(
    () => selectedDocuments.slice(0, FILE_PREVIEW_LIMIT),
    [selectedDocuments],
  );

  async function downloadTeacherEventDocument(
    eventId: string,
    file: { id: string; name: string },
  ) {
    if (!eventId || !file.id) {
      campusToast.error({
        title: "Download failed",
        description: "The selected event document is missing its event context.",
        dedupeKey: `teacher-event-document-missing:${eventId || "unknown"}:${file.id || "unknown"}`,
      });
      return;
    }

    try {
      const result = await createEventDocumentDownloadUrl({
        eventId,
        docId: file.id,
      });

      downloadTeacherFile({
        url: result.url,
        name: result.fileName || result.name || file.name,
        sourceLabel: "document",
      });
    } catch (error) {
      campusToast.error({
        title: "Download failed",
        description:
          error instanceof Error && error.message.trim() ?
            error.message :
            "Failed to prepare the event document download.",
        dedupeKey: `teacher-event-document-download:${eventId}:${file.id}`,
      });
    }
  }

  function handleTeacherEventFileDownload(file: {
    id: string;
    kind: "docs" | "images";
    name: string;
    downloadURL?: string;
  }) {
    if (file.kind === "images") {
      downloadTeacherFile({
        url: file.downloadURL ?? "",
        name: file.name,
        sourceLabel: "image",
      });
      return;
    }

    if (!selectedEvent) {
      campusToast.error({
        title: "Download failed",
        description: "The selected event is no longer available.",
        dedupeKey: `teacher-event-document-selected-event-missing:${file.id}`,
      });
      return;
    }

    void downloadTeacherEventDocument(selectedEvent.id, file);
  }

  async function uploadTeacherEventDocumentFile(eventId: string, file: File) {
    if (!profile) {
      throw new Error("Your teacher profile is not available right now.");
    }

    const requestedContentType = getEventDocumentContentType(file);
    let uploadTarget: Awaited<
      ReturnType<typeof createEventDocumentUploadTarget>
    > | null = null;

    try {
      uploadTarget = await createEventDocumentUploadTarget({
        eventId,
        fileName: file.name,
        contentType: requestedContentType,
        size: file.size,
      });
      console.log("[TEACHER_FILE_UPLOAD][DOC_TARGET]", {
        ...uploadTarget,
        currentAuthUid: auth.currentUser?.uid,
        uploadedByUid: uploadTarget.uploadedByUid,
        createdByUid: uploadTarget.createdByUid,
        ownerUid: uploadTarget.ownerUid,
        uploadedByRole: uploadTarget.uploadedByRole,
        status: uploadTarget.status,
      });

      const uploadType =
        uploadTarget.contentType ||
        requestedContentType ||
        String(file.type ?? "").trim().toLowerCase() ||
        getEventDocumentContentType(file);
      const uploadMetadata: UploadMetadata = {
        contentType: uploadType,
        customMetadata: {
          uploadedByRole: "teacher",
          eventId,
          docId: uploadTarget.docId,
        },
      };

      console.log("[TEACHER_FILE_UPLOAD][DOC_UPLOAD]", {
        currentAuthUid: auth.currentUser?.uid,
        eventId,
        targetEventId: uploadTarget.eventId,
        docId: uploadTarget.docId,
        storagePath: uploadTarget.storagePath,
        targetContentType: uploadTarget.contentType,
        metadataContentType: uploadMetadata.contentType,
        fileName: file.name,
        fileType: file.type,
        size: file.size,
        role: profile?.role,
      });

      await uploadEventDocumentWithResumable(
        ref(storage, uploadTarget.storagePath),
        file,
        uploadMetadata,
      );

      await finalizeEventDocumentUpload({
        eventId,
        docId: uploadTarget.docId,
        size: uploadTarget.size || file.size,
        contentType: uploadType,
      });
    } catch (error) {
      if (uploadTarget) {
        await cleanupPendingEventDocumentUpload({
          eventId,
          docId: uploadTarget.docId,
        }).catch(() => undefined);
      }

      throw error;
    }
  }

  async function uploadTeacherEventImageFile(eventId: string, file: File) {
    if (!profile) {
      throw new Error("Your teacher profile is not available right now.");
    }

    const compressed = await compressImageForUpload(
      file,
      MAX_EVENT_FILE_SIZE_BYTES,
    );
    if (compressed.size > MAX_EVENT_FILE_SIZE_BYTES) {
      throw new Error(
        `${file.name} is still ${toMegabytesText(compressed.size)} after compression. Max is 10MB.`,
      );
    }

    const uploadType = "image/jpeg";
    const safeName = compressed.name.replace(/[^\w.\-()+ ]/g, "_");
    const finalFileName = safeName.toLowerCase().endsWith(".jpg") ?
      safeName :
      toCompressedImageName(safeName);
    const uploadFile = new File([compressed], finalFileName, {
      type: uploadType,
      lastModified: Date.now(),
    });
    let uploadTarget: Awaited<
      ReturnType<typeof createEventImageUploadTarget>
    > | null = null;

    try {
      uploadTarget = await createEventImageUploadTarget({
        eventId,
        fileName: uploadFile.name,
        contentType: uploadType,
        size: uploadFile.size,
      });
      console.log("[TEACHER_FILE_UPLOAD][IMAGE_TARGET]", {
        eventId,
        imageId: uploadTarget.imageId,
        storagePath: uploadTarget.storagePath,
        fileName: uploadTarget.fileName,
        contentType: uploadTarget.contentType,
        size: uploadTarget.size,
        uid: auth.currentUser?.uid,
        targetUid: uploadTarget.uid,
        uploadedByUid: uploadTarget.uploadedByUid,
        createdByUid: uploadTarget.createdByUid,
        ownerUid: uploadTarget.ownerUid,
        uploadedByRole: uploadTarget.uploadedByRole,
        status: uploadTarget.status,
        role: profile?.role,
      });

      const uploadMetadata: UploadMetadata = {
        contentType: uploadTarget.contentType || uploadType,
        customMetadata: {
          uploadedByRole: "teacher",
          eventId,
          imageId: uploadTarget.imageId,
        },
      };

      console.log("[TEACHER_FILE_UPLOAD][IMAGE_UPLOAD]", {
        currentAuthUid: auth.currentUser?.uid,
        eventId,
        targetEventId: uploadTarget.eventId,
        imageId: uploadTarget.imageId,
        storagePath: uploadTarget.storagePath,
        targetContentType: uploadTarget.contentType,
        metadataContentType: uploadMetadata.contentType,
        fileName: uploadFile.name,
        originalType: file.type,
        fileType: uploadFile.type,
        size: uploadFile.size,
        role: profile?.role,
      });

      await uploadEventDocumentWithResumable(
        ref(storage, uploadTarget.storagePath),
        uploadFile,
        uploadMetadata,
      );

      const finalizedUpload = await finalizeEventImageUpload({
        eventId,
        imageId: uploadTarget.imageId,
      });
      console.log("[TEACHER_FILE_UPLOAD][IMAGE_FINALIZE]", {
        eventId,
        imageId: uploadTarget.imageId,
        storagePath: finalizedUpload.storagePath,
        contentType: finalizedUpload.contentType,
        size: finalizedUpload.size,
        status: finalizedUpload.status,
      });
    } catch (error) {
      if (uploadTarget) {
        await cleanupPendingEventImageUpload({
          eventId,
          imageId: uploadTarget.imageId,
        }).catch(() => undefined);
      }

      throw error;
    }
  }

  function handleBlockedTeacherUpload() {
    campusToast.error({
      title: "Upload unavailable",
      description:
        selectedEventUploadDisabledReason || "The selected event cannot accept uploads right now.",
      dedupeKey: `teacher-event-upload-blocked:${selectedEvent?.id ?? "unknown"}`,
    });
  }

  function openImageUploadPicker() {
    if (!selectedEventUploadsAllowed) {
      handleBlockedTeacherUpload();
      return;
    }

    imageInputRef.current?.click();
  }

  function openDocumentUploadPicker() {
    if (!selectedEventUploadsAllowed) {
      handleBlockedTeacherUpload();
      return;
    }

    documentInputRef.current?.click();
  }

  async function handleImageInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!selectedEvent || !selectedEventUploadsAllowed) {
      handleBlockedTeacherUpload();
      return;
    }

    if (!isAllowedTeacherEventImage(file)) {
      campusToast.error({
        title: "Upload failed",
        description: "Only JPG, JPEG, PNG, and WEBP image files are allowed.",
        dedupeKey: `teacher-event-image-invalid-type:${selectedEvent.id}`,
      });
      return;
    }

    if (file.size > MAX_EVENT_FILE_SIZE_BYTES) {
      campusToast.error({
        title: "Upload failed",
        description: `Images larger than 10MB are not allowed. Selected file is ${toMegabytesText(file.size)}.`,
        dedupeKey: `teacher-event-image-too-large:${selectedEvent.id}`,
      });
      return;
    }

    setUploadingImage(true);

    try {
      await uploadTeacherEventImageFile(selectedEvent.id, file);
      campusToast.success({
        title: "Photo uploaded.",
        description: `${file.name} is now available in Images.`,
        dedupeKey: `teacher-event-image-uploaded:${selectedEvent.id}:${file.name}`,
      });
    } catch (error) {
      campusToast.error({
        title: "Upload failed",
        description: normalizeTeacherUploadError(
          error,
          "Failed to upload the selected event photo.",
        ),
        dedupeKey: `teacher-event-image-upload-error:${selectedEvent.id}:${file.name}`,
      });
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleDocumentInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";

    if (!file) {
      return;
    }

    if (!selectedEvent || !selectedEventUploadsAllowed) {
      handleBlockedTeacherUpload();
      return;
    }

    if (!isAllowedEventDocument(file)) {
      campusToast.error({
        title: "Upload failed",
        description: "Only PDF, DOC, and DOCX files are allowed.",
        dedupeKey: `teacher-event-document-invalid-type:${selectedEvent.id}`,
      });
      return;
    }

    if (file.size > MAX_EVENT_FILE_SIZE_BYTES) {
      campusToast.error({
        title: "Upload failed",
        description: `Documents larger than 10MB are not allowed. Selected file is ${toMegabytesText(file.size)}.`,
        dedupeKey: `teacher-event-document-too-large:${selectedEvent.id}`,
      });
      return;
    }

    setUploadingDocument(true);

    try {
      await uploadTeacherEventDocumentFile(selectedEvent.id, file);
      campusToast.success({
        title: "Document uploaded.",
        description: `${file.name} is now available in Documents.`,
        dedupeKey: `teacher-event-document-uploaded:${selectedEvent.id}:${file.name}`,
      });
    } catch (error) {
      campusToast.error({
        title: "Upload failed",
        description: normalizeTeacherUploadError(
          error,
          "Failed to upload the selected event document.",
        ),
        dedupeKey: `teacher-event-document-upload-error:${selectedEvent.id}:${file.name}`,
      });
    } finally {
      setUploadingDocument(false);
    }
  }

  const upcomingCount = useMemo(
    () => events.filter((event) => event.lifecycle === "upcoming").length,
    [events],
  );
  const ongoingCount = useMemo(
    () => events.filter((event) => event.lifecycle === "ongoing").length,
    [events],
  );
  const completedCount = useMemo(
    () => events.filter((event) => event.lifecycle === "completed").length,
    [events],
  );

  useEffect(() => {
    setPage(1);
  }, [dateFilter, searchText, statusFilter]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!selectedEvent) {
      if (selectedEventId) {
        setSelectedEventId(null);
      }
      setSelectedTab("overview");
    }
  }, [selectedEvent, selectedEventId]);

  useEffect(() => {
    if (!selectedEventLiveId) {
      setSelectedEventAttendanceRows([]);
      setSelectedEventAttendanceLoading(false);
      setSelectedEventFiles([]);
      return;
    }

    const eventId = selectedEventLiveId;

    setSelectedEventAttendanceLoading(true);
    setSelectedEventAttendanceRows([]);
    setSelectedEventFiles([]);

    const updateFileBucket = (kind: TeacherFileKind, rows: TeacherFile[]) => {
      setSelectedEventFiles((currentFiles) =>
        [
          ...currentFiles.filter((file) => file.kind !== kind),
          ...rows,
        ].sort((a, b) => b.createdAtMs - a.createdAtMs),
      );
    };

    const unsubAttendance = onSnapshot(
      collection(db, "events", eventId, "attendance"),
      (snap) => {
        setSelectedEventAttendanceRows(
          snap.docs.map((attendanceDoc) => ({
            id: attendanceDoc.id,
            ...(attendanceDoc.data() as Omit<
              AttendanceExportAttendanceDoc,
              "id"
            >),
          })),
        );
        setSelectedEventAttendanceLoading(false);
      },
      (nextError) => {
        setSelectedEventAttendanceRows([]);
        setSelectedEventAttendanceLoading(false);
        campusToast.error({
          title: "Participants unavailable",
          description:
            nextError instanceof Error
              ? nextError.message
              : "Failed to load live event participants.",
          dedupeKey: `teacher-event-live-attendance:${eventId}`,
        });
      },
    );

    const unsubDocuments = onSnapshot(
      query(
        collection(db, "events", eventId, "docs"),
        orderBy("createdAt", "desc"),
      ),
      (snap) => {
        updateFileBucket("docs", mapFileSnapshot(eventId, "docs", snap));
      },
      (nextError) => {
        updateFileBucket("docs", []);
        campusToast.error({
          title: "Documents unavailable",
          description:
            nextError instanceof Error
              ? nextError.message
              : "Failed to load live event documents.",
          dedupeKey: `teacher-event-live-docs:${eventId}`,
        });
      },
    );

    const unsubImages = onSnapshot(
      query(
        collection(db, "events", eventId, "images"),
        orderBy("createdAt", "desc"),
      ),
      (snap) => {
        updateFileBucket("images", mapFileSnapshot(eventId, "images", snap));
      },
      (nextError) => {
        updateFileBucket("images", []);
        campusToast.error({
          title: "Images unavailable",
          description:
            nextError instanceof Error
              ? nextError.message
              : "Failed to load live event images.",
          dedupeKey: `teacher-event-live-images:${eventId}`,
        });
      },
    );

    return () => {
      unsubAttendance();
      unsubDocuments();
      unsubImages();
    };
  }, [selectedEventLiveId]);

  useEffect(() => {
    if (!selectedEvent) {
      setSelectedEventExportEvent(null);
      setSelectedEventRegistrations([]);
      setSelectedEventStudents([]);
      setSelectedEventRosterLoading(false);
      return;
    }

    const eventForLoad = selectedEvent;
    let active = true;

    setSelectedEventRosterLoading(true);
    setSelectedEventExportEvent(null);
    setSelectedEventRegistrations([]);
    setSelectedEventStudents([]);

    async function loadSelectedEventRoster() {
      try {
        const [
          exportEvent,
          registrations,
          students,
        ] = await Promise.all([
          loadTeacherAttendanceExportEvent(eventForLoad),
          loadTeacherAttendanceExportRegistrations(eventForLoad.id),
          loadTeacherAttendanceExportStudents(),
        ]);

        if (!active) return;

        setSelectedEventExportEvent(exportEvent);
        setSelectedEventRegistrations(registrations);
        setSelectedEventStudents(students);
      } catch (nextError) {
        if (!active) return;

        setSelectedEventExportEvent(null);
        setSelectedEventRegistrations([]);
        setSelectedEventStudents([]);
        campusToast.error({
          title: "Roster unavailable",
          description:
            nextError instanceof Error
              ? nextError.message
              : "Failed to load eligible students for this event.",
          dedupeKey: `teacher-event-roster:${eventForLoad.id}`,
        });
      } finally {
        if (active) {
          setSelectedEventRosterLoading(false);
        }
      }
    }

    void loadSelectedEventRoster();

    return () => {
      active = false;
    };
  }, [selectedEvent]);

  useEffect(() => {
    setParticipantsPage(1);
  }, [
    participantsCourseFilter,
    participantsSearch,
    participantsStatusFilter,
    participantsYearFilter,
    participantsRowsPerPageValue,
  ]);

  useEffect(() => {
    setParticipantsPage((prev) => Math.min(prev, participantsTotalPages));
  }, [participantsTotalPages]);

  useEffect(() => {
    setParticipantsSearch("");
    setParticipantsStatusFilter("all");
    setParticipantsCourseFilter("all");
    setParticipantsYearFilter("all");
    setParticipantsPage(1);
    setFilesView("images");
    setImagesModalOpen(false);
    setDocumentsModalOpen(false);
  }, [selectedEvent?.id]);

  const exportEventAttendanceWorkbook = async (ev: TeacherEvent) => {
    setExportingEventId(ev.id);

    try {
      const [
        exportEvent,
        attendanceSnap,
        registrations,
        students,
      ] = await Promise.all([
        loadTeacherAttendanceExportEvent(ev),
        getDocs(collection(db, "events", ev.id, "attendance")),
        loadTeacherAttendanceExportRegistrations(ev.id),
        loadTeacherAttendanceExportStudents(),
      ]);
      const attendanceRows = attendanceSnap.docs.map((attendanceDoc) => ({
        id: attendanceDoc.id,
        ...(attendanceDoc.data() as Omit<AttendanceExportAttendanceDoc, "id">),
      }));
      const {
        rows,
        audienceResolved,
      } = buildAttendanceParticipantRows({
        event: exportEvent,
        attendanceRows,
        registrations,
        students,
        respectPaymentStatus: false,
      });
      const presentRows = rows
        .filter((participant) =>
          isAttendedParticipantStatus(participant.attendanceStatus),
        )
        .map(attendanceParticipantToExportRow);
      const absentRows = rows
        .filter((participant) => participant.attendanceStatus === "Absent")
        .map(attendanceParticipantToExportRow);

      if (rows.length === 0) {
        campusToast.warning({
          title: "No participants to export",
          description: "No eligible students match this event's audience scope.",
          dedupeKey: `teacher-event-export-empty:${ev.id}`,
        });
        return;
      }

      await downloadAttendanceWorkbook(exportEvent, presentRows, {
        absentRows,
        absentSheetTimeColumns: true,
        metadataTimeLabels: {
          timeIn: "Scheduled Time In",
          timeOut: "Scheduled Time Out",
        },
      });

      campusToast.success({
        title: "Attendance exported",
        description: audienceResolved
          ? `Exported ${presentRows.length} present and ${absentRows.length} absent row(s) for "${ev.title}".`
          : `Exported ${presentRows.length} present and ${absentRows.length} absent row(s) from available records for "${ev.title}".`,
        dedupeKey: `teacher-event-export-success:${ev.id}:${presentRows.length}:${absentRows.length}`,
      });
    } catch (error) {
      campusToast.error({
        title: "Export failed",
        description:
          error instanceof Error
            ? error.message
            : "Failed to export teacher-visible attendance.",
        dedupeKey: `teacher-event-export-error:${ev.id}`,
      });
    } finally {
      setExportingEventId(null);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <TeacherPageHeader
        variant="hero"
        icon={CalendarRange}
        title="Event Tracking"
        description="Review teacher-visible event schedules, participants, attendance outcomes, and attached files from the CAMPUS event workspace."
      />

      {loading ? (
        <CampusMetricSkeleton />
      ) : (
        <TeacherStatsGrid
          items={[
            {
              label: "Total Events",
              value: events.length,
              description: "Teacher-visible events currently loaded in the workspace.",
              tone: "blue",
              icon: CalendarRange,
            },
            {
              label: "Upcoming",
              value: upcomingCount,
              description: "Events scheduled for a later date or time.",
              tone: "amber",
              icon: Clock3,
            },
            {
              label: "Ongoing",
              value: ongoingCount,
              description: "Events happening right now based on schedule.",
              tone: "green",
              icon: CheckCircle2,
            },
            {
              label: "Completed",
              value: completedCount,
              description: "Finished events still available for teacher review.",
              tone: "slate",
              icon: FileStack,
            },
          ]}
        />
      )}

      {loading ? (
        <TeacherFilterBarSkeleton />
      ) : (
        <TeacherFilterBar>
          <Input
            aria-label="Search events"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Search title, venue, or audience"
            startContent={<Search size={16} className="text-campus-text-secondary" />}
          />

          <Select
            aria-label="Filter by status"
            disallowEmptySelection
            items={statusOptions}
            selectedKeys={new Set([statusFilter || "__all_status__"])}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0];
              if (typeof selected === "string") {
                setStatusFilter(selected === "__all_status__" ? "" : selected);
              }
            }}
          >
            {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
          </Select>

          <Input
            aria-label="Filter events by date"
            type="date"
            value={dateFilter}
            onValueChange={setDateFilter}
          />
        </TeacherFilterBar>
      )}

      <TeacherDataTable
        ariaLabel="Teacher event records"
        columns={teacherEventColumns}
        items={paginatedEvents.map((event) => {
          const schedule = getTeacherEventSchedule(event);

          return {
            id: event.id,
            title: event.title,
            location: event.location,
            lifecycle: event.lifecycle,
            schedule: schedule.scheduleLabel,
            audience: teacherAudienceLabel(event),
          };
        })}
        getRowKey={(event) => event.id}
        emptyTitle="No events found"
        emptyDescription="Try another title, venue, audience, status, or date filter to widen the teacher-visible event results."
        isLoading={loading}
        renderCell={(event, columnKey) => {
          if (columnKey === "event") {
            return (
              <div className="space-y-1">
                <p className="font-semibold text-campus-text-primary">
                  {event.title}
                </p>
                <p className="inline-flex items-center gap-1.5 text-xs text-campus-text-secondary">
                  <MapPin size={13} />
                  {event.location}
                </p>
              </div>
            );
          }

          if (columnKey === "status") {
            const toneClasses = getTeacherToneClasses(
              getTeacherLifecycleTone(event.lifecycle),
            );

            return (
              <Chip size="sm" className={toneClasses.chip}>
                {capitalizeTeacherLabel(event.lifecycle)}
              </Chip>
            );
          }

          if (columnKey === "schedule") {
            return (
              <div className="space-y-1">
                <p className="text-sm font-medium text-campus-text-primary">
                  {event.schedule}
                </p>
              </div>
            );
          }

          if (columnKey === "audience") {
            return (
              <p className="max-w-sm text-sm leading-6 text-campus-text-secondary">
                {event.audience}
              </p>
            );
          }

          if (columnKey === "actions") {
            return (
              <div className="flex justify-end">
                <Button
                  color="primary"
                  variant="flat"
                  size="sm"
                  onPress={() => setSelectedEventId(event.id)}
                >
                  Review event
                </Button>
              </div>
            );
          }

          return null;
        }}
      />

      {!loading && filteredEvents.length > EVENTS_PER_PAGE ? (
        <div className="flex justify-center sm:justify-end">
          <Pagination
            showControls
            page={page}
            total={totalPages}
            onChange={(nextPage) => setPage(nextPage)}
          />
        </div>
      ) : null}

      <Modal
        isOpen={Boolean(selectedEvent)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEventId(null);
            setSelectedTab("overview");
          }
        }}
        size={isCompactView ? "full" : "5xl"}
        scrollBehavior="inside"
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xl font-semibold text-campus-text-primary">
                    {selectedEvent?.title || "Event details"}
                  </span>
                  {selectedEvent ? (
                    <Chip
                      size="sm"
                      className={getTeacherToneClasses(
                        getTeacherLifecycleTone(selectedEvent.lifecycle),
                      ).chip}
                    >
                      {capitalizeTeacherLabel(selectedEvent.lifecycle)}
                    </Chip>
                  ) : null}
                </div>
                <span className="text-sm font-normal text-campus-text-secondary">
                  {selectedEvent
                    ? `${selectedEventSchedule?.scheduleLabel ?? "Date TBA | Time TBA"} | ${selectedEvent.location}`
                    : "-"}
                </span>
              </ModalHeader>

              <ModalBody className="space-y-5 pb-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {selectedEventParticipantsLoading ? (
                    <>
                      <CampusMetricSkeleton />
                      <CampusMetricSkeleton />
                      <CampusMetricSkeleton />
                    </>
                  ) : (
                    <>
                      <EventDetailStat
                        label="Total Participants"
                        value={selectedEventReview?.attendanceCount ?? 0}
                        tone="blue"
                      />
                      <EventDetailStat
                        label="Present"
                        value={selectedEventReview?.presentCount ?? 0}
                        tone="green"
                      />
                      <EventDetailStat
                        label="Absent"
                        value={selectedEventReview?.absentCount ?? 0}
                        tone="red"
                      />
                    </>
                  )}
                  <EventDetailStat
                    label="Files"
                    value={
                      (selectedEventReview?.documentCount ?? 0) +
                      (selectedEventReview?.imageCount ?? 0)
                    }
                    tone="purple"
                  />
                </div>

                <Tabs
                  aria-label="Event detail tabs"
                  selectedKey={selectedTab}
                  onSelectionChange={(key) =>
                    setSelectedTab(String(key) as EventTabKey)
                  }
                  fullWidth
                  classNames={eventDetailTabsClassNames}
                >
                  <Tab key="overview" title="Overview">
                    <div className="grid grid-cols-1 gap-4 pt-3 lg:grid-cols-2">
                      <Card shadow="none" className="border border-border/70 bg-slate-50/70">
                        <CardBody className="space-y-4 p-4">
                          <EventDetailInfoRow
                            label="Audience"
                            value={
                              selectedEventReview
                                ? teacherAudienceLabel(selectedEventReview)
                                : "-"
                            }
                          />
                          <EventDetailInfoRow
                            label="Schedule"
                            value={selectedEventSchedule?.scheduleLabel ?? "-"}
                          />
                          <EventDetailInfoRow
                            label="Status"
                            value={
                              selectedEventReview
                                ? capitalizeTeacherLabel(selectedEventReview.lifecycle)
                                : "-"
                            }
                          />
                          <EventDetailInfoRow
                            label="Payment linked"
                            value={selectedEventReview?.withPayment ? "Yes" : "No"}
                          />
                          <EventDetailInfoRow
                            label="Pre-registration"
                            value={
                              selectedEventReview?.isPreReg
                                ? `Enabled${
                                    selectedEventReview.preRegSlots
                                      ? ` (${selectedEventReview.preRegSlots} slots)`
                                      : ""
                                  }`
                                : "Disabled"
                            }
                          />
                        </CardBody>
                      </Card>

                      <Card shadow="none" className="border border-border/70 bg-slate-50/70">
                        <CardBody className="space-y-3 p-4">
                          <p className="text-sm font-semibold text-campus-text-primary">
                            Event details
                          </p>
                          <p className="text-sm leading-6 text-campus-text-secondary">
                            {selectedEventReview?.details || "No event description provided."}
                          </p>
                        </CardBody>
                      </Card>
                    </div>
                  </Tab>

                  <Tab key="participants" title="Participants">
                    <div className="space-y-4 pt-3">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_180px_220px_170px]">
                        <Input
                          aria-label="Search participants"
                          value={participantsSearch}
                          onValueChange={setParticipantsSearch}
                          placeholder="Search participants..."
                          startContent={
                            <Search
                              size={16}
                              className="text-campus-text-secondary"
                            />
                          }
                        />

                        <Select
                          aria-label="Filter participants by attendance status"
                          disallowEmptySelection
                          items={participantStatusOptions}
                          selectedKeys={new Set([participantsStatusFilter])}
                          onSelectionChange={(keys) => {
                            if (keys === "all") return;
                            const selected = Array.from(keys)[0];
                            if (typeof selected === "string") {
                              setParticipantsStatusFilter(
                                selected as ParticipantStatusFilter,
                              );
                            }
                          }}
                        >
                          {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
                        </Select>

                        <Select
                          aria-label="Filter participants by course"
                          disallowEmptySelection
                          items={participantCourseOptions}
                          selectedKeys={new Set([participantsCourseFilter])}
                          onSelectionChange={(keys) => {
                            if (keys === "all") return;
                            const selected = Array.from(keys)[0];
                            if (typeof selected === "string") {
                              setParticipantsCourseFilter(selected);
                            }
                          }}
                        >
                          {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
                        </Select>

                        <Select
                          aria-label="Filter participants by year"
                          disallowEmptySelection
                          items={participantYearOptions}
                          selectedKeys={new Set([participantsYearFilter])}
                          onSelectionChange={(keys) => {
                            if (keys === "all") return;
                            const selected = Array.from(keys)[0];
                            if (typeof selected === "string") {
                              setParticipantsYearFilter(selected);
                            }
                          }}
                        >
                          {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
                        </Select>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <p className="text-sm text-campus-text-secondary">
                          {filteredParticipants.length > 0
                            ? `Showing ${participantResultStart}-${participantResultEnd} of ${filteredParticipants.length} participant${filteredParticipants.length === 1 ? "" : "s"}`
                            : "Showing 0 participants"}
                          {filteredParticipants.length !== selectedParticipants.length
                            ? ` (${selectedParticipants.length} total)`
                            : ""}
                        </p>

                        <Button
                          color="primary"
                          variant="flat"
                          startContent={<Download size={16} />}
                          className="w-full sm:w-auto"
                          onPress={() => {
                            if (!selectedEvent) return;
                            void exportEventAttendanceWorkbook(selectedEvent);
                          }}
                          isDisabled={
                            !selectedEvent || exportingEventId === selectedEvent.id
                          }
                          isLoading={exportingEventId === selectedEvent?.id}
                        >
                          {exportingEventId === selectedEvent?.id
                            ? "Exporting..."
                            : "Export Attendance"}
                        </Button>
                      </div>

                      {selectedEventParticipantsLoading ? (
                        <Card shadow="none" className="border border-border/70 bg-slate-50/70">
                          <CardBody className="items-center gap-3 p-6 text-center">
                            <Spinner size="sm" />
                            <div className="space-y-1">
                              <p className="font-medium text-campus-text-primary">
                                Loading participants
                              </p>
                              <p className="max-w-md text-sm text-campus-text-secondary">
                                Loading the eligible roster and latest attendance for this event.
                              </p>
                            </div>
                          </CardBody>
                        </Card>
                      ) : selectedParticipants.length === 0 ? (
                        <TeacherEmptyState
                          title="No eligible participants"
                          description={
                            selectedParticipantBuild.audienceResolved
                              ? "No eligible students match this event's audience scope."
                              : "This event does not have a resolvable student audience yet."
                          }
                          icon={CheckCircle2}
                          compact
                        />
                      ) : filteredParticipants.length === 0 ? (
                        <TeacherEmptyState
                          title="No participants match the selected filters."
                          description="Try another search term or adjust the status, course, or year filters."
                          icon={Search}
                          compact
                        />
                      ) : (
                        <>
                          <div className="space-y-3">
                            {paginatedParticipants.map((participant) => {
                          const toneClasses = getTeacherToneClasses(
                            participant.attendanceStatus === "Present"
                              ? "green"
                              : participant.attendanceStatus === "Absent"
                                ? "red"
                                : "blue",
                          );

                          return (
                            <Card
                              key={`${participant.schoolId || participant.uid}-${participant.attendanceStatus}`}
                              shadow="none"
                              className="border border-border/70 bg-slate-50/70"
                            >
                              <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-semibold text-campus-text-primary">
                                    {participant.fullName}
                                  </p>
                                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-campus-text-secondary">
                                    <span className="max-w-full truncate">
                                      {participant.schoolId}
                                    </span>
                                    <span className="max-w-full truncate">
                                      {participant.course}
                                    </span>
                                    <span>{participant.yearLevel}</span>
                                  </div>
                                  <p className="mt-1 truncate text-xs text-campus-text-secondary">
                                    Time in: {participant.timeIn} | Time out: {participant.timeOut}
                                  </p>
                                </div>
                                <Chip
                                  size="sm"
                                  className={`${toneClasses.chip} self-start sm:self-auto`}
                                >
                                  {participant.attendanceStatus}
                                </Chip>
                              </CardBody>
                            </Card>
                          );
                            })}
                          </div>

                          {filteredParticipants.length > participantsRowsPerPageValue ? (
                            <div className="flex justify-center sm:justify-end">
                              <Pagination
                                showControls
                                page={participantsPage}
                                total={participantsTotalPages}
                                onChange={(nextPage) => setParticipantsPage(nextPage)}
                              />
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                  </Tab>

                  <Tab key="files" title="Files">
                    <div className="space-y-5 pt-3">
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept={IMAGE_UPLOAD_ACCEPT}
                        className="hidden"
                        onChange={handleImageInputChange}
                      />
                      <input
                        ref={documentInputRef}
                        type="file"
                        accept={DOCUMENT_UPLOAD_ACCEPT}
                        className="hidden"
                        onChange={handleDocumentInputChange}
                      />

                      {selectedEvent?.lifecycle === "cancelled" ? (
                        <p className="text-sm text-campus-text-secondary">
                          Uploads are disabled for cancelled events.
                        </p>
                      ) : null}

                      <EventFilesTabs
                        activeView={filesView}
                        onViewChange={setFilesView}
                        imageCount={selectedImages.length}
                        documentCount={selectedDocuments.length}
                        previewImageFiles={previewImageFiles}
                        previewDocumentFiles={previewDocumentFiles}
                        onOpenImages={() => setImagesModalOpen(true)}
                        onOpenDocuments={() => setDocumentsModalOpen(true)}
                        onDownloadFile={handleTeacherEventFileDownload}
                        renderImageHeaderActions={() => (
                          <Button
                            color="primary"
                            variant="flat"
                            startContent={<Upload size={16} />}
                            className="w-full sm:w-auto"
                            onPress={openImageUploadPicker}
                            isDisabled={!selectedEventUploadsAllowed || uploadingImage}
                            isLoading={uploadingImage}
                          >
                            {uploadingImage ? "Uploading photo..." : "Upload Photo"}
                          </Button>
                        )}
                        renderDocumentHeaderActions={() => (
                          <Button
                            color="primary"
                            variant="flat"
                            startContent={<Upload size={16} />}
                            className="w-full sm:w-auto"
                            onPress={openDocumentUploadPicker}
                            isDisabled={!selectedEventUploadsAllowed || uploadingDocument}
                            isLoading={uploadingDocument}
                          >
                            {uploadingDocument ? "Uploading document..." : "Upload Document"}
                          </Button>
                        )}
                      />
                    </div>
                  </Tab>
                </Tabs>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>

      <AllEventImagesModal
        isOpen={Boolean(selectedEvent) && imagesModalOpen}
        onOpenChange={setImagesModalOpen}
        files={selectedImages}
        eventTitle={selectedEvent?.title || ""}
        isCompactView={isCompactView}
        onDownloadFile={(file) =>
          downloadTeacherFile({
            url: file.downloadURL ?? "",
            name: file.name,
            sourceLabel: "image",
          })
        }
        introText="Browse all teacher-visible event images and download what you need."
        emptyState={{
          title: "No images found",
          description: "Teacher-visible event images will appear here once uploaded.",
        }}
      />

      <AllEventDocumentsModal
        isOpen={Boolean(selectedEvent) && documentsModalOpen}
        onOpenChange={setDocumentsModalOpen}
        files={selectedDocuments}
        eventTitle={selectedEvent?.title || ""}
        isCompactView={isCompactView}
        onDownloadFile={(file) => {
          if (!selectedEvent) {
            campusToast.error({
              title: "Download failed",
              description: "The selected event is no longer available.",
              dedupeKey: `teacher-event-document-modal-missing:${file.id}`,
            });
            return;
          }

          void downloadTeacherEventDocument(selectedEvent.id, file);
        }}
        emptyState={{
          title: "No documents found",
          description: "Teacher-visible event documents will appear here once uploaded.",
        }}
      />
    </div>
  );
}

/*
function ImagePreviewCard({ file }: { file: TeacherEventFileItem }) {
  const canPreview = isTeacherImageFile({
    kind: file.kind,
    contentType: file.contentType ?? "",
    name: file.name,
  });

  return (
    <Card
      shadow="none"
      className="overflow-hidden border border-border/70 bg-white/95 shadow-[0_14px_32px_rgba(15,23,42,0.06)]"
    >
      <div className="h-44 bg-slate-100">
        {canPreview && file.downloadURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.downloadURL}
            alt={file.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <ImageIcon size={20} />
            </div>
            <p className="text-sm text-campus-text-secondary">
              Preview unavailable
            </p>
          </div>
        )}
      </div>

      <CardBody className="space-y-3 p-4">
        <div className="space-y-2">
          <p className="line-clamp-2 text-sm font-semibold text-campus-text-primary">
            {file.name}
          </p>
          <div className="flex flex-wrap gap-2">
            <Chip size="sm" className="bg-amber-100 text-amber-700">
              Image
            </Chip>
            <Chip size="sm" className="bg-violet-100 text-violet-700">
              {formatTeacherBytes(file.size)}
            </Chip>
          </div>
        </div>

        <Button
          color="primary"
          variant="flat"
          startContent={<Download size={16} />}
          onPress={() =>
            downloadTeacherFile({
              url: file.downloadURL ?? "",
              name: file.name,
              sourceLabel: "image",
            })
          }
          isDisabled={!file.downloadURL}
        >
          Download
        </Button>
      </CardBody>
    </Card>
  );
}

function DocumentListItem({ file }: { file: TeacherEventFileItem }) {
  return (
    <Card shadow="none" className="border border-border/70 bg-slate-50/70">
      <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="truncate font-semibold text-campus-text-primary">
            {file.name}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Chip size="sm" className="bg-blue-100 text-blue-700">
              Document
            </Chip>
            <Chip size="sm" className="bg-violet-100 text-violet-700">
              {formatTeacherBytes(file.size)}
            </Chip>
          </div>
        </div>

        <Button
          size="sm"
          variant="flat"
          color="primary"
          startContent={<Download size={16} />}
          onPress={() =>
            downloadTeacherFile({
              url: file.downloadURL ?? "",
              name: file.name,
              sourceLabel: "document",
            })
          }
          isDisabled={!file.downloadURL}
        >
          Download
        </Button>
      </CardBody>
    </Card>
  );
}

function AllImagesModal({
  isOpen,
  onOpenChange,
  files,
  sortMode,
  onSortChange,
  eventTitle,
  isCompactView,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  files: TeacherEventFileItem[];
  sortMode: FileSortMode;
  onSortChange: (mode: FileSortMode) => void;
  eventTitle: string;
  isCompactView: boolean;
}) {
  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size={isCompactView ? "full" : "5xl"}
      scrollBehavior="inside"
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <span className="text-xl font-semibold text-campus-text-primary">
                All Images
              </span>
              <span className="text-sm font-normal text-campus-text-secondary">
                {eventTitle
                  ? `${eventTitle} • ${files.length} image${files.length === 1 ? "" : "s"}`
                  : `${files.length} image${files.length === 1 ? "" : "s"}`}
              </span>
            </ModalHeader>

            <ModalBody className="space-y-5 pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-campus-text-secondary">
                  Browse all teacher-visible event images and download what you need.
                </p>
                <Select
                  aria-label="Sort images"
                  disallowEmptySelection
                  items={fileSortOptions}
                  selectedKeys={new Set([sortMode])}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const selected = Array.from(keys)[0];
                    if (typeof selected === "string") {
                      onSortChange(selected as FileSortMode);
                    }
                  }}
                  className="w-full sm:max-w-[240px]"
                >
                  {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
                </Select>
              </div>

              {files.length === 0 ? (
                <TeacherEmptyState
                  title="No images found"
                  description="Teacher-visible event images will appear here once uploaded."
                  icon={ImageIcon}
                  compact
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {files.map((file) => (
                    <ImagePreviewCard key={file.id} file={file} />
                  ))}
                </div>
              )}
            </ModalBody>

            <ModalFooter className="justify-end">
              <Button variant="bordered" onPress={onClose}>
                Close
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function AllDocumentsModal({
  isOpen,
  onOpenChange,
  files,
  totalCount,
  searchValue,
  onSearchValueChange,
  sortMode,
  onSortChange,
  eventTitle,
  isCompactView,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  files: TeacherEventFileItem[];
  totalCount: number;
  searchValue: string;
  onSearchValueChange: (value: string) => void;
  sortMode: FileSortMode;
  onSortChange: (mode: FileSortMode) => void;
  eventTitle: string;
  isCompactView: boolean;
}) {
  const hasSearch = Boolean(searchValue.trim());

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size={isCompactView ? "full" : "4xl"}
      scrollBehavior="inside"
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <span className="text-xl font-semibold text-campus-text-primary">
                All Documents
              </span>
              <span className="text-sm font-normal text-campus-text-secondary">
                {eventTitle
                  ? `${eventTitle} • ${totalCount} document${totalCount === 1 ? "" : "s"}`
                  : `${totalCount} document${totalCount === 1 ? "" : "s"}`}
              </span>
            </ModalHeader>

            <ModalBody className="space-y-5 pb-4">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                <Input
                  aria-label="Search documents"
                  value={searchValue}
                  onValueChange={onSearchValueChange}
                  placeholder="Search documents by filename"
                  startContent={<Search size={16} className="text-campus-text-secondary" />}
                />
                <Select
                  aria-label="Sort documents"
                  disallowEmptySelection
                  items={fileSortOptions}
                  selectedKeys={new Set([sortMode])}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const selected = Array.from(keys)[0];
                    if (typeof selected === "string") {
                      onSortChange(selected as FileSortMode);
                    }
                  }}
                >
                  {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
                </Select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-campus-text-secondary">
                  {hasSearch
                    ? `${files.length} of ${totalCount} documents match your search.`
                    : `${totalCount} document${totalCount === 1 ? "" : "s"} available for download.`}
                </p>
              </div>

              {files.length === 0 ? (
                <TeacherEmptyState
                  title={hasSearch ? "No matching documents" : "No documents found"}
                  description={
                    hasSearch
                      ? "Try a different filename search to find the document you need."
                      : "Teacher-visible event documents will appear here once uploaded."
                  }
                  icon={FileText}
                  compact
                />
              ) : (
                <div className="space-y-3">
                  {files.map((file) => (
                    <DocumentListItem key={file.id} file={file} />
                  ))}
                </div>
              )}
            </ModalBody>

            <ModalFooter className="justify-end">
              <Button variant="bordered" onPress={onClose}>
                Close
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
*/
