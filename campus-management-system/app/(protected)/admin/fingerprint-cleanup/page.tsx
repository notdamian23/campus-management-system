"use client";

import {useCallback, useEffect, useMemo, useRef, useState, type Key} from "react";
import {onAuthStateChanged} from "firebase/auth";
import {Button} from "@heroui/button";
import {Card, CardBody, CardHeader} from "@heroui/card";
import {Chip} from "@heroui/chip";
import {Input} from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import {Select, SelectItem} from "@heroui/select";
import {Skeleton} from "@heroui/skeleton";
import {Spinner} from "@heroui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@heroui/table";
import {Tooltip} from "@heroui/tooltip";
import {
  RefreshCcw,
  Search,
  ShieldAlert,
  Trash2,
  UserCheck,
  UserRoundX,
} from "lucide-react";
import {auth} from "@/lib/firebase";
import {
  adminListFingerprintCleanupMappings,
  adminManageFingerprintCleanup,
  getCampusFunctions,
  type FingerprintCleanupAction,
  type FingerprintCleanupReport,
  type FingerprintCleanupReportMapping,
} from "@/lib/firebase-functions";
import {campusToast} from "@/lib/toast";

type StatusFilter = "all" | FingerprintCleanupReportMapping["mappingStatus"];
type PendingAction =
  | {
      action: Exclude<FingerprintCleanupAction, "keepStudent">;
      mapping: FingerprintCleanupReportMapping;
    }
  | {
      action: "keepStudent";
      templateId: number;
    };

const statusOptions: Array<{key: StatusFilter; label: string}> = [
  {key: "all", label: "All statuses"},
  {key: "active", label: "Active"},
  {key: "stale", label: "Stale"},
  {key: "duplicate", label: "Duplicate"},
  {key: "deleted", label: "Deleted"},
  {key: "missing_profile", label: "Missing profile"},
];

function formatDateTime(ms: number) {
  if (!ms || !Number.isFinite(ms)) {
    return "-";
  }

  return new Date(ms).toLocaleString();
}

function statusChipColor(status: FingerprintCleanupReportMapping["mappingStatus"]) {
  if (status === "active") return "success";
  if (status === "duplicate") return "warning";
  if (status === "stale") return "secondary";
  if (status === "deleted") return "danger";
  return "default";
}

function actionLabel(action: FingerprintCleanupAction) {
  if (action === "removeStaleMapping") return "Remove Stale Mapping";
  if (action === "removeMapping") return "Remove Mapping";
  if (action === "markNeedsReenrollment") return "Mark for Re-enrollment";
  return "Keep This Student";
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      {Array.from({length: 5}).map((_, index) => (
        <Card key={index} shadow="sm" className="border">
          <CardBody className="space-y-3 p-5">
            <Skeleton className="h-4 w-24 rounded-lg" />
            <Skeleton className="h-8 w-16 rounded-xl" />
            <Skeleton className="h-3 w-28 rounded-lg" />
          </CardBody>
        </Card>
      ))}
    </div>
  );
}

export default function AdminFingerprintCleanupPage() {
  const hasLoadedReportRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [report, setReport] = useState<FingerprintCleanupReport | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [keepUid, setKeepUid] = useState("");
  const [actionLoadingKey, setActionLoadingKey] = useState("");

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setReady(Boolean(user));
    });

    return () => unsub();
  }, []);

  const loadReport = useCallback(async (showToast = false) => {
    if (!ready) {
      return;
    }

    setLoading(!hasLoadedReportRef.current);
    setRefreshing(hasLoadedReportRef.current);
    try {
      const nextReport = await adminListFingerprintCleanupMappings(
        getCampusFunctions(),
      );
      setReport(nextReport);
      hasLoadedReportRef.current = true;
      if (showToast) {
        campusToast.success({
          title: "Fingerprint report refreshed",
          description: `${nextReport.totalMappings} mapping${nextReport.totalMappings === 1 ? "" : "s"} loaded.`,
          dedupeKey: `admin:fingerprint-cleanup:refresh:${nextReport.generatedAtMs}`,
        });
      }
    } catch (error: unknown) {
      campusToast.error({
        title: "Fingerprint cleanup unavailable",
        description:
          error instanceof Error ?
            error.message :
            "Failed to load the fingerprint cleanup report.",
        dedupeKey: "admin:fingerprint-cleanup:load-error",
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [ready]);

  useEffect(() => {
    if (!ready) {
      return;
    }

    void loadReport();
  }, [loadReport, ready]);

  const courseOptions = useMemo(() => {
    const values = new Set<string>();
    report?.mappings.forEach((mapping) => {
      if (mapping.course) {
        values.add(mapping.course);
      }
    });
    return ["all", ...Array.from(values).sort((left, right) => left.localeCompare(right))];
  }, [report]);

  const yearOptions = useMemo(() => {
    const values = new Set<string>();
    report?.mappings.forEach((mapping) => {
      if (mapping.yearLevel) {
        values.add(mapping.yearLevel);
      }
    });
    return ["all", ...Array.from(values).sort((left, right) => left.localeCompare(right))];
  }, [report]);

  const filteredMappings = useMemo(() => {
    const rows = report?.mappings ?? [];
    const needle = search.trim().toLowerCase();

    return rows.filter((mapping) => {
      if (statusFilter !== "all" && mapping.mappingStatus !== statusFilter) {
        return false;
      }
      if (courseFilter !== "all" && mapping.course !== courseFilter) {
        return false;
      }
      if (yearFilter !== "all" && mapping.yearLevel !== yearFilter) {
        return false;
      }
      if (duplicatesOnly && mapping.duplicateReasons.length === 0) {
        return false;
      }
      if (staleOnly && mapping.mappingStatus !== "stale") {
        return false;
      }
      if (!needle) {
        return true;
      }

      return [
        mapping.studentName,
        mapping.schoolId,
        mapping.uid,
        String(mapping.templateId),
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [courseFilter, duplicatesOnly, report, search, staleOnly, statusFilter, yearFilter]);

  const keepCandidates = useMemo(() => {
    if (!pendingAction || pendingAction.action !== "keepStudent" || !report) {
      return [];
    }

    return report.mappings.filter(
      (mapping) => mapping.templateId === pendingAction.templateId,
    );
  }, [pendingAction, report]);

  const pendingActionLabel =
    pendingAction ? actionLabel(pendingAction.action) : "";

  async function runAction() {
    if (!pendingAction) {
      return;
    }

    const actionKey =
      pendingAction.action === "keepStudent" ?
        `${pendingAction.action}:${pendingAction.templateId}:${keepUid}` :
        `${pendingAction.action}:${pendingAction.mapping.rowId}`;

    const payload =
      pendingAction.action === "keepStudent" ?
        {
          action: pendingAction.action,
          templateId: pendingAction.templateId,
          keepUid,
          reason: actionReason.trim(),
        } :
        {
          action: pendingAction.action,
          templateId: pendingAction.mapping.templateId,
          uid: pendingAction.mapping.uid,
          reason: actionReason.trim(),
        };

    if (pendingAction.action === "keepStudent" && !keepUid) {
      campusToast.warning({
        title: "Select a student",
        description: "Choose which student should keep this fingerprint template.",
        dedupeKey: "admin:fingerprint-cleanup:missing-keep-uid",
      });
      return;
    }

    setActionLoadingKey(actionKey);
    try {
      const result = await adminManageFingerprintCleanup(
        getCampusFunctions(),
        payload,
      );
      campusToast.success({
        title: pendingActionLabel,
        description: result.message,
        dedupeKey: `admin:fingerprint-cleanup:action:${result.action}:${result.queueCount}:${result.updatedCount}`,
      });
      setPendingAction(null);
      setActionReason("");
      setKeepUid("");
      await loadReport();
    } catch (error: unknown) {
      campusToast.error({
        title: `${pendingActionLabel} failed`,
        description:
          error instanceof Error ? error.message : "Fingerprint cleanup failed.",
        dedupeKey: `admin:fingerprint-cleanup:action-error:${actionKey}`,
      });
    } finally {
      setActionLoadingKey("");
    }
  }

  return (
    <div className="space-y-6">
      <Card shadow="sm" className="border border-[#e8ddd5] bg-white">
        <CardBody className="space-y-5 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Chip variant="flat" color="danger">
                  Admin Only
                </Chip>
                <Chip variant="flat">
                  No full wipe
                </Chip>
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-campus-text-primary sm:text-3xl">
                  Fingerprint Cleanup
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-campus-text-secondary sm:text-base">
                  Review stale, duplicate, and missing fingerprint mappings safely.
                  This tool only queues targeted cleanup for the ESP32 and never
                  clears the whole AS608 database.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                color="danger"
                variant="flat"
                startContent={
                  refreshing ? <Spinner size="sm" /> : <RefreshCcw size={16} />
                }
                onPress={() => {
                  void loadReport(true);
                }}
                isDisabled={refreshing || loading}
              >
                Find Duplicate Fingerprints
              </Button>
            </div>
          </div>

          {loading ? (
            <SummarySkeleton />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
              <Card shadow="none" className="border bg-[#faf7f3]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Total mappings
                  </p>
                  <p className="text-3xl font-black text-campus-text-primary">
                    {report?.totalMappings ?? 0}
                  </p>
                </CardBody>
              </Card>
              <Card shadow="none" className="border bg-[#f4fbf5]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Active mappings
                  </p>
                  <p className="text-3xl font-black text-emerald-700">
                    {report?.activeMappings ?? 0}
                  </p>
                </CardBody>
              </Card>
              <Card shadow="none" className="border bg-[#fdf6f0]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Stale mappings
                  </p>
                  <p className="text-3xl font-black text-amber-700">
                    {report?.staleMappings ?? 0}
                  </p>
                </CardBody>
              </Card>
              <Card shadow="none" className="border bg-[#fff7ed]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Duplicate mappings
                  </p>
                  <p className="text-3xl font-black text-orange-700">
                    {report?.duplicateMappings ?? 0}
                  </p>
                </CardBody>
              </Card>
              <Card shadow="none" className="border bg-[#f8f5ff]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Needs re-enrollment
                  </p>
                  <p className="text-3xl font-black text-violet-700">
                    {report?.needsReenrollment ?? 0}
                  </p>
                </CardBody>
              </Card>
            </div>
          )}
        </CardBody>
      </Card>

      <Card shadow="sm" className="border border-[#e8ddd5] bg-white">
        <CardHeader className="flex flex-col items-start gap-3 px-5 pt-5">
          <div>
            <p className="text-lg font-semibold text-campus-text-primary">
              Mapping review
            </p>
            <p className="text-sm text-campus-text-secondary">
              Search by student, School ID, UID, or template ID, then filter for
              stale and duplicate mappings that need cleanup.
            </p>
          </div>
        </CardHeader>
        <CardBody className="space-y-4 p-5 pt-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_220px_220px_220px]">
            <Input
              placeholder="Search name, School ID, UID, or template ID"
              value={search}
              onValueChange={setSearch}
              startContent={<Search size={16} className="text-campus-text-secondary" />}
            />
            <Select
              label="Mapping status"
              selectedKeys={[statusFilter]}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys as Set<Key>)[0];
                if (typeof selected === "string") {
                  setStatusFilter(selected as StatusFilter);
                }
              }}
            >
              {statusOptions.map((option) => (
                <SelectItem key={option.key}>{option.label}</SelectItem>
              ))}
            </Select>
            <Select
              label="Course"
              selectedKeys={[courseFilter]}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys as Set<Key>)[0];
                if (typeof selected === "string") {
                  setCourseFilter(selected);
                }
              }}
            >
              {courseOptions.map((option) => (
                <SelectItem key={option}>
                  {option === "all" ? "All courses" : option}
                </SelectItem>
              ))}
            </Select>
            <Select
              label="Year level"
              selectedKeys={[yearFilter]}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys as Set<Key>)[0];
                if (typeof selected === "string") {
                  setYearFilter(selected);
                }
              }}
            >
              {yearOptions.map((option) => (
                <SelectItem key={option}>
                  {option === "all" ? "All year levels" : option}
                </SelectItem>
              ))}
            </Select>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant={duplicatesOnly ? "solid" : "bordered"}
              color={duplicatesOnly ? "warning" : "default"}
              onPress={() => setDuplicatesOnly((current) => !current)}
            >
              Show duplicates only
            </Button>
            <Button
              variant={staleOnly ? "solid" : "bordered"}
              color={staleOnly ? "secondary" : "default"}
              onPress={() => setStaleOnly((current) => !current)}
            >
              Show stale only
            </Button>
            <Button
              variant="light"
              onPress={() => {
                setSearch("");
                setStatusFilter("all");
                setCourseFilter("all");
                setYearFilter("all");
                setDuplicatesOnly(false);
                setStaleOnly(false);
              }}
            >
              Clear filters
            </Button>
          </div>

          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-14 w-full rounded-2xl" />
              <Skeleton className="h-64 w-full rounded-2xl" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table
                aria-label="Fingerprint cleanup mappings"
                removeWrapper
                classNames={{
                  th: "bg-[#faf7f3] text-campus-text-secondary",
                  td: "align-top",
                }}
              >
                <TableHeader>
                  <TableColumn>Template</TableColumn>
                  <TableColumn>Student</TableColumn>
                  <TableColumn>Course / Year</TableColumn>
                  <TableColumn>Profile</TableColumn>
                  <TableColumn>Status</TableColumn>
                  <TableColumn>Last enrolled</TableColumn>
                  <TableColumn>Actions</TableColumn>
                </TableHeader>
                <TableBody
                  emptyContent={
                    <div className="py-10 text-center text-sm text-campus-text-secondary">
                      No fingerprint mappings matched the current filters.
                    </div>
                  }
                  items={filteredMappings}
                >
                  {(mapping) => (
                    <TableRow key={mapping.rowId}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-semibold text-campus-text-primary">
                            #{mapping.templateId}
                          </p>
                          <p className="text-xs text-campus-text-secondary">
                            UID: {mapping.uid}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-semibold text-campus-text-primary">
                            {mapping.studentName}
                          </p>
                          <p className="text-sm text-campus-text-secondary">
                            {mapping.schoolId}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <p className="text-campus-text-primary">{mapping.course}</p>
                          <p className="text-campus-text-secondary">
                            {mapping.yearLevel}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          <Chip variant="flat" size="sm">
                            {mapping.profileStatus || "Unknown"}
                          </Chip>
                          <div className="flex flex-wrap gap-1">
                            {mapping.sources.map((source) => (
                              <Chip key={`${mapping.rowId}:${source}`} size="sm" variant="bordered">
                                {source}
                              </Chip>
                            ))}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          <Chip
                            color={statusChipColor(mapping.mappingStatus)}
                            variant="flat"
                            size="sm"
                          >
                            {mapping.mappingStatus.replace("_", " ")}
                          </Chip>
                          <div className="flex flex-wrap gap-1">
                            {mapping.duplicateReasons.length > 0 ? (
                              <Tooltip
                                content={mapping.duplicateReasons.join(", ")}
                                delay={200}
                              >
                                <Chip size="sm" color="warning" variant="bordered">
                                  Dup:{mapping.duplicateTemplateCount}
                                </Chip>
                              </Tooltip>
                            ) : null}
                            {mapping.needsReenrollment ? (
                              <Chip size="sm" color="secondary" variant="bordered">
                                Needs re-enrollment
                              </Chip>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-campus-text-secondary">
                          {formatDateTime(mapping.lastEnrolledAtMs)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {mapping.canKeepTemplateOwner ? (
                            <Tooltip content="Choose which active student keeps this shared template.">
                              <Button
                                size="sm"
                                color="success"
                                variant="flat"
                                startContent={<UserCheck size={14} />}
                                onPress={() => {
                                  setPendingAction({
                                    action: "keepStudent",
                                    templateId: mapping.templateId,
                                  });
                                  setKeepUid(mapping.uid);
                                  setActionReason("");
                                }}
                              >
                                Keep This Student
                              </Button>
                            </Tooltip>
                          ) : null}
                          {mapping.canRemoveStale ? (
                            <Tooltip content="Remove only stale, deleted, or missing-profile mappings.">
                              <Button
                                size="sm"
                                color="warning"
                                variant="flat"
                                startContent={<UserRoundX size={14} />}
                                onPress={() => {
                                  setPendingAction({
                                    action: "removeStaleMapping",
                                    mapping,
                                  });
                                  setActionReason("");
                                }}
                              >
                                Remove Stale
                              </Button>
                            </Tooltip>
                          ) : null}
                          <Tooltip content="Remove this mapping and queue module cleanup.">
                            <Button
                              size="sm"
                              color="danger"
                              variant="flat"
                              startContent={<Trash2 size={14} />}
                              onPress={() => {
                                setPendingAction({action: "removeMapping", mapping});
                                setActionReason("");
                              }}
                            >
                              Remove Mapping
                            </Button>
                          </Tooltip>
                          <Tooltip content="Mark this student for fingerprint re-enrollment.">
                            <Button
                              size="sm"
                              variant="bordered"
                              startContent={<ShieldAlert size={14} />}
                              onPress={() => {
                                setPendingAction({
                                  action: "markNeedsReenrollment",
                                  mapping,
                                });
                                setActionReason("");
                              }}
                            >
                              Mark for Re-enrollment
                            </Button>
                          </Tooltip>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      <Modal
        isOpen={Boolean(pendingAction)}
        onOpenChange={(open) => {
          if (!open && !actionLoadingKey) {
            setPendingAction(null);
            setActionReason("");
            setKeepUid("");
          }
        }}
        size="lg"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>{pendingActionLabel}</ModalHeader>
              <ModalBody className="space-y-4">
                {pendingAction?.action === "keepStudent" ? (
                  <>
                    <p className="text-sm text-campus-text-secondary">
                      Choose the one active student who should keep this template.
                      All other mappings for the same template will be removed or
                      marked for re-enrollment.
                    </p>
                    <Select
                      label="Student to keep"
                      selectedKeys={keepUid ? [keepUid] : []}
                      onSelectionChange={(keys) => {
                        const selected = Array.from(keys as Set<Key>)[0];
                        if (typeof selected === "string") {
                          setKeepUid(selected);
                        }
                      }}
                    >
                      {keepCandidates.map((mapping) => (
                        <SelectItem key={mapping.uid}>
                          {mapping.studentName} ({mapping.schoolId})
                        </SelectItem>
                      ))}
                    </Select>
                  </>
                ) : (
                  <div className="rounded-2xl border bg-[#faf7f3] px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
                      Selected mapping
                    </p>
                    <p className="mt-2 font-semibold text-campus-text-primary">
                      {pendingAction?.mapping.studentName}
                    </p>
                    <p className="mt-1 text-sm text-campus-text-secondary">
                      Template #{pendingAction?.mapping.templateId} •{" "}
                      {pendingAction?.mapping.schoolId}
                    </p>
                  </div>
                )}

                <Input
                  label="Reason"
                  placeholder="Explain why this cleanup is needed"
                  value={actionReason}
                  onValueChange={setActionReason}
                />
                <p className="text-xs text-campus-text-secondary">
                  This action updates the server-side mapping, adds a targeted
                  module cleanup instruction, and records an admin audit log.
                </p>
              </ModalBody>
              <ModalFooter className="justify-between">
                <Button
                  variant="bordered"
                  onPress={() => {
                    setPendingAction(null);
                    setActionReason("");
                    setKeepUid("");
                    onClose();
                  }}
                  isDisabled={Boolean(actionLoadingKey)}
                >
                  Cancel
                </Button>
                <Button
                  color={
                    pendingAction?.action === "keepStudent" ? "success" : "danger"
                  }
                  onPress={() => {
                    void runAction();
                  }}
                  isLoading={Boolean(actionLoadingKey)}
                >
                  {pendingActionLabel}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
