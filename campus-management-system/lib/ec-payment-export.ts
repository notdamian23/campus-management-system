import { normalizeCourse } from "@/lib/courseOptions";

export type PaymentWorkbookStudentStatus = "Paid" | "Unpaid";

export type PaymentWorkbookStudent = {
  schoolId: string;
  fullName: string;
  course: string;
  yearLevel: string;
  status: PaymentWorkbookStudentStatus;
  paidDate?: unknown;
  referenceNumber?: string;
  remarks?: string;
};

export type PaymentWorkbookPayment = {
  id: string;
  title: string;
  amount: number;
  description: string;
  dueDate: string;
  linkedEventTitle?: string;
  createdAt?: unknown;
  students: PaymentWorkbookStudent[];
};

type PaymentWorkbookSummary = {
  totalStudents: number;
  paidCount: number;
  unpaidCount: number;
  totalExpectedAmount: number;
  totalCollectedAmount: number;
  collectionStatus: "Completed" | "Pending";
};

type PaymentWorkbookEntry = PaymentWorkbookPayment & {
  summary: PaymentWorkbookSummary;
};

const INVALID_SHEET_NAME_CHARS = /[:\\/?*\[\]]/g;

function padDateSegment(value: number) {
  return String(value).padStart(2, "0");
}

function toDate(value: unknown) {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (
    typeof value === "object" &&
    typeof (value as { toDate?: () => Date }).toDate === "function"
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (
    typeof value === "object" &&
    typeof (value as { toMillis?: () => number }).toMillis === "function"
  ) {
    const millis = (value as { toMillis: () => number }).toMillis();
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (
    typeof value === "object" &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    const parsed = new Date(
      Number((value as { seconds: number }).seconds) * 1000,
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const parsed = new Date(`${trimmed}T00:00:00`);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

export function formatExportDate(
  value: unknown,
  options?: {
    includeTime?: boolean;
  },
) {
  const parsed = toDate(value);
  if (!parsed) return "";

  const dateLabel = [
    parsed.getFullYear(),
    padDateSegment(parsed.getMonth() + 1),
    padDateSegment(parsed.getDate()),
  ].join("-");

  if (!options?.includeTime) {
    return dateLabel;
  }

  return `${dateLabel} ${padDateSegment(parsed.getHours())}:${padDateSegment(parsed.getMinutes())}`;
}

export function sanitizeExcelSheetName(value: string) {
  const sanitized = String(value ?? "")
    .replace(INVALID_SHEET_NAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .replace(/^'+|'+$/g, "")
    .trim();

  return (sanitized || "Payment").slice(0, 31);
}

export function filterRowsByCourseScope<T extends { course?: string | null }>(
  rows: T[],
  courseScope?: string | null,
) {
  const normalizedScope = normalizeCourse(String(courseScope ?? ""));
  if (!normalizedScope) {
    return rows;
  }

  return rows.filter(
    (row) => normalizeCourse(String(row.course ?? "")) === normalizedScope,
  );
}

export function calculatePaymentStatusCounts(
  students: PaymentWorkbookStudent[],
): PaymentWorkbookSummary {
  const totalStudents = students.length;
  const paidCount = students.filter((student) => student.status === "Paid").length;
  const unpaidCount = Math.max(0, totalStudents - paidCount);
  const totalExpectedAmount = 0;
  const totalCollectedAmount = 0;

  return {
    totalStudents,
    paidCount,
    unpaidCount,
    totalExpectedAmount,
    totalCollectedAmount,
    collectionStatus: totalStudents > 0 && unpaidCount === 0 ? "Completed" : "Pending",
  };
}

function buildSummarySheetRows(entries: PaymentWorkbookEntry[]) {
  return [
    [
      "Payment Title",
      "Amount",
      "Due Date",
      "Linked Event",
      "Total Students",
      "Paid Count",
      "Unpaid Count",
      "Total Expected Amount",
      "Total Collected Amount",
      "Collection Status",
    ],
    ...entries.map((entry) => [
      entry.title || "Untitled Payment",
      Number(entry.amount) || 0,
      formatExportDate(entry.dueDate),
      entry.linkedEventTitle || "",
      entry.summary.totalStudents,
      entry.summary.paidCount,
      entry.summary.unpaidCount,
      entry.summary.totalExpectedAmount,
      entry.summary.totalCollectedAmount,
      entry.summary.collectionStatus,
    ]),
  ];
}

function buildPaymentSheetRows(entry: PaymentWorkbookEntry) {
  return [
    ["Payment Title", entry.title || "Untitled Payment"],
    ["Amount", Number(entry.amount) || 0],
    ["Description", entry.description || ""],
    ["Due Date", formatExportDate(entry.dueDate)],
    ["Linked Event Title", entry.linkedEventTitle || ""],
    ["Created Date", formatExportDate(entry.createdAt, { includeTime: true })],
    ["Payment Status Summary", entry.summary.collectionStatus],
    ["Total Students", entry.summary.totalStudents],
    ["Paid Count", entry.summary.paidCount],
    ["Unpaid Count", entry.summary.unpaidCount],
    ["Total Expected Amount", entry.summary.totalExpectedAmount],
    ["Total Collected Amount", entry.summary.totalCollectedAmount],
    [],
    [
      "School ID",
      "Full Name",
      "Course",
      "Year Level",
      "Payment Status",
      "Paid Date",
      "Reference Number",
      "Remarks",
    ],
    ...entry.students.map((student) => [
      student.schoolId || "",
      student.fullName || "",
      student.course || "",
      student.yearLevel || "",
      student.status,
      formatExportDate(student.paidDate, { includeTime: true }),
      student.referenceNumber || "",
      student.remarks || "",
    ]),
  ];
}

function getUniqueSheetName(rawName: string, usedSheetNames: Set<string>) {
  const baseName = sanitizeExcelSheetName(rawName);
  let suffixNumber = 1;
  let nextName = baseName;

  while (usedSheetNames.has(nextName.toLowerCase())) {
    suffixNumber += 1;
    const suffix = ` (${suffixNumber})`;
    const trimmedBase = sanitizeExcelSheetName(
      baseName.slice(0, Math.max(0, 31 - suffix.length)),
    );
    nextName = `${trimmedBase || "Payment"}${suffix}`;
  }

  usedSheetNames.add(nextName.toLowerCase());
  return nextName;
}

function applySheetColumns(
  sheet: Record<string, unknown>,
  widths: number[],
) {
  sheet["!cols"] = widths.map((width) => ({ wch: width }));
}

export async function exportPaymentWorkbook(
  payments: PaymentWorkbookPayment[],
  exportDate = new Date(),
) {
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  const usedSheetNames = new Set(["summary"]);

  const entries = payments.map((payment) => {
    const summary = calculatePaymentStatusCounts(payment.students);
    summary.totalExpectedAmount = (Number(payment.amount) || 0) * summary.totalStudents;
    summary.totalCollectedAmount = (Number(payment.amount) || 0) * summary.paidCount;

    return {
      ...payment,
      summary,
    };
  });

  const summarySheet = XLSX.utils.aoa_to_sheet(buildSummarySheetRows(entries));
  applySheetColumns(summarySheet, [28, 14, 16, 28, 14, 12, 14, 20, 20, 18]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");

  entries.forEach((entry) => {
    const paymentSheet = XLSX.utils.aoa_to_sheet(buildPaymentSheetRows(entry));
    applySheetColumns(paymentSheet, [18, 30, 24, 16, 16, 20, 22, 28]);
    XLSX.utils.book_append_sheet(
      workbook,
      paymentSheet,
      getUniqueSheetName(entry.title || entry.id, usedSheetNames),
    );
  });

  XLSX.writeFile(
    workbook,
    `campus-payment-report-${formatExportDate(exportDate)}.xlsx`,
  );
}
