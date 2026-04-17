import { isValidCourse, normalizeCourse } from "./courseOptions";
import { normalizePersonName } from "./normalizePersonName";

export type BulkStudentCsvRow = {
  schoolId: string;
  name: string;
  course: string;
  yearLevel: string;
  status: string;
  rowIndex: number;
};

export type BulkStudentImportPreviewRow = BulkStudentCsvRow & {
  statusLabel: string;
  errors: string[];
  isValid: boolean;
};

export type BulkStudentImportRowPayload = {
  schoolId: string;
  name: string;
  course: string;
  yearLevel: string;
  status: string;
};

export type BulkStudentImportResultRow = BulkStudentImportRowPayload & {
  success: boolean;
  skipped?: boolean;
  error?: string;
  uid?: string;
};

export type BulkStudentImportResult = {
  totalRows: number;
  importedCount: number;
  failedCount: number;
  skippedCount: number;
  rowResults: BulkStudentImportResultRow[];
};

const REQUIRED_HEADERS = [
  "schoolid",
  "name",
  "course",
  "yearlevel",
];

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase();
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentCell += '"';
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if (char === "\n" && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      rows.push(currentRow);
      currentRow = [];
      continue;
    }

    if (char === "\r") {
      continue;
    }

    currentCell += char;
  }

  if (currentCell !== "" || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

function normalizeYearLevel(value: string): string {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return "";
  if (normalized === "1" || normalized === "1st" || normalized === "1st year" || normalized === "first year") return "1st Year";
  if (normalized === "2" || normalized === "2nd" || normalized === "2nd year" || normalized === "second year") return "2nd Year";
  if (normalized === "3" || normalized === "3rd" || normalized === "3rd year" || normalized === "third year") return "3rd Year";
  if (normalized === "4" || normalized === "4th" || normalized === "4th year" || normalized === "fourth year") return "4th Year";
  if (normalized === "5" || normalized === "5th" || normalized === "5th year" || normalized === "fifth year") return "5th Year";
  return normalizeText(value);
}

function normalizeStatus(raw: string): string {
  const value = normalizeText(raw).toLowerCase();
  if (!value) return "active";
  if (value === "active") return "active";
  if (value === "inactive") return "inactive";
  if (value === "pending") return "pending";
  return "";
}

function isValidSchoolId(raw: string) {
  const value = normalizeText(raw);
  return Boolean(value) && /^[A-Za-z0-9]{4,}$/.test(value);
}

function buildRowPayload(raw: Record<string, string>, rowIndex: number): BulkStudentCsvRow {
  const schoolId = normalizeText(raw.schoolId);
  const nameRaw = normalizeText(raw.name);
  const name = normalizePersonName(nameRaw);
  const course = normalizeCourse(raw.course);
  const yearLevel = normalizeYearLevel(raw.yearLevel);
  const status = normalizeStatus(raw.status);

  return {
    schoolId,
    name,
    course,
    yearLevel,
    status,
    rowIndex,
  };
}

export function getBulkStudentImportTemplateCsv(): string {
  const lines = [
    "schoolId,name,course,yearLevel,status",
    "20240001,Juan Dela Cruz,Computer Engineering,1,active",
    "20240002,Maria Santos,Computer Engineering,2,active",
  ];
  return lines.join("\n");
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function buildPreviewRow(
  row: BulkStudentCsvRow,
  csvDuplicates: Set<string>,
  existingSchoolIds: Set<string>,
): BulkStudentImportPreviewRow {
  const errors: string[] = [];

  if (!row.schoolId) {
    errors.push("School ID is required.");
  } else if (!isValidSchoolId(row.schoolId)) {
    errors.push("School ID must be alphanumeric and at least 4 characters.");
  }

  if (!row.name) {
    errors.push("Name is required.");
  }

  if (!row.course) {
    errors.push("Course is required.");
  } else if (!isValidCourse(row.course)) {
    errors.push("Invalid course. Use one of: Computer Engineering, Industrial Engineering, Electrical Engineering, Mechanical Engineering, Electronics Engineering.");
  }

  if (!row.yearLevel) {
    errors.push("Year level is required.");
  }

  if (row.status === "") {
    errors.push("Invalid status. Use active, inactive, or pending.");
  }

  if (csvDuplicates.has(row.schoolId)) {
    errors.push("Duplicate schoolId in CSV.");
  }

  if (row.schoolId && existingSchoolIds.has(row.schoolId)) {
    errors.push("Existing schoolId already exists in CAMPUS.");
  }

  const isValid = errors.length === 0;

  return {
    ...row,
    statusLabel: isValid ? "Valid" : "Invalid",
    errors,
    isValid,
  };
}

export function buildBulkStudentImportPreviewRows(
  csvText: string,
  existingSchoolIds: Set<string>,
): BulkStudentImportPreviewRow[] {
  const rows = parseCsv(csvText);
  if (rows.length === 0) return [];

  const headers = rows[0].map(normalizeHeader);
  const headerIndex: Record<string, number> = {};
  headers.forEach((header, index) => {
    if (REQUIRED_HEADERS.includes(header)) {
      headerIndex[header] = index;
    }
  });

  const missingHeaders = REQUIRED_HEADERS.filter((required) => !(required in headerIndex));
  if (missingHeaders.length > 0) {
    const errorRow: BulkStudentImportPreviewRow = {
      schoolId: "",
      name: "",
      course: "",
      yearLevel: "",
      status: "",
      rowIndex: 1,
      statusLabel: "Invalid",
      errors: [
        `CSV header must include: ${REQUIRED_HEADERS.join(", ")}.`,
      ],
      isValid: false,
    };
    return [errorRow];
  }

  const parsedRows: BulkStudentCsvRow[] = [];
  const seenSchoolIds = new Map<string, number>();

  for (let index = 1; index < rows.length; index += 1) {
    const rawRow = rows[index];
    const rowValues = {
      schoolId: normalizeText(rawRow[headerIndex.schoolid] ?? ""),
      name: normalizeText(rawRow[headerIndex.name] ?? ""),
      course: normalizeText(rawRow[headerIndex.course] ?? ""),
      yearLevel: normalizeText(rawRow[headerIndex.yearlevel] ?? ""),
      status: normalizeText(rawRow[headerIndex.status] ?? ""),
    };

    if (
      !rowValues.schoolId &&
      !rowValues.name &&
      !rowValues.course &&
      !rowValues.yearLevel &&
      !rowValues.status
    ) {
      continue;
    }

    const payload = buildRowPayload(rowValues, index + 1);
    parsedRows.push(payload);
    if (payload.schoolId) {
      const normalized = payload.schoolId;
      seenSchoolIds.set(normalized, (seenSchoolIds.get(normalized) ?? 0) + 1);
    }
  }

  const csvDuplicates = new Set<string>();
  for (const [schoolId, count] of seenSchoolIds.entries()) {
    if (count > 1) {
      csvDuplicates.add(schoolId);
    }
  }

  const lowerExistingSchoolIds = new Set<string>();
  existingSchoolIds.forEach((schoolId) => {
    lowerExistingSchoolIds.add(schoolId.trim());
  });

  return parsedRows.map((row) =>
    buildPreviewRow(row, csvDuplicates, lowerExistingSchoolIds),
  );
}

export function buildBulkStudentImportErrorCsv(
  rowResults: BulkStudentImportResultRow[],
): string {
  const lines = [
    "schoolId,name,course,yearLevel,status,error",
  ];
  rowResults.forEach((row) => {
    if (row.success) return;
    const escaped = (value: string) => {
      const raw = String(value ?? "");
      if (raw.includes(",") || raw.includes('"') || raw.includes("\n")) {
        return `"${raw.replace(/"/g, '""')}"`;
      }
      return raw;
    };
    lines.push([
      escaped(row.schoolId),
      escaped(row.name),
      escaped(row.course),
      escaped(row.yearLevel),
      escaped(row.status),
      escaped(row.error ?? ""),
    ].join(","));
  });
  return lines.join("\n");
}
