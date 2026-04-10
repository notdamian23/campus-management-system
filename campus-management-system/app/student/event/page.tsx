"use client";

import { useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Select, SelectItem } from "@heroui/select";
import { CampusCardListSkeleton, CampusMetricSkeleton } from "@/components/ui";
import { CampusBadge, CampusButton } from "@/components/heroui";
import {
  StudentEvent,
  StudentEventStatus,
  useStudentPortal,
} from "@/components/student/StudentPortalProvider";
import { campusToast } from "@/lib/toast";

type Notice = {
  type: "ok" | "err";
  msg: string;
};

type EventGroup = {
  date: string;
  dateMs: number;
  items: StudentEvent[];
};

type EventSortMode = "oldest_to_latest" | "latest_to_oldest";
type EventStatusFilter = "all" | "upcoming" | "attended" | "missed";

function eventStatusChip(status: StudentEventStatus) {
  if (status === "Upcoming")
    return <CampusBadge status="upcoming">Upcoming</CampusBadge>;
  if (status === "Attended")
    return <CampusBadge status="completed">Attended</CampusBadge>;
  if (status === "Missed")
    return <CampusBadge status="missed">Missed</CampusBadge>;

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

function getEventTileStyle(status: StudentEventStatus) {
  if (status === "Missed") {
    return {
      backgroundColor: "#FFE8EE",
      borderLeftColor: "#F87171",
    };
  }

  if (status === "Attended") {
    return {
      backgroundColor: "#DCFCE7",
      borderLeftColor: "#4ADE80",
    };
  }

  return {
    backgroundColor: "#CCE3FD",
    borderLeftColor: "#83b8f5",
  };
}

function formatTimeRange(event: StudentEvent) {
  return event.scheduledTime || "TBA";
}

function matchesStatusFilter(item: StudentEvent, filter: EventStatusFilter) {
  if (filter === "all") return true;
  if (filter === "attended") return item.status === "Attended";
  if (filter === "missed") return item.status === "Missed";

  return item.status === "Upcoming" || item.status === "Pre-registration";
}

export default function StudentEvents() {
  const {
    profile,
    events,
    loading,
    error,
    registeredEventIds,
    registerForEvent,
  } = useStudentPortal();

  const [openStates, setOpenStates] = useState<Record<string, boolean>>({});
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sortMode, setSortMode] = useState<EventSortMode>("oldest_to_latest");
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>("all");

  const registeredSet = useMemo(
    () => new Set(registeredEventIds),
    [registeredEventIds],
  );

  const eventOnlyItems = useMemo(
    () => events.filter((item) => item.status !== "Payment Due"),
    [events],
  );

  const filteredEvents = useMemo(
    () =>
      eventOnlyItems.filter((item) => matchesStatusFilter(item, statusFilter)),
    [eventOnlyItems, statusFilter],
  );

  const eventCounts = useMemo(
    () => ({
      upcoming: eventOnlyItems.filter(
        (item) =>
          item.status === "Upcoming" || item.status === "Pre-registration",
      ).length,
      attended: eventOnlyItems.filter((item) => item.status === "Attended")
        .length,
      missed: eventOnlyItems.filter((item) => item.status === "Missed").length,
    }),
    [eventOnlyItems],
  );

  const groupedEvents = useMemo<EventGroup[]>(() => {
    const map = new Map<string, EventGroup>();

    filteredEvents.forEach((item) => {
      const eventDate = item.eventDate;
      const dateLabel = eventDate
        ? eventDate.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
        : "No Date";
      const dateMs = eventDate
        ? new Date(
            eventDate.getFullYear(),
            eventDate.getMonth(),
            eventDate.getDate(),
          ).getTime()
        : Number.MAX_SAFE_INTEGER;

      if (!map.has(dateLabel)) {
        map.set(dateLabel, {
          date: dateLabel,
          dateMs,
          items: [],
        });
      }

      map.get(dateLabel)!.items.push(item);
    });

    const direction = sortMode === "latest_to_oldest" ? -1 : 1;

    return Array.from(map.values())
      .sort((a, b) => (a.dateMs - b.dateMs) * direction)
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) => {
          const aMs = a.eventDate?.getTime() ?? 0;
          const bMs = b.eventDate?.getTime() ?? 0;
          return (aMs - bMs) * direction;
        }),
      }));
  }, [filteredEvents, sortMode]);

  const toggleOpen = (eventId: string) => {
    setOpenStates((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const isOpen = (eventId: string) => Boolean(openStates[eventId]);

  async function handleRegister(eventId: string) {
    setRegisteringId(eventId);
    setNotice(null);

    const result = await registerForEvent(eventId);
    if (result.ok) {
      campusToast.success({
        title: "Registration submitted",
        description: result.msg,
        dedupeKey: `student-events:register:${eventId}`,
      });
    } else {
      campusToast.error({
        title: "Registration failed",
        description: result.msg,
        dedupeKey: `student-events:register-error:${eventId}`,
      });
    }
    setNotice({
      type: result.ok ? "ok" : "err",
      msg: result.msg,
    });
    setRegisteringId(null);
  }

  return (
    <div className="space-y-4 sm:space-y-6 text-campus-text-primary">
      <Card
        shadow="sm"
        className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#bb2020] to-[#f19b4c] text-white"
      >
        <CardBody className="space-y-4 p-5 sm:p-6">
          <div>
            <h1 className="text-2xl font-black sm:text-3xl">Events</h1>
            <p className="text-sm text-white/80 sm:text-base">
              Browse your timeline, open details, and register when
              pre-registration is available.
            </p>
          </div>
          {loading ? (
            <CampusMetricSkeleton
              count={3}
              className="sm:grid-cols-3 xl:grid-cols-3"
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Card
                shadow="none"
                className="border border-white/20 bg-white/10"
              >
                <CardBody className="p-4">
                  <p className="text-sm text-white/70">Upcoming</p>
                  <h2 className="mt-2 text-3xl font-black text-white">
                    {eventCounts.upcoming}
                  </h2>
                </CardBody>
              </Card>
              <Card
                shadow="none"
                className="border border-white/20 bg-white/10"
              >
                <CardBody className="p-4">
                  <p className="text-sm text-white/70">Attended</p>
                  <h2 className="mt-2 text-3xl font-black text-white">
                    {eventCounts.attended}
                  </h2>
                </CardBody>
              </Card>
              <Card
                shadow="none"
                className="border border-white/20 bg-white/10"
              >
                <CardBody className="p-4">
                  <p className="text-sm text-white/70">Missed</p>
                  <h2 className="mt-2 text-3xl font-black text-white">
                    {eventCounts.missed}
                  </h2>
                </CardBody>
              </Card>
            </div>
          )}
        </CardBody>
      </Card>

      <Card shadow="sm" className="border">
        <CardHeader className="px-5 pt-5">
          <div>
            <h2 className="text-lg font-semibold text-campus-text-primary">
              Filters
            </h2>
            <p className="text-sm text-campus-text-secondary">
              Sort the timeline and narrow it by event status.
            </p>
          </div>
        </CardHeader>
        <CardBody className="grid grid-cols-1 gap-3 p-5 pt-3 sm:grid-cols-2">
          <Select
            aria-label="Sort events"
            label="Sort"
            size="sm"
            selectedKeys={[sortMode]}
            onChange={(e) => setSortMode(e.target.value as EventSortMode)}
            disallowEmptySelection
            className="w-full"
          >
            <SelectItem key="oldest_to_latest">Oldest to Latest</SelectItem>
            <SelectItem key="latest_to_oldest">Latest to Oldest</SelectItem>
          </Select>

          <Select
            aria-label="Filter events by status"
            label="Status"
            size="sm"
            selectedKeys={[statusFilter]}
            onChange={(e) =>
              setStatusFilter(e.target.value as EventStatusFilter)
            }
            disallowEmptySelection
            className="w-full"
          >
            <SelectItem key="all">All</SelectItem>
            <SelectItem key="upcoming">Upcoming</SelectItem>
            <SelectItem key="attended">Attended</SelectItem>
            <SelectItem key="missed">Missed</SelectItem>
          </Select>
        </CardBody>
      </Card>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {notice && (
        <div
          className={[
            "mb-6 rounded-lg border px-4 py-3 text-sm",
            notice.type === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-900",
          ].join(" ")}
        >
          {notice.msg}
        </div>
      )}

      {loading ? (
        <CampusCardListSkeleton rows={3} />
      ) : groupedEvents.length === 0 ? (
        <p className="text-sm text-campus-text-secondary">
          No events match the current sort/filter options.
        </p>
      ) : (
        <div className="space-y-8 sm:space-y-10">
          {groupedEvents.map((group) => (
            <div key={group.date}>
              <h2 className="text-lg font-semibold text-campus-text-primary mb-4">
                {group.date}
              </h2>

              <div className="space-y-4">
                {group.items.map((item) => {
                  const open = isOpen(item.id);
                  const registered = registeredSet.has(item.id);
                  const canRegister = item.status === "Pre-registration";
                  const accountInactive = profile?.accountStatus === "Inactive";
                  const requirementText = item.withPayment
                    ? "Bring payment receipt if required."
                    : "Follow event instructions from EC.";

                  return (
                    <Card
                      key={item.id}
                      shadow="sm"
                      isPressable
                      className="w-full border-l-4"
                      style={getEventTileStyle(item.status)}
                    >
                      <CardBody className="p-4 sm:p-5 w-full">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-lg font-semibold leading-snug break-words">
                              {item.title}
                            </h3>
                            <p className="text-sm text-campus-text-secondary mt-1 break-words">
                              {item.description}
                            </p>
                            <p className="text-xs text-campus-text-tertiary mt-2 break-words">
                              {group.date} | {formatTimeRange(item)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {eventStatusChip(item.status)}

                            <Button
                              isIconOnly
                              size="sm"
                              variant="light"
                              className="bg-white/60 text-campus-text-secondary"
                              onPress={() => toggleOpen(item.id)}
                            >
                              <span className="material-icons text-campus-text-secondary text-lg">
                                {open ? "expand_less" : "expand_more"}
                              </span>
                            </Button>
                          </div>
                        </div>

                        {open && (
                          <div className="mt-3 sm:mt-4 p-3 sm:p-4 bg-gray-50 rounded-xl border text-sm space-y-1">
                            <p>
                              <span className="font-medium">Location:</span>{" "}
                              {item.location || "TBA"}
                            </p>
                            <p>
                              <span className="font-medium">Requirement:</span>{" "}
                              {requirementText}
                            </p>
                            <p>
                              <span className="font-medium">Note:</span>{" "}
                              {item.details || "No additional notes."}
                            </p>

                            {canRegister && (
                              <div className="mt-3 space-y-2">
                                <CampusButton
                                  variant="secondary"
                                  className="w-full sm:w-auto"
                                  disabled={
                                    registered ||
                                    registeringId === item.id ||
                                    accountInactive
                                  }
                                  onClick={() => handleRegister(item.id)}
                                >
                                  {registered
                                    ? "Registered"
                                    : registeringId === item.id
                                      ? "Registering..."
                                      : accountInactive
                                        ? "Account Inactive"
                                        : "Register"}
                                </CampusButton>

                                {accountInactive && (
                                  <p className="text-xs text-red-700">
                                    Approach ec member to make account active.
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
