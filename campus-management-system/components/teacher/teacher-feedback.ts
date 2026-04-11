"use client";

import { useEffect } from "react";
import { campusToast } from "@/lib/toast";

export function useTeacherPageErrorToast(
  error: string | null,
  scope: string,
) {
  useEffect(() => {
    if (!error) return;

    campusToast.error({
      title: `Unable to load ${scope}`,
      description: error,
      dedupeKey: `teacher-load:${scope}:${error}`,
    });
  }, [error, scope]);
}

type TeacherDownloadOptions = {
  url: string;
  name: string;
  sourceLabel?: string;
};

export function downloadTeacherFile({
  url,
  name,
  sourceLabel = "file",
}: TeacherDownloadOptions) {
  if (!url) {
    campusToast.error({
      title: "File unavailable",
      description: `This ${sourceLabel} does not have a download link yet.`,
      dedupeKey: `teacher-download-missing:${sourceLabel}:${name}`,
    });
    return false;
  }

  try {
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

    campusToast.success({
      title: "Download started",
      description: `${name || "Selected file"} is being prepared.`,
      dedupeKey: `teacher-download-start:${name}`,
    });

    return true;
  } catch (error) {
    campusToast.error({
      title: "Download failed",
      description:
        error instanceof Error
          ? error.message
          : `The ${sourceLabel} could not be downloaded.`,
      dedupeKey: `teacher-download-error:${name}`,
    });

    return false;
  }
}
