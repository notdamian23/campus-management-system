import { isEcRole, normalizeCampusRole } from "@/lib/campus-role";
import {
  normalizeStudentNamePart,
  resolveStudentRawFullName,
} from "@/lib/student-name";

export type StudentAudienceProfileLike = {
  role?: unknown;
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

function hasMeaningfulStudentAudienceValue(value: unknown) {
  const normalized = trimValue(value);
  if (!normalized) {
    return false;
  }

  return !INVALID_STUDENT_AUDIENCE_VALUES.has(normalized.toLowerCase());
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

export function isStudentAudienceProfile(
  profile?: StudentAudienceProfileLike | null,
) {
  const normalizedRole = normalizeCampusRole(profile?.role);
  if (normalizedRole !== "student" && !isEcRole(profile?.role)) {
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
