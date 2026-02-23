"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from "@heroui/dropdown";
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/modal";
import { Select, SelectItem } from "@heroui/select";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { CampusBadge, CampusButton } from "@/components/heroui";
import { db } from "@/lib/firebase";
import {
  StudentEvent,
  StudentEventStatus,
  useStudentPortal,
} from "@/components/student/StudentPortalProvider";

type Notice = {
  type: "ok" | "err";
  msg: string;
};

type EventGroup = {
  date: string;
  dateMs: number;
  items: StudentEvent[];
};

type EventImageFile = {
  id: string;
  name?: string;
  downloadURL?: string;
  path?: string;
  createdAt?: unknown;
};

type EventSortMode = "oldest_to_latest" | "latest_to_oldest";
type EventStatusFilter = "all" | "upcoming" | "attended" | "missed";
type ImageModalSortMode = "ascending" | "descending";

type ViewAllImagesModal = {
  open: boolean;
  eventId: string;
  eventTitle: string;
};

function eventStatusChip(status: StudentEventStatus) {
  if (status === "Upcoming") return <CampusBadge status="upcoming">Upcoming</CampusBadge>;
  if (status === "Attended") return <CampusBadge status="completed">Attended</CampusBadge>;
  if (status === "Missed") return <CampusBadge status="missed">Missed</CampusBadge>;

  if (status === "Payment Due") {
    return (
      <span className="px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-700">
        Payment Due
      </span>
    );
  }

  return (
    <span className="px-3 py-1 rounded-full text-sm font-medium bg-gray-100 text-campus-text-primary">
      Pre-registration
    </span>
  );
}

function getEventTileStyle(status: StudentEventStatus) {
  if (status === "Missed") {
    return {
      backgroundColor: "#faa0bf",
      borderLeftColor: "#f7719f",
    };
  }

  if (status === "Attended") {
    return {
      backgroundColor: "#A2E9C1",
      borderLeftColor: "#64cf95",
    };
  }

  return {
    backgroundColor: "#CCE3FD",
    borderLeftColor: "#83b8f5",
  };
}

function formatTimeRange(event: StudentEvent) {
  return event.scheduledTime || "TBA";
}

function matchesStatusFilter(item: StudentEvent, filter: EventStatusFilter) {
  if (filter === "all") return true;
  if (filter === "attended") return item.status === "Attended";
  if (filter === "missed") return item.status === "Missed";

  return item.status === "Upcoming" || item.status === "Pre-registration";
}

function imageSortName(file: EventImageFile) {
  return String(file.name ?? file.id ?? "").trim().toLowerCase();
}

export default function StudentEvents() {
  const {
    events,
    loading,
    error,
    registeredEventIds,
    registerForEvent,
  } = useStudentPortal();

  const [openStates, setOpenStates] = useState<Record<string, boolean>>({});
  const [registeringId, setRegisteringId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sortMode, setSortMode] = useState<EventSortMode>("oldest_to_latest");
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>("all");
  const [eventImagesByEventId, setEventImagesByEventId] = useState<
    Record<string, EventImageFile[]>
  >({});
  const [eventImagesLoadingByEventId, setEventImagesLoadingByEventId] = useState<
    Record<string, boolean>
  >({});
  const [eventImagesErrorByEventId, setEventImagesErrorByEventId] = useState<
    Record<string, string>
  >({});
  const [viewAllImagesModal, setViewAllImagesModal] = useState<ViewAllImagesModal>({
    open: false,
    eventId: "",
    eventTitle: "",
  });
  const [imageModalSortMode, setImageModalSortMode] =
    useState<ImageModalSortMode>("ascending");
  const isMountedRef = useRef(true);

  const registeredSet = useMemo(
    () => new Set(registeredEventIds),
    [registeredEventIds]
  );

  const eventOnlyItems = useMemo(
    () => events.filter((item) => item.status !== "Payment Due"),
    [events]
  );

  const filteredEvents = useMemo(
    () => eventOnlyItems.filter((item) => matchesStatusFilter(item, statusFilter)),
    [eventOnlyItems, statusFilter]
  );

  const groupedEvents = useMemo<EventGroup[]>(() => {
    const map = new Map<string, EventGroup>();

    filteredEvents.forEach((item) => {
      const eventDate = item.eventDate;
      const dateLabel = eventDate
        ? eventDate.toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
          })
        : "No Date";
      const dateMs = eventDate
        ? new Date(
            eventDate.getFullYear(),
            eventDate.getMonth(),
            eventDate.getDate()
          ).getTime()
        : Number.MAX_SAFE_INTEGER;

      if (!map.has(dateLabel)) {
        map.set(dateLabel, {
          date: dateLabel,
          dateMs,
          items: [],
        });
      }

      map.get(dateLabel)!.items.push(item);
    });

    const direction = sortMode === "latest_to_oldest" ? -1 : 1;

    return Array.from(map.values())
      .sort((a, b) => (a.dateMs - b.dateMs) * direction)
      .map((group) => ({
        ...group,
        items: group.items.sort((a, b) => {
          const aMs = a.eventDate?.getTime() ?? 0;
          const bMs = b.eventDate?.getTime() ?? 0;
          return (aMs - bMs) * direction;
        }),
      }));
  }, [filteredEvents, sortMode]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const openEventIds = Object.entries(openStates)
      .filter(([, isOpen]) => isOpen)
      .map(([eventId]) => eventId);

    const toLoad = openEventIds.filter(
      (eventId) =>
        !(eventId in eventImagesByEventId) && !eventImagesLoadingByEventId[eventId]
    );

    if (toLoad.length === 0) return;

    setEventImagesLoadingByEventId((prev) => {
      const next = { ...prev };
      toLoad.forEach((eventId) => {
        next[eventId] = true;
      });
      return next;
    });

    void (async () => {
      const results = await Promise.all(
        toLoad.map(async (eventId) => {
          try {
            const snap = await getDocs(
              query(collection(db, "events", eventId, "images"), orderBy("createdAt", "desc"))
            );

            const files: EventImageFile[] = snap.docs.map((docSnap) => {
              const data = docSnap.data() as Partial<EventImageFile>;
              return {
                id: docSnap.id,
                name: String(data.name ?? "").trim() || undefined,
                downloadURL: String(data.downloadURL ?? "").trim() || undefined,
                path: String(data.path ?? "").trim() || undefined,
                createdAt: data.createdAt,
              };
            });

            return { eventId, files, error: "" };
          } catch {
            return { eventId, files: [] as EventImageFile[], error: "Failed to load photos." };
          }
        })
      );

      if (!isMountedRef.current) return;

      setEventImagesByEventId((prev) => {
        const next = { ...prev };
        results.forEach((result) => {
          next[result.eventId] = result.files;
        });
        return next;
      });

      setEventImagesErrorByEventId((prev) => {
        const next = { ...prev };
        results.forEach((result) => {
          if (result.error) next[result.eventId] = result.error;
          else delete next[result.eventId];
        });
        return next;
      });

      setEventImagesLoadingByEventId((prev) => {
        const next = { ...prev };
        results.forEach((result) => {
          next[result.eventId] = false;
        });
        return next;
      });
    })();
  }, [openStates, eventImagesByEventId, eventImagesLoadingByEventId]);

  const modalImages = useMemo(() => {
    if (!viewAllImagesModal.eventId) return [] as EventImageFile[];
    const rows = eventImagesByEventId[viewAllImagesModal.eventId] ?? [];
    const sorted = [...rows].sort((a, b) =>
      imageSortName(a).localeCompare(imageSortName(b))
    );
    if (imageModalSortMode === "descending") sorted.reverse();
    return sorted;
  }, [viewAllImagesModal.eventId, eventImagesByEventId, imageModalSortMode]);

  const toggleOpen = (eventId: string) => {
    setOpenStates((prev) => ({ ...prev, [eventId]: !prev[eventId] }));
  };

  const isOpen = (eventId: string) => Boolean(openStates[eventId]);

  function openViewAllImagesModal(eventId: string, eventTitle: string) {
    setViewAllImagesModal({
      open: true,
      eventId,
      eventTitle,
    });
  }

  function closeViewAllImagesModal() {
    setViewAllImagesModal({
      open: false,
      eventId: "",
      eventTitle: "",
    });
  }

  function getImageDownloadHref(file: EventImageFile) {
    if (!file.downloadURL) return "";

    const params = new URLSearchParams();
    params.set("url", file.downloadURL);
    if (file.name) params.set("name", file.name);
    return `/api/download?${params.toString()}`;
  }

  function downloadEventImage(file: EventImageFile) {
    const href = getImageDownloadHref(file);
    if (!href) return;

    const a = document.createElement("a");
    a.href = href;
    a.download = file.name || "event-image";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleRegister(eventId: string) {
    setRegisteringId(eventId);
    setNotice(null);

    const result = await registerForEvent(eventId);
    setNotice({
      type: result.ok ? "ok" : "err",
      msg: result.msg,
    });
    setRegisteringId(null);
  }

  return (
    <>
      <div className="space-y-4 sm:space-y-6 text-campus-text-primary">
      <h1 className="text-2xl sm:text-3xl font-bold mb-4 sm:mb-6 text-primary-900">
        Events
      </h1>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <Select
          aria-label="Sort events"
          label="Sort"
          size="sm"
          selectedKeys={[sortMode]}
          onChange={(e) => setSortMode(e.target.value as EventSortMode)}
          disallowEmptySelection
          className="w-full"
        >
          <SelectItem key="oldest_to_latest">Oldest to Latest</SelectItem>
          <SelectItem key="latest_to_oldest">Latest to Oldest</SelectItem>
        </Select>

        <Select
          aria-label="Filter events by status"
          label="Status"
          size="sm"
          selectedKeys={[statusFilter]}
          onChange={(e) => setStatusFilter(e.target.value as EventStatusFilter)}
          disallowEmptySelection
          className="w-full"
        >
          <SelectItem key="all">All</SelectItem>
          <SelectItem key="upcoming">Upcoming</SelectItem>
          <SelectItem key="attended">Attended</SelectItem>
          <SelectItem key="missed">Missed</SelectItem>
        </Select>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {notice && (
        <div
          className={[
            "mb-6 rounded-lg border px-4 py-3 text-sm",
            notice.type === "ok"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900"
              : "bg-red-50 border-red-200 text-red-900",
          ].join(" ")}
        >
          {notice.msg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-campus-text-secondary">Loading events...</p>
      ) : groupedEvents.length === 0 ? (
        <p className="text-sm text-campus-text-secondary">
          No events match the current sort/filter options.
        </p>
      ) : (
        <div className="space-y-8 sm:space-y-10">
          {groupedEvents.map((group) => (
            <div key={group.date}>
              <h2 className="text-lg font-semibold text-campus-text-primary mb-4">
                {group.date}
              </h2>

              <div className="space-y-4">
                {group.items.map((item) => {
                  const open = isOpen(item.id);
                  const registered = registeredSet.has(item.id);
                  const canRegister = item.status === "Pre-registration";
                  const requirementText = item.withPayment
                    ? "Bring payment receipt if required."
                    : "Follow event instructions from EC.";
                  const photos = eventImagesByEventId[item.id] ?? [];
                  const photosLoading = Boolean(eventImagesLoadingByEventId[item.id]);
                  const photosError = eventImagesErrorByEventId[item.id];

                  return (
                    <Card
                      key={item.id}
                      shadow="sm"
                      isPressable
                      onPress={() => toggleOpen(item.id)}
                      className="w-full border-l-4"
                      style={getEventTileStyle(item.status)}
                    >
                      <CardBody className="p-4 sm:p-5 w-full">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-lg font-semibold leading-snug break-words">
                              {item.title}
                            </h3>
                            <p className="text-sm text-campus-text-secondary mt-1 break-words">
                              {item.description}
                            </p>
                            <p className="text-xs text-campus-text-tertiary mt-2 break-words">
                              {group.date} | {formatTimeRange(item)}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {eventStatusChip(item.status)}
                          </div>
                        </div>

                        {open && (
                          <div
                            className="mt-3 sm:mt-4 p-3 sm:p-4 bg-gray-50 rounded-xl border text-sm space-y-1"
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <p>
                              <span className="font-medium">Location:</span>{" "}
                              {item.location || "TBA"}
                            </p>
                            <p>
                              <span className="font-medium">Requirement:</span>{" "}
                              {requirementText}
                            </p>
                            <p>
                              <span className="font-medium">Note:</span>{" "}
                              {item.details || "No additional notes."}
                            </p>

                            <div className="mt-3 border-t border-gray-200 pt-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-medium text-campus-text-primary">
                                  Uploaded Photos
                                </p>

                                {photos.length > 3 && (
                                  <button
                                    type="button"
                                    className="text-xs font-semibold text-primary-700 hover:underline"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      openViewAllImagesModal(item.id, item.title);
                                    }}
                                  >
                                    View all ({photos.length})
                                  </button>
                                )}
                              </div>

                              {photosLoading ? (
                                <p className="text-xs text-campus-text-secondary">
                                  Loading photos...
                                </p>
                              ) : photosError ? (
                                <p className="text-xs text-red-600">{photosError}</p>
                              ) : photos.length === 0 ? (
                                <p className="text-xs text-campus-text-secondary">
                                  No uploaded photos for this event.
                                </p>
                              ) : (
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                  {photos.slice(0, 3).map((photo) => (
                                    <div key={photo.id} className="rounded-lg border bg-white p-2">
                                      {photo.downloadURL ? (
                                        // eslint-disable-next-line @next/next/no-img-element
                                        <img
                                          src={photo.downloadURL}
                                          alt={photo.name || "event photo"}
                                          className="h-28 w-full rounded-md object-cover"
                                        />
                                      ) : (
                                        <div className="h-28 w-full rounded-md bg-gray-100 flex items-center justify-center text-xs text-campus-text-secondary">
                                          Image unavailable
                                        </div>
                                      )}

                                      <div className="mt-2 flex items-center justify-between gap-2">
                                        <p className="text-xs truncate text-campus-text-secondary">
                                          {photo.name || "Event photo"}
                                        </p>
                                        {photo.downloadURL && (
                                          <button
                                            type="button"
                                            className="text-xs font-semibold text-primary-700 hover:underline"
                                            onClick={(e) => {
                                              e.preventDefault();
                                              e.stopPropagation();
                                              downloadEventImage(photo);
                                            }}
                                          >
                                            Download
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {canRegister && (
                              <CampusButton
                                variant="secondary"
                                className="mt-3 w-full sm:w-auto"
                                disabled={registered || registeringId === item.id}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  void handleRegister(item.id);
                                }}
                              >
                                {registered
                                  ? "Registered"
                                  : registeringId === item.id
                                    ? "Registering..."
                                    : "Register"}
                              </CampusButton>
                            )}
                          </div>
                        )}
                      </CardBody>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      <Modal
        isOpen={viewAllImagesModal.open}
        onOpenChange={(open) => {
          if (!open) closeViewAllImagesModal();
        }}
        size="5xl"
        scrollBehavior="inside"
      >
        <ModalContent>
          {(onClose) => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <span>All Images</span>
                <span className="text-xs font-normal text-campus-text-secondary">
                  {viewAllImagesModal.eventTitle || "Event photos"}
                </span>
              </ModalHeader>

              <ModalBody>
                {modalImages.length === 0 ? (
                  <p className="text-sm text-campus-text-secondary">No images available.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex justify-end">
                      <Dropdown placement="bottom-end">
                        <DropdownTrigger>
                          <Button variant="bordered" className="h-8 min-w-0 px-3 text-xs sm:text-sm">
                            <span>
                              Sort by:{" "}
                              {imageModalSortMode === "ascending" ? "Ascending" : "Descending"}
                            </span>
                            <span className="material-icons text-base">expand_more</span>
                          </Button>
                        </DropdownTrigger>
                        <DropdownMenu
                          aria-label="Sort all images"
                          disallowEmptySelection
                          selectionMode="single"
                          selectedKeys={new Set([imageModalSortMode])}
                          onAction={(key) =>
                            setImageModalSortMode(String(key) as ImageModalSortMode)
                          }
                        >
                          <DropdownItem key="ascending">Ascending</DropdownItem>
                          <DropdownItem key="descending">Descending</DropdownItem>
                        </DropdownMenu>
                      </Dropdown>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {modalImages.map((photo) => (
                        <div key={photo.id} className="rounded-lg border bg-white p-2">
                          {photo.downloadURL ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={photo.downloadURL}
                              alt={photo.name || "event photo"}
                              className="h-32 w-full rounded-md object-cover"
                            />
                          ) : (
                            <div className="h-32 w-full rounded-md bg-gray-100 flex items-center justify-center text-xs text-campus-text-secondary">
                              Image unavailable
                            </div>
                          )}

                          <div className="mt-2">
                            <p className="text-xs truncate text-campus-text-secondary">
                              {photo.name || "Event photo"}
                            </p>
                            {photo.downloadURL && (
                              <button
                                type="button"
                                className="mt-1 text-xs font-semibold text-primary-700 hover:underline"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  downloadEventImage(photo);
                                }}
                              >
                                Download
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </ModalBody>

              <ModalFooter>
                <Button
                  variant="bordered"
                  onPress={() => {
                    onClose();
                    closeViewAllImagesModal();
                  }}
                >
                  Close
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  );
}
