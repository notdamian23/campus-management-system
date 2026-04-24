"use client";

import {useCallback, useEffect, useMemo, useRef, useState, type Key} from "react";
import {onAuthStateChanged} from "firebase/auth";
import {Alert} from "@heroui/alert";
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
import {Switch} from "@heroui/switch";
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
  adminClearFirebaseFingerprintMappingsOnly,
  adminBuildFingerprintMappingsFromProfiles,
  adminListFingerprintCleanupMappings,
  adminManageFingerprintCleanup,
  adminQueueFullFingerprintWipe,
  getCampusFunctions,
  type FingerprintCleanupAction,
  type FingerprintFullWipeCommandStatus,
  type FingerprintCleanupReport,
  type FingerprintCleanupReportMapping,
  type FingerprintCleanupSource,
} from "@/lib/firebase-functions";
import {campusToast} from "@/lib/toast";

type StatusFilter = "all" | FingerprintCleanupReportMapping["mappingStatus"];
type SourceFilter = "all" | FingerprintCleanupSource;
type PendingAction =
  | {
      action: Exclude<FingerprintCleanupAction, "keepStudent">;
      mapping: FingerprintCleanupReportMapping;
    }
  | {
      action: "keepStudent";
      templateId: number;
      fingerprintDeviceId: string;
    };
type WipeModalMode = "full" | "firebase-only" | null;

const DEFAULT_FINGERPRINT_DEVICE_ID = "campus-portable-01";
const FULL_WIPE_CONFIRMATION = "CLEAR AS608";
const FIREBASE_ONLY_CONFIRMATION = "CLEAR FIREBASE ONLY";

const statusOptions: Array<{key: StatusFilter; label: string}> = [
  {key: "all", label: "All statuses"},
  {key: "active", label: "Active"},
  {key: "missing_canonical", label: "Missing canonical"},
  {key: "stale", label: "Stale"},
  {key: "needs_reenrollment", label: "Needs re-enrollment"},
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
  if (status === "missing_canonical") return "warning";
  if (status === "duplicate") return "warning";
  if (status === "stale") return "secondary";
  if (status === "needs_reenrollment") return "secondary";
  if (status === "deleted") return "danger";
  return "default";
}

function syncStatusChipColor(syncStatus: string) {
  const normalized = syncStatus.trim().toLowerCase();
  if (normalized === "synced") return "success";
  if (normalized === "enrolled") return "primary";
  if (normalized === "failed") return "danger";
  return "default";
}

function sourceChipColor(source: FingerprintCleanupSource) {
  if (source === "fingerprint_template") return "success";
  if (source === "profile") return "secondary";
  if (source === "student_projection") return "default";
  return "primary";
}

function actionLabel(action: FingerprintCleanupAction) {
  if (action === "removeStaleMapping") return "Remove Stale Mapping";
  if (action === "removeMapping") return "Remove Mapping";
  if (action === "markNeedsReenrollment") return "Mark for Re-enrollment";
  return "Keep This Student";
}

function wipeStatusChipColor(status: FingerprintFullWipeCommandStatus) {
  if (status === "completed") return "success";
  if (status === "failed") return "danger";
  return "warning";
}

function wipeModalConfirmationText(mode: WipeModalMode) {
  return mode === "full" ? FULL_WIPE_CONFIRMATION : FIREBASE_ONLY_CONFIRMATION;
}

function SummarySkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
      {Array.from({length: 7}).map((_, index) => (
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
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [courseFilter, setCourseFilter] = useState("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [missingCanonicalOnly, setMissingCanonicalOnly] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [keepUid, setKeepUid] = useState("");
  const [actionLoadingKey, setActionLoadingKey] = useState("");
  const [buildModalOpen, setBuildModalOpen] = useState(false);
  const [buildMappingsLoading, setBuildMappingsLoading] = useState(false);
  const [wipeModalMode, setWipeModalMode] = useState<WipeModalMode>(null);
  const [wipeReason, setWipeReason] = useState("");
  const [wipeConfirmationText, setWipeConfirmationText] = useState("");
  const [markHistoricalRowsStale, setMarkHistoricalRowsStale] = useState(false);
  const [wipeLoading, setWipeLoading] = useState(false);

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
      if (process.env.NODE_ENV !== "production") {
        console.info("[FingerprintCleanup] report loaded", {
          uid: auth.currentUser?.uid ?? "",
          source: nextReport.source,
          fallbackUsed: nextReport.fallbackUsed,
          mappings: nextReport.totalMappings,
          needsReenrollment: nextReport.needsReenrollment,
        });
      }
      if (showToast) {
        campusToast.success({
          title: "Fingerprint report refreshed",
          description: `${nextReport.totalMappings} mapping${nextReport.totalMappings === 1 ? "" : "s"} loaded.`,
          dedupeKey: `admin:fingerprint-cleanup:refresh:${nextReport.generatedAtMs}`,
        });
      }
    } catch (error: unknown) {
      if (process.env.NODE_ENV !== "production") {
        const maybe = error as {code?: string; message?: string};
        console.error("[FingerprintCleanup] load failed", {
          uid: auth.currentUser?.uid ?? "",
          code: maybe.code ?? "",
          message: maybe.message ?? "",
          error,
        });
      }
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

  const sourceOptions = useMemo(() => {
    const values = new Set<FingerprintCleanupSource>();
    report?.mappings.forEach((mapping) => {
      mapping.sources.forEach((source) => {
        values.add(source);
      });
    });
    return ["all", ...Array.from(values).sort((left, right) => left.localeCompare(right))] as SourceFilter[];
  }, [report]);

  const filteredMappings = useMemo(() => {
    const rows = report?.mappings ?? [];
    const needle = search.trim().toLowerCase();

    return rows.filter((mapping) => {
      if (sourceFilter !== "all" && !mapping.sources.includes(sourceFilter)) {
        return false;
      }
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
      if (missingCanonicalOnly && !mapping.missingCanonical) {
        return false;
      }
      if (!needle) {
        return true;
      }

      return [
        mapping.studentName,
        mapping.schoolId,
        mapping.uid,
        mapping.course,
        mapping.yearLevel,
        mapping.section,
        String(mapping.templateId),
        mapping.fingerprintDeviceId,
        mapping.sessionId,
        mapping.syncStatus,
        ...mapping.sessionIds,
      ].some((value) => value.toLowerCase().includes(needle));
    });
  }, [
    courseFilter,
    duplicatesOnly,
    missingCanonicalOnly,
    report,
    search,
    sourceFilter,
    statusFilter,
    yearFilter,
  ]);

  const keepCandidates = useMemo(() => {
    if (!pendingAction || pendingAction.action !== "keepStudent" || !report) {
      return [];
    }

    return report.mappings.filter(
      (mapping) =>
        mapping.templateId === pendingAction.templateId &&
        mapping.fingerprintDeviceId === pendingAction.fingerprintDeviceId,
    );
  }, [pendingAction, report]);

  const pendingActionLabel =
    pendingAction ? actionLabel(pendingAction.action) : "";
  const hasActiveFilters =
    Boolean(search.trim()) ||
    sourceFilter !== "all" ||
    statusFilter !== "all" ||
    courseFilter !== "all" ||
    yearFilter !== "all" ||
    duplicatesOnly ||
    missingCanonicalOnly;
  const emptyStateMessage =
    hasActiveFilters ?
      "No fingerprint rows matched the current filters." :
    report?.emptyMessage ?
      report.emptyMessage :
      "No fingerprint template IDs were found yet. Sync or enroll fingerprints first.";
  const fullWipeCommand = report?.fullWipeCommand ?? null;
  const hasPendingFullWipe = fullWipeCommand?.status === "pending";
  const activeWipeConfirmationText = wipeModalConfirmationText(wipeModalMode);
  const wipeConfirmationMatches =
    wipeModalMode !== null &&
    wipeConfirmationText.trim() === activeWipeConfirmationText;

  function resetWipeModal() {
    setWipeModalMode(null);
    setWipeReason("");
    setWipeConfirmationText("");
    setMarkHistoricalRowsStale(false);
    setWipeLoading(false);
  }

  function openWipeModal(mode: Exclude<WipeModalMode, null>) {
    setWipeModalMode(mode);
    setWipeReason("");
    setWipeConfirmationText("");
    setMarkHistoricalRowsStale(false);
  }

  async function runAction() {
    if (!pendingAction) {
      return;
    }

    const actionKey =
      pendingAction.action === "keepStudent" ?
        `${pendingAction.action}:${pendingAction.fingerprintDeviceId}:${pendingAction.templateId}:${keepUid}` :
        `${pendingAction.action}:${pendingAction.mapping.rowId}`;

    const payload =
      pendingAction.action === "keepStudent" ?
        {
          action: pendingAction.action,
          templateId: pendingAction.templateId,
          fingerprintDeviceId: pendingAction.fingerprintDeviceId,
          keepUid,
          reason: actionReason.trim(),
        } :
        {
          action: pendingAction.action,
          templateId: pendingAction.mapping.templateId,
          fingerprintDeviceId: pendingAction.mapping.fingerprintDeviceId,
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

  async function buildMappingsFromProfiles() {
    setBuildMappingsLoading(true);
    try {
      const result = await adminBuildFingerprintMappingsFromProfiles(
        getCampusFunctions(),
      );
      campusToast.success({
        title: "Build mappings from profiles",
        description: result.message,
        dedupeKey: `admin:fingerprint-cleanup:build:${result.createdCount}:${result.updatedCount}:${result.skippedCount}`,
      });
      setBuildModalOpen(false);
      await loadReport();
    } catch (error: unknown) {
      campusToast.error({
        title: "Build mappings failed",
        description:
          error instanceof Error ?
            error.message :
            "Failed to build fingerprint mappings from profiles.",
        dedupeKey: "admin:fingerprint-cleanup:build-error",
      });
    } finally {
      setBuildMappingsLoading(false);
    }
  }

  async function submitWipeAction() {
    if (!wipeModalMode) {
      return;
    }

    if (!wipeConfirmationMatches) {
      campusToast.warning({
        title: "Confirmation text mismatch",
        description: `Type exactly ${activeWipeConfirmationText} to continue.`,
        dedupeKey: `admin:fingerprint-cleanup:wipe-confirmation:${wipeModalMode}`,
      });
      return;
    }

    setWipeLoading(true);
    try {
      if (wipeModalMode === "full") {
        const result = await adminQueueFullFingerprintWipe(
          getCampusFunctions(),
          {
            deviceId: DEFAULT_FINGERPRINT_DEVICE_ID,
            reason: wipeReason.trim(),
            markEnrollmentSessionRowsStale: markHistoricalRowsStale,
          },
        );

        if (result.alreadyPending) {
          campusToast.warning({
            title: "AS608 wipe already queued",
            description: result.message,
            dedupeKey: `admin:fingerprint-cleanup:wipe-pending:${result.commandId}`,
          });
        } else {
          campusToast.success({
            title: "AS608 wipe queued",
            description: result.message,
            dedupeKey: `admin:fingerprint-cleanup:wipe-queued:${result.commandId}`,
          });
        }
      } else {
        const result = await adminClearFirebaseFingerprintMappingsOnly(
          getCampusFunctions(),
          {
            deviceId: DEFAULT_FINGERPRINT_DEVICE_ID,
            reason: wipeReason.trim(),
            markEnrollmentSessionRowsStale: markHistoricalRowsStale,
          },
        );

        campusToast.success({
          title: "Firebase mappings cleared",
          description: result.message,
          dedupeKey:
            `admin:fingerprint-cleanup:firebase-only:${result.profilesCleared}:${result.studentsCleared}:${result.fingerprintTemplateDocsCleared}`,
        });
      }

      resetWipeModal();
      await loadReport();
    } catch (error: unknown) {
      campusToast.error({
        title:
          wipeModalMode === "full" ?
            "AS608 wipe request failed" :
            "Firebase-only clear failed",
        description:
          error instanceof Error ?
            error.message :
            "Fingerprint wipe failed.",
        dedupeKey: `admin:fingerprint-cleanup:wipe-error:${wipeModalMode ?? "unknown"}`,
      });
    } finally {
      setWipeLoading(false);
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
                <Chip variant="flat" color="warning">
                  Dangerous actions available
                </Chip>
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight text-campus-text-primary sm:text-3xl">
                  Fingerprint Cleanup
                </h1>
                <p className="mt-2 max-w-3xl text-sm text-campus-text-secondary sm:text-base">
                  Review stale, duplicate, and missing fingerprint mappings, or
                  queue a full AS608 wipe for the portable module. Firebase
                  fingerprint mappings are only cleared automatically after the
                  ESP32 confirms that the sensor database was emptied.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                color="danger"
                onPress={() => {
                  openWipeModal("full");
                }}
                isDisabled={
                  refreshing ||
                  loading ||
                  wipeLoading ||
                  buildMappingsLoading ||
                  hasPendingFullWipe
                }
              >
                Clear AS608 + Firebase Fingerprints
              </Button>
              <Button
                variant="bordered"
                color="warning"
                onPress={() => {
                  openWipeModal("firebase-only");
                }}
                isDisabled={
                  refreshing ||
                  loading ||
                  wipeLoading ||
                  buildMappingsLoading ||
                  hasPendingFullWipe
                }
              >
                Clear Firebase mappings only
              </Button>
              <Button
                variant="bordered"
                onPress={() => {
                  setBuildModalOpen(true);
                }}
                isDisabled={
                  refreshing ||
                  loading ||
                  buildMappingsLoading ||
                  wipeLoading
                }
              >
                Build mappings from profiles
              </Button>
              <Button
                color="primary"
                variant="flat"
                startContent={
                  refreshing ? <Spinner size="sm" /> : <RefreshCcw size={16} />
                }
                onPress={() => {
                  void loadReport(true);
                }}
                isDisabled={refreshing || loading || wipeLoading}
              >
                Refresh Fingerprint List
              </Button>
            </div>
          </div>

          {loading ? (
            <SummarySkeleton />
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-7">
              <Card shadow="none" className="border bg-[#faf7f3]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Students with fingerprints
                  </p>
                  <p className="text-3xl font-black text-campus-text-primary">
                    {report?.studentsWithFingerprints ?? 0}
                  </p>
                </CardBody>
              </Card>
              <Card shadow="none" className="border bg-[#f4fbf5]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Total template ID rows
                  </p>
                  <p className="text-3xl font-black text-emerald-700">
                    {report?.totalMappings ?? 0}
                  </p>
                </CardBody>
              </Card>
              <Card shadow="none" className="border bg-[#fdf6f0]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Canonical mappings
                  </p>
                  <p className="text-3xl font-black text-amber-700">
                    {report?.canonicalMappings ?? 0}
                  </p>
                </CardBody>
              </Card>
              <Card shadow="none" className="border bg-[#fff7ed]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Enrollment-session-only
                  </p>
                  <p className="text-3xl font-black text-orange-700">
                    {report?.enrollmentSessionOnlyMappings ?? 0}
                  </p>
                </CardBody>
              </Card>
              <Card shadow="none" className="border bg-[#f8f5ff]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Missing canonical
                  </p>
                  <p className="text-3xl font-black text-violet-700">
                    {report?.missingCanonicalMappings ?? 0}
                  </p>
                </CardBody>
              </Card>
              <Card shadow="none" className="border bg-[#fff1e8]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Duplicate template IDs
                  </p>
                  <p className="text-3xl font-black text-[#b45309]">
                    {report?.duplicateTemplateRows ?? 0}
                  </p>
                </CardBody>
              </Card>
              <Card shadow="none" className="border bg-[#f3f1ff]">
                <CardBody className="space-y-2 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-campus-text-secondary">
                    Needs re-enrollment
                  </p>
                  <p className="text-3xl font-black text-[#6d28d9]">
                    {report?.needsReenrollment ?? 0}
                  </p>
                </CardBody>
              </Card>
            </div>
          )}

          {!loading && (report?.missingCanonicalMappings ?? 0) > 0 ? (
            <Alert
              color="warning"
              variant="flat"
              title="Missing canonical mappings detected"
              description="These students have synced fingerprint template IDs in enrollment sessions but are missing canonical mappings. Build or repair mappings before using them for attendance."
            />
          ) : null}

          {!loading && report?.fallbackUsed ? (
            <Alert
              color="warning"
              variant="flat"
              title="Fallback records are still in use"
              description="Showing profile and student fallback mappings because the canonical fingerprintTemplates records are empty or incomplete. Use Build mappings from profiles to create admin cleanup records without touching the AS608 sensor."
            />
          ) : null}

          {!loading && fullWipeCommand ? (
            <Alert
              color={wipeStatusChipColor(fullWipeCommand.status)}
              variant="flat"
              title={
                fullWipeCommand.status === "pending" ?
                  "AS608 wipe command pending" :
                fullWipeCommand.status === "completed" ?
                  "AS608 wipe completed" :
                  "AS608 wipe failed"
              }
              description={
                fullWipeCommand.status === "pending" ?
                  `Waiting for module ${fullWipeCommand.targetDeviceId || DEFAULT_FINGERPRINT_DEVICE_ID} to run Cleanup Queue or Full Sync. Firebase mappings will clear only after the device confirms the AS608 wipe.` :
                fullWipeCommand.status === "completed" ?
                  `Completed on ${formatDateTime(fullWipeCommand.completedAtMs || fullWipeCommand.processedAtMs)} for ${fullWipeCommand.targetDeviceId || DEFAULT_FINGERPRINT_DEVICE_ID}. Active canonical mappings should now be zero until students are re-enrolled.` :
                  `${fullWipeCommand.error || "The module reported a failure while clearing the AS608 database."} Use Clear Firebase mappings only if the sensor has already been cleared manually.`
              }
            />
          ) : null}

          {!loading && fullWipeCommand ? (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-[#faf7f3] px-4 py-3 text-sm text-campus-text-secondary">
              <Chip color={wipeStatusChipColor(fullWipeCommand.status)} variant="flat" size="sm">
                {fullWipeCommand.status}
              </Chip>
              <span>Device: {fullWipeCommand.targetDeviceId || DEFAULT_FINGERPRINT_DEVICE_ID}</span>
              <span>Queued: {formatDateTime(fullWipeCommand.createdAtMs)}</span>
              <span>Mode: {fullWipeCommand.clearMode}</span>
              {fullWipeCommand.markEnrollmentSessionRowsStale ? (
                <span>Historical session rows stale</span>
              ) : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card shadow="sm" className="border border-[#e8ddd5] bg-white">
        <CardHeader className="flex flex-col items-start gap-3 px-5 pt-5">
          <div>
            <p className="text-lg font-semibold text-campus-text-primary">
              All students with fingerprint template IDs
            </p>
            <p className="text-sm text-campus-text-secondary">
              Search every fingerprint source in Firestore, including canonical
              records and synced enrollment-session exports.
            </p>
          </div>
        </CardHeader>
        <CardBody className="space-y-4 p-5 pt-3">
          <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1.5fr)_200px_220px_220px_200px]">
            <Input
              placeholder="Search name, School ID, UID, template ID, device ID, or session ID"
              value={search}
              onValueChange={setSearch}
              startContent={<Search size={16} className="text-campus-text-secondary" />}
            />
            <Select
              label="Source"
              selectedKeys={[sourceFilter]}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys as Set<Key>)[0];
                if (typeof selected === "string") {
                  setSourceFilter(selected as SourceFilter);
                }
              }}
            >
              {sourceOptions.map((option) => (
                <SelectItem key={option}>
                  {option === "all" ? "All sources" : option}
                </SelectItem>
              ))}
            </Select>
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
              variant={missingCanonicalOnly ? "solid" : "bordered"}
              color={missingCanonicalOnly ? "warning" : "default"}
              onPress={() => setMissingCanonicalOnly((current) => !current)}
            >
              Show synced but missing canonical only
            </Button>
            <Button
              variant="light"
              onPress={() => {
                setSearch("");
                setSourceFilter("all");
                setStatusFilter("all");
                setCourseFilter("all");
                setYearFilter("all");
                setDuplicatesOnly(false);
                setMissingCanonicalOnly(false);
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
                  <TableColumn>Student</TableColumn>
                  <TableColumn>Academic</TableColumn>
                  <TableColumn>Template ID</TableColumn>
                  <TableColumn>Device ID</TableColumn>
                  <TableColumn>Sources</TableColumn>
                  <TableColumn>Session ID</TableColumn>
                  <TableColumn>Last enrolled</TableColumn>
                  <TableColumn>Sync status</TableColumn>
                  <TableColumn>Mapping status</TableColumn>
                  <TableColumn>Actions</TableColumn>
                </TableHeader>
                <TableBody
                  emptyContent={
                    <div className="py-10 text-center text-sm text-campus-text-secondary">
                      {emptyStateMessage}
                    </div>
                  }
                  items={filteredMappings}
                >
                  {(mapping) => (
                    <TableRow key={mapping.rowId}>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-semibold text-campus-text-primary">
                            {mapping.studentName}
                          </p>
                          <p className="text-sm text-campus-text-secondary">
                            {mapping.schoolId}
                          </p>
                          <p className="text-xs text-campus-text-secondary">
                            UID: {mapping.uid}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1 text-sm">
                          <p className="text-campus-text-primary">{mapping.course}</p>
                          <p className="text-campus-text-secondary">
                            {mapping.yearLevel}
                          </p>
                          <p className="text-sm text-campus-text-secondary">
                            Section: {mapping.section || "-"}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <p className="font-semibold text-campus-text-primary">
                          #{mapping.templateId}
                        </p>
                      </TableCell>
                      <TableCell>
                        <p className="text-sm text-campus-text-primary">
                          {mapping.fingerprintDeviceId || "campus"}
                        </p>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1">
                            {mapping.sources.map((source) => (
                              <Chip
                                key={`${mapping.rowId}:${source}`}
                                size="sm"
                                variant="bordered"
                                color={sourceChipColor(source)}
                              >
                                {source}
                              </Chip>
                            ))}
                          </div>
                          {mapping.profileStatus ? (
                            <p className="text-xs text-campus-text-secondary">
                              Account: {mapping.profileStatus}
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <p className="text-sm text-campus-text-primary">
                            {mapping.sessionId || "-"}
                          </p>
                          {mapping.sessionIds.length > 1 ? (
                            <p className="text-xs text-campus-text-secondary">
                              +{mapping.sessionIds.length - 1} more
                            </p>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm text-campus-text-secondary">
                          {formatDateTime(mapping.lastEnrolledAtMs)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Chip
                          color={syncStatusChipColor(mapping.syncStatus)}
                          variant="flat"
                          size="sm"
                        >
                          {mapping.syncStatus || "-"}
                        </Chip>
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
                            {mapping.missingCanonical ? (
                              <Chip size="sm" color="warning" variant="bordered">
                                Missing canonical
                              </Chip>
                            ) : null}
                            {mapping.hasCanonicalSource ? (
                              <Chip size="sm" color="success" variant="bordered">
                                Canonical
                              </Chip>
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
                                    fingerprintDeviceId: mapping.fingerprintDeviceId,
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
                            <Tooltip content="Remove only stale or deleted mappings.">
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
                          {mapping.canRemoveMapping ? (
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
                          ) : null}
                          {mapping.canRemoveMapping ? (
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
                          ) : null}
                          {!mapping.canKeepTemplateOwner &&
                          !mapping.canRemoveStale &&
                          !mapping.canRemoveMapping ? (
                            <span className="text-xs text-campus-text-secondary">
                              Review only
                            </span>
                          ) : null}
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
                        All other mappings for the same device slot will be removed
                        or marked for re-enrollment.
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
                      Device {pendingAction?.mapping.fingerprintDeviceId || "Unknown"} -
                      {" "}Template #{pendingAction?.mapping.templateId} -{" "}
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

      <Modal
        isOpen={wipeModalMode !== null}
        onOpenChange={(open) => {
          if (!open && !wipeLoading) {
            resetWipeModal();
          }
        }}
        size="lg"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>
                {wipeModalMode === "full" ?
                  "Clear AS608 + Firebase Fingerprints" :
                  "Clear Firebase mappings only"}
              </ModalHeader>
              <ModalBody className="space-y-4">
                <div className="rounded-2xl border bg-[#fff7ed] px-4 py-3 text-sm text-campus-text-secondary">
                  <p className="font-semibold text-campus-text-primary">
                    Target device: {DEFAULT_FINGERPRINT_DEVICE_ID}
                  </p>
                  <p className="mt-1">
                    {wipeModalMode === "full" ?
                      "The browser cannot clear the AS608 directly. This action queues a module command and Firebase stays intact until the ESP32 confirms success." :
                      "This does not clear AS608 templates. Use only if the sensor has already been cleared manually."}
                  </p>
                </div>

                {wipeModalMode === "full" ? (
                  <ul className="list-disc space-y-2 pl-5 text-sm text-campus-text-secondary">
                    <li>This deletes all templates stored inside the AS608 sensor.</li>
                    <li>This clears `fingerprintTemplateId`, `templateId`, `fingerprintStatus`, and `hasFingerprint` mappings from Firebase profile and student records after device acknowledgment.</li>
                    <li>Students must be re-enrolled after this finishes.</li>
                    <li>Attendance may not work until re-enrollment is completed.</li>
                    <li>This does not delete student accounts.</li>
                    <li>This does not delete attendance records.</li>
                  </ul>
                ) : (
                  <ul className="list-disc space-y-2 pl-5 text-sm text-campus-text-secondary">
                    <li>Firebase fingerprint mappings will be cleared immediately.</li>
                    <li>AS608 templates are not touched by this action.</li>
                    <li>Use this only after the sensor database has already been cleared manually.</li>
                    <li>This does not delete student accounts.</li>
                    <li>This does not delete attendance records.</li>
                  </ul>
                )}

                <Switch
                  size="sm"
                  isSelected={markHistoricalRowsStale}
                  onValueChange={setMarkHistoricalRowsStale}
                  classNames={{
                    label: "text-sm text-campus-text-primary",
                  }}
                >
                  Also mark all previous synced enrollment session rows as stale
                </Switch>

                <Input
                  label="Reason"
                  placeholder="Explain why this wipe is needed"
                  value={wipeReason}
                  onValueChange={setWipeReason}
                />

                <Input
                  label={`Type ${activeWipeConfirmationText} to continue`}
                  placeholder={activeWipeConfirmationText}
                  value={wipeConfirmationText}
                  onValueChange={setWipeConfirmationText}
                />

                <p className="text-xs text-campus-text-secondary">
                  {wipeModalMode === "full" ?
                    "The command will stay pending until the module runs Cleanup Queue or Full Sync and confirms that the AS608 database was emptied." :
                    "This is the unsafe fallback path for cases where the AS608 has already been cleared outside the web app."}
                </p>
              </ModalBody>
              <ModalFooter className="justify-between">
                <Button
                  variant="bordered"
                  onPress={() => {
                    resetWipeModal();
                    onClose();
                  }}
                  isDisabled={wipeLoading}
                >
                  Cancel
                </Button>
                <Button
                  color={wipeModalMode === "firebase-only" ? "warning" : "danger"}
                  onPress={() => {
                    void submitWipeAction();
                  }}
                  isLoading={wipeLoading}
                  isDisabled={!wipeConfirmationMatches}
                >
                  {wipeModalMode === "full" ?
                    "Queue full wipe" :
                    "Clear Firebase mappings"}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Modal
        isOpen={buildModalOpen}
        onOpenChange={(open) => {
          if (!buildMappingsLoading) {
            setBuildModalOpen(open);
          }
        }}
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader>Build mappings from profiles</ModalHeader>
              <ModalBody className="space-y-4">
                <p className="text-sm text-campus-text-secondary">
                  This reads existing student profile fingerprint fields and
                  creates or updates `fingerprintTemplates` records for admin
                  cleanup. It does not touch the AS608 sensor, does not clear
                  templates, and does not delete student accounts.
                </p>
                <div className="rounded-2xl border bg-[#faf7f3] px-4 py-3 text-sm text-campus-text-secondary">
                  Use this when older profile data exists but the canonical
                  fingerprint mapping collection is still empty or incomplete.
                </div>
              </ModalBody>
              <ModalFooter className="justify-between">
                <Button
                  variant="bordered"
                  onPress={() => {
                    setBuildModalOpen(false);
                    onClose();
                  }}
                  isDisabled={buildMappingsLoading}
                >
                  Cancel
                </Button>
                <Button
                  color="primary"
                  onPress={() => {
                    void buildMappingsFromProfiles();
                  }}
                  isLoading={buildMappingsLoading}
                >
                  Build mappings
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
