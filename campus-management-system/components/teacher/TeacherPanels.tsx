"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
} from "@heroui/drawer";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import { ScrollShadow } from "@heroui/scroll-shadow";
import { Select, SelectItem } from "@heroui/select";
import { Tab, Tabs } from "@heroui/tabs";
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  FolderKanban,
  GraduationCap,
  School,
  Search,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { CampusDetailTile } from "@/components/ui";
import { formatEventScheduleDisplay } from "@/lib/eventSchedule";
import type {
  TeacherAttendanceStatus,
  TeacherEvent,
  TeacherStudent,
} from "./TeacherPortalProvider";
import { TeacherEmptyState } from "./TeacherShared";
import {
  capitalizeTeacherLabel,
  formatTeacherDateTime,
  getTeacherAttendanceTone,
  getTeacherLifecycleTone,
  getTeacherToneClasses,
} from "./teacher-helpers";

type StudentAttendanceItem = {
  event: TeacherEvent;
  status: TeacherAttendanceStatus;
  updatedAtMs: number;
};

type StudentVisibleEventItem = {
  event: TeacherEvent;
  outcome: StudentVisibleEventOutcome;
  timeIn: string;
  timeOut: string;
  updatedAtMs: number;
};

type StudentActivityTab = "profile" | "attendance" | "events";
type StudentVisibleEventOutcome =
  | "Present"
  | "Timed In"
  | "Missed"
  | "Upcoming";
type VisibleEventsOutcomeFilter =
  | "all"
  | "present"
  | "timed_in"
  | "missed"
  | "upcoming";

type TeacherStudentDetailProps = {
  student: TeacherStudent | null;
  trackedEvents: StudentVisibleEventItem[];
  attendanceItems: StudentAttendanceItem[];
  attendancePagination?: ReactNode;
  eventsPagination?: ReactNode;
  className?: string;
};

type TeacherStudentActivityModalProps = TeacherStudentDetailProps & {
  activeTab: StudentActivityTab;
  onActiveTabChange: (tab: StudentActivityTab) => void;
  hasVisibleEvents: boolean;
  visibleEventsSearch: string;
  onVisibleEventsSearchChange: (value: string) => void;
  visibleEventsOutcomeFilter: VisibleEventsOutcomeFilter;
  onVisibleEventsOutcomeFilterChange: (
    filter: VisibleEventsOutcomeFilter,
  ) => void;
  isMobile: boolean;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
};

const studentActivityTabsClassNames = {
  tabList: "grid w-full grid-cols-3 rounded-2xl bg-slate-100 p-1",
  cursor: "rounded-[14px] bg-white shadow-sm",
  tab: "min-h-11 w-full min-w-0 rounded-[14px] px-2",
  tabContent: "truncate text-xs font-medium sm:text-sm",
};

const visibleEventOutcomeOptions: Array<{
  key: VisibleEventsOutcomeFilter;
  label: string;
}> = [
  { key: "all", label: "All" },
  { key: "present", label: "Present" },
  { key: "timed_in", label: "Timed In" },
  { key: "missed", label: "Missed" },
  { key: "upcoming", label: "Upcoming" },
];

function isStudentActivityTab(value: string): value is StudentActivityTab {
  return value === "profile" || value === "attendance" || value === "events";
}

function isVisibleEventsOutcomeFilter(
  value: string,
): value is VisibleEventsOutcomeFilter {
  return (
    value === "all" ||
    value === "present" ||
    value === "timed_in" ||
    value === "missed" ||
    value === "upcoming"
  );
}

function getTeacherEventSchedule(
  event: Pick<TeacherEvent, "date" | "eventDate" | "scheduledTime" | "timeEnd">,
) {
  return formatEventScheduleDisplay({
    date: event.eventDate ?? event.date,
    scheduledTime: event.scheduledTime,
    timeEnd: event.timeEnd,
  });
}

export function TeacherStudentDetailPanel({
  student,
  trackedEvents,
  attendanceItems,
  attendancePagination,
  eventsPagination,
  className,
}: TeacherStudentDetailProps) {
  return (
    <Card
      shadow="none"
      className={clsx(
        "border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <CardBody className="p-0">
        <TeacherStudentDetailContent
          student={student}
          trackedEvents={trackedEvents}
          attendanceItems={attendanceItems}
          attendancePagination={attendancePagination}
          eventsPagination={eventsPagination}
        />
      </CardBody>
    </Card>
  );
}

export function TeacherStudentDrawer({
  student,
  trackedEvents,
  attendanceItems,
  attendancePagination,
  eventsPagination,
  isOpen,
  onOpenChange,
}: TeacherStudentDetailProps & {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer
      isOpen={isOpen && Boolean(student)}
      onOpenChange={onOpenChange}
      placement="bottom"
      className="xl:hidden"
    >
      <DrawerContent className="max-h-[92dvh]">
        {(onClose) => (
          <>
            <DrawerHeader className="border-b border-border/70">
              <div className="space-y-1">
                <p className="text-lg font-semibold text-campus-text-primary">
                  {student?.studentName || "Student details"}
                </p>
                <p className="text-sm text-campus-text-secondary">
                  Review attendance and tracked event activity.
                </p>
              </div>
            </DrawerHeader>
            <DrawerBody className="p-0">
              <ScrollShadow className="max-h-[calc(92dvh-80px)]">
                <TeacherStudentDetailContent
                  student={student}
                  trackedEvents={trackedEvents}
                  attendanceItems={attendanceItems}
                  attendancePagination={attendancePagination}
                  eventsPagination={eventsPagination}
                />
              </ScrollShadow>
              <div className="border-t border-border/70 p-4">
                <Button className="w-full" variant="flat" onPress={onClose}>
                  Close
                </Button>
              </div>
            </DrawerBody>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

export function TeacherStudentActivityModal({
  student,
  trackedEvents,
  attendanceItems,
  activeTab,
  onActiveTabChange,
  hasVisibleEvents,
  visibleEventsSearch,
  onVisibleEventsSearchChange,
  visibleEventsOutcomeFilter,
  onVisibleEventsOutcomeFilterChange,
  attendancePagination,
  eventsPagination,
  isMobile,
  isOpen,
  onOpenChange,
}: TeacherStudentActivityModalProps) {
  return (
    <Modal
      isOpen={isOpen && Boolean(student)}
      onOpenChange={onOpenChange}
      scrollBehavior="inside"
      size={isMobile ? "full" : "5xl"}
    >
      <ModalContent className="sm:max-w-[1080px]">
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1 border-b border-border/70">
              <p className="text-lg font-semibold text-campus-text-primary">
                Student Activity
              </p>
              <p className="text-sm font-normal text-campus-text-secondary">
                {student?.studentName || "Review teacher-visible activity"}
              </p>
            </ModalHeader>
            <ModalBody className="space-y-5 p-5">
              <Tabs
                aria-label="Student activity sections"
                selectedKey={activeTab}
                onSelectionChange={(key) => {
                  const nextTab = String(key);
                  if (isStudentActivityTab(nextTab)) {
                    onActiveTabChange(nextTab);
                  }
                }}
                fullWidth
                classNames={studentActivityTabsClassNames}
              >
                <Tab key="profile" title="Profile">
                  <div className="pt-3">
                    {student ? <StudentProfileSection student={student} /> : null}
                  </div>
                </Tab>

                <Tab key="attendance" title="Recent Attendance">
                  <div className="pt-3">
                    <StudentAttendanceSection
                      attendanceItems={attendanceItems}
                      attendancePagination={attendancePagination}
                    />
                  </div>
                </Tab>

                <Tab key="events" title="Events">
                  <div className="space-y-4 pt-3">
                    <div className="space-y-3">
                      <SectionHeading
                        title="Events"
                        description="Search and filter this student's teacher-visible events."
                      />
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_190px]">
                        <Input
                          aria-label="Search event name"
                          value={visibleEventsSearch}
                          onValueChange={onVisibleEventsSearchChange}
                          placeholder="Search event name..."
                          startContent={
                            <Search
                              size={16}
                              className="text-campus-text-secondary"
                            />
                          }
                        />
                        <Select
                          aria-label="Filter events by status"
                          disallowEmptySelection
                          items={visibleEventOutcomeOptions}
                          selectedKeys={new Set([visibleEventsOutcomeFilter])}
                          onSelectionChange={(keys) => {
                            if (keys === "all") return;
                            const selected = Array.from(keys)[0];
                            if (
                              typeof selected === "string" &&
                              isVisibleEventsOutcomeFilter(selected)
                            ) {
                              onVisibleEventsOutcomeFilterChange(selected);
                            }
                          }}
                          className="w-full"
                        >
                          {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
                        </Select>
                      </div>
                    </div>

                    <StudentEventsSection
                      trackedEvents={trackedEvents}
                      eventsPagination={eventsPagination}
                      hasVisibleEvents={hasVisibleEvents}
                    />
                  </div>
                </Tab>
              </Tabs>
            </ModalBody>
            <ModalFooter className="border-t border-border/70">
              <Button variant="flat" onPress={onClose}>
                Close
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function TeacherStudentDetailContent({
  student,
  trackedEvents,
  attendanceItems,
  attendancePagination,
  eventsPagination,
}: TeacherStudentDetailProps) {
  if (!student) {
    return (
      <div className="p-5">
        <TeacherEmptyState
          title="Select a student to review"
          description="Choose any student row to open their attendance summary, recent activity, and teacher-visible events."
          icon={UserRound}
          compact
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5">
      <StudentProfileSection student={student} />
      <StudentAttendanceSection
        attendanceItems={attendanceItems}
        attendancePagination={attendancePagination}
      />
      <StudentEventsSection
        trackedEvents={trackedEvents}
        eventsPagination={eventsPagination}
        hasVisibleEvents={trackedEvents.length > 0}
      />
    </div>
  );
}

function StudentProfileSection({ student }: { student: TeacherStudent }) {
  return (
    <section className="space-y-4">
      <div className="flex items-start gap-3 rounded-[24px] border border-border/70 bg-slate-50/70 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
          <UserRound size={18} />
        </div>
        <div className="min-w-0">
          <p className="text-lg font-semibold text-campus-text-primary">
            {student.studentName}
          </p>
          <p className="text-sm text-campus-text-secondary">
            {student.schoolId}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MiniInfoCard icon={School} label="School ID" value={student.schoolId} />
        <MiniInfoCard
          icon={GraduationCap}
          label="Course"
          value={student.course}
        />
        <MiniInfoCard icon={School} label="Year" value={student.year} />
      </div>

    </section>
  );
}

function StudentAttendanceSection({
  attendanceItems,
  attendancePagination,
}: {
  attendanceItems: StudentAttendanceItem[];
  attendancePagination?: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Recent attendance"
        description="Latest teacher-visible attendance outcomes."
      />
      {attendanceItems.length === 0 ? (
        <TeacherEmptyState
          title="No attendance history yet"
          description="This student has no teacher-visible attendance records right now."
          icon={CheckCircle2}
          tone="green"
          compact
        />
      ) : (
        <div className="space-y-3">
          {attendanceItems.map((item) => {
            const toneClasses = getTeacherToneClasses(
              getTeacherAttendanceTone(item.status),
            );
            const StatusIcon =
              item.status === "Absent" ? TriangleAlert : CheckCircle2;
            const schedule = getTeacherEventSchedule(item.event);

            return (
              <Card
                key={`${item.event.id}-${item.status}-${item.updatedAtMs}`}
                shadow="none"
                className="border border-border/70 bg-slate-50/70"
              >
                <CardBody className="gap-3 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-campus-text-primary">
                        {item.event.title}
                      </p>
                      <p className="text-sm text-campus-text-secondary">
                        {schedule.scheduleLabel}
                      </p>
                      <p className="text-xs text-campus-text-secondary">
                        {item.event.location}
                      </p>
                    </div>
                    <Chip size="sm" className={toneClasses.chip}>
                      <span className="inline-flex items-center gap-1.5">
                        <StatusIcon size={14} />
                        {item.status}
                      </span>
                    </Chip>
                  </div>
                  <p className="text-xs text-campus-text-secondary">
                    Updated {formatTeacherDateTime(item.updatedAtMs)}
                  </p>
                </CardBody>
              </Card>
            );
          })}
          {attendancePagination}
        </div>
      )}
    </section>
  );
}

function StudentEventsSection({
  trackedEvents,
  eventsPagination,
  hasVisibleEvents,
}: {
  trackedEvents: StudentVisibleEventItem[];
  eventsPagination?: ReactNode;
  hasVisibleEvents: boolean;
}) {
  if (!hasVisibleEvents) {
    return (
      <TeacherEmptyState
        title="No events found for this student."
        icon={FolderKanban}
        compact
      />
    );
  }

  if (trackedEvents.length === 0) {
    return (
      <TeacherEmptyState
        title="No events match the selected filters."
        icon={FolderKanban}
        compact
      />
    );
  }

  return (
    <div className="space-y-3">
      {trackedEvents.map((item) => {
        const event = item.event;
        const lifecycleClasses = getTeacherToneClasses(
          getTeacherLifecycleTone(event.lifecycle),
        );
        const outcomeTone =
          item.outcome === "Present"
            ? "green"
            : item.outcome === "Timed In"
              ? "amber"
              : item.outcome === "Missed"
                ? "red"
                : "blue";
        const outcomeClasses = getTeacherToneClasses(outcomeTone);
        const StatusIcon =
          item.outcome === "Missed"
            ? TriangleAlert
            : item.outcome === "Upcoming"
              ? FolderKanban
              : CheckCircle2;
        const schedule = getTeacherEventSchedule(event);

        return (
          <Card
            key={event.id}
            shadow="none"
            className="border border-border/70 bg-slate-50/70"
          >
            <CardBody className="gap-3 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 font-semibold text-campus-text-primary">
                    {event.title}
                  </p>
                  <p className="mt-1 text-sm text-campus-text-secondary">
                    {schedule.scheduleLabel}
                  </p>
                  <p className="truncate text-xs text-campus-text-secondary">
                    {event.location}
                  </p>
                  <p className="mt-1 truncate text-xs text-campus-text-secondary">
                    Time in: {item.timeIn} | Time out: {item.timeOut}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  <Chip size="sm" className={outcomeClasses.chip}>
                    <span className="inline-flex items-center gap-1.5">
                      <StatusIcon size={14} />
                      {item.outcome}
                    </span>
                  </Chip>
                  <Chip size="sm" className={lifecycleClasses.chip}>
                    {capitalizeTeacherLabel(event.lifecycle)}
                  </Chip>
                </div>
              </div>
            </CardBody>
          </Card>
        );
      })}
      {eventsPagination}
    </div>
  );
}

function MiniInfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return <CampusDetailTile icon={Icon} label={label} value={value} />;
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-campus-text-primary">{title}</p>
      <p className="text-xs leading-5 text-campus-text-secondary">
        {description}
      </p>
    </div>
  );
}
