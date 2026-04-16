import type { User } from "firebase/auth";
import { finalizeVerifiedCampusProfileForCurrentUser } from "@/lib/firebase-functions";

export type CampusRole = "teacher" | "student" | "ec" | "admin";

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
  course?: string;
  year?: string;
  yearLevel?: string;
  readyForClearance?: boolean;
};

type CampusCookieState = {
  role: string;
  mustChangePassword: boolean;
  emailVerificationPending: boolean;
};

export function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function trimProfileText(value: unknown) {
  return String(value ?? "").trim();
}

export function resolveCampusProfileName(
  profile?:
    | {
        name?: unknown;
        fullName?: unknown;
        displayName?: unknown;
      }
    | null,
) {
  return (
    [
      trimProfileText(profile?.name),
      trimProfileText(profile?.fullName),
      trimProfileText(profile?.displayName),
    ].find(Boolean) ?? ""
  );
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

export function resolveRoleHome(role?: string) {
  if (role === "teacher") return "/teacher";
  if (role === "student") return "/student";
  if (role === "ec") return "/ecmember";
  if (role === "admin") return "/admin";
  return "/";
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
}: CampusCookieState) {
  if (typeof document === "undefined") return;

  const maxAge = 60 * 60 * 24 * 7;
  document.cookie = `campus_logged_in=1; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  document.cookie = `campus_role=${role}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  document.cookie = `campus_must_change=${mustChangePassword ? "1" : "0"}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  document.cookie = `campus_email_pending=${emailVerificationPending ? "1" : "0"}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

export function clearCampusCookies() {
  if (typeof document === "undefined") return;

  document.cookie = "campus_logged_in=; Path=/; Max-Age=0";
  document.cookie = "campus_role=; Path=/; Max-Age=0";
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
