"use client";

import Link from "next/link";
import { Chip } from "@heroui/chip";
import { Button } from "@heroui/button";
import {
  BellRing,
  CalendarRange,
  CheckCircle2,
  CreditCard,
  GraduationCap,
} from "lucide-react";
import { CampusMetricSkeleton, CampusSectionCard } from "@/components/ui";
import {
  StudentAccountStatusChip,
  StudentCardStackSkeleton,
  StudentEmptyState,
  StudentEventCard,
  StudentPageHeader,
  StudentPageHeaderSkeleton,
  StudentStatsGrid,
  StudentNotificationCard,
  buildStudentAudienceLabel,
  formatStudentRelativeTime,
  useStudentPageErrorToast,
  useStudentPortal,
} from "@/components/student";
import { formatEventScheduleDisplay } from "@/lib/eventSchedule";

function getNotificationHref(type: string) {
  if (type === "payment") return "/student/payment";
  if (type === "upcoming" || type === "missed" || type === "preregister") {
    return "/student/event";
  }
  return "/student/notifications";
}

export default function StudentDashboard() {
  const {
    profile,
    events,
    notifications,
    readNotificationIds,
    unreadNotificationsCount,
    loading,
    error,
  } = useStudentPortal();

  useStudentPageErrorToast(error, "student dashboard");

  const readSet = new Set(readNotificationIds);

  const upcomingCount = events.filter((event) => event.lifecycle !== "completed").length;
  const completedCount = events.filter(
    (event) => event.lifecycle === "completed",
  ).length;

  const eventOverview = [...events]
    .sort((left, right) => {
      const now = Date.now();
      const leftMs = left.eventDate?.getTime() ?? 0;
      const rightMs = right.eventDate?.getTime() ?? 0;
      const leftBucket = leftMs >= now ? 0 : 1;
      const rightBucket = rightMs >= now ? 0 : 1;

      if (leftBucket !== rightBucket) return leftBucket - rightBucket;
      return leftBucket === 0 ? leftMs - rightMs : rightMs - leftMs;
    })
    .slice(0, 3);

  const recentNotifications = notifications.slice(0, 3);

  return (
    <div className="space-y-5 sm:space-y-6">
      {loading && !profile ? (
        <StudentPageHeaderSkeleton hero />
      ) : (
        <StudentPageHeader
          variant="hero"
          icon={GraduationCap}
          title={`Welcome back${profile ? `, ${profile.name || profile.schoolId || "User"}` : ""}.`}
          description="Track your events, payments, and notices in one mobile-friendly CAMPUS student portal designed for quick daily check-ins."
          meta={
            <>
              <Chip className="border border-white/20 bg-white/10 text-white">
                {profile?.course || "Unassigned"}
              </Chip>
              <Chip className="border border-white/20 bg-white/10 text-white">
                {profile?.year || "Unassigned"}
              </Chip>
              <StudentAccountStatusChip
                status={profile?.accountStatus || "Active"}
                helperText={
                  profile?.accountStatus === "Inactive"
                    ? "Approach EC member to make your account active."
                    : "Your account is active and can access current student features."
                }
              />
            </>
          }
        />
      )}

      {loading ? (
        <CampusMetricSkeleton />
      ) : (
        <StudentStatsGrid
          items={[
            {
              label: "Upcoming Events",
              value: upcomingCount,
              description: "Visible activities that still need your attention.",
              tone: "amber",
              icon: CalendarRange,
            },
            {
              label: "Completed Events",
              value: completedCount,
              description: "Finished events still available in your history.",
              tone: "green",
              icon: CheckCircle2,
            },
            {
              label: "Unread Notifications",
              value: unreadNotificationsCount,
              description: "New notices from events, payments, and EC updates.",
              tone: unreadNotificationsCount > 0 ? "red" : "blue",
              icon: BellRing,
            },
            {
              label: "Payment Notices",
              value: notifications.filter((item) => item.type === "payment").length,
              description: "Payment-related notices surfaced in your portal.",
              tone: "blue",
              icon: CreditCard,
            },
          ]}
        />
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
        <CampusSectionCard
          title="Events Overview"
          description="Your next and most recent event updates in one place."
          action={
            <Link href="/student/event">
              <Button color="primary" variant="flat">
                Open events
              </Button>
            </Link>
          }
        >
            {loading ? (
              <StudentCardStackSkeleton rows={3} />
            ) : eventOverview.length === 0 ? (
              <StudentEmptyState
                title="No upcoming events yet"
                description="When events become available for your course, year, or account, they will appear here."
                icon={CalendarRange}
                compact
              />
            ) : (
              <div className="space-y-3">
                {eventOverview.map((event) => (
                  <StudentEventCard
                    key={event.id}
                    title={event.title}
                    description={event.description}
                    scheduleLabel={
                      formatEventScheduleDisplay({
                        date: event.eventDate ?? event.date,
                        scheduledTime: event.scheduledTime,
                        timeStart: event.timeStart,
                        timeEnd: event.timeEnd,
                      }).scheduleLabel
                    }
                    location={event.location}
                    status={event.status}
                    audienceLabel={buildStudentAudienceLabel(
                      event.course,
                      event.yearLevel,
                    )}
                    action={
                      <Link href="/student/event">
                        <Button color="primary" variant="light" size="sm">
                          View details
                        </Button>
                      </Link>
                    }
                  />
                ))}
              </div>
            )}
        </CampusSectionCard>

        <CampusSectionCard
          title={
            <div className="flex flex-wrap items-center gap-2">
              <span>Recent Notifications</span>
              <Chip
                size="sm"
                className={
                  unreadNotificationsCount > 0
                    ? "bg-rose-100 text-rose-700"
                    : "bg-emerald-100 text-emerald-700"
                }
              >
                {unreadNotificationsCount} unread
              </Chip>
            </div>
          }
          description="Latest updates from events, payments, and EC notices."
          action={
            <Link href="/student/notifications">
              <Button variant="light">Open notifications</Button>
            </Link>
          }
        >
            {loading ? (
              <StudentCardStackSkeleton rows={3} />
            ) : recentNotifications.length === 0 ? (
              <StudentEmptyState
                title="No notifications right now"
                description="You are all caught up. New event, payment, and EC updates will appear here."
                icon={BellRing}
                tone="green"
                compact
              />
            ) : (
              <div className="space-y-3">
                {recentNotifications.map((item) => (
                  <StudentNotificationCard
                    key={item.id}
                    title={item.title}
                    description={item.description}
                    type={item.type}
                    displayDate={item.displayDate}
                    relativeDate={formatStudentRelativeTime(item.date)}
                    unread={!readSet.has(item.id)}
                    primaryAction={
                      <Link href={getNotificationHref(item.type)}>
                        <Button color="primary" variant="flat" size="sm">
                          Open
                        </Button>
                      </Link>
                    }
                  />
                ))}
              </div>
            )}
        </CampusSectionCard>
      </div>
    </div>
  );
}
