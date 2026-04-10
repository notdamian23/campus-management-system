"use client";

import Link from "next/link";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { CampusCardListSkeleton, CampusMetricSkeleton } from "@/components/ui";
import { useTeacherPortal } from "@/components/teacher/TeacherPortalProvider";

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

export default function TeacherDashboard() {
  const { profile, events, files, students, loading, error } =
    useTeacherPortal();

  const activeEvents = events.filter(
    (event) => event.lifecycle !== "completed",
  );
  const ongoingEvents = events.filter((event) => event.lifecycle === "ongoing");
  const totalAttendanceRecords = students.reduce(
    (sum, student) => sum + student.recordedCount,
    0,
  );
  const recentEvents = [...events]
    .sort((a, b) => {
      const now = Date.now();
      const aMs = a.eventDate?.getTime() ?? a.createdAtMs;
      const bMs = b.eventDate?.getTime() ?? b.createdAtMs;
      const aBucket = aMs >= now ? 0 : 1;
      const bBucket = bMs >= now ? 0 : 1;

      if (aBucket !== bBucket) return aBucket - bBucket;
      return aBucket === 0 ? aMs - bMs : bMs - aMs;
    })
    .slice(0, 4);

  const attentionStudents = [...students]
    .filter((student) => student.absentCount > 0)
    .sort((a, b) => {
      if (b.absentCount !== a.absentCount) {
        return b.absentCount - a.absentCount;
      }
      return b.lastActivityMs - a.lastActivityMs;
    })
    .slice(0, 4);

  return (
    <div className="space-y-5 sm:space-y-8">
      <div className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-primary-600 via-primary-500 to-primary-700 px-5 py-6 text-white shadow-lg sm:px-7 sm:py-8">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-white/75">
            Teacher Portal
          </p>
          <h1 className="text-2xl font-bold sm:text-3xl">
            Welcome back{profile?.teacherName ? `, ${profile.teacherName}` : ""}
            .
          </h1>
          <p className="max-w-2xl text-sm text-white/85">
            You are now looking at live campus activity: events, participants,
            and shared event files in one mobile-friendly workspace.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
          <Chip className="border border-white/20 bg-white/10 text-white">
            ID: {profile?.schoolId || "-"}
          </Chip>
          <Chip className="border border-white/20 bg-white/10 text-white">
            {ongoingEvents.length} event{ongoingEvents.length === 1 ? "" : "s"}{" "}
            live now
          </Chip>
        </div>
      </div>

      {error && (
        <Card shadow="sm" className="border border-red-200 bg-red-50">
          <CardBody className="text-sm text-red-700">{error}</CardBody>
        </Card>
      )}

      {loading ? (
        <CampusMetricSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Active Events"
            value={String(activeEvents.length)}
            tone="text-blue-700"
          />
          <MetricCard
            label="Tracked Students"
            value={String(students.length)}
            tone="text-emerald-700"
          />
          <MetricCard
            label="Attendance Records"
            value={String(totalAttendanceRecords)}
            tone="text-amber-700"
          />
          <MetricCard
            label="Event Files"
            value={String(files.length)}
            tone="text-fuchsia-700"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,1fr)]">
        <Card shadow="sm">
          <CardHeader className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-campus-text-primary">
                Event Snapshot
              </h2>
              <p className="text-sm text-campus-text-secondary">
                Upcoming and recent events pulled from the live event board.
              </p>
            </div>

            <Link
              href="/teacher/events"
              className="text-sm font-medium text-primary-700 hover:underline"
            >
              Open events
            </Link>
          </CardHeader>

          <CardBody className="space-y-3">
            {loading ? (
              <CampusCardListSkeleton rows={3} />
            ) : recentEvents.length === 0 ? (
              <p className="text-sm text-campus-text-secondary">
                No events have been posted yet.
              </p>
            ) : (
              recentEvents.map((event) => (
                <Card key={event.id} shadow="none" className="border">
                  <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-campus-text-primary">
                          {event.title}
                        </h3>
                        <Chip
                          size="sm"
                          className={lifecycleChipClass(event.lifecycle)}
                        >
                          {event.lifecycle}
                        </Chip>
                      </div>
                      <p className="text-sm text-campus-text-secondary">
                        {formatEventDate(event.eventDate, event.date)}
                      </p>
                      <p className="text-xs text-campus-text-secondary">
                        {event.location} | {event.attendanceCount} attendance{" "}
                        records | {event.documentCount + event.imageCount} files
                      </p>
                    </div>

                    <Link
                      href="/teacher/events"
                      className="inline-flex items-center justify-center rounded-xl bg-primary-100 px-4 py-2 text-sm font-medium text-primary-700 transition hover:bg-primary-200"
                    >
                      Review
                    </Link>
                  </CardBody>
                </Card>
              ))
            )}
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardHeader className="flex flex-col items-start gap-2">
            <h2 className="text-lg font-semibold text-campus-text-primary">
              Students Needing Attention
            </h2>
            <p className="text-sm text-campus-text-secondary">
              Based on event attendance records currently visible to teachers.
            </p>
          </CardHeader>

          <CardBody className="space-y-3">
            {loading ? (
              <CampusCardListSkeleton rows={3} />
            ) : attentionStudents.length === 0 ? (
              <p className="text-sm text-campus-text-secondary">
                No missed attendance records yet.
              </p>
            ) : (
              attentionStudents.map((student) => (
                <Card key={student.uid} shadow="none" className="border">
                  <CardBody className="space-y-2 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-campus-text-primary">
                          {student.studentName}
                        </p>
                        <p className="text-xs text-campus-text-secondary">
                          {student.schoolId} | {student.course}
                        </p>
                      </div>
                      <Chip className="bg-red-100 text-red-700">
                        {student.absentCount} missed
                      </Chip>
                    </div>
                    <p className="text-xs text-campus-text-secondary">
                      {student.presentCount} present | {student.recordedCount}{" "}
                      total attendance records
                    </p>
                  </CardBody>
                </Card>
              ))
            )}
          </CardBody>
        </Card>
      </div>
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
