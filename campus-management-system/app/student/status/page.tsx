"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardBody } from "@heroui/card";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import { CampusBadge } from "@/components/heroui";
import { useStudentPortal } from "@/components/student/StudentPortalProvider";

const MOBILE_BREAKPOINT = 768;

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

  const [filter, setFilter] = useState<"attended" | "missed" | "payments">(
    "attended"
  );
  const [sortMode, setSortMode] = useState("default");
  const [isMobile, setIsMobile] = useState(false);
  const [attendedPage, setAttendedPage] = useState(1);
  const [missedPage, setMissedPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const statusTabs: Array<{
    label: string;
    value: "attended" | "missed" | "payments";
  }> = [
    { label: "Events Attended", value: "attended" },
    { label: "Events Missed", value: "missed" },
    { label: "Payments", value: "payments" },
  ];

  useEffect(() => {
    const syncMobile = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };

    syncMobile();
    window.addEventListener("resize", syncMobile);
    return () => window.removeEventListener("resize", syncMobile);
  }, []);

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

  const attendedItemsPerPage = isMobile ? 5 : 6;
  const missedItemsPerPage = isMobile ? 5 : 6;
  const paymentsItemsPerPage = isMobile ? 4 : 8;

  const attendedTotalPages = useMemo(
    () => Math.max(1, Math.ceil(attendedEvents.length / attendedItemsPerPage)),
    [attendedEvents.length, attendedItemsPerPage]
  );

  const missedTotalPages = useMemo(
    () => Math.max(1, Math.ceil(missedEvents.length / missedItemsPerPage)),
    [missedEvents.length, missedItemsPerPage]
  );

  const paymentsTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedPayments.length / paymentsItemsPerPage)),
    [sortedPayments.length, paymentsItemsPerPage]
  );

  const paginatedAttendedEvents = useMemo(() => {
    const start = (attendedPage - 1) * attendedItemsPerPage;
    return attendedEvents.slice(start, start + attendedItemsPerPage);
  }, [attendedEvents, attendedItemsPerPage, attendedPage]);

  const paginatedMissedEvents = useMemo(() => {
    const start = (missedPage - 1) * missedItemsPerPage;
    return missedEvents.slice(start, start + missedItemsPerPage);
  }, [missedEvents, missedItemsPerPage, missedPage]);

  const paginatedPayments = useMemo(() => {
    const start = (paymentsPage - 1) * paymentsItemsPerPage;
    return sortedPayments.slice(start, start + paymentsItemsPerPage);
  }, [sortedPayments, paymentsItemsPerPage, paymentsPage]);

  useEffect(() => {
    setAttendedPage((prev) => Math.min(prev, attendedTotalPages));
  }, [attendedTotalPages]);

  useEffect(() => {
    setMissedPage((prev) => Math.min(prev, missedTotalPages));
  }, [missedTotalPages]);

  useEffect(() => {
    setPaymentsPage((prev) => Math.min(prev, paymentsTotalPages));
  }, [paymentsTotalPages]);

  useEffect(() => {
    setPaymentsPage(1);
  }, [sortMode]);

  useEffect(() => {
    if (filter === "attended") setAttendedPage(1);
    if (filter === "missed") setMissedPage(1);
    if (filter === "payments") setPaymentsPage(1);
  }, [filter]);

  const avatarLabel = profile?.studentName
    ? initialsFromName(profile.studentName)
    : "ST";

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 flex items-center justify-center rounded-full bg-primary-500 text-white font-bold">
          {avatarLabel}
        </div>
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-campus-text-primary">
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
        {statusTabs.map((btn) => (
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

      {filter === "attended" && (
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
            <div className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                {paginatedAttendedEvents.map((event) => (
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

              {attendedEvents.length > attendedItemsPerPage && (
                <div className="flex justify-center pt-1">
                  <Pagination
                    showControls
                    page={attendedPage}
                    total={attendedTotalPages}
                    onChange={(page) => setAttendedPage(page)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {filter === "missed" && (
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
              {paginatedMissedEvents.map((event) => (
                <Card key={event.id} shadow="sm" className="bg-red-50 border-red-100">
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

              {missedEvents.length > missedItemsPerPage && (
                <div className="flex justify-center pt-1">
                  <Pagination
                    showControls
                    page={missedPage}
                    total={missedTotalPages}
                    onChange={(page) => setMissedPage(page)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {filter === "payments" && (
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
              className="w-full sm:w-48"
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
              {paginatedPayments.map((payment) => (
                <Card
                  key={payment.paymentId}
                  shadow="sm"
                  className={
                    payment.status === "PAID"
                      ? "bg-green-50 border-green-100"
                      : "bg-red-50 border-red-100"
                  }
                >
                  <CardBody className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
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

              {sortedPayments.length > paymentsItemsPerPage && (
                <div className="flex justify-center pt-1">
                  <Pagination
                    showControls
                    page={paymentsPage}
                    total={paymentsTotalPages}
                    onChange={(page) => setPaymentsPage(page)}
                  />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
