import {
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import type { User } from "firebase/auth";
import { db } from "@/lib/firebase";

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
  course?: string;
  year?: string;
};

type CampusCookieState = {
  role: string;
  mustChangePassword: boolean;
  emailVerificationPending: boolean;
};

export function normalizeEmail(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
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
    (profile.firstLoginCompleted === false && profile.emailVerified === false)
  );
}

export function getOnboardingRedirect(profile: CampusProfileDoc) {
  if (needsEmailVerification(profile)) return "/verify-email-pending";
  if (needsPasswordChange(profile)) return "/change-password";
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
    url: `${baseUrl}/verify-email-pending`,
    handleCodeInApp: false,
  };
}

export async function finalizeVerifiedProfile(user: User) {
  const authEmail = normalizeEmail(user.email);
  if (!user.uid || !authEmail || !user.emailVerified) {
    return { finalized: false, profile: null as CampusProfileDoc | null };
  }

  const profileRef = doc(db, "profiles", user.uid);
  const profileSnap = await getDoc(profileRef);
  if (!profileSnap.exists()) {
    return { finalized: false, profile: null as CampusProfileDoc | null };
  }

  const profile = profileSnap.data() as CampusProfileDoc;
  const pendingEmail = normalizeEmail(profile.pendingEmail);
  const currentEmail = normalizeEmail(profile.email);
  const shouldFinalize =
    (pendingEmail && pendingEmail === authEmail) ||
    (!pendingEmail &&
      currentEmail === authEmail &&
      (profile.emailVerificationPending === true ||
        profile.emailVerified === false ||
        profile.firstLoginCompleted === false));

  if (!shouldFinalize) {
    return { finalized: false, profile };
  }

  await updateDoc(profileRef, {
    email: authEmail,
    emailVerified: true,
    emailVerificationPending: false,
    mustChangePassword: false,
    firstLoginCompleted: true,
    pendingEmail: deleteField(),
    status: profile.status === "Inactive" ? "Inactive" : "active",
    updatedAt: serverTimestamp(),
  });

  const refreshedProfileSnap = await getDoc(profileRef);
  return {
    finalized: true,
    profile: refreshedProfileSnap.exists()
      ? (refreshedProfileSnap.data() as CampusProfileDoc)
      : profile,
  };
}
