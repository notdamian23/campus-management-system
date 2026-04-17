import { isValidCourse, normalizeCourse } from "./courseOptions";
import {
  formatStudentFullName,
  normalizeStudentNamePart,
} from "./student-name";

export type BulkStudentCsvRow = {
  schoolId: string;
  lastName: string;
  firstName: string;
  fullName: string;
  course: string;
  yearLevel: string;
  status: string;
  rowIndex: number;
};

export type BulkStudentImportPreviewRow = BulkStudentCsvRow & {
  displayName: string;
  statusLabel: string;
  errors: string[];
  isValid: boolean;
};

export type BulkStudentImportRowPayload = {
  schoolId: string;
  lastName: string;
  firstName: string;
  fullName?: string;
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

const REQUIRED_HEADER_LINE = "SchoolId,LastName,FirstName,Course,YearLevel,Status";
const LEGACY_NAME_HEADER_LINE = "SchoolId,FullName,Course,YearLevel,Status";

type BulkStudentCsvHeaderMap = {
  schoolId: number;
  lastName?: number;
  firstName?: number;
  fullName?: number;
  course: number;
  yearLevel: number;
  status?: number;
};

const HEADER_ALIASES = {
  schoolId: ["schoolid"],
  lastName: ["lastname"],
  firstName: ["firstname"],
  fullName: ["fullname", "name", "studentname"],
  course: ["course"],
  yearLevel: ["yearlevel"],
  status: ["status"],
} as const;

function normalizeText(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeImportedValue(value: unknown) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ");
}

function resolveHeaderIndex(
  headers: string[],
  aliases: readonly string[],
): number {
  return headers.findIndex((header) => aliases.includes(header));
}

function buildHeaderMap(headers: string[]): BulkStudentCsvHeaderMap | null {
  const schoolIdIndex = resolveHeaderIndex(headers, HEADER_ALIASES.schoolId);
  const courseIndex = resolveHeaderIndex(headers, HEADER_ALIASES.course);
  const yearLevelIndex = resolveHeaderIndex(headers, HEADER_ALIASES.yearLevel);

  if (schoolIdIndex < 0 || courseIndex < 0 || yearLevelIndex < 0) {
    return null;
  }

  const lastNameIndex = resolveHeaderIndex(headers, HEADER_ALIASES.lastName);
  const firstNameIndex = resolveHeaderIndex(headers, HEADER_ALIASES.firstName);
  const fullNameIndex = resolveHeaderIndex(headers, HEADER_ALIASES.fullName);

  if (
    (lastNameIndex < 0 || firstNameIndex < 0) &&
    fullNameIndex < 0
  ) {
    return null;
  }

  const statusIndex = resolveHeaderIndex(headers, HEADER_ALIASES.status);

  return {
    schoolId: schoolIdIndex,
    lastName: lastNameIndex >= 0 ? lastNameIndex : undefined,
    firstName: firstNameIndex >= 0 ? firstNameIndex : undefined,
    fullName: fullNameIndex >= 0 ? fullNameIndex : undefined,
    course: courseIndex,
    yearLevel: yearLevelIndex,
    status: statusIndex >= 0 ? statusIndex : undefined,
  };
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
  const lastName = normalizeStudentNamePart(raw.lastName);
  const firstName = normalizeStudentNamePart(raw.firstName);
  const fullName = normalizeStudentNamePart(raw.fullName);
  const course = normalizeCourse(raw.course);
  const yearLevel = normalizeYearLevel(raw.yearLevel);
  const status = normalizeStatus(raw.status);

  return {
    schoolId,
    lastName,
    firstName,
    fullName,
    course,
    yearLevel,
    status,
    rowIndex,
  };
}

export function getBulkStudentImportTemplateCsv(): string {
  const lines = [
    REQUIRED_HEADER_LINE,
    "20175330,ABALA,MC JERREL,BSCpE,3,active",
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
  headerMap: BulkStudentCsvHeaderMap,
): BulkStudentImportPreviewRow {
  const errors: string[] = [];
  const hasLegacyFullName = Boolean(row.fullName);
  const hasLegacyFullNameColumn = headerMap.fullName != null;
  const hasSplitNameColumns =
    headerMap.lastName != null && headerMap.firstName != null;

  if (!row.schoolId) {
    errors.push("SchoolId is required.");
  } else if (!isValidSchoolId(row.schoolId)) {
    errors.push("SchoolId must be alphanumeric and at least 4 characters.");
  }

  if (!hasLegacyFullName) {
    if (hasSplitNameColumns) {
      if (!row.lastName) {
        errors.push("LastName is required.");
      }
      if (!row.firstName) {
        errors.push("FirstName is required.");
      }
    } else if (hasLegacyFullNameColumn) {
      errors.push("FullName is required.");
    }
  }

  if (!row.course) {
    errors.push("Course is required.");
  } else if (!isValidCourse(row.course)) {
    errors.push("Invalid course. Use a CAMPUS course label such as Computer Engineering or BSCpE.");
  }

  if (!row.yearLevel) {
    errors.push("YearLevel is required.");
  }

  if (row.status === "") {
    errors.push("Status is invalid. Use active, inactive, or pending.");
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
    displayName: formatStudentFullName({
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: row.fullName,
      schoolId: row.schoolId,
    }),
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
  const headerMap = buildHeaderMap(headers);

  if (!headerMap) {
    const errorRow: BulkStudentImportPreviewRow = {
      schoolId: "",
      lastName: "",
      firstName: "",
      fullName: "",
      course: "",
      yearLevel: "",
      status: "",
      rowIndex: 1,
      displayName: "",
      statusLabel: "Invalid",
      errors: [
        `CSV must include SchoolId, Course, YearLevel, and either LastName + FirstName or FullName/Name. Preferred header: ${REQUIRED_HEADER_LINE}. Legacy header is also supported: ${LEGACY_NAME_HEADER_LINE}.`,
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
      schoolId: normalizeImportedValue(rawRow[headerMap.schoolId] ?? ""),
      lastName: normalizeImportedValue(
        headerMap.lastName != null ? rawRow[headerMap.lastName] ?? "" : "",
      ),
      firstName: normalizeImportedValue(
        headerMap.firstName != null ? rawRow[headerMap.firstName] ?? "" : "",
      ),
      fullName: normalizeImportedValue(
        headerMap.fullName != null ? rawRow[headerMap.fullName] ?? "" : "",
      ),
      course: normalizeImportedValue(rawRow[headerMap.course] ?? ""),
      yearLevel: normalizeImportedValue(rawRow[headerMap.yearLevel] ?? ""),
      status: normalizeImportedValue(
        headerMap.status != null ? rawRow[headerMap.status] ?? "" : "",
      ),
    };

    if (
      !rowValues.schoolId &&
      !rowValues.lastName &&
      !rowValues.firstName &&
      !rowValues.fullName &&
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
    buildPreviewRow(row, csvDuplicates, lowerExistingSchoolIds, headerMap),
  );
}

export function buildBulkStudentImportErrorCsv(
  rowResults: BulkStudentImportResultRow[],
): string {
  const lines = [
    "SchoolId,LastName,FirstName,FullName,Course,YearLevel,Status,Error",
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
      escaped(row.lastName),
      escaped(row.firstName),
      escaped(row.fullName ?? ""),
      escaped(row.course),
      escaped(row.yearLevel),
      escaped(row.status),
      escaped(row.error ?? ""),
    ].join(","));
  });
  return lines.join("\n");
}
