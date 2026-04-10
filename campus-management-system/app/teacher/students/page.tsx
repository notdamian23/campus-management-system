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
import { useTeacherPortal } from "@/components/teacher/TeacherPortalProvider";

const STUDENTS_PER_PAGE = 8;

const teacherStudentColumns: CampusTableColumn<{
  uid: string;
  schoolId: string;
  studentName: string;
  course: string;
  year: string;
  trackedEventIds: string[];
  presentCount: number;
  absentCount: number;
}>[] = [
  { key: "schoolId", label: "Student ID" },
  { key: "studentName", label: "Name" },
  { key: "course", label: "Course" },
  { key: "year", label: "Year" },
  { key: "summary", label: "Activity" },
  { key: "actions", label: "Actions", align: "end", className: "text-right" },
];

type SelectOption = {
  key: string;
  label: string;
};

type StudentTabKey = "tracked" | "present" | "absent";

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

function statusChipClass(status: "Present" | "Absent") {
  return status === "Present"
    ? "bg-emerald-100 text-emerald-700"
    : "bg-red-100 text-red-700";
}

export default function TeacherStudentsPage() {
  const { events, students, loading, error } = useTeacherPortal();

  const [searchText, setSearchText] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(
    null,
  );
  const [selectedTab, setSelectedTab] = useState<StudentTabKey>("tracked");

  const courseOptions = useMemo<SelectOption[]>(
    () => [
      { key: "__all_courses__", label: "All Courses" },
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
      { key: "__all_years__", label: "All Years" },
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

  const selectedStudentRegistered = useMemo(() => {
    if (!selectedStudent) return [];
    const rows = selectedStudent.trackedEventIds
      .map((eventId) => eventMap.get(eventId))
      .filter((event): event is (typeof events)[number] => Boolean(event));

    return rows.sort((a, b) => {
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
          event: (typeof selectedStudentRegistered)[number];
          status: "Present" | "Absent" | "Recorded";
          updatedAtMs: number;
        } => Boolean(item),
      )
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  }, [eventMap, selectedStudent]);

  const selectedStudentPresent = selectedStudentAttendance.filter(
    (item) => item.status === "Present",
  );
  const selectedStudentAbsent = selectedStudentAttendance.filter(
    (item) => item.status === "Absent",
  );

  const totalMissed = students.reduce(
    (sum, student) => sum + student.absentCount,
    0,
  );

  useEffect(() => {
    setPage(1);
  }, [courseFilter, searchText, yearFilter]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!selectedStudent) {
      setSelectedTab("tracked");
    }
  }, [selectedStudent]);

  return (
    <div className="space-y-5 sm:space-y-6">
      <Card shadow="sm">
        <CardBody className="space-y-2 p-5 sm:p-6">
          <h1 className="text-2xl font-bold text-primary-900 sm:text-3xl">
            Student Activity Monitor
          </h1>
          <p className="text-sm text-campus-text-secondary">
            Teachers can review the students that appear in teacher-visible
            attendance records, along with their recent event activity.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardBody>
      </Card>

      {loading ? (
        <CampusMetricSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            label="Tracked Students"
            value={String(students.length)}
            tone="text-blue-700"
          />
          <StatCard
            label="Courses Seen"
            value={String(
              new Set(
                students
                  .map((student) => student.course)
                  .filter((course) => course && course !== "Unassigned"),
              ).size,
            )}
            tone="text-emerald-700"
          />
          <StatCard
            label="Attendance Records"
            value={String(
              students.reduce((sum, student) => sum + student.recordedCount, 0),
            )}
            tone="text-amber-700"
          />
          <StatCard
            label="Missed Records"
            value={String(totalMissed)}
            tone="text-red-700"
          />
        </div>
      )}

      <Card shadow="sm">
        <CardBody className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            aria-label="Search students"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Search by name, ID, or course..."
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

          <div className="flex items-center justify-between rounded-xl border border-dashed border-border px-4 py-3 text-sm text-campus-text-secondary">
            <span>Visible results</span>
            <span className="font-semibold text-campus-text-primary">
              {loading ? "-" : filteredStudents.length}
            </span>
          </div>
        </CardBody>
      </Card>

      {loading ? (
        <CampusCardListSkeleton rows={4} />
      ) : (
        <CampusDataTable
          ariaLabel="Teacher student activity records"
          columns={teacherStudentColumns}
          items={paginatedStudents}
          emptyTitle="No students match the current filters"
          emptyDescription="Try another search, year, or course filter."
          renderCell={(student, columnKey) => {
            if (columnKey === "course") {
              return (
                <Chip size="sm" className="bg-blue-100 text-blue-700">
                  {student.course}
                </Chip>
              );
            }

            if (columnKey === "summary") {
              return (
                <div className="flex flex-wrap gap-2">
                  <Chip size="sm" className="bg-slate-100 text-slate-700">
                    Tracked: {student.trackedEventIds.length}
                  </Chip>
                  <Chip size="sm" className="bg-emerald-100 text-emerald-700">
                    Present: {student.presentCount}
                  </Chip>
                  <Chip size="sm" className="bg-red-100 text-red-700">
                    Missed: {student.absentCount}
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
                    onPress={() => setSelectedStudentId(student.uid)}
                  >
                    Open
                  </Button>
                </div>
              );
            }

            return student[columnKey as keyof typeof student] as string;
          }}
        />
      )}

      {!loading && filteredStudents.length > STUDENTS_PER_PAGE && (
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
        isOpen={Boolean(selectedStudent)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedStudentId(null);
            setSelectedTab("tracked");
          }
        }}
        size="4xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <span className="text-xl font-semibold text-campus-text-primary">
                  {selectedStudent?.studentName || "Student details"}
                </span>
                <span className="text-sm font-normal text-campus-text-secondary">
                  {selectedStudent?.schoolId || "-"} |{" "}
                  {selectedStudent?.course || "-"} |{" "}
                  {selectedStudent?.year || "-"}
                </span>
              </ModalHeader>

              <ModalBody className="space-y-5 pb-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <MiniCard
                    label="Tracked Events"
                    value={selectedStudent?.trackedEventIds.length ?? 0}
                    tone="text-blue-700"
                  />
                  <MiniCard
                    label="Present"
                    value={selectedStudent?.presentCount ?? 0}
                    tone="text-emerald-700"
                  />
                  <MiniCard
                    label="Missed"
                    value={selectedStudent?.absentCount ?? 0}
                    tone="text-red-700"
                  />
                </div>

                <Tabs
                  aria-label="Student detail tabs"
                  selectedKey={selectedTab}
                  onSelectionChange={(key) =>
                    setSelectedTab(String(key) as StudentTabKey)
                  }
                  fullWidth
                  classNames={{
                    tabList: "w-full grid grid-cols-3",
                    tab: "w-full min-w-0 px-2",
                    tabContent: "truncate text-xs sm:text-sm",
                  }}
                >
                  <Tab key="tracked" title="Tracked">
                    <div className="space-y-3 pt-2">
                      {selectedStudentRegistered.length === 0 ? (
                        <p className="text-sm text-campus-text-secondary">
                          No teacher-visible event activity found for this
                          student yet.
                        </p>
                      ) : (
                        selectedStudentRegistered.map((event) => (
                          <Card key={event.id} shadow="none" className="border">
                            <CardBody className="space-y-1 p-4">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="font-semibold text-campus-text-primary">
                                  {event.title}
                                </p>
                                <Chip
                                  size="sm"
                                  className="bg-blue-100 text-blue-700"
                                >
                                  Tracked
                                </Chip>
                              </div>
                              <p className="text-sm text-campus-text-secondary">
                                {formatEventDate(event.eventDate, event.date)}
                              </p>
                              <p className="text-xs text-campus-text-secondary">
                                {event.location}
                              </p>
                            </CardBody>
                          </Card>
                        ))
                      )}
                    </div>
                  </Tab>

                  <Tab key="present" title="Present">
                    <div className="space-y-3 pt-2">
                      {selectedStudentPresent.length === 0 ? (
                        <p className="text-sm text-campus-text-secondary">
                          No present attendance records found.
                        </p>
                      ) : (
                        selectedStudentPresent.map((item) => (
                          <AttendanceCard
                            key={`${item.event.id}-present`}
                            title={item.event.title}
                            date={formatEventDate(
                              item.event.eventDate,
                              item.event.date,
                            )}
                            location={item.event.location}
                            status="Present"
                          />
                        ))
                      )}
                    </div>
                  </Tab>

                  <Tab key="absent" title="Missed">
                    <div className="space-y-3 pt-2">
                      {selectedStudentAbsent.length === 0 ? (
                        <p className="text-sm text-campus-text-secondary">
                          No missed attendance records found.
                        </p>
                      ) : (
                        selectedStudentAbsent.map((item) => (
                          <AttendanceCard
                            key={`${item.event.id}-absent`}
                            title={item.event.title}
                            date={formatEventDate(
                              item.event.eventDate,
                              item.event.date,
                            )}
                            location={item.event.location}
                            status="Absent"
                          />
                        ))
                      )}
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

function StatCard({
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

function MiniCard({
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

function AttendanceCard({
  title,
  date,
  location,
  status,
}: {
  title: string;
  date: string;
  location: string;
  status: "Present" | "Absent";
}) {
  return (
    <Card shadow="none" className="border">
      <CardBody className="space-y-1 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-semibold text-campus-text-primary">{title}</p>
          <Chip size="sm" className={statusChipClass(status)}>
            {status}
          </Chip>
        </div>
        <p className="text-sm text-campus-text-secondary">{date}</p>
        <p className="text-xs text-campus-text-secondary">{location}</p>
      </CardBody>
    </Card>
  );
}
