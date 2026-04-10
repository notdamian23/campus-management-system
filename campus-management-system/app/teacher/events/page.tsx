"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import { Tab, Tabs } from "@heroui/tabs";
import {
  CampusCardListSkeleton,
  CampusDataTable,
  type CampusTableColumn,
  CampusMetricSkeleton,
} from "@/components/ui";
import {
  type TeacherEvent,
  useTeacherPortal,
} from "@/components/teacher/TeacherPortalProvider";

const EVENTS_PER_PAGE = 6;

const teacherEventColumns: CampusTableColumn<TeacherEvent>[] = [
  { key: "title", label: "Event" },
  { key: "lifecycle", label: "Status" },
  { key: "date", label: "Schedule" },
  { key: "audience", label: "Audience" },
  { key: "summary", label: "Summary" },
  { key: "actions", label: "Actions", align: "end", className: "text-right" },
];

type EventTabKey = "overview" | "participants" | "files";

type SelectOption = {
  key: string;
  label: string;
};

function lifecycleChipClass(lifecycle: string) {
  if (lifecycle === "ongoing") {
    return "bg-amber-100 text-amber-700";
  }
  if (lifecycle === "completed") {
    return "bg-emerald-100 text-emerald-700";
  }
  return "bg-blue-100 text-blue-700";
}

function formatEventDate(date: Date | null, fallback: string) {
  if (!date) return fallback || "Date TBA";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function audienceLabel(event: {
  course: string;
  yearLevel: string;
  targetStudent: string;
}) {
  const pieces: string[] = [];
  if (event.course && event.course !== "All Courses") {
    pieces.push(event.course);
  }
  if (event.yearLevel && event.yearLevel !== "All Years") {
    pieces.push(event.yearLevel);
  }
  if (event.targetStudent) {
    pieces.push(`Specific students: ${event.targetStudent}`);
  }
  return pieces.length > 0 ? pieces.join(" | ") : "All students";
}

function downloadTeacherFile(url: string, name: string) {
  if (!url) return;

  const params = new URLSearchParams({
    url,
    name: name || "event-file",
  });
  const anchor = document.createElement("a");
  anchor.href = `/api/download?${params.toString()}`;
  anchor.download = name || "event-file";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export default function TeacherEventsPage() {
  const { attendance, events, files, loading, error } = useTeacherPortal();

  const [searchText, setSearchText] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<EventTabKey>("overview");

  const statusOptions: SelectOption[] = [
    { key: "__all_status__", label: "All Status" },
    { key: "upcoming", label: "Upcoming" },
    { key: "ongoing", label: "Ongoing" },
    { key: "completed", label: "Completed" },
  ];

  const filteredEvents = useMemo(() => {
    const search = searchText.trim().toLowerCase();

    return events.filter((event) => {
      const matchesSearch =
        !search ||
        event.title.toLowerCase().includes(search) ||
        event.location.toLowerCase().includes(search) ||
        event.course.toLowerCase().includes(search) ||
        event.yearLevel.toLowerCase().includes(search);
      const matchesStatus = statusFilter
        ? event.lifecycle === statusFilter
        : true;
      const matchesDate = dateFilter ? event.date === dateFilter : true;
      return matchesSearch && matchesStatus && matchesDate;
    });
  }, [dateFilter, events, searchText, statusFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredEvents.length / EVENTS_PER_PAGE),
  );

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

  const selectedDocuments = selectedFiles.filter(
    (file) => file.kind === "docs",
  );
  const selectedImages = selectedFiles.filter((file) => file.kind === "images");

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

  const upcomingCount = events.filter(
    (event) => event.lifecycle === "upcoming",
  ).length;
  const ongoingCount = events.filter(
    (event) => event.lifecycle === "ongoing",
  ).length;
  const completedCount = events.filter(
    (event) => event.lifecycle === "completed",
  ).length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <Card shadow="sm">
        <CardBody className="space-y-2 p-5 sm:p-6">
          <h1 className="text-2xl font-bold text-primary-900 sm:text-3xl">
            Event Tracking
          </h1>
          <p className="text-sm text-campus-text-secondary">
            Teachers can review live event schedules, participants, attendance,
            and uploaded files from the EC event workspace that teachers are
            allowed to access.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardBody>
      </Card>

      {loading ? (
        <CampusMetricSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Total Events"
            value={String(events.length)}
            tone="text-blue-700"
          />
          <MetricCard
            label="Upcoming"
            value={String(upcomingCount)}
            tone="text-cyan-700"
          />
          <MetricCard
            label="Ongoing"
            value={String(ongoingCount)}
            tone="text-amber-700"
          />
          <MetricCard
            label="Completed"
            value={String(completedCount)}
            tone="text-emerald-700"
          />
        </div>
      )}

      <Card shadow="sm">
        <CardBody className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            aria-label="Search events"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Search title, venue, or audience..."
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

          <div className="flex items-center justify-between rounded-xl border border-dashed border-border px-4 py-3 text-sm text-campus-text-secondary">
            <span>Visible events</span>
            <span className="font-semibold text-campus-text-primary">
              {loading ? "-" : filteredEvents.length}
            </span>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <CampusCardListSkeleton rows={4} />
      ) : (
        <CampusDataTable
          ariaLabel="Teacher event records"
          columns={teacherEventColumns}
          items={paginatedEvents}
          emptyTitle="No events match the current filters"
          emptyDescription="Try another search term, status, or date."
          renderCell={(event, columnKey) => {
            if (columnKey === "title") {
              return (
                <div className="space-y-1">
                  <p className="font-semibold text-campus-text-primary">
                    {event.title}
                  </p>
                  <p className="text-xs text-campus-text-secondary">
                    {event.location}
                  </p>
                </div>
              );
            }

            if (columnKey === "lifecycle") {
              return (
                <Chip size="sm" className={lifecycleChipClass(event.lifecycle)}>
                  {event.lifecycle}
                </Chip>
              );
            }

            if (columnKey === "date") {
              return formatEventDate(event.eventDate, event.date);
            }

            if (columnKey === "audience") {
              return (
                <span className="text-sm text-campus-text-secondary">
                  {audienceLabel(event)}
                </span>
              );
            }

            if (columnKey === "summary") {
              return (
                <div className="flex flex-wrap gap-2">
                  <Chip size="sm" className="bg-blue-100 text-blue-700">
                    Pre-Reg: {event.registrationCount}
                  </Chip>
                  <Chip size="sm" className="bg-emerald-100 text-emerald-700">
                    Present: {event.presentCount}
                  </Chip>
                  <Chip size="sm" className="bg-red-100 text-red-700">
                    Missed: {event.absentCount}
                  </Chip>
                  <Chip size="sm" className="bg-fuchsia-100 text-fuchsia-700">
                    Files: {event.documentCount + event.imageCount}
                  </Chip>
                </div>
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
                    Details
                  </Button>
                </div>
              );
            }

            return null;
          }}
        />
      )}

      {!loading && filteredEvents.length > EVENTS_PER_PAGE && (
        <div className="flex justify-center">
          <Pagination
            showControls
            page={page}
            total={totalPages}
            onChange={(nextPage) => setPage(nextPage)}
          />
        </div>
      )}

      <Modal
        isOpen={Boolean(selectedEvent)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEventId(null);
            setSelectedTab("overview");
          }
        }}
        size="5xl"
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
                    ? formatEventDate(
                        selectedEvent.eventDate,
                        selectedEvent.date,
                      )
                    : "-"}{" "}
                  | {selectedEvent?.location || "-"}
                </span>
              </ModalHeader>

              <ModalBody className="space-y-5 pb-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                  <MetricMini
                    label="Pre-Reg"
                    value={selectedEvent?.registrationCount ?? 0}
                    tone="text-blue-700"
                  />
                  <MetricMini
                    label="Present"
                    value={selectedEvent?.presentCount ?? 0}
                    tone="text-emerald-700"
                  />
                  <MetricMini
                    label="Missed"
                    value={selectedEvent?.absentCount ?? 0}
                    tone="text-red-700"
                  />
                  <MetricMini
                    label="Files"
                    value={
                      (selectedEvent?.documentCount ?? 0) +
                      (selectedEvent?.imageCount ?? 0)
                    }
                    tone="text-fuchsia-700"
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
                    <div className="grid grid-cols-1 gap-4 pt-2 lg:grid-cols-2">
                      <Card shadow="none" className="border">
                        <CardBody className="space-y-3 p-4">
                          <InfoRow
                            label="Audience"
                            value={
                              selectedEvent ? audienceLabel(selectedEvent) : "-"
                            }
                          />
                          <InfoRow
                            label="Schedule"
                            value={
                              selectedEvent
                                ? `${selectedEvent.scheduledTime}${
                                    selectedEvent.timeEnd
                                      ? ` to ${selectedEvent.timeEnd}`
                                      : ""
                                  }`
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

                      <Card shadow="none" className="border">
                        <CardBody className="space-y-3 p-4">
                          <p className="text-sm font-semibold text-campus-text-primary">
                            Event Details
                          </p>
                          <p className="text-sm text-campus-text-secondary">
                            {selectedEvent?.details ||
                              "No event description provided."}
                          </p>
                        </CardBody>
                      </Card>
                    </div>
                  </Tab>

                  <Tab key="participants" title="Participants">
                    <div className="space-y-3 pt-2">
                      {selectedParticipants.length === 0 ? (
                        <p className="text-sm text-campus-text-secondary">
                          No teacher-visible attendance records found for this
                          event.
                        </p>
                      ) : (
                        selectedParticipants.map((participant) => (
                          <Card
                            key={participant.uid}
                            shadow="none"
                            className="border"
                          >
                            <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                              <div className="min-w-0">
                                <p className="font-semibold text-campus-text-primary">
                                  {participant.studentName}
                                </p>
                                <p className="text-xs text-campus-text-secondary">
                                  {participant.schoolId} | {participant.course}{" "}
                                  | {participant.year}
                                </p>
                              </div>
                              <Chip
                                size="sm"
                                className={
                                  participant.attendanceStatus === "Present"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : participant.attendanceStatus === "Absent"
                                      ? "bg-red-100 text-red-700"
                                      : "bg-blue-100 text-blue-700"
                                }
                              >
                                {participant.attendanceStatus}
                              </Chip>
                            </CardBody>
                          </Card>
                        ))
                      )}
                    </div>
                  </Tab>

                  <Tab key="files" title="Files">
                    <div className="space-y-5 pt-2">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-semibold text-campus-text-primary">
                            Documents
                          </h3>
                          <Chip
                            size="sm"
                            className="bg-slate-100 text-slate-700"
                          >
                            {selectedDocuments.length}
                          </Chip>
                        </div>
                        {selectedDocuments.length === 0 ? (
                          <p className="text-sm text-campus-text-secondary">
                            No event documents uploaded yet.
                          </p>
                        ) : (
                          selectedDocuments.map((file) => (
                            <FileRow key={file.id} file={file} />
                          ))
                        )}
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                          <h3 className="font-semibold text-campus-text-primary">
                            Images
                          </h3>
                          <Chip
                            size="sm"
                            className="bg-slate-100 text-slate-700"
                          >
                            {selectedImages.length}
                          </Chip>
                        </div>
                        {selectedImages.length === 0 ? (
                          <p className="text-sm text-campus-text-secondary">
                            No event images uploaded yet.
                          </p>
                        ) : (
                          selectedImages.map((file) => (
                            <FileRow key={file.id} file={file} />
                          ))
                        )}
                      </div>
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

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Card shadow="sm">
      <CardBody className="p-5">
        <p className="text-sm text-campus-text-secondary">{label}</p>
        <h2 className={`mt-2 text-3xl font-bold ${tone}`}>{value}</h2>
      </CardBody>
    </Card>
  );
}

function MetricMini({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <Card shadow="none" className="border">
      <CardBody className="p-4">
        <p className="text-sm text-campus-text-secondary">{label}</p>
        <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
      </CardBody>
    </Card>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
        {label}
      </p>
      <p className="mt-1 text-sm text-campus-text-primary">{value}</p>
    </div>
  );
}

function FileRow({
  file,
}: {
  file: {
    id: string;
    name: string;
    kind: "docs" | "images";
    size: number;
    downloadURL: string;
  };
}) {
  return (
    <Card shadow="none" className="border">
      <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-campus-text-primary">{file.name}</p>
          <p className="text-xs text-campus-text-secondary">
            {file.kind === "images" ? "Image" : "Document"} |{" "}
            {(file.size / (1024 * 1024)).toFixed(2)} MB
          </p>
        </div>
        <Button
          size="sm"
          variant="flat"
          color="primary"
          onPress={() => downloadTeacherFile(file.downloadURL, file.name)}
          isDisabled={!file.downloadURL}
        >
          Download
        </Button>
      </CardBody>
    </Card>
  );
}
