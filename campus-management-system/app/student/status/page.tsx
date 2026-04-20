"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import {
  CheckCircle2,
  CircleAlert,
  CreditCard,
  Landmark,
  ShieldCheck,
  ShieldAlert,
} from "lucide-react";
import { CampusMetricSkeleton } from "@/components/ui";
import {
  StudentCardStackSkeleton,
  StudentEmptyState,
  StudentEventCard,
  StudentPageHeader,
  StudentPaymentCard,
  StudentStatsGrid,
  StudentStatusTabs,
  buildStudentAudienceLabel,
  formatStudentDateLabel,
  isStudentPaymentOverdue,
  studentPaymentFooter,
  studentStatusIcons,
  useStudentPageErrorToast,
  useStudentPortal,
} from "@/components/student";
import { formatEventScheduleDisplay } from "@/lib/eventSchedule";

type StatusTab = "attended" | "missed" | "payments";
type PaymentSortMode = "default" | "paid" | "unpaid";

export default function StudentStatus() {
  const { profile, events, payments, loading, error } = useStudentPortal();

  useStudentPageErrorToast(error, "student status");

  const [selectedTab, setSelectedTab] = useState<StatusTab>("attended");
  const [inactiveModalOpen, setInactiveModalOpen] = useState(false);
  const [paymentSort, setPaymentSort] = useState<PaymentSortMode>("default");
  const [attendedPage, setAttendedPage] = useState(1);
  const [missedPage, setMissedPage] = useState(1);
  const [paymentsPage, setPaymentsPage] = useState(1);
  const readyForClearance = profile?.readyForClearance === true;

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
      if (paymentSort === "paid") {
        if (a.status === b.status) return b.updatedAtMs - a.updatedAtMs;
        return a.status === "PAID" ? -1 : 1;
      }

      if (paymentSort === "unpaid") {
        if (a.status === b.status) return b.updatedAtMs - a.updatedAtMs;
        return a.status === "UNPAID" ? -1 : 1;
      }

      return b.updatedAtMs - a.updatedAtMs;
    });

    return rows;
  }, [paymentSort, payments]);

  const attendedPerPage = 6;
  const missedPerPage = 6;
  const paymentsPerPage = 5;

  const attendedTotalPages = Math.max(
    1,
    Math.ceil(attendedEvents.length / attendedPerPage),
  );
  const missedTotalPages = Math.max(
    1,
    Math.ceil(missedEvents.length / missedPerPage),
  );
  const paymentsTotalPages = Math.max(
    1,
    Math.ceil(sortedPayments.length / paymentsPerPage),
  );

  const paginatedAttendedEvents = attendedEvents.slice(
    (attendedPage - 1) * attendedPerPage,
    attendedPage * attendedPerPage,
  );
  const paginatedMissedEvents = missedEvents.slice(
    (missedPage - 1) * missedPerPage,
    missedPage * missedPerPage,
  );
  const paginatedPayments = sortedPayments.slice(
    (paymentsPage - 1) * paymentsPerPage,
    paymentsPage * paymentsPerPage,
  );

  useEffect(() => {
    setInactiveModalOpen(profile?.accountStatus === "Inactive");
  }, [profile?.accountStatus]);

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
  }, [paymentSort]);

  return (
    <div className="space-y-5 sm:space-y-6">
      <Modal
        isOpen={inactiveModalOpen}
        onOpenChange={setInactiveModalOpen}
        isDismissable={false}
        hideCloseButton
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Account inactive</ModalHeader>
              <ModalBody>
                <p className="text-sm leading-6 text-campus-text-secondary">
                  Approach EC member to make your account active before using event registration features.
                </p>
              </ModalBody>
              <ModalFooter>
                <Button color="primary" onPress={onClose}>
                  Okay
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <StudentPageHeader
        variant="hero"
        icon={Landmark}
        title="Student Status"
        description="Review your attended events, missed events, and current payment standing without losing track of what needs follow-up next."
      />

      {loading ? (
        <CampusMetricSkeleton
          count={4}
          className="sm:grid-cols-2 xl:grid-cols-4"
        />
      ) : (
        <StudentStatsGrid
          items={[
            {
              label: "Attended",
              value: attendedEvents.length,
              description: "Completed events where your attendance was marked present.",
              tone: "green",
              icon: CheckCircle2,
            },
            {
              label: "Missed",
              value: missedEvents.length,
              description: "Completed events where attendance was not marked present.",
              tone: "red",
              icon: CircleAlert,
            },
            {
              label: "Payments",
              value: payments.length,
              description: "Payment records currently assigned to your account.",
              tone: "amber",
              icon: CreditCard,
            },
            {
              label: "Clearance Status",
              value: readyForClearance
                ? "Ready for clearance signing"
                : "Not ready for clearance signing",
              description:
                "Updated by EC members when your account is cleared for signing.",
              tone: readyForClearance ? "green" : "red",
              icon: ShieldCheck,
              surfaceTone: true,
              valueClassName: "text-lg font-semibold leading-7 sm:text-xl",
            },
          ]}
        />
      )}

      <div className="space-y-4">
        <StudentStatusTabs
          items={[
            {
              key: "attended",
              label: "Events Attended",
              icon: studentStatusIcons.attended,
            },
            {
              key: "missed",
              label: "Events Missed",
              icon: studentStatusIcons.missed,
            },
            {
              key: "payments",
              label: "Payments",
              icon: studentStatusIcons.payments,
            },
          ]}
          selectedKey={selectedTab}
          onSelectionChange={setSelectedTab}
        />

        {selectedTab === "attended" ? (
          <div className="space-y-4">
            {loading ? (
              <StudentCardStackSkeleton rows={3} />
            ) : paginatedAttendedEvents.length === 0 ? (
              <StudentEmptyState
                title="No attended events yet"
                description="Once your attendance is recorded as present, those events will appear here."
                icon={CheckCircle2}
                tone="green"
                compact
              />
            ) : (
              <div className="space-y-3">
                {paginatedAttendedEvents.map((event) => (
                  <StudentEventCard
                    key={event.id}
                    title={event.title}
                    description={event.description}
                    scheduleLabel={
                      formatEventScheduleDisplay({
                        date: event.eventDate ?? event.date,
                        scheduledTime: event.scheduledTime,
                        timeStart: event.timeStart,
                        timeEnd: event.timeEnd,
                      }).scheduleLabel
                    }
                    location={event.location}
                    status={event.status}
                    audienceLabel={buildStudentAudienceLabel(
                      event.course,
                      event.yearLevel,
                    )}
                  />
                ))}
              </div>
            )}

            {!loading && attendedEvents.length > attendedPerPage ? (
              <div className="flex justify-center sm:justify-end">
                <Pagination
                  showControls
                  page={attendedPage}
                  total={attendedTotalPages}
                  onChange={(page) => setAttendedPage(page)}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedTab === "missed" ? (
          <div className="space-y-4">
            {loading ? (
              <StudentCardStackSkeleton rows={3} />
            ) : paginatedMissedEvents.length === 0 ? (
              <StudentEmptyState
                title="No missed events found"
                description="Your missed event history will appear here when a completed event is marked absent or not attended."
                icon={ShieldAlert}
                tone="red"
                compact
              />
            ) : (
              <div className="space-y-3">
                {paginatedMissedEvents.map((event) => (
                  <StudentEventCard
                    key={event.id}
                    title={event.title}
                    description={event.description}
                    scheduleLabel={
                      formatEventScheduleDisplay({
                        date: event.eventDate ?? event.date,
                        scheduledTime: event.scheduledTime,
                        timeStart: event.timeStart,
                        timeEnd: event.timeEnd,
                      }).scheduleLabel
                    }
                    location={event.location}
                    status={event.status}
                    audienceLabel={buildStudentAudienceLabel(
                      event.course,
                      event.yearLevel,
                    )}
                    footer={
                      <p className="text-sm text-rose-700">
                        This event was completed without a present attendance record.
                      </p>
                    }
                  />
                ))}
              </div>
            )}

            {!loading && missedEvents.length > missedPerPage ? (
              <div className="flex justify-center sm:justify-end">
                <Pagination
                  showControls
                  page={missedPage}
                  total={missedTotalPages}
                  onChange={(page) => setMissedPage(page)}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {selectedTab === "payments" ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-[24px] border border-border/70 bg-white/90 p-4 shadow-[var(--shadow-soft)] sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-campus-text-primary">
                  Payment records
                </p>
                <p className="text-sm text-campus-text-secondary">
                  Sort your assigned records to review what is paid and what still needs attention.
                </p>
              </div>

              <Select
                aria-label="Sort payments"
                disallowEmptySelection
                selectedKeys={new Set([paymentSort])}
                onSelectionChange={(keys) => {
                  if (keys === "all") return;
                  const selected = Array.from(keys)[0];
                  if (typeof selected === "string") {
                    setPaymentSort(selected as PaymentSortMode);
                  }
                }}
                className="w-full sm:w-56"
              >
                <SelectItem key="default">Most recent</SelectItem>
                <SelectItem key="paid">Paid first</SelectItem>
                <SelectItem key="unpaid">Unpaid first</SelectItem>
              </Select>
            </div>

            {loading ? (
              <StudentCardStackSkeleton rows={3} />
            ) : paginatedPayments.length === 0 ? (
              <StudentEmptyState
                title="No payment records found"
                description="Assigned payment records will appear here when they are available for your account."
                icon={CreditCard}
                tone="blue"
                compact
              />
            ) : (
              <div className="space-y-3">
                {paginatedPayments.map((payment) => {
                  const overdue = isStudentPaymentOverdue(payment);

                  return (
                    <StudentPaymentCard
                      key={payment.paymentId}
                      title={payment.title}
                      ref={payment.ref}
                      amount={payment.amount}
                      dateLabel={formatStudentDateLabel(
                        payment.date,
                        payment.updatedAtMs || payment.createdAtMs,
                      )}
                      status={payment.status}
                      details={payment.details}
                      footer={
                        <div className="flex flex-wrap gap-2">
                          {studentPaymentFooter(payment)}
                          {overdue ? (
                            <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-semibold text-rose-700">
                              Follow up soon
                            </span>
                          ) : null}
                        </div>
                      }
                    />
                  );
                })}
              </div>
            )}

            {!loading && sortedPayments.length > paymentsPerPage ? (
              <div className="flex justify-center sm:justify-end">
                <Pagination
                  showControls
                  page={paymentsPage}
                  total={paymentsTotalPages}
                  onChange={(page) => setPaymentsPage(page)}
                />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
