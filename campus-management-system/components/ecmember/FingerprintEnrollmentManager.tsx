"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Selection } from "@react-types/shared";
import { Alert } from "@heroui/alert";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/modal";
import { Progress } from "@heroui/progress";
import { Tab, Tabs } from "@heroui/tabs";
import {
  CampusCardListSkeleton,
  CampusDataTable,
  CampusEmptyState,
  CampusTableBodySkeleton,
  type CampusTableColumn,
} from "@/components/ui";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";
import { campusToast } from "@/lib/toast";
import {
  normalizePortableEnrollmentSessionStatus,
  normalizePortableEnrollmentStudentStatus,
  type PortableDeviceEnrollmentSessionDoc,
  type PortableDeviceEnrollmentSessionStatus,
  type PortableDeviceEnrollmentSessionStudentDoc,
  type PortableDeviceEnrollmentStudentStatus,
} from "@/lib/portableDevice";
import { useIsBelowBreakpoint } from "./useIsBelowBreakpoint";

type StudentAccountStatus = "Active" | "Inactive";
type StudentFingerprintStatus = "Active" | "Inactive";

type StudentRosterRow = {
  uid: string;
  id: string;
  name: string;
  course: string;
  year: string;
  status: StudentAccountStatus;
  fingerprintStatus: StudentFingerprintStatus;
};

type EnrollmentNotice = {
  type: "ok" | "err";
  msg: string;
};

type EnrollmentTab = "create" | "sessions";

type EnrollmentSessionView = PortableDeviceEnrollmentSessionDoc & {
  id: string;
  createdAtMs: number;
  updatedAtMs: number;
};

type EnrollmentSessionStudentView =
  PortableDeviceEnrollmentSessionStudentDoc & {
    id: string;
  };

const enrollmentCandidateColumns: CampusTableColumn<StudentRosterRow>[] = [
  { key: "name", label: "Student" },
  { key: "id", label: "School ID" },
  { key: "courseYear", label: "Course / Year" },
  { key: "status", label: "Account" },
];

const sessionStudentColumns: CampusTableColumn<EnrollmentSessionStudentView>[] =
  [
    { key: "student", label: "Student" },
    { key: "courseYear", label: "Course / Year" },
    { key: "status", label: "Status" },
    { key: "sync", label: "Sync" },
    { key: "template", label: "Template" },
    { key: "device", label: "Device" },
  ];

type EnrollmentSessionWire = {
  sessionId?: string;
  createdBy?: string;
  createdByName?: string;
  createdBySchoolId?: string;
  status?: string;
  pairedDeviceId?: string;
  targetDeviceId?: string;
  totalStudents?: number;
  pendingCount?: number;
  downloadedCount?: number;
  enrolledCount?: number;
  syncedCount?: number;
  failedCount?: number;
  selectedStudentIds?: string[];
  createdAtMs?: number;
  updatedAtMs?: number;
};

type EnrollmentSessionStudentWire = {
  studentId?: string;
  studentUid?: string;
  schoolId?: string;
  fullName?: string;
  course?: string;
  yearLevel?: string;
  status?: string;
  syncStatus?: string;
  fingerprintTemplateId?: number;
  enrolledByDevice?: string;
  assignedDeviceId?: string;
  remarks?: string;
};

function formatDateTime(valueMs: number) {
  if (!valueMs) return "Just now";
  return new Date(valueMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(status: PortableDeviceEnrollmentSessionStatus) {
  if (status === "partially-completed") return "Partially Completed";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function studentStatusLabel(status: PortableDeviceEnrollmentStudentStatus) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function sessionStatusColor(status: PortableDeviceEnrollmentSessionStatus) {
  if (status === "completed") return "success" as const;
  if (status === "partially-completed") return "warning" as const;
  if (status === "enrolling") return "primary" as const;
  if (status === "downloading") return "secondary" as const;
  if (status === "closed") return "default" as const;
  return "danger" as const;
}

function studentStatusColor(status: PortableDeviceEnrollmentStudentStatus) {
  if (status === "synced") return "success" as const;
  if (status === "enrolled") return "primary" as const;
  if (status === "downloaded") return "secondary" as const;
  if (status === "failed") return "danger" as const;
  return "default" as const;
}

function syncStatusColor(status: string) {
  if (status === "synced") return "success" as const;
  if (status === "failed") return "danger" as const;
  return "default" as const;
}

function isActiveSession(status: PortableDeviceEnrollmentSessionStatus) {
  return status !== "completed" && status !== "closed";
}

function progressValue(session: EnrollmentSessionView | null) {
  if (!session || session.totalStudents <= 0) return 0;
  return Math.min(
    100,
    Math.round(
      ((session.syncedCount + session.failedCount) / session.totalStudents) *
        100,
    ),
  );
}

function toEnrollmentError(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { code?: unknown; message?: unknown };
    const code = String(maybe.code ?? "")
      .trim()
      .toLowerCase();
    const message = String(maybe.message ?? "").trim();

    if (
      code.includes("permission-denied") ||
      message.toLowerCase().includes("permission-denied")
    ) {
      return "Fingerprint enrollment access is blocked. Deploy the updated portable-device functions, or verify that this account is EC/Admin.";
    }

    if (code.includes("not-found")) {
      return "Fingerprint enrollment functions are not available yet. Deploy the updated portable-device functions first.";
    }

    if (message) {
      return message;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
}

function selectionToSet(selection: Selection, keys: string[]) {
  if (selection === "all") {
    return new Set(keys);
  }

  return new Set(Array.from(selection).map((key) => String(key)));
}

function mapSessionRow(row: EnrollmentSessionWire): EnrollmentSessionView {
  const sessionId = String(row.sessionId ?? "").trim();
  return {
    id: sessionId,
    sessionId,
    createdBy: String(row.createdBy ?? "").trim(),
    createdByName: String(row.createdByName ?? "").trim(),
    createdBySchoolId: String(row.createdBySchoolId ?? "").trim(),
    createdAt: row.createdAtMs ?? 0,
    updatedAt: row.updatedAtMs ?? 0,
    createdAtMs: Number(row.createdAtMs ?? 0) || 0,
    updatedAtMs: Number(row.updatedAtMs ?? 0) || 0,
    status: normalizePortableEnrollmentSessionStatus(row.status),
    pairedDeviceId: String(row.pairedDeviceId ?? "").trim(),
    targetDeviceId: String(row.targetDeviceId ?? "").trim(),
    totalStudents: Number(row.totalStudents ?? 0) || 0,
    pendingCount: Number(row.pendingCount ?? 0) || 0,
    downloadedCount: Number(row.downloadedCount ?? 0) || 0,
    enrolledCount: Number(row.enrolledCount ?? 0) || 0,
    syncedCount: Number(row.syncedCount ?? 0) || 0,
    failedCount: Number(row.failedCount ?? 0) || 0,
    selectedStudentIds: Array.isArray(row.selectedStudentIds)
      ? row.selectedStudentIds
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
      : [],
  };
}

function mapSessionStudentRow(
  row: EnrollmentSessionStudentWire,
): EnrollmentSessionStudentView {
  const studentId = String(row.studentId ?? "").trim();
  return {
    id: studentId,
    enrollmentSessionId: "",
    studentId,
    studentUid: String(row.studentUid ?? studentId).trim(),
    schoolId: String(row.schoolId ?? "").trim(),
    fullName: String(row.fullName ?? "").trim(),
    course: String(row.course ?? "Unassigned").trim() || "Unassigned",
    yearLevel: String(row.yearLevel ?? "Unassigned").trim() || "Unassigned",
    status: normalizePortableEnrollmentStudentStatus(row.status),
    syncStatus:
      String(row.syncStatus ?? "")
        .trim()
        .toLowerCase() === "synced"
        ? "synced"
        : String(row.syncStatus ?? "")
              .trim()
              .toLowerCase() === "failed"
          ? "failed"
          : "pending",
    fingerprintTemplateId: Number(row.fingerprintTemplateId ?? 0) || 0,
    enrolledByDevice: String(row.enrolledByDevice ?? "").trim(),
    assignedDeviceId: String(row.assignedDeviceId ?? "").trim(),
    remarks: String(row.remarks ?? "").trim(),
  };
}

export function FingerprintEnrollmentManager({
  students,
  buttonClassName,
}: {
  students: StudentRosterRow[];
  buttonClassName?: string;
}) {
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);
  const isCompactViewport = useIsBelowBreakpoint(768);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<EnrollmentTab>("create");
  const [studentSearch, setStudentSearch] = useState("");
  const [eligibleStudentsPage, setEligibleStudentsPage] = useState(1);
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(
    new Set(),
  );
  const [notice, setNotice] = useState<EnrollmentNotice | null>(null);
  const [creating, setCreating] = useState(false);
  const [sessions, setSessions] = useState<EnrollmentSessionView[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [activeSessionStudents, setActiveSessionStudents] = useState<
    EnrollmentSessionStudentView[]
  >([]);
  const [sessionStudentsLoading, setSessionStudentsLoading] = useState(false);
  const [closingSessionId, setClosingSessionId] = useState<string | null>(null);

  const reservedStudentIds = useMemo(() => {
    const next = new Set<string>();
    sessions.forEach((session) => {
      if (!isActiveSession(session.status)) return;
      for (const studentId of session.selectedStudentIds ?? []) {
        if (studentId) next.add(studentId);
      }
    });
    return next;
  }, [sessions]);

  const eligibleStudents = useMemo(() => {
    return [...students]
      .filter((student) => student.fingerprintStatus !== "Active")
      .filter((student) => !reservedStudentIds.has(student.uid))
      .sort(
        (left, right) =>
          left.name.localeCompare(right.name) ||
          left.id.localeCompare(right.id),
      );
  }, [reservedStudentIds, students]);

  const filteredEligibleStudents = useMemo(() => {
    const search = studentSearch.trim().toLowerCase();
    if (!search) return eligibleStudents;

    return eligibleStudents.filter((student) => {
      return [
        student.id,
        student.name,
        student.course,
        student.year,
        student.status,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [eligibleStudents, studentSearch]);

  const eligibleStudentsPerPage = 10;
  const eligibleStudentsTotalPages = useMemo(
    () =>
      Math.max(
        1,
        Math.ceil(filteredEligibleStudents.length / eligibleStudentsPerPage),
      ),
    [filteredEligibleStudents.length],
  );
  const safeEligibleStudentsPage = Math.min(
    Math.max(eligibleStudentsPage, 1),
    eligibleStudentsTotalPages,
  );
  const paginatedEligibleStudents = useMemo(() => {
    const startIndex =
      (safeEligibleStudentsPage - 1) * eligibleStudentsPerPage;
    return filteredEligibleStudents.slice(
      startIndex,
      startIndex + eligibleStudentsPerPage,
    );
  }, [
    eligibleStudentsPerPage,
    filteredEligibleStudents,
    safeEligibleStudentsPage,
  ]);
  const visibleSelectedStudentIds = useMemo(
    () =>
      new Set(
        paginatedEligibleStudents
          .filter((student) => selectedStudentIds.has(student.uid))
          .map((student) => student.uid),
      ),
    [paginatedEligibleStudents, selectedStudentIds],
  );
  const eligiblePageStart =
    filteredEligibleStudents.length === 0
      ? 0
      : (safeEligibleStudentsPage - 1) * eligibleStudentsPerPage + 1;
  const eligiblePageEnd = Math.min(
    safeEligibleStudentsPage * eligibleStudentsPerPage,
    filteredEligibleStudents.length,
  );

  const selectedStudents = useMemo(() => {
    return eligibleStudents.filter((student) =>
      selectedStudentIds.has(student.uid),
    );
  }, [eligibleStudents, selectedStudentIds]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);

    try {
      const fn = httpsCallable<
        { limit?: number },
        { sessions?: EnrollmentSessionWire[] }
      >(functions, "ecListFingerprintEnrollmentSessions");
      const result = await fn({ limit: 24 });
      const nextRows = (result.data?.sessions ?? [])
        .map((row) => mapSessionRow(row))
        .filter((row) => row.id);

      setSessions(nextRows);
      setActiveSessionId((previous) =>
        previous && nextRows.some((session) => session.id === previous)
          ? previous
          : (nextRows[0]?.id ?? ""),
      );
    } catch (error: unknown) {
      setSessions([]);
      setSessionsError(
        toEnrollmentError(
          error,
          "Failed to load fingerprint enrollment sessions.",
        ),
      );
    } finally {
      setSessionsLoading(false);
    }
  }, [functions]);

  const loadSessionDetail = useCallback(
    async (sessionId: string) => {
      if (!sessionId) {
        setActiveSessionStudents([]);
        return;
      }

      setSessionStudentsLoading(true);

      try {
        const fn = httpsCallable<
          { sessionId: string },
          {
            session?: EnrollmentSessionWire | null;
            students?: EnrollmentSessionStudentWire[];
          }
        >(functions, "ecGetFingerprintEnrollmentSessionDetail");
        const result = await fn({ sessionId });

        if (result.data?.session?.sessionId) {
          const nextSession = mapSessionRow(result.data.session);
          setSessions((previous) => {
            const hasExisting = previous.some(
              (row) => row.id === nextSession.id,
            );
            if (hasExisting) {
              return previous.map((row) =>
                row.id === nextSession.id ? nextSession : row,
              );
            }
            return [nextSession, ...previous];
          });
        }

        setActiveSessionStudents(
          (result.data?.students ?? []).map((row) => ({
            ...mapSessionStudentRow(row),
            enrollmentSessionId: sessionId,
          })),
        );
      } catch (error: unknown) {
        setActiveSessionStudents([]);
        setNotice({
          type: "err",
          msg: toEnrollmentError(
            error,
            "Failed to load enrollment session detail.",
          ),
        });
      } finally {
        setSessionStudentsLoading(false);
      }
    },
    [functions],
  );

  useEffect(() => {
    if (!isOpen) return;

    void loadSessions();
    const intervalId = window.setInterval(() => {
      void loadSessions();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [isOpen, loadSessions]);

  useEffect(() => {
    if (!isOpen || !activeSessionId) {
      setActiveSessionStudents([]);
      return;
    }

    void loadSessionDetail(activeSessionId);
    const intervalId = window.setInterval(() => {
      void loadSessionDetail(activeSessionId);
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [activeSessionId, isOpen, loadSessionDetail]);

  useEffect(() => {
    setEligibleStudentsPage(1);
  }, [studentSearch]);

  useEffect(() => {
    setEligibleStudentsPage(1);
  }, [students]);

  useEffect(() => {
    setEligibleStudentsPage((previous) =>
      Math.min(Math.max(previous, 1), eligibleStudentsTotalPages),
    );
  }, [eligibleStudentsTotalPages]);

  useEffect(() => {
    const eligibleIds = new Set(eligibleStudents.map((student) => student.uid));
    setSelectedStudentIds((previous) => {
      let changed = false;
      const next = new Set<string>();

      previous.forEach((studentId) => {
        if (eligibleIds.has(studentId)) {
          next.add(studentId);
          return;
        }
        changed = true;
      });

      return changed ? next : previous;
    });
  }, [eligibleStudents]);

  const selectVisibleStudents = useCallback(() => {
    setSelectedStudentIds((previous) => {
      const next = new Set(previous);
      paginatedEligibleStudents.forEach((student) => next.add(student.uid));
      return next;
    });
  }, [paginatedEligibleStudents]);

  const clearStudentSelection = useCallback(() => {
    setSelectedStudentIds(new Set());
  }, []);

  const createEnrollmentSession = useCallback(async () => {
    if (selectedStudents.length === 0) {
      setNotice({
        type: "err",
        msg: "Select at least one student before creating a fingerprint session.",
      });
      campusToast.warning({
        title: "Select students first",
        description:
          "Choose at least one student before creating a fingerprint session.",
        dedupeKey: "fingerprint:create:no-selection",
      });
      return;
    }

    setCreating(true);
    setNotice(null);

    try {
      const fn = httpsCallable<
        { studentIds: string[] },
        { session?: EnrollmentSessionWire | null }
      >(functions, "ecCreateFingerprintEnrollmentSession");
      const result = await fn({
        studentIds: selectedStudents.map((student) => student.uid),
      });

      const session = result.data?.session
        ? mapSessionRow(result.data.session)
        : null;
      setSelectedStudentIds(new Set());
      if (session?.id) {
        setActiveSessionId(session.id);
      }
      setActiveTab("sessions");
      setNotice({
        type: "ok",
        msg: `Enrollment session ${(session?.id ?? "").slice(0, 8).toUpperCase()} is ready for the CAMPUS module.`,
      });
      campusToast.success({
        title: "Enrollment session ready",
        description: `Session ${(session?.id ?? "").slice(0, 8).toUpperCase()} is ready for the CAMPUS module.`,
        dedupeKey: `fingerprint:create:${session?.id ?? "new-session"}`,
      });
      await loadSessions();
    } catch (error: unknown) {
      const message = toEnrollmentError(
        error,
        "Failed to create fingerprint enrollment session.",
      );
      setNotice({
        type: "err",
        msg: message,
      });
      campusToast.error({
        title: "Session creation failed",
        description: message,
        dedupeKey: "fingerprint:create:error",
      });
    } finally {
      setCreating(false);
    }
  }, [functions, loadSessions, selectedStudents]);

  const closeSession = useCallback(async () => {
    if (!activeSession || activeSession.status === "closed") {
      return;
    }

    setClosingSessionId(activeSession.id);
    setNotice(null);

    try {
      const fn = httpsCallable<
        { sessionId: string },
        { session?: EnrollmentSessionWire | null }
      >(functions, "ecCloseFingerprintEnrollmentSession");
      await fn({ sessionId: activeSession.id });
      setNotice({
        type: "ok",
        msg: `Enrollment session ${activeSession.id.slice(0, 8).toUpperCase()} was marked closed.`,
      });
      campusToast.success({
        title: "Session closed",
        description: `Enrollment session ${activeSession.id.slice(0, 8).toUpperCase()} was marked closed.`,
        dedupeKey: `fingerprint:close:${activeSession.id}`,
      });
      await loadSessions();
    } catch (error: unknown) {
      const message = toEnrollmentError(
        error,
        "Failed to close enrollment session.",
      );
      setNotice({
        type: "err",
        msg: message,
      });
      campusToast.error({
        title: "Close session failed",
        description: message,
        dedupeKey: `fingerprint:close:error:${activeSession.id}`,
      });
    } finally {
      setClosingSessionId(null);
    }
  }, [activeSession, functions, loadSessions]);

  return (
    <>
      <Button
        variant="bordered"
        onPress={() => {
          setIsOpen(true);
          setActiveTab("create");
          setEligibleStudentsPage(1);
        }}
        className={[
          "min-h-12 w-full justify-center border-[#7b0000] font-semibold text-[#7b0000] xl:w-auto",
          buttonClassName ?? "",
        ].join(" ")}
      >
        Enroll Fingerprint
      </Button>

      <Modal
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        size="5xl"
        scrollBehavior="inside"
        placement="top-center"
      >
        <ModalContent className="max-w-6xl">
          <ModalHeader className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-2xl font-black text-campus-text-primary">
                Fingerprint Enrollment Sessions
              </span>
              <Chip color="warning" variant="flat">
                Portable CAMPUS module ready
              </Chip>
            </div>
            <p className="text-sm font-normal text-campus-text-secondary">
              Select students without fingerprints, create an enrollment
              session, and monitor live sync progress from the portable device.
            </p>
          </ModalHeader>
          <ModalBody className="pb-6">
            <Tabs
              selectedKey={activeTab}
              onSelectionChange={(key) =>
                setActiveTab(String(key) as EnrollmentTab)
              }
              classNames={{
                tabList: "rounded-2xl bg-[#f5f1ed] p-1",
                cursor: "bg-[#7b0000]",
                tab: "h-11",
                tabContent:
                  "text-sm font-semibold group-data-[selected=true]:text-white",
              }}
            >
              <Tab key="create" title="Create Session">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
                  <Card shadow="sm" className="border">
                    <CardHeader className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-campus-text-primary">
                          Students Without Fingerprints
                        </h3>
                        <p className="text-sm text-campus-text-secondary">
                          Active or inactive accounts can be prepared here, but
                          only students with no stored fingerprint are eligible.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Chip color="danger" variant="flat">
                          {eligibleStudents.length} eligible
                        </Chip>
                        <Chip color="primary" variant="flat">
                          {selectedStudents.length} selected
                        </Chip>
                      </div>
                    </CardHeader>
                    <CardBody className="space-y-4 p-5 pt-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <Input
                          aria-label="Search students without fingerprints"
                          placeholder="Search school ID, student name, course, or year..."
                          value={studentSearch}
                          onValueChange={setStudentSearch}
                          className="w-full lg:max-w-xl"
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="flat"
                            onPress={selectVisibleStudents}
                            isDisabled={!paginatedEligibleStudents.length}
                          >
                            Select Visible
                          </Button>
                          <Button
                            variant="flat"
                            onPress={clearStudentSelection}
                            isDisabled={!selectedStudentIds.size}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>

                      <CampusDataTable
                        ariaLabel="Students without fingerprints"
                        columns={enrollmentCandidateColumns}
                        items={paginatedEligibleStudents}
                        getRowKey={(student) => student.uid}
                        renderCell={(student, columnKey) => {
                          if (columnKey === "name") {
                            return (
                              <div>
                                <p className="font-semibold text-campus-text-primary">
                                  {student.name}
                                </p>
                                <p className="text-xs text-campus-text-secondary">
                                  Fingerprint: {student.fingerprintStatus}
                                </p>
                              </div>
                            );
                          }

                          if (columnKey === "id") {
                            return (
                              <span className="font-medium text-campus-text-primary">
                                {student.id}
                              </span>
                            );
                          }

                          if (columnKey === "courseYear") {
                            return (
                              <div>
                                <p className="font-medium text-campus-text-primary">
                                  {student.course}
                                </p>
                                <p className="text-xs text-campus-text-secondary">
                                  {student.year}
                                </p>
                              </div>
                            );
                          }

                          if (columnKey === "status") {
                            return (
                              <Chip
                                color={
                                  student.status === "Active"
                                    ? "success"
                                    : "default"
                                }
                                variant="flat"
                              >
                                {student.status}
                              </Chip>
                            );
                          }

                          return null;
                        }}
                        emptyTitle="No eligible students"
                        emptyDescription="No students are waiting for fingerprint enrollment."
                        selectionMode="multiple"
                        selectedKeys={visibleSelectedStudentIds}
                        onSelectionChange={(keys) => {
                          const visibleIds = paginatedEligibleStudents.map(
                            (student) => student.uid,
                          );
                          const visibleSelection = selectionToSet(keys, visibleIds);

                          // Preserve selections from other pages while replacing
                          // only the visible page's checkbox state.
                          setSelectedStudentIds((previous) => {
                            const next = new Set(previous);
                            visibleIds.forEach((studentId) => next.delete(studentId));
                            visibleSelection.forEach((studentId) =>
                              next.add(studentId),
                            );
                            return next;
                          });
                        }}
                        showSelectionCheckboxes
                        tableClassName="min-w-[720px]"
                        wrapperClassName="border-[#f0e7df]"
                      />

                      <div className="flex flex-col gap-3 border-t border-[#f0e7df] pt-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-campus-text-primary">
                            Showing {eligiblePageStart}-{eligiblePageEnd} of{" "}
                            {filteredEligibleStudents.length} visible eligible
                            student
                            {filteredEligibleStudents.length === 1 ? "" : "s"}
                          </p>
                          <p className="text-xs text-campus-text-secondary">
                            {eligibleStudents.length} total eligible and{" "}
                            {selectedStudents.length} selected across all pages.
                          </p>
                        </div>

                        {eligibleStudentsTotalPages > 1 ? (
                          <div className="flex flex-col gap-2 sm:items-end">
                            <p className="text-xs uppercase tracking-[0.18em] text-campus-text-secondary">
                              Page {safeEligibleStudentsPage} of{" "}
                              {eligibleStudentsTotalPages}
                            </p>
                            <div
                              className={[
                                "grid gap-2",
                                isCompactViewport
                                  ? "grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] w-full"
                                  : "grid-cols-[auto_auto_auto]",
                              ].join(" ")}
                            >
                              <Button
                                variant="bordered"
                                size="sm"
                                onPress={() =>
                                  setEligibleStudentsPage((previous) =>
                                    Math.max(previous - 1, 1),
                                  )
                                }
                                isDisabled={safeEligibleStudentsPage <= 1}
                                className={isCompactViewport ? "w-full" : ""}
                              >
                                Previous
                              </Button>
                              <Chip
                                variant="flat"
                                className="justify-center px-3 text-center font-medium"
                              >
                                {safeEligibleStudentsPage} /{" "}
                                {eligibleStudentsTotalPages}
                              </Chip>
                              <Button
                                variant="bordered"
                                size="sm"
                                onPress={() =>
                                  setEligibleStudentsPage((previous) =>
                                    Math.min(
                                      previous + 1,
                                      eligibleStudentsTotalPages,
                                    ),
                                  )
                                }
                                isDisabled={
                                  safeEligibleStudentsPage >=
                                  eligibleStudentsTotalPages
                                }
                                className={isCompactViewport ? "w-full" : ""}
                              >
                                Next
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </CardBody>
                  </Card>

                  <div className="space-y-4">
                    <Card shadow="sm" className="border">
                      <CardHeader className="px-5 pt-5">
                        <div>
                          <h3 className="text-lg font-semibold text-campus-text-primary">
                            Session Summary
                          </h3>
                          <p className="text-sm text-campus-text-secondary">
                            The module will fetch these students as one
                            offline-capable enrollment bundle.
                          </p>
                        </div>
                      </CardHeader>
                      <CardBody className="space-y-4 p-5 pt-3">
                        <div className="grid grid-cols-2 gap-3">
                          <Card shadow="none" className="border bg-[#faf7f3]">
                            <CardBody className="p-4">
                              <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
                                Ready Now
                              </p>
                              <p className="mt-2 text-3xl font-black text-[#7b0000]">
                                {eligibleStudents.length}
                              </p>
                            </CardBody>
                          </Card>
                          <Card shadow="none" className="border bg-[#faf7f3]">
                            <CardBody className="p-4">
                              <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
                                In Queue
                              </p>
                              <p className="mt-2 text-3xl font-black text-[#0f766e]">
                                {selectedStudents.length}
                              </p>
                            </CardBody>
                          </Card>
                        </div>

                        <div className="rounded-2xl border bg-[#fcfbf8] p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                            Selection Preview
                          </p>
                          <div className="mt-3 space-y-2">
                            {selectedStudents.slice(0, 5).map((student) => (
                              <div
                                key={student.uid}
                                className="flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-campus-text-primary">
                                    {student.name}
                                  </p>
                                  <p className="truncate text-xs text-campus-text-secondary">
                                    {student.id} | {student.course} |{" "}
                                    {student.year}
                                  </p>
                                </div>
                                <Chip
                                  size="sm"
                                  color={
                                    student.status === "Active"
                                      ? "success"
                                      : "default"
                                  }
                                  variant="flat"
                                >
                                  {student.status}
                                </Chip>
                              </div>
                            ))}
                            {!selectedStudents.length && (
                              <CampusEmptyState
                                compact
                                title="No students selected"
                                description="Pick one or more students from the table to prepare an enrollment session."
                                className="border-none bg-transparent px-0 py-2"
                              />
                            )}
                            {selectedStudents.length > 5 && (
                              <p className="text-xs text-campus-text-secondary">
                                +{selectedStudents.length - 5} more students
                                will be included.
                              </p>
                            )}
                          </div>
                        </div>

                        <Button
                          onPress={() => void createEnrollmentSession()}
                          isLoading={creating}
                          isDisabled={!selectedStudents.length}
                          className="w-full bg-[#7b0000] font-semibold text-white"
                        >
                          Create Enrollment Session
                        </Button>
                      </CardBody>
                    </Card>
                    <Card shadow="sm" className="border">
                      <CardHeader className="px-5 pt-5">
                        <div>
                          <h3 className="text-lg font-semibold text-campus-text-primary">
                            Recent Sessions
                          </h3>
                          <p className="text-sm text-campus-text-secondary">
                            Live status updates keep this in sync with the
                            portable device.
                          </p>
                        </div>
                      </CardHeader>
                      <CardBody className="space-y-3 p-5 pt-3">
                        {sessionsLoading ? (
                          <CampusCardListSkeleton rows={2} />
                        ) : sessionsError ? (
                          <Alert
                            color="danger"
                            variant="flat"
                            title="Unable to load sessions"
                            description={sessionsError}
                          />
                        ) : sessions.length ? (
                          sessions.slice(0, 4).map((session) => (
                            <Button
                              key={session.id}
                              variant="bordered"
                              onPress={() => {
                                setActiveSessionId(session.id);
                                setActiveTab("sessions");
                              }}
                              className={[
                                "h-auto w-full justify-start rounded-2xl px-4 py-3 text-left transition",
                                session.id === activeSessionId
                                  ? "border-[#7b0000] bg-[#fff5f0]"
                                  : "border-default-200 bg-white hover:border-[#d6b39b]",
                              ].join(" ")}
                            >
                              <div className="w-full">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div>
                                    <p className="font-semibold text-campus-text-primary">
                                      Session{" "}
                                      {session.id.slice(0, 8).toUpperCase()}
                                    </p>
                                    <p className="text-xs text-campus-text-secondary">
                                      {session.createdByName ||
                                        session.createdBySchoolId ||
                                        session.createdBy ||
                                        "EC Member"}
                                    </p>
                                  </div>
                                  <Chip
                                    color={sessionStatusColor(session.status)}
                                    variant="flat"
                                  >
                                    {statusLabel(session.status)}
                                  </Chip>
                                </div>
                                <p className="mt-2 text-xs text-campus-text-secondary">
                                  {session.totalStudents} students |{" "}
                                  {session.syncedCount} synced |{" "}
                                  {session.failedCount} failed
                                </p>
                              </div>
                            </Button>
                          ))
                        ) : (
                          <CampusEmptyState
                            compact
                            title="No enrollment sessions yet"
                            description="Create the first fingerprint session from the left panel."
                            className="bg-[#faf7f3]"
                          />
                        )}
                      </CardBody>
                    </Card>
                  </div>
                </div>
              </Tab>

              <Tab key="sessions" title="Session Monitor">
                <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
                  <Card shadow="sm" className="border">
                    <CardHeader className="px-5 pt-5">
                      <div>
                        <h3 className="text-lg font-semibold text-campus-text-primary">
                          Enrollment Sessions
                        </h3>
                        <p className="text-sm text-campus-text-secondary">
                          Pending, paired, downloading, enrolling, and completed
                          states update live here.
                        </p>
                      </div>
                    </CardHeader>
                    <CardBody className="space-y-3 p-5 pt-3">
                      {sessionsLoading ? (
                        <CampusCardListSkeleton rows={3} />
                      ) : sessionsError ? (
                        <Alert
                          color="danger"
                          variant="flat"
                          title="Unable to load sessions"
                          description={sessionsError}
                        />
                      ) : sessions.length ? (
                        sessions.map((session) => (
                          <Button
                            key={session.id}
                            variant="bordered"
                            onPress={() => setActiveSessionId(session.id)}
                            className={[
                              "h-auto w-full justify-start rounded-2xl px-4 py-3 text-left transition",
                              session.id === activeSessionId
                                ? "border-[#7b0000] bg-[#fff5f0]"
                                : "border-default-200 bg-white hover:border-[#d6b39b]",
                            ].join(" ")}
                          >
                            <div className="w-full">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <p className="font-semibold text-campus-text-primary">
                                  {session.id.slice(0, 8).toUpperCase()}
                                </p>
                                <Chip
                                  color={sessionStatusColor(session.status)}
                                  variant="flat"
                                >
                                  {statusLabel(session.status)}
                                </Chip>
                              </div>
                              <p className="mt-2 text-xs text-campus-text-secondary">
                                Created {formatDateTime(session.createdAtMs)}
                              </p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <Chip size="sm" variant="flat" color="default">
                                  {session.pendingCount} pending
                                </Chip>
                                <Chip
                                  size="sm"
                                  variant="flat"
                                  color="secondary"
                                >
                                  {session.downloadedCount} downloaded
                                </Chip>
                                <Chip size="sm" variant="flat" color="primary">
                                  {session.enrolledCount} enrolled
                                </Chip>
                                <Chip size="sm" variant="flat" color="success">
                                  {session.syncedCount} synced
                                </Chip>
                                <Chip size="sm" variant="flat" color="danger">
                                  {session.failedCount} failed
                                </Chip>
                              </div>
                            </div>
                          </Button>
                        ))
                      ) : (
                        <CampusEmptyState
                          compact
                          title="No fingerprint sessions yet"
                          description="Start a session from the Create Session tab to begin monitoring portable-device enrollment."
                          className="bg-[#faf7f3]"
                        />
                      )}
                    </CardBody>
                  </Card>

                  <Card shadow="sm" className="border">
                    <CardHeader className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-campus-text-primary">
                          Session Detail
                        </h3>
                        <p className="text-sm text-campus-text-secondary">
                          Watch which students are pending, downloaded,
                          enrolled, synced, or failed.
                        </p>
                      </div>
                      {activeSession && (
                        <Button
                          variant="flat"
                          color="warning"
                          onPress={() => void closeSession()}
                          isLoading={closingSessionId === activeSession.id}
                          isDisabled={activeSession.status === "closed"}
                        >
                          {activeSession.status === "closed"
                            ? "Session Closed"
                            : "Mark Session Closed"}
                        </Button>
                      )}
                    </CardHeader>
                    <CardBody className="space-y-4 p-5 pt-3">
                      {!activeSession ? (
                        <CampusEmptyState
                          title="No session selected"
                          description="Choose a fingerprint session from the left to inspect its portable-device enrollment queue."
                          className="bg-[#faf7f3]"
                        />
                      ) : (
                        <>
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <Card shadow="none" className="border bg-[#faf7f3]">
                              <CardBody className="p-4">
                                <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
                                  Status
                                </p>
                                <div className="mt-2">
                                  <Chip
                                    color={sessionStatusColor(
                                      activeSession.status,
                                    )}
                                    variant="flat"
                                  >
                                    {statusLabel(activeSession.status)}
                                  </Chip>
                                </div>
                              </CardBody>
                            </Card>
                            <Card shadow="none" className="border bg-[#faf7f3]">
                              <CardBody className="p-4">
                                <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
                                  Paired Device
                                </p>
                                <p className="mt-2 font-semibold text-campus-text-primary">
                                  {activeSession.pairedDeviceId ||
                                    "Waiting for module"}
                                </p>
                              </CardBody>
                            </Card>
                            <Card shadow="none" className="border bg-[#faf7f3]">
                              <CardBody className="p-4">
                                <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
                                  Created By
                                </p>
                                <p className="mt-2 font-semibold text-campus-text-primary">
                                  {activeSession.createdByName ||
                                    activeSession.createdBySchoolId ||
                                    activeSession.createdBy}
                                </p>
                              </CardBody>
                            </Card>
                            <Card shadow="none" className="border bg-[#faf7f3]">
                              <CardBody className="p-4">
                                <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
                                  Last Updated
                                </p>
                                <p className="mt-2 font-semibold text-campus-text-primary">
                                  {formatDateTime(
                                    activeSession.updatedAtMs ||
                                      activeSession.createdAtMs,
                                  )}
                                </p>
                              </CardBody>
                            </Card>
                          </div>

                          <div className="rounded-2xl border bg-[#fcfbf8] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-campus-text-primary">
                                  Sync Progress
                                </p>
                                <p className="text-xs text-campus-text-secondary">
                                  {activeSession.syncedCount} synced and{" "}
                                  {activeSession.failedCount} failed out of{" "}
                                  {activeSession.totalStudents} students.
                                </p>
                              </div>
                              <Chip color="primary" variant="flat">
                                {progressValue(activeSession)}%
                              </Chip>
                            </div>
                            <Progress
                              aria-label="Fingerprint enrollment sync progress"
                              value={progressValue(activeSession)}
                              className="mt-4"
                              color="primary"
                            />
                          </div>

                          <CampusDataTable
                            ariaLabel="Enrollment session students"
                            columns={sessionStudentColumns}
                            items={activeSessionStudents}
                            getRowKey={(student) => student.id}
                            isLoading={sessionStudentsLoading}
                            loadingContent={
                              <CampusTableBodySkeleton rows={4} columns={6} />
                            }
                            emptyTitle="No queued students"
                            emptyDescription="This enrollment session does not have any students queued yet."
                            wrapperClassName="border-[#f0e7df]"
                            tableClassName="min-w-[760px]"
                            renderCell={(student, columnKey) => {
                              if (columnKey === "student") {
                                return (
                                  <div>
                                    <p className="font-semibold text-campus-text-primary">
                                      {student.fullName || student.studentId}
                                    </p>
                                    <p className="text-xs text-campus-text-secondary">
                                      {student.schoolId || student.studentId}
                                    </p>
                                  </div>
                                );
                              }

                              if (columnKey === "courseYear") {
                                return (
                                  <div>
                                    <p className="font-medium text-campus-text-primary">
                                      {student.course}
                                    </p>
                                    <p className="text-xs text-campus-text-secondary">
                                      {student.yearLevel}
                                    </p>
                                  </div>
                                );
                              }

                              if (columnKey === "status") {
                                return (
                                  <Chip
                                    color={studentStatusColor(student.status)}
                                    variant="flat"
                                  >
                                    {studentStatusLabel(student.status)}
                                  </Chip>
                                );
                              }

                              if (columnKey === "sync") {
                                return (
                                  <Chip
                                    color={syncStatusColor(student.syncStatus)}
                                    variant="flat"
                                  >
                                    {student.syncStatus.charAt(0).toUpperCase() +
                                      student.syncStatus.slice(1)}
                                  </Chip>
                                );
                              }

                              if (columnKey === "template") {
                                return (
                                  <span className="font-medium text-campus-text-primary">
                                    {(student.fingerprintTemplateId ?? 0) > 0
                                      ? student.fingerprintTemplateId
                                      : "-"}
                                  </span>
                                );
                              }

                              if (columnKey === "device") {
                                return (
                                  <span className="text-campus-text-secondary">
                                    {student.enrolledByDevice ||
                                      student.assignedDeviceId ||
                                      "-"}
                                  </span>
                                );
                              }

                              return null;
                            }}
                          />
                        </>
                      )}
                    </CardBody>
                  </Card>
                </div>
              </Tab>
            </Tabs>

            {notice && (
              <Alert
                color={notice.type === "ok" ? "success" : "danger"}
                variant="flat"
                title={
                  notice.type === "ok"
                    ? "Fingerprint session updated"
                    : "Fingerprint session issue"
                }
                description={notice.msg}
              />
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
}
