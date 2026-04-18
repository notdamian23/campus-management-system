"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import {
  AlertCircle,
  CalendarRange,
  ClipboardCheck,
  FileStack,
  ShieldCheck,
  Users,
} from "lucide-react";
import { CampusMetricSkeleton, CampusSectionCard } from "@/components/ui";
import {
  TeacherEmptyState,
  TeacherEventSnapshotCard,
  TeacherEventSnapshotSkeleton,
  TeacherPageHeader,
  TeacherPageHeaderSkeleton,
  TeacherStatsGrid,
  buildTeacherEventSnapshotFromRecord,
  useTeacherPageErrorToast,
  useTeacherPortal,
} from "@/components/teacher";

export default function TeacherDashboard() {
  const router = useRouter();
  const { profile, events, files, students, loading, error } = useTeacherPortal();

  useTeacherPageErrorToast(error, "teacher dashboard");

  const activeEvents = useMemo(
    () => events.filter((event) => event.lifecycle !== "completed"),
    [events],
  );
  const totalAttendanceRecords = useMemo(
    () => students.reduce((sum, student) => sum + student.recordedCount, 0),
    [students],
  );

  const recentEvents = useMemo(
    () =>
      [...events]
        .sort((a, b) => {
          const now = Date.now();
          const aMs = a.eventDate?.getTime() ?? a.createdAtMs;
          const bMs = b.eventDate?.getTime() ?? b.createdAtMs;
          const aBucket = aMs >= now ? 0 : 1;
          const bBucket = bMs >= now ? 0 : 1;

          if (aBucket !== bBucket) return aBucket - bBucket;
          return aBucket === 0 ? aMs - bMs : bMs - aMs;
        })
        .slice(0, 4),
    [events],
  );

  const attentionStudents = useMemo(
    () =>
      [...students]
        .filter((student) => student.absentCount > 0)
        .sort((a, b) => {
          if (b.absentCount !== a.absentCount) {
            return b.absentCount - a.absentCount;
          }
          return b.lastActivityMs - a.lastActivityMs;
        })
        .slice(0, 4),
    [students],
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      {loading && !profile ? (
        <TeacherPageHeaderSkeleton hero />
      ) : (
        <TeacherPageHeader
          variant="hero"
          icon={ShieldCheck}
          title={`Welcome back${profile ? `, ${profile.name || profile.schoolId || "User"}` : ""}.`}
          description="Review live events, student attendance activity, and shared event files in one teacher-friendly workspace built for the CAMPUS thesis system."
        />
      )}

      {error ? (
        <Card shadow="none" className="border border-red-200 bg-red-50/90">
          <CardBody className="flex flex-row items-start gap-3 p-4 text-sm text-red-700">
            <AlertCircle className="mt-0.5 shrink-0" size={18} />
            <div>
              <p className="font-semibold">Dashboard data needs attention</p>
              <p>{error}</p>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {loading ? (
        <CampusMetricSkeleton />
      ) : (
        <TeacherStatsGrid
          items={[
            {
              label: "Active Events",
              value: activeEvents.length,
              description: "Upcoming and ongoing activities visible to teachers.",
              tone: "blue",
              icon: CalendarRange,
            },
            {
              label: "Tracked Students",
              value: students.length,
              description: "Students appearing in teacher-visible attendance records.",
              tone: "green",
              icon: Users,
            },
            {
              label: "Attendance Records",
              value: totalAttendanceRecords,
              description: "Recorded attendance entries connected to visible events.",
              tone: "amber",
              icon: ClipboardCheck,
            },
            {
              label: "Event Files",
              value: files.length,
              description: "Documents and photo evidence attached to events.",
              tone: "purple",
              icon: FileStack,
            },
          ]}
        />
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.95fr)]">
        <CampusSectionCard
          title="Event Snapshot"
          description="Upcoming and recent events pulled from the live teacher-visible event board."
          action={
            <Button
              color="primary"
              variant="light"
              onPress={() => router.push("/teacher/events")}
            >
              Open events
            </Button>
          }
        >
            {loading ? (
              <TeacherEventSnapshotSkeleton rows={3} />
            ) : recentEvents.length === 0 ? (
              <TeacherEmptyState
                title="No events have been posted yet"
                description="As soon as EC event records become visible to teachers, the latest event snapshot will appear here."
                icon={CalendarRange}
                compact
              />
            ) : (
              <div className="space-y-3">
                {recentEvents.map((event) => (
                  <TeacherEventSnapshotCard
                    key={event.id}
                    {...buildTeacherEventSnapshotFromRecord(event)}
                    action={
                      <Button
                        size="sm"
                        color="primary"
                        variant="flat"
                        onPress={() => router.push("/teacher/events")}
                      >
                        Review event
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
        </CampusSectionCard>

        <CampusSectionCard
          title="Students Needing Attention"
          description="Based on missed attendance in teacher-visible event records."
        >
            {loading ? (
              <TeacherEventSnapshotSkeleton rows={3} />
            ) : attentionStudents.length === 0 ? (
              <TeacherEmptyState
                title="No students need attention right now."
                description="Teacher-visible attendance records currently show no missed entries that need follow-up."
                icon={ShieldCheck}
                tone="green"
                compact
              />
            ) : (
              <div className="space-y-3">
                {attentionStudents.map((student) => (
                  <Card
                    key={student.uid}
                    shadow="none"
                    className="border border-border/70 bg-slate-50/70"
                  >
                    <CardHeader className="flex items-start justify-between gap-3 p-4 sm:p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-campus-text-primary">
                            {student.studentName}
                          </p>
                          <p className="text-xs text-campus-text-secondary">
                            {student.schoolId} • {student.course} • {student.year}
                          </p>
                        </div>
                        <Chip className="bg-rose-100 text-rose-700">
                          {student.absentCount} missed
                        </Chip>
                      </div>
                    </CardHeader>

                    <CardBody className="space-y-3 px-4 pb-4 pt-0 sm:px-5 sm:pb-5">
                      <div className="flex flex-wrap gap-2 text-xs">
                        <Chip size="sm" className="bg-emerald-100 text-emerald-700">
                          Present: {student.presentCount}
                        </Chip>
                        <Chip size="sm" className="bg-slate-100 text-slate-700">
                          Total: {student.recordedCount}
                        </Chip>
                      </div>

                      <p className="text-xs leading-5 text-campus-text-secondary">
                        Needs review due to missed attendance in teacher-visible events.
                      </p>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
        </CampusSectionCard>
      </div>
    </div>
  );
}
