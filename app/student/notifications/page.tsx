"use client";

import { useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from "@heroui/dropdown";
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

type NotificationSortMode = "ascending" | "descending";

export default function NotificationsPage() {
  const { notifications, loading, error, markNotificationRead } = useStudentPortal();
  const [sortMode, setSortMode] = useState<NotificationSortMode>("descending");

  const sortedNotifications = useMemo(() => {
    const rows = [...notifications];
    rows.sort((a, b) => {
      if (sortMode === "ascending") return a.date.getTime() - b.date.getTime();
      return b.date.getTime() - a.date.getTime();
    });
    return rows;
  }, [notifications, sortMode]);

  return (
    <div className="space-y-4 sm:space-y-5">
      <h1 className="text-2xl sm:text-3xl font-extrabold text-primary-900">
        Notifications
      </h1>

      <div>
        <Dropdown placement="bottom-start">
          <DropdownTrigger>
            <Button
              variant="bordered"
              className="min-w-[170px] justify-between text-sm font-medium"
            >
              <span>
                Sort: {sortMode === "ascending" ? "Ascending" : "Descending"}
              </span>
              <span className="material-icons text-base">expand_more</span>
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label="Sort notifications"
            disallowEmptySelection
            selectionMode="single"
            selectedKeys={new Set([sortMode])}
            onAction={(key) => setSortMode(String(key) as NotificationSortMode)}
          >
            <DropdownItem key="ascending">Ascending</DropdownItem>
            <DropdownItem key="descending">Descending</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-campus-text-secondary">Loading notifications...</p>
      ) : sortedNotifications.length === 0 ? (
        <p className="text-sm text-campus-text-secondary">
          No notifications available.
        </p>
      ) : (
        <div className="space-y-4 w-full max-w-4xl">
          {sortedNotifications.map((item) => (
            <Card
              key={item.id}
              shadow="sm"
              isPressable
              onPress={() => markNotificationRead(item.id)}
              className={`w-full ${getCardClasses(item.type)}`}
            >
              <CardBody className="flex w-full items-start gap-3 p-4">
                <div className="mt-1">
                  <span className="material-icons text-campus-text-tertiary text-lg">
                    event_note
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold text-sm md:text-base text-campus-text-primary break-words">
                    {item.title}
                  </h2>
                  <p className="text-xs md:text-sm text-campus-text-secondary break-words">
                    {item.description}
                  </p>
                  <p className="text-[11px] md:text-xs text-campus-text-tertiary mt-1 break-words">
                    {item.displayDate}
                  </p>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
