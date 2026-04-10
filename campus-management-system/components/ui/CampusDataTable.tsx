"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import type { Key, Selection, SortDescriptor } from "@react-types/shared";
import {
  Table,
  TableBody,
  TableCell,
  TableColumn,
  TableHeader,
  TableRow,
} from "@heroui/table";
import { CampusEmptyState } from "./CampusEmptyState";
import { CampusTableBodySkeleton } from "./CampusSkeletons";

export type CampusTableColumn<T> = {
  key: Extract<keyof T, string> | string;
  label: ReactNode;
  align?: "start" | "center" | "end";
  allowsSorting?: boolean;
  className?: string;
  cellClassName?: string;
};

type CampusDataTableProps<T extends object> = {
  ariaLabel: string;
  columns: CampusTableColumn<T>[];
  items: T[];
  renderCell: (item: T, columnKey: string) => ReactNode;
  getRowKey?: (item: T) => Key;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyContent?: ReactNode;
  isLoading?: boolean;
  loadingContent?: ReactNode;
  className?: string;
  wrapperClassName?: string;
  tableClassName?: string;
  bottomContent?: ReactNode;
  bottomContentPlacement?: "inside" | "outside";
  topContent?: ReactNode;
  topContentPlacement?: "inside" | "outside";
  selectionMode?: "none" | "single" | "multiple";
  selectedKeys?: Selection;
  onSelectionChange?: (keys: Selection) => void;
  showSelectionCheckboxes?: boolean;
  sortDescriptor?: SortDescriptor;
  onSortChange?: (descriptor: SortDescriptor) => void;
  isHeaderSticky?: boolean;
};

export function CampusDataTable<T extends object>({
  ariaLabel,
  columns,
  items,
  renderCell,
  getRowKey,
  emptyTitle = "No records found",
  emptyDescription,
  emptyContent,
  isLoading = false,
  loadingContent,
  className,
  wrapperClassName,
  tableClassName,
  bottomContent,
  bottomContentPlacement = "outside",
  topContent,
  topContentPlacement = "outside",
  selectionMode = "none",
  selectedKeys,
  onSelectionChange,
  showSelectionCheckboxes,
  sortDescriptor,
  onSortChange,
  isHeaderSticky = false,
}: CampusDataTableProps<T>) {
  const columnMap = new Map(
    columns.map((column) => [String(column.key), column]),
  );

  return (
    <Table
      aria-label={ariaLabel}
      shadow="none"
      radius="lg"
      className={className}
      classNames={{
        wrapper: clsx(
          "rounded-2xl border border-border bg-white p-0 shadow-none",
          wrapperClassName,
        ),
        table: clsx("min-w-[720px]", tableClassName),
        th: "bg-[#f8fafc] px-4 py-3 text-xs font-semibold uppercase tracking-[0.18em] text-campus-text-secondary",
        td: "px-4 py-3 text-sm text-campus-text-primary",
        tr: "transition data-[hover=true]:bg-slate-50 data-[selected=true]:bg-primary-50",
        emptyWrapper: "h-72",
        loadingWrapper: "h-72",
      }}
      topContent={topContent}
      topContentPlacement={topContentPlacement}
      bottomContent={bottomContent}
      bottomContentPlacement={bottomContentPlacement}
      selectionMode={selectionMode}
      selectedKeys={selectedKeys}
      onSelectionChange={onSelectionChange}
      showSelectionCheckboxes={showSelectionCheckboxes}
      sortDescriptor={sortDescriptor}
      onSortChange={onSortChange}
      isHeaderSticky={isHeaderSticky}
    >
      <TableHeader columns={columns}>
        {(column) => (
          <TableColumn
            key={String(column.key)}
            align={column.align}
            allowsSorting={column.allowsSorting}
            className={column.className}
          >
            {column.label}
          </TableColumn>
        )}
      </TableHeader>
      <TableBody
        items={items}
        isLoading={isLoading}
        loadingContent={
          loadingContent ?? (
            <CampusTableBodySkeleton
              rows={5}
              columns={Math.max(columns.length, 3)}
            />
          )
        }
        emptyContent={
          emptyContent ?? (
            <CampusEmptyState
              title={emptyTitle}
              description={emptyDescription}
              compact
              className="mx-auto my-8 max-w-lg border-none bg-transparent"
            />
          )
        }
      >
        {(item) => (
          <TableRow key={getRowKey ? getRowKey(item) : resolveRowKey(item)}>
            {(columnKey) => (
              <TableCell
                className={clsx(
                  columnMap.get(String(columnKey))?.cellClassName,
                )}
              >
                {renderCell(item, String(columnKey))}
              </TableCell>
            )}
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}

function resolveRowKey(item: object) {
  if ("id" in item && typeof item.id !== "undefined") {
    return item.id as Key;
  }

  if ("uid" in item && typeof item.uid !== "undefined") {
    return item.uid as Key;
  }

  if ("paymentId" in item && typeof item.paymentId !== "undefined") {
    return item.paymentId as Key;
  }

  return JSON.stringify(item);
}
