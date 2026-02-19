"use client";

import Link from "next/link";
import { FiBell, FiChevronRight } from "react-icons/fi";
import { Card, CardBody, CardHeader } from "@heroui/card";
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
      <span className="px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-700">
        Payment Due
      </span>
    );
  }
  return (
    <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-campus-text-primary">
      Pre-registration
    </span>
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
  const { profile, events, notifications, loading, error } = useStudentPortal();

  const upcomingCount = events.filter((e) => e.lifecycle !== "completed").length;
  const completedCount = events.filter((e) => e.lifecycle === "completed").length;

  const eventOverview = [...events]
    .sort((a, b) => {
      const now = Date.now();
      const aMs = a.eventDate?.getTime() ?? 0;
      const bMs = b.eventDate?.getTime() ?? 0;
      const aBucket = aMs >= now ? 0 : 1;
      const bBucket = bMs >= now ? 0 : 1;

      if (aBucket !== bBucket) return aBucket - bBucket;
      return aBucket === 0 ? aMs - bMs : bMs - aMs;
    })
    .slice(0, 3);

  const recentNotifications = notifications.slice(0, 2);

  return (
    <div className="p-8 space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary-900">
          Welcome back{profile?.studentName ? `, ${profile.studentName}` : ""}!
        </h1>
        <p className="text-campus-text-secondary text-sm">
          Here is what is happening today.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card shadow="sm" isPressable>
          <CardBody>
            <p className="text-campus-text-secondary text-sm">Upcoming Events</p>
            <h2 className="text-3xl font-bold text-primary-700 mt-2">
              {loading ? "-" : upcomingCount}
            </h2>
          </CardBody>
        </Card>

        <Card shadow="sm" isPressable>
          <CardBody>
            <p className="text-campus-text-secondary text-sm">Completed Events</p>
            <h2 className="text-3xl font-bold text-green-600 mt-2">
              {loading ? "-" : completedCount}
            </h2>
          </CardBody>
        </Card>

        <Card shadow="sm" isPressable>
          <CardBody>
            <p className="text-campus-text-secondary text-sm">Notifications</p>
            <div className="flex items-center gap-2 mt-2">
              <FiBell className="text-red-500" size={22} />
              <h2 className="text-3xl font-bold text-red-600">
                {loading ? "-" : notifications.length}
              </h2>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card shadow="sm">
        <CardHeader className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-campus-text-primary">
            Events Overview
          </h2>
          <Link
            href="/student/event"
            className="text-sm text-primary-700 hover:underline flex items-center gap-1"
          >
            View All <FiChevronRight size={16} />
          </Link>
        </CardHeader>
        <CardBody>
          {loading ? (
            <p className="text-sm text-campus-text-secondary">Loading events...</p>
          ) : eventOverview.length === 0 ? (
            <p className="text-sm text-campus-text-secondary">
              No events available for your course/year yet.
            </p>
          ) : (
            <div className="space-y-4">
              {eventOverview.map((event) => (
                <div
                  key={event.id}
                  className="border rounded-lg p-4 flex justify-between items-center gap-3 hover:bg-gray-50 transition"
                >
                  <div>
                    <h3 className="font-semibold text-campus-text-primary">
                      {event.title}
                    </h3>
                    <p className="text-sm text-campus-text-secondary">
                      {formatEventDate(event)}
                    </p>
                  </div>
                  {statusPill(event.status)}
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <Card shadow="sm">
        <CardHeader className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-campus-text-primary">
            Recent Notifications
          </h3>
          <Link href="/student/notifications" className="text-sm text-primary-700 hover:underline">
            Open Notifications
          </Link>
        </CardHeader>
        <CardBody>
          {loading ? (
            <p className="text-sm text-campus-text-secondary">Loading notifications...</p>
          ) : recentNotifications.length === 0 ? (
            <p className="text-sm text-campus-text-secondary">
              You are all caught up.
            </p>
          ) : (
            <div className="space-y-3">
              {recentNotifications.map((item) => (
                <div
                  key={item.id}
                  className="p-3 border rounded-lg hover:bg-gray-50 transition flex justify-between gap-4"
                >
                  <span className="text-campus-text-primary">{item.title}</span>
                  <span className="text-xs text-campus-text-secondary whitespace-nowrap">
                    {toRelativeTime(item.date)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
