"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Selection } from "@react-types/shared";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Select, SelectItem } from "@heroui/select";
import { BellRing, CheckCheck, Filter, RotateCcw } from "lucide-react";
import {
  type StudentNotificationType,
  StudentCardStackSkeleton,
  StudentEmptyState,
  StudentFilterBar,
  StudentFilterBarSkeleton,
  StudentNotificationCard,
  StudentPageHeader,
  formatStudentRelativeTime,
  useStudentPageErrorToast,
  useStudentPortal,
} from "@/components/student";
import { campusToast } from "@/lib/toast";

type NotificationSortMode = "ascending" | "descending";
type NotificationFilter = "all" | "unread" | StudentNotificationType;

function getSingleSelectionValue(keys: Selection) {
  if (keys === "all") return null;

  const selected = Array.from(keys)[0];
  return typeof selected === "string" ? selected : null;
}

function getNotificationTarget(type: StudentNotificationType) {
  if (type === "payment") {
    return {
      href: "/student/payment",
      label: "Open payment",
    };
  }

  if (type === "upcoming" || type === "missed" || type === "preregister") {
    return {
      href: "/student/event",
      label: "Open events",
    };
  }

  return null;
}

export default function StudentNotificationsPage() {
  const router = useRouter();
  const {
    notifications,
    readNotificationIds,
    unreadNotificationsCount,
    loading,
    error,
    markNotificationRead,
    markAllNotificationsRead,
  } = useStudentPortal();

  useStudentPageErrorToast(error, "student notifications");

  const [sortMode, setSortMode] = useState<NotificationSortMode>("descending");
  const [filterMode, setFilterMode] = useState<NotificationFilter>("all");

  const readSet = useMemo(() => new Set(readNotificationIds), [readNotificationIds]);

  const filteredNotifications = useMemo(() => {
    const filtered = notifications.filter((item) => {
      if (filterMode === "all") return true;
      if (filterMode === "unread") return !readSet.has(item.id);
      return item.type === filterMode;
    });

    return [...filtered].sort((left, right) => {
      if (sortMode === "ascending") {
        return left.date.getTime() - right.date.getTime();
      }

      return right.date.getTime() - left.date.getTime();
    });
  }, [filterMode, notifications, readSet, sortMode]);

  const hasFilterOverrides =
    sortMode !== "descending" || filterMode !== "all";

  function handleMarkRead(notificationId: string) {
    if (readSet.has(notificationId)) return;

    markNotificationRead(notificationId);
    campusToast.info({
      title: "Notification updated",
      description: "This notification is now marked as read.",
      dedupeKey: `student-notifications:mark-read:${notificationId}`,
    });
  }

  function handleMarkAllRead() {
    if (unreadNotificationsCount === 0) return;

    markAllNotificationsRead();
    campusToast.success({
      title: "Notifications updated",
      description: "All visible notifications were marked as read.",
      dedupeKey: "student-notifications:mark-all-read",
    });
  }

  function handleOpenTarget(type: StudentNotificationType, notificationId: string) {
    const target = getNotificationTarget(type);
    if (!target) return;

    markNotificationRead(notificationId);
    router.push(target.href);
  }

  return (
    <div className="space-y-5 text-campus-text-primary sm:space-y-6">
      <StudentPageHeader
        variant="hero"
        icon={BellRing}
        title="Student Notifications"
        description="Stay on top of missed events, payment reminders, and EC announcements from one notification feed designed for quick daily review."
        meta={
          <>
            <Chip className="border border-white/20 bg-white/10 text-white">
              {notifications.length} total
            </Chip>
            <Chip className="border border-white/20 bg-white/10 text-white">
              {unreadNotificationsCount} unread
            </Chip>
          </>
        }
      />

      {loading ? (
        <StudentFilterBarSkeleton filters={3} />
      ) : (
        <StudentFilterBar>
          <Select
            aria-label="Sort notifications"
            label="Sort"
            disallowEmptySelection
            selectedKeys={new Set([sortMode])}
            onSelectionChange={(keys) => {
              const selected = getSingleSelectionValue(keys);
              if (selected) setSortMode(selected as NotificationSortMode);
            }}
          >
            <SelectItem key="descending">Newest first</SelectItem>
            <SelectItem key="ascending">Oldest first</SelectItem>
          </Select>

          <Select
            aria-label="Filter notifications"
            label="Filter"
            disallowEmptySelection
            selectedKeys={new Set([filterMode])}
            onSelectionChange={(keys) => {
              const selected = getSingleSelectionValue(keys);
              if (selected) setFilterMode(selected as NotificationFilter);
            }}
          >
            <SelectItem key="all">All notifications</SelectItem>
            <SelectItem key="unread">Unread only</SelectItem>
            <SelectItem key="upcoming">Upcoming events</SelectItem>
            <SelectItem key="payment">Payment notices</SelectItem>
            <SelectItem key="missed">Missed events</SelectItem>
            <SelectItem key="preregister">Pre-registration</SelectItem>
            <SelectItem key="announcement">General notices</SelectItem>
          </Select>

          <div className="flex flex-col justify-between rounded-[22px] border border-border/70 bg-slate-50/70 p-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-campus-text-primary">
                Notification actions
              </p>
              <p className="text-xs leading-5 text-campus-text-secondary">
                Mark everything as read or clear your filters to return to the default feed.
              </p>
            </div>

            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Button
                color="primary"
                variant="flat"
                startContent={<CheckCheck size={16} />}
                onPress={handleMarkAllRead}
                isDisabled={unreadNotificationsCount === 0}
                className="w-full sm:flex-1"
              >
                Mark all as read
              </Button>

              <Button
                variant="flat"
                startContent={<RotateCcw size={16} />}
                onPress={() => {
                  setSortMode("descending");
                  setFilterMode("all");
                }}
                isDisabled={!hasFilterOverrides}
                className="w-full sm:w-auto"
              >
                Reset
              </Button>
            </div>
          </div>
        </StudentFilterBar>
      )}

      {loading ? (
        <StudentCardStackSkeleton rows={4} />
      ) : filteredNotifications.length === 0 ? (
        <StudentEmptyState
          title="No notifications to show"
          description="You are caught up for this filter. New event, payment, and EC notices will appear here automatically."
          icon={Filter}
          tone="green"
          action={
            hasFilterOverrides ? (
              <Button
                color="primary"
                variant="flat"
                onPress={() => {
                  setSortMode("descending");
                  setFilterMode("all");
                }}
              >
                Reset filters
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-3">
          {filteredNotifications.map((item) => {
            const unread = !readSet.has(item.id);
            const target = getNotificationTarget(item.type);

            return (
              <StudentNotificationCard
                key={item.id}
                title={item.title}
                description={item.description}
                type={item.type}
                displayDate={item.displayDate}
                relativeDate={formatStudentRelativeTime(item.date)}
                unread={unread}
                primaryAction={
                  target ? (
                    <Button
                      color="primary"
                      variant="flat"
                      onPress={() => handleOpenTarget(item.type, item.id)}
                    >
                      {target.label}
                    </Button>
                  ) : undefined
                }
                secondaryAction={
                  unread ? (
                    <Button
                      variant="light"
                      onPress={() => handleMarkRead(item.id)}
                    >
                      Mark as read
                    </Button>
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
