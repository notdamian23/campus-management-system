"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@heroui/table";
import { Skeleton } from "@heroui/skeleton";
import { Download, Upload, X } from "lucide-react";
import { campusToast } from "@/lib/toast";
import {
  buildBulkStudentImportPreviewDataset,
  buildBulkStudentImportErrorCsv,
  downloadCsv,
  getBulkStudentImportTemplateCsv,
  readBulkStudentImportFile,
  type BulkStudentImportInputSchema,
  type BulkStudentImportPreviewRow,
} from "@/lib/bulkStudentImport";
import {
  adminBulkImportStudents,
  type BulkStudentImportResult,
  type BulkStudentImportResultRow,
  getCampusFunctions,
} from "@/lib/firebase-functions";
import { formatStudentFullName } from "@/lib/student-name";

type BulkStudentImportModalProps = {
  open: boolean;
  onClose: () => void;
  existingSchoolIds: Set<string>;
};

function toBulkImportPayloadRows(rows: BulkStudentImportPreviewRow[]) {
  return rows.map((row) => ({
    nameSchema: row.nameSchema,
    rowIndex: row.rowIndex,
    schoolId: row.schoolId,
    lastName: row.lastName,
    firstName: row.firstName,
    fullName: row.fullName || undefined,
    course: row.course,
    yearLevel: row.yearLevel,
    status: row.status,
  }));
}

function mergeServerPreviewRows(
  localRows: BulkStudentImportPreviewRow[],
  rowResults: BulkStudentImportResultRow[],
): BulkStudentImportPreviewRow[] {
  return localRows.map((row, index) => {
    const serverRow = rowResults[index];
    if (!serverRow) {
      return row;
    }

    const errors =
      Array.isArray(serverRow.errors) && serverRow.errors.length > 0
        ? serverRow.errors
        : typeof serverRow.error === "string" && serverRow.error.trim()
          ? [serverRow.error]
          : [];
    const isValid = errors.length === 0;
    const firstName = serverRow.firstName ?? row.firstName;
    const lastName = serverRow.lastName ?? row.lastName;
    const fullName = serverRow.fullName ?? row.fullName;
    const schoolId = serverRow.schoolId ?? row.schoolId;

    return {
      ...row,
      nameSchema: serverRow.nameSchema ?? row.nameSchema,
      schoolId,
      firstName,
      lastName,
      fullName,
      course: serverRow.course ?? row.course,
      yearLevel: serverRow.yearLevel ?? row.yearLevel,
      status: serverRow.status ?? row.status,
      displayName: formatStudentFullName({
        firstName,
        lastName,
        fullName,
        schoolId,
      }),
      errors,
      isValid,
      statusLabel: isValid ? "Valid" : "Invalid",
    };
  });
}

export default function BulkStudentImportModal({
  open,
  onClose,
  existingSchoolIds,
}: BulkStudentImportModalProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [previewRows, setPreviewRows] = useState<BulkStudentImportPreviewRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BulkStudentImportResult | null>(
    null,
  );
  const [inputSchema, setInputSchema] =
    useState<BulkStudentImportInputSchema>("split");
  const [parseError, setParseError] = useState<string>("");

  const totalRows = previewRows.length;
  const validRows = previewRows.filter((row) => row.isValid);
  const invalidRows = totalRows - validRows.length;
  const duplicateRows = previewRows.filter((row) =>
    row.errors.some((error) => error.toLowerCase().includes("duplicate")),
  ).length;

  const parsedRows = useMemo(() => toBulkImportPayloadRows(validRows), [validRows]);

  function handleOpenFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParsing(true);
    setParseError("");
    setImportResult(null);

    try {
      const text = await readBulkStudentImportFile(file);
      const preview = buildBulkStudentImportPreviewDataset(
        text,
        existingSchoolIds,
      );
      const localRows = preview.rows;
      setInputSchema(preview.inputSchema);
      setPreviewRows(localRows);
      if (
        localRows.length === 1 &&
        localRows[0].errors.length > 0 &&
        localRows[0].rowIndex === 1
      ) {
        setParseError(localRows[0].errors.join(" "));
        campusToast.error({
          title: "Upload failed",
          description: "Please check the file format and try again.",
          dedupeKey: `admin:bulk-import:parse-error:${file.name}`,
        });
        return;
      }

      const serverPreview = await adminBulkImportStudents(getCampusFunctions(), {
        filename: file.name,
        inputSchema: preview.inputSchema,
        rows: toBulkImportPayloadRows(localRows),
        previewOnly: true,
      });
      const rows = mergeServerPreviewRows(localRows, serverPreview.rowResults);
      setPreviewRows(rows);

      const nextValidRows = rows.filter((row) => row.isValid).length;
      const nextIssueRows = rows.length - nextValidRows;
      if (nextValidRows > 0) {
        campusToast.success({
          title: "Student CSV uploaded successfully",
          description: `${nextValidRows} valid row${nextValidRows === 1 ? "" : "s"} ready for import.`,
          dedupeKey: `admin:bulk-import:preview-success:${file.name}:${nextValidRows}`,
        });
      }
      if (nextIssueRows > 0) {
        campusToast.warning({
          title: "Some rows need attention",
          description: `${nextIssueRows} row${nextIssueRows === 1 ? "" : "s"} need fixes before import.`,
          dedupeKey: `admin:bulk-import:preview-warning:${file.name}:${nextIssueRows}`,
        });
      }
    } catch (error: unknown) {
      setPreviewRows([]);
      setParseError(
        "Unable to validate the CSV against the CAMPUS import service. Please try again.",
      );
      campusToast.error({
        title: "Upload failed",
        description: getImportErrorMessage(error),
        dedupeKey: `admin:bulk-import:parse-failed:${file.name}`,
      });
    } finally {
      setParsing(false);
    }
  }

  function handleDownloadTemplate() {
    downloadCsv("campus-student-import-template.csv", getBulkStudentImportTemplateCsv());
  }

  function getImportErrorMessage(error: unknown): string {
    const functionError = error as {
      code?: string;
      message?: string;
      details?: unknown;
    };

    if (functionError?.code) {
      const code = functionError.code;
      if (
        code === "functions/unavailable" ||
        code === "functions/internal" ||
        code === "functions/unknown" ||
        code === "functions/unauthenticated"
      ) {
        return "Import failed due to server configuration. Please try again or contact support.";
      }
      if (code === "functions/permission-denied") {
        return "Import failed: admin access is required.";
      }
    }

    if (typeof functionError?.message === "string" && functionError.message.trim()) {
      return functionError.message;
    }

    return "Unable to complete the bulk import. Please try again.";
  }

  async function handleImport() {
    if (parsedRows.length === 0) {
      campusToast.warning({
        title: "No valid rows",
        description: "Please upload a CSV with valid student rows before importing.",
        dedupeKey: "admin:bulk-import:no-valid-rows",
      });
      return;
    }

    setImporting(true);
    try {
      const result = await adminBulkImportStudents(getCampusFunctions(), {
        filename: fileName || "student-import.csv",
        inputSchema,
        rows: parsedRows,
      });
      setImportResult(result);
      if (result.importedCount > 0) {
        campusToast.success({
          title: "Student CSV uploaded successfully",
          description: `${result.importedCount} student account${result.importedCount === 1 ? "" : "s"} created.`,
          dedupeKey: `admin:bulk-import:success:${result.importedCount}:${result.failedCount}:${result.skippedCount}`,
        });
      }

      const issueCount = result.failedCount + result.skippedCount;
      if (issueCount > 0) {
        campusToast.warning({
          title: "Import completed with issues",
          description: `${issueCount} row${issueCount === 1 ? "" : "s"} were skipped or failed due to invalid data.`,
          dedupeKey: `admin:bulk-import:warning:${issueCount}`,
        });
      } else if (result.importedCount === 0) {
        campusToast.warning({
          title: "No students imported",
          description: "No valid rows were imported. Check the preview and fix errors.",
          dedupeKey: "admin:bulk-import:no-imported-rows",
        });
      }
    } catch (error: unknown) {
      campusToast.error({
        title: "Import failed",
        description: getImportErrorMessage(error),
        dedupeKey: "admin:bulk-import:error",
      });
    } finally {
      setImporting(false);
    }
  }

  function renderStatusChip(row: BulkStudentImportPreviewRow) {
    return (
      <Chip
        color={row.isValid ? "success" : "danger"}
        variant="flat"
        className="whitespace-nowrap"
      >
        {row.statusLabel}
      </Chip>
    );
  }

  function handleDownloadErrors() {
    if (!importResult) return;
    const errorCsv = buildBulkStudentImportErrorCsv(
      importResult.rowResults,
      importResult.inputSchema || inputSchema,
    );
    if (!errorCsv) {
      campusToast.warning({
        title: "No failed rows",
        description: "There are no failed or skipped rows to download.",
        dedupeKey: "admin:bulk-import:no-error-csv",
      });
      return;
    }
    downloadCsv("student-import-errors.csv", errorCsv);
  }

  function resetState() {
    setFileName("");
    setPreviewRows([]);
    setInputSchema("split");
    setParseError("");
    setImportResult(null);
    setParsing(false);
    setImporting(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  return (
    <Modal
      isOpen={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          resetState();
          onClose();
        }
      }}
      size="xl"
    >
      <ModalContent>
        {(close) => (
          <>
            <ModalHeader>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-semibold text-gray-900">
                      Bulk student import
                    </h2>
                    <p className="text-sm text-gray-600">
                      Upload a CSV file using the CAMPUS spreadsheet template to create student accounts.
                    </p>
                  </div>
                  <Button
                    variant="light"
                    className="text-campus-text-secondary"
                    onPress={() => {
                      resetState();
                      close();
                    }}
                    startContent={<X size={16} />}
                  >
                    Close
                  </Button>
                </div>
          </div>
        </ModalHeader>
        <ModalBody>
          <div className="space-y-5">
            <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
              <div className="space-y-3 rounded-2xl border border-[#e5e7eb] bg-white p-4">
                <p className="text-sm text-campus-text-secondary">
                  Accepted columns: <span className="font-medium">SchoolId, LastName, FirstName, Course, YearLevel, Status</span>.
                  Leave <span className="font-semibold">Status</span> blank for active students.
                </p>
                <ul className="grid gap-2 text-sm text-campus-text-secondary">
                  <li>Required fields: SchoolId, LastName, FirstName, Course, YearLevel.</li>
                  <li>Legacy files that use <span className="font-medium">FullName</span> or <span className="font-medium">Name</span> are still accepted.</li>
                  <li>The template opens cleanly in Excel, Google Sheets, and other spreadsheet apps.</li>
                  <li>Course accepts CAMPUS course labels and common codes like BSCpE.</li>
                  <li>Do not include email. Student email is collected later.</li>
                  <li>Duplicate school IDs in the CSV or existing system rows are rejected.</li>
                </ul>
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  className="bg-[#7b0000] font-semibold text-white"
                  onPress={handleOpenFilePicker}
                  startContent={<Upload size={16} />}
                >
                  Upload CSV
                </Button>
                <Button
                  variant="bordered"
                  onPress={handleDownloadTemplate}
                  startContent={<Download size={16} />}
                >
                  Download CSV Template
                </Button>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleFileChange}
            />

            {fileName ? (
              <div className="rounded-2xl border border-[#e5e7eb] bg-[#f8fafc] p-4">
                <p className="text-sm text-campus-text-secondary">
                  Selected file: <span className="font-medium">{fileName}</span>
                </p>
              </div>
            ) : null}

            {parseError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                {parseError}
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                  Total rows
                </p>
                <p className="mt-2 text-2xl font-semibold text-campus-text-primary">
                  {totalRows}
                </p>
              </div>
              <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                  Valid rows
                </p>
                <p className="mt-2 text-2xl font-semibold text-campus-text-primary">
                  {validRows.length}
                </p>
              </div>
              <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                  Invalid rows
                </p>
                <p className="mt-2 text-2xl font-semibold text-campus-text-primary">
                  {invalidRows}
                </p>
              </div>
              <div className="rounded-2xl border border-[#e5e7eb] bg-white p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                  Duplicate rows
                </p>
                <p className="mt-2 text-2xl font-semibold text-campus-text-primary">
                  {duplicateRows}
                </p>
              </div>
            </div>

            {parsing ? (
              <div className="space-y-3">
                <Skeleton className="h-12 w-full rounded-2xl" />
                <Skeleton className="h-12 w-full rounded-2xl" />
                <Skeleton className="h-12 w-full rounded-2xl" />
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-[#e5e7eb] bg-white">
                <Table
                  aria-label="CSV preview"
                  shadow="none"
                  radius="none"
                  className="min-w-full"
                  classNames={{ wrapper: "p-0" }}
                >
                  <TableHeader columns={[
                    { key: "row", label: "Row" },
                    { key: "schoolId", label: "School ID" },
                    { key: "name", label: "Student Name" },
                    { key: "course", label: "Course" },
                    { key: "yearLevel", label: "Year Level" },
                    { key: "status", label: "Status" },
                    { key: "validation", label: "Validation" },
                  ]}
                  >
                    {(column) => (
                      <TableColumn key={column.key}>
                        {column.label}
                      </TableColumn>
                    )}
                  </TableHeader>
                  <TableBody
                    items={previewRows}
                    emptyContent={
                      <div className="p-6 text-sm text-campus-text-secondary">
                        Upload a CSV file to preview rows before import.
                      </div>
                    }
                  >
                    {(row) => (
                      <TableRow key={`row-${row.rowIndex}`}>
                        <TableCell>{row.rowIndex}</TableCell>
                        <TableCell>{row.schoolId || "-"}</TableCell>
                        <TableCell>{row.displayName || "-"}</TableCell>
                        <TableCell>{row.course || "-"}</TableCell>
                        <TableCell>{row.yearLevel || "-"}</TableCell>
                        <TableCell>{row.status || "active"}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-2">
                            {renderStatusChip(row)}
                            {row.errors.length ? (
                              <div className="text-xs text-red-600">
                                {row.errors.join(" ")}
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}

            {importResult ? (
              <div className="rounded-2xl border border-[#e5e7eb] bg-[#f8fafc] p-4">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-campus-text-primary">
                      Import result
                    </p>
                    <p className="text-sm text-campus-text-secondary">
                      Review the final import summary and download any failed rows.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="flat"
                      onPress={handleDownloadErrors}
                      isDisabled={importResult.failedCount + importResult.skippedCount === 0}
                    >
                      Download error CSV
                    </Button>
                    <Button
                      variant="bordered"
                      onPress={() => {
                        resetState();
                        onClose();
                      }}
                    >
                      Close import
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                      Total rows
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-campus-text-primary">
                      {importResult.totalRows}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                      Imported
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-campus-text-primary">
                      {importResult.importedCount}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                      Failed
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-campus-text-primary">
                      {importResult.failedCount}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                      Skipped
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-campus-text-primary">
                      {importResult.skippedCount}
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </ModalBody>
        <ModalFooter>
          <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button
              variant="bordered"
              onPress={() => {
                setPreviewRows([]);
                setFileName("");
                setParseError("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              isDisabled={importing || (!fileName && previewRows.length === 0)}
            >
              Reset
            </Button>
            <Button
              className="bg-[#7b0000] font-semibold text-white"
              onPress={handleImport}
              isLoading={importing}
              isDisabled={importing || parsedRows.length === 0}
            >
              {importing ? "Importing..." : "Import Students"}
            </Button>
          </div>
        </ModalFooter>
      </>)}
      </ModalContent>
    </Modal>
  );
}
