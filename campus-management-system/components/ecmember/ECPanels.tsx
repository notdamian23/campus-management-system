"use client";

import type { ReactNode } from "react";
import { Button } from "@heroui/button";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
} from "@heroui/drawer";
import { ScrollShadow } from "@heroui/scroll-shadow";
import { Download, FileText, Trash2 } from "lucide-react";
import { CampusDetailTile } from "@/components/ui";
import { ECDetailPanelSkeleton } from "./ECSkeletons";
import { ECEmptyState } from "./ECShared";

export type ECDocumentDetailItem = {
  name: string;
  type: string;
  category: string;
  uploadedLabel: string;
  sizeLabel: string;
  downloadUrl?: string;
};

type ECDocumentDetailsProps = {
  document: ECDocumentDetailItem | null;
  isLoading?: boolean;
  onDownload?: () => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  deleting?: boolean;
  className?: string;
};

export function ECDocumentDetailsPanel({
  document,
  isLoading = false,
  onDownload,
  onDelete,
  deleteDisabled = false,
  deleting = false,
  className,
}: ECDocumentDetailsProps) {
  if (isLoading) {
    return <ECDetailPanelSkeleton className={className} />;
  }

  return (
    <Card
      shadow="none"
      className={className || "border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]"}
    >
      <CardBody className="p-0">
        <ECDocumentDetailsContent
          document={document}
          onDownload={onDownload}
          onDelete={onDelete}
          deleteDisabled={deleteDisabled}
          deleting={deleting}
        />
      </CardBody>
    </Card>
  );
}

export function ECDocumentDetailsDrawer({
  document,
  isLoading = false,
  isOpen,
  onOpenChange,
  onDownload,
  onDelete,
  deleteDisabled = false,
  deleting = false,
}: ECDocumentDetailsProps & {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer
      isOpen={isOpen && (isLoading || Boolean(document))}
      onOpenChange={onOpenChange}
      placement="bottom"
      className="xl:hidden"
    >
      <DrawerContent className="max-h-[92dvh]">
        {(onClose) => (
          <>
            <DrawerHeader className="border-b border-border/70">
              <div className="space-y-1">
                <p className="text-lg font-semibold text-campus-text-primary">
                  {document?.name || "Document details"}
                </p>
                <p className="text-sm text-campus-text-secondary">
                  Review metadata, then download or delete the selected EC file.
                </p>
              </div>
            </DrawerHeader>
            <DrawerBody className="p-0">
              <ScrollShadow className="max-h-[calc(92dvh-128px)]">
                <ECDocumentDetailsContent
                  document={document}
                  isLoading={isLoading}
                  onDownload={onDownload}
                  onDelete={onDelete}
                  deleteDisabled={deleteDisabled}
                  deleting={deleting}
                />
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
  );
}

function ECDocumentDetailsContent({
  document,
  isLoading = false,
  onDownload,
  onDelete,
  deleteDisabled = false,
  deleting = false,
}: ECDocumentDetailsProps) {
  if (isLoading) {
    return <ECDetailPanelSkeleton className="border-none shadow-none" />;
  }

  if (!document) {
    return (
      <div className="p-5">
        <ECEmptyState
          title="No document selected"
          description="Choose a file from the shared library to inspect its metadata and actions."
          icon={FileText}
          compact
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-5 sm:p-6">
      <div className="rounded-[24px] border border-border/70 bg-slate-50/80 p-5">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
            <FileText size={18} />
          </div>
          <div className="min-w-0">
            <p className="break-words text-lg font-semibold text-campus-text-primary">
              {document.name}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Chip size="sm" className="bg-blue-100 text-blue-700">
                {document.type}
              </Chip>
              <Chip size="sm" className="bg-slate-100 text-slate-700">
                {document.category}
              </Chip>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DetailRow label="Uploaded" value={document.uploadedLabel} />
        <DetailRow label="Size" value={document.sizeLabel} />
      </div>

      <div className="space-y-2">
        <ActionButton
          tone="primary"
          icon={<Download size={16} />}
          onPress={onDownload}
          isDisabled={!document.downloadUrl}
        >
          Download document
        </ActionButton>
        <ActionButton
          tone="danger"
          icon={<Trash2 size={16} />}
          onPress={onDelete}
          isDisabled={deleteDisabled}
          isLoading={deleting}
        >
          Delete document
        </ActionButton>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return <CampusDetailTile label={label} value={value} />;
}

function ActionButton({
  children,
  tone,
  icon,
  onPress,
  isDisabled,
  isLoading,
}: {
  children: ReactNode;
  tone: "primary" | "danger";
  icon: ReactNode;
  onPress?: () => void;
  isDisabled?: boolean;
  isLoading?: boolean;
}) {
  return (
    <Button
      color={tone}
      variant={tone === "danger" ? "flat" : "solid"}
      className="w-full"
      startContent={isLoading ? null : icon}
      onPress={onPress}
      isDisabled={isDisabled}
      isLoading={isLoading}
    >
      {children}
    </Button>
  );
}
