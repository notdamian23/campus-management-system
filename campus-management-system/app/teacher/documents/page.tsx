"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import { Pagination } from "@heroui/pagination";
import { Select, SelectItem } from "@heroui/select";
import { Tooltip } from "@heroui/tooltip";
import {
  FileImage,
  FileStack,
  FileText,
  HardDrive,
  ImageIcon,
  Search,
} from "lucide-react";
import type { CampusTableColumn } from "@/components/ui";
import { CampusMetricSkeleton } from "@/components/ui";
import {
  TeacherDataTable,
  TeacherDetailPanelSkeleton,
  TeacherFilterBar,
  TeacherFilterBarSkeleton,
  TeacherFileDetailsDrawer,
  TeacherFileDetailsPanel,
  TeacherPageHeader,
  TeacherStatsGrid,
  formatTeacherBytes,
  formatTeacherDateTime,
  getTeacherFileTone,
  getTeacherToneClasses,
  teacherFileKindLabel,
  useIsBelowBreakpoint,
  useTeacherPageErrorToast,
  useTeacherPortal,
} from "@/components/teacher";

const FILES_PER_PAGE = 10;

const teacherDocumentColumns: CampusTableColumn<{
  id: string;
  name: string;
  kind: "docs" | "images";
  eventId: string;
  contentType: string;
  size: number;
  createdAtMs: number;
}>[] = [
  { key: "file", label: "File" },
  { key: "kind", label: "Type" },
  { key: "event", label: "Event" },
  { key: "size", label: "Size" },
  { key: "uploaded", label: "Uploaded" },
  { key: "actions", label: "Actions", align: "end", className: "text-right" },
];

type SelectOption = {
  key: string;
  label: string;
};

export default function TeacherDocumentsPage() {
  const { events, files, loading, error } = useTeacherPortal();
  const isCompactView = useIsBelowBreakpoint(1280);

  useTeacherPageErrorToast(error, "teacher documents");

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
      { key: "__all_events__", label: "All events" },
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

  const totalPages = Math.max(1, Math.ceil(filteredFiles.length / FILES_PER_PAGE));

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

  const totalStorageBytes = useMemo(
    () => files.reduce((sum, file) => sum + file.size, 0),
    [files],
  );
  const imageCount = useMemo(
    () => files.filter((file) => file.kind === "images").length,
    [files],
  );
  const documentCount = useMemo(
    () => files.filter((file) => file.kind === "docs").length,
    [files],
  );

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

    if (isCompactView) {
      if (
        selectedFileId &&
        !filteredFiles.some((file) => file.id === selectedFileId)
      ) {
        setSelectedFileId(null);
      }
      return;
    }

    if (
      !selectedFileId ||
      !filteredFiles.some((file) => file.id === selectedFileId)
    ) {
      setSelectedFileId(filteredFiles[0].id);
    }
  }, [filteredFiles, isCompactView, selectedFileId]);

  return (
    <div className="space-y-5 sm:space-y-6">
      <TeacherPageHeader
        variant="hero"
        icon={FileStack}
        title="Event Documents"
        description="Browse teacher-visible event files, including documents and photo evidence, with a cleaner review panel for metadata and downloads."
      />

      {loading ? (
        <CampusMetricSkeleton />
      ) : (
        <TeacherStatsGrid
          items={[
            {
              label: "Total Files",
              value: files.length,
              description: "Documents and images attached to teacher-visible events.",
              tone: "blue",
              icon: FileStack,
            },
            {
              label: "Documents",
              value: documentCount,
              description: "Event paperwork, reports, and other document uploads.",
              tone: "green",
              icon: FileText,
            },
            {
              label: "Images",
              value: imageCount,
              description: "Photo evidence and image uploads tied to events.",
              tone: "amber",
              icon: ImageIcon,
            },
            {
              label: "Storage",
              value: formatTeacherBytes(totalStorageBytes),
              description: "Combined storage footprint of teacher-visible event files.",
              tone: "purple",
              icon: HardDrive,
            },
          ]}
        />
      )}

      {loading ? (
        <TeacherFilterBarSkeleton />
      ) : (
        <TeacherFilterBar>
          <Input
            aria-label="Search event files"
            value={searchText}
            onValueChange={setSearchText}
            placeholder="Search file name, type, or event"
            startContent={<Search size={16} className="text-campus-text-secondary" />}
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
            <SelectItem key="__all_types__">All types</SelectItem>
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
        </TeacherFilterBar>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(340px,0.95fr)]">
        <div className="space-y-4">
          <TeacherDataTable
            ariaLabel="Teacher event files"
            columns={teacherDocumentColumns}
            items={paginatedFiles}
            getRowKey={(file) => file.id}
            emptyTitle="No files found"
            emptyDescription="Try another search term, file type, or event filter to widen the teacher-visible file list."
            selectionMode="single"
            selectedKeys={selectedFileId ? new Set([selectedFileId]) : new Set([])}
            onSelectionChange={(keys) => {
              if (keys === "all") return;
              const selected = Array.from(keys)[0];
              setSelectedFileId(typeof selected === "string" ? selected : null);
            }}
            isLoading={loading}
            renderCell={(file, columnKey) => {
              if (columnKey === "file") {
                const FileIcon = file.kind === "images" ? FileImage : FileText;

                return (
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
                      <FileIcon size={16} />
                    </div>
                    <div className="min-w-0">
                      <Tooltip content={file.name} placement="top-start">
                        <p className="max-w-[260px] truncate font-semibold text-campus-text-primary">
                          {file.name}
                        </p>
                      </Tooltip>
                      <p className="text-xs text-campus-text-secondary">
                        {file.contentType || "Unknown content type"}
                      </p>
                    </div>
                  </div>
                );
              }

              if (columnKey === "kind") {
                const toneClasses = getTeacherToneClasses(
                  getTeacherFileTone(file.kind),
                );

                return (
                  <Chip size="sm" className={toneClasses.chip}>
                    {teacherFileKindLabel(file.kind)}
                  </Chip>
                );
              }

              if (columnKey === "event") {
                return (
                  <p className="max-w-[220px] truncate text-sm text-campus-text-secondary">
                    {eventMap.get(file.eventId)?.title || "Unknown event"}
                  </p>
                );
              }

              if (columnKey === "size") {
                return formatTeacherBytes(file.size);
              }

              if (columnKey === "uploaded") {
                return formatTeacherDateTime(file.createdAtMs);
              }

              if (columnKey === "actions") {
                const isSelected = selectedFileId === file.id;

                return (
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      color="primary"
                      variant={isSelected ? "flat" : "light"}
                      onPress={() => setSelectedFileId(file.id)}
                    >
                      {isCompactView ? "View file" : "View details"}
                    </Button>
                  </div>
                );
              }

              return null;
            }}
          />

          {!loading && filteredFiles.length > FILES_PER_PAGE ? (
            <div className="flex justify-center sm:justify-end">
              <Pagination
                showControls
                page={page}
                total={totalPages}
                onChange={(nextPage) => setPage(nextPage)}
              />
            </div>
          ) : null}
        </div>

        {loading ? (
          <div className="hidden xl:block">
            <TeacherDetailPanelSkeleton />
          </div>
        ) : (
          <div className="hidden xl:block">
            <TeacherFileDetailsPanel
              file={selectedFile}
              event={selectedFileEvent}
              className="xl:sticky xl:top-6"
            />
          </div>
        )}
      </div>

      <TeacherFileDetailsDrawer
        file={selectedFile}
        event={selectedFileEvent}
        isOpen={isCompactView && Boolean(selectedFile)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedFileId(null);
          }
        }}
      />
    </div>
  );
}
