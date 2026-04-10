"use client";

import Link from "next/link";
import {
  FiBell,
  FiCalendar,
  FiCheckCircle,
  FiChevronRight,
} from "react-icons/fi";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { CampusCardListSkeleton, CampusMetricSkeleton } from "@/components/ui";
import { CampusBadge } from "@/components/heroui";
import {
  StudentEvent,
  StudentEventStatus,
  useStudentPortal,
} from "@/components/student/StudentPortalProvider";

function statusPill(status: StudentEventStatus) {
  if (status === "Upcoming") {
    return <CampusBadge status="upcoming">Upcoming</CampusBadge>;
  }
  if (status === "Attended") {
    return <CampusBadge status="completed">Attended</CampusBadge>;
  }
  if (status === "Missed") {
    return <CampusBadge status="missed">Missed</CampusBadge>;
  }
  if (status === "Payment Due") {
    return (
      <Chip color="warning" variant="flat" className="font-semibold">
        Payment Due
      </Chip>
    );
  }

  return (
    <Chip variant="flat" className="font-semibold text-campus-text-primary">
      Pre-registration
    </Chip>
  );
}

function formatEventDate(event: StudentEvent) {
  if (event.eventDate) {
    return event.eventDate.toLocaleString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return event.date || "No date";
}

function toRelativeTime(date: Date) {
  const diffMs = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60000);

  if (Math.abs(diffMin) < 60) {
    if (diffMin === 0) return "just now";
    if (diffMin > 0) return `in ${diffMin}m`;
    return `${Math.abs(diffMin)}m ago`;
  }

  const diffHour = Math.round(diffMin / 60);
  if (Math.abs(diffHour) < 24) {
    if (diffHour > 0) return `in ${diffHour}h`;
    return `${Math.abs(diffHour)}h ago`;
  }

  const diffDay = Math.round(diffHour / 24);
  if (diffDay > 0) return `in ${diffDay}d`;
  return `${Math.abs(diffDay)}d ago`;
}

export default function StudentDashboard() {
  const {
    profile,
    events,
    notifications,
    unreadNotificationsCount,
    loading,
    error,
  } = useStudentPortal();

  const upcomingCount = events.filter(
    (event) => event.lifecycle !== "completed",
  ).length;
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
    <div className="space-y-5 sm:space-y-8">
      <Card
        shadow="sm"
        className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#bb2020] to-[#f19b4c] text-white"
      >
        <CardBody className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
                Student Dashboard
              </p>
              <h1 className="text-2xl font-black sm:text-3xl">
                Welcome back
                {profile?.studentName ? `, ${profile.studentName}` : ""}!
              </h1>
              <p className="text-sm text-white/80 sm:text-base">
                Here is what is happening today.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Chip variant="flat" className="bg-white/15 text-white">
                {profile?.course || "Unassigned"}
              </Chip>
              <Chip variant="flat" className="bg-white/15 text-white">
                {profile?.year || "Unassigned"}
              </Chip>
              <Chip
                variant="flat"
                className={
                  profile?.accountStatus === "Inactive"
                    ? "bg-white text-[#7b0000]"
                    : "bg-emerald-100 text-emerald-900"
                }
              >
                Account: {profile?.accountStatus || "Active"}
              </Chip>
            </div>
          </div>

          {loading ? (
            <CampusMetricSkeleton
              count={3}
              className="sm:grid-cols-3 xl:grid-cols-3 lg:min-w-[420px]"
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:min-w-[420px]">
              <Card
                shadow="none"
                className="border border-white/20 bg-white/10 text-white"
              >
                <CardBody className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15">
                      <FiCalendar size={18} />
                    </div>
                    <div>
                      <p className="text-sm text-white/70">Upcoming Events</p>
                      <h2 className="text-3xl font-black">{upcomingCount}</h2>
                    </div>
                  </div>
                </CardBody>
              </Card>
              <Card
                shadow="none"
                className="border border-white/20 bg-white/10 text-white"
              >
                <CardBody className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15">
                      <FiCheckCircle size={18} />
                    </div>
                    <div>
                      <p className="text-sm text-white/70">Completed Events</p>
                      <h2 className="text-3xl font-black">{completedCount}</h2>
                    </div>
                  </div>
                </CardBody>
              </Card>
              <Card
                shadow="none"
                className="border border-white/20 bg-white/10 text-white"
              >
                <CardBody className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/15">
                      <FiBell size={18} />
                    </div>
                    <div>
                      <p className="text-sm text-white/70">
                        Unread Notifications
                      </p>
                      <h2 className="text-3xl font-black">
                        {unreadNotificationsCount}
                      </h2>
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}
        </CardBody>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <Card shadow="sm" className="border">
        <CardHeader className="flex flex-col items-start gap-3 px-5 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-campus-text-primary">
              Events Overview
            </h2>
            <p className="text-sm text-campus-text-secondary">
              Your next and most recent event updates in one place.
            </p>
          </div>

          <Link href="/student/event">
            <Button
              variant="flat"
              className="bg-[#7b0000] font-semibold text-white"
              endContent={<FiChevronRight size={16} />}
            >
              View All
            </Button>
          </Link>
        </CardHeader>

        <CardBody className="space-y-4 p-5 pt-3">
          {loading ? (
            <CampusCardListSkeleton rows={3} />
          ) : eventOverview.length === 0 ? (
            <p className="text-sm text-campus-text-secondary">
              No events available for your course/year yet.
            </p>
          ) : (
            eventOverview.map((event) => (
              <Card key={event.id} shadow="none" className="border bg-gray-50">
                <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-semibold text-campus-text-primary">
                        {event.title}
                      </h3>
                      {statusPill(event.status)}
                    </div>
                    <p className="mt-2 text-sm text-campus-text-secondary">
                      {formatEventDate(event)}
                    </p>
                    <p className="mt-1 text-xs text-campus-text-tertiary">
                      {event.location || "TBA"}
                    </p>
                  </div>

                  <Chip
                    variant="bordered"
                    className="font-medium text-campus-text-secondary"
                  >
                    {event.course || "All Courses"}
                  </Chip>
                </CardBody>
              </Card>
            ))
          )}
        </CardBody>
      </Card>

      <Card shadow="sm" className="border">
        <CardHeader className="flex flex-col items-start gap-3 px-5 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-semibold text-campus-text-primary">
                Recent Notifications
              </h3>
              <Chip
                color={unreadNotificationsCount > 0 ? "danger" : "success"}
                variant="flat"
              >
                {loading ? "-" : unreadNotificationsCount} unread
              </Chip>
            </div>
            <p className="text-sm text-campus-text-secondary">
              Latest updates from your events, payments, and EC notices.
            </p>
          </div>

          <Link href="/student/notifications">
            <Button
              variant="flat"
              className="bg-gray-100 font-semibold text-campus-text-primary"
            >
              Open Notifications
            </Button>
          </Link>
        </CardHeader>

        <CardBody className="space-y-3 p-5 pt-3">
          {loading ? (
            <CampusCardListSkeleton rows={3} />
          ) : recentNotifications.length === 0 ? (
            <p className="text-sm text-campus-text-secondary">
              You are all caught up.
            </p>
          ) : (
            recentNotifications.map((item) => (
              <Card key={item.id} shadow="none" className="border bg-white">
                <CardBody className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-campus-text-primary">
                      {item.title}
                    </p>
                    <p className="mt-1 text-sm text-campus-text-secondary">
                      {item.description}
                    </p>
                  </div>

                  <Chip
                    variant="bordered"
                    className="font-medium text-campus-text-secondary"
                  >
                    {toRelativeTime(item.date)}
                  </Chip>
                </CardBody>
              </Card>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}
