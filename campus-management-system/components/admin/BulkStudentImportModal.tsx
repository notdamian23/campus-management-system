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
  buildBulkStudentImportErrorCsv,
  buildBulkStudentImportPreviewRows,
  downloadCsv,
  getBulkStudentImportTemplateCsv,
  type BulkStudentImportPreviewRow,
} from "@/lib/bulkStudentImport";
import {
  adminBulkImportStudents,
  getCampusFunctions,
} from "@/lib/firebase-functions";

type BulkStudentImportModalProps = {
  open: boolean;
  onClose: () => void;
  existingSchoolIds: Set<string>;
};

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
  const [importResult, setImportResult] = useState<{
    totalRows: number;
    importedCount: number;
    failedCount: number;
    skippedCount: number;
    rowResults: Array<{
      schoolId: string;
      name: string;
      course: string;
      yearLevel: string;
      status: string;
      success: boolean;
      skipped?: boolean;
      error?: string;
    }>;
  } | null>(null);
  const [parseError, setParseError] = useState<string>("");

  const totalRows = previewRows.length;
  const validRows = previewRows.filter((row) => row.isValid);
  const invalidRows = totalRows - validRows.length;
  const duplicateRows = previewRows.filter((row) =>
    row.errors.some((error) => error.toLowerCase().includes("duplicate")),
  ).length;

  const parsedRows = useMemo(
    () => validRows.map((row) => ({
      schoolId: row.schoolId,
      name: row.name,
      course: row.course,
      yearLevel: row.yearLevel,
      status: row.status,
    })),
    [validRows],
  );

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
      const text = await file.text();
      const rows = buildBulkStudentImportPreviewRows(text, existingSchoolIds);
      setPreviewRows(rows);
      if (rows.length === 1 && rows[0].errors.length > 0 && rows[0].rowIndex === 1) {
        setParseError(rows[0].errors.join(" "));
      }
    } catch {
      setPreviewRows([]);
      setParseError("Unable to parse the CSV file. Please verify the format.");
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

    const shouldContinue = window.confirm(
      `You are about to import ${parsedRows.length} valid students. Continue?`,
    );
    if (!shouldContinue) return;

    setImporting(true);
    try {
      const result = await adminBulkImportStudents(getCampusFunctions(), {
        filename: fileName || "student-import.csv",
        rows: parsedRows,
      });
      setImportResult(result);
      if (result.importedCount > 0) {
        campusToast.success({
          title: "Import complete",
          description: `${result.importedCount} students imported successfully.`,
          dedupeKey: "admin:bulk-import:success",
        });
      } else {
        campusToast.warning({
          title: "No students imported",
          description: "No valid rows were imported. Check the preview and fix errors.",
          dedupeKey: "admin:bulk-import:warning",
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
    const errorCsv = buildBulkStudentImportErrorCsv(importResult.rowResults);
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
                      Bulk student CSV import
                    </h2>
                    <p className="text-sm text-gray-600">
                      Upload a CSV file to create student accounts in the CAMPUS School ID flow.
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
                  Accepted columns: <span className="font-medium">schoolId, name, course, yearLevel, status</span>.
                  Leave <span className="font-semibold">status</span> blank for active students.
                </p>
                <ul className="grid gap-2 text-sm text-campus-text-secondary">
                  <li>Required fields: schoolId, name, course, yearLevel.</li>
                  <li>Use full course names exactly as shown in the Add Student dropdown.</li>
                  <li>Do not use abbreviations.</li>
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
                    { key: "name", label: "Name" },
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
                        <TableCell>{row.name || "-"}</TableCell>
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
