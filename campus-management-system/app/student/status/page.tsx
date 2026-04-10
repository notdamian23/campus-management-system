"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import { Tab, Tabs } from "@heroui/tabs";
import { CampusCardListSkeleton, CampusMetricSkeleton } from "@/components/ui";
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
    "attended",
  );
  const [sortMode, setSortMode] = useState("default");
  const [isMobile, setIsMobile] = useState(false);
  const [inactiveModalOpen, setInactiveModalOpen] = useState(false);
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
            (b.eventDate?.getTime() ?? 0) - (a.eventDate?.getTime() ?? 0),
        ),
    [events],
  );

  const missedEvents = useMemo(
    () =>
      events
        .filter((event) => event.status === "Missed")
        .sort(
          (a, b) =>
            (b.eventDate?.getTime() ?? 0) - (a.eventDate?.getTime() ?? 0),
        ),
    [events],
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
    [attendedEvents.length, attendedItemsPerPage],
  );

  const missedTotalPages = useMemo(
    () => Math.max(1, Math.ceil(missedEvents.length / missedItemsPerPage)),
    [missedEvents.length, missedItemsPerPage],
  );

  const paymentsTotalPages = useMemo(
    () => Math.max(1, Math.ceil(sortedPayments.length / paymentsItemsPerPage)),
    [sortedPayments.length, paymentsItemsPerPage],
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

  useEffect(() => {
    setInactiveModalOpen(profile?.accountStatus === "Inactive");
  }, [profile?.accountStatus]);

  const avatarLabel = profile?.studentName
    ? initialsFromName(profile.studentName)
    : "ST";

  return (
    <div className="space-y-6 sm:space-y-8">
      <Modal
        isOpen={inactiveModalOpen}
        onOpenChange={setInactiveModalOpen}
        isDismissable={false}
        hideCloseButton
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Account Inactive</ModalHeader>
              <ModalBody>
                <p className="text-sm text-campus-text-secondary">
                  Approach ec member to make account active.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button className="bg-[#7b0000] text-white" onPress={onClose}>
                  Okay
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Card
        shadow="sm"
        className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#b71f1f] to-[#f09a4a] text-white"
      >
        <CardBody className="flex flex-col gap-4 p-5 sm:p-6 sm:flex-row sm:items-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-lg font-bold">
            {avatarLabel}
          </div>
          <div>
            <h1 className="text-2xl font-black sm:text-3xl">Student Status</h1>
            <p className="text-sm text-white/80 sm:text-base">
              Overview of your attendance and payment standing.
            </p>
          </div>
        </CardBody>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <CampusMetricSkeleton
          count={3}
          className="sm:grid-cols-3 xl:grid-cols-3"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Card shadow="sm" className="border">
            <CardBody className="p-5">
              <p className="text-sm text-campus-text-secondary">Attended</p>
              <h2 className="mt-2 text-3xl font-black text-emerald-600">
                {attendedEvents.length}
              </h2>
            </CardBody>
          </Card>
          <Card shadow="sm" className="border">
            <CardBody className="p-5">
              <p className="text-sm text-campus-text-secondary">Missed</p>
              <h2 className="mt-2 text-3xl font-black text-rose-600">
                {missedEvents.length}
              </h2>
            </CardBody>
          </Card>
          <Card shadow="sm" className="border">
            <CardBody className="p-5">
              <p className="text-sm text-campus-text-secondary">Payments</p>
              <h2 className="mt-2 text-3xl font-black text-amber-600">
                {payments.length}
              </h2>
            </CardBody>
          </Card>
        </div>
      )}

      <Card shadow="sm" className="border">
        <CardHeader className="px-5 pt-5">
          <div>
            <h2 className="text-lg font-semibold text-campus-text-primary">
              Status Views
            </h2>
            <p className="text-sm text-campus-text-secondary">
              Switch between attendance history and payment records.
            </p>
          </div>
        </CardHeader>
        <CardBody className="p-4 pt-2">
          <Tabs
            selectedKey={filter}
            onSelectionChange={(key) =>
              setFilter(String(key) as "attended" | "missed" | "payments")
            }
            fullWidth
            classNames={{
              tabList:
                "grid w-full grid-cols-1 gap-2 rounded-2xl bg-gray-100 p-1 sm:grid-cols-3",
              cursor: "bg-primary-500",
              tab: "h-11",
              tabContent:
                "text-sm font-semibold group-data-[selected=true]:text-white",
            }}
          >
            {statusTabs.map((item) => (
              <Tab key={item.value} title={item.label} />
            ))}
          </Tabs>
        </CardBody>
      </Card>

      {filter === "attended" && (
        <div>
          <h2 className="font-semibold text-campus-text-primary mb-3 flex items-center gap-2">
            <span className="text-green-600">+</span> Events Attended
          </h2>

          {loading ? (
            <CampusCardListSkeleton rows={3} />
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
            <CampusCardListSkeleton rows={3} />
          ) : missedEvents.length === 0 ? (
            <p className="text-sm text-campus-text-secondary">
              No missed events found.
            </p>
          ) : (
            <div className="space-y-3">
              {paginatedMissedEvents.map((event) => (
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
            <CampusCardListSkeleton rows={3} />
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
