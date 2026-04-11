"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, getDocs } from "firebase/firestore";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/modal";
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
import type { CampusTableColumn } from "@/components/ui";
import { CampusMetricSkeleton } from "@/components/ui";
import { db } from "@/lib/firebase";
import { campusToast } from "@/lib/toast";
import {
  TeacherActivityChipGroup,
  TeacherDataTable,
  TeacherEmptyState,
  TeacherFilterBar,
  TeacherFilterBarSkeleton,
  TeacherPageHeader,
  TeacherStatsGrid,
  capitalizeTeacherLabel,
  downloadTeacherFile,
  formatTeacherBytes,
  formatTeacherEventDate,
  formatTeacherSchedule,
  getTeacherLifecycleTone,
  getTeacherToneClasses,
  teacherAudienceLabel,
  teacherFileKindLabel,
  useIsBelowBreakpoint,
  useTeacherPageErrorToast,
  useTeacherPortal,
} from "@/components/teacher";

const EVENTS_PER_PAGE = 6;

const teacherEventColumns: CampusTableColumn<{
  id: string;
  title: string;
  location: string;
  lifecycle: "upcoming" | "ongoing" | "completed";
  date: string;
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

type SelectOption = {
  key: string;
  label: string;
};

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
        attendanceStatus: item.status,
      }))
      .sort((a, b) => {
        const byName = a.studentName.localeCompare(b.studentName);
        if (byName !== 0) return byName;
        return a.schoolId.localeCompare(b.schoolId);
      });
  }, [attendance, selectedEvent]);

  const selectedFiles = useMemo(() => {
    if (!selectedEvent) return [];
    return files
      .filter((file) => file.eventId === selectedEvent.id)
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [files, selectedEvent]);

  const selectedDocuments = selectedFiles.filter((file) => file.kind === "docs");
  const selectedImages = selectedFiles.filter((file) => file.kind === "images");

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
          studentName: String(
            data.studentName ?? data.name ?? existing?.studentName ?? "",
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
        items={paginatedEvents.map((event) => ({
          id: event.id,
          title: event.title,
          location: event.location,
          lifecycle: event.lifecycle,
          date: formatTeacherEventDate(event.eventDate, event.date),
          audience: teacherAudienceLabel(event),
          registrationCount: event.registrationCount,
          presentCount: event.presentCount,
          absentCount: event.absentCount,
          documentCount: event.documentCount,
          imageCount: event.imageCount,
        }))}
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
                  {event.date}
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
                    ? `${formatTeacherEventDate(
                        selectedEvent.eventDate,
                        selectedEvent.date,
                      )} • ${selectedEvent.location}`
                    : "-"}
                </span>
              </ModalHeader>

              <ModalBody className="space-y-5 pb-6">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <ModalStat label="Pre-Reg" value={selectedEvent?.registrationCount ?? 0} tone="blue" />
                  <ModalStat label="Present" value={selectedEvent?.presentCount ?? 0} tone="green" />
                  <ModalStat label="Missed" value={selectedEvent?.absentCount ?? 0} tone="red" />
                  <ModalStat
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
                  classNames={{
                    tabList: "w-full grid grid-cols-3",
                    tab: "w-full min-w-0 px-2",
                    tabContent: "truncate text-xs sm:text-sm",
                  }}
                >
                  <Tab key="overview" title="Overview">
                    <div className="grid grid-cols-1 gap-4 pt-3 lg:grid-cols-2">
                      <Card shadow="none" className="border border-border/70 bg-slate-50/70">
                        <CardBody className="space-y-4 p-4">
                          <InfoRow
                            label="Audience"
                            value={selectedEvent ? teacherAudienceLabel(selectedEvent) : "-"}
                          />
                          <InfoRow
                            label="Schedule"
                            value={selectedEvent ? formatTeacherSchedule(selectedEvent) : "-"}
                          />
                          <InfoRow
                            label="Status"
                            value={
                              selectedEvent
                                ? capitalizeTeacherLabel(selectedEvent.lifecycle)
                                : "-"
                            }
                          />
                          <InfoRow
                            label="Payment linked"
                            value={selectedEvent?.withPayment ? "Yes" : "No"}
                          />
                          <InfoRow
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
                    <div className="space-y-3 pt-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex items-center gap-2">
                          <Chip size="sm" className="bg-slate-100 text-slate-700">
                            {selectedParticipants.length} participant
                            {selectedParticipants.length === 1 ? "" : "s"}
                          </Chip>
                          <p className="text-xs text-campus-text-secondary">
                            Export teacher-visible attendance to CSV.
                          </p>
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
                      ) : (
                        selectedParticipants.map((participant) => {
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
                                    {participant.schoolId} • {participant.course} • {participant.year}
                                  </p>
                                </div>
                                <Chip size="sm" className={toneClasses.chip}>
                                  {participant.attendanceStatus}
                                </Chip>
                              </CardBody>
                            </Card>
                          );
                        })
                      )}
                    </div>
                  </Tab>

                  <Tab key="files" title="Files">
                    <div className="space-y-5 pt-3">
                      <FileSection
                        title="Documents"
                        emptyTitle="No event documents yet"
                        emptyDescription="Teacher-visible event documents will appear here once uploaded."
                        files={selectedDocuments}
                      />
                      <FileSection
                        title="Images"
                        emptyTitle="No event images yet"
                        emptyDescription="Teacher-visible photo documentation will appear here once uploaded."
                        files={selectedImages}
                      />
                    </div>
                  </Tab>
                </Tabs>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}

function ModalStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "blue" | "green" | "red" | "purple";
}) {
  const toneClasses = getTeacherToneClasses(tone);

  return (
    <Card shadow="none" className="border border-border/70 bg-slate-50/70">
      <CardBody className="p-4">
        <p className="text-sm text-campus-text-secondary">{label}</p>
        <p className={`mt-2 text-2xl font-bold ${toneClasses.value}`}>{value}</p>
      </CardBody>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
        {label}
      </p>
      <p className="mt-1 text-sm leading-6 text-campus-text-primary">{value}</p>
    </div>
  );
}

function FileSection({
  title,
  emptyTitle,
  emptyDescription,
  files,
}: {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  files: Array<{
    id: string;
    name: string;
    kind: "docs" | "images";
    size: number;
    downloadURL: string;
  }>;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-campus-text-primary">{title}</h3>
        <Chip size="sm" className="bg-slate-100 text-slate-700">
          {files.length}
        </Chip>
      </div>

      {files.length === 0 ? (
        <TeacherEmptyState
          title={emptyTitle}
          description={emptyDescription}
          icon={FileStack}
          compact
        />
      ) : (
        files.map((file) => (
          <Card
            key={file.id}
            shadow="none"
            className="border border-border/70 bg-slate-50/70"
          >
            <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate font-semibold text-campus-text-primary">
                  {file.name}
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Chip
                    size="sm"
                    className={
                      file.kind === "images"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-blue-100 text-blue-700"
                    }
                  >
                    {teacherFileKindLabel(file.kind)}
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
                onPress={() =>
                  downloadTeacherFile({
                    url: file.downloadURL,
                    name: file.name,
                    sourceLabel: teacherFileKindLabel(file.kind).toLowerCase(),
                  })
                }
                isDisabled={!file.downloadURL}
              >
                Download
              </Button>
            </CardBody>
          </Card>
        ))
      )}
    </div>
  );
}
