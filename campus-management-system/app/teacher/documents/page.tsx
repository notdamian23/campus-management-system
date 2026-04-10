"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import {
  CampusDataTable,
  type CampusTableColumn,
  CampusDetailSkeleton,
  CampusMetricSkeleton,
} from "@/components/ui";
import { useTeacherPortal } from "@/components/teacher/TeacherPortalProvider";

const FILES_PER_PAGE = 10;

const teacherDocumentColumns: CampusTableColumn<{
  id: string;
  name: string;
  kind: "docs" | "images";
  eventId: string;
  size: number;
  createdAtMs: number;
}>[] = [
  { key: "name", label: "File" },
  { key: "kind", label: "Type" },
  { key: "event", label: "Event" },
  { key: "size", label: "Size" },
  { key: "createdAtMs", label: "Uploaded" },
  { key: "actions", label: "Actions", align: "end", className: "text-right" },
];

type SelectOption = {
  key: string;
  label: string;
};

function formatDate(ms: number) {
  if (!ms) return "Unknown date";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toMegabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function downloadTeacherFile(url: string, name: string) {
  if (!url) return;

  const params = new URLSearchParams({
    url,
    name: name || "event-file",
  });
  const anchor = document.createElement("a");
  anchor.href = `/api/download?${params.toString()}`;
  anchor.download = name || "event-file";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

export default function TeacherDocumentsPage() {
  const { events, files, loading, error } = useTeacherPortal();

  const [searchText, setSearchText] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");
  const [page, setPage] = useState(1);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);

  const eventMap = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events],
  );

  const eventOptions = useMemo<SelectOption[]>(
    () => [
      { key: "__all_events__", label: "All Events" },
      ...events
        .slice()
        .sort((a, b) => a.title.localeCompare(b.title))
        .map((event) => ({ key: event.id, label: event.title })),
    ],
    [events],
  );

  const filteredFiles = useMemo(() => {
    const search = searchText.trim().toLowerCase();

    return files
      .filter((file) => {
        const eventTitle = eventMap.get(file.eventId)?.title ?? "";
        const matchesSearch =
          !search ||
          file.name.toLowerCase().includes(search) ||
          file.contentType.toLowerCase().includes(search) ||
          eventTitle.toLowerCase().includes(search);
        const matchesType = typeFilter ? file.kind === typeFilter : true;
        const matchesEvent = eventFilter ? file.eventId === eventFilter : true;
        return matchesSearch && matchesType && matchesEvent;
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [eventFilter, eventMap, files, searchText, typeFilter]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredFiles.length / FILES_PER_PAGE),
  );

  const paginatedFiles = useMemo(() => {
    const start = (page - 1) * FILES_PER_PAGE;
    return filteredFiles.slice(start, start + FILES_PER_PAGE);
  }, [filteredFiles, page]);

  const selectedFile = useMemo(
    () => files.find((file) => file.id === selectedFileId) ?? null,
    [files, selectedFileId],
  );

  const selectedFileEvent = selectedFile
    ? (eventMap.get(selectedFile.eventId) ?? null)
    : null;

  useEffect(() => {
    setPage(1);
  }, [eventFilter, searchText, typeFilter]);

  useEffect(() => {
    setPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (filteredFiles.length === 0) {
      setSelectedFileId(null);
      return;
    }

    if (
      !selectedFileId ||
      !filteredFiles.some((file) => file.id === selectedFileId)
    ) {
      setSelectedFileId(filteredFiles[0].id);
    }
  }, [filteredFiles, selectedFileId]);

  const totalStorageBytes = files.reduce((sum, file) => sum + file.size, 0);
  const imageCount = files.filter((file) => file.kind === "images").length;
  const documentCount = files.filter((file) => file.kind === "docs").length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <Card shadow="sm">
        <CardBody className="space-y-2 p-5 sm:p-6">
          <h1 className="text-2xl font-bold text-primary-900 sm:text-3xl">
            Event Documents
          </h1>
          <p className="text-sm text-campus-text-secondary">
            Teachers can browse and download the files attached to campus
            events, including event documents and photo documentation.
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </CardBody>
      </Card>

      {loading ? (
        <CampusMetricSkeleton />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Total Files"
            value={String(files.length)}
            tone="text-blue-700"
          />
          <MetricCard
            label="Documents"
            value={String(documentCount)}
            tone="text-emerald-700"
          />
          <MetricCard
            label="Images"
            value={String(imageCount)}
            tone="text-amber-700"
          />
          <MetricCard
            label="Storage"
            value={toMegabytes(totalStorageBytes)}
            tone="text-fuchsia-700"
          />
        </div>
      )}

      <Card shadow="sm">
        <CardBody className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Input
            aria-label="Search event files"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Search file name, type, or event..."
          />

          <Select
            aria-label="Filter by file type"
            disallowEmptySelection
            selectedKeys={new Set([typeFilter || "__all_types__"])}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0];
              if (typeof selected === "string") {
                setTypeFilter(selected === "__all_types__" ? "" : selected);
              }
            }}
          >
            <SelectItem key="__all_types__">All Types</SelectItem>
            <SelectItem key="docs">Documents</SelectItem>
            <SelectItem key="images">Images</SelectItem>
          </Select>

          <Select
            aria-label="Filter by event"
            disallowEmptySelection
            items={eventOptions}
            selectedKeys={new Set([eventFilter || "__all_events__"])}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0];
              if (typeof selected === "string") {
                setEventFilter(selected === "__all_events__" ? "" : selected);
              }
            }}
          >
            {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
          </Select>

          <div className="flex items-center justify-between rounded-xl border border-dashed border-border px-4 py-3 text-sm text-campus-text-secondary">
            <span>Visible files</span>
            <span className="font-semibold text-campus-text-primary">
              {loading ? "-" : filteredFiles.length}
            </span>
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,1fr)]">
        <Card shadow="sm">
          <CardBody className="p-4 sm:p-5">
            <CampusDataTable
              ariaLabel="Teacher event files"
              columns={teacherDocumentColumns}
              items={paginatedFiles}
              isLoading={loading}
              emptyTitle="No files match the current filters"
              emptyDescription="Try another search term, type, or event."
              renderCell={(file, columnKey) => {
                if (columnKey === "name") {
                  return (
                    <div className="space-y-1">
                      <p className="max-w-[280px] truncate font-semibold text-campus-text-primary">
                        {file.name}
                      </p>
                      {selectedFileId === file.id ? (
                        <Chip size="sm" color="primary" variant="flat">
                          Selected
                        </Chip>
                      ) : null}
                    </div>
                  );
                }

                if (columnKey === "kind") {
                  return (
                    <Chip
                      size="sm"
                      className={
                        file.kind === "images"
                          ? "bg-amber-100 text-amber-700"
                          : "bg-blue-100 text-blue-700"
                      }
                    >
                      {file.kind === "images" ? "Image" : "Document"}
                    </Chip>
                  );
                }

                if (columnKey === "event") {
                  return eventMap.get(file.eventId)?.title || "Unknown event";
                }

                if (columnKey === "size") {
                  return toMegabytes(file.size);
                }

                if (columnKey === "createdAtMs") {
                  return formatDate(file.createdAtMs);
                }

                if (columnKey === "actions") {
                  return (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant={
                          selectedFileId === file.id ? "flat" : "bordered"
                        }
                        color="primary"
                        onPress={() => setSelectedFileId(file.id)}
                      >
                        {selectedFileId === file.id ? "Viewing" : "Open"}
                      </Button>
                    </div>
                  );
                }

                return null;
              }}
            />
          </CardBody>
        </Card>

        <Card shadow="sm">
          <CardBody className="space-y-4 p-5">
            <h2 className="text-lg font-semibold text-campus-text-primary">
              File Details
            </h2>

            {loading ? (
              <CampusDetailSkeleton rows={5} />
            ) : selectedFile ? (
              <>
                <div className="space-y-3">
                  <DetailRow label="Name" value={selectedFile.name} />
                  <DetailRow
                    label="Event"
                    value={selectedFileEvent?.title || "Unknown event"}
                  />
                  <DetailRow
                    label="Type"
                    value={
                      selectedFile.kind === "images" ? "Image" : "Document"
                    }
                  />
                  <DetailRow
                    label="Uploaded"
                    value={formatDate(selectedFile.createdAtMs)}
                  />
                  <DetailRow
                    label="Size"
                    value={toMegabytes(selectedFile.size)}
                  />
                  <DetailRow
                    label="Content Type"
                    value={selectedFile.contentType || "Unknown"}
                  />
                </div>

                <Button
                  color="primary"
                  className="w-full"
                  onPress={() =>
                    downloadTeacherFile(
                      selectedFile.downloadURL,
                      selectedFile.name,
                    )
                  }
                  isDisabled={!selectedFile.downloadURL}
                >
                  Download File
                </Button>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-campus-text-secondary">
                Select a file to review its details.
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      {!loading && filteredFiles.length > FILES_PER_PAGE && (
        <div className="flex justify-center">
          <Pagination
            showControls
            page={page}
            total={totalPages}
            onChange={(nextPage) => setPage(nextPage)}
          />
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: string;
}) {
  return (
    <Card shadow="sm">
      <CardBody className="p-5">
        <p className="text-sm text-campus-text-secondary">{label}</p>
        <h2 className={`mt-2 text-3xl font-bold ${tone}`}>{value}</h2>
      </CardBody>
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-campus-text-secondary">
        {label}
      </p>
      <p className="mt-1 break-words text-sm text-campus-text-primary">
        {value}
      </p>
    </div>
  );
}
