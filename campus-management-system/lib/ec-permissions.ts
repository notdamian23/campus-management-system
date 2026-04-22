import {
  CAMPUS_COURSE_CODE_OPTIONS,
  normalizeCourse,
  normalizeCourseCode,
  resolveCourseFromCode,
} from "@/lib/courseOptions";
import {
  isBodRole,
  isEcRole,
  isEcWorkspaceRole as isEcWorkspaceRoleValue,
  normalizeCampusRole,
} from "@/lib/campus-role";

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

const ALL_SCOPE_EC_POSITIONS = new Set<string>([
  "President",
  "Vice President",
  "Secretary",
  "Treasurer",
  "Auditor",
  "P.I.O.",
  "H.A.S.",
]);

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
  course?: unknown;
  courseScope?: unknown;
  courseScopeLabel?: unknown;
  isBod?: unknown;
  isStudent?: unknown;
} | null | undefined;

type StudentLike = {
  role?: unknown;
  isStudent?: unknown;
  course?: unknown;
} | null | undefined;

type EventLike = {
  ownerType?: unknown;
  courseScope?: unknown;
  createdBy?: unknown;
  createdByUid?: unknown;
  createdByCourseScope?: unknown;
} | null | undefined;

type DocumentLike = {
  ownerType?: unknown;
  course?: unknown;
  courseScope?: unknown;
  createdByCourseScope?: unknown;
  createdBy?: unknown;
  createdByUid?: unknown;
  uploadedByUid?: unknown;
  ownerUid?: unknown;
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

function normalizeCourseList(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }

  return value
    .map((entry) => normalizeMaybeCourse(entry))
    .filter((entry): entry is string => Boolean(entry));
}

export function isECMemberRole(role: unknown) {
  return isEcRole(role);
}

export function isECWorkspaceRole(role: unknown) {
  return isEcWorkspaceRoleValue(role);
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

  const fromLegacyScope =
    normalizeAssignedCourse(profile.courseScope) ||
    normalizeAssignedCourse(profile.courseScopeLabel);
  return fromLegacyScope || null;
}

function isAllScopeECPosition(position: unknown) {
  return ALL_SCOPE_EC_POSITIONS.has(normalizeECPosition(position));
}

function isBODPosition(position: unknown) {
  const normalizedPosition = normalizeECPosition(position);
  return (
    normalizedPosition === "B.O.D." ||
    normalizedPosition.startsWith("B.O.D. (")
  );
}

export function getAssignedCourseCode(profile: ECProfileLike) {
  if (!profile || !isEcWorkspaceRoleValue(profile.role)) return null;

  const ecScope = normalizeECScope(profile.ecScope);
  if (ecScope === "all") {
    return null;
  }

  if (
    !isBodRole(profile.role) &&
    profile.isBod !== true &&
    ecScope !== "course" &&
    isAllScopeECPosition(profile.ecPosition)
  ) {
    return null;
  }

  return resolveRawAssignedCourseCode(profile);
}

export function getCourseScope(profile: ECProfileLike) {
  if (!profile) return null;

  const normalizedRole = normalizeCampusRole(profile.role);
  const ecScope = normalizeECScope(profile.ecScope);
  const assignedCourse = getAssignedCourseCode(profile);
  const courseScopeLabel = normalizeMaybeCourse(profile.courseScopeLabel);
  const course = normalizeMaybeCourse(profile.course);
  const assignedCourseScope = assignedCourse ?
    (resolveCourseFromCode(assignedCourse) || null) :
    null;
  const positionScope = inferCourseScopeFromPosition(profile.ecPosition);
  const courseScope = normalizeMaybeCourse(profile.courseScope);

  if (isBOD(profile)) {
    return (
      courseScopeLabel ||
      course ||
      assignedCourseScope ||
      positionScope ||
      courseScope
    );
  }

  if (
    (normalizedRole === "ecmember" || isEcRole(profile.role)) &&
    ecScope === "course"
  ) {
    return (
      courseScopeLabel ||
      course ||
      assignedCourseScope ||
      positionScope ||
      courseScope
    );
  }

  if (ecScope === "all") {
    return null;
  }
  if (isAllScopeECPosition(profile.ecPosition)) {
    return null;
  }

  return (
    courseScopeLabel ||
    course ||
    assignedCourseScope ||
    positionScope ||
    courseScope
  );
}

export function isBOD(profile: ECProfileLike) {
  if (isBodRole(profile?.role)) return true;
  if (!isEcWorkspaceRoleValue(profile?.role)) return false;

  const ecScope = normalizeECScope(profile?.ecScope);
  if (ecScope === "course") return true;
  if (ecScope === "all") return false;

  if (profile?.isBod === true) return true;
  if (isBODPosition(profile?.ecPosition)) return true;
  if (isAllScopeECPosition(profile?.ecPosition)) return false;

  return Boolean(
    resolveRawAssignedCourseCode(profile) ||
      inferCourseScopeFromPosition(profile?.ecPosition),
  );
}

export function isRegularEC(profile: ECProfileLike) {
  if (!isECMemberRole(profile?.role)) return false;
  return normalizeECScope(profile?.ecScope) === "all" || !isBOD(profile);
}

export function canManageStudent(profile: ECProfileLike, student: StudentLike) {
  if (normalizeLower(profile?.role) === "admin") return true;
  if (isRegularEC(profile)) return true;
  if (!isBOD(profile)) return false;

  const studentRole = normalizeCampusRole(student?.role);
  if (studentRole && studentRole !== "student") {
    return false;
  }

  const courseScope = getCourseScope(profile);
  const studentCourse = normalizeMaybeCourse(student?.course);
  return Boolean(courseScope && studentCourse && courseScope === studentCourse);
}

export function canManagePayment(
  profile: ECProfileLike,
  payment?: {
    ownerType?: unknown;
    course?: unknown;
    courseScope?: unknown;
    targetCourses?: unknown;
    createdByUid?: unknown;
    createdByCourseScope?: unknown;
  } | null,
) {
  if (normalizeLower(profile?.role) === "admin") return true;
  if (isRegularEC(profile)) return true;
  if (!isBOD(profile)) return false;

  const courseScope = getCourseScope(profile);
  const ownerType = normalizeLower(payment?.ownerType);
  const paymentCourse = normalizeMaybeCourse(payment?.course);
  const paymentScope =
    normalizeMaybeCourse(payment?.courseScope) || paymentCourse;
  const createdByCourseScope = normalizeMaybeCourse(
    payment?.createdByCourseScope,
  );
  const actorUid = trimValue(profile?.uid);
  const createdByUid = trimValue(payment?.createdByUid);

  return Boolean(
    courseScope &&
      ownerType === "bod" &&
      actorUid &&
      createdByUid &&
      actorUid === createdByUid &&
      paymentCourse === courseScope &&
      paymentScope === courseScope &&
      createdByCourseScope === courseScope,
  );
}

export function canEditPayment(
  profile: ECProfileLike,
  payment?: {
    ownerType?: unknown;
    course?: unknown;
    courseScope?: unknown;
    createdByUid?: unknown;
    createdByCourseScope?: unknown;
  } | null,
) {
  if (normalizeLower(profile?.role) === "admin") return true;
  if (isRegularEC(profile)) return true;
  if (!isBOD(profile)) return false;

  const courseScope = getCourseScope(profile);
  const ownerType = normalizeLower(payment?.ownerType);
  const paymentCourse = normalizeMaybeCourse(payment?.course);
  const paymentScope =
    normalizeMaybeCourse(payment?.courseScope) || paymentCourse;
  const createdByCourseScope = normalizeMaybeCourse(
    payment?.createdByCourseScope,
  );
  const actorUid = trimValue(profile?.uid);
  const createdByUid = trimValue(payment?.createdByUid);

  return Boolean(
    courseScope &&
      ownerType === "bod" &&
      actorUid &&
      createdByUid &&
      actorUid === createdByUid &&
      paymentCourse === courseScope &&
      paymentScope === courseScope &&
      createdByCourseScope === courseScope,
  );
}

export function canViewPayment(
  profile: ECProfileLike,
  payment?: {
    ownerType?: unknown;
    course?: unknown;
    courseScope?: unknown;
    targetCourses?: unknown;
    createdByUid?: unknown;
    createdByCourseScope?: unknown;
  } | null,
) {
  if (normalizeLower(profile?.role) === "admin") return true;
  if (isRegularEC(profile)) return true;
  if (!isBOD(profile)) return false;

  const courseScope = getCourseScope(profile);
  const ownerType = normalizeLower(payment?.ownerType);
  const paymentScope =
    normalizeMaybeCourse(payment?.courseScope) ||
    normalizeMaybeCourse(payment?.createdByCourseScope) ||
    normalizeMaybeCourse(payment?.course);
  const targetCourses = normalizeCourseList(payment?.targetCourses);
  const createdByUid = trimValue(payment?.createdByUid);
  const actorUid = trimValue(profile?.uid);
  const isOwnBodPayment =
    ownerType === "bod" &&
    Boolean(actorUid) &&
    Boolean(createdByUid) &&
    actorUid === createdByUid &&
    Boolean(paymentScope && paymentScope === courseScope);

  if (ownerType === "bod") {
    return isOwnBodPayment;
  }

  return Boolean(
    courseScope &&
      (paymentScope === courseScope || targetCourses.includes(courseScope)),
  );
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

export function canViewDocument(profile: ECProfileLike, document: DocumentLike) {
  if (normalizeLower(profile?.role) === "admin") return true;
  if (isRegularEC(profile)) return true;
  if (!isBOD(profile)) return false;

  const courseScope = getCourseScope(profile);
  const documentScope =
    normalizeMaybeCourse(document?.courseScope) ||
    normalizeMaybeCourse(document?.createdByCourseScope) ||
    normalizeMaybeCourse(document?.course);
  const ownerType = normalizeLower(document?.ownerType);
  const actorUid = trimValue(profile?.uid);
  const createdByUid =
    trimValue(document?.createdBy) ||
    trimValue(document?.createdByUid) ||
    trimValue(document?.uploadedByUid) ||
    trimValue(document?.ownerUid);

  return Boolean(
    courseScope &&
      actorUid &&
      createdByUid &&
      ownerType === "bod" &&
      documentScope === courseScope &&
      createdByUid === actorUid,
  );
}

export function canManageDocument(
  profile: ECProfileLike,
  document: DocumentLike,
) {
  return canViewDocument(profile, document);
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
