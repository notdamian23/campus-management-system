import {
  isEcWorkspaceRole,
  normalizeCampusRole,
} from "@/lib/campus-role";
import {
  normalizeStudentNamePart,
  resolveStudentRawFullName,
} from "@/lib/student-name";

export type StudentAudienceProfileLike = {
  role?: unknown;
  isStudent?: unknown;
  schoolId?: unknown;
  studentId?: unknown;
  course?: unknown;
  year?: unknown;
  yearLevel?: unknown;
  name?: unknown;
  fullName?: unknown;
  studentName?: unknown;
  displayName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  ecPosition?: unknown;
  ecScope?: unknown;
  assignedCourse?: unknown;
  courseScope?: unknown;
  isBod?: unknown;
};

const INVALID_STUDENT_AUDIENCE_VALUES = new Set([
  "-",
  "all courses",
  "all years",
  "unassigned",
  "unknown user",
]);

function trimValue(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown) {
  return trimValue(value).toLowerCase();
}

function isLegacyBodProfile(
  profile?: StudentAudienceProfileLike | null,
) {
  const normalizedRole = normalizeCampusRole(profile?.role);
  if (normalizedRole !== "ecmember") {
    return false;
  }

  if (profile?.isBod === true) {
    return true;
  }

  if (normalizeLower(profile?.ecScope) === "course") {
    return true;
  }

  if (trimValue(profile?.assignedCourse) || trimValue(profile?.courseScope)) {
    return true;
  }

  const position = trimValue(profile?.ecPosition);
  return /^B\.O\.D\./i.test(position);
}

function hasMeaningfulStudentAudienceValue(value: unknown) {
  const normalized = trimValue(value);
  if (!normalized) {
    return false;
  }

  return !INVALID_STUDENT_AUDIENCE_VALUES.has(normalized.toLowerCase());
}

function hasStudentIdentityHints(
  profile?: StudentAudienceProfileLike | null,
) {
  const hasStudentId =
    hasMeaningfulStudentAudienceValue(profile?.schoolId) ||
    hasMeaningfulStudentAudienceValue(profile?.studentId);
  const hasCourse = hasMeaningfulStudentAudienceValue(profile?.course);
  const hasYear =
    hasMeaningfulStudentAudienceValue(profile?.yearLevel) ||
    hasMeaningfulStudentAudienceValue(profile?.year);
  const hasName = hasMeaningfulStudentAudienceValue(
    resolveStudentAudienceName(profile),
  );

  return hasStudentId && (hasName || hasCourse || hasYear);
}

export function resolveStudentAudienceName(
  profile?: StudentAudienceProfileLike | null,
) {
  return resolveStudentRawFullName({
    firstName: normalizeStudentNamePart(profile?.firstName),
    lastName: normalizeStudentNamePart(profile?.lastName),
    name: trimValue(profile?.name),
    fullName: trimValue(profile?.fullName),
    studentName: trimValue(profile?.studentName),
    displayName: trimValue(profile?.displayName),
  }).trim();
}

export function hasStudentIdentityProfile(
  profile?: StudentAudienceProfileLike | null,
) {
  const normalizedRole = normalizeCampusRole(profile?.role);
  return (
    normalizedRole === "student" ||
    profile?.isStudent === true ||
    isLegacyBodProfile(profile) ||
    (isEcWorkspaceRole(profile?.role) && hasStudentIdentityHints(profile))
  );
}

export function isStudentAudienceProfile(
  profile?: StudentAudienceProfileLike | null,
) {
  if (!hasStudentIdentityProfile(profile)) {
    return false;
  }

  const hasStudentId =
    hasMeaningfulStudentAudienceValue(profile?.schoolId) ||
    hasMeaningfulStudentAudienceValue(profile?.studentId);
  const hasCourse = hasMeaningfulStudentAudienceValue(profile?.course);
  const hasYear =
    hasMeaningfulStudentAudienceValue(profile?.yearLevel) ||
    hasMeaningfulStudentAudienceValue(profile?.year);
  const hasName = hasMeaningfulStudentAudienceValue(
    resolveStudentAudienceName(profile),
  );

  return hasStudentId && hasCourse && hasYear && hasName;
}
