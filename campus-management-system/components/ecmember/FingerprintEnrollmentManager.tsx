"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Modal, ModalBody, ModalContent, ModalHeader } from "@heroui/modal";
import { Progress } from "@heroui/progress";
import { Spinner } from "@heroui/spinner";
import { Tab, Tabs } from "@heroui/tabs";
import { Table, TableBody, TableCell, TableColumn, TableHeader, TableRow } from "@heroui/table";
import { getFunctions, httpsCallable } from "firebase/functions";
import { app } from "@/lib/firebase";
import {
  normalizePortableEnrollmentSessionStatus,
  normalizePortableEnrollmentStudentStatus,
  type PortableDeviceEnrollmentSessionDoc,
  type PortableDeviceEnrollmentSessionStatus,
  type PortableDeviceEnrollmentSessionStudentDoc,
  type PortableDeviceEnrollmentStudentStatus,
} from "@/lib/portableDevice";

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

type EnrollmentSessionStudentView = PortableDeviceEnrollmentSessionStudentDoc & {
  id: string;
};

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
    Math.round(((session.syncedCount + session.failedCount) / session.totalStudents) * 100)
  );
}

function toEnrollmentError(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { code?: unknown; message?: unknown };
    const code = String(maybe.code ?? "").trim().toLowerCase();
    const message = String(maybe.message ?? "").trim();

    if (code.includes("permission-denied") || message.toLowerCase().includes("permission-denied")) {
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
      ? row.selectedStudentIds.map((item) => String(item ?? "").trim()).filter(Boolean)
      : [],
  };
}

function mapSessionStudentRow(row: EnrollmentSessionStudentWire): EnrollmentSessionStudentView {
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
      String(row.syncStatus ?? "").trim().toLowerCase() === "synced"
        ? "synced"
        : String(row.syncStatus ?? "").trim().toLowerCase() === "failed"
          ? "failed"
          : "pending",
    fingerprintTemplateId: Number(row.fingerprintTemplateId ?? 0) || 0,
    enrolledByDevice: String(row.enrolledByDevice ?? "").trim(),
    assignedDeviceId: String(row.assignedDeviceId ?? "").trim(),
    remarks: String(row.remarks ?? "").trim(),
  };
}

export function FingerprintEnrollmentManager({ students }: { students: StudentRosterRow[] }) {
  const functions = useMemo(() => getFunctions(app, "asia-southeast1"), []);
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<EnrollmentTab>("create");
  const [studentSearch, setStudentSearch] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<EnrollmentNotice | null>(null);
  const [creating, setCreating] = useState(false);
  const [sessions, setSessions] = useState<EnrollmentSessionView[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [activeSessionStudents, setActiveSessionStudents] = useState<EnrollmentSessionStudentView[]>([]);
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
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }, [reservedStudentIds, students]);

  const filteredEligibleStudents = useMemo(() => {
    const search = studentSearch.trim().toLowerCase();
    if (!search) return eligibleStudents;

    return eligibleStudents.filter((student) => {
      return [student.id, student.name, student.course, student.year, student.status]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [eligibleStudents, studentSearch]);

  const selectedStudents = useMemo(() => {
    return eligibleStudents.filter((student) => selectedStudentIds.has(student.uid));
  }, [eligibleStudents, selectedStudentIds]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
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
          : nextRows[0]?.id ?? ""
      );
    } catch (error: unknown) {
      setSessions([]);
      setSessionsError(
        toEnrollmentError(error, "Failed to load fingerprint enrollment sessions.")
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
          { session?: EnrollmentSessionWire | null; students?: EnrollmentSessionStudentWire[] }
        >(functions, "ecGetFingerprintEnrollmentSessionDetail");
        const result = await fn({ sessionId });

        if (result.data?.session?.sessionId) {
          const nextSession = mapSessionRow(result.data.session);
          setSessions((previous) => {
            const hasExisting = previous.some((row) => row.id === nextSession.id);
            if (hasExisting) {
              return previous.map((row) => (row.id === nextSession.id ? nextSession : row));
            }
            return [nextSession, ...previous];
          });
        }

        setActiveSessionStudents(
          (result.data?.students ?? []).map((row) => ({
            ...mapSessionStudentRow(row),
            enrollmentSessionId: sessionId,
          }))
        );
      } catch (error: unknown) {
        setActiveSessionStudents([]);
        setNotice({
          type: "err",
          msg: toEnrollmentError(error, "Failed to load enrollment session detail."),
        });
      } finally {
        setSessionStudentsLoading(false);
      }
    },
    [functions]
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

  const toggleStudentSelection = useCallback((studentUid: string) => {
    setSelectedStudentIds((previous) => {
      const next = new Set(previous);
      if (next.has(studentUid)) {
        next.delete(studentUid);
      } else {
        next.add(studentUid);
      }
      return next;
    });
  }, []);

  const selectVisibleStudents = useCallback(() => {
    setSelectedStudentIds((previous) => {
      const next = new Set(previous);
      filteredEligibleStudents.forEach((student) => next.add(student.uid));
      return next;
    });
  }, [filteredEligibleStudents]);

  const clearStudentSelection = useCallback(() => {
    setSelectedStudentIds(new Set());
  }, []);

  const createEnrollmentSession = useCallback(async () => {
    if (selectedStudents.length === 0) {
      setNotice({ type: "err", msg: "Select at least one student before creating a fingerprint session." });
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

      const session = result.data?.session ? mapSessionRow(result.data.session) : null;
      setSelectedStudentIds(new Set());
      if (session?.id) {
        setActiveSessionId(session.id);
      }
      setActiveTab("sessions");
      setNotice({
        type: "ok",
        msg: `Enrollment session ${(session?.id ?? "").slice(0, 8).toUpperCase()} is ready for the CAMPUS module.`,
      });
      await loadSessions();
    } catch (error: unknown) {
      setNotice({
        type: "err",
        msg: toEnrollmentError(error, "Failed to create fingerprint enrollment session."),
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
      const fn = httpsCallable<{ sessionId: string }, { session?: EnrollmentSessionWire | null }>(
        functions,
        "ecCloseFingerprintEnrollmentSession"
      );
      await fn({ sessionId: activeSession.id });
      setNotice({
        type: "ok",
        msg: `Enrollment session ${activeSession.id.slice(0, 8).toUpperCase()} was marked closed.`,
      });
      await loadSessions();
    } catch (error: unknown) {
      setNotice({
        type: "err",
        msg: toEnrollmentError(error, "Failed to close enrollment session."),
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
        }}
        className="w-full border-[#7b0000] font-semibold text-[#7b0000] xl:w-auto"
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
              <span className="text-2xl font-black text-campus-text-primary">Fingerprint Enrollment Sessions</span>
              <Chip color="warning" variant="flat">Portable CAMPUS module ready</Chip>
            </div>
            <p className="text-sm font-normal text-campus-text-secondary">
              Select students without fingerprints, create an enrollment session, and monitor live sync progress from the portable device.
            </p>
          </ModalHeader>
          <ModalBody className="pb-6">
            <Tabs
              selectedKey={activeTab}
              onSelectionChange={(key) => setActiveTab(String(key) as EnrollmentTab)}
              classNames={{
                tabList: "rounded-2xl bg-[#f5f1ed] p-1",
                cursor: "bg-[#7b0000]",
                tab: "h-11",
                tabContent: "text-sm font-semibold group-data-[selected=true]:text-white",
              }}
            >
              <Tab key="create" title="Create Session">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.85fr)]">
                  <Card shadow="sm" className="border">
                    <CardHeader className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-campus-text-primary">Students Without Fingerprints</h3>
                        <p className="text-sm text-campus-text-secondary">
                          Active or inactive accounts can be prepared here, but only students with no stored fingerprint are eligible.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Chip color="danger" variant="flat">{eligibleStudents.length} eligible</Chip>
                        <Chip color="primary" variant="flat">{selectedStudents.length} selected</Chip>
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
                          <Button variant="flat" onPress={selectVisibleStudents} isDisabled={!filteredEligibleStudents.length}>
                            Select Visible
                          </Button>
                          <Button variant="flat" onPress={clearStudentSelection} isDisabled={!selectedStudentIds.size}>
                            Clear
                          </Button>
                        </div>
                      </div>

                      <Table aria-label="Students without fingerprints" removeWrapper classNames={{ th: "bg-[#f8f4ef] text-[#6b5f56]" }}>
                        <TableHeader>
                          <TableColumn>SELECT</TableColumn>
                          <TableColumn>STUDENT</TableColumn>
                          <TableColumn>SCHOOL ID</TableColumn>
                          <TableColumn>COURSE / YEAR</TableColumn>
                          <TableColumn>ACCOUNT</TableColumn>
                        </TableHeader>
                        <TableBody emptyContent="No students are waiting for fingerprint enrollment.">
                          {filteredEligibleStudents.map((student) => (
                            <TableRow key={student.uid}>
                              <TableCell>
                                <input
                                  aria-label={`Select ${student.name}`}
                                  type="checkbox"
                                  checked={selectedStudentIds.has(student.uid)}
                                  onChange={() => toggleStudentSelection(student.uid)}
                                  className="h-4 w-4 cursor-pointer accent-[#7b0000]"
                                />
                              </TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-semibold text-campus-text-primary">{student.name}</p>
                                  <p className="text-xs text-campus-text-secondary">Fingerprint: {student.fingerprintStatus}</p>
                                </div>
                              </TableCell>
                              <TableCell className="font-medium text-campus-text-primary">{student.id}</TableCell>
                              <TableCell>
                                <div>
                                  <p className="font-medium text-campus-text-primary">{student.course}</p>
                                  <p className="text-xs text-campus-text-secondary">{student.year}</p>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Chip color={student.status === "Active" ? "success" : "default"} variant="flat">
                                  {student.status}
                                </Chip>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardBody>
                  </Card>

                  <div className="space-y-4">
                    <Card shadow="sm" className="border">
                      <CardHeader className="px-5 pt-5">
                        <div>
                          <h3 className="text-lg font-semibold text-campus-text-primary">Session Summary</h3>
                          <p className="text-sm text-campus-text-secondary">
                            The module will fetch these students as one offline-capable enrollment bundle.
                          </p>
                        </div>
                      </CardHeader>
                      <CardBody className="space-y-4 p-5 pt-3">
                        <div className="grid grid-cols-2 gap-3">
                          <Card shadow="none" className="border bg-[#faf7f3]">
                            <CardBody className="p-4">
                              <p className="text-xs uppercase tracking-wide text-campus-text-secondary">Ready Now</p>
                              <p className="mt-2 text-3xl font-black text-[#7b0000]">{eligibleStudents.length}</p>
                            </CardBody>
                          </Card>
                          <Card shadow="none" className="border bg-[#faf7f3]">
                            <CardBody className="p-4">
                              <p className="text-xs uppercase tracking-wide text-campus-text-secondary">In Queue</p>
                              <p className="mt-2 text-3xl font-black text-[#0f766e]">{selectedStudents.length}</p>
                            </CardBody>
                          </Card>
                        </div>

                        <div className="rounded-2xl border bg-[#fcfbf8] p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">Selection Preview</p>
                          <div className="mt-3 space-y-2">
                            {selectedStudents.slice(0, 5).map((student) => (
                              <div key={student.uid} className="flex items-center justify-between gap-3 rounded-xl border bg-white px-3 py-2">
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-campus-text-primary">{student.name}</p>
                                  <p className="truncate text-xs text-campus-text-secondary">
                                    {student.id} | {student.course} | {student.year}
                                  </p>
                                </div>
                                <Chip size="sm" color={student.status === "Active" ? "success" : "default"} variant="flat">
                                  {student.status}
                                </Chip>
                              </div>
                            ))}
                            {!selectedStudents.length && (
                              <p className="text-sm text-campus-text-secondary">
                                Pick one or more students from the table to prepare an enrollment session.
                              </p>
                            )}
                            {selectedStudents.length > 5 && (
                              <p className="text-xs text-campus-text-secondary">
                                +{selectedStudents.length - 5} more students will be included.
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
                          <h3 className="text-lg font-semibold text-campus-text-primary">Recent Sessions</h3>
                          <p className="text-sm text-campus-text-secondary">Live status updates keep this in sync with the portable device.</p>
                        </div>
                      </CardHeader>
                      <CardBody className="space-y-3 p-5 pt-3">
                        {sessionsLoading ? (
                          <div className="flex items-center gap-3 rounded-2xl border bg-[#faf7f3] px-4 py-5 text-sm text-campus-text-secondary">
                            <Spinner size="sm" />
                            Loading sessions...
                          </div>
                        ) : sessionsError ? (
                          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
                            {sessionsError}
                          </div>
                        ) : sessions.length ? (
                          sessions.slice(0, 4).map((session) => (
                            <button
                              key={session.id}
                              type="button"
                              onClick={() => {
                                setActiveSessionId(session.id);
                                setActiveTab("sessions");
                              }}
                              className={[
                                "w-full rounded-2xl border px-4 py-3 text-left transition",
                                session.id === activeSessionId
                                  ? "border-[#7b0000] bg-[#fff5f0]"
                                  : "border-default-200 bg-white hover:border-[#d6b39b]",
                              ].join(" ")}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                  <p className="font-semibold text-campus-text-primary">
                                    Session {session.id.slice(0, 8).toUpperCase()}
                                  </p>
                                  <p className="text-xs text-campus-text-secondary">
                                    {session.createdByName || session.createdBySchoolId || session.createdBy || "EC Member"}
                                  </p>
                                </div>
                                <Chip color={sessionStatusColor(session.status)} variant="flat">
                                  {statusLabel(session.status)}
                                </Chip>
                              </div>
                              <p className="mt-2 text-xs text-campus-text-secondary">
                                {session.totalStudents} students | {session.syncedCount} synced | {session.failedCount} failed
                              </p>
                            </button>
                          ))
                        ) : (
                          <p className="rounded-2xl border bg-[#faf7f3] px-4 py-5 text-sm text-campus-text-secondary">
                            No enrollment sessions yet. Create the first one from the left panel.
                          </p>
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
                        <h3 className="text-lg font-semibold text-campus-text-primary">Enrollment Sessions</h3>
                        <p className="text-sm text-campus-text-secondary">Pending, paired, downloading, enrolling, and completed states update live here.</p>
                      </div>
                    </CardHeader>
                    <CardBody className="space-y-3 p-5 pt-3">
                      {sessionsLoading ? (
                        <div className="flex items-center gap-3 rounded-2xl border bg-[#faf7f3] px-4 py-5 text-sm text-campus-text-secondary">
                          <Spinner size="sm" />
                          Loading sessions...
                        </div>
                      ) : sessions.length ? (
                        sessions.map((session) => (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => setActiveSessionId(session.id)}
                            className={[
                              "w-full rounded-2xl border px-4 py-3 text-left transition",
                              session.id === activeSessionId
                                ? "border-[#7b0000] bg-[#fff5f0]"
                                : "border-default-200 bg-white hover:border-[#d6b39b]",
                            ].join(" ")}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <p className="font-semibold text-campus-text-primary">
                                {session.id.slice(0, 8).toUpperCase()}
                              </p>
                              <Chip color={sessionStatusColor(session.status)} variant="flat">
                                {statusLabel(session.status)}
                              </Chip>
                            </div>
                            <p className="mt-2 text-xs text-campus-text-secondary">
                              Created {formatDateTime(session.createdAtMs)}
                            </p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <Chip size="sm" variant="flat" color="default">{session.pendingCount} pending</Chip>
                              <Chip size="sm" variant="flat" color="secondary">{session.downloadedCount} downloaded</Chip>
                              <Chip size="sm" variant="flat" color="primary">{session.enrolledCount} enrolled</Chip>
                              <Chip size="sm" variant="flat" color="success">{session.syncedCount} synced</Chip>
                              <Chip size="sm" variant="flat" color="danger">{session.failedCount} failed</Chip>
                            </div>
                          </button>
                        ))
                      ) : (
                        <p className="rounded-2xl border bg-[#faf7f3] px-4 py-5 text-sm text-campus-text-secondary">
                          No fingerprint enrollment sessions have been created yet.
                        </p>
                      )}
                    </CardBody>
                  </Card>

                  <Card shadow="sm" className="border">
                    <CardHeader className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-campus-text-primary">Session Detail</h3>
                        <p className="text-sm text-campus-text-secondary">
                          Watch which students are pending, downloaded, enrolled, synced, or failed.
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
                          {activeSession.status === "closed" ? "Session Closed" : "Mark Session Closed"}
                        </Button>
                      )}
                    </CardHeader>
                    <CardBody className="space-y-4 p-5 pt-3">
                      {!activeSession ? (
                        <div className="rounded-2xl border bg-[#faf7f3] px-4 py-5 text-sm text-campus-text-secondary">
                          Select a session from the left to inspect its enrollment queue.
                        </div>
                      ) : (
                        <>
                          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                            <Card shadow="none" className="border bg-[#faf7f3]">
                              <CardBody className="p-4">
                                <p className="text-xs uppercase tracking-wide text-campus-text-secondary">Status</p>
                                <div className="mt-2">
                                  <Chip color={sessionStatusColor(activeSession.status)} variant="flat">
                                    {statusLabel(activeSession.status)}
                                  </Chip>
                                </div>
                              </CardBody>
                            </Card>
                            <Card shadow="none" className="border bg-[#faf7f3]">
                              <CardBody className="p-4">
                                <p className="text-xs uppercase tracking-wide text-campus-text-secondary">Paired Device</p>
                                <p className="mt-2 font-semibold text-campus-text-primary">
                                  {activeSession.pairedDeviceId || "Waiting for module"}
                                </p>
                              </CardBody>
                            </Card>
                            <Card shadow="none" className="border bg-[#faf7f3]">
                              <CardBody className="p-4">
                                <p className="text-xs uppercase tracking-wide text-campus-text-secondary">Created By</p>
                                <p className="mt-2 font-semibold text-campus-text-primary">
                                  {activeSession.createdByName || activeSession.createdBySchoolId || activeSession.createdBy}
                                </p>
                              </CardBody>
                            </Card>
                            <Card shadow="none" className="border bg-[#faf7f3]">
                              <CardBody className="p-4">
                                <p className="text-xs uppercase tracking-wide text-campus-text-secondary">Last Updated</p>
                                <p className="mt-2 font-semibold text-campus-text-primary">
                                  {formatDateTime(activeSession.updatedAtMs || activeSession.createdAtMs)}
                                </p>
                              </CardBody>
                            </Card>
                          </div>

                          <div className="rounded-2xl border bg-[#fcfbf8] p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-campus-text-primary">Sync Progress</p>
                                <p className="text-xs text-campus-text-secondary">
                                  {activeSession.syncedCount} synced and {activeSession.failedCount} failed out of {activeSession.totalStudents} students.
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

                          {sessionStudentsLoading ? (
                            <div className="flex items-center gap-3 rounded-2xl border bg-[#faf7f3] px-4 py-5 text-sm text-campus-text-secondary">
                              <Spinner size="sm" />
                              Loading session students...
                            </div>
                          ) : (
                            <Table aria-label="Enrollment session students" removeWrapper classNames={{ th: "bg-[#f8f4ef] text-[#6b5f56]" }}>
                              <TableHeader>
                                <TableColumn>STUDENT</TableColumn>
                                <TableColumn>COURSE / YEAR</TableColumn>
                                <TableColumn>STATUS</TableColumn>
                                <TableColumn>SYNC</TableColumn>
                                <TableColumn>TEMPLATE</TableColumn>
                                <TableColumn>DEVICE</TableColumn>
                              </TableHeader>
                              <TableBody emptyContent="This session has no queued students.">
                                {activeSessionStudents.map((student) => (
                                  <TableRow key={student.id}>
                                    <TableCell>
                                      <div>
                                        <p className="font-semibold text-campus-text-primary">{student.fullName || student.studentId}</p>
                                        <p className="text-xs text-campus-text-secondary">
                                          {student.schoolId || student.studentId}
                                        </p>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <div>
                                        <p className="font-medium text-campus-text-primary">{student.course}</p>
                                        <p className="text-xs text-campus-text-secondary">{student.yearLevel}</p>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <Chip color={studentStatusColor(student.status)} variant="flat">
                                        {studentStatusLabel(student.status)}
                                      </Chip>
                                    </TableCell>
                                    <TableCell>
                                      <Chip color={syncStatusColor(student.syncStatus)} variant="flat">
                                        {student.syncStatus.charAt(0).toUpperCase() + student.syncStatus.slice(1)}
                                      </Chip>
                                    </TableCell>
                                    <TableCell className="font-medium text-campus-text-primary">
                                      {(student.fingerprintTemplateId ?? 0) > 0 ? student.fingerprintTemplateId : "-"}
                                    </TableCell>
                                    <TableCell className="text-campus-text-secondary">
                                      {student.enrolledByDevice || student.assignedDeviceId || "-"}
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </>
                      )}
                    </CardBody>
                  </Card>
                </div>
              </Tab>
            </Tabs>

            {notice && (
              <div
                className={[
                  "rounded-2xl border px-4 py-3 text-sm",
                  notice.type === "ok"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-red-200 bg-red-50 text-red-900",
                ].join(" ")}
              >
                {notice.msg}
              </div>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
}
