"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
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
import { Tab, Tabs } from "@heroui/tabs";
import {
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
import { formatEventScheduleDisplay } from "@/lib/eventSchedule";
import { db } from "@/lib/firebase";
import { createEventDocumentDownloadUrl } from "@/lib/firebase-functions";
import { formatStudentFullName } from "@/lib/student-name";
import { campusToast } from "@/lib/toast";
import {
  TeacherDataTable,
  TeacherEmptyState,
  TeacherFilterBar,
  TeacherFilterBarSkeleton,
  TeacherActivityChipGroup,
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

const EVENTS_PER_PAGE = 6;
const FILE_PREVIEW_LIMIT = 3;
const PARTICIPANT_ROWS_PER_PAGE_OPTIONS = ["10", "25", "50"] as const;

const teacherEventColumns: CampusTableColumn<{
  id: string;
  title: string;
  location: string;
  lifecycle: "upcoming" | "ongoing" | "completed";
  schedule: string;
  audience: string;
  registrationCount: number;
  presentCount: number;
  absentCount: number;
  documentCount: number;
  imageCount: number;
}>[] = [
  { key: "event", label: "Event" },
  { key: "status", label: "Status" },
  { key: "schedule", label: "Schedule" },
  { key: "audience", label: "Audience" },
  { key: "summary", label: "Summary" },
  { key: "actions", label: "Actions", align: "end", className: "text-right" },
];

type EventTabKey = "overview" | "participants" | "files";
type EventFilesView = "images" | "documents";
type ParticipantStatusFilter = "all" | "Present" | "Absent";

type SelectOption = {
  key: string;
  label: string;
};

const participantStatusOptions: SelectOption[] = [
  { key: "all", label: "All" },
  { key: "Present", label: "Present" },
  { key: "Absent", label: "Absent" },
];

const participantCourseOptions: SelectOption[] = [
  { key: "all", label: "All Courses" },
  { key: "Computer Engineering", label: "Computer Engineering" },
  { key: "Industrial Engineering", label: "Industrial Engineering" },
  { key: "Electrical Engineering", label: "Electrical Engineering" },
  { key: "Mechanical Engineering", label: "Mechanical Engineering" },
  { key: "Electronics Engineering", label: "Electronics Engineering" },
];

const participantYearOptions: SelectOption[] = [
  { key: "all", label: "All Years" },
  { key: "1st Year", label: "1st Year" },
  { key: "2nd Year", label: "2nd Year" },
  { key: "3rd Year", label: "3rd Year" },
  { key: "4th Year", label: "4th Year" },
  { key: "5th Year", label: "5th Year" },
];

function csvCell(value: string | number) {
  const raw = String(value ?? "");
  if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
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

function formatExportDateTime(value: unknown) {
  const ms = toMillis(value);
  if (!ms) return "-";
  return new Date(ms).toLocaleString();
}

function normalizeParticipantStatus(value: string) {
  const normalized = String(value ?? "").trim().toLowerCase();

  if (normalized === "present") return "Present";
  if (normalized === "absent" || normalized === "missed") return "Absent";
  return "Recorded";
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
  const { attendance, events, files, loading, error } = useTeacherPortal();
  const isCompactView = useIsBelowBreakpoint(1024);

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
  const [participantsRowsPerPage, setParticipantsRowsPerPage] = useState<string>(
    PARTICIPANT_ROWS_PER_PAGE_OPTIONS[0],
  );
  const [filesView, setFilesView] = useState<EventFilesView>("images");
  const [imagesModalOpen, setImagesModalOpen] = useState(false);
  const [documentsModalOpen, setDocumentsModalOpen] = useState(false);

  const statusOptions: SelectOption[] = [
    { key: "__all_status__", label: "All status" },
    { key: "upcoming", label: "Upcoming" },
    { key: "ongoing", label: "Ongoing" },
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
  const selectedEventSchedule = useMemo(
    () => (selectedEvent ? getTeacherEventSchedule(selectedEvent) : null),
    [selectedEvent],
  );

  const selectedParticipants = useMemo(() => {
    if (!selectedEvent) return [];

    return attendance
      .filter((item) => item.eventId === selectedEvent.id)
      .map((item) => ({
        uid: item.uid,
        schoolId: item.schoolId || item.uid,
        studentName: item.studentName || item.schoolId || item.uid,
        course: item.course || "Unassigned",
        year: item.year || "Unassigned",
        attendanceStatus: normalizeParticipantStatus(item.status),
      }))
      .sort((a, b) => {
        const byName = a.studentName.localeCompare(b.studentName);
        if (byName !== 0) return byName;
        return a.schoolId.localeCompare(b.schoolId);
      });
  }, [attendance, selectedEvent]);

  const filteredParticipants = useMemo(() => {
    const search = participantsSearch.trim().toLowerCase();

    return selectedParticipants.filter((participant) => {
      const matchesSearch =
        !search ||
        participant.studentName.toLowerCase().includes(search) ||
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
          : participant.year === participantsYearFilter;

      return matchesSearch && matchesStatus && matchesCourse && matchesYear;
    });
  }, [
    participantsCourseFilter,
    participantsSearch,
    participantsStatusFilter,
    participantsYearFilter,
    selectedParticipants,
  ]);
  const participantsRowsPerPageValue = useMemo(() => {
    const value = Number(participantsRowsPerPage);
    return Number.isFinite(value) && value > 0 ?
        value :
        Number(PARTICIPANT_ROWS_PER_PAGE_OPTIONS[0]);
  }, [participantsRowsPerPage]);

  const participantsTotalPages = Math.max(
    1,
    Math.ceil(filteredParticipants.length / participantsRowsPerPageValue),
  );
  const paginatedParticipants = useMemo(() => {
    const start = (participantsPage - 1) * participantsRowsPerPageValue;
    return filteredParticipants.slice(start, start + participantsRowsPerPageValue);
  }, [filteredParticipants, participantsPage, participantsRowsPerPageValue]);

  const selectedFiles = useMemo(() => {
    if (!selectedEvent) return [];
    return files
      .filter((file) => file.eventId === selectedEvent.id)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [files, selectedEvent]);

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
      setSelectedTab("overview");
    }
  }, [selectedEvent]);

  useEffect(() => {
    setParticipantsPage(1);
  }, [
    participantsCourseFilter,
    participantsRowsPerPage,
    participantsSearch,
    participantsStatusFilter,
    participantsYearFilter,
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
    setParticipantsRowsPerPage(PARTICIPANT_ROWS_PER_PAGE_OPTIONS[0]);
    setFilesView("images");
    setImagesModalOpen(false);
    setDocumentsModalOpen(false);
  }, [selectedEvent?.id]);

  const exportEventAttendanceCSV = async (
    ev: (typeof events)[number],
  ) => {
    setExportingEventId(ev.id);

    try {
      const attendanceSnap = await getDocs(collection(db, "events", ev.id, "attendance"));

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
          deviceTimestampIso?: string;
          createdAt?: unknown;
          updatedAt?: unknown;
        };

        const uid = String(data.uid ?? data.studentUid ?? docSnap.id).trim();
        if (!uid) return;

        const existing = rowsByUid.get(uid);
        const fallbackStatus =
          typeof data.present === "boolean"
            ? data.present
              ? "Present"
              : "Absent"
            : "";
        const timeInValue = formatExportDateTime(
          data.timeInIso ||
            data.timeIn ||
            data.timestamp ||
            data.deviceTimestampIso ||
            data.updatedAt ||
            data.createdAt,
        );
        const timeOutValue = formatExportDateTime(data.timeOutIso || data.timeOut);
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
          studentName: formatStudentFullName(
            {
              studentName: data.studentName ?? existing?.studentName,
              name: data.name,
              schoolId: data.schoolId ?? existing?.schoolId,
            },
            String(data.schoolId ?? existing?.schoolId ?? ""),
          ),
          course: String(data.course ?? existing?.course ?? ""),
          year: String(data.yearLevel ?? data.year ?? existing?.year ?? ""),
          attendanceStatus: status,
          attendanceTimeIn:
            timeInValue !== "-" ? timeInValue : (existing?.attendanceTimeIn ?? "-"),
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
        campusToast.warning({
          title: "No attendance to export",
          description: "No teacher-visible attendance records were found for this event.",
          dedupeKey: `teacher-event-export-empty:${ev.id}`,
        });
        return;
      }

      const csvLines = [
        `Event Title,${csvCell(ev.title)}`,
        `Date,${csvCell(ev.date)}`,
        `Scheduled Time Start,${csvCell(ev.scheduledTime || "-")}`,
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
      const anchor = document.createElement("a");
      const slug = (ev.title || ev.id)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      anchor.href = url;
      anchor.download = `${slug || ev.id}-attendance.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      campusToast.success({
        title: "Attendance exported",
        description: `Exported ${rows.length} row(s) for "${ev.title}".`,
        dedupeKey: `teacher-event-export-success:${ev.id}:${rows.length}`,
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
            registrationCount: event.registrationCount,
            presentCount: event.presentCount,
            absentCount: event.absentCount,
            documentCount: event.documentCount,
            imageCount: event.imageCount,
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
              <p className="max-w-xs text-sm leading-6 text-campus-text-secondary">
                {event.audience}
              </p>
            );
          }

          if (columnKey === "summary") {
            return (
              <TeacherActivityChipGroup
                items={[
                  { label: "Pre-Reg", value: event.registrationCount, tone: "blue" },
                  { label: "Present", value: event.presentCount, tone: "green" },
                  { label: "Missed", value: event.absentCount, tone: "red" },
                  {
                    label: "Files",
                    value: event.documentCount + event.imageCount,
                    tone: "purple",
                  },
                ]}
              />
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
                <span className="text-xl font-semibold text-campus-text-primary">
                  {selectedEvent?.title || "Event details"}
                </span>
                <span className="text-sm font-normal text-campus-text-secondary">
                  {selectedEvent
                    ? `${selectedEventSchedule?.scheduleLabel ?? "Date TBA | Time TBA"} | ${selectedEvent.location}`
                    : "-"}
                </span>
              </ModalHeader>

              <ModalBody className="space-y-5 pb-6">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <EventDetailStat
                    label="Pre-Reg"
                    value={selectedEvent?.registrationCount ?? 0}
                    tone="blue"
                  />
                  <EventDetailStat
                    label="Present"
                    value={selectedEvent?.presentCount ?? 0}
                    tone="green"
                  />
                  <EventDetailStat
                    label="Missed"
                    value={selectedEvent?.absentCount ?? 0}
                    tone="red"
                  />
                  <EventDetailStat
                    label="Files"
                    value={
                      (selectedEvent?.documentCount ?? 0) +
                      (selectedEvent?.imageCount ?? 0)
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
                            value={selectedEvent ? teacherAudienceLabel(selectedEvent) : "-"}
                          />
                          <EventDetailInfoRow
                            label="Schedule"
                            value={selectedEventSchedule?.scheduleLabel ?? "-"}
                          />
                          <EventDetailInfoRow
                            label="Status"
                            value={
                              selectedEvent
                                ? capitalizeTeacherLabel(selectedEvent.lifecycle)
                                : "-"
                            }
                          />
                          <EventDetailInfoRow
                            label="Payment linked"
                            value={selectedEvent?.withPayment ? "Yes" : "No"}
                          />
                          <EventDetailInfoRow
                            label="Pre-registration"
                            value={
                              selectedEvent?.isPreReg
                                ? `Enabled${
                                    selectedEvent.preRegSlots
                                      ? ` (${selectedEvent.preRegSlots} slots)`
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
                            {selectedEvent?.details || "No event description provided."}
                          </p>
                        </CardBody>
                      </Card>
                    </div>
                  </Tab>

                  <Tab key="participants" title="Participants">
                    <div className="space-y-4 pt-3">
                      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_180px_230px_180px_150px]">
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

                        <Select
                          aria-label="Participant rows per page"
                          disallowEmptySelection
                          selectedKeys={new Set([participantsRowsPerPage])}
                          onSelectionChange={(keys) => {
                            if (keys === "all") return;
                            const selected = Array.from(keys)[0];
                            if (typeof selected === "string") {
                              setParticipantsRowsPerPage(selected);
                            }
                          }}
                        >
                          {PARTICIPANT_ROWS_PER_PAGE_OPTIONS.map((value) => (
                            <SelectItem key={value}>{value} / page</SelectItem>
                          ))}
                        </Select>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip size="sm" className="bg-slate-100 text-slate-700">
                            {filteredParticipants.length === selectedParticipants.length
                              ? `${filteredParticipants.length} participant${filteredParticipants.length === 1 ? "" : "s"}`
                              : `${filteredParticipants.length} of ${selectedParticipants.length} participant${selectedParticipants.length === 1 ? "" : "s"}`}
                          </Chip>
                        </div>

                        <Button
                          color="primary"
                          variant="flat"
                          startContent={<Download size={16} />}
                          onPress={() => {
                            if (!selectedEvent) return;
                            void exportEventAttendanceCSV(selectedEvent);
                          }}
                          isDisabled={
                            !selectedEvent || exportingEventId === selectedEvent.id
                          }
                          isLoading={exportingEventId === selectedEvent?.id}
                        >
                          {exportingEventId === selectedEvent?.id
                            ? "Exporting..."
                            : "Export Attendance CSV"}
                        </Button>
                      </div>

                      {selectedParticipants.length === 0 ? (
                        <TeacherEmptyState
                          title="No participants found"
                          description="No teacher-visible attendance records are connected to this event yet."
                          icon={CheckCircle2}
                          compact
                        />
                      ) : filteredParticipants.length === 0 ? (
                        <TeacherEmptyState
                          title="No participants found"
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
                              key={`${participant.uid}-${participant.attendanceStatus}`}
                              shadow="none"
                              className="border border-border/70 bg-slate-50/70"
                            >
                              <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                  <p className="font-semibold text-campus-text-primary">
                                    {participant.studentName}
                                  </p>
                                  <p className="text-xs text-campus-text-secondary">
                                    {participant.schoolId} | {participant.course} | {participant.year}
                                  </p>
                                </div>
                                <Chip size="sm" className={toneClasses.chip}>
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
