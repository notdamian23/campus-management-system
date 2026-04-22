"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import {
  CreditCard,
  FileStack,
  LayoutDashboard,
  Search,
} from "lucide-react";
import {
  ECPageHeader,
  ECQuickActionCard,
  ECStatsGrid,
  type ECStatItem,
} from "@/components/ecmember";
import { auth, db } from "@/lib/firebase";
import {
  type CampusProfileDoc,
  resolveCampusDisplayName,
} from "@/lib/campus-auth";
import {
  canManageStudent,
  canViewEvent,
  getCourseScope,
  isBOD,
} from "@/lib/ec-permissions";
import {
  type CampusDocumentListItem,
  getCampusFunctions,
  listCampusDocuments,
  listCampusPayments,
} from "@/lib/firebase-functions";
import {
  hasStudentIdentityProfile,
  isStudentAudienceProfile,
} from "@/lib/student-audience";

type ViewerProfile = CampusProfileDoc & {
  uid: string;
};

type DashboardMetricKey =
  | "students"
  | "events"
  | "payments"
  | "documents";

type DashboardMetricState = {
  value: number | null;
  loading: boolean;
  error: string | null;
};

type DashboardMetricsState = Record<DashboardMetricKey, DashboardMetricState>;

type StudentLookupRow = {
  uid?: string;
  role?: string;
  schoolId?: string;
  studentId?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  studentName?: string;
  name?: string;
  course?: string;
  year?: string;
  yearLevel?: string;
  status?: string;
};

type EventDashboardDoc = {
  id: string;
  date?: string;
  scheduledTime?: string;
  timeStart?: string;
  timeEnd?: string;
  ownerType?: "ec" | "bod";
  courseScope?: string | null;
  createdByCourseScope?: string | null;
};

const DASHBOARD_SCOPE_MISSING_ERROR = "Course scope missing for B.O.D account";

function createLoadingMetricsState(): DashboardMetricsState {
  return {
    students: { value: null, loading: true, error: null },
    events: { value: null, loading: true, error: null },
    payments: { value: null, loading: true, error: null },
    documents: { value: null, loading: true, error: null },
  };
}

function parseTime12ToMinutes(timeValue?: string) {
  const value = String(timeValue ?? "").trim();
  if (!value) return null;

  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3].toUpperCase();

  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;

  return hour * 60 + minute;
}

function computeEventStatus(event: Pick<EventDashboardDoc, "date" | "scheduledTime" | "timeStart" | "timeEnd">) {
  const startMinutes = parseTime12ToMinutes(
    event.scheduledTime || event.timeStart,
  );
  const endMinutes = parseTime12ToMinutes(event.timeEnd);
  if (startMinutes == null) return "upcoming" as const;

  const [year, month, day] = String(event.date ?? "").split("-").map(Number);
  if (!year || !month || !day) return "upcoming" as const;

  const now = new Date();
  const eventDate = new Date(year, month - 1, day);
  const start = new Date(eventDate);
  start.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);

  if (endMinutes == null) {
    return now < start ? ("upcoming" as const) : ("completed" as const);
  }

  const safeEndMinutes =
    endMinutes >= startMinutes ? endMinutes : startMinutes + 60;
  const end = new Date(eventDate);
  end.setHours(
    Math.floor(safeEndMinutes / 60),
    safeEndMinutes % 60,
    0,
    0,
  );

  if (now < start) return "upcoming" as const;
  if (now >= start && now <= end) return "ongoing" as const;
  return "completed" as const;
}

function toMetricErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null) {
    const maybe = error as { message?: unknown };
    if (typeof maybe.message === "string" && maybe.message.trim()) {
      return maybe.message;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}

const QUICK_LINKS = [
  {
    title: "Student Lookup",
    text: "Find student profiles and inspect individual status records.",
    href: "/ecmember/students",
    cta: "Open student lookup",
    icon: Search,
  },
  {
    title: "Events",
    text: "Create events, monitor files, and manage notifications.",
    href: "/ecmember/event",
    cta: "Open events",
    icon: LayoutDashboard,
  },
  {
    title: "Payments",
    text: "Track collection status and export reports for assigned students.",
    href: "/ecmember/payment",
    cta: "Open payments",
    icon: CreditCard,
  },
  {
    title: "Documents",
    text: "Upload, sort, and share the EC document library from one place.",
    href: "/ecmember/document",
    cta: "Open documents",
    icon: FileStack,
  },
];

export default function ECMemberDashboard() {
  const router = useRouter();
  const functions = useMemo(() => getCampusFunctions(), []);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [viewerProfile, setViewerProfile] = useState<ViewerProfile | null>(null);
  const [viewerProfileReady, setViewerProfileReady] = useState(false);
  const [metricStates, setMetricStates] = useState<DashboardMetricsState>(
    createLoadingMetricsState,
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setDisplayName(null);
        setViewerProfile(null);
        setViewerProfileReady(true);
        return;
      }

      try {
        const snap = await getDoc(doc(db, "profiles", user.uid));
        if (!snap.exists()) {
          setViewerProfile({ uid: user.uid });
          setDisplayName("User");
          return;
        }

        const profile = {
          uid: user.uid,
          ...(snap.data() as CampusProfileDoc),
        };
        setViewerProfile(profile);
        setDisplayName(resolveCampusDisplayName(profile));
      } catch {
        setViewerProfile({ uid: user.uid });
        setDisplayName("User");
      } finally {
        setViewerProfileReady(true);
      }
    });

    return () => unsub();
  }, []);

  const loadDashboardMetrics = useCallback(
    async (profile: ViewerProfile) => {
      const viewerIsBod = isBOD(profile);
      const viewerCourseScope = getCourseScope(profile);

      if (viewerIsBod && !viewerCourseScope) {
        setMetricStates({
          students: {
            value: null,
            loading: false,
            error: DASHBOARD_SCOPE_MISSING_ERROR,
          },
          events: {
            value: null,
            loading: false,
            error: DASHBOARD_SCOPE_MISSING_ERROR,
          },
          payments: {
            value: null,
            loading: false,
            error: DASHBOARD_SCOPE_MISSING_ERROR,
          },
          documents: {
            value: null,
            loading: false,
            error: DASHBOARD_SCOPE_MISSING_ERROR,
          },
        });
        return;
      }

      setMetricStates(createLoadingMetricsState());

      const loadStudentsMetric = async () => {
        const listStudents = httpsCallable<
          { limit: number; includeEcMembers: boolean },
          { students?: StudentLookupRow[] }
        >(functions, "ecListStudents");
        const response = await listStudents({
          limit: 2000,
          includeEcMembers: true,
        });

        const visibleActiveStudents = (response.data?.students ?? []).filter(
          (student) =>
            isStudentAudienceProfile(student) &&
            hasStudentIdentityProfile(student) &&
            String(student.status ?? "").trim().toLowerCase() !== "inactive" &&
            canManageStudent(profile, { course: student.course }),
        );

        return visibleActiveStudents.length;
      };

      const loadEventsMetric = async () => {
        const eventRows: EventDashboardDoc[] = [];

        if (viewerIsBod && viewerCourseScope) {
          const [ecEventsSnap, scopedEventsSnap] = await Promise.all([
            getDocs(query(collection(db, "events"), where("ownerType", "==", "ec"))),
            getDocs(
              query(
                collection(db, "events"),
                where("courseScope", "==", viewerCourseScope),
              ),
            ),
          ]);

          const mergedEvents = new Map<string, EventDashboardDoc>();
          [...ecEventsSnap.docs, ...scopedEventsSnap.docs].forEach((snapshot) => {
            const event = {
              id: snapshot.id,
              ...(snapshot.data() as Omit<EventDashboardDoc, "id">),
            };

            if (canViewEvent(profile, event)) {
              mergedEvents.set(event.id, event);
            }
          });

          eventRows.push(...mergedEvents.values());
        } else {
          const allEventsSnap = await getDocs(collection(db, "events"));
          allEventsSnap.docs.forEach((snapshot) => {
            const event = {
              id: snapshot.id,
              ...(snapshot.data() as Omit<EventDashboardDoc, "id">),
            };

            if (canViewEvent(profile, event)) {
              eventRows.push(event);
            }
          });
        }

        return eventRows.filter(
          (event) => computeEventStatus(event) === "upcoming",
        ).length;
      };

      const loadPaymentsMetric = async () => {
        const payments = await listCampusPayments();
        return payments.filter(
          (payment) =>
            Number(payment.totalStudents ?? 0) > 0 &&
            Number(payment.unpaidCount ?? 0) > 0,
        ).length;
      };

      const loadDocumentsMetric = async () => {
        try {
          const documentRows = await listCampusDocuments();
          const dedupedDocuments = new Map<string, CampusDocumentListItem>();

          documentRows.forEach((documentRow) => {
            const documentId = String(documentRow.id ?? "").trim();
            const status = String(documentRow.status ?? "").trim().toLowerCase();

            if (!documentId || status === "pending-upload") {
              return;
            }

            dedupedDocuments.set(documentId, documentRow);
          });

          const visibleDocuments = Array.from(dedupedDocuments.values());

          if (!viewerIsBod) {
            return visibleDocuments.length;
          }

          return visibleDocuments.filter((documentRow) => {
            const ownerType = String(documentRow.ownerType ?? "").trim().toLowerCase();
            if (ownerType !== "bod") {
              return false;
            }

            const ownershipValues = [
              documentRow.createdBy,
              documentRow.createdByUid,
              documentRow.uploadedByUid,
              documentRow.ownerUid,
              documentRow.uploadedBy,
            ]
              .map((value) => String(value ?? "").trim())
              .filter(Boolean);

            return ownershipValues.some((value) => value === profile.uid);
          }).length;
        } catch {
          throw new Error("Failed to load document count.");
        }
      };

      const [
        studentsResult,
        eventsResult,
        paymentsResult,
        documentsResult,
      ] = await Promise.allSettled([
        loadStudentsMetric(),
        loadEventsMetric(),
        loadPaymentsMetric(),
        loadDocumentsMetric(),
      ]);

      setMetricStates({
        students:
          studentsResult.status === "fulfilled"
            ? { value: studentsResult.value, loading: false, error: null }
            : {
                value: null,
                loading: false,
                error: toMetricErrorMessage(
                  studentsResult.reason,
                  "Failed to load students.",
                ),
              },
        events:
          eventsResult.status === "fulfilled"
            ? { value: eventsResult.value, loading: false, error: null }
            : {
                value: null,
                loading: false,
                error: toMetricErrorMessage(
                  eventsResult.reason,
                  "Failed to load events.",
                ),
              },
        payments:
          paymentsResult.status === "fulfilled"
            ? { value: paymentsResult.value, loading: false, error: null }
            : {
                value: null,
                loading: false,
                error: toMetricErrorMessage(
                  paymentsResult.reason,
                  "Failed to load payments.",
                ),
              },
        documents:
          documentsResult.status === "fulfilled"
            ? { value: documentsResult.value, loading: false, error: null }
            : {
                value: null,
                loading: false,
                error: toMetricErrorMessage(
                  documentsResult.reason,
                  "Failed to load documents.",
                ),
              },
      });
    },
    [functions],
  );

  useEffect(() => {
    if (!viewerProfileReady) {
      return;
    }

    if (!viewerProfile) {
      setMetricStates(createLoadingMetricsState());
      return;
    }

    void loadDashboardMetrics(viewerProfile);
  }, [loadDashboardMetrics, viewerProfile, viewerProfileReady]);

  const viewerIsBod = useMemo(() => isBOD(viewerProfile), [viewerProfile]);
  const viewerCourseScope = useMemo(
    () => getCourseScope(viewerProfile),
    [viewerProfile],
  );

  const dashboardMetrics = useMemo<ECStatItem[]>(
    () => [
      {
        label: "Total Students",
        value:
          metricStates.students.loading ?
            "..." :
            metricStates.students.error ?
              "—" :
              metricStates.students.value ?? "—",
        description:
          metricStates.students.loading ?
            "Loading active student profiles..." :
            metricStates.students.error ?
              metricStates.students.error :
              "Active student profiles in your current view",
        tone: "blue",
        icon: Search,
      },
      {
        label: "Upcoming Events",
        value:
          metricStates.events.loading ?
            "..." :
            metricStates.events.error ?
              "—" :
              metricStates.events.value ?? "—",
        description:
          metricStates.events.loading ?
            "Loading visible upcoming events..." :
            metricStates.events.error ?
              metricStates.events.error :
              "Upcoming events you can currently access",
        tone: "amber",
        icon: LayoutDashboard,
      },
      {
        label: "Pending Payments",
        value:
          metricStates.payments.loading ?
            "..." :
            metricStates.payments.error ?
              "—" :
              metricStates.payments.value ?? "—",
        description:
          metricStates.payments.loading ?
            "Loading pending payment records..." :
            metricStates.payments.error ?
              metricStates.payments.error :
              "Payment records that still have unpaid assignments",
        tone: "red",
        icon: CreditCard,
      },
      {
        label: "Shared Documents",
        value:
          metricStates.documents.loading ?
            "..." :
            metricStates.documents.error ?
              "—" :
              metricStates.documents.value ?? "—",
        description:
          metricStates.documents.loading ?
            viewerIsBod ?
              "Loading your uploaded documents..." :
              "Loading accessible documents..." :
            metricStates.documents.error ?
              metricStates.documents.error :
              viewerIsBod ?
                "Documents uploaded by your B.O.D account" :
                "Documents you can access and download right now",
        tone: "purple",
        icon: FileStack,
      },
    ],
    [metricStates, viewerIsBod],
  );

  return (
    <div className="space-y-5 sm:space-y-6">
      <ECPageHeader
        title={`Welcome back${displayName ? `, ${displayName}` : ""}.`}
        description="Keep student operations, events, payments, and shared documents moving from one EC workspace that stays usable on phones, tablets, and desktop."
        eyebrow="EC Member"
        icon={LayoutDashboard}
        variant="hero"
        meta={
          <>
            <Chip variant="flat" className="bg-white/15 text-white">
              Student lookup
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              Event workflow
            </Chip>
            <Chip variant="flat" className="bg-white/15 text-white">
              Document sharing
            </Chip>
            {viewerIsBod && viewerCourseScope && (
              <Chip variant="flat" className="bg-white/15 text-white">
                Course scope: {viewerCourseScope}
              </Chip>
            )}
            {viewerIsBod && !viewerCourseScope && viewerProfileReady && (
              <Chip variant="flat" className="bg-amber-100 text-amber-900">
                Scope missing
              </Chip>
            )}
          </>
        }
      />

      <ECStatsGrid items={dashboardMetrics} />

      <section className="space-y-3">
        <div className="space-y-1">
          <h2 className="text-xl font-semibold text-campus-text-primary">
            Quick Access
          </h2>
          <p className="text-sm text-campus-text-secondary">
            Jump into the EC modules you use most often.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {QUICK_LINKS.map((item) => (
            <ECQuickActionCard
              key={item.href}
              title={item.title}
              description={item.text}
              icon={item.icon}
              meta={
                item.href === "/ecmember/event" ? (
                  <Chip size="sm" className="bg-blue-50 text-blue-700">
                    Includes notifications
                  </Chip>
                ) : item.href === "/ecmember/document" ? (
                  <Chip size="sm" className="bg-violet-50 text-violet-700">
                    Shared file library
                  </Chip>
                ) : item.href === "/ecmember/payment" ? (
                  <Chip size="sm" className="bg-amber-50 text-amber-700">
                    Export-ready reports
                  </Chip>
                ) : (
                  <Chip size="sm" className="bg-emerald-50 text-emerald-700">
                    Student records
                  </Chip>
                )
              }
              action={
                <Button
                  color={item.href === "/ecmember/event" ? "primary" : "default"}
                  className="w-full sm:w-auto"
                  onPress={() => router.push(item.href)}
                >
                  {item.cta}
                </Button>
              }
            />
          ))}
        </div>
      </section>
    </div>
  );
}
