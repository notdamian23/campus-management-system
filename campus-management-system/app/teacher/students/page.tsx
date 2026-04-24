"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import {
  ClipboardCheck,
  GraduationCap,
  Search,
  TriangleAlert,
  Users,
} from "lucide-react";
import type { CampusTableColumn } from "@/components/ui";
import {
  TeacherDataTable,
  TeacherFilterBar,
  TeacherFilterBarSkeleton,
  TeacherPageHeader,
  TeacherStatsGrid,
  TeacherStudentActivityModal,
  useIsBelowBreakpoint,
  useTeacherPageErrorToast,
  useTeacherPortal,
} from "@/components/teacher";
import { CampusMetricSkeleton } from "@/components/ui";
import {
  buildAttendanceParticipantRows,
  type AttendanceExportAttendanceDoc,
  type AttendanceExportEvent,
  type AttendanceExportStudent,
  type AttendanceParticipantStatus,
} from "@/lib/attendance-export";
import type {
  TeacherEvent,
  TeacherStudent,
} from "@/components/teacher/TeacherPortalProvider";

const STUDENTS_PER_PAGE = 8;
const RECENT_ATTENDANCE_PER_PAGE = 4;
const VISIBLE_EVENTS_PER_PAGE = 4;

type StudentActivityTab = "profile" | "attendance" | "events";
type VisibleEventsOutcomeFilter =
  | "all"
  | "present"
  | "timed_in"
  | "missed"
  | "upcoming";
type StudentEventOutcome = "Present" | "Timed In" | "Missed" | "Upcoming";

type TeacherStudentRow = {
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
};

const teacherStudentColumns: CampusTableColumn<TeacherStudentRow>[] = [
  { key: "student", label: "Student" },
  { key: "course", label: "Course" },
  { key: "year", label: "Year" },
  { key: "actions", label: "Actions", align: "end", className: "text-right" },
];

type SelectOption = {
  key: string;
  label: string;
};

type PaginatedView<T> = {
  items: T[];
  page: number;
  totalPages: number;
  totalItems: number;
  startItem: number;
  endItem: number;
};

function getTotalPages(totalItems: number, pageSize: number) {
  return Math.max(1, Math.ceil(totalItems / pageSize));
}

function clampPage(page: number, totalPages: number) {
  return Math.min(Math.max(page, 1), totalPages);
}

function getPageSlice(totalItems: number, page: number, pageSize: number) {
  const totalPages = getTotalPages(totalItems, pageSize);
  const safePage = clampPage(page, totalPages);
  const startIndex = (safePage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);

  return {
    endIndex,
    endItem: endIndex,
    page: safePage,
    startIndex,
    startItem: totalItems === 0 ? 0 : startIndex + 1,
    totalPages,
  };
}

function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): PaginatedView<T> {
  const pageSlice = getPageSlice(items.length, page, pageSize);

  return {
    ...pageSlice,
    items: items.slice(pageSlice.startIndex, pageSlice.endIndex),
    totalItems: items.length,
  };
}

type TeacherPaginationControlsProps = {
  ariaLabel: string;
  itemLabel: string;
  page: number;
  totalPages: number;
  totalItems: number;
  startItem: number;
  endItem: number;
  onPageChange: (page: number) => void;
  showWhenSinglePage?: boolean;
};

function TeacherPaginationControls({
  ariaLabel,
  itemLabel,
  page,
  totalPages,
  totalItems,
  startItem,
  endItem,
  onPageChange,
  showWhenSinglePage = false,
}: TeacherPaginationControlsProps) {
  if (totalItems === 0 || (totalPages <= 1 && !showWhenSinglePage)) return null;

  return (
    <div className="flex flex-col gap-3 rounded-[22px] border border-border/70 bg-white/90 px-3 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs font-medium text-campus-text-secondary">
        Showing {startItem}-{endItem} of {totalItems} {itemLabel}
      </p>
      <div className="flex w-full justify-center sm:w-auto sm:justify-end">
        <Pagination
          showControls
          aria-label={`${ariaLabel} pagination`}
          page={page}
          total={totalPages}
          onChange={onPageChange}
          classNames={{
            wrapper: "max-w-full flex-wrap justify-center",
          }}
        />
      </div>
    </div>
  );
}

function teacherEventToAttendanceExportEvent(
  event: TeacherEvent,
): AttendanceExportEvent {
  return {
    id: event.id,
    title: event.title,
    location: event.location,
    date: event.date,
    scheduledTime: event.scheduledTime,
    timeStart: event.scheduledTime,
    timeEnd: event.timeEnd,
    course: event.course,
    courses: event.courses,
    yearLevel: event.yearLevel,
    yearLevels: event.yearLevels,
    targetStudent: event.targetStudent,
    selectedStudentIds: event.selectedStudentIds,
    selectedSchoolIds: event.selectedSchoolIds,
    isPreReg: event.isPreReg,
    withPayment: event.withPayment,
    paymentRequired: event.paymentRequired,
  };
}

function teacherStudentToAttendanceExportStudent(
  student: TeacherStudent,
): AttendanceExportStudent {
  return {
    uid: student.uid,
    schoolId: student.schoolId,
    studentName: student.studentName,
    course: student.course,
    year: student.year,
    status: "Active",
    role: "student",
    searchText:
      `${student.studentName} ${student.schoolId} ${student.course} ${student.year}`.toLowerCase(),
  };
}

function attendanceRecordToExportDoc(
  student: TeacherStudent,
  record: TeacherStudent["attendanceRecords"][number],
): AttendanceExportAttendanceDoc {
  return {
    id: record.eventId,
    uid: student.uid,
    studentUid: student.uid,
    schoolId: student.schoolId,
    studentName: student.studentName,
    course: student.course,
    yearLevel: student.year,
    year: student.year,
    status: record.status,
    timeIn: record.timeInMs || undefined,
    timeOut: record.timeOutMs || undefined,
    updatedAt: record.updatedAtMs || undefined,
  };
}

function toStudentEventOutcome(
  status: AttendanceParticipantStatus,
  event: TeacherEvent,
): StudentEventOutcome {
  if (status === "Present" || status === "Timed In") {
    return status;
  }

  return event.lifecycle === "completed" ? "Missed" : "Upcoming";
}

function eventOutcomeMatchesFilter(
  outcome: StudentEventOutcome,
  filter: VisibleEventsOutcomeFilter,
) {
  if (filter === "present") return outcome === "Present";
  if (filter === "timed_in") return outcome === "Timed In";
  if (filter === "missed") return outcome === "Missed";
  if (filter === "upcoming") return outcome === "Upcoming";
  return true;
}

function buildStudentEventOutcomes(
  student: TeacherStudent,
  events: TeacherEvent[],
) {
  const attendanceByEventId = new Map(
    student.attendanceRecords.map((record) => [record.eventId, record]),
  );
  const exportStudent = teacherStudentToAttendanceExportStudent(student);

  return events
    .map((event) => {
      const attendanceRecord = attendanceByEventId.get(event.id);
      const { rows } = buildAttendanceParticipantRows({
        event: teacherEventToAttendanceExportEvent(event),
        attendanceRows: attendanceRecord
          ? [attendanceRecordToExportDoc(student, attendanceRecord)]
          : [],
        students: [exportStudent],
        respectPaymentStatus: false,
      });
      const participantRow = rows.find(
        (row) => row.uid === student.uid || row.schoolId === student.schoolId,
      );

      if (!participantRow) return null;

      return {
        event,
        outcome: toStudentEventOutcome(participantRow.attendanceStatus, event),
        timeIn: participantRow.timeIn,
        timeOut: participantRow.timeOut,
        updatedAtMs:
          attendanceRecord?.updatedAtMs ||
          event.eventDate?.getTime() ||
          event.createdAtMs,
      };
    })
    .filter(
      (
        item,
      ): item is {
        event: TeacherEvent;
        outcome: StudentEventOutcome;
        timeIn: string;
        timeOut: string;
        updatedAtMs: number;
      } => Boolean(item),
    );
}

export default function TeacherStudentsPage() {
  const { events, students, loading, error } = useTeacherPortal();
  const isMobileActivityModal = useIsBelowBreakpoint(640);

  useTeacherPageErrorToast(error, "teacher student records");

  const [searchText, setSearchText] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [studentPage, setStudentPage] = useState(1);
  const [recentAttendancePage, setRecentAttendancePage] = useState(1);
  const [visibleEventsPage, setVisibleEventsPage] = useState(1);
  const [activeStudentActivityTab, setActiveStudentActivityTab] =
    useState<StudentActivityTab>("profile");
  const [visibleEventsSearch, setVisibleEventsSearch] = useState("");
  const [visibleEventsOutcomeFilter, setVisibleEventsOutcomeFilter] =
    useState<VisibleEventsOutcomeFilter>("all");
  const [activeStudentId, setActiveStudentId] = useState<string | null>(null);
  const [isStudentActivityModalOpen, setIsStudentActivityModalOpen] =
    useState(false);

  const courseOptions = useMemo<SelectOption[]>(
    () => [
      { key: "__all_courses__", label: "All courses" },
      ...Array.from(
        new Set(
          students
            .map((student) => student.course)
            .filter((course) => course && course !== "Unassigned"),
        ),
      )
        .sort((a, b) => a.localeCompare(b))
        .map((course) => ({ key: course, label: course })),
    ],
    [students],
  );

  const yearOptions = useMemo<SelectOption[]>(
    () => [
      { key: "__all_years__", label: "All years" },
      ...Array.from(
        new Set(
          students
            .map((student) => student.year)
            .filter((year) => year && year !== "Unassigned"),
        ),
      )
        .sort((a, b) => a.localeCompare(b))
        .map((year) => ({ key: year, label: year })),
    ],
    [students],
  );

  const filteredStudents = useMemo(() => {
    const search = searchText.trim().toLowerCase();

    return students.filter((student) => {
      const matchesSearch =
        !search ||
        student.studentName.toLowerCase().includes(search) ||
        student.schoolId.toLowerCase().includes(search) ||
        student.course.toLowerCase().includes(search);
      const matchesCourse = courseFilter
        ? student.course === courseFilter
        : true;
      const matchesYear = yearFilter ? student.year === yearFilter : true;

      return matchesSearch && matchesCourse && matchesYear;
    });
  }, [courseFilter, searchText, students, yearFilter]);

  const studentPageData = useMemo(
    () => paginateItems(filteredStudents, studentPage, STUDENTS_PER_PAGE),
    [filteredStudents, studentPage],
  );

  const activeStudent = useMemo(
    () => students.find((student) => student.uid === activeStudentId) ?? null,
    [activeStudentId, students],
  );

  const eventMap = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );

  const activeStudentEvents = useMemo(() => {
    if (!activeStudent) return [];

    return buildStudentEventOutcomes(activeStudent, events)
      .sort((a, b) => {
        const aMs = a.event.eventDate?.getTime() ?? a.event.createdAtMs;
        const bMs = b.event.eventDate?.getTime() ?? b.event.createdAtMs;
        return bMs - aMs;
      });
  }, [activeStudent, events]);

  const filteredActiveStudentEvents = useMemo(() => {
    const search = visibleEventsSearch.trim().toLowerCase();

    return activeStudentEvents.filter((item) => {
      const matchesSearch =
        !search ||
        item.event.title.toLowerCase().includes(search) ||
        item.event.location.toLowerCase().includes(search);
      const matchesOutcome = eventOutcomeMatchesFilter(
        item.outcome,
        visibleEventsOutcomeFilter,
      );

      return matchesSearch && matchesOutcome;
    });
  }, [activeStudentEvents, visibleEventsOutcomeFilter, visibleEventsSearch]);

  const activeStudentAttendance = useMemo(() => {
    if (!activeStudent) return [];

    return activeStudent.attendanceRecords
      .map((record) => {
        const event = eventMap.get(record.eventId);
        if (!event) return null;

        return {
          event,
          status: record.status,
          updatedAtMs: record.updatedAtMs,
        };
      })
      .filter(
        (
          item,
        ): item is {
          event: TeacherEvent;
          status: TeacherStudent["attendanceRecords"][number]["status"];
          updatedAtMs: number;
        } => Boolean(item),
      )
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [activeStudent, eventMap]);

  const recentAttendancePageData = useMemo(
    () =>
      paginateItems(
        activeStudentAttendance,
        recentAttendancePage,
        RECENT_ATTENDANCE_PER_PAGE,
      ),
    [activeStudentAttendance, recentAttendancePage],
  );

  const visibleEventsPageData = useMemo(
    () =>
      paginateItems(
        filteredActiveStudentEvents,
        visibleEventsPage,
        VISIBLE_EVENTS_PER_PAGE,
      ),
    [filteredActiveStudentEvents, visibleEventsPage],
  );

  const completedEvents = useMemo(
    () => events.filter((event) => event.lifecycle === "completed"),
    [events],
  );

  const totalMissed = useMemo(
    () =>
      students.reduce(
        (sum, student) =>
          sum +
          buildStudentEventOutcomes(student, completedEvents).filter(
            (item) => item.outcome === "Missed",
          ).length,
        0,
      ),
    [completedEvents, students],
  );
  const totalCourses = useMemo(
    () =>
      new Set(
        students
          .map((student) => student.course)
          .filter((course) => course && course !== "Unassigned"),
      ).size,
    [students],
  );
  const totalRecords = useMemo(
    () => students.reduce((sum, student) => sum + student.recordedCount, 0),
    [students],
  );

  useEffect(() => {
    setStudentPage(1);
  }, [courseFilter, searchText, yearFilter]);

  useEffect(() => {
    setStudentPage((prev) => clampPage(prev, studentPageData.totalPages));
  }, [studentPageData.totalPages]);

  useEffect(() => {
    setActiveStudentActivityTab("profile");
    setRecentAttendancePage(1);
    setVisibleEventsPage(1);
    setVisibleEventsSearch("");
    setVisibleEventsOutcomeFilter("all");
  }, [activeStudentId]);

  useEffect(() => {
    setVisibleEventsPage(1);
  }, [visibleEventsOutcomeFilter, visibleEventsSearch]);

  useEffect(() => {
    setRecentAttendancePage((prev) =>
      clampPage(prev, recentAttendancePageData.totalPages),
    );
  }, [recentAttendancePageData.totalPages]);

  useEffect(() => {
    setVisibleEventsPage((prev) =>
      clampPage(prev, visibleEventsPageData.totalPages),
    );
  }, [visibleEventsPageData.totalPages]);

  useEffect(() => {
    if (activeStudentId && !activeStudent) {
      setIsStudentActivityModalOpen(false);
      setActiveStudentId(null);
    }
  }, [activeStudent, activeStudentId]);

  const openStudentActivity = (studentId: string) => {
    setActiveStudentId(studentId);
    setActiveStudentActivityTab("profile");
    setRecentAttendancePage(1);
    setVisibleEventsPage(1);
    setVisibleEventsSearch("");
    setVisibleEventsOutcomeFilter("all");
    setIsStudentActivityModalOpen(true);
  };

  const handleStudentActivityModalChange = (open: boolean) => {
    setIsStudentActivityModalOpen(open);
    if (!open) {
      setActiveStudentId(null);
    }
  };

  return (
    <div className="space-y-5 sm:space-y-6">
      <TeacherPageHeader
        variant="hero"
        icon={Users}
        title="Student Activity Monitor"
        description="Review the students appearing in teacher-visible attendance records, then drill into attendance history and linked event activity without leaving the teacher workspace."
      />

      {loading ? (
        <CampusMetricSkeleton />
      ) : (
        <TeacherStatsGrid
          items={[
            {
              label: "Tracked Students",
              value: students.length,
              description: "Students currently visible in teacher attendance data.",
              tone: "blue",
              icon: Users,
            },
            {
              label: "Courses Seen",
              value: totalCourses,
              description: "Distinct courses represented across tracked students.",
              tone: "green",
              icon: GraduationCap,
            },
            {
              label: "Attendance Records",
              value: totalRecords,
              description: "Teacher-visible attendance entries linked to students.",
              tone: "amber",
              icon: ClipboardCheck,
            },
            {
              label: "Missed Records",
              value: totalMissed,
              description:
                "Completed teacher-visible events missed by tracked students.",
              tone: "red",
              icon: TriangleAlert,
            },
          ]}
        />
      )}

      {loading ? (
        <TeacherFilterBarSkeleton />
      ) : (
        <TeacherFilterBar>
          <Input
            aria-label="Search students"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Search by name, ID, or course"
            startContent={<Search size={16} className="text-campus-text-secondary" />}
          />

          <Select
            aria-label="Filter by course"
            disallowEmptySelection
            items={courseOptions}
            selectedKeys={new Set([courseFilter || "__all_courses__"])}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0];
              if (typeof selected === "string") {
                setCourseFilter(selected === "__all_courses__" ? "" : selected);
              }
            }}
          >
            {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
          </Select>

          <Select
            aria-label="Filter by year"
            disallowEmptySelection
            items={yearOptions}
            selectedKeys={new Set([yearFilter || "__all_years__"])}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0];
              if (typeof selected === "string") {
                setYearFilter(selected === "__all_years__" ? "" : selected);
              }
            }}
          >
            {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
          </Select>
        </TeacherFilterBar>
      )}

      <div className="space-y-4">
        <TeacherDataTable
          ariaLabel="Teacher student activity records"
          columns={teacherStudentColumns}
          items={studentPageData.items}
          getRowKey={(student) => student.uid}
          emptyTitle="No students found"
          emptyDescription="Try another name, ID, course, or year filter to widen the teacher-visible results."
          isLoading={loading}
          renderCell={(student, columnKey) => {
            if (columnKey === "student") {
              return (
                <div className="space-y-1">
                  <p className="font-semibold text-campus-text-primary">
                    {student.studentName}
                  </p>
                  <p className="text-xs text-campus-text-secondary">
                    {student.schoolId}
                  </p>
                </div>
              );
            }

            if (columnKey === "course") {
              return (
                <Chip size="sm" className="bg-blue-100 text-blue-700">
                  {student.course}
                </Chip>
              );
            }

            if (columnKey === "year") {
              return (
                <Chip size="sm" className="bg-slate-100 text-slate-700">
                  {student.year}
                </Chip>
              );
            }

            if (columnKey === "actions") {
              return (
                <div className="flex justify-end">
                  <Button
                    color="primary"
                    variant="flat"
                    size="sm"
                    onPress={() => openStudentActivity(student.uid)}
                  >
                    Review activity
                  </Button>
                </div>
              );
            }

            return null;
          }}
        />

        {!loading ? (
          <TeacherPaginationControls
            ariaLabel="student list"
            itemLabel="students"
            page={studentPageData.page}
            totalPages={studentPageData.totalPages}
            totalItems={studentPageData.totalItems}
            startItem={studentPageData.startItem}
            endItem={studentPageData.endItem}
            onPageChange={setStudentPage}
          />
        ) : null}
      </div>

      <TeacherStudentActivityModal
        student={activeStudent}
        activeTab={activeStudentActivityTab}
        onActiveTabChange={setActiveStudentActivityTab}
        trackedEvents={visibleEventsPageData.items}
        hasVisibleEvents={activeStudentEvents.length > 0}
        visibleEventsSearch={visibleEventsSearch}
        onVisibleEventsSearchChange={setVisibleEventsSearch}
        visibleEventsOutcomeFilter={visibleEventsOutcomeFilter}
        onVisibleEventsOutcomeFilterChange={setVisibleEventsOutcomeFilter}
        attendanceItems={recentAttendancePageData.items}
        attendancePagination={
          <TeacherPaginationControls
            ariaLabel="recent attendance"
            itemLabel="attendance records"
            page={recentAttendancePageData.page}
            totalPages={recentAttendancePageData.totalPages}
            totalItems={recentAttendancePageData.totalItems}
            startItem={recentAttendancePageData.startItem}
            endItem={recentAttendancePageData.endItem}
            onPageChange={setRecentAttendancePage}
            showWhenSinglePage
          />
        }
        eventsPagination={
          <TeacherPaginationControls
            ariaLabel="events"
            itemLabel="events"
            page={visibleEventsPageData.page}
            totalPages={visibleEventsPageData.totalPages}
            totalItems={visibleEventsPageData.totalItems}
            startItem={visibleEventsPageData.startItem}
            endItem={visibleEventsPageData.endItem}
            onPageChange={setVisibleEventsPage}
            showWhenSinglePage
          />
        }
        isMobile={isMobileActivityModal}
        isOpen={isStudentActivityModalOpen}
        onOpenChange={handleStudentActivityModalChange}
      />
    </div>
  );
}
