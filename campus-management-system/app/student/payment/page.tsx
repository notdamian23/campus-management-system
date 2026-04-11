"use client";

import { useMemo, useState } from "react";
import type { Selection } from "@react-types/shared";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Select, SelectItem } from "@heroui/select";
import { CheckCircle2, CreditCard, RotateCcw, TriangleAlert } from "lucide-react";
import { CampusMetricSkeleton } from "@/components/ui";
import {
  type StudentPayment,
  StudentCardStackSkeleton,
  StudentEmptyState,
  StudentFilterBar,
  StudentFilterBarSkeleton,
  StudentPageHeader,
  StudentPaymentCard,
  StudentStatsGrid,
  formatStudentCurrency,
  formatStudentDateLabel,
  isStudentPaymentOverdue,
  studentPaymentFooter,
  useStudentPageErrorToast,
  useStudentPortal,
} from "@/components/student";

type PaymentSortMode = "latest_to_oldest" | "oldest_to_latest";
type PaymentStatusFilter = "all" | "paid" | "unpaid";

type PaymentGroup = {
  label: string;
  dateMs: number;
  count: number;
  items: StudentPayment[];
};

function getSingleSelectionValue(keys: Selection) {
  if (keys === "all") return null;

  const selected = Array.from(keys)[0];
  return typeof selected === "string" ? selected : null;
}

function getPaymentDateMs(dateLabel: string, fallbackMs: number) {
  const parsed = new Date(`${dateLabel}T00:00:00`).getTime();
  if (!Number.isNaN(parsed)) return parsed;
  return fallbackMs;
}

function getPaymentGroupLabel(rawDate: string, fallbackMs: number) {
  if (rawDate) {
    const parsed = new Date(`${rawDate}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    }
  }

  if (fallbackMs) {
    return new Date(fallbackMs).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  return "No due date";
}

export default function StudentPaymentsPage() {
  const { payments, loading, error } = useStudentPortal();

  useStudentPageErrorToast(error, "student payments");

  const [sortMode, setSortMode] = useState<PaymentSortMode>("latest_to_oldest");
  const [statusFilter, setStatusFilter] = useState<PaymentStatusFilter>("all");

  const filteredPayments = useMemo(() => {
    if (statusFilter === "all") return payments;
    if (statusFilter === "paid") {
      return payments.filter((item) => item.status === "PAID");
    }

    return payments.filter((item) => item.status === "UNPAID");
  }, [payments, statusFilter]);

  const groupedPayments = useMemo(() => {
    const direction = sortMode === "latest_to_oldest" ? -1 : 1;
    const groups = new Map<string, PaymentGroup>();

    filteredPayments.forEach((item) => {
      const fallbackMs = item.updatedAtMs || item.createdAtMs || 0;
      const label = getPaymentGroupLabel(item.date, fallbackMs);
      const dateMs = getPaymentDateMs(item.date, fallbackMs);

      if (!groups.has(label)) {
        groups.set(label, {
          label,
          dateMs,
          count: 0,
          items: [],
        });
      }

      const group = groups.get(label);
      if (!group) return;
      group.items.push(item);
      group.count += 1;
    });

    return Array.from(groups.values())
      .sort((left, right) => (left.dateMs - right.dateMs) * direction)
      .map((group) => ({
        ...group,
        items: [...group.items].sort((left, right) => {
          const leftMs = getPaymentDateMs(
            left.date,
            left.updatedAtMs || left.createdAtMs || 0,
          );
          const rightMs = getPaymentDateMs(
            right.date,
            right.updatedAtMs || right.createdAtMs || 0,
          );

          return (leftMs - rightMs) * direction;
        }),
      }));
  }, [filteredPayments, sortMode]);

  const paidCount = useMemo(
    () => payments.filter((item) => item.status === "PAID").length,
    [payments],
  );
  const unpaidCount = useMemo(
    () => payments.filter((item) => item.status === "UNPAID").length,
    [payments],
  );
  const overdueCount = useMemo(
    () => payments.filter((item) => isStudentPaymentOverdue(item)).length,
    [payments],
  );
  const totalOutstanding = useMemo(
    () =>
      payments
        .filter((item) => item.status === "UNPAID")
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [payments],
  );

  const hasFilterOverrides =
    sortMode !== "latest_to_oldest" || statusFilter !== "all";

  return (
    <div className="space-y-5 text-campus-text-primary sm:space-y-6">
      <StudentPageHeader
        variant="hero"
        icon={CreditCard}
        title="Student Payments"
        description="Review due dates, understand what is already settled, and spot outstanding records faster from a cleaner mobile-ready payment workspace."
        meta={
          <>
            <Chip className="border border-white/20 bg-white/10 text-white">
              {unpaidCount} unpaid
            </Chip>
            <Chip className="border border-white/20 bg-white/10 text-white">
              {overdueCount} overdue
            </Chip>
          </>
        }
      />

      {loading ? (
        <CampusMetricSkeleton count={3} className="sm:grid-cols-3 xl:grid-cols-3" />
      ) : (
        <StudentStatsGrid
          items={[
            {
              label: "Total Records",
              value: payments.length,
              description: "Payment records currently assigned to your student account.",
              tone: "blue",
              icon: CreditCard,
            },
            {
              label: "Paid",
              value: paidCount,
              description: "Records already settled and reflected in the system.",
              tone: "green",
              icon: CheckCircle2,
            },
            {
              label: "Outstanding",
              value: formatStudentCurrency(totalOutstanding),
              description: "Current unpaid amount based on visible student records.",
              tone: overdueCount > 0 ? "red" : "amber",
              icon: TriangleAlert,
            },
          ]}
          className="xl:grid-cols-3"
        />
      )}

      {loading ? (
        <StudentFilterBarSkeleton filters={3} />
      ) : (
        <StudentFilterBar>
          <Select
            aria-label="Sort payment records"
            label="Sort"
            disallowEmptySelection
            selectedKeys={new Set([sortMode])}
            onSelectionChange={(keys) => {
              const selected = getSingleSelectionValue(keys);
              if (selected) setSortMode(selected as PaymentSortMode);
            }}
          >
            <SelectItem key="latest_to_oldest">Latest to oldest</SelectItem>
            <SelectItem key="oldest_to_latest">Oldest to latest</SelectItem>
          </Select>

          <Select
            aria-label="Filter payment records by status"
            label="Status"
            disallowEmptySelection
            selectedKeys={new Set([statusFilter])}
            onSelectionChange={(keys) => {
              const selected = getSingleSelectionValue(keys);
              if (selected) setStatusFilter(selected as PaymentStatusFilter);
            }}
          >
            <SelectItem key="all">All records</SelectItem>
            <SelectItem key="paid">Paid</SelectItem>
            <SelectItem key="unpaid">Unpaid</SelectItem>
          </Select>

          <div className="flex flex-col justify-between rounded-[22px] border border-border/70 bg-slate-50/70 p-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-campus-text-primary">
                Quick actions
              </p>
              <p className="text-xs leading-5 text-campus-text-secondary">
                Return to the default payment view whenever you need the full list again.
              </p>
            </div>

            <Button
              variant="flat"
              startContent={<RotateCcw size={16} />}
              onPress={() => {
                setSortMode("latest_to_oldest");
                setStatusFilter("all");
              }}
              isDisabled={!hasFilterOverrides}
              className="mt-3 w-full sm:w-auto"
            >
              Reset filters
            </Button>
          </div>
        </StudentFilterBar>
      )}

      {loading ? (
        <StudentCardStackSkeleton rows={4} />
      ) : groupedPayments.length === 0 ? (
        <StudentEmptyState
          title="No payment records found"
          description="Try another filter or reset the payment view to see all records assigned to your account."
          icon={CreditCard}
          tone="blue"
          action={
            hasFilterOverrides ? (
              <Button
                color="primary"
                variant="flat"
                onPress={() => {
                  setSortMode("latest_to_oldest");
                  setStatusFilter("all");
                }}
              >
                Reset filters
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-6">
          {groupedPayments.map((group) => (
            <section key={`${group.label}-${group.dateMs}`} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-campus-text-primary">
                    {group.label}
                  </h2>
                  <p className="text-sm text-campus-text-secondary">
                    {group.count} payment record{group.count === 1 ? "" : "s"} in this due date group.
                  </p>
                </div>

                <Chip size="sm" className="bg-slate-100 text-slate-700">
                  {group.count} shown
                </Chip>
              </div>

              <div className="space-y-3">
                {group.items.map((item) => {
                  const overdue = isStudentPaymentOverdue(item);

                  return (
                    <StudentPaymentCard
                      key={item.paymentId}
                      title={item.title}
                      ref={item.ref}
                      amount={item.amount}
                      dateLabel={formatStudentDateLabel(
                        item.date,
                        item.updatedAtMs || item.createdAtMs,
                      )}
                      status={item.status}
                      details={item.details}
                      className={overdue ? "border-rose-200 bg-rose-50/30" : undefined}
                      footer={
                        <div className="space-y-3">
                          {studentPaymentFooter(item)}

                          <div className="flex flex-wrap gap-2">
                            {overdue ? (
                              <Chip size="sm" className="bg-rose-100 text-rose-700">
                                Overdue
                              </Chip>
                            ) : item.status === "UNPAID" ? (
                              <Chip size="sm" className="bg-amber-100 text-amber-700">
                                Outstanding
                              </Chip>
                            ) : null}
                          </div>

                          <p
                            className={`text-sm ${
                              overdue
                                ? "text-rose-700"
                                : item.status === "PAID"
                                  ? "text-emerald-700"
                                  : "text-amber-700"
                            }`}
                          >
                            {overdue
                              ? "This unpaid record is already past its due date."
                              : item.status === "PAID"
                                ? "This payment is already marked as settled."
                                : "This record is still outstanding on your account."}
                          </p>
                        </div>
                      }
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
