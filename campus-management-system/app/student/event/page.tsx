"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import type { Selection } from "@react-types/shared";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
} from "@heroui/drawer";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal";
import { ScrollShadow } from "@heroui/scroll-shadow";
import { Select, SelectItem } from "@heroui/select";
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  MapPin,
  RotateCcw,
} from "lucide-react";
import { CampusMetricSkeleton } from "@/components/ui";
import {
  type StudentEvent,
  StudentAccountStatusChip,
  StudentCardStackSkeleton,
  StudentEmptyState,
  StudentEventCard,
  StudentEventStatusBadge,
  StudentFilterBar,
  StudentFilterBarSkeleton,
  StudentPageHeader,
  StudentStatsGrid,
  buildStudentAudienceLabel,
  formatStudentEventDate,
  getStudentEventTone,
  getStudentToneClasses,
  useIsBelowBreakpoint,
  useStudentPageErrorToast,
  useStudentPortal,
} from "@/components/student";
import { campusToast } from "@/lib/toast";

type EventSortMode = "oldest_to_latest" | "latest_to_oldest";
type EventStatusFilter = "all" | "upcoming" | "attended" | "missed";

type EventGroup = {
  label: string;
  dateMs: number;
  items: StudentEvent[];
};

function matchesStatusFilter(item: StudentEvent, filter: EventStatusFilter) {
  if (filter === "all") return true;
  if (filter === "attended") return item.status === "Attended";
  if (filter === "missed") return item.status === "Missed";

  return item.status === "Upcoming" || item.status === "Pre-registration";
}

function getGroupLabel(eventDate: Date | null) {
  if (!eventDate) return "No date available";

  return eventDate.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function getSingleSelectionValue(keys: Selection) {
  if (keys === "all") return null;

  const selected = Array.from(keys)[0];
  return typeof selected === "string" ? selected : null;
}

export default function StudentEventsPage() {
  const {
    profile,
    events,
    loading,
    error,
    registeredEventIds,
    registerForEvent,
  } = useStudentPortal();

  useStudentPageErrorToast(error, "student events");

  const [sortMode, setSortMode] = useState<EventSortMode>("oldest_to_latest");
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>("all");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [registeringId, setRegisteringId] = useState<string | null>(null);

  const isMobile = useIsBelowBreakpoint(1024);
  const registeredSet = useMemo(
    () => new Set(registeredEventIds),
    [registeredEventIds],
  );

  const eventOnlyItems = useMemo(
    () => events.filter((item) => item.status !== "Payment Due"),
    [events],
  );

  const filteredEvents = useMemo(
    () =>
      eventOnlyItems.filter((item) => matchesStatusFilter(item, statusFilter)),
    [eventOnlyItems, statusFilter],
  );

  const eventCounts = useMemo(
    () => ({
      upcoming: eventOnlyItems.filter(
        (item) =>
          item.status === "Upcoming" || item.status === "Pre-registration",
      ).length,
      attended: eventOnlyItems.filter((item) => item.status === "Attended")
        .length,
      missed: eventOnlyItems.filter((item) => item.status === "Missed").length,
    }),
    [eventOnlyItems],
  );

  const groupedEvents = useMemo<EventGroup[]>(() => {
    const direction = sortMode === "latest_to_oldest" ? -1 : 1;
    const groups = new Map<string, EventGroup>();

    filteredEvents.forEach((item) => {
      const dateMs = item.eventDate
        ? new Date(
            item.eventDate.getFullYear(),
            item.eventDate.getMonth(),
            item.eventDate.getDate(),
          ).getTime()
        : Number.MAX_SAFE_INTEGER;
      const label = getGroupLabel(item.eventDate);

      if (!groups.has(label)) {
        groups.set(label, {
          label,
          dateMs,
          items: [],
        });
      }

      groups.get(label)?.items.push(item);
    });

    return Array.from(groups.values())
      .sort((left, right) => (left.dateMs - right.dateMs) * direction)
      .map((group) => ({
        ...group,
        items: [...group.items].sort((left, right) => {
          const leftMs = left.eventDate?.getTime() ?? 0;
          const rightMs = right.eventDate?.getTime() ?? 0;
          return (leftMs - rightMs) * direction;
        }),
      }));
  }, [filteredEvents, sortMode]);

  const selectedEvent = useMemo(
    () =>
      eventOnlyItems.find((item) => item.id === selectedEventId) ?? null,
    [eventOnlyItems, selectedEventId],
  );

  const hasFilterOverrides =
    sortMode !== "oldest_to_latest" || statusFilter !== "all";
  const accountInactive = profile?.accountStatus === "Inactive";

  async function handleRegister(eventId: string) {
    setRegisteringId(eventId);

    const result = await registerForEvent(eventId);

    if (result.ok) {
      campusToast.success({
        title: "Registration submitted",
        description: result.msg,
        dedupeKey: `student-events:register:${eventId}`,
      });
    } else {
      campusToast.error({
        title: "Registration failed",
        description: result.msg,
        dedupeKey: `student-events:register-error:${eventId}`,
      });
    }

    setRegisteringId(null);
  }

  const detailsContent = selectedEvent ? (
    <StudentEventDetails
      event={selectedEvent}
      registered={registeredSet.has(selectedEvent.id)}
      accountInactive={accountInactive}
      isRegistering={registeringId === selectedEvent.id}
      onRegister={handleRegister}
    />
  ) : null;

  return (
    <div className="space-y-5 text-campus-text-primary sm:space-y-6">
      <StudentPageHeader
        variant="hero"
        icon={CalendarDays}
        title="Student Events"
        description="Browse your event timeline, review requirements quickly, and pre-register from a layout that stays comfortable on phones, tablets, and desktop."
        meta={
          <>
            <Chip className="border border-white/20 bg-white/10 text-white">
              {profile?.course || "Unassigned"}
            </Chip>
            <Chip className="border border-white/20 bg-white/10 text-white">
              {profile?.year || "Unassigned"}
            </Chip>
            <StudentAccountStatusChip
              status={profile?.accountStatus || "Active"}
              helperText={
                profile?.accountStatus === "Inactive"
                  ? "Approach EC member to activate your account before pre-registering."
                  : "Your student account can access current event actions."
              }
            />
          </>
        }
      />

      {loading ? (
        <CampusMetricSkeleton count={3} className="sm:grid-cols-3 xl:grid-cols-3" />
      ) : (
        <StudentStatsGrid
          items={[
            {
              label: "Upcoming",
              value: eventCounts.upcoming,
              description: "Events that are still open or waiting for your review.",
              tone: "amber",
              icon: Clock3,
            },
            {
              label: "Attended",
              value: eventCounts.attended,
              description: "Completed events where your attendance is marked present.",
              tone: "green",
              icon: CheckCircle2,
            },
            {
              label: "Missed",
              value: eventCounts.missed,
              description: "Completed events that still need follow-up or explanation.",
              tone: "red",
              icon: CircleAlert,
            },
          ]}
          className="xl:grid-cols-3"
        />
      )}

      {loading ? (
        <StudentFilterBarSkeleton filters={3} />
      ) : (
        <StudentFilterBar>
          <Select
            aria-label="Sort event timeline"
            label="Sort timeline"
            disallowEmptySelection
            selectedKeys={new Set([sortMode])}
            onSelectionChange={(keys) => {
              const selected = getSingleSelectionValue(keys);
              if (selected) setSortMode(selected as EventSortMode);
            }}
          >
            <SelectItem key="oldest_to_latest">Oldest to latest</SelectItem>
            <SelectItem key="latest_to_oldest">Latest to oldest</SelectItem>
          </Select>

          <Select
            aria-label="Filter events by status"
            label="Status"
            disallowEmptySelection
            selectedKeys={new Set([statusFilter])}
            onSelectionChange={(keys) => {
              const selected = getSingleSelectionValue(keys);
              if (selected) setStatusFilter(selected as EventStatusFilter);
            }}
          >
            <SelectItem key="all">All events</SelectItem>
            <SelectItem key="upcoming">Upcoming</SelectItem>
            <SelectItem key="attended">Attended</SelectItem>
            <SelectItem key="missed">Missed</SelectItem>
          </Select>

          <div className="flex flex-col justify-between rounded-[22px] border border-border/70 bg-slate-50/70 p-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-campus-text-primary">
                Quick actions
              </p>
              <p className="text-xs leading-5 text-campus-text-secondary">
                Reset the timeline view when you want to return to the default order.
              </p>
            </div>

            <Button
              variant="flat"
              startContent={<RotateCcw size={16} />}
              onPress={() => {
                setSortMode("oldest_to_latest");
                setStatusFilter("all");
              }}
              isDisabled={!hasFilterOverrides}
              className="mt-3 w-full sm:w-auto"
            >
              Reset filters
            </Button>
          </div>
        </StudentFilterBar>
      )}

      {loading ? (
        <StudentCardStackSkeleton rows={4} />
      ) : groupedEvents.length === 0 ? (
        <StudentEmptyState
          title="No events match this view"
          description="Try another status filter or reset the timeline to see your full student event list again."
          icon={CalendarDays}
          action={
            hasFilterOverrides ? (
              <Button
                color="primary"
                variant="flat"
                onPress={() => {
                  setSortMode("oldest_to_latest");
                  setStatusFilter("all");
                }}
              >
                Reset filters
              </Button>
            ) : null
          }
        />
      ) : (
        <div className="space-y-6">
          {groupedEvents.map((group) => (
            <section key={`${group.label}-${group.dateMs}`} className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-campus-text-primary">
                    {group.label}
                  </h2>
                  <p className="text-sm text-campus-text-secondary">
                    {group.items.length} event{group.items.length === 1 ? "" : "s"} in this
                    schedule group.
                  </p>
                </div>

                <Chip size="sm" className="bg-slate-100 text-slate-700">
                  {group.items.length} shown
                </Chip>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                {group.items.map((item, index) => {
                  const registered = registeredSet.has(item.id);
                  const hasFooter = item.isPreReg || item.withPayment || registered;

                  return (
                    <StudentEventCard
                      key={item.id}
                      className={clsx(
                        "h-full",
                        group.items.length % 2 === 1 &&
                          index === group.items.length - 1 &&
                          "xl:col-span-2",
                      )}
                      title={item.title}
                      description={item.description}
                      dateLabel={formatStudentEventDate(item.eventDate, item.date)}
                      timeLabel={item.scheduledTime}
                      location={item.location}
                      status={item.status}
                      audienceLabel={buildStudentAudienceLabel(
                        item.course,
                        item.yearLevel,
                      )}
                      onPress={() => setSelectedEventId(item.id)}
                      action={
                        <Button
                          color="primary"
                          variant={item.status === "Pre-registration" ? "flat" : "light"}
                          size="sm"
                          onPress={() => setSelectedEventId(item.id)}
                        >
                          {item.status === "Pre-registration"
                            ? "Review / register"
                            : "View details"}
                        </Button>
                      }
                      footer={hasFooter ? (
                        <div className="flex flex-wrap gap-2">
                          {item.isPreReg ? (
                            <Chip size="sm" className="bg-blue-100 text-blue-700">
                              Pre-registration
                            </Chip>
                          ) : null}
                          {item.withPayment ? (
                            <Chip size="sm" className="bg-amber-100 text-amber-700">
                              Payment linked
                            </Chip>
                          ) : null}
                          {registered ? (
                            <Chip size="sm" className="bg-emerald-100 text-emerald-700">
                              Registered
                            </Chip>
                          ) : null}
                        </div>
                      ) : undefined}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {selectedEvent ? (
        isMobile ? (
          <Drawer
            isOpen
            onOpenChange={(open) => {
              if (!open) setSelectedEventId(null);
            }}
            placement="bottom"
          >
            <DrawerContent className="max-h-[92dvh]">
              {(onClose) => (
                <>
                  <DrawerHeader className="border-b border-border/70">
                    <div className="space-y-1">
                      <p className="text-lg font-semibold text-campus-text-primary">
                        {selectedEvent.title}
                      </p>
                      <p className="text-sm text-campus-text-secondary">
                        Review event details and student actions.
                      </p>
                    </div>
                  </DrawerHeader>
                  <DrawerBody className="p-0">
                    <ScrollShadow className="max-h-[calc(92dvh-128px)]">
                      <div className="p-5">{detailsContent}</div>
                    </ScrollShadow>
                    <div className="border-t border-border/70 p-4">
                      <Button className="w-full" variant="flat" onPress={onClose}>
                        Close
                      </Button>
                    </div>
                  </DrawerBody>
                </>
              )}
            </DrawerContent>
          </Drawer>
        ) : (
          <Modal
            isOpen
            size="3xl"
            scrollBehavior="inside"
            onOpenChange={(open) => {
              if (!open) setSelectedEventId(null);
            }}
          >
            <ModalContent>
              {(onClose) => (
                <>
                  <ModalHeader className="flex flex-col gap-1">
                    <span className="text-lg font-semibold text-campus-text-primary">
                      {selectedEvent.title}
                    </span>
                    <span className="text-sm font-normal text-campus-text-secondary">
                      Student event details and registration steps.
                    </span>
                  </ModalHeader>
                  <ModalBody>
                    {detailsContent}
                  </ModalBody>
                  <ModalFooter>
                    <Button variant="flat" onPress={onClose}>
                      Close
                    </Button>
                  </ModalFooter>
                </>
              )}
            </ModalContent>
          </Modal>
        )
      ) : null}
    </div>
  );
}

function StudentEventDetails({
  event,
  registered,
  accountInactive,
  isRegistering,
  onRegister,
}: {
  event: StudentEvent;
  registered: boolean;
  accountInactive: boolean;
  isRegistering: boolean;
  onRegister: (eventId: string) => Promise<void>;
}) {
  const toneClasses = getStudentToneClasses(getStudentEventTone(event.status));
  const canRegister = event.status === "Pre-registration";
  const requirementText = event.withPayment
    ? "Bring your payment receipt if the EC requires verification during attendance or check-in."
    : "Follow the EC instructions shared for this event before arrival.";

  return (
    <div className="space-y-5">
      <div className={`rounded-[24px] p-4 sm:p-5 ${toneClasses.surface}`}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StudentEventStatusBadge status={event.status} />
            <Chip size="sm" className="bg-white/80 text-slate-700">
              {buildStudentAudienceLabel(event.course, event.yearLevel)}
            </Chip>
            {event.isPreReg ? (
              <Chip size="sm" className="bg-blue-100 text-blue-700">
                Pre-registration open
              </Chip>
            ) : null}
            {event.withPayment ? (
              <Chip size="sm" className="bg-amber-100 text-amber-700">
                Payment required
              </Chip>
            ) : null}
            {registered ? (
              <Chip size="sm" className="bg-emerald-100 text-emerald-700">
                Registered
              </Chip>
            ) : null}
          </div>

          <div className="space-y-2">
            <p className="text-base font-semibold text-campus-text-primary">
              {event.title}
            </p>
            <div className="flex flex-col gap-2 text-sm text-campus-text-secondary sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
              <span className="inline-flex items-center gap-1.5">
                <CalendarDays size={15} />
                {formatStudentEventDate(event.eventDate, event.date)} | {event.scheduledTime}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin size={15} />
                {event.location}
              </span>
            </div>
          </div>
        </div>
      </div>

      <DetailCard label="Description" value={event.description} />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <DetailCard label="Requirements" value={requirementText} />
        <DetailCard
          label="Additional notes"
          value={event.details || "No additional notes were added for this event."}
        />
      </div>

      {canRegister ? (
        <Card shadow="none" className="border border-border/70 bg-white/95">
          <CardBody className="gap-4 p-4 sm:p-5">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-campus-text-primary">
                Pre-registration action
              </p>
              <p className="text-sm leading-6 text-campus-text-secondary">
                Reserve your slot early if this event requires student registration before the event day.
              </p>
            </div>

            <Button
              color="primary"
              className="w-full sm:w-auto"
              onPress={() => onRegister(event.id)}
              isDisabled={registered || isRegistering || accountInactive}
            >
              {registered
                ? "Registered"
                : isRegistering
                  ? "Registering..."
                  : accountInactive
                    ? "Account inactive"
                    : "Register now"}
            </Button>

            {accountInactive ? (
              <p className="text-sm text-rose-700">
                Approach the EC member to activate your account before registering.
              </p>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {event.status === "Attended" ? (
        <Card shadow="none" className="border border-emerald-100 bg-emerald-50/80">
          <CardBody className="p-4 text-sm text-emerald-700">
            Your attendance for this completed event is already recorded as present.
          </CardBody>
        </Card>
      ) : null}

      {event.status === "Missed" ? (
        <Card shadow="none" className="border border-rose-100 bg-rose-50/80">
          <CardBody className="p-4 text-sm text-rose-700">
            This event was completed without a present attendance record on your account.
          </CardBody>
        </Card>
      ) : null}

      {event.status === "Upcoming" ? (
        <Card shadow="none" className="border border-amber-100 bg-amber-50/80">
          <CardBody className="p-4 text-sm text-amber-700">
            Keep this event on your radar and watch for updates in your notifications.
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}

function DetailCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[22px] border border-border/70 bg-slate-50/80 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-campus-text-secondary">
        {label}
      </p>
      <p className="mt-2 text-sm leading-6 text-campus-text-primary">{value}</p>
    </div>
  );
}
