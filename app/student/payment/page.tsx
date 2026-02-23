"use client";

import { useMemo, useState } from "react";
import { Card, CardBody } from "@heroui/card";
import { Select, SelectItem } from "@heroui/select";
import { CampusBadge } from "@/components/heroui";
import { StudentPayment, useStudentPortal } from "@/components/student/StudentPortalProvider";

type PaymentSortMode = "latest_to_oldest" | "oldest_to_latest";
type PaymentStatusFilter = "all" | "paid" | "unpaid";

type PaymentGroup = {
  date: string;
  dateMs: number;
  items: StudentPayment[];
};

function getPaymentDateMs(payment: StudentPayment) {
  const rawDate = String(payment.date ?? "").trim();
  if (rawDate) {
    const parsed = new Date(`${rawDate}T00:00:00`).getTime();
    if (!Number.isNaN(parsed)) return parsed;
  }
  return payment.updatedAtMs || payment.createdAtMs || 0;
}

function getPaymentDateLabel(payment: StudentPayment) {
  const rawDate = String(payment.date ?? "").trim();
  if (rawDate) {
    const date = new Date(`${rawDate}T00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
      });
    }
  }

  if (payment.updatedAtMs || payment.createdAtMs) {
    return new Date(payment.updatedAtMs || payment.createdAtMs).toLocaleDateString(
      undefined,
      {
        weekday: "long",
        month: "long",
        day: "numeric",
      }
    );
  }

  return "No Date";
}

function formatAmount(value: number) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
}

export default function StudentPaymentsPage() {
  const { payments, loading, error } = useStudentPortal();
  const [sortMode, setSortMode] = useState<PaymentSortMode>("latest_to_oldest");
  const [statusFilter, setStatusFilter] = useState<PaymentStatusFilter>("all");

  const filteredPayments = useMemo(() => {
    if (statusFilter === "all") return payments;
    if (statusFilter === "paid") return payments.filter((item) => item.status === "PAID");
    return payments.filter((item) => item.status === "UNPAID");
  }, [payments, statusFilter]);

  const groupedPayments = useMemo<PaymentGroup[]>(() => {
    const map = new Map<string, PaymentGroup>();
    const direction = sortMode === "latest_to_oldest" ? -1 : 1;

    filteredPayments.forEach((item) => {
      const dateLabel = getPaymentDateLabel(item);
      const dateMs = getPaymentDateMs(item);

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
      .sort((a, b) => (a.dateMs - b.dateMs) * direction)
      .map((group) => ({
        ...group,
        items: group.items.sort(
          (a, b) => (getPaymentDateMs(a) - getPaymentDateMs(b)) * direction
        ),
      }));
  }, [filteredPayments, sortMode]);

  return (
    <div className="space-y-4 sm:space-y-6 text-campus-text-primary">
      <h1 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6 text-primary-900">
        Payments
      </h1>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <Select
          aria-label="Sort payments"
          label="Sort"
          size="sm"
          selectedKeys={[sortMode]}
          onChange={(e) => setSortMode(e.target.value as PaymentSortMode)}
          disallowEmptySelection
          className="w-full"
        >
          <SelectItem key="latest_to_oldest">Latest to Oldest</SelectItem>
          <SelectItem key="oldest_to_latest">Oldest to Latest</SelectItem>
        </Select>

        <Select
          aria-label="Filter payments by status"
          label="Status"
          size="sm"
          selectedKeys={[statusFilter]}
          onChange={(e) => setStatusFilter(e.target.value as PaymentStatusFilter)}
          disallowEmptySelection
          className="w-full"
        >
          <SelectItem key="all">All</SelectItem>
          <SelectItem key="paid">Paid</SelectItem>
          <SelectItem key="unpaid">Unpaid</SelectItem>
        </Select>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-campus-text-secondary">Loading payments...</p>
      ) : groupedPayments.length === 0 ? (
        <p className="text-sm text-campus-text-secondary">
          No payments match the current sort/filter options.
        </p>
      ) : (
        <div className="space-y-8 sm:space-y-10">
          {groupedPayments.map((group) => (
            <div key={`${group.date}-${group.dateMs}`}>
              <h2 className="text-lg font-semibold text-campus-text-primary mb-4">
                {group.date}
              </h2>

              <div className="space-y-4">
                {group.items.map((item) => (
                  <Card key={item.paymentId} shadow="sm" isPressable className="w-full">
                    <CardBody className="p-4 sm:p-5 w-full">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-lg font-semibold leading-snug break-words">
                            {item.title}
                          </h3>
                          <p className="text-sm text-campus-text-secondary mt-1 break-words">
                            Ref: {item.ref}
                          </p>
                          <p className="text-xs text-campus-text-tertiary mt-2 break-words">
                            Due: {item.date || "-"} | Amount: {formatAmount(item.amount)}
                          </p>
                        </div>

                        <div className="shrink-0">
                          <CampusBadge status={item.status === "PAID" ? "paid" : "unpaid"}>
                            {item.status}
                          </CampusBadge>
                        </div>
                      </div>
                    </CardBody>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

