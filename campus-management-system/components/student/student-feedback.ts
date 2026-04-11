"use client";

import { useEffect } from "react";
import { campusToast } from "@/lib/toast";

export function useStudentPageErrorToast(
  error: string | null,
  scope: string,
) {
  useEffect(() => {
    if (!error) return;

    campusToast.error({
      title: `Unable to load ${scope}`,
      description: error,
      dedupeKey: `student-load:${scope}:${error}`,
    });
  }, [error, scope]);
}
