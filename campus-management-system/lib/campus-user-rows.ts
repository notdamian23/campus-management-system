import { resolveCampusProfileName } from "@/lib/campus-auth";
import { resolveCourseLabelFromCode } from "@/lib/courseOptions";
import {
  getAssignedCourseCode,
  getCourseScope,
  isBOD,
  normalizeECScope,
  normalizeECPosition,
} from "@/lib/ec-permissions";
import {
  formatStudentFullName,
  normalizeStudentNamePart,
  resolveStudentRawFullName,
} from "@/lib/student-name";

export type CampusNormalizedRole = "admin" | "ec" | "teacher" | "student";
export type CampusAccountStatus = "Active" | "Inactive";
export type CampusFingerprintStatus = "Active" | "Inactive";

export type CampusUserProfileSource = {
  uid?: string;
  role?: string;
  schoolId?: string;
  studentId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  name?: string;
  displayName?: string;
  studentName?: string;
  teacherName?: string;
  ecPosition?: string | null;
  ecScope?: "all" | "course" | string | null;
  assignedCourse?: string | null;
  courseScope?: string | null;
  isBod?: boolean;
  course?: string;
  year?: string;
  yearLevel?: string;
  status?: string;
  readyForClearance?: boolean;
  createdAt?: unknown;
};

export type CampusUserProjectionSource = {
  uid?: string;
  studentId?: string;
  schoolId?: string;
  firstName?: string;
  lastName?: string;
  fullName?: string;
  name?: string;
  studentName?: string;
  ecPosition?: string | null;
  ecScope?: "all" | "course" | string | null;
  assignedCourse?: string | null;
  courseScope?: string | null;
  isBod?: boolean;
  course?: string;
  year?: string;
  yearLevel?: string;
  status?: string;
  readyForClearance?: boolean;
  fingerprintStatus?: string;
  fingerprintTemplateId?: number | string;
  templateId?: number | string;
};

export type CampusUserRow = {
  uid: string;
  role: CampusNormalizedRole;
  rawRole: string;
  schoolId: string;
  studentId: string;
  firstName: string;
  lastName: string;
  rawFullName: string;
  fullName: string;
  email: string;
  ecPosition: string;
  ecScope: "all" | "course" | null;
  assignedCourse: string | null;
  assignedCourseLabel: string;
  courseScope: string | null;
  isBod: boolean;
  course: string;
  yearLevel: string;
  accountStatus: CampusAccountStatus;
  fingerprintStatus: CampusFingerprintStatus;
  clearanceReady: boolean;
  createdAt?: unknown;
};

type NormalizeCampusUserRowOptions = {
  missingNameLabel?: string;
  missingCourseLabel?: string;
  missingYearLevelLabel?: string;
  missingStudentIdLabel?: string;
  fallbackSchoolIdToStudentId?: boolean;
};

type BuildCampusProfilePatchInput = {
  role?: string;
  name: string;
  schoolId: string;
  course?: string;
  yearLevel?: string;
};

function trimValue(value: unknown) {
  return String(value ?? "").trim();
}

function normalizeLower(value: unknown) {
  return trimValue(value).toLowerCase();
}

function normalizeRole(value: unknown): CampusNormalizedRole {
  const role = normalizeLower(value);
  if (role === "admin") return "admin";
  if (role === "teacher") return "teacher";
  if (role === "ec" || role === "ecmember") return "ec";
  return "student";
}

export function toStoredCampusRole(value: unknown) {
  const normalizedRole = normalizeRole(value);
  return normalizedRole === "ec" ? "ecmember" : normalizedRole;
}

function normalizeAccountStatus(value: unknown): CampusAccountStatus {
  return normalizeLower(value) === "inactive" ? "Inactive" : "Active";
}

function normalizeYearLabel(
  value: unknown,
  fallbackLabel: string,
) {
  const raw = trimValue(value);
  if (!raw) return fallbackLabel;

  const normalized = raw.toLowerCase();
  if (raw === "1" || normalized === "1st year") return "1st Year";
  if (raw === "2" || normalized === "2nd year") return "2nd Year";
  if (raw === "3" || normalized === "3rd year") return "3rd Year";
  if (raw === "4" || normalized === "4th year") return "4th Year";
  if (raw === "5" || normalized === "5th year") return "5th Year";
  return raw;
}

function normalizeFingerprintStatus(
  projection?: CampusUserProjectionSource | null,
): CampusFingerprintStatus {
  const fingerprintState = normalizeLower(projection?.fingerprintStatus);
  const templateId = Number(
    projection?.fingerprintTemplateId ?? projection?.templateId ?? 0,
  );

  return fingerprintState === "active" ||
    fingerprintState === "enrolled" ||
    (Number.isFinite(templateId) && templateId > 0)
    ? "Active"
    : "Inactive";
}

function resolveFullName(
  profile?: CampusUserProfileSource | null,
  projection?: CampusUserProjectionSource | null,
  missingNameLabel = "Unnamed User",
) {
  return formatStudentFullName(
    {
      firstName:
        normalizeStudentNamePart(profile?.firstName) ||
        normalizeStudentNamePart(projection?.firstName),
      lastName:
        normalizeStudentNamePart(profile?.lastName) ||
        normalizeStudentNamePart(projection?.lastName),
      name: trimValue(profile?.name) || trimValue(projection?.name),
      fullName:
        trimValue(profile?.fullName) || trimValue(projection?.fullName),
      displayName: trimValue(profile?.displayName),
      studentName:
        trimValue(profile?.studentName) || trimValue(projection?.studentName),
      teacherName: trimValue(profile?.teacherName),
      schoolId:
        trimValue(profile?.schoolId) || trimValue(projection?.schoolId),
    },
    resolveCampusProfileName(profile) || missingNameLabel,
  );
}

export function normalizeCampusUserRow(
  uid: string,
  profile?: CampusUserProfileSource | null,
  projection?: CampusUserProjectionSource | null,
  options?: NormalizeCampusUserRowOptions,
): CampusUserRow {
  const missingNameLabel = options?.missingNameLabel ?? "Unnamed User";
  const missingCourseLabel = options?.missingCourseLabel ?? "-";
  const missingYearLevelLabel = options?.missingYearLevelLabel ?? "-";
  const missingStudentIdLabel = options?.missingStudentIdLabel ?? "-";
  const fallbackSchoolIdToStudentId =
    options?.fallbackSchoolIdToStudentId !== false;
  const role = normalizeRole(profile?.role);
  const schoolId =
    trimValue(profile?.schoolId) ||
    trimValue(projection?.schoolId) ||
    uid ||
    "-";
  const rawStudentId =
    trimValue(profile?.studentId) || trimValue(projection?.studentId);
  const firstName =
    normalizeStudentNamePart(profile?.firstName) ||
    normalizeStudentNamePart(projection?.firstName);
  const lastName =
    normalizeStudentNamePart(profile?.lastName) ||
    normalizeStudentNamePart(projection?.lastName);
  const rawFullName =
    resolveStudentRawFullName({
      firstName,
      lastName,
      name: trimValue(profile?.name) || trimValue(projection?.name),
      fullName:
        trimValue(profile?.fullName) || trimValue(projection?.fullName),
      displayName: trimValue(profile?.displayName),
      studentName:
        trimValue(profile?.studentName) || trimValue(projection?.studentName),
      teacherName: trimValue(profile?.teacherName),
    }) || missingNameLabel;
  const studentId =
    rawStudentId ||
    ((role === "student" || role === "ec") && fallbackSchoolIdToStudentId
      ? schoolId
      : missingStudentIdLabel);
  const actualCourse =
    trimValue(profile?.course) || trimValue(projection?.course);
  const actualYearLevel =
    trimValue(profile?.yearLevel) ||
    trimValue(profile?.year) ||
    trimValue(projection?.yearLevel) ||
    trimValue(projection?.year);
  const assignedCourse = getAssignedCourseCode(profile);
  const derivedEcScope =
    role === "ec"
      ? normalizeECScope(profile?.ecScope) || (isBOD(profile) ? "course" : "all")
      : null;

  return {
    uid,
    role,
    rawRole: trimValue(profile?.role),
    schoolId,
    studentId,
    firstName,
    lastName,
    rawFullName,
    fullName: resolveFullName(profile, projection, missingNameLabel),
    email: trimValue(profile?.email),
    ecPosition: normalizeECPosition(profile?.ecPosition),
    ecScope: derivedEcScope,
    assignedCourse,
    assignedCourseLabel: assignedCourse
      ? resolveCourseLabelFromCode(assignedCourse)
      : "",
    courseScope: getCourseScope(profile),
    isBod: isBOD(profile),
    course:
      role === "teacher" || role === "admin"
        ? "-"
        : actualCourse || missingCourseLabel,
    yearLevel:
      role === "teacher" || role === "admin"
        ? "-"
        : normalizeYearLabel(actualYearLevel, missingYearLevelLabel),
    accountStatus: normalizeAccountStatus(
      projection?.status ?? profile?.status,
    ),
    fingerprintStatus: normalizeFingerprintStatus(projection),
    clearanceReady:
      projection?.readyForClearance === true ||
      profile?.readyForClearance === true,
    createdAt: profile?.createdAt,
  };
}

export function buildCampusProfileUpdatePayload({
  role,
  name,
  schoolId,
  course,
  yearLevel,
}: BuildCampusProfilePatchInput) {
  const normalizedRole = normalizeRole(role);
  const normalizedName = trimValue(name);
  const normalizedSchoolId = trimValue(schoolId);
  const normalizedCourse = trimValue(course);
  const normalizedYearLevel = trimValue(yearLevel);

  const profilePatch: Record<string, unknown> = {
    schoolId: normalizedSchoolId,
    name: normalizedName,
    fullName: normalizedName,
    course: normalizedCourse,
    year: normalizedYearLevel,
    yearLevel: normalizedYearLevel,
  };

  if (normalizedRole === "teacher") {
    profilePatch.teacherName = normalizedName;
  } else {
    profilePatch.studentName = normalizedName;
  }

  const studentPatch =
    normalizedRole === "student" || normalizedRole === "ec"
      ? {
          schoolId: normalizedSchoolId,
          name: normalizedName,
          fullName: normalizedName,
          studentName: normalizedName,
          course: normalizedCourse,
          year: normalizedYearLevel,
          yearLevel: normalizedYearLevel,
        }
      : null;

  return {
    role: normalizedRole,
    profilePatch,
    studentPatch,
  };
}
