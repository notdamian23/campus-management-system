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
import { Input } from "@heroui/input";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal";
import { ScrollShadow } from "@heroui/scroll-shadow";
import { Select, SelectItem } from "@heroui/select";
import { Tab, Tabs } from "@heroui/tabs";
import {
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock3,
  MapPin,
  RotateCcw,
  Search,
} from "lucide-react";
import {
  AllEventImagesModal,
  EventDetailInfoRow,
  EventDetailSectionCard,
  EventDetailStat,
  EventFilesTabs,
  eventDetailTabsClassNames,
} from "@/components/events/EventDetailsShared";
import { CampusMetricSkeleton } from "@/components/ui";
import {
  type StudentEvent,
  StudentAccountStatusChip,
  StudentCardStackSkeleton,
  StudentEmptyState,
  StudentEventCard,
  StudentEventLifecycleBadge,
  StudentEventStatusBadge,
  StudentFilterBar,
  StudentFilterBarSkeleton,
  StudentPageHeader,
  StudentStatsGrid,
  buildStudentAudienceLabel,
  getStudentEventLifecycleTone,
  getStudentEventTone,
  getStudentToneClasses,
  shouldShowStudentEventContextStatus,
  useIsBelowBreakpoint,
  useStudentPageErrorToast,
  useStudentPortal,
} from "@/components/student";
import { downloadTeacherFile } from "@/components/teacher/teacher-feedback";
import { formatEventScheduleDisplay } from "@/lib/eventSchedule";
import { campusToast } from "@/lib/toast";

type EventSortMode = "oldest_to_latest" | "latest_to_oldest";
type EventStatusFilter = "all" | "upcoming" | "ongoing" | "attended" | "missed";

type EventGroup = {
  label: string;
  dateMs: number;
  items: StudentEvent[];
};

function matchesStatusFilter(item: StudentEvent, filter: EventStatusFilter) {
  if (filter === "all") return true;
  if (filter === "upcoming") return item.lifecycle === "upcoming";
  if (filter === "ongoing") return item.lifecycle === "ongoing";
  if (filter === "attended") return item.status === "Attended";
  if (filter === "missed") return item.status === "Missed";
  return false;
}

function matchesEventSearch(item: StudentEvent, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return true;

  return [item.title, item.description, item.location].some((value) =>
    String(value ?? "").toLowerCase().includes(normalizedQuery),
  );
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

function getStudentEventSchedule(
  event: Pick<
    StudentEvent,
    "date" | "eventDate" | "scheduledTime" | "timeStart" | "timeEnd"
  >,
) {
  return formatEventScheduleDisplay({
    date: event.eventDate ?? event.date,
    scheduledTime: event.scheduledTime,
    timeStart: event.timeStart,
    timeEnd: event.timeEnd,
  });
}

export default function StudentEventsPage() {
  const {
    profile,
    events,
    loading,
    error,
    registeredEventIds,
    registrationsByEvent,
    registerForEvent,
    cancelEventRegistration,
  } = useStudentPortal();

  useStudentPageErrorToast(error, "student events");

  const [sortMode, setSortMode] = useState<EventSortMode>("oldest_to_latest");
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>("all");
  const [searchText, setSearchText] = useState("");
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [actioningId, setActioningId] = useState<string | null>(null);

  const isMobile = useIsBelowBreakpoint(1024);
  const registeredSet = useMemo(
    () => new Set(registeredEventIds),
    [registeredEventIds],
  );

  const eventOnlyItems = useMemo(() => events, [events]);

  const filteredEvents = useMemo(
    () =>
      eventOnlyItems.filter(
        (item) =>
          matchesStatusFilter(item, statusFilter) &&
          matchesEventSearch(item, searchText),
      ),
    [eventOnlyItems, searchText, statusFilter],
  );

  const eventCounts = useMemo(
    () => ({
      upcoming: eventOnlyItems.filter((item) => item.lifecycle === "upcoming")
        .length,
      ongoing: eventOnlyItems.filter((item) => item.lifecycle === "ongoing")
        .length,
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
  const selectedEventSchedule = useMemo(
    () => (selectedEvent ? getStudentEventSchedule(selectedEvent) : null),
    [selectedEvent],
  );

  const hasActiveSearch = searchText.trim().length > 0;
  const hasFilterOverrides =
    sortMode !== "oldest_to_latest" ||
    statusFilter !== "all" ||
    hasActiveSearch;
  const accountInactive = profile?.accountStatus === "Inactive";

  async function handleRegister(eventId: string) {
    setActioningId(eventId);

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

    setActioningId(null);
  }

  async function handleCancelRegistration(eventId: string) {
    setActioningId(eventId);

    const result = await cancelEventRegistration(eventId);

    if (result.ok) {
      campusToast.success({
        title: "Registration updated",
        description: result.msg,
        dedupeKey: `student-events:cancel:${eventId}`,
      });
    } else {
      campusToast.error({
        title: "Cancellation failed",
        description: result.msg,
        dedupeKey: `student-events:cancel-error:${eventId}`,
      });
    }

    setActioningId(null);
  }

  const detailsContent = selectedEvent ? (
    <StudentEventDetails
      event={selectedEvent}
      registered={registeredSet.has(selectedEvent.id)}
      registrationStatus={registrationsByEvent[selectedEvent.id]?.status ?? null}
      accountInactive={accountInactive}
      isRegistering={actioningId === selectedEvent.id}
      isCompactView={isMobile}
      onRegister={handleRegister}
      onCancelRegistration={handleCancelRegistration}
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
        <CampusMetricSkeleton
          count={4}
          className="sm:grid-cols-2 xl:grid-cols-4"
        />
      ) : (
        <StudentStatsGrid
          items={[
            {
              label: "Upcoming",
              value: eventCounts.upcoming,
              description: "Events that have not reached their start time yet.",
              tone: "amber",
              icon: Clock3,
            },
            {
              label: "Ongoing",
              value: eventCounts.ongoing,
              description: "Events currently happening within their scheduled time.",
              tone: "blue",
              icon: CalendarDays,
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
          className="sm:grid-cols-2 xl:grid-cols-4"
        />
      )}

      {loading ? (
        <StudentFilterBarSkeleton filters={4} />
      ) : (
        <StudentFilterBar>
          <Input
            aria-label="Search events"
            label="Search events"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Search title, description, or venue"
            startContent={<Search size={16} className="text-campus-text-secondary" />}
            className="md:col-span-2 xl:col-span-3"
          />

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
            <SelectItem key="ongoing">Ongoing</SelectItem>
            <SelectItem key="attended">Attended</SelectItem>
            <SelectItem key="missed">Missed</SelectItem>
          </Select>

          <div className="flex flex-col justify-between rounded-[22px] border border-border/70 bg-slate-50/70 p-3 md:col-span-2 xl:col-span-1">
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
                setSearchText("");
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
          title={hasActiveSearch ? "No events match your search" : "No events match this view"}
          description={
            hasActiveSearch
              ? "Try a different keyword or reset the timeline filters to see your full student event list again."
              : "Try another status filter or reset the timeline to see your full student event list again."
          }
          icon={CalendarDays}
          action={
            hasFilterOverrides ? (
              <Button
                color="primary"
                variant="flat"
                onPress={() => {
                  setSearchText("");
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
                  const hasFooter =
                    item.isPreReg ||
                    item.withPayment ||
                    Boolean(item.registrationStatus);
                  const schedule = getStudentEventSchedule(item);

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
                      scheduleLabel={schedule.scheduleLabel}
                      location={item.location}
                      status={item.status}
                      lifecycle={item.lifecycle}
                      audienceLabel={buildStudentAudienceLabel(
                        item.course,
                        item.yearLevel,
                      )}
                      onPress={() => setSelectedEventId(item.id)}
                      action={
                        <Button
                          color="primary"
                          variant={
                            item.status === "Pre-registration" ||
                            item.status === "Pre-registered" ||
                            item.status === "Waitlisted"
                              ? "flat"
                              : "light"
                          }
                          size="sm"
                          onPress={() => setSelectedEventId(item.id)}
                        >
                          {item.status === "Pre-registration"
                            ? "Review / register"
                            : item.status === "Pre-registered" ||
                                item.status === "Waitlisted"
                              ? "Review registration"
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
                              Payment required
                            </Chip>
                          ) : null}
                          {item.registrationStatus === "PRE_REGISTERED" ? (
                            <Chip size="sm" className="bg-emerald-100 text-emerald-700">
                              Pre-registered
                            </Chip>
                          ) : null}
                          {item.registrationStatus === "WAITLISTED" ? (
                            <Chip size="sm" className="bg-amber-100 text-amber-700">
                              Waitlisted
                            </Chip>
                          ) : null}
                          {item.registrationStatus === "CANCELLED" ? (
                            <Chip size="sm" className="bg-slate-100 text-slate-700">
                              Cancelled
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
                        {`${selectedEventSchedule?.scheduleLabel ?? "Date TBA | Time TBA"} | ${selectedEvent.location}`}
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
                      {`${selectedEventSchedule?.scheduleLabel ?? "Date TBA | Time TBA"} | ${selectedEvent.location}`}
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
  registrationStatus,
  accountInactive,
  isRegistering,
  isCompactView,
  onRegister,
  onCancelRegistration,
}: {
  event: StudentEvent;
  registered: boolean;
  registrationStatus: StudentEvent["registrationStatus"];
  accountInactive: boolean;
  isRegistering: boolean;
  isCompactView: boolean;
  onRegister: (eventId: string) => Promise<void>;
  onCancelRegistration: (eventId: string) => Promise<void>;
}) {
  const [detailTab, setDetailTab] = useState<"overview" | "images">("overview");
  const [imagesModalOpen, setImagesModalOpen] = useState(false);
  const toneClasses = getStudentToneClasses(
    shouldShowStudentEventContextStatus(event.status, event.lifecycle)
      ? getStudentEventTone(event.status)
      : getStudentEventLifecycleTone(event.lifecycle),
  );
  const canRegister = event.status === "Pre-registration";
  const canCancel =
    event.lifecycle !== "completed" &&
    (registrationStatus === "PRE_REGISTERED" ||
      registrationStatus === "WAITLISTED") &&
    (!event.cancellationDeadlineAtMs ||
      Date.now() <= event.cancellationDeadlineAtMs);
  const showRegistrationActionCard =
    event.lifecycle !== "completed" &&
    (registrationStatus === "PRE_REGISTERED" ||
      registrationStatus === "WAITLISTED");
  const previewImageFiles = event.imageFiles.slice(0, 3);
  const schedule = getStudentEventSchedule(event);
  const slotsRemaining =
    event.preRegRemaining ??
    (typeof event.preRegSlots === "number"
      ? Math.max(0, event.preRegSlots - event.preRegCount)
      : 0);
  const requirementText = event.withPayment
    ? "Payment is required for this event. You will not be treated as an eligible attendee until the EC marks the linked payment as paid on your account."
    : "Follow the EC instructions shared for this event before arrival.";

  return (
    <div className="space-y-5">
      <Card
        shadow="none"
        className="overflow-hidden border border-border/70 bg-white/95 shadow-[0_18px_42px_rgba(15,23,42,0.08)]"
      >
        <CardBody className="gap-5 p-4 sm:p-5">
          <div className={`rounded-[24px] p-4 sm:p-5 ${toneClasses.surface}`}>
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <StudentEventLifecycleBadge lifecycle={event.lifecycle} />
                {shouldShowStudentEventContextStatus(event.status, event.lifecycle) ? (
                  <StudentEventStatusBadge status={event.status} />
                ) : null}
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
                {registrationStatus === "PRE_REGISTERED" ? (
                  <Chip size="sm" className="bg-emerald-100 text-emerald-700">
                    Pre-registered
                  </Chip>
                ) : null}
                {registrationStatus === "WAITLISTED" ? (
                  <Chip size="sm" className="bg-amber-100 text-amber-700">
                    Waitlisted
                  </Chip>
                ) : null}
                {registrationStatus === "CANCELLED" ? (
                  <Chip size="sm" className="bg-slate-100 text-slate-700">
                    Cancelled
                  </Chip>
                ) : null}
              </div>

              <div className="space-y-2">
                <p className="text-xl font-semibold text-campus-text-primary">
                  {event.title}
                </p>
                <div className="flex flex-col gap-2 text-sm text-campus-text-secondary sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
                  <span className="inline-flex items-center gap-1.5">
                    <CalendarDays size={15} />
                    {schedule.dateLabel}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock3 size={15} />
                    {schedule.timeLabel}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin size={15} />
                    {event.location}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <EventDetailStat label="Pre-Reg" value={event.preRegCount} tone="blue" />
            <EventDetailStat label="Waitlist" value={event.waitlistCount} tone="green" />
            <EventDetailStat label="Slots Left" value={slotsRemaining} tone="red" />
            <EventDetailStat label="Images" value={event.imageCount} tone="purple" />
          </div>

          <Tabs
            aria-label="Student event detail tabs"
            selectedKey={detailTab}
            onSelectionChange={(key) =>
              setDetailTab(String(key) as "overview" | "images")
            }
            fullWidth
            classNames={{
              ...eventDetailTabsClassNames,
              tabList: "w-full grid grid-cols-2 rounded-2xl bg-slate-100/90 p-1",
            }}
          >
            <Tab key="overview" title="Overview">
              <div className="space-y-4 pt-3">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <EventDetailSectionCard title="Event summary">
                    <div className="space-y-4">
                      <EventDetailInfoRow
                        label="Audience"
                        value={buildStudentAudienceLabel(event.course, event.yearLevel)}
                      />
                      <EventDetailInfoRow
                        label="Schedule"
                        value={schedule.scheduleLabel}
                      />
                      <EventDetailInfoRow
                        label="Location"
                        value={event.location}
                      />
                      <EventDetailInfoRow
                        label="Registration"
                        value={
                          event.isPreReg
                            ? `Enabled${typeof event.preRegSlots === "number" ? ` (${event.preRegSlots} slots)` : ""}`
                            : "Not required"
                        }
                      />
                    </div>
                  </EventDetailSectionCard>

                  <EventDetailSectionCard title="Event details">
                    <p className="text-sm leading-6 text-campus-text-secondary">
                      {event.description}
                    </p>
                  </EventDetailSectionCard>
                </div>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <EventDetailSectionCard title="Requirements">
                    <p className="text-sm leading-6 text-campus-text-secondary">
                      {requirementText}
                    </p>
                  </EventDetailSectionCard>

                  <EventDetailSectionCard title="Additional notes">
                    <p className="text-sm leading-6 text-campus-text-secondary">
                      {event.details || "No additional notes were added for this event."}
                    </p>
                  </EventDetailSectionCard>
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
                          ? "Already registered"
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

                {!canRegister && showRegistrationActionCard ? (
                  <Card shadow="none" className="border border-border/70 bg-white/95">
                    <CardBody className="gap-4 p-4 sm:p-5">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-campus-text-primary">
                          Registration status
                        </p>
                        <p className="text-sm leading-6 text-campus-text-secondary">
                          {registrationStatus === "WAITLISTED"
                            ? "You are currently on the waitlist. If a confirmed slot opens, the system can promote your registration automatically."
                            : "Your pre-registration is already recorded for this event."}
                        </p>
                      </div>

                      <Button
                        color="danger"
                        variant="flat"
                        className="w-full sm:w-auto"
                        onPress={() => onCancelRegistration(event.id)}
                        isDisabled={!canCancel || isRegistering}
                      >
                        {isRegistering
                          ? "Updating..."
                          : canCancel
                            ? "Cancel registration"
                            : "Cancellation closed"}
                      </Button>

                      {!canCancel ? (
                        <p className="text-sm text-campus-text-secondary">
                          The cancellation deadline has already passed for this event.
                        </p>
                      ) : null}
                    </CardBody>
                  </Card>
                ) : null}

                {registrationStatus === "CANCELLED" ? (
                  <Card shadow="none" className="border border-slate-200 bg-slate-50/80">
                    <CardBody className="p-4 text-sm text-slate-700">
                      Your pre-registration was cancelled before attendance verification.
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

                {!shouldShowStudentEventContextStatus(
                  event.status,
                  event.lifecycle,
                ) && event.lifecycle === "upcoming" ? (
                  <Card shadow="none" className="border border-amber-100 bg-amber-50/80">
                    <CardBody className="p-4 text-sm text-amber-700">
                      Keep this event on your radar and watch for updates in your notifications.
                    </CardBody>
                  </Card>
                ) : null}

                {!shouldShowStudentEventContextStatus(
                  event.status,
                  event.lifecycle,
                ) && event.lifecycle === "ongoing" ? (
                  <Card shadow="none" className="border border-blue-100 bg-blue-50/80">
                    <CardBody className="p-4 text-sm text-blue-700">
                      This event is currently ongoing based on its scheduled start and end time.
                    </CardBody>
                  </Card>
                ) : null}

                {!shouldShowStudentEventContextStatus(
                  event.status,
                  event.lifecycle,
                ) && event.lifecycle === "completed" ? (
                  <Card
                    shadow="none"
                    className="border border-emerald-100 bg-emerald-50/80"
                  >
                    <CardBody className="p-4 text-sm text-emerald-700">
                      This event has already finished based on its scheduled end time.
                    </CardBody>
                  </Card>
                ) : null}

                {event.status === "Waitlisted" ? (
                  <Card shadow="none" className="border border-amber-100 bg-amber-50/80">
                    <CardBody className="p-4 text-sm text-amber-700">
                      This event is currently full, and your registration is on the waitlist.
                    </CardBody>
                  </Card>
                ) : null}

                {event.status === "Payment Due" ? (
                  <Card shadow="none" className="border border-amber-100 bg-amber-50/80">
                    <CardBody className="p-4 text-sm text-amber-700">
                      Payment Required: complete the linked EC payment first. The backend will reject registration and attendance validation until that payment is marked paid on your account.
                    </CardBody>
                  </Card>
                ) : null}
              </div>
            </Tab>

            <Tab key="images" title="Images">
              <div className="space-y-5 pt-3">
                <EventFilesTabs
                  activeView="images"
                  onViewChange={() => undefined}
                  imageCount={event.imageCount}
                  previewImageFiles={previewImageFiles}
                  onOpenImages={() => setImagesModalOpen(true)}
                  onDownloadFile={(file) =>
                    downloadTeacherFile({
                      url: file.downloadURL ?? "",
                      name: file.name,
                      sourceLabel: "image",
                    })
                  }
                  showDocuments={false}
                  imageEmptyState={{
                    title: "No event images yet",
                    description: "Student-visible event images will appear here once the EC uploads them.",
                  }}
                />
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>

      <AllEventImagesModal
        isOpen={imagesModalOpen}
        onOpenChange={setImagesModalOpen}
        files={event.imageFiles}
        eventTitle={event.title}
        isCompactView={isCompactView}
        onDownloadFile={(file) =>
          downloadTeacherFile({
            url: file.downloadURL ?? "",
            name: file.name,
            sourceLabel: "image",
          })
        }
        introText="Browse student-visible event images and download what you need."
        emptyState={{
          title: "No images found",
          description: "Student-visible event images will appear here once the EC uploads them.",
        }}
      />
    </div>
  );
}
