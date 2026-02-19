"use client";

import { Card, CardBody } from "@heroui/card";
import {
  StudentNotificationType,
  useStudentPortal,
} from "@/components/student/StudentPortalProvider";

function getCardClasses(type: StudentNotificationType) {
  if (type === "upcoming") {
    return "bg-green-50 border-l-4 border-green-400";
  }
  if (type === "preregister") {
    return "bg-blue-50 border-l-4 border-blue-400";
  }
  if (type === "payment") {
    return "bg-yellow-50 border-l-4 border-yellow-400";
  }
  if (type === "missed") {
    return "bg-red-50 border-l-4 border-red-400";
  }
  if (type === "announcement") {
    return "bg-indigo-50 border-l-4 border-indigo-400";
  }
  return "bg-white border-l-4 border-gray-200";
}

export default function NotificationsPage() {
  const { notifications, loading, error } = useStudentPortal();

  return (
    <main className="min-h-screen bg-[#f7f7f7] px-8 py-6">
      <h1 className="text-3xl font-extrabold text-primary-900 mb-4">
        Notifications
      </h1>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-campus-text-secondary">Loading notifications...</p>
      ) : notifications.length === 0 ? (
        <p className="text-sm text-campus-text-secondary">
          No notifications available.
        </p>
      ) : (
        <div className="space-y-4 max-w-4xl">
          {notifications.map((item) => (
            <Card key={item.id} shadow="sm" className={getCardClasses(item.type)}>
              <CardBody className="flex flex-row gap-3 p-4">
                <div className="mt-1">
                  <span className="material-icons text-campus-text-tertiary text-lg">
                    event_note
                  </span>
                </div>

                <div className="flex-1">
                  <h2 className="font-semibold text-sm md:text-base text-campus-text-primary">
                    {item.title}
                  </h2>
                  <p className="text-xs md:text-sm text-campus-text-secondary">
                    {item.description}
                  </p>
                  <p className="text-[11px] md:text-xs text-campus-text-tertiary mt-1">
                    {item.displayDate}
                  </p>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
