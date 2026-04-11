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
  TeacherActivityChipGroup,
  TeacherDataTable,
  TeacherDetailPanelSkeleton,
  TeacherFilterBar,
  TeacherFilterBarSkeleton,
  TeacherPageHeader,
  TeacherStatsGrid,
  TeacherStudentDetailPanel,
  TeacherStudentDrawer,
  useIsBelowBreakpoint,
  useTeacherPageErrorToast,
  useTeacherPortal,
} from "@/components/teacher";
import { CampusMetricSkeleton } from "@/components/ui";

const STUDENTS_PER_PAGE = 8;

type TeacherStudentRow = {
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  trackedEventIds: string[];
  presentCount: number;
  absentCount: number;
  recordedCount: number;
};

const teacherStudentColumns: CampusTableColumn<TeacherStudentRow>[] = [
  { key: "student", label: "Student" },
  { key: "course", label: "Course" },
  { key: "year", label: "Year" },
  { key: "activity", label: "Activity" },
  { key: "actions", label: "Actions", align: "end", className: "text-right" },
];

type SelectOption = {
  key: string;
  label: string;
};

export default function TeacherStudentsPage() {
  const { events, students, loading, error } = useTeacherPortal();
  const isCompactView = useIsBelowBreakpoint(1280);

  useTeacherPageErrorToast(error, "teacher student records");

  const [searchText, setSearchText] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null,
  );

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

  const totalPages = Math.max(
    1,
    Math.ceil(filteredStudents.length / STUDENTS_PER_PAGE),
  );

  const paginatedStudents = useMemo(() => {
    const start = (page - 1) * STUDENTS_PER_PAGE;
    return filteredStudents.slice(start, start + STUDENTS_PER_PAGE);
  }, [filteredStudents, page]);

  const selectedStudent = useMemo(
    () => students.find((student) => student.uid === selectedStudentId) ?? null,
    [selectedStudentId, students],
  );

  const eventMap = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );

  const selectedStudentEvents = useMemo(() => {
    if (!selectedStudent) return [];

    return selectedStudent.trackedEventIds
      .map((eventId) => eventMap.get(eventId))
      .filter((event): event is (typeof events)[number] => Boolean(event))
      .sort((a, b) => {
        const aMs = a.eventDate?.getTime() ?? a.createdAtMs;
        const bMs = b.eventDate?.getTime() ?? b.createdAtMs;
        return bMs - aMs;
      });
  }, [eventMap, selectedStudent]);

  const selectedStudentAttendance = useMemo(() => {
    if (!selectedStudent) return [];

    return selectedStudent.attendanceRecords
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
          event: (typeof selectedStudentEvents)[number];
          status: "Present" | "Absent" | "Recorded";
          updatedAtMs: number;
        } => Boolean(item),
      )
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [eventMap, selectedStudent]);

  const totalMissed = useMemo(
    () => students.reduce((sum, student) => sum + student.absentCount, 0),
    [students],
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
    setPage(1);
  }, [courseFilter, searchText, yearFilter]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (filteredStudents.length === 0) {
      setSelectedStudentId(null);
      return;
    }

    if (isCompactView) {
      if (
        selectedStudentId &&
        !filteredStudents.some((student) => student.uid === selectedStudentId)
      ) {
        setSelectedStudentId(null);
      }
      return;
    }

    if (
      !selectedStudentId ||
      !filteredStudents.some((student) => student.uid === selectedStudentId)
    ) {
      setSelectedStudentId(filteredStudents[0].uid);
    }
  }, [filteredStudents, isCompactView, selectedStudentId]);

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
              description: "Attendance entries marked absent or missed.",
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

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.95fr)]">
        <div className="space-y-4">
          <TeacherDataTable
            ariaLabel="Teacher student activity records"
            columns={teacherStudentColumns}
            items={paginatedStudents}
            getRowKey={(student) => student.uid}
            emptyTitle="No students found"
            emptyDescription="Try another name, ID, course, or year filter to widen the teacher-visible results."
            selectionMode="single"
            selectedKeys={selectedStudentId ? new Set([selectedStudentId]) : new Set([])}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0];
              setSelectedStudentId(typeof selected === "string" ? selected : null);
            }}
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

              if (columnKey === "activity") {
                return (
                  <TeacherActivityChipGroup
                    items={[
                      {
                        label: "Tracked",
                        value: student.trackedEventIds.length,
                        tone: "blue",
                      },
                      { label: "Present", value: student.presentCount, tone: "green" },
                      { label: "Missed", value: student.absentCount, tone: "red" },
                    ]}
                  />
                );
              }

              if (columnKey === "actions") {
                const isSelected = selectedStudentId === student.uid;

                return (
                  <div className="flex justify-end">
                    <Button
                      color="primary"
                      variant={isSelected ? "flat" : "light"}
                      size="sm"
                      onPress={() => setSelectedStudentId(student.uid)}
                    >
                      {isCompactView ? "View student" : "Review activity"}
                    </Button>
                  </div>
                );
              }

              return null;
            }}
          />

          {!loading && filteredStudents.length > STUDENTS_PER_PAGE ? (
            <div className="flex justify-center sm:justify-end">
              <Pagination
                showControls
                page={page}
                total={totalPages}
                onChange={(nextPage) => setPage(nextPage)}
              />
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="hidden xl:block">
            <TeacherDetailPanelSkeleton />
          </div>
        ) : (
          <div className="hidden xl:block">
            <TeacherStudentDetailPanel
              student={selectedStudent}
              trackedEvents={selectedStudentEvents}
              attendanceItems={selectedStudentAttendance}
              className="xl:sticky xl:top-6"
            />
          </div>
        )}
      </div>

      <TeacherStudentDrawer
        student={selectedStudent}
        trackedEvents={selectedStudentEvents}
        attendanceItems={selectedStudentAttendance}
        isOpen={isCompactView && Boolean(selectedStudent)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedStudentId(null);
          }
        }}
      />
    </div>
  );
}
