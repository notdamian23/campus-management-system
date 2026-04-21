import type { User } from "firebase/auth";
import { finalizeVerifiedCampusProfileForCurrentUser } from "@/lib/firebase-functions";
import {
  isEcWorkspaceRole,
  normalizeCampusRole,
  resolveCampusRoleHome,
  type CampusCanonicalRole,
} from "@/lib/campus-role";
import { isBOD } from "@/lib/ec-permissions";
import { formatStudentFullName } from "@/lib/student-name";

export type CampusRole = CampusCanonicalRole;

export type CampusProfileDoc = {
  role?: string;
  schoolId?: string;
  email?: string;
  pendingEmail?: string | null;
  mustChangePassword?: boolean;
  emailVerified?: boolean;
  emailVerificationPending?: boolean;
  firstLoginCompleted?: boolean;
  status?: string;
  teacherName?: string;
  studentName?: string;
  name?: string;
  fullName?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  course?: string;
  ecScope?: "all" | "course" | null;
  assignedCourse?: string | null;
  courseScope?: string | null;
  courseScopeLabel?: string | null;
  year?: string;
  yearLevel?: string;
  readyForClearance?: boolean;
  ecPosition?: string | null;
  isBod?: boolean;
  isStudent?: boolean;
};

type CampusCookieState = {
  role: string;
  mustChangePassword: boolean;
  emailVerificationPending: boolean;
  canAccessStudentPortal: boolean;
};

export type CampusVerificationEmailTarget = {
  email: string;
  mode: "current-auth-email" | "pending-email-update";
  hasStalePendingEmail: boolean;
};

export function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

export function isCampusLocalEmail(value: unknown) {
  return normalizeEmail(value).endsWith("@campus.local");
}

function trimProfileText(value: unknown) {
  return String(value ?? "").trim();
}

export function resolveCampusProfileName(
  profile?:
    | {
        firstName?: unknown;
        lastName?: unknown;
        name?: unknown;
        fullName?: unknown;
        studentName?: unknown;
        displayName?: unknown;
        teacherName?: unknown;
      }
    | null,
) {
  return formatStudentFullName({
    firstName: profile?.firstName,
    lastName: profile?.lastName,
    name: profile?.name,
    fullName: profile?.fullName,
    studentName: profile?.studentName,
    displayName: profile?.displayName,
    teacherName: profile?.teacherName,
  });
}

export function resolveCampusDisplayName(
  profile?:
    | {
        name?: unknown;
        fullName?: unknown;
        displayName?: unknown;
        schoolId?: unknown;
      }
    | null,
) {
  return (
    resolveCampusProfileName(profile) ||
    trimProfileText(profile?.schoolId) ||
    "User"
  );
}

export function resolveCampusVerificationEmailTarget(
  profile?:
    | {
        email?: unknown;
        pendingEmail?: unknown;
      }
    | null,
  authEmail?: unknown,
): CampusVerificationEmailTarget | null {
  const normalizedPendingEmail = normalizeEmail(profile?.pendingEmail);
  const normalizedProfileEmail = normalizeEmail(profile?.email);
  const normalizedAuthEmail = normalizeEmail(authEmail);
  const hasUsableAuthEmail =
    Boolean(normalizedAuthEmail) && !isCampusLocalEmail(normalizedAuthEmail);

  if (hasUsableAuthEmail) {
    return {
      email: normalizedAuthEmail,
      mode: "current-auth-email",
      hasStalePendingEmail:
        Boolean(normalizedPendingEmail) &&
        normalizedPendingEmail !== normalizedAuthEmail,
    };
  }

  if (normalizedPendingEmail && !isCampusLocalEmail(normalizedPendingEmail)) {
    return {
      email: normalizedPendingEmail,
      mode: "pending-email-update",
      hasStalePendingEmail: false,
    };
  }

  if (
    normalizedProfileEmail &&
    !isCampusLocalEmail(normalizedProfileEmail) &&
    normalizedAuthEmail &&
    normalizedProfileEmail === normalizedAuthEmail
  ) {
    return {
      email: normalizedProfileEmail,
      mode: "current-auth-email",
      hasStalePendingEmail: false,
    };
  }

  return null;
}

export function resolveRoleHome(role?: string) {
  return resolveCampusRoleHome(role);
}

export function canAccessStudentPortal(
  profile?:
    | {
        role?: unknown;
        isStudent?: unknown;
        ecPosition?: unknown;
        ecScope?: unknown;
        assignedCourse?: unknown;
        courseScope?: unknown;
        isBod?: unknown;
      }
    | null,
) {
  const normalizedRole = normalizeCampusRole(profile?.role);
  return (
    normalizedRole === "student" ||
    profile?.isStudent === true ||
    isBOD(profile)
  );
}

export function canAccessEcWorkspace(
  profile?:
    | {
        role?: unknown;
      }
    | null,
) {
  return isEcWorkspaceRole(profile?.role);
}

export function needsPasswordChange(profile: CampusProfileDoc) {
  return (
    profile.mustChangePassword === true &&
    profile.emailVerificationPending !== true
  );
}

export function needsEmailVerification(profile: CampusProfileDoc) {
  return (
    profile.emailVerificationPending === true ||
    (
      profile.mustChangePassword !== true &&
      profile.firstLoginCompleted === false &&
      profile.emailVerified === false
    )
  );
}

export function getOnboardingRedirect(profile: CampusProfileDoc) {
  if (needsPasswordChange(profile)) return "/change-password";
  if (needsEmailVerification(profile)) return "/verify-email-pending";
  return null;
}

export function setCampusCookies({
  role,
  mustChangePassword,
  emailVerificationPending,
  canAccessStudentPortal,
}: CampusCookieState) {
  if (typeof document === "undefined") return;

  const normalizedRole = normalizeCampusRole(role);
  const maxAge = 60 * 60 * 24 * 7;
  document.cookie = `campus_logged_in=1; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  document.cookie = `campus_role=${normalizedRole}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  document.cookie = `campus_is_student=${canAccessStudentPortal ? "1" : "0"}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  document.cookie = `campus_must_change=${mustChangePassword ? "1" : "0"}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  document.cookie = `campus_email_pending=${emailVerificationPending ? "1" : "0"}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function clearCampusCookies() {
  if (typeof document === "undefined") return;

  document.cookie = "campus_logged_in=; Path=/; Max-Age=0";
  document.cookie = "campus_role=; Path=/; Max-Age=0";
  document.cookie = "campus_is_student=; Path=/; Max-Age=0";
  document.cookie = "campus_must_change=; Path=/; Max-Age=0";
  document.cookie = "campus_email_pending=; Path=/; Max-Age=0";
}

export function getAppBaseUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function buildEmailActionSettings() {
  const baseUrl = getAppBaseUrl();
  return {
    url: `${baseUrl}/auth/action`,
    handleCodeInApp: false,
  };
}

export async function finalizeVerifiedProfile(user: User) {
  if (!user.uid || !normalizeEmail(user.email) || !user.emailVerified) {
    return { finalized: false, profile: null as CampusProfileDoc | null };
  }
  return finalizeVerifiedCampusProfileForCurrentUser();
}
