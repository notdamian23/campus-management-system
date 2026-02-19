"use client";

import { useMemo, useState } from "react";
import { Card, CardBody } from "@heroui/card";
import { Select, SelectItem } from "@heroui/select";
import { CampusBadge } from "@/components/heroui";
import { useStudentPortal } from "@/components/student/StudentPortalProvider";

function initialsFromName(name: string) {
  const parts = name
    .split(" ")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return "ST";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function formatEventDate(date: Date | null, fallback: string) {
  if (!date) return fallback || "No date";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function StudentStatus() {
  const { profile, events, payments, loading, error } = useStudentPortal();

  const [filter, setFilter] = useState("all");
  const [sortMode, setSortMode] = useState("default");

  const attendedEvents = useMemo(
    () =>
      events
        .filter((event) => event.status === "Attended")
        .sort(
          (a, b) =>
            (b.eventDate?.getTime() ?? 0) - (a.eventDate?.getTime() ?? 0)
        ),
    [events]
  );

  const missedEvents = useMemo(
    () =>
      events
        .filter((event) => event.status === "Missed")
        .sort(
          (a, b) =>
            (b.eventDate?.getTime() ?? 0) - (a.eventDate?.getTime() ?? 0)
        ),
    [events]
  );

  const sortedPayments = useMemo(() => {
    const rows = [...payments];
    rows.sort((a, b) => {
      if (sortMode === "paid") {
        if (a.status === b.status) return 0;
        return a.status === "PAID" ? -1 : 1;
      }
      if (sortMode === "unpaid") {
        if (a.status === b.status) return 0;
        return a.status === "UNPAID" ? -1 : 1;
      }
      return b.updatedAtMs - a.updatedAtMs;
    });
    return rows;
  }, [payments, sortMode]);

  const avatarLabel = profile?.studentName
    ? initialsFromName(profile.studentName)
    : "ST";

  return (
    <div className="p-10 space-y-10 bg-gray-50 min-h-screen">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 flex items-center justify-center rounded-full bg-primary-500 text-white font-bold">
          {avatarLabel}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-campus-text-primary">
            Student Status
          </h1>
          <p className="text-sm text-campus-text-secondary">
            Overview of your attendance and payments
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3 bg-white border rounded-xl p-4 shadow-sm">
        {[
          { label: "All", value: "all" },
          { label: "Events Attended", value: "attended" },
          { label: "Events Missed", value: "missed" },
          { label: "Payments", value: "payments" },
        ].map((btn) => (
          <button
            key={btn.value}
            onClick={() => setFilter(btn.value)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
              filter === btn.value
                ? "bg-primary-500 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {(filter === "all" || filter === "attended") && (
        <div>
          <h2 className="font-semibold text-campus-text-primary mb-3 flex items-center gap-2">
            <span className="text-green-600">+</span> Events Attended
          </h2>

          {loading ? (
            <p className="text-sm text-campus-text-secondary">
              Loading attended events...
            </p>
          ) : attendedEvents.length === 0 ? (
            <p className="text-sm text-campus-text-secondary">
              No attended events found yet.
            </p>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {attendedEvents.map((event) => (
                <Card key={event.id} shadow="sm" isPressable>
                  <CardBody>
                    <h3 className="font-semibold text-campus-text-primary">
                      {event.title}
                    </h3>
                    <p className="text-sm text-campus-text-secondary">
                      {formatEventDate(event.eventDate, event.date)} |{" "}
                      {event.scheduledTime}
                    </p>
                    <p className="text-xs text-campus-text-secondary">
                      {event.location || "TBA"}
                    </p>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {(filter === "all" || filter === "missed") && (
        <div>
          <h2 className="font-semibold text-campus-text-primary mb-3 flex items-center gap-2">
            <span className="text-red-600">x</span> Events Missed
          </h2>

          {loading ? (
            <p className="text-sm text-campus-text-secondary">
              Loading missed events...
            </p>
          ) : missedEvents.length === 0 ? (
            <p className="text-sm text-campus-text-secondary">
              No missed events found.
            </p>
          ) : (
            <div className="space-y-3">
              {missedEvents.map((event) => (
                <Card
                  key={event.id}
                  shadow="sm"
                  className="bg-red-50 border-red-100"
                >
                  <CardBody>
                    <h3 className="font-semibold text-campus-text-primary">
                      {event.title}
                    </h3>
                    <p className="text-sm text-campus-text-secondary">
                      {formatEventDate(event.eventDate, event.date)} |{" "}
                      {event.scheduledTime}
                    </p>
                    <p className="text-xs text-campus-text-secondary">
                      {event.location || "TBA"}
                    </p>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {(filter === "all" || filter === "payments") && (
        <div>
          <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
            <h2 className="font-semibold text-campus-text-primary text-lg">
              Payments
            </h2>

            <Select
              size="sm"
              label="Sort by"
              selectedKeys={[sortMode]}
              onChange={(e) => setSortMode(e.target.value)}
              className="w-48"
            >
              <SelectItem key="default">Default</SelectItem>
              <SelectItem key="paid">PAID First</SelectItem>
              <SelectItem key="unpaid">UNPAID First</SelectItem>
            </Select>
          </div>

          {loading ? (
            <p className="text-sm text-campus-text-secondary">
              Loading payments...
            </p>
          ) : sortedPayments.length === 0 ? (
            <p className="text-sm text-campus-text-secondary">
              No payment records found for your account.
            </p>
          ) : (
            <div className="space-y-3">
              {sortedPayments.map((payment) => (
                <Card
                  key={payment.paymentId}
                  shadow="sm"
                  className={
                    payment.status === "PAID"
                      ? "bg-green-50 border-green-100"
                      : "bg-red-50 border-red-100"
                  }
                >
                  <CardBody className="flex flex-row justify-between items-center gap-4">
                    <div>
                      <p className="font-medium text-campus-text-primary">
                        {payment.title}
                      </p>
                      <p className="text-xs text-campus-text-secondary">
                        Ref: {payment.ref} | Date: {payment.date || "-"}
                      </p>
                    </div>

                    <CampusBadge
                      status={payment.status === "PAID" ? "paid" : "unpaid"}
                    >
                      {payment.status}
                    </CampusBadge>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
