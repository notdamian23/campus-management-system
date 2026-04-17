/**
 * Shared course options used throughout the CAMPUS app
 * This is the single source of truth for all course-related UI and validation
 */
export const CAMPUS_COURSE_OPTIONS = [
  "Computer Engineering",
  "Industrial Engineering",
  "Electrical Engineering",
  "Mechanical Engineering",
  "Electronics Engineering",
] as const;

export type CampusCourse = (typeof CAMPUS_COURSE_OPTIONS)[number];

const COURSE_ALIASES: Record<string, CampusCourse> = {
  bscpe: "Computer Engineering",
  bsie: "Industrial Engineering",
  bsee: "Electrical Engineering",
  bsme: "Mechanical Engineering",
  bsece: "Electronics Engineering",
};

export function isValidCourse(value: string): value is CampusCourse {
  return CAMPUS_COURSE_OPTIONS.includes(value as CampusCourse);
}

export function normalizeCourse(raw: string): string {
  const trimmed = String(raw ?? "").trim();
  if (isValidCourse(trimmed)) {
    return trimmed;
  }

  const aliasKey = trimmed.toLowerCase().replace(/[\s.-]+/g, "");
  return COURSE_ALIASES[aliasKey] ?? "";
}
