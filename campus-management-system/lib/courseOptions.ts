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
export const CAMPUS_COURSE_CODE_OPTIONS = [
  {
    code: "CPE",
    course: "Computer Engineering",
    label: "CPE - Computer Engineering",
  },
  {
    code: "IE",
    course: "Industrial Engineering",
    label: "IE - Industrial Engineering",
  },
  {
    code: "EE",
    course: "Electrical Engineering",
    label: "EE - Electrical Engineering",
  },
  {
    code: "ME",
    course: "Mechanical Engineering",
    label: "ME - Mechanical Engineering",
  },
  {
    code: "ECE",
    course: "Electronics Engineering",
    label: "ECE - Electronics Engineering",
  },
] as const;

export type CampusCourseCode = (typeof CAMPUS_COURSE_CODE_OPTIONS)[number]["code"];

const COURSE_ALIASES: Record<string, CampusCourse> = {
  bscpe: "Computer Engineering",
  bsie: "Industrial Engineering",
  bsee: "Electrical Engineering",
  bsme: "Mechanical Engineering",
  bsece: "Electronics Engineering",
  cpe: "Computer Engineering",
  ie: "Industrial Engineering",
  ee: "Electrical Engineering",
  me: "Mechanical Engineering",
  ece: "Electronics Engineering",
};

const COURSE_CODE_LOOKUP = CAMPUS_COURSE_CODE_OPTIONS.reduce<
  Record<CampusCourseCode, CampusCourse>
>((lookup, option) => {
  lookup[option.code] = option.course;
  return lookup;
}, {} as Record<CampusCourseCode, CampusCourse>);

const COURSE_LOOKUP_BY_CODE = CAMPUS_COURSE_CODE_OPTIONS.reduce<
  Record<CampusCourse, CampusCourseCode>
>((lookup, option) => {
  lookup[option.course] = option.code;
  return lookup;
}, {} as Record<CampusCourse, CampusCourseCode>);

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

export function normalizeCourseCode(raw: string): CampusCourseCode | "" {
  const trimmed = String(raw ?? "").trim().toUpperCase();
  if (!trimmed) {
    return "";
  }

  if (trimmed in COURSE_CODE_LOOKUP) {
    return trimmed as CampusCourseCode;
  }

  const normalizedCourse = normalizeCourse(raw);
  if (!normalizedCourse) {
    return "";
  }

  return COURSE_LOOKUP_BY_CODE[normalizedCourse as CampusCourse] ?? "";
}

export function resolveCourseFromCode(raw: string): CampusCourse | "" {
  const normalizedCode = normalizeCourseCode(raw);
  return normalizedCode ? COURSE_CODE_LOOKUP[normalizedCode] : "";
}

export function resolveCourseLabelFromCode(raw: string): string {
  const normalizedCode = normalizeCourseCode(raw);
  const matched = CAMPUS_COURSE_CODE_OPTIONS.find(
    (option) => option.code === normalizedCode,
  );
  return matched?.label ?? "";
}
