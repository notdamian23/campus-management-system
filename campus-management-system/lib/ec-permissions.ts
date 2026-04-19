import {
  CAMPUS_COURSE_CODE_OPTIONS,
  normalizeCourse,
  normalizeCourseCode,
  resolveCourseFromCode,
} from "@/lib/courseOptions";

export const EC_POSITION_OPTIONS = [
  "President",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
  "P.I.O.",
  "H.A.S.",
  "B.O.D.",
  "Member",
] as const;

export type ECPosition = (typeof EC_POSITION_OPTIONS)[number];
export type ECScope = "all" | "course";
export const BOD_COURSE_OPTIONS = CAMPUS_COURSE_CODE_OPTIONS;

export const BOD_COURSE_SCOPE_BY_POSITION = {
  "B.O.D. (ME)": "Mechanical Engineering",
  "B.O.D. (EE)": "Electrical Engineering",
  "B.O.D. (IE)": "Industrial Engineering",
  "B.O.D. (CPE)": "Computer Engineering",
  "B.O.D. (ECE)": "Electronics Engineering",
} as const;

type ECProfileLike = {
  uid?: unknown;
  role?: unknown;
  ecPosition?: unknown;
  ecScope?: unknown;
  assignedCourse?: unknown;
  courseScope?: unknown;
  isBod?: unknown;
} | null | undefined;

type StudentLike = {
  course?: unknown;
} | null | undefined;

type EventLike = {
  ownerType?: unknown;
  courseScope?: unknown;
  createdBy?: unknown;
  createdByUid?: unknown;
  createdByCourseScope?: unknown;
} | null | undefined;

function trimValue(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown) {
  return trimValue(value).toLowerCase();
}

function normalizeMaybeCourse(value: unknown) {
  const normalized = normalizeCourse(trimValue(value));
  return normalized || null;
}

export function isECMemberRole(role: unknown) {
  const normalized = normalizeLower(role);
  return normalized === "ec" || normalized === "ecmember";
}

export function normalizeECScope(value: unknown): ECScope | "" {
  const normalized = normalizeLower(value);
  if (normalized === "all") return "all";
  if (normalized === "course") return "course";
  return "";
}

export function normalizeAssignedCourse(value: unknown) {
  return normalizeCourseCode(trimValue(value));
}

export function extractAssignedCourseFromPosition(value: unknown) {
  const match = trimValue(value).match(/^B\.O\.D\.\s*\(([A-Za-z]+)\)$/i);
  if (!match) {
    return "";
  }

  return normalizeAssignedCourse(match[1]);
}

export function formatBodPosition(assignedCourse: unknown) {
  const normalizedCode = normalizeAssignedCourse(assignedCourse);
  return normalizedCode ? `B.O.D. (${normalizedCode})` : "B.O.D.";
}

export function normalizeECPosition(value: unknown) {
  const position = trimValue(value);
  if (!position) return "";

  const assignedCourse = extractAssignedCourseFromPosition(position);
  if (assignedCourse) {
    return formatBodPosition(assignedCourse);
  }

  const basePosition = EC_POSITION_OPTIONS.find(
    (option) => normalizeLower(option) === normalizeLower(position),
  );
  return basePosition || position;
}

export function getECPositionSelectionValue(value: unknown) {
  const normalizedPosition = normalizeECPosition(value);
  return extractAssignedCourseFromPosition(normalizedPosition)
    ? "B.O.D."
    : normalizedPosition;
}

export function inferCourseScopeFromPosition(position: unknown) {
  const normalizedPosition = normalizeECPosition(position);
  return (
    BOD_COURSE_SCOPE_BY_POSITION[
      normalizedPosition as keyof typeof BOD_COURSE_SCOPE_BY_POSITION
    ] ?? null
  );
}

function resolveRawAssignedCourseCode(profile: ECProfileLike) {
  if (!profile) return null;

  const explicitAssignedCourse = normalizeAssignedCourse(profile.assignedCourse);
  if (explicitAssignedCourse) return explicitAssignedCourse;

  const fromPosition = extractAssignedCourseFromPosition(profile.ecPosition);
  if (fromPosition) return fromPosition;

  const fromLegacyScope = normalizeAssignedCourse(profile.courseScope);
  return fromLegacyScope || null;
}

export function getAssignedCourseCode(profile: ECProfileLike) {
  if (!profile || !isECMemberRole(profile.role)) return null;
  if (normalizeECScope(profile.ecScope) === "all") return null;
  return resolveRawAssignedCourseCode(profile);
}

export function getCourseScope(profile: ECProfileLike) {
  if (!profile) return null;

  const ecScope = normalizeECScope(profile.ecScope);
  const assignedCourse = getAssignedCourseCode(profile);

  if (ecScope === "course" && assignedCourse) {
    return resolveCourseFromCode(assignedCourse) || null;
  }

  if (ecScope === "all") {
    return null;
  }

  const explicitLegacyScope = normalizeMaybeCourse(profile.courseScope);
  if (explicitLegacyScope) return explicitLegacyScope;

  if (assignedCourse) {
    return resolveCourseFromCode(assignedCourse) || null;
  }

  return inferCourseScopeFromPosition(profile.ecPosition);
}

export function isBOD(profile: ECProfileLike) {
  if (!isECMemberRole(profile?.role)) return false;

  const ecScope = normalizeECScope(profile?.ecScope);
  if (ecScope === "course") return true;
  if (ecScope === "all") return false;

  if (profile?.isBod === true) return true;
  return Boolean(getAssignedCourseCode(profile) || inferCourseScopeFromPosition(profile?.ecPosition));
}

export function isRegularEC(profile: ECProfileLike) {
  if (!isECMemberRole(profile?.role)) return false;
  return normalizeECScope(profile?.ecScope) === "all" || !isBOD(profile);
}

export function canManageStudent(profile: ECProfileLike, student: StudentLike) {
  if (normalizeLower(profile?.role) === "admin") return true;
  if (isRegularEC(profile)) return true;
  if (!isBOD(profile)) return false;

  const courseScope = getCourseScope(profile);
  const studentCourse = normalizeMaybeCourse(student?.course);
  return Boolean(courseScope && studentCourse && courseScope === studentCourse);
}

export function canManagePayment(
  profile: ECProfileLike,
  payment?: {
    course?: unknown;
    courseScope?: unknown;
    createdByCourseScope?: unknown;
  } | null,
) {
  if (normalizeLower(profile?.role) === "admin") return true;
  if (isRegularEC(profile)) return true;
  if (!isBOD(profile)) return false;

  const courseScope = getCourseScope(profile);
  const paymentScope =
    normalizeMaybeCourse(payment?.courseScope) ||
    normalizeMaybeCourse(payment?.createdByCourseScope) ||
    normalizeMaybeCourse(payment?.course);

  return Boolean(courseScope && paymentScope && courseScope === paymentScope);
}

export function canViewEvent(profile: ECProfileLike, event: EventLike) {
  if (normalizeLower(profile?.role) === "admin") return true;
  if (isRegularEC(profile)) return true;
  if (!isBOD(profile)) return false;

  const ownerType = normalizeLower(event?.ownerType);
  if (ownerType === "ec") return true;

  const courseScope = getCourseScope(profile);
  const eventScope =
    normalizeMaybeCourse(event?.courseScope) ||
    normalizeMaybeCourse(event?.createdByCourseScope);

  return ownerType === "bod" && Boolean(courseScope && eventScope === courseScope);
}

export function canEditEvent(profile: ECProfileLike, event: EventLike) {
  if (normalizeLower(profile?.role) === "admin") return true;
  if (isRegularEC(profile)) return true;
  if (!isBOD(profile)) return false;

  if (normalizeLower(event?.ownerType) !== "bod") {
    return false;
  }

  const courseScope = getCourseScope(profile);
  const eventScope =
    normalizeMaybeCourse(event?.courseScope) ||
    normalizeMaybeCourse(event?.createdByCourseScope);

  if (!courseScope || eventScope !== courseScope) {
    return false;
  }

  const actorUid = trimValue(profile?.uid);
  const createdByUid = trimValue(event?.createdBy) || trimValue(event?.createdByUid);
  return !actorUid || !createdByUid || actorUid === createdByUid;
}
