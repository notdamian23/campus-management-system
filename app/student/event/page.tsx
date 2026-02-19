"use client";

import { useMemo, useState } from "react";
import { Card, CardBody } from "@heroui/card";
import { CampusBadge, CampusButton } from "@/components/heroui";
import {
  StudentEvent,
  StudentEventStatus,
  useStudentPortal,
} from "@/components/student/StudentPortalProvider";

type Notice = {
  type: "ok" | "err";
  msg: string;
};

type EventGroup = {
  date: string;
  dateMs: number;
  items: StudentEvent[];
};

function eventStatusChip(status: StudentEventStatus) {
  if (status === "Upcoming") return <CampusBadge status="upcoming">Upcoming</CampusBadge>;
  if (status === "Attended") return <CampusBadge status="completed">Attended</CampusBadge>;
  if (status === "Missed") return <CampusBadge status="missed">Missed</CampusBadge>;

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

function formatTimeRange(event: StudentEvent) {
  return event.scheduledTime || "TBA";
}

export default function StudentEvents() {
  const {
    events,
    loading,
    error,
    registeredEventIds,
    registerForEvent,
  } = useStudentPortal();

  const [openStates, setOpenStates] = useState<Record<string, boolean>>({});
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const registeredSet = useMemo(
    () => new Set(registeredEventIds),
    [registeredEventIds]
  );

  const groupedEvents = useMemo<EventGroup[]>(() => {
    const map = new Map<string, EventGroup>();

    events.forEach((item) => {
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
            eventDate.getDate()
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

    return Array.from(map.values())
      .sort((a, b) => a.dateMs - b.dateMs)
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) => {
          const aMs = a.eventDate?.getTime() ?? 0;
          const bMs = b.eventDate?.getTime() ?? 0;
          return aMs - bMs;
        }),
      }));
  }, [events]);

  const toggleOpen = (eventId: string) => {
    setOpenStates((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const isOpen = (eventId: string) => Boolean(openStates[eventId]);

  async function handleRegister(eventId: string) {
    setRegisteringId(eventId);
    setNotice(null);

    const result = await registerForEvent(eventId);
    setNotice({
      type: result.ok ? "ok" : "err",
      msg: result.msg,
    });
    setRegisteringId(null);
  }

  return (
    <div className="min-h-screen p-10 bg-[#fafafa] text-campus-text-primary">
      <h1 className="text-3xl font-bold mb-8 text-primary-900">Events</h1>

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
        <p className="text-sm text-campus-text-secondary">Loading events...</p>
      ) : groupedEvents.length === 0 ? (
        <p className="text-sm text-campus-text-secondary">
          No events available for your profile yet.
        </p>
      ) : (
        <div className="space-y-12">
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
                  const requirementText = item.withPayment
                    ? "Bring payment receipt if required."
                    : "Follow event instructions from EC.";

                  return (
                    <Card key={item.id} shadow="sm" isPressable>
                      <CardBody className="p-5">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <h3 className="text-lg font-semibold">{item.title}</h3>
                            <p className="text-sm text-campus-text-secondary mt-1">
                              {item.description}
                            </p>
                            <p className="text-xs text-campus-text-tertiary mt-2">
                              {group.date} | {formatTimeRange(item)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            {eventStatusChip(item.status)}

                            <button
                              className="p-1 rounded-full hover:bg-gray-200 transition"
                              onClick={() => toggleOpen(item.id)}
                            >
                              <span className="material-icons text-campus-text-secondary text-lg">
                                {open ? "expand_less" : "expand_more"}
                              </span>
                            </button>
                          </div>
                        </div>

                        {open && (
                          <div className="mt-4 p-4 bg-gray-50 rounded-xl border text-sm space-y-1">
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
                              <CampusButton
                                variant="secondary"
                                className="mt-3"
                                disabled={registered || registeringId === item.id}
                                onClick={() => handleRegister(item.id)}
                              >
                                {registered
                                  ? "Registered"
                                  : registeringId === item.id
                                    ? "Registering..."
                                    : "Register"}
                              </CampusButton>
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
