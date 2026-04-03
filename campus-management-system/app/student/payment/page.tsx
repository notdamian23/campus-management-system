"use client";

import { useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
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
      .sort((left, right) => (left.dateMs - right.dateMs) * direction)
      .map((group) => ({
        ...group,
        items: group.items.sort(
          (left, right) => (getPaymentDateMs(left) - getPaymentDateMs(right)) * direction
        ),
      }));
  }, [filteredPayments, sortMode]);

  const paidCount = useMemo(
    () => payments.filter((item) => item.status === "PAID").length,
    [payments]
  );
  const unpaidCount = useMemo(
    () => payments.filter((item) => item.status === "UNPAID").length,
    [payments]
  );
  const totalOutstanding = useMemo(
    () => payments
      .filter((item) => item.status === "UNPAID")
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    [payments]
  );

  return (
    <div className="space-y-5 sm:space-y-6 text-campus-text-primary">
      <Card shadow="sm" className="overflow-hidden border-0 bg-gradient-to-br from-[#7b0000] via-[#bb2020] to-[#f19b4c] text-white">
        <CardBody className="space-y-4 p-5 sm:p-6">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-white/70">
              Student Payments
            </p>
            <h1 className="text-2xl font-black sm:text-3xl">Payments</h1>
            <p className="text-sm text-white/80 sm:text-base">
              Track balances, review due dates, and keep the same payment timeline format.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card shadow="none" className="border border-white/20 bg-white/10 text-white">
              <CardBody className="p-4">
                <p className="text-sm text-white/70">Total Records</p>
                <h2 className="mt-2 text-3xl font-black">{loading ? "-" : payments.length}</h2>
              </CardBody>
            </Card>

            <Card shadow="none" className="border border-white/20 bg-white/10 text-white">
              <CardBody className="p-4">
                <p className="text-sm text-white/70">Paid</p>
                <h2 className="mt-2 text-3xl font-black">{loading ? "-" : paidCount}</h2>
              </CardBody>
            </Card>

            <Card shadow="none" className="border border-white/20 bg-white/10 text-white">
              <CardBody className="p-4">
                <p className="text-sm text-white/70">Outstanding</p>
                <h2 className="mt-2 text-2xl font-black">{loading ? "-" : formatAmount(totalOutstanding)}</h2>
              </CardBody>
            </Card>
          </div>
        </CardBody>
      </Card>

      <Card shadow="sm" className="border">
        <CardHeader className="px-5 pt-5">
          <div>
            <h2 className="text-lg font-semibold text-campus-text-primary">Filters</h2>
            <p className="text-sm text-campus-text-secondary">
              Keep the same payment timeline while sorting and filtering faster.
            </p>
          </div>
        </CardHeader>

        <CardBody className="grid grid-cols-1 gap-3 p-5 pt-3 sm:grid-cols-2">
          <Select
            aria-label="Sort payments"
            label="Sort"
            size="sm"
            selectedKeys={[sortMode]}
            onChange={(event) => setSortMode(event.target.value as PaymentSortMode)}
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
            onChange={(event) => setStatusFilter(event.target.value as PaymentStatusFilter)}
            disallowEmptySelection
            className="w-full"
          >
            <SelectItem key="all">All</SelectItem>
            <SelectItem key="paid">Paid</SelectItem>
            <SelectItem key="unpaid">Unpaid</SelectItem>
          </Select>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Chip color="success" variant="flat">
          {loading ? "-" : paidCount} paid
        </Chip>
        <Chip color="danger" variant="flat">
          {loading ? "-" : unpaidCount} unpaid
        </Chip>
        <Chip variant="bordered">
          {loading ? "-" : filteredPayments.length} shown
        </Chip>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
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
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold text-campus-text-primary">
                  {group.date}
                </h2>
                <Chip variant="bordered">
                  {group.items.length} item{group.items.length === 1 ? "" : "s"}
                </Chip>
              </div>

              <div className="space-y-4">
                {group.items.map((item) => (
                  <Card key={item.paymentId} shadow="sm" isPressable className="w-full border">
                    <CardBody className="w-full p-4 sm:p-5">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-lg font-semibold leading-snug break-words">
                              {item.title}
                            </h3>
                            <CampusBadge status={item.status === "PAID" ? "paid" : "unpaid"}>
                              {item.status}
                            </CampusBadge>
                          </div>

                          <p className="text-sm text-campus-text-secondary break-words">
                            Ref: {item.ref}
                          </p>

                          <div className="flex flex-wrap gap-2">
                            <Chip variant="flat" className="text-campus-text-primary">
                              Due: {item.date || "-"}
                            </Chip>
                            <Chip
                              variant="flat"
                              className={item.status === "PAID" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800"}
                            >
                              Amount: {formatAmount(item.amount)}
                            </Chip>
                          </div>
                        </div>

                        <div className="shrink-0 text-right">
                          <p className="text-xs uppercase tracking-wide text-campus-text-tertiary">
                            Amount
                          </p>
                          <p className="text-xl font-black text-campus-text-primary">
                            {formatAmount(item.amount)}
                          </p>
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
