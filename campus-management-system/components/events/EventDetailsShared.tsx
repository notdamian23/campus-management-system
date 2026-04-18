"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { Button } from "@heroui/button";
import { Card, CardBody, CardHeader } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Input } from "@heroui/input";
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from "@heroui/modal";
import { Select, SelectItem } from "@heroui/select";
import { Download, FileText, ImageIcon, Search } from "lucide-react";
import {
  CampusDetailTile,
  CampusMetricCard,
  CampusSectionCard,
} from "@/components/ui";
import {
  formatTeacherBytes,
  getTeacherToneClasses,
  isTeacherImageFile,
} from "@/components/teacher/teacher-helpers";

export type EventDetailTone = "blue" | "green" | "red" | "purple";
export type EventFilesView = "images" | "documents";
export type EventFileSortMode = "name_asc" | "name_desc" | "newest" | "oldest";

export type EventDetailFileItem = {
  id: string;
  name: string;
  kind: "docs" | "images";
  size: number;
  downloadURL?: string;
  contentType?: string;
  createdAtMs?: number;
};

type EmptyStateCopy = {
  title: string;
  description: string;
};

type FileActionRenderer = (file: EventDetailFileItem) => ReactNode;

const fileSortOptions: Array<{ key: EventFileSortMode; label: string }> = [
  { key: "name_asc", label: "Ascending" },
  { key: "name_desc", label: "Descending" },
  { key: "newest", label: "Newest to oldest" },
  { key: "oldest", label: "Oldest to newest" },
];

const defaultImageEmptyState: EmptyStateCopy = {
  title: "No event images yet",
  description: "Event images will appear here once uploaded.",
};

const defaultDocumentEmptyState: EmptyStateCopy = {
  title: "No event documents yet",
  description: "Event documents will appear here once uploaded.",
};

export const eventDetailTabsClassNames = {
  tabList: "w-full grid grid-cols-3 rounded-2xl bg-slate-100/90 p-1",
  cursor: "rounded-[14px] bg-white shadow-sm",
  tab: "min-h-11 w-full min-w-0 rounded-[14px] px-2",
  tabContent: "truncate text-xs font-medium sm:text-sm",
};

export function sortEventDetailFiles(
  files: EventDetailFileItem[],
  sortMode: EventFileSortMode,
) {
  const next = [...files];

  next.sort((left, right) => {
    if (sortMode === "name_asc") {
      return (
        left.name.localeCompare(right.name) ||
        (right.createdAtMs ?? 0) - (left.createdAtMs ?? 0)
      );
    }

    if (sortMode === "name_desc") {
      return (
        right.name.localeCompare(left.name) ||
        (right.createdAtMs ?? 0) - (left.createdAtMs ?? 0)
      );
    }

    if (sortMode === "oldest") {
      return (
        (left.createdAtMs ?? 0) - (right.createdAtMs ?? 0) ||
        left.name.localeCompare(right.name)
      );
    }

    return (
      (right.createdAtMs ?? 0) - (left.createdAtMs ?? 0) ||
      left.name.localeCompare(right.name)
    );
  });

  return next;
}

export function EventDetailStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: EventDetailTone;
}) {
  const toneClasses = getTeacherToneClasses(tone);

  return (
    <CampusMetricCard
      label={label}
      value={value}
      surfaceClassName="bg-slate-50/70"
      valueClassName={toneClasses.value}
      className="shadow-none"
    />
  );
}

export function EventDetailInfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return <CampusDetailTile label={label} value={value} className="border-none bg-transparent" />;
}

export function EventDetailSectionCard({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <CampusSectionCard
      title={title}
      surfaceClassName="bg-slate-50/70"
      bodyClassName="space-y-4 p-4 sm:p-5"
      className="shadow-none"
      titleClassName="text-sm"
    >
      {children}
    </CampusSectionCard>
  );
}

export function EventFilesTabs({
  activeView,
  onViewChange,
  imageCount,
  documentCount = 0,
  previewImageFiles,
  previewDocumentFiles = [],
  onOpenImages,
  onOpenDocuments,
  onDownloadFile,
  renderImageActions,
  renderDocumentActions,
  showDocuments = true,
  imageEmptyState = defaultImageEmptyState,
  documentEmptyState = defaultDocumentEmptyState,
}: {
  activeView: EventFilesView;
  onViewChange: (view: EventFilesView) => void;
  imageCount: number;
  documentCount?: number;
  previewImageFiles: EventDetailFileItem[];
  previewDocumentFiles?: EventDetailFileItem[];
  onOpenImages?: () => void;
  onOpenDocuments?: () => void;
  onDownloadFile: (file: EventDetailFileItem) => void;
  renderImageActions?: FileActionRenderer;
  renderDocumentActions?: FileActionRenderer;
  showDocuments?: boolean;
  imageEmptyState?: EmptyStateCopy;
  documentEmptyState?: EmptyStateCopy;
}) {
  const options: Array<{ key: EventFilesView; label: string }> = showDocuments
    ? [
        { key: "images", label: "Images" },
        { key: "documents", label: "Documents" },
      ]
    : [{ key: "images", label: "Images" }];

  const body =
    !showDocuments || activeView === "images" ? (
      <ImagePreviewSection
        files={previewImageFiles}
        totalCount={imageCount}
        emptyState={imageEmptyState}
        onOpenAll={onOpenImages}
        onDownloadFile={onDownloadFile}
        renderActions={renderImageActions}
      />
    ) : (
      <DocumentPreviewSection
        files={previewDocumentFiles}
        totalCount={documentCount}
        emptyState={documentEmptyState}
        onOpenAll={onOpenDocuments}
        onDownloadFile={onDownloadFile}
        renderActions={renderDocumentActions}
      />
    );

  if (!showDocuments) {
    return <div className="space-y-5">{body}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-center sm:justify-start">
        <div
          role="tablist"
          aria-label="Event files categories"
          className="inline-flex rounded-full border border-border/70 bg-slate-100/90 p-1"
        >
          {options.map((option) => {
            const isActive = activeView === option.key;

            return (
              <button
                key={option.key}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => onViewChange(option.key)}
                className={[
                  "rounded-full px-4 py-2 text-sm font-semibold transition-all sm:px-5",
                  isActive
                    ? "bg-white text-campus-text-primary shadow-sm"
                    : "text-campus-text-secondary hover:text-campus-text-primary",
                ].join(" ")}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {body}
    </div>
  );
}

export function AllEventImagesModal({
  isOpen,
  onOpenChange,
  files,
  eventTitle,
  isCompactView,
  onDownloadFile,
  renderImageActions,
  emptyState = defaultImageEmptyState,
  introText = "Browse all event images and download what you need.",
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  files: EventDetailFileItem[];
  eventTitle: string;
  isCompactView: boolean;
  onDownloadFile: (file: EventDetailFileItem) => void;
  renderImageActions?: FileActionRenderer;
  emptyState?: EmptyStateCopy;
  introText?: string;
}) {
  const [sortMode, setSortMode] = useState<EventFileSortMode>("name_asc");

  useEffect(() => {
    if (!isOpen) {
      setSortMode("name_asc");
    }
  }, [isOpen]);

  const sortedFiles = useMemo(
    () => sortEventDetailFiles(files, sortMode),
    [files, sortMode],
  );

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size={isCompactView ? "full" : "5xl"}
      scrollBehavior="inside"
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <span className="text-xl font-semibold text-campus-text-primary">
                All Images
              </span>
              <span className="text-sm font-normal text-campus-text-secondary">
                {eventTitle
                  ? `${eventTitle} | ${files.length} image${files.length === 1 ? "" : "s"}`
                  : `${files.length} image${files.length === 1 ? "" : "s"}`}
              </span>
            </ModalHeader>

            <ModalBody className="space-y-5 pb-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-campus-text-secondary">{introText}</p>
                <Select
                  aria-label="Sort images"
                  disallowEmptySelection
                  items={fileSortOptions}
                  selectedKeys={new Set([sortMode])}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const selected = Array.from(keys)[0];
                    if (typeof selected === "string") {
                      setSortMode(selected as EventFileSortMode);
                    }
                  }}
                  className="w-full sm:max-w-[240px]"
                >
                  {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
                </Select>
              </div>

              {sortedFiles.length === 0 ? (
                <EventFilesEmptyState
                  title={emptyState.title}
                  description={emptyState.description}
                  icon={ImageIcon}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {sortedFiles.map((file) => (
                    <ImagePreviewCard
                      key={file.id}
                      file={file}
                      onDownloadFile={onDownloadFile}
                      actions={renderImageActions?.(file)}
                    />
                  ))}
                </div>
              )}
            </ModalBody>

            <ModalFooter className="justify-end">
              <Button variant="bordered" onPress={onClose}>
                Close
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export function AllEventDocumentsModal({
  isOpen,
  onOpenChange,
  files,
  eventTitle,
  isCompactView,
  onDownloadFile,
  renderDocumentActions,
  emptyState = defaultDocumentEmptyState,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  files: EventDetailFileItem[];
  eventTitle: string;
  isCompactView: boolean;
  onDownloadFile: (file: EventDetailFileItem) => void;
  renderDocumentActions?: FileActionRenderer;
  emptyState?: EmptyStateCopy;
}) {
  const [sortMode, setSortMode] = useState<EventFileSortMode>("name_asc");
  const [searchValue, setSearchValue] = useState("");

  useEffect(() => {
    if (!isOpen) {
      setSortMode("name_asc");
      setSearchValue("");
    }
  }, [isOpen]);

  const filteredFiles = useMemo(() => {
    const query = searchValue.trim().toLowerCase();
    const source =
      !query
        ? files
        : files.filter((file) => file.name.toLowerCase().includes(query));

    return sortEventDetailFiles(source, sortMode);
  }, [files, searchValue, sortMode]);

  const hasSearch = Boolean(searchValue.trim());

  return (
    <Modal
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      size={isCompactView ? "full" : "4xl"}
      scrollBehavior="inside"
    >
      <ModalContent>
        {(onClose) => (
          <>
            <ModalHeader className="flex flex-col gap-1">
              <span className="text-xl font-semibold text-campus-text-primary">
                All Documents
              </span>
              <span className="text-sm font-normal text-campus-text-secondary">
                {eventTitle
                  ? `${eventTitle} | ${files.length} document${files.length === 1 ? "" : "s"}`
                  : `${files.length} document${files.length === 1 ? "" : "s"}`}
              </span>
            </ModalHeader>

            <ModalBody className="space-y-5 pb-4">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_240px]">
                <Input
                  aria-label="Search documents"
                  value={searchValue}
                  onValueChange={setSearchValue}
                  placeholder="Search documents by filename"
                  startContent={<Search size={16} className="text-campus-text-secondary" />}
                />
                <Select
                  aria-label="Sort documents"
                  disallowEmptySelection
                  items={fileSortOptions}
                  selectedKeys={new Set([sortMode])}
                  onSelectionChange={(keys) => {
                    if (keys === "all") return;
                    const selected = Array.from(keys)[0];
                    if (typeof selected === "string") {
                      setSortMode(selected as EventFileSortMode);
                    }
                  }}
                >
                  {(item) => <SelectItem key={item.key}>{item.label}</SelectItem>}
                </Select>
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-campus-text-secondary">
                  {hasSearch
                    ? `${filteredFiles.length} of ${files.length} documents match your search.`
                    : `${files.length} document${files.length === 1 ? "" : "s"} available for download.`}
                </p>
              </div>

              {filteredFiles.length === 0 ? (
                <EventFilesEmptyState
                  title={hasSearch ? "No matching documents" : emptyState.title}
                  description={
                    hasSearch
                      ? "Try a different filename search to find the document you need."
                      : emptyState.description
                  }
                  icon={FileText}
                />
              ) : (
                <div className="space-y-3">
                  {filteredFiles.map((file) => (
                    <DocumentListItem
                      key={file.id}
                      file={file}
                      onDownloadFile={onDownloadFile}
                      actions={renderDocumentActions?.(file)}
                    />
                  ))}
                </div>
              )}
            </ModalBody>

            <ModalFooter className="justify-end">
              <Button variant="bordered" onPress={onClose}>
                Close
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function SectionHeader({
  title,
  count,
  onOpenAll,
}: {
  title: string;
  count: number;
  onOpenAll?: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-campus-text-primary">{title}</h3>
        <Chip size="sm" className="bg-slate-100 text-slate-700">
          {count}
        </Chip>
      </div>

      {count > 0 && onOpenAll ? (
        <Button
          variant="light"
          className="h-auto min-w-0 self-start px-0 text-sm font-semibold text-primary-600 data-[hover=true]:bg-transparent sm:self-auto"
          onPress={onOpenAll}
        >
          View all
        </Button>
      ) : null}
    </div>
  );
}

function ImagePreviewSection({
  files,
  totalCount,
  emptyState,
  onOpenAll,
  onDownloadFile,
  renderActions,
}: {
  files: EventDetailFileItem[];
  totalCount: number;
  emptyState: EmptyStateCopy;
  onOpenAll?: () => void;
  onDownloadFile: (file: EventDetailFileItem) => void;
  renderActions?: FileActionRenderer;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader title="Images" count={totalCount} onOpenAll={onOpenAll} />

      {totalCount === 0 ? (
        <EventFilesEmptyState
          title={emptyState.title}
          description={emptyState.description}
          icon={ImageIcon}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {files.map((file) => (
            <ImagePreviewCard
              key={file.id}
              file={file}
              onDownloadFile={onDownloadFile}
              actions={renderActions?.(file)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DocumentPreviewSection({
  files,
  totalCount,
  emptyState,
  onOpenAll,
  onDownloadFile,
  renderActions,
}: {
  files: EventDetailFileItem[];
  totalCount: number;
  emptyState: EmptyStateCopy;
  onOpenAll?: () => void;
  onDownloadFile: (file: EventDetailFileItem) => void;
  renderActions?: FileActionRenderer;
}) {
  return (
    <div className="space-y-4">
      <SectionHeader
        title="Documents"
        count={totalCount}
        onOpenAll={onOpenAll}
      />

      {totalCount === 0 ? (
        <EventFilesEmptyState
          title={emptyState.title}
          description={emptyState.description}
          icon={FileText}
        />
      ) : (
        <div className="space-y-3">
          {files.map((file) => (
            <DocumentListItem
              key={file.id}
              file={file}
              onDownloadFile={onDownloadFile}
              actions={renderActions?.(file)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ImagePreviewCard({
  file,
  onDownloadFile,
  actions,
}: {
  file: EventDetailFileItem;
  onDownloadFile: (file: EventDetailFileItem) => void;
  actions?: ReactNode;
}) {
  const canPreview = isTeacherImageFile({
    kind: file.kind,
    contentType: file.contentType ?? "",
    name: file.name,
  });

  return (
    <Card
      shadow="none"
      className="overflow-hidden border border-border/70 bg-white/95 shadow-[0_14px_32px_rgba(15,23,42,0.06)]"
    >
      <div className="h-44 bg-slate-100">
        {canPreview && file.downloadURL ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.downloadURL}
            alt={file.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
              <ImageIcon size={20} />
            </div>
            <p className="text-sm text-campus-text-secondary">Preview unavailable</p>
          </div>
        )}
      </div>

      <CardBody className="space-y-4 p-4 sm:p-5">
        <div className="space-y-2">
          <p className="line-clamp-2 text-sm font-semibold text-campus-text-primary">
            {file.name}
          </p>
          <div className="flex flex-wrap gap-2">
            <Chip size="sm" className="bg-amber-100 text-amber-700">
              Image
            </Chip>
            <Chip size="sm" className="bg-violet-100 text-violet-700">
              {formatTeacherBytes(file.size)}
            </Chip>
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Button
            color="primary"
            variant="flat"
            startContent={<Download size={16} />}
            onPress={() => onDownloadFile(file)}
            isDisabled={!file.downloadURL}
            className="w-full sm:w-auto"
          >
            Download
          </Button>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </CardBody>
    </Card>
  );
}

function DocumentListItem({
  file,
  onDownloadFile,
  actions,
}: {
  file: EventDetailFileItem;
  onDownloadFile: (file: EventDetailFileItem) => void;
  actions?: ReactNode;
}) {
  return (
    <Card shadow="none" className="border border-border/70 bg-slate-50/70">
      <CardHeader className="flex flex-col gap-4 p-4 sm:p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-campus-text-primary">
            {file.name}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            <Chip size="sm" className="bg-blue-100 text-blue-700">
              Document
            </Chip>
            <Chip size="sm" className="bg-violet-100 text-violet-700">
              {formatTeacherBytes(file.size)}
            </Chip>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 self-start sm:w-auto sm:flex-row sm:items-center sm:self-auto">
          <Button
            size="sm"
            variant="flat"
            color="primary"
            startContent={<Download size={16} />}
            onPress={() => onDownloadFile(file)}
            isDisabled={!file.downloadURL}
            className="w-full sm:w-auto"
          >
            Download
          </Button>
          {actions ? <div className="shrink-0">{actions}</div> : null}
        </div>
      </CardHeader>
    </Card>
  );
}

function EventFilesEmptyState({
  title,
  description,
  icon: Icon,
}: {
  title: string;
  description: string;
  icon: typeof ImageIcon;
}) {
  return (
    <Card shadow="none" className="border border-dashed border-border/70 bg-slate-50/60">
      <CardBody className="items-center gap-3 p-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-campus-text-secondary shadow-sm">
          <Icon size={20} />
        </div>
        <div className="space-y-1">
          <p className="font-medium text-campus-text-primary">{title}</p>
          <p className="max-w-md text-sm text-campus-text-secondary">
            {description}
          </p>
        </div>
      </CardBody>
    </Card>
  );
}
