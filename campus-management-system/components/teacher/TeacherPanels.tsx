"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
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
import type { LucideIcon } from "lucide-react";
import {
  CheckCircle2,
  Download,
  FileImage,
  FileText,
  FolderKanban,
  GraduationCap,
  ImageIcon,
  School,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { CampusDetailTile } from "@/components/ui";
import type {
  TeacherAttendanceStatus,
  TeacherEvent,
  TeacherFile,
  TeacherStudent,
} from "./TeacherPortalProvider";
import { TeacherActivityChipGroup, TeacherEmptyState } from "./TeacherShared";
import { downloadTeacherFile } from "./teacher-feedback";
import {
  capitalizeTeacherLabel,
  formatTeacherBytes,
  formatTeacherDateTime,
  formatTeacherEventDate,
  getTeacherAttendanceTone,
  getTeacherFileTone,
  getTeacherLifecycleTone,
  getTeacherToneClasses,
  isTeacherImageFile,
  teacherFileKindLabel,
} from "./teacher-helpers";

type StudentAttendanceItem = {
  event: TeacherEvent;
  status: TeacherAttendanceStatus;
  updatedAtMs: number;
};

type TeacherStudentDetailProps = {
  student: TeacherStudent | null;
  trackedEvents: TeacherEvent[];
  attendanceItems: StudentAttendanceItem[];
  className?: string;
};

export function TeacherStudentDetailPanel({
  student,
  trackedEvents,
  attendanceItems,
  className,
}: TeacherStudentDetailProps) {
  return (
    <Card
      shadow="none"
      className={clsx(
        "border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <CardBody className="p-0">
        <TeacherStudentDetailContent
          student={student}
          trackedEvents={trackedEvents}
          attendanceItems={attendanceItems}
        />
      </CardBody>
    </Card>
  );
}

export function TeacherStudentDrawer({
  student,
  trackedEvents,
  attendanceItems,
  isOpen,
  onOpenChange,
}: TeacherStudentDetailProps & {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer
      isOpen={isOpen && Boolean(student)}
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
                  {student?.studentName || "Student details"}
                </p>
                <p className="text-sm text-campus-text-secondary">
                  Review attendance and tracked event activity.
                </p>
              </div>
            </DrawerHeader>
            <DrawerBody className="p-0">
              <ScrollShadow className="max-h-[calc(92dvh-80px)]">
                <TeacherStudentDetailContent
                  student={student}
                  trackedEvents={trackedEvents}
                  attendanceItems={attendanceItems}
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

function TeacherStudentDetailContent({
  student,
  trackedEvents,
  attendanceItems,
}: TeacherStudentDetailProps) {
  if (!student) {
    return (
      <div className="p-5">
        <TeacherEmptyState
          title="Select a student to review"
          description="Choose any student row to open their attendance summary, recent activity, and teacher-visible events."
          icon={UserRound}
          compact
        />
      </div>
    );
  }

  return (
    <div className="space-y-5 p-5">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
            <UserRound size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-semibold text-campus-text-primary">
              {student.studentName}
            </p>
            <p className="text-sm text-campus-text-secondary">
              {student.schoolId}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <MiniInfoCard
            icon={GraduationCap}
            label="Course"
            value={student.course}
          />
          <MiniInfoCard icon={School} label="Year" value={student.year} />
        </div>

        <TeacherActivityChipGroup
          items={[
            { label: "Tracked", value: student.trackedEventIds.length, tone: "blue" },
            { label: "Present", value: student.presentCount, tone: "green" },
            { label: "Missed", value: student.absentCount, tone: "red" },
            { label: "Records", value: student.recordedCount, tone: "slate" },
          ]}
        />
      </div>

      <section className="space-y-3">
        <SectionHeading
          title="Recent attendance"
          description="Latest teacher-visible attendance outcomes."
        />
        {attendanceItems.length === 0 ? (
          <TeacherEmptyState
            title="No attendance history yet"
            description="This student has no teacher-visible attendance records right now."
            icon={CheckCircle2}
            tone="green"
            compact
          />
        ) : (
          <div className="space-y-3">
            {attendanceItems.map((item) => {
              const toneClasses = getTeacherToneClasses(
                getTeacherAttendanceTone(item.status),
              );
              const StatusIcon =
                item.status === "Absent" ? TriangleAlert : CheckCircle2;

              return (
                <Card
                  key={`${item.event.id}-${item.status}-${item.updatedAtMs}`}
                  shadow="none"
                  className="border border-border/70 bg-slate-50/70"
                >
                  <CardBody className="gap-3 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-campus-text-primary">
                          {item.event.title}
                        </p>
                        <p className="text-sm text-campus-text-secondary">
                          {formatTeacherEventDate(item.event.eventDate, item.event.date)}
                        </p>
                        <p className="text-xs text-campus-text-secondary">
                          {item.event.location}
                        </p>
                      </div>
                      <Chip size="sm" className={toneClasses.chip}>
                        <span className="inline-flex items-center gap-1.5">
                          <StatusIcon size={14} />
                          {item.status}
                        </span>
                      </Chip>
                    </div>
                    <p className="text-xs text-campus-text-secondary">
                      Updated {formatTeacherDateTime(item.updatedAtMs)}
                    </p>
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionHeading
          title="Visible events"
          description="Events currently connected to this student's teacher-visible activity."
        />
        {trackedEvents.length === 0 ? (
          <TeacherEmptyState
            title="No visible events yet"
            description="Teacher-visible event activity for this student will appear here."
            icon={FolderKanban}
            compact
          />
        ) : (
          <div className="space-y-3">
            {trackedEvents.map((event) => {
              const lifecycleClasses = getTeacherToneClasses(
                getTeacherLifecycleTone(event.lifecycle),
              );

              return (
                <Card
                  key={event.id}
                  shadow="none"
                  className="border border-border/70 bg-slate-50/70"
                >
                  <CardBody className="gap-3 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="font-semibold text-campus-text-primary">
                          {event.title}
                        </p>
                        <p className="text-sm text-campus-text-secondary">
                          {formatTeacherEventDate(event.eventDate, event.date)}
                        </p>
                        <p className="text-xs text-campus-text-secondary">
                          {event.location}
                        </p>
                      </div>
                      <Chip size="sm" className={lifecycleClasses.chip}>
                        {capitalizeTeacherLabel(event.lifecycle)}
                      </Chip>
                    </div>

                    <TeacherActivityChipGroup
                      items={[
                        { label: "Present", value: event.presentCount, tone: "green" },
                        { label: "Missed", value: event.absentCount, tone: "red" },
                        {
                          label: "Files",
                          value: event.documentCount + event.imageCount,
                          tone: "purple",
                        },
                      ]}
                    />
                  </CardBody>
                </Card>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

type TeacherFileDetailProps = {
  file: TeacherFile | null;
  event: TeacherEvent | null;
  className?: string;
};

export function TeacherFileDetailsPanel({
  file,
  event,
  className,
}: TeacherFileDetailProps) {
  return (
    <Card
      shadow="none"
      className={clsx(
        "border border-border/70 bg-white/95 shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <CardBody className="p-0">
        <TeacherFileDetailContent file={file} event={event} />
      </CardBody>
    </Card>
  );
}

export function TeacherFileDetailsDrawer({
  file,
  event,
  isOpen,
  onOpenChange,
}: TeacherFileDetailProps & {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Drawer
      isOpen={isOpen && Boolean(file)}
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
                  {file?.name || "File details"}
                </p>
                <p className="text-sm text-campus-text-secondary">
                  Review metadata and download the selected file.
                </p>
              </div>
            </DrawerHeader>
            <DrawerBody className="p-0">
              <ScrollShadow className="max-h-[calc(92dvh-80px)]">
                <TeacherFileDetailContent file={file} event={event} />
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

function TeacherFileDetailContent({
  file,
  event,
}: TeacherFileDetailProps) {
  if (!file) {
    return (
      <div className="p-5">
        <TeacherEmptyState
          title="Select a file to review"
          description="Choose any document or image to inspect its metadata and download it."
          icon={FileText}
          compact
        />
      </div>
    );
  }

  const previewableImage = isTeacherImageFile(file);
  const typeTone = getTeacherToneClasses(getTeacherFileTone(file.kind));

  return (
    <div className="space-y-5 p-5">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-700">
            {previewableImage ? <FileImage size={18} /> : <FileText size={18} />}
          </div>
          <div className="min-w-0">
            <p className="break-words text-lg font-semibold text-campus-text-primary">
              {file.name}
            </p>
            <p className="text-sm text-campus-text-secondary">
              {event?.title || "Unknown event"}
            </p>
          </div>
        </div>

        <TeacherActivityChipGroup
          items={[
            {
              label: "Type",
              value: teacherFileKindLabel(file.kind),
              tone: file.kind === "images" ? "amber" : "blue",
            },
            { label: "Size", value: formatTeacherBytes(file.size), tone: "purple" },
          ]}
        />
      </div>

      <div className="overflow-hidden rounded-[24px] border border-border/70 bg-slate-50/70">
        {previewableImage && file.downloadURL ? (
          // Using a regular img keeps Firebase-hosted previews working without
          // requiring additional Next.js remote image configuration.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={file.downloadURL}
            alt={file.name}
            className="h-56 w-full object-cover"
          />
        ) : (
          <div className="flex h-56 flex-col items-center justify-center gap-3 px-4 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-100 text-slate-700">
              {file.kind === "images" ? (
                <ImageIcon size={24} />
              ) : (
                <FileText size={24} />
              )}
            </div>
            <div className="space-y-1">
              <p className="font-medium text-campus-text-primary">
                Preview unavailable
              </p>
              <p className="max-w-xs text-sm text-campus-text-secondary">
                This file type does not support inline preview in the teacher workspace.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        <DetailRow label="Event" value={event?.title || "Unknown event"} />
        <DetailRow
          label="File type"
          value={
            <Chip size="sm" className={typeTone.chip}>
              {teacherFileKindLabel(file.kind)}
            </Chip>
          }
        />
        <DetailRow
          label="Uploaded"
          value={formatTeacherDateTime(file.createdAtMs)}
        />
        <DetailRow label="Size" value={formatTeacherBytes(file.size)} />
        <DetailRow
          label="Content type"
          value={file.contentType || "Unknown"}
        />
      </div>

      <Button
        color="primary"
        className="w-full"
        startContent={<Download size={16} />}
        onPress={() =>
          downloadTeacherFile({
            url: file.downloadURL,
            name: file.name,
            sourceLabel: teacherFileKindLabel(file.kind).toLowerCase(),
          })
        }
        isDisabled={!file.downloadURL}
      >
        Download file
      </Button>
    </div>
  );
}

function MiniInfoCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return <CampusDetailTile icon={Icon} label={label} value={value} />;
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold text-campus-text-primary">{title}</p>
      <p className="text-xs leading-5 text-campus-text-secondary">
        {description}
      </p>
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
